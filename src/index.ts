// #region imports
// first, so modules that read env at load see .env
import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import { PrismaSessionStore } from "@quixo3/prisma-session-store";
import helmet from "helmet";
import multer from "multer";
import passport from "passport";
import cookieParser from "cookie-parser";
import inizializePassport from "./passportConfig.js";
import i18n from "i18n";
import path from "path";
import fs from "fs";
import initCronJob from "./cronJob.js";
import { prisma } from "./utils.js";
import { apiLimit } from "./limits.js";
import { scheduleCachePruning } from "./routing/data/diskCache.js";
import auth from "./routes/auth.js";
import user from "./routes/user.js";
import friend from "./routes/friend.js";
import post from "./routes/post.js";
import quest from "./routes/quest.js";
import track from "./routes/track.js";
import search from "./routes/search.js";
import route from "./routes/route.js";
import vehicle from "./routes/vehicle.js";
import share from "./routes/share.js";
// #endregion 

// #region inizialization
const app = express();
inizializePassport(passport);
const MIN_SECRET_LENGTH = 32;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < MIN_SECRET_LENGTH) throw (`SESSION_SECRET is required, at least ${MIN_SECRET_LENGTH} characters`);
const COOKIE_SECRET = process.env.COOKIE_SECRET;
if (!COOKIE_SECRET || COOKIE_SECRET.length < MIN_SECRET_LENGTH) throw (`COOKIE_SECRET is required, at least ${MIN_SECRET_LENGTH} characters`);
const PORT = process.env.PORT;
if (!PORT) throw ("PORT is required");
const LOCALES_DIRECTORY = path.resolve(import.meta.dirname, "..", 'locales');
const LOCALES = fs.readdirSync(LOCALES_DIRECTORY)
    .filter(file => !fs.statSync(path.join(LOCALES_DIRECTORY, file)).isDirectory())
    .map(file => path.parse(file).name);
i18n.configure({
    locales: LOCALES,
    directory: LOCALES_DIRECTORY,
    defaultLocale: "en",
    queryParameter: "lang",
    autoReload: true,
    syncFiles: true,
    objectNotation: true,
});
// #endregion

// #region middleware
// behind one reverse proxy, for the client IP and secure cookies
app.set("trust proxy", 1);
app.use(i18n.init);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            // MapLibre fetches the tiles itself
            "img-src": ["'self'", "data:", "blob:", "https://tiles.stadiamaps.com"],
            "connect-src": ["'self'", "https://tiles.stadiamaps.com"],
            "worker-src": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'"],
            "upgrade-insecure-requests": null,
        },
    },
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
// sessions last 30 days
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    // the app's cookie jar looks for the default name, connect.sid
    cookie: { maxAge: SESSION_MAX_AGE_MS, sameSite: "lax", secure: "auto" },
    store: new PrismaSessionStore(prisma, { checkPeriod: 60 * 60 * 1000 }),
}));
app.use(cookieParser(COOKIE_SECRET));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(import.meta.dirname, "..", "public"), { extensions: ["html"] }));
// served from here so browsers never contact Google Fonts or a CDN (GDPR)
const vendor = (pkg: string) => express.static(path.join(import.meta.dirname, "..", "node_modules", pkg));
app.use("/vendor/maplibre-gl", vendor("maplibre-gl/dist"));
app.use("/vendor/roboto", vendor("@fontsource/roboto"));
// the planner is the only web page for now
app.get("/", (request, response) => response.redirect(request.isAuthenticated() ? "/plan" : "/login"));
app.use(apiLimit);

// #endregion

// #region routes
app.use("/auth", auth);
app.use("/user", user);
app.use("/friend", friend);
app.use("/post", post);
app.use("/quest", quest);
app.use("/track", track);
app.use("/search", search);
app.use("/route", route);
app.use("/vehicle", vehicle);
// public: assetlinks.json and shared post pages
app.use("/", share);

app.use((error: any, request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") return response.status(413).send(response.__("file.errors.too-large"));
        return response.status(422).send(response.__("file.errors.invalid"));
    }
    if (error?.type === "entity.too.large") return response.status(413).send(response.__("server.too-large"));
    if (error?.status === 400) return response.status(400).send(response.__("server.bad-request"));
    console.error(error);
    response.status(500).send(response.__("server.error"));
});
// #endregion

// initializing cron job for quests
initCronJob();
scheduleCachePruning();

app.listen(PORT, (error) => {
    if (error) {
        console.error(error);
        process.exit(1);
    }
    console.log(`Server has started on http://localhost:${PORT}`);
})

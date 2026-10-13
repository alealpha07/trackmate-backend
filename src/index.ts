// #region imports
import express from "express";
import session from "express-session";
import { PrismaSessionStore } from "@quixo3/prisma-session-store";
import cors from "cors";
import passport from "passport";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import inizializePassport from "./passportConfig";
import dotenv from "dotenv";
import i18n from "i18n";
import path from "path";
import fs from "fs";
import initCronJob from "./cronJob";
import { prisma } from "./utils";
// #endregion 

// #region inizialization
dotenv.config();
const app = express();
inizializePassport(passport);
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) throw ("SESSION_SECRET is required");
const COOKIE_SECRET = process.env.COOKIE_SECRET;
if (!COOKIE_SECRET) throw ("COOKIE_SECRET is required");
const PORT = process.env.PORT;
if (!PORT) throw ("PORT is required");
const LOCALES_DIRECTORY = path.resolve(__dirname, "..", 'locales');
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
app.use(i18n.init);
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));
// sessions last 30 days
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: SESSION_MAX_AGE_MS },
    store: new PrismaSessionStore(prisma, { checkPeriod: 60 * 60 * 1000 }),
}));
app.use(cookieParser(COOKIE_SECRET));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));
// served from here so browsers never contact Google Fonts or a CDN (GDPR)
const vendor = (pkg: string) => express.static(path.join(__dirname, "..", "node_modules", pkg));
app.use("/vendor/maplibre-gl", vendor("maplibre-gl/dist"));
app.use("/vendor/roboto", vendor("@fontsource/roboto"));
// the planner is the only web page for now
app.get("/", (request, response) => response.redirect(request.isAuthenticated() ? "/plan" : "/login"));

// #endregion

// #region routes
import auth from "./routes/auth";
app.use("/auth", auth);
import user from "./routes/user";
app.use("/user", user);
import friend from "./routes/friend";
app.use("/friend", friend);
import post from "./routes/post";
app.use("/post", post);
import quest from "./routes/quest";
app.use("/quest", quest);
import track from "./routes/track";
app.use("/track", track);
import search from "./routes/search";
app.use("/search", search);
import route from "./routes/route";
app.use("/route", route);
import vehicle from "./routes/vehicle";
app.use("/vehicle", vehicle);
// public: assetlinks.json and shared post pages
import share from "./routes/share";
app.use("/", share);
// #endregion

// initializing cron job for quests
initCronJob();
// imported after dotenv
import { scheduleCachePruning } from "./routing/data/diskCache";
scheduleCachePruning();

app.listen(PORT, () => {
    console.log(`Server has started on http://localhost:${PORT}`);
})

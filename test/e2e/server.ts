import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { RIDER } from "./seed.js";

const BACKEND_DIR = path.join(import.meta.dirname, "..", "..");
const OSM_FIXTURES = path.join(BACKEND_DIR, "test", "fixtures", "osm");
// nothing listens there, the planner only uses the fixture tiles
const CLOSED = "http://127.0.0.1:9";
const SECRET = "e2e-secret-not-used-anywhere-else-0123456789";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "trackmate-e2e-"));
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

const sub = (name: string) => {
    const full = path.join(root, name);
    fs.mkdirSync(full, { recursive: true });
    return full;
};

const databaseUrl = `file:${path.join(root, "e2e.db")}`;
execFileSync(path.join(BACKEND_DIR, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
});
const osm = sub("osm");
for (const tile of fs.readdirSync(OSM_FIXTURES).filter((name) => name.endsWith(".json.gz"))) {
    fs.copyFileSync(path.join(OSM_FIXTURES, tile), path.join(osm, tile));
}
const dem = sub("dem");
fs.writeFileSync(path.join(dem, "Copernicus_DSM_COG_10_N44_00_E009_00_DEM.none"), "");

Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    UPLOAD_DIR: sub("uploads"),
    OSM_CACHE_DIR: osm,
    DEM_CACHE_DIR: dem,
    INSTRUCTIONS_CACHE_DIR: sub("instructions"),
    OVERPASS_ENDPOINT: CLOSED,
    DEM_URL: CLOSED,
    VALHALLA_URL: CLOSED,
    PHOTON_URL: CLOSED,
    STADIA_API_KEY: "",
    SESSION_SECRET: SECRET,
    COOKIE_SECRET: SECRET,
});
delete process.env.PUBLIC_URL;

// imported after the env is set, never src/index.ts, so .env stays unread
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/utils.js");
const { hashPassword } = await import("../../src/passportConfig.js");

await prisma.user.create({
    data: {
        username: RIDER.username,
        password: await hashPassword(RIDER.password),
        termsAcceptedAt: new Date(),
        vehicles: { create: [{ vehicle: "BICYCLE" }] },
    },
});

const port = Number(process.env.E2E_PORT);
app.listen(port, "127.0.0.1", () => console.log(`e2e server on http://127.0.0.1:${port}`));

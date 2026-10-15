import fs from "fs";
import path from "path";
import { inject } from "vitest";

const FIXTURES = path.join(import.meta.dirname, "..", "fixtures");
// nothing listens there, so a missed fake fails fast
const CLOSED = "http://127.0.0.1:9";
const SECRET = "test-secret-not-used-anywhere-else-0123456789";
// the fixture tiles have no elevation, so it stays flat
const DEM_TILES = ["N44_00_E009_00"];

const root = inject("testRoot");
const dir = fs.mkdtempSync(path.join(root, "file-"));
const sub = (name: string) => {
    const full = path.join(dir, name);
    fs.mkdirSync(full, { recursive: true });
    return full;
};

fs.copyFileSync(path.join(root, "template.db"), path.join(dir, "test.db"));
const osm = sub("osm");
for (const tile of fs.readdirSync(path.join(FIXTURES, "osm")).filter((name) => name.endsWith(".json.gz"))) {
    fs.copyFileSync(path.join(FIXTURES, "osm", tile), path.join(osm, tile));
}
const dem = sub("dem");
for (const tile of DEM_TILES) fs.writeFileSync(path.join(dem, `Copernicus_DSM_COG_10_${tile}_DEM.none`), "");

Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: `file:${path.join(dir, "test.db")}`,
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

// tests never reach a public service
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!LOCAL_HOSTS.includes(url.hostname)) return Promise.reject(new Error(`Blocked request to ${url.hostname}`));
    return realFetch(input, init);
};

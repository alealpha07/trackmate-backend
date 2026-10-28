import path from "path";
import { CACHE_DIR, OVERPASS_ENDPOINTS, VALHALLA_URL } from "./config.js";

const STAGES = ["data", "valhalla", "routes", "filters", "analyze", "figures"] as const;
type Stage = (typeof STAGES)[number];

// the routing modules read these when they load, and .env is never read for them
Object.assign(process.env, {
    OSM_CACHE_DIR: path.join(CACHE_DIR, "osm"),
    DEM_CACHE_DIR: path.join(CACHE_DIR, "dem"),
    // a frozen snapshot: cached tiles are never refreshed or pruned
    OSM_CACHE_TTL_DAYS: "36500",
    DEM_CACHE_TTL_DAYS: "36500",
    OSM_CACHE_MAX_MB: "1000000",
    DEM_CACHE_MAX_MB: "1000000",
    OVERPASS_ENDPOINT: OVERPASS_ENDPOINTS.join(","),
    VALHALLA_URL,
});

const only = process.argv.indexOf("--only");
const stages = only >= 0 ? process.argv[only + 1].split(",") : [...STAGES];
const unknown = stages.filter((s) => !STAGES.includes(s as Stage));
if (unknown.length > 0) {
    console.error(`Unknown stage ${unknown.join(", ")}, use ${STAGES.join(", ")}`);
    process.exit(1);
}

const run: Record<Stage, () => Promise<void>> = {
    data: async () => (await import("./data.js")).runData(),
    valhalla: async () => (await import("./valhalla.js")).runValhalla(),
    routes: async () => (await import("./routes.js")).runRoutes(),
    filters: async () => (await import("./filters.js")).runFilters(),
    analyze: async () => (await import("./analyze.js")).runAnalyze(),
    figures: async () => (await import("./figures.js")).runFigures(),
};

for (const stage of STAGES) {
    if (!stages.includes(stage)) continue;
    const start = Date.now();
    console.log(`== ${stage}`);
    await run[stage]();
    console.log(`== ${stage} done in ${((Date.now() - start) / 1000).toFixed(0)} s`);
}

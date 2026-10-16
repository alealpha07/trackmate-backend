import path from "path";

// highway values fetched from Overpass
export const HIGHWAY_WHITELIST = [
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    // links, without them big junctions have gaps
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
    "pedestrian",
    "track",
    "path",
    "footway",
    "cycleway",
    "steps",
    "bridleway",
];

// railways that make a crossing at grade
export const RAILWAYS = ["tram", "rail", "light_rail", "narrow_gauge"];

// comma separated, tried in order
export const OVERPASS_ENDPOINTS = (process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
export const CONTACT_EMAIL = "alealphatv@gmail.com";
// Overpass mirrors reject generic User-Agents
export const OVERPASS_USER_AGENT = `trackmate-backend/1.0 (SafeTrack thesis, route planner, ${CONTACT_EMAIL})`;
export const OVERPASS_TIMEOUT_SECONDS = 120;
// overpass-api.de policy: no parallel requests
export const OVERPASS_MAX_PARALLEL = 1;

export const OSM_CACHE_DIR = process.env.OSM_CACHE_DIR || path.join(import.meta.dirname, "..", "..", "cache", "osm");
// tile cache: refresh after TTL, prune least recently used past MAX_MB
export const OSM_CACHE_TTL_DAYS = Number(process.env.OSM_CACHE_TTL_DAYS) || 30;
export const OSM_CACHE_MAX_MB = Number(process.env.OSM_CACHE_MAX_MB) || 1024;
// Copernicus GLO-30, 30 m grid, no key needed
export const DEM_URL = process.env.DEM_URL || "https://copernicus-dem-30m.s3.amazonaws.com";
export const DEM_CACHE_DIR = process.env.DEM_CACHE_DIR || path.join(import.meta.dirname, "..", "..", "cache", "dem");
// Italy is about 45 tiles, 1.8 GB
export const DEM_CACHE_TTL_DAYS = Number(process.env.DEM_CACHE_TTL_DAYS) || 365;
export const DEM_CACHE_MAX_MB = Number(process.env.DEM_CACHE_MAX_MB) || 2048;
export const VALHALLA_URL = (process.env.VALHALLA_URL || "https://valhalla1.openstreetmap.de").replace(/\/+$/, "");
// FOSSGIS wants the app and a contact in the User-Agent
export const VALHALLA_USER_AGENT = `trackmate-backend/1.0 (turn-by-turn instructions, ${CONTACT_EMAIL})`;
// the Valhalla README asks published apps to send this
export const VALHALLA_CLIENT_ID = process.env.VALHALLA_CLIENT_ID || hostOf(process.env.PUBLIC_URL) || "trackmate";
export const INSTRUCTIONS_CACHE_DIR = process.env.INSTRUCTIONS_CACHE_DIR || path.join(import.meta.dirname, "..", "..", "cache", "instructions");
export const INSTRUCTIONS_CACHE_TTL_DAYS = Number(process.env.INSTRUCTIONS_CACHE_TTL_DAYS) || 30;
export const INSTRUCTIONS_CACHE_MAX_MB = Number(process.env.INSTRUCTIONS_CACHE_MAX_MB) || 256;
// a 30 m grid is too coarse for short edges
export const GRADE_WINDOW_METERS = 200;
// ground filter radius in pixels, removes roofs and trees from the elevation
export const DEM_GROUND_RADIUS = 5;
// gentler descents are just noise in flat cities
export const DOWNHILL_GRADE = -0.03;
// tracks were counted within a 5 m wide site (Harris 2013), so a crossing weighs 5 m, whatever the node spacing
export const CROSSING_SITE_METERS = 5;

// degrees, about 5.5 km
export const TILE_SIZE_DEG = 0.05;
// bounded by total edges, about 475 MB
export const GRAPH_CACHE_MAX_EDGES = 1_000_000;

// same default as OSRM
export const SMALL_COMPONENT_SIZE = 1000;

export const MAX_PLAN_DISTANCE_METERS = 50_000;
// each leg builds its own graph
export const MAX_PLAN_STOPS = 10;
export const BBOX_BUFFER_METERS = 2_000;

// only for the displayed duration (OSRM bicycle default)
export const DISPLAY_CYCLING_SPEED_KMH = 15;

// used when a road has no speed limit or lanes mapped
export const DEFAULT_MAXSPEED_KMH = 50;
export const DEFAULT_LANES = 2;

export const POLICIES = ["safest", "shortest"] as const;
export const FILTERS = ["cyclewaysOnly", "avoidUnpaved", "avoidLts4"] as const;

function hostOf(url?: string): string | undefined {
    try {
        return url ? new URL(url).host : undefined;
    } catch {
        return undefined;
    }
}

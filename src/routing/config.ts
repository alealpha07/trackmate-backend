import path from "path";

// highway values fetched from Overpass
export const HIGHWAY_WHITELIST = [
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
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

// comma separated, tried in order
export const OVERPASS_ENDPOINTS = (process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
// Overpass mirrors reject generic User-Agents
export const OVERPASS_USER_AGENT = "trackmate-backend/1.0 (SafeTrack thesis, route planner)";
export const OVERPASS_TIMEOUT_SECONDS = 120;
// overpass-api.de allows a few slots per IP
export const OVERPASS_MAX_PARALLEL = 2;

export const OSM_CACHE_DIR = process.env.OSM_CACHE_DIR || path.join(__dirname, "..", "..", "cache", "osm");
export const OSM_CACHE_TTL_DAYS = Number(process.env.OSM_CACHE_TTL_DAYS) || 30;
// degrees, about 5.5 km
export const TILE_SIZE_DEG = 0.05;
export const GRAPH_CACHE_SIZE = 3;

export const MAX_PLAN_DISTANCE_METERS = 50_000;
// box buffer
export const BBOX_BUFFER_METERS = 2_000;

// only for the displayed duration (OSRM bicycle default)
export const DISPLAY_CYCLING_SPEED_KMH = 15;

export const VEHICLES = ["bicycle"];
export const POLICIES = ["shortest"];

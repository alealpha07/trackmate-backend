import path from "path";

/** highway=* values fetched from Overpass. Bare footway/pedestrian/steps get a second,
 * tag-aware filter in buildGraph.ts. */
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

// Main public instance. The prototype used overpass.openstreetmap.fr, which is now whitelist-only (403);
// if overpass-api.de answers 406, point OVERPASS_ENDPOINT at another mirror.
export const OVERPASS_ENDPOINT = process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter";
// Overpass mirrors reject generic/anonymous User-Agents.
export const OVERPASS_USER_AGENT = "trackmate-backend/1.0 (SafeTrack thesis, route planner)";
export const OVERPASS_TIMEOUT_SECONDS = 120;
// Overpass usually grants 2 query slots per IP.
export const OVERPASS_MAX_PARALLEL = 2;

export const OSM_CACHE_DIR = process.env.OSM_CACHE_DIR || path.join(__dirname, "..", "..", "cache", "osm");
export const OSM_CACHE_TTL_DAYS = Number(process.env.OSM_CACHE_TTL_DAYS) || 30;
/** Tile edge in degrees (~5.5 km north-south). */
export const TILE_SIZE_DEG = 0.05;

/** Max straight-line distance between start and destination (v1, bicycle). */
export const MAX_PLAN_DISTANCE_METERS = 50_000;
/** BBOX buffer Δ around the start-destination envelope. An implementation parameter:
 * no reference prescribes a value (context/Notes.md, "Dynamic BBOX"). */
export const BBOX_BUFFER_METERS = 2_000;

/** Average cycling speed, only used to display an estimated duration (not a routing weight).
 * Source: OSRM bicycle profile, `default_speed = 15`
 * (https://github.com/Project-OSRM/osrm-backend/blob/master/profiles/bicycle.lua). */
export const DISPLAY_CYCLING_SPEED_KMH = 15;

export const VEHICLES = ["bicycle"];
// "safest" is added in Phase 3 together with the Teschke weights.
export const POLICIES = ["shortest"];

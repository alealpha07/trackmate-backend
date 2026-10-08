import path from "path";

/** highway=* values fetched from Overpass. Which of them bikes may use is decided per way in
 * buildGraph.ts (footways, motorways, private roads...). */
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

// Comma-separated list, tried in order when one fails. Default: the main public instance.
export const OVERPASS_ENDPOINTS = (process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
// Overpass mirrors reject generic/anonymous User-Agents.
export const OVERPASS_USER_AGENT = "trackmate-backend/1.0 (SafeTrack thesis, route planner)";
export const OVERPASS_TIMEOUT_SECONDS = 120;
// Overpass queries running at once for the whole server. overpass-api.de grants a few slots
// per IP (4 at the time of writing, see /api/status); 2 leaves room for retries.
export const OVERPASS_MAX_PARALLEL = 2;

export const OSM_CACHE_DIR = process.env.OSM_CACHE_DIR || path.join(__dirname, "..", "..", "cache", "osm");
export const OSM_CACHE_TTL_DAYS = Number(process.env.OSM_CACHE_TTL_DAYS) || 30;
/** Tile edge in degrees (~5.5 km north-south). */
export const TILE_SIZE_DEG = 0.05;
/** Built graphs (one per leg) kept in memory, bounded by their total edge count. An edge takes
 * ~475 bytes with its adjacency, so ~475 MB. The latest graph is always kept. */
export const GRAPH_CACHE_MAX_EDGES = 1_000_000;

/** Points snap only to strongly connected components of at least this many nodes (components.ts).
 * Same default as OSRM (osrm-extract --small-component-size 1000). */
export const SMALL_COMPONENT_SIZE = 1000;

/** Max straight-line distance between consecutive points of a route. */
export const MAX_PLAN_DISTANCE_METERS = 50_000;
/** BBOX buffer Δ around the envelope of a leg. An implementation parameter: no reference
 * prescribes a value. */
export const BBOX_BUFFER_METERS = 2_000;

/** Average cycling speed, only used to display an estimated duration (not a routing weight).
 * Source: OSRM bicycle profile, `default_speed = 15`
 * (https://github.com/Project-OSRM/osrm-backend/blob/master/profiles/bicycle.lua). */
export const DISPLAY_CYCLING_SPEED_KMH = 15;

/** LTS (Mekuria 2012) when a road has no speed limit or lane count mapped: the urban speed limit
 * (CdS art. 142) and one lane per direction. */
export const DEFAULT_MAXSPEED_KMH = 50;
export const DEFAULT_LANES = 2;

export const VEHICLES = ["bicycle"];
/** safest: least injury risk (Teschke 2012), shortest: least distance. See edgeWeight.ts. */
export const POLICIES = ["safest", "shortest"];
/** Hard filters the user can turn on: matching edges are left out of the search (filters.ts). */
export const FILTERS = ["cyclewaysOnly", "avoidUnpaved", "avoidLts4", "avoidConstruction"] as const;

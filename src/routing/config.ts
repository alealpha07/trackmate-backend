import path from "path";

/** highway=* values fetched from Overpass. Which of them bikes may use is decided per way in buildGraph.ts. */
export const HIGHWAY_WHITELIST = [
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    // Slip roads and ramps at junctions: without them big junctions have gaps
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

/** A road node shared with one of these railway=* ways is a crossing at grade. */
export const RAILWAYS = ["tram", "rail", "light_rail", "narrow_gauge"];

// Comma-separated, tried in order when one fails
export const OVERPASS_ENDPOINTS = (process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
// Overpass mirrors reject generic User-Agents
export const OVERPASS_USER_AGENT = "trackmate-backend/1.0 (SafeTrack thesis, route planner)";
export const OVERPASS_TIMEOUT_SECONDS = 120;
// Queries at once for the whole server: overpass-api.de grants a few slots per IP, 2 leaves room for retries
export const OVERPASS_MAX_PARALLEL = 2;

export const OSM_CACHE_DIR = process.env.OSM_CACHE_DIR || path.join(__dirname, "..", "..", "cache", "osm");
/** TTL: a tile older than this is downloaded again when needed, one unused this long is deleted.
 * MAX_MB: past it, the least recently used tiles are deleted. */
export const OSM_CACHE_TTL_DAYS = Number(process.env.OSM_CACHE_TTL_DAYS) || 30;
export const OSM_CACHE_MAX_MB = Number(process.env.OSM_CACHE_MAX_MB) || 1024;
/** Copernicus GLO-30 elevation (30 m grid), 1°×1° GeoTIFF tiles of 30-50 MB, no key needed. */
export const DEM_URL = process.env.DEM_URL || "https://copernicus-dem-30m.s3.amazonaws.com";
export const DEM_CACHE_DIR = process.env.DEM_CACHE_DIR || path.join(__dirname, "..", "..", "cache", "dem");
// Elevation rarely changes. Italy is ~45 tiles, ~1.8 GB
export const DEM_CACHE_TTL_DAYS = Number(process.env.DEM_CACHE_TTL_DAYS) || 365;
export const DEM_CACHE_MAX_MB = Number(process.env.DEM_CACHE_MAX_MB) || 2048;
/** Grades are measured over this length of road around each edge: a 30 m grid is too coarse for a 10 m edge. */
export const GRADE_WINDOW_METERS = 200;
/** Ground filter radius in pixels (11×11, ~330 m). The elevation data includes roofs and tree tops:
 * without it, flat cities look hilly (Berlin roads steeper than −3%: 24.7% → 3.2% with it), while
 * real hills keep their slopes. */
export const DEM_GROUND_RADIUS = 5;
/** Grade (rise over run, in the direction of travel) below which the downhill hazard applies. The
 * study counts any downhill; gentler descents can't be told apart from the noise in flat cities. */
export const DOWNHILL_GRADE = -0.03;

/** Tile edge in degrees (~5.5 km north-south). */
export const TILE_SIZE_DEG = 0.05;
/** Built graphs kept in memory, bounded by their total edges (~475 bytes each, so ~475 MB). */
export const GRAPH_CACHE_MAX_EDGES = 1_000_000;

/** Points snap only to connected parts of the network at least this big (same default as OSRM). */
export const SMALL_COMPONENT_SIZE = 1000;

/** Max straight-line distance between consecutive points. */
export const MAX_PLAN_DISTANCE_METERS = 50_000;
/** Margin added around each leg's box. */
export const BBOX_BUFFER_METERS = 2_000;

/** Only for the displayed duration, not a routing weight (OSRM's bicycle default). */
export const DISPLAY_CYCLING_SPEED_KMH = 15;

/** For traffic stress when a road has no speed limit or lanes mapped: the Italian urban limit and one
 * lane per direction. */
export const DEFAULT_MAXSPEED_KMH = 50;
export const DEFAULT_LANES = 2;

export const POLICIES = ["safest", "shortest"];
export const FILTERS = ["cyclewaysOnly", "avoidUnpaved", "avoidLts4"] as const;

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import type { BBox, RouteFilters, RouteType } from "../src/routing/types.js";

export const BENCHMARK_DIR = import.meta.dirname;
export const CACHE_DIR = path.join(BENCHMARK_DIR, "cache");
export const OUT_DIR = path.join(BENCHMARK_DIR, "out");

// tried in turn on errors, the main server is often at capacity
export const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
export const VALHALLA_URL = "https://valhalla1.openstreetmap.de";
export const STADIA_STYLE = "outdoors";

export const SEED = 42;
export const PAIRS_PER_CITY = 30;
export const MIN_PAIR_METERS = 1_500;
export const MAX_PAIR_METERS = 6_000;
export const TIMING_REPEATS = 5;
// valhalla routes matched below this share are left out of the risk comparisons
export const MIN_COVERAGE = 0.95;
// farther than this from a way node, a valhalla edge end isn't matched
export const MATCH_TOLERANCE_METERS = 30;

// a detour is acceptable up to this ratio or these extra meters
export const MAX_DETOUR_RATIO = 1.25;
export const MAX_DETOUR_METERS = 536;
export const DETOUR_BANDS = [0.1, 0.5];

export const LANGUAGES = ["it", "en", "de"] as const;
export type Language = (typeof LANGUAGES)[number];

function argument(name: string): string | undefined {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] : undefined;
}

// --lang wins over BENCHMARK_LANGUAGE in the environment or .env
function language(): Language {
    const env = path.join(BENCHMARK_DIR, "..", ".env");
    const fromFile = fs.existsSync(env) ? dotenv.parse(fs.readFileSync(env)).BENCHMARK_LANGUAGE : undefined;
    const chosen = argument("--lang") ?? process.env.BENCHMARK_LANGUAGE ?? fromFile ?? "en";
    if (!LANGUAGES.includes(chosen as Language)) throw new Error(`Unknown language ${chosen}, use ${LANGUAGES.join(", ")}`);
    return chosen as Language;
}

export const LANGUAGE = language();

export interface City {
    id: string;
    country: "IT" | "DE";
    box: BBox;
}

// central boxes of the 2026-10-16 run
const ALL_CITIES: City[] = [
    { id: "milan", country: "IT", box: { south: 45.44, north: 45.5, west: 9.15, east: 9.24 } },
    { id: "parma", country: "IT", box: { south: 44.775, north: 44.83, west: 10.29, east: 10.365 } },
    { id: "turin", country: "IT", box: { south: 45.025, north: 45.085, west: 7.635, east: 7.725 } },
    { id: "berlin", country: "DE", box: { south: 52.47, north: 52.53, west: 13.34, east: 13.46 } },
    { id: "munich", country: "DE", box: { south: 48.11, north: 48.17, west: 11.53, east: 11.625 } },
    { id: "frankfurt", country: "DE", box: { south: 50.085, north: 50.145, west: 8.62, east: 8.72 } },
];

// --cities milan,parma for a partial run
const chosen = argument("--cities")?.split(",");
export const CITIES = chosen ? ALL_CITIES.filter((c) => chosen.includes(c.id)) : ALL_CITIES;

export type VariantId = "shortest" | "safest" | "safest_filters" | "valhalla";

export interface PlannerVariant {
    id: Exclude<VariantId, "valhalla">;
    policy: "safest" | "shortest";
    filters: RouteFilters;
    maxDetour: number | null;
}

// safest_filters: avoid high stress and cycleways only, with the default detour cap
export const PLANNER_VARIANTS: PlannerVariant[] = [
    { id: "shortest", policy: "shortest", filters: {}, maxDetour: null },
    { id: "safest", policy: "safest", filters: {}, maxDetour: null },
    { id: "safest_filters", policy: "safest", filters: { cyclewaysOnly: true, avoidLts4: true }, maxDetour: 25 },
];

export const VARIANTS: VariantId[] = ["shortest", "safest", "safest_filters", "valhalla"];

// safest with one setting of safest_filters at a time, to see what each one costs
export type FilterRunId = "cap" | "lts4" | "cycleways";

const CAP = PLANNER_VARIANTS.find((v) => v.id === "safest_filters")!.maxDetour;

export const FILTER_RUNS: { id: FilterRunId; filters: RouteFilters; maxDetour: number | null }[] = [
    { id: "cap", filters: {}, maxDetour: CAP },
    { id: "lts4", filters: { avoidLts4: true }, maxDetour: CAP },
    { id: "cycleways", filters: { cyclewaysOnly: true }, maxDetour: CAP },
];

export type FilterConfigId = "safest" | FilterRunId | "safest_filters";

export const FILTER_CONFIGS: FilterConfigId[] = ["safest", "cap", "lts4", "cycleways", "safest_filters"];

export const FILTER_COLORS: Record<FilterConfigId, string> = {
    safest: "#2ca02c",
    cap: "#98df8a",
    lts4: "#9467bd",
    cycleways: "#17becf",
    safest_filters: "#1f77b4",
};

export const VARIANT_COLORS: Record<VariantId, string> = {
    shortest: "#d62728",
    safest: "#2ca02c",
    safest_filters: "#1f77b4",
    valhalla: "#ff7f0e",
};

export type GroupId = "cycle_track" | "path" | "local" | "major_lane" | "major" | "sidewalk";

export const ROUTE_TYPES: RouteType[] = [
    "cycle_track", "local_bike_route", "local", "major_lane", "bike_path", "major_shared", "major", "major_parked_lane",
    "major_parked_shared", "multiuse_unpaved", "multiuse_paved", "sidewalk", "major_parked",
];

export const GROUPS: GroupId[] = ["cycle_track", "path", "local", "major_lane", "major", "sidewalk"];

export const GROUP_OF: Record<RouteType, GroupId> = {
    cycle_track: "cycle_track",
    bike_path: "path",
    multiuse_paved: "path",
    multiuse_unpaved: "path",
    local: "local",
    local_bike_route: "local",
    major_lane: "major_lane",
    major_parked_lane: "major_lane",
    major: "major",
    major_shared: "major",
    major_parked: "major",
    major_parked_shared: "major",
    sidewalk: "sidewalk",
};

export const GROUP_COLORS: Record<GroupId, string> = {
    cycle_track: "#1b7837",
    path: "#7fbc41",
    local: "#4393c3",
    major_lane: "#fdb863",
    major: "#d6604d",
    sidewalk: "#999999",
};

export type HazardId = "tram" | "crossings" | "downhill" | "construction" | "lts4" | "parked" | "unpaved";

export const HAZARDS: HazardId[] = ["tram", "crossings", "downhill", "construction", "lts4", "parked", "unpaved"];

// tags the risk model falls back on a default without
export type TagCheckId = "parking" | "maxspeed" | "sidepath" | "designated" | "surface";

export const TAG_CHECKS: TagCheckId[] = ["parking", "maxspeed", "sidepath", "designated", "surface"];

// warm shades for Italy, cool shades for Germany
export const CITY_COLORS: Record<string, string> = {
    milan: "#e6550d",
    parma: "#fd8d3c",
    turin: "#fdbe85",
    berlin: "#08519c",
    munich: "#3182bd",
    frankfurt: "#9ecae1",
};

export const MAJOR_HIGHWAYS = ["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"];

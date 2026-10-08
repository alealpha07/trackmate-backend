import { BikeInfra, PATH_HIGHWAYS, Tags } from "./osmTags";

/** Road types of the injury study (Teschke 2012) the weights come from. */
export type RouteType =
    | "cycle_track"
    | "local_bike_route"
    | "local"
    | "major_lane"
    | "bike_path"
    | "major_shared"
    | "major"
    | "major_parked_lane"
    | "major_parked_shared"
    | "multiuse_unpaved"
    | "multiuse_paved"
    | "sidewalk"
    | "major_parked";

/** Injury risk of each road type relative to a major street with parked cars and no bike
 * infrastructure (1.00). Below 1 is safer: a cycle track (0.11) has about a ninth of the risk.
 * Road type and hazards multiply: a local street under construction is 0.51 · 1.93 ≈ 0.98. */
export const ROUTE_TYPE_OR: Record<RouteType, number> = {
    cycle_track: 0.11,          // bike track separated from the road
    local_bike_route: 0.49,     // local street signed as a bike route
    local: 0.51,
    major_lane: 0.54,           // no parked cars, bike lane
    bike_path: 0.59,            // off-road, bikes only
    major_shared: 0.60,         // no parked cars, shared lane
    major: 0.63,                // no parked cars
    major_parked_lane: 0.69,
    major_parked_shared: 0.71,
    multiuse_unpaved: 0.73,
    multiuse_paved: 0.79,
    sidewalk: 0.87,             // or other pedestrian path
    major_parked: 1.00,
};

/** Hazards on the segment, multiplying the road type. Riding uphill shows no extra risk. */
export const HAZARD_OR = {
    construction: 1.93,
    tracks: 3.04,               // tram or train tracks
    downhill: 2.32,
};

/** Streets without marked traffic lanes, mostly residential. */
const LOCAL_HIGHWAYS = ["residential", "living_street", "unclassified", "service"];

/** Road type for a cyclist with `infra` and `parked` cars on their side. Every other road with motor
 * traffic is a major street. */
export function routeType(tags: Tags, infra: BikeInfra, parked: boolean, paved: boolean): RouteType {
    const highway = tags.highway;
    if (PATH_HIGHWAYS.includes(highway)) {
        // A path only for bikes is a bike path, not a multi-use path
        const bikeOnly = highway === "cycleway"
            || (highway === "path" && tags.bicycle === "designated" && !["yes", "designated", "permissive"].includes(tags.foot ?? ""));
        if (bikeOnly) return tags.is_sidepath === "yes" ? "cycle_track" : "bike_path";
        // Footways shared with bikes by sign (bicycle=designated) are multi-use paths
        if ((highway === "footway" || highway === "pedestrian") && tags.bicycle !== "designated") return "sidewalk";
        return paved ? "multiuse_paved" : "multiuse_unpaved";
    }

    if (infra === "track") return "cycle_track";
    if (LOCAL_HIGHWAYS.includes(highway)) {
        return tags.bicycle_road === "yes" || tags.cyclestreet === "yes" ? "local_bike_route" : "local";
    }
    if (infra === "lane") return parked ? "major_parked_lane" : "major_lane";
    if (infra === "shared") return parked ? "major_parked_shared" : "major_shared";
    return parked ? "major_parked" : "major";
}

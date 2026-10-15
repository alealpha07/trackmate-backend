import { PATH_HIGHWAYS } from "./osmTags.js";
import { BikeInfra, RouteType, Tags } from "../types.js";

// injury risk relative to a major street with parked cars (1.00)
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

// hazards multiply the road type
export const HAZARD_OR = {
    construction: 1.93,
    tracks: 3.04,               // tram or train tracks
    downhill: 2.32,
};

// streets without marked lanes
const LOCAL_HIGHWAYS = ["residential", "living_street", "unclassified", "service"];

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

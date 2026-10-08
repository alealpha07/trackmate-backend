import { BikeInfra, PATH_HIGHWAYS, Tags } from "./osmTags";

/** Teschke et al. 2012, "Route infrastructure and the risk of injuries to bicyclists: a
 * case-crossover study", AJPH 102(12). Route types as defined in its Table 1. */
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

/** Adjusted odds ratios (OR) of injury, Table 4. An OR compares the odds of an injury on this kind
 * of road with the odds on the reference, a major street with parked cars and no bike
 * infrastructure (OR 1.00):
 * - 1.00: same risk as the reference; below 1: safer (0.11 is about 1/9 of the risk, 89% less);
 *   above 1: more dangerous (1.93 is almost twice the risk). 0 would be no risk at all, and there
 *   is no upper bound, so the scale is not 0-1.
 * - The two numbers in each comment are the 95% confidence interval: the true value very likely
 *   lies in that range. When it includes 1 (e.g. bike path 0.20-1.76) the study could not show
 *   that the road type differs from the reference at all; 0.59 is still its best estimate.
 * Injuries are rare, so OR ≈ relative risk, and all ORs come from one joint model, so route type
 * and hazards multiply (a local street under construction: 0.51 · 1.93 ≈ 0.98). */
export const ROUTE_TYPE_OR: Record<RouteType, number> = {
    cycle_track: 0.11,          // (0.02, 0.54)
    local_bike_route: 0.49,     // (0.26, 0.90) local street, designated bike route
    local: 0.51,                // (0.31, 0.84) local street, no bike infrastructure
    major_lane: 0.54,           // (0.29, 1.01) major street, no parked cars, bike lane
    bike_path: 0.59,            // (0.20, 1.76)
    major_shared: 0.60,         // (0.21, 1.72) major street, no parked cars, shared lane
    major: 0.63,                // (0.41, 0.96) major street, no parked cars, no bike infrastructure
    major_parked_lane: 0.69,    // (0.32, 1.48)
    major_parked_shared: 0.71,  // (0.21, 2.45)
    multiuse_unpaved: 0.73,     // (0.23, 2.28)
    multiuse_paved: 0.79,       // (0.43, 1.48)
    sidewalk: 0.87,             // (0.47, 1.58) sidewalk or other pedestrian path
    major_parked: 1.00,         // reference
};

/** Hazards on the segment, same table. Not applied yet: downhill grade 2.32 (1.72, 3.13) needs
 * elevation data. */
export const HAZARD_OR = {
    construction: 1.93,         // (1.27, 2.94)
    tracks: 3.04,               // (1.80, 5.11) streetcar or train tracks
};

/** Teschke's local streets: no demarcated motor traffic lanes, mostly residential. */
const LOCAL_HIGHWAYS = ["residential", "living_street", "unclassified", "service"];

/** Teschke route type of a way for a cyclist with `infra` and `parked` cars on their side. Major
 * streets are everything else that has motor traffic (primary, secondary, tertiary, their links,
 * and trunk or motorway where bikes are allowed). */
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

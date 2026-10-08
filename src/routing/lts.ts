import { BikeInfra, Direction, PATH_HIGHWAYS, Tags, carDirection, lanesPerDirection, maxspeedKmh, totalLanes } from "./osmTags";

/** Level of Traffic Stress, 1 (anyone would ride it) to 4 (only the strong and fearless). */
export type Lts = 1 | 2 | 3 | 4;

/** Posted limits are in mph in the report: round to the nearest 5 mph, so 50 km/h (31 mph) is
 * read as 30 mph, 60 km/h (37 mph) as 35 mph and 70 km/h (43 mph) as 40+ mph. */
function speedMph(tags: Tags, direction: Direction): number {
    return Math.round(maxspeedKmh(tags, direction) / 1.609344 / 5) * 5;
}

/** LTS of a road segment riding in `direction`, after Mekuria, Furth, Nixon 2012
 * ("Low-Stress Bicycling and Network Connectivity", MTI report 11-19), segment criteria.
 * Each criterion sets a floor and the worst one wins (p. 18). Bike lane width and blockage
 * are rarely mapped and are left out; missing speed limits and lane counts use the defaults in
 * config.ts. Only used by the "avoid LTS 4" filter. */
export function levelOfTrafficStress(tags: Tags, direction: Direction, infra: BikeInfra, parked: boolean): Lts {
    // Physically separated from motor traffic: paths, cycle tracks (p. 17)
    if (PATH_HIGHWAYS.includes(tags.highway) || infra === "track") return 1;

    const mph = speedMph(tags, direction);
    if (infra === "lane") {
        const lanes = lanesPerDirection(tags, direction);
        if (parked) {
            // Table 2 (p. 18): bike lane alongside a parking lane
            const width: Lts = lanes >= 2 ? 3 : 1;
            const speed: Lts = mph <= 25 ? 1 : mph <= 30 ? 2 : mph <= 35 ? 3 : 4;
            return Math.max(width, speed) as Lts;
        }
        // Table 3 (p. 18): bike lane not alongside a parking lane. The two directions of a divided road
        // are mapped as two one-way ways, so a one-way way counts as separated by a median
        const width: Lts = lanes === 1 ? 1 : lanes === 2 && carDirection(tags) ? 2 : 3;
        const speed: Lts = mph <= 30 ? 1 : mph <= 35 ? 3 : 4;
        return Math.max(width, speed) as Lts;
    }

    // Table 4 (p. 21): mixed traffic, shared lane markings included. Street width counts both
    // directions: a one-way way (often one half of a divided road) counts its lanes twice, so two
    // lanes one way are multilane traffic like a 4-lane street
    const lanes = carDirection(tags) ? 2 * totalLanes(tags) : totalLanes(tags);
    // Lower value "for streets without marked centerlines or classified as residential and with
    // fewer than 3 lanes". Like the report, the street class stands in for the centerline
    const lower = tags.lane_markings === "no" || (["residential", "living_street", "service"].includes(tags.highway) && lanes < 3);
    if (mph <= 25) return lanes <= 3 ? (lower ? 1 : 2) : lanes <= 5 ? 3 : 4;
    if (mph <= 30) return lanes <= 3 ? (lower ? 2 : 3) : 4;
    return 4;
}

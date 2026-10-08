import { BikeInfra, Direction, PATH_HIGHWAYS, Tags, carDirection, lanesPerDirection, maxspeedKmh, totalLanes } from "./osmTags";

/** Level of Traffic Stress, 1 (anyone would ride it) to 4 (only the strong and fearless). */
export type Lts = 1 | 2 | 3 | 4;

/** The criteria use mph steps: 50 km/h counts as 30 mph, 60 as 35, 70 as 40+. */
function speedMph(tags: Tags, direction: Direction): number {
    return Math.round(maxspeedKmh(tags, direction) / 1.609344 / 5) * 5;
}

/** Traffic stress riding in `direction`, from the criteria of Mekuria 2012: each criterion sets a
 * floor and the worst one wins. Bike lane width and blockage are rarely mapped and are left out. */
export function levelOfTrafficStress(tags: Tags, direction: Direction, infra: BikeInfra, parked: boolean): Lts {
    // Separated from motor traffic
    if (PATH_HIGHWAYS.includes(tags.highway) || infra === "track") return 1;

    const mph = speedMph(tags, direction);
    if (infra === "lane") {
        const lanes = lanesPerDirection(tags, direction);
        if (parked) {
            // Bike lane next to parked cars
            const width: Lts = lanes >= 2 ? 3 : 1;
            const speed: Lts = mph <= 25 ? 1 : mph <= 30 ? 2 : mph <= 35 ? 3 : 4;
            return Math.max(width, speed) as Lts;
        }
        // Bike lane without parked cars. A divided road is mapped as two one-way ways, so one-way counts as divided
        const width: Lts = lanes === 1 ? 1 : lanes === 2 && carDirection(tags) ? 2 : 3;
        const speed: Lts = mph <= 30 ? 1 : mph <= 35 ? 3 : 4;
        return Math.max(width, speed) as Lts;
    }

    // Mixed traffic. Street width counts both directions: a one-way way, often half of a divided road,
    // counts its lanes twice
    const lanes = carDirection(tags) ? 2 * totalLanes(tags) : totalLanes(tags);
    // Lower stress without a centerline; the street class stands in for it, as centerlines are rarely mapped
    const lower = tags.lane_markings === "no" || (["residential", "living_street", "service"].includes(tags.highway) && lanes < 3);
    if (mph <= 25) return lanes <= 3 ? (lower ? 1 : 2) : lanes <= 5 ? 3 : 4;
    if (mph <= 30) return lanes <= 3 ? (lower ? 2 : 3) : 4;
    return 4;
}

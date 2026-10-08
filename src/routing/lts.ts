import { BikeInfra, Direction, PATH_HIGHWAYS, Tags, carDirection, lanesPerDirection, maxspeedKmh, totalLanes } from "./osmTags";

// level of traffic stress, 1 to 4
export type Lts = 1 | 2 | 3 | 4;

// the criteria use mph steps
function speedMph(tags: Tags, direction: Direction): number {
    return Math.round(maxspeedKmh(tags, direction) / 1.609344 / 5) * 5;
}

// traffic stress for a direction, the worst criterion wins
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
        // bike lane without parked cars, one-way counts as divided
        const width: Lts = lanes === 1 ? 1 : lanes === 2 && carDirection(tags) ? 2 : 3;
        const speed: Lts = mph <= 30 ? 1 : mph <= 35 ? 3 : 4;
        return Math.max(width, speed) as Lts;
    }

    // mixed traffic
    const lanes = carDirection(tags) ? 2 * totalLanes(tags) : totalLanes(tags);
    // no centerline data, the street class stands in
    const lower = tags.lane_markings === "no" || (["residential", "living_street", "service"].includes(tags.highway) && lanes < 3);
    if (mph <= 25) return lanes <= 3 ? (lower ? 1 : 2) : lanes <= 5 ? 3 : 4;
    if (mph <= 30) return lanes <= 3 ? (lower ? 2 : 3) : 4;
    return 4;
}

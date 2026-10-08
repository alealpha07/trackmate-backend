import { DEFAULT_LANES, DEFAULT_MAXSPEED_KMH } from "./config";

export type Tags = Record<string, string>;

/** Which way an edge runs along its OSM way: forward follows the order of the way's nodes. */
export type Direction = "forward" | "backward";

/** Bike infrastructure on the cyclist's side of a road, best first. */
export type BikeInfra = "track" | "lane" | "shared" | "none";

const INFRA_RANK: Record<BikeInfra, number> = { track: 3, lane: 2, shared: 1, none: 0 };

/** Ways without motor traffic, physically separated from roads. */
export const PATH_HIGHWAYS = ["cycleway", "path", "track", "bridleway", "footway", "pedestrian"];

const BIKE_ALLOWED = ["yes", "designated", "permissive"];

export function bicycleAllowed(tags: Tags): boolean {
    return BIKE_ALLOWED.includes(tags.bicycle ?? "");
}

/** The side of the way a cyclist rides on in this direction. Right-hand traffic (Italy): riding
 * forward the right side, riding backward the left side of the way. */
function side(direction: Direction): "right" | "left" {
    return direction === "forward" ? "right" : "left";
}

/** Direction motor traffic is limited to, null on two-way roads. Roundabouts are one-way unless
 * tagged otherwise. */
export function carDirection(tags: Tags): Direction | null {
    const oneway = tags.oneway;
    if (oneway === "-1") return "backward";
    if (oneway === "yes" || oneway === "true" || oneway === "1") return "forward";
    if (oneway === "no") return null;
    if (tags.junction === "roundabout" || tags.junction === "circular" || tags.highway === "motorway") return "forward";
    return null;
}

/** Direction bikes are limited to, null when both are allowed. Bikes are often exempt from a car
 * oneway restriction (contraflow cycling): `oneway:bicycle=no`, "opposite" lanes, or a side
 * lane running against the traffic. */
export function bicycleDirection(tags: Tags): Direction | null {
    const own = tags["oneway:bicycle"];
    if (own === "no") return null;
    if (own === "yes" || own === "true" || own === "1") return "forward";
    if (own === "-1") return "backward";
    const cars = carDirection(tags);
    if (cars === null) return null;
    const contraflow = tags.cycleway?.startsWith("opposite") || ["left", "right"].some((s) =>
        tags[`cycleway:${s}`]?.startsWith("opposite") || ["-1", "no"].includes(tags[`cycleway:${s}:oneway`] ?? ""));
    return contraflow ? null : cars;
}

function infraOf(value: string | undefined): BikeInfra {
    switch (value) {
        case "track":
        case "opposite_track":
            return "track";
        case "lane":
        case "opposite_lane":
            return "lane";
        // Teschke's "shared lane" includes shared bike-bus lanes (Table 1)
        case "shared_lane":
        case "share_busway":
        case "opposite_share_busway":
            return "shared";
        default:
            return "none";
    }
}

/** Best bike infrastructure available riding in `direction`, from the `cycleway[:side]` tags. */
export function bikeInfra(tags: Tags, direction: Direction): BikeInfra {
    const own = side(direction);
    const other = own === "right" ? "left" : "right";
    const cars = carDirection(tags);
    const plain = tags.cycleway;
    const opposite = plain?.startsWith("opposite") ?? false;

    let values: (string | undefined)[];
    if (cars === null) {
        values = [tags[`cycleway:${own}`], tags["cycleway:both"], plain];
    } else if (cars === direction) {
        // With the traffic of a one-way road a lane on either side can be used, unless it is the contraflow one
        const otherOneway = tags[`cycleway:${other}:oneway`];
        values = [
            tags[`cycleway:${own}`],
            tags["cycleway:both"],
            opposite ? undefined : plain,
            otherOneway === "-1" || otherOneway === "no" ? undefined : tags[`cycleway:${other}`],
        ];
    } else {
        // Contraflow on a one-way road
        values = [tags[`cycleway:${own}`], opposite ? plain : undefined];
    }
    return values.map(infraOf).reduce((best, infra) => (INFRA_RANK[infra] > INFRA_RANK[best] ? infra : best), "none");
}

const NO_PARKING = ["no", "none", "no_parking", "no_stopping", "fire_lane"];

/** Parked cars on the cyclist's side (Teschke's "parked cars", Table 4 note a). Both the current
 * `parking:<side>` scheme and the older `parking:lane:<side>` one are read. Untagged: assumed
 * parked, which is Teschke's reference (OR 1.00), so missing data never makes a road look safer. */
export function hasParkedCars(tags: Tags, direction: Direction): boolean {
    const own = side(direction);
    for (const key of [`parking:${own}`, "parking:both", `parking:lane:${own}`, "parking:lane:both"]) {
        const value = tags[key];
        if (value !== undefined) return !NO_PARKING.includes(value);
    }
    return true;
}

// OSM wiki, Key:surface, "unpaved" values
const UNPAVED_SURFACES = [
    "unpaved", "compacted", "fine_gravel", "gravel", "rock", "pebblestone", "ground", "dirt", "earth",
    "grass", "grass_paver", "mud", "sand", "woodchips", "stepping_stones", "snow", "ice", "salt",
];

/** From `surface`, else `tracktype` (only grade1 is paved), else the usual surface of the way type:
 * tracks and bridleways unpaved, paths unpaved unless they are designated for bikes. */
export function isPaved(tags: Tags): boolean {
    if (tags.surface) return !UNPAVED_SURFACES.includes(tags.surface);
    if (tags.tracktype) return tags.tracktype === "grade1";
    if (tags.highway === "track" || tags.highway === "bridleway") return false;
    if (tags.highway === "path") return tags.bicycle === "designated";
    return true;
}

/** Road works on a road that is still open. `highway=construction` (closed) is never routable. */
export function hasConstruction(tags: Tags): boolean {
    return tags.construction !== undefined && tags.construction !== "no";
}

/** Speed limit in km/h from a `maxspeed`-style value: a number, "30 mph", or an implicit limit
 * such as "IT:urban" or "DE:zone30". Only the LTS band (up to 25, 30, 35, 40+ mph) matters, so
 * the implicit limits are approximate: urban 50, rural 90 (CdS art. 142, other roads outside towns). */
function parseSpeed(value: string | undefined): number | null {
    if (!value) return null;
    const text = value.trim().toLowerCase();
    const number = text.match(/^(\d+(?:\.\d+)?)\s*(mph)?$/);
    if (number) return Number(number[1]) * (number[2] ? 1.609344 : 1);
    if (text === "walk") return 7;
    if (text === "none") return 130;
    const zone = text.match(/zone:?(\d+)$/);
    if (zone) return Number(zone[1]);
    const implicit: Record<string, number> = {
        urban: 50, rural: 90, motorway: 130, trunk: 110, living_street: 20, bicycle_road: 30,
    };
    return implicit[text.split(":").pop()!] ?? null;
}

/** Speed limit riding in `direction`, in km/h. Missing: DEFAULT_MAXSPEED_KMH. */
export function maxspeedKmh(tags: Tags, direction: Direction): number {
    for (const key of [`maxspeed:${direction}`, "maxspeed", "maxspeed:type", "source:maxspeed", "zone:maxspeed"]) {
        const speed = parseSpeed(tags[key]);
        if (speed !== null) return speed;
    }
    return DEFAULT_MAXSPEED_KMH;
}

function positiveInt(value: string | undefined): number | null {
    const n = parseInt(value ?? "", 10);
    return n > 0 ? n : null;
}

/** Motor traffic lanes in both directions. Missing: DEFAULT_LANES, or 1 on a one-way road. */
export function totalLanes(tags: Tags): number {
    return positiveInt(tags.lanes) ?? (carDirection(tags) ? 1 : DEFAULT_LANES);
}

/** Through lanes next to a cyclist riding in `direction` (Mekuria Tables 2-3, "per direction"). */
export function lanesPerDirection(tags: Tags, direction: Direction): number {
    const total = totalLanes(tags);
    // One-way: every lane goes the same way (or comes towards a contraflow cyclist)
    if (carDirection(tags)) return total;
    return positiveInt(tags[`lanes:${direction}`]) ?? Math.max(1, Math.floor(total / 2));
}

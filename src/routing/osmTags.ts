import { driveSide, featuresContaining } from "@rapideditor/country-coder";
import { DEFAULT_LANES, DEFAULT_MAXSPEED_KMH } from "./config";
import { BBox } from "./types";

export type Tags = Record<string, string>;

/** forward follows the order of the way's nodes. */
export type Direction = "forward" | "backward";

/** Bike infrastructure on the cyclist's side of a road, best first. */
export type BikeInfra = "track" | "lane" | "shared" | "none";

const INFRA_RANK: Record<BikeInfra, number> = { track: 3, lane: 2, shared: 1, none: 0 };

/** Ways without motor traffic. */
export const PATH_HIGHWAYS = ["cycleway", "path", "track", "bridleway", "footway", "pedestrian"];

const BIKE_ALLOWED = ["yes", "designated", "permissive"];

export function bicycleAllowed(tags: Tags): boolean {
    return BIKE_ALLOWED.includes(tags.bicycle ?? "");
}

export type DrivingSide = "right" | "left";

/** The side every country in the box drives on, null when it reaches countries driving on both. */
export function drivingSideIn(bbox: BBox): DrivingSide | null {
    const sides = new Set(featuresContaining([bbox.west, bbox.south, bbox.east, bbox.north])
        .map((feature) => feature.properties.driveSide)
        .filter((side) => side !== undefined));
    return sides.size === 1 ? ([...sides][0] as DrivingSide) : null;
}

/** A `driving_side` on the way wins over the country's rule: the graph's when it has one, else the
 * one at the given node. */
export function drivingSide(tags: Tags, graphSide: DrivingSide | null, lat: number, lon: number): DrivingSide {
    if (tags.driving_side === "left" || tags.driving_side === "right") return tags.driving_side;
    return graphSide ?? (driveSide([lon, lat]) === "left" ? "left" : "right");
}

/** The side of the way a cyclist rides on: forward is on the driving side. */
function side(direction: Direction, driving: DrivingSide): DrivingSide {
    const opposite = driving === "right" ? "left" : "right";
    return direction === "forward" ? driving : opposite;
}

/** null on two-way roads. Roundabouts are one-way unless tagged otherwise. */
export function carDirection(tags: Tags): Direction | null {
    const oneway = tags.oneway;
    if (oneway === "-1") return "backward";
    if (oneway === "yes" || oneway === "true" || oneway === "1") return "forward";
    if (oneway === "no") return null;
    if (tags.junction === "roundabout" || tags.junction === "circular" || tags.highway === "motorway") return "forward";
    return null;
}

/** null when both directions are allowed. Bikes are often exempt from a car one-way (contraflow):
 * `oneway:bicycle=no`, "opposite" lanes, or a side lane running against the traffic. */
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
        // Shared bike-bus lanes count as shared lanes
        case "shared_lane":
        case "share_busway":
        case "opposite_share_busway":
            return "shared";
        default:
            return "none";
    }
}

export function bikeInfra(tags: Tags, direction: Direction, driving: DrivingSide): BikeInfra {
    const own = side(direction, driving);
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

/** On the cyclist's side, from the current `parking:<side>` scheme or the older `parking:lane:<side>`.
 * Untagged counts as parked, the riskiest case, so missing data never makes a road look safer. */
export function hasParkedCars(tags: Tags, direction: Direction, driving: DrivingSide): boolean {
    const own = side(direction, driving);
    for (const key of [`parking:${own}`, "parking:both", `parking:lane:${own}`, "parking:lane:both"]) {
        const value = tags[key];
        if (value !== undefined) return !NO_PARKING.includes(value);
    }
    return true;
}

// The OSM wiki's unpaved surface values
const UNPAVED_SURFACES = [
    "unpaved", "compacted", "fine_gravel", "gravel", "rock", "pebblestone", "ground", "dirt", "earth",
    "grass", "grass_paver", "mud", "sand", "woodchips", "stepping_stones", "snow", "ice", "salt",
];

/** Without `surface` or `tracktype`: tracks and bridleways unpaved, paths unpaved unless designated for bikes. */
export function isPaved(tags: Tags): boolean {
    if (tags.surface) return !UNPAVED_SURFACES.includes(tags.surface);
    if (tags.tracktype) return tags.tracktype === "grade1";
    if (tags.highway === "track" || tags.highway === "bridleway") return false;
    if (tags.highway === "path") return tags.bicycle === "designated";
    return true;
}

/** Road works on an open road (`highway=construction` is a closed one, never routable). */
export function hasConstruction(tags: Tags): boolean {
    return tags.construction !== undefined && tags.construction !== "no";
}

/** Rails along the roadway. Crossings come from shared nodes instead (buildGraph.ts). */
export function hasEmbeddedRails(tags: Tags): boolean {
    if (tags.railway === "tram") return true;
    return Object.entries(tags).some(([key, value]) => key.startsWith("embedded_rails") && value !== "no" && /[^|]/.test(value));
}

/** km/h from a number, "30 mph", or an implicit limit such as "IT:urban" or "DE:zone30". Implicit
 * limits are approximate: only the traffic stress band matters. */
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

/** Both directions. Missing: DEFAULT_LANES, or 1 on a one-way road. */
export function totalLanes(tags: Tags): number {
    return positiveInt(tags.lanes) ?? (carDirection(tags) ? 1 : DEFAULT_LANES);
}

export function lanesPerDirection(tags: Tags, direction: Direction): number {
    const total = totalLanes(tags);
    // One-way: every lane goes the same way (or comes towards a contraflow cyclist)
    if (carDirection(tags)) return total;
    return positiveInt(tags[`lanes:${direction}`]) ?? Math.max(1, Math.floor(total / 2));
}

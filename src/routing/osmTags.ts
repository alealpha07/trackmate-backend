import { driveSide, featuresContaining } from "@rapideditor/country-coder";
import { DEFAULT_LANES, DEFAULT_MAXSPEED_KMH } from "./config";
import { BBox } from "./types";

export type Tags = Record<string, string>;

// forward = order of the way's nodes
export type Direction = "forward" | "backward";

// best first
export type BikeInfra = "track" | "lane" | "shared" | "none";

const INFRA_RANK: Record<BikeInfra, number> = { track: 3, lane: 2, shared: 1, none: 0 };

export const PATH_HIGHWAYS = ["cycleway", "path", "track", "bridleway", "footway", "pedestrian"];

const BIKE_ALLOWED = ["yes", "designated", "permissive"];

export function bicycleAllowed(tags: Tags): boolean {
    return BIKE_ALLOWED.includes(tags.bicycle ?? "");
}

export type DrivingSide = "right" | "left";

// null when the box has both driving sides
export function drivingSideIn(bbox: BBox): DrivingSide | null {
    const sides = new Set(featuresContaining([bbox.west, bbox.south, bbox.east, bbox.north])
        .map((feature) => feature.properties.driveSide)
        .filter((side) => side !== undefined));
    return sides.size === 1 ? ([...sides][0] as DrivingSide) : null;
}

// driving_side on the way wins over the country
export function drivingSide(tags: Tags, graphSide: DrivingSide | null, lat: number, lon: number): DrivingSide {
    if (tags.driving_side === "left" || tags.driving_side === "right") return tags.driving_side;
    return graphSide ?? (driveSide([lon, lat]) === "left" ? "left" : "right");
}

function side(direction: Direction, driving: DrivingSide): DrivingSide {
    const opposite = driving === "right" ? "left" : "right";
    return direction === "forward" ? driving : opposite;
}

// null on two-way roads, roundabouts are one-way
export function carDirection(tags: Tags): Direction | null {
    const oneway = tags.oneway;
    if (oneway === "-1") return "backward";
    if (oneway === "yes" || oneway === "true" || oneway === "1") return "forward";
    if (oneway === "no") return null;
    if (tags.junction === "roundabout" || tags.junction === "circular" || tags.highway === "motorway") return "forward";
    return null;
}

// bikes are often exempt from a car one-way (contraflow)
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
        // on a one-way road any side lane works, except contraflow
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

// untagged parking counts as parked, the riskiest case
export function hasParkedCars(tags: Tags, direction: Direction, driving: DrivingSide): boolean {
    const own = side(direction, driving);
    for (const key of [`parking:${own}`, "parking:both", `parking:lane:${own}`, "parking:lane:both"]) {
        const value = tags[key];
        if (value !== undefined) return !NO_PARKING.includes(value);
    }
    return true;
}

// unpaved surface values from the OSM wiki
const UNPAVED_SURFACES = [
    "unpaved", "compacted", "fine_gravel", "gravel", "rock", "pebblestone", "ground", "dirt", "earth",
    "grass", "grass_paver", "mud", "sand", "woodchips", "stepping_stones", "snow", "ice", "salt",
];

// no surface or tracktype: tracks unpaved, paths unpaved unless for bikes
export function isPaved(tags: Tags): boolean {
    if (tags.surface) return !UNPAVED_SURFACES.includes(tags.surface);
    if (tags.tracktype) return tags.tracktype === "grade1";
    if (tags.highway === "track" || tags.highway === "bridleway") return false;
    if (tags.highway === "path") return tags.bicycle === "designated";
    return true;
}

// highway=construction is closed, never routable
export function hasConstruction(tags: Tags): boolean {
    return tags.construction !== undefined && tags.construction !== "no";
}

export function hasEmbeddedRails(tags: Tags): boolean {
    if (tags.railway === "tram") return true;
    return Object.entries(tags).some(([key, value]) => key.startsWith("embedded_rails") && value !== "no" && /[^|]/.test(value));
}

// km/h from a number, mph or an implicit limit like IT:urban
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

// both directions
export function totalLanes(tags: Tags): number {
    return positiveInt(tags.lanes) ?? (carDirection(tags) ? 1 : DEFAULT_LANES);
}

export function lanesPerDirection(tags: Tags, direction: Direction): number {
    const total = totalLanes(tags);
    if (carDirection(tags)) return total;
    return positiveInt(tags[`lanes:${direction}`]) ?? Math.max(1, Math.floor(total / 2));
}

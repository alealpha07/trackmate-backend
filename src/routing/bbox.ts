import { BBOX_BUFFER_METERS } from "./config";
import { EARTH_RADIUS_METERS, toRadians } from "./haversine";
import { BBox, LatLng, OverpassElement } from "./types";

const METERS_PER_DEGREE_LAT = (Math.PI * EARTH_RADIUS_METERS) / 180;

export function planningBBox(start: LatLng, end: LatLng, bufferMeters = BBOX_BUFFER_METERS): BBox {
    const deltaLat = bufferMeters / METERS_PER_DEGREE_LAT;
    // The latitude farthest from the equator, so the longitude buffer is never too small
    const farthestLat = Math.min(89, Math.max(Math.abs(start.lat), Math.abs(end.lat)) + deltaLat);
    const deltaLon = bufferMeters / (METERS_PER_DEGREE_LAT * Math.cos(toRadians(farthestLat)));

    return {
        south: Math.min(start.lat, end.lat) - deltaLat,
        north: Math.max(start.lat, end.lat) + deltaLat,
        west: Math.min(start.lng, end.lng) - deltaLon,
        east: Math.max(start.lng, end.lng) + deltaLon,
    };
}

/** The box grown to every node: ways reach out of the box they were fetched for. */
export function nodeExtent(elements: OverpassElement[], bbox: BBox): BBox {
    const extent = { ...bbox };
    for (const el of elements) {
        if (el.type !== "node") continue;
        extent.south = Math.min(extent.south, el.lat);
        extent.north = Math.max(extent.north, el.lat);
        extent.west = Math.min(extent.west, el.lon);
        extent.east = Math.max(extent.east, el.lon);
    }
    return extent;
}

import { BBOX_BUFFER_METERS } from "./config";
import { EARTH_RADIUS_METERS, toRadians } from "./haversine";
import { BBox, LatLng } from "./types";

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

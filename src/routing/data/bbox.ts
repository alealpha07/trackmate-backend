import { BBOX_BUFFER_METERS, TILE_SIZE_DEG } from "../config.js";
import { EARTH_RADIUS_METERS, toRadians } from "../haversine.js";
import { BBox, LatLng, OverpassElement } from "../types.js";

const METERS_PER_DEGREE_LAT = (Math.PI * EARTH_RADIUS_METERS) / 180;

export function planningBBox(start: LatLng, end: LatLng, bufferMeters = BBOX_BUFFER_METERS): BBox {
    const deltaLat = bufferMeters / METERS_PER_DEGREE_LAT;
    // use the latitude farthest from the equator
    const farthestLat = Math.min(89, Math.max(Math.abs(start.lat), Math.abs(end.lat)) + deltaLat);
    const deltaLon = bufferMeters / (METERS_PER_DEGREE_LAT * Math.cos(toRadians(farthestLat)));

    return {
        south: Math.min(start.lat, end.lat) - deltaLat,
        north: Math.max(start.lat, end.lat) + deltaLat,
        west: Math.min(start.lng, end.lng) - deltaLon,
        east: Math.max(start.lng, end.lng) + deltaLon,
    };
}

// the map tiles around the box: nodes of long roads beyond them only cost DEM downloads, and count as flat
export function elevationExtent(elements: OverpassElement[], bbox: BBox): BBox {
    const extent = nodeExtent(elements, bbox);
    // a hair inside, so 44.99999999 never asks for the DEM tile south of 45
    const inside = 1e-9;
    return {
        south: Math.max(extent.south, Math.floor(bbox.south / TILE_SIZE_DEG) * TILE_SIZE_DEG + inside),
        north: Math.min(extent.north, (Math.floor(bbox.north / TILE_SIZE_DEG) + 1) * TILE_SIZE_DEG - inside),
        west: Math.max(extent.west, Math.floor(bbox.west / TILE_SIZE_DEG) * TILE_SIZE_DEG + inside),
        east: Math.min(extent.east, (Math.floor(bbox.east / TILE_SIZE_DEG) + 1) * TILE_SIZE_DEG - inside),
    };
}

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

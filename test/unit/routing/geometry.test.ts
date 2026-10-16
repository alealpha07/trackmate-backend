import { describe, expect, test } from "vitest";
import { haversineMeters } from "../../../src/routing/haversine.js";
import { elevationExtent, nodeExtent, planningBBox } from "../../../src/routing/data/bbox.js";
import { tilesFor } from "../../../src/routing/data/tileCache.js";
import { BBOX_BUFFER_METERS } from "../../../src/routing/config.js";

describe("haversineMeters", () => {
    test("a degree of latitude", () => {
        expect(haversineMeters(44, 10, 45, 10)).toBeCloseTo(111_195, 0);
    });

    test("zero and symmetric", () => {
        expect(haversineMeters(44.8, 10.33, 44.8, 10.33)).toBe(0);
        expect(haversineMeters(44.8, 10.33, 45.46, 9.19)).toBeCloseTo(haversineMeters(45.46, 9.19, 44.8, 10.33));
    });
});

describe("planningBBox", () => {
    const start = { lat: 44.8, lng: 10.3 };
    const end = { lat: 44.82, lng: 10.35 };
    const box = planningBBox(start, end);

    test("covers both points with the buffer on every side", () => {
        expect(haversineMeters(box.south, start.lng, start.lat, start.lng)).toBeCloseTo(BBOX_BUFFER_METERS, -1);
        expect(haversineMeters(end.lat, end.lng, box.north, end.lng)).toBeCloseTo(BBOX_BUFFER_METERS, -1);
        expect(haversineMeters(start.lat, box.west, start.lat, start.lng)).toBeGreaterThanOrEqual(BBOX_BUFFER_METERS);
        expect(haversineMeters(end.lat, end.lng, end.lat, box.east)).toBeGreaterThanOrEqual(BBOX_BUFFER_METERS);
    });

    test("the same box either way", () => {
        expect(planningBBox(end, start)).toEqual(box);
    });
});

describe("nodeExtent", () => {
    test("grows to include nodes outside the box", () => {
        const box = { south: 44, west: 10, north: 45, east: 11 };
        const extent = nodeExtent([
            { type: "node", id: 1, lat: 45.5, lon: 10.5 },
            { type: "node", id: 2, lat: 44.5, lon: 9.5 },
            { type: "way", id: 3, nodes: [1, 2] },
        ], box);
        expect(extent).toEqual({ south: 44, west: 9.5, north: 45.5, east: 11 });
    });
});

describe("elevationExtent", () => {
    test("stops at the map tiles, so a long road leaving them pulls in no extra DEM tile", () => {
        const box = { south: 45.02, west: 7.6, north: 45.08, east: 7.7 };
        const extent = elevationExtent([
            { type: "node", id: 1, lat: 44.5, lon: 7.65 },
            { type: "node", id: 2, lat: 45.09, lon: 7.65 },
        ], box);
        expect(extent.south).toBeCloseTo(45, 6);
        expect(Math.floor(extent.south)).toBe(45);
        expect(extent.north).toBe(45.09);
        expect(extent.west).toBe(7.6);
    });
});

describe("tilesFor", () => {
    test("tiles of 0.05 degrees, numbered from the south-west corner", () => {
        expect(tilesFor({ south: 44.81, west: 10.31, north: 44.82, east: 10.32 })).toEqual([{ x: 206, y: 896 }]);
        expect(tilesFor({ south: 44.79, west: 10.29, north: 44.81, east: 10.31 })).toHaveLength(4);
    });
});

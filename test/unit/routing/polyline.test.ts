import { describe, expect, test } from "vitest";
import { cumulativeMeters, decodePolyline6, encodePolyline6, traceShape } from "../../../src/routing/instructions/polyline.js";
import { haversineMeters } from "../../../src/routing/haversine.js";
import { nodeAt } from "../../helpers/graph.js";

const at = (x: number, y: number) => {
    const { lat, lon } = nodeAt(x, y);
    return { lat, lng: lon };
};

describe("polyline6", () => {
    test("known values", () => {
        expect(encodePolyline6([{ lat: 0, lng: 0 }])).toBe("??");
        expect(encodePolyline6([{ lat: 0.000001, lng: -0.000001 }])).toBe("A@");
    });

    test("round trip at six decimals", () => {
        const points = [{ lat: 44.801234, lng: 10.328765 }, { lat: 44.79, lng: 10.4 }, { lat: -33.8688, lng: 151.2093 }];
        expect(decodePolyline6(encodePolyline6(points))).toEqual(points);
        expect(decodePolyline6("")).toEqual([]);
    });
});

describe("traceShape", () => {
    test("drops points closer than 10 m, keeps the ends", () => {
        const points = Array.from({ length: 101 }, (_, i) => at(i, 0));
        const shape = traceShape(points);
        expect(shape[0]).toEqual(points[0]);
        expect(shape[shape.length - 1]).toEqual(points[100]);
        expect(shape.length).toBeLessThanOrEqual(11);
        for (let i = 1; i < shape.length - 1; i++) {
            expect(haversineMeters(shape[i - 1].lat, shape[i - 1].lng, shape[i].lat, shape[i].lng)).toBeGreaterThanOrEqual(10);
        }
    });

    test("fills gaps longer than 1 km", () => {
        const shape = traceShape([at(0, 0), at(2500, 0)]);
        expect(shape).toHaveLength(4);
        for (let i = 1; i < shape.length; i++) {
            expect(haversineMeters(shape[i - 1].lat, shape[i - 1].lng, shape[i].lat, shape[i].lng)).toBeLessThanOrEqual(1000);
        }
    });
});

test("cumulativeMeters", () => {
    const cumulative = cumulativeMeters([at(0, 0), at(100, 0), at(100, 50)]);
    expect(cumulative[0]).toBe(0);
    expect(cumulative[1]).toBeCloseTo(100, 0);
    expect(cumulative[2]).toBeCloseTo(150, 0);
});

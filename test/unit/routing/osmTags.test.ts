import { describe, expect, test } from "vitest";
import {
    bicycleAllowed, bicycleDirection, bikeInfra, carDirection, drivingSide, drivingSideIn, hasConstruction,
    hasEmbeddedRails, hasParkedCars, isPaved, lanesPerDirection, maxspeedKmh, totalLanes,
} from "../../../src/routing/graph/osmTags.js";

describe("access and direction", () => {
    test("bicycleAllowed", () => {
        expect(bicycleAllowed({ bicycle: "designated" })).toBe(true);
        expect(bicycleAllowed({ bicycle: "no" })).toBe(false);
        expect(bicycleAllowed({})).toBe(false);
    });

    test("carDirection", () => {
        expect(carDirection({ oneway: "yes" })).toBe("forward");
        expect(carDirection({ oneway: "1" })).toBe("forward");
        expect(carDirection({ oneway: "-1" })).toBe("backward");
        expect(carDirection({ oneway: "no", junction: "roundabout" })).toBeNull();
        expect(carDirection({ junction: "roundabout" })).toBe("forward");
        expect(carDirection({ highway: "motorway" })).toBe("forward");
        expect(carDirection({ highway: "residential" })).toBeNull();
    });

    test("bicycleDirection follows cars unless bikes may go both ways", () => {
        expect(bicycleDirection({ oneway: "yes" })).toBe("forward");
        expect(bicycleDirection({ oneway: "yes", "oneway:bicycle": "no" })).toBeNull();
        expect(bicycleDirection({ oneway: "yes", cycleway: "opposite_lane" })).toBeNull();
        expect(bicycleDirection({ oneway: "yes", "cycleway:left": "lane", "cycleway:left:oneway": "-1" })).toBeNull();
        expect(bicycleDirection({ "oneway:bicycle": "-1" })).toBe("backward");
    });
});

describe("driving side", () => {
    test("a tag on the way wins", () => {
        expect(drivingSide({ driving_side: "left" }, "right", 44.8, 10.33)).toBe("left");
        expect(drivingSide({}, "right", 51.5, -0.12)).toBe("right");
    });

    test("from the country", () => {
        expect(drivingSide({}, null, 51.5, -0.12)).toBe("left");
        expect(drivingSideIn({ south: 44.7, west: 10.2, north: 44.9, east: 10.4 })).toBe("right");
        expect(drivingSideIn({ south: 51.4, west: -0.3, north: 51.6, east: 0.1 })).toBe("left");
    });
});

describe("bikeInfra", () => {
    test("a lane on one side of a two-way road counts in its direction only", () => {
        const tags = { highway: "primary", "cycleway:right": "lane" };
        expect(bikeInfra(tags, "forward", "right")).toBe("lane");
        expect(bikeInfra(tags, "backward", "right")).toBe("none");
        expect(bikeInfra(tags, "backward", "left")).toBe("lane");
    });

    test("the best of several tags", () => {
        expect(bikeInfra({ cycleway: "shared_lane", "cycleway:both": "track" }, "forward", "right")).toBe("track");
    });

    test("one-way roads: any side lane with traffic, only contraflow against it", () => {
        expect(bikeInfra({ oneway: "yes", "cycleway:left": "lane" }, "forward", "right")).toBe("lane");
        expect(bikeInfra({ oneway: "yes", "cycleway:left": "lane" }, "backward", "right")).toBe("lane");
        expect(bikeInfra({ oneway: "yes", cycleway: "lane" }, "backward", "right")).toBe("none");
        expect(bikeInfra({ oneway: "yes", cycleway: "opposite_lane" }, "backward", "right")).toBe("lane");
    });
});

describe("hazards and surface", () => {
    test("untagged parking counts as parked cars", () => {
        expect(hasParkedCars({}, "forward", "right")).toBe(true);
        expect(hasParkedCars({ "parking:right": "no" }, "forward", "right")).toBe(false);
        expect(hasParkedCars({ "parking:right": "no" }, "backward", "right")).toBe(true);
        expect(hasParkedCars({ "parking:both": "lane" }, "backward", "right")).toBe(true);
    });

    test("isPaved", () => {
        expect(isPaved({ highway: "residential" })).toBe(true);
        expect(isPaved({ highway: "residential", surface: "gravel" })).toBe(false);
        expect(isPaved({ highway: "track" })).toBe(false);
        expect(isPaved({ highway: "track", tracktype: "grade1" })).toBe(true);
        expect(isPaved({ highway: "path" })).toBe(false);
        expect(isPaved({ highway: "path", bicycle: "designated" })).toBe(true);
    });

    test("construction and rails", () => {
        expect(hasConstruction({ construction: "yes" })).toBe(true);
        expect(hasConstruction({ construction: "no" })).toBe(false);
        expect(hasEmbeddedRails({ railway: "tram" })).toBe(true);
        expect(hasEmbeddedRails({ embedded_rails: "tram" })).toBe(true);
        expect(hasEmbeddedRails({ embedded_rails: "no" })).toBe(false);
    });
});

describe("speed and lanes", () => {
    test("maxspeedKmh", () => {
        expect(maxspeedKmh({ maxspeed: "30" }, "forward")).toBe(30);
        expect(maxspeedKmh({ maxspeed: "20 mph" }, "forward")).toBeCloseTo(32.19, 1);
        expect(maxspeedKmh({ maxspeed: "IT:urban" }, "forward")).toBe(50);
        expect(maxspeedKmh({ "maxspeed:type": "DE:zone30" }, "forward")).toBe(30);
        expect(maxspeedKmh({ "zone:maxspeed": "DE:30" }, "forward")).toBe(30);
        expect(maxspeedKmh({ "zone:maxspeed": "DE:urban" }, "forward")).toBe(50);
        expect(maxspeedKmh({ maxspeed: "IT:rural" }, "forward")).toBe(90);
        expect(maxspeedKmh({ "maxspeed:type": "DE:rural" }, "forward")).toBe(100);
        expect(maxspeedKmh({ maxspeed: "walk" }, "forward")).toBe(7);
        expect(maxspeedKmh({ maxspeed: "50", "maxspeed:backward": "30" }, "backward")).toBe(30);
        expect(maxspeedKmh({}, "forward")).toBe(50);
    });

    test("lanes", () => {
        expect(totalLanes({})).toBe(2);
        expect(totalLanes({ oneway: "yes" })).toBe(1);
        expect(totalLanes({ lanes: "4" })).toBe(4);
        expect(lanesPerDirection({ lanes: "4" }, "forward")).toBe(2);
        expect(lanesPerDirection({ lanes: "3", "lanes:forward": "2" }, "forward")).toBe(2);
        expect(lanesPerDirection({ lanes: "2", oneway: "yes" }, "forward")).toBe(2);
    });
});

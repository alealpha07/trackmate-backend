import { describe, expect, test } from "vitest";
import { HAZARD_OR, ROUTE_TYPE_OR, routeType } from "../../../src/routing/graph/riskTable.js";

describe("routeType", () => {
    test("paths", () => {
        expect(routeType({ highway: "cycleway" }, "none", false, true)).toBe("bike_path");
        expect(routeType({ highway: "cycleway", is_sidepath: "yes" }, "none", false, true)).toBe("cycle_track");
        expect(routeType({ highway: "path", bicycle: "designated" }, "none", false, true)).toBe("bike_path");
        expect(routeType({ highway: "path", bicycle: "designated", foot: "designated" }, "none", false, true)).toBe("multiuse_paved");
        expect(routeType({ highway: "footway", bicycle: "yes" }, "none", false, true)).toBe("sidewalk");
        expect(routeType({ highway: "footway", bicycle: "designated" }, "none", false, true)).toBe("multiuse_paved");
        expect(routeType({ highway: "track" }, "none", false, false)).toBe("multiuse_unpaved");
        // next to a major road, as Teschke defines a cycle track
        expect(routeType({ highway: "cycleway" }, "none", false, true, true)).toBe("cycle_track");
        expect(routeType({ highway: "footway", bicycle: "designated", segregated: "yes" }, "none", false, true)).toBe("bike_path");
        expect(routeType({ highway: "path", bicycle: "designated", foot: "designated" }, "none", false, true, true)).toBe("multiuse_paved");
    });

    test("streets", () => {
        expect(routeType({ highway: "residential" }, "none", true, true)).toBe("local");
        expect(routeType({ highway: "residential", bicycle_road: "yes" }, "none", true, true)).toBe("local_bike_route");
        expect(routeType({ highway: "primary" }, "track", true, true)).toBe("cycle_track");
        expect(routeType({ highway: "primary" }, "lane", true, true)).toBe("major_parked_lane");
        expect(routeType({ highway: "primary" }, "lane", false, true)).toBe("major_lane");
        expect(routeType({ highway: "primary" }, "shared", false, true)).toBe("major_shared");
        expect(routeType({ highway: "primary" }, "none", true, true)).toBe("major_parked");
        expect(routeType({ highway: "primary" }, "none", false, true)).toBe("major");
    });
});

describe("risk weights", () => {
    test("relative to a major street with parked cars", () => {
        expect(ROUTE_TYPE_OR.major_parked).toBe(1);
        expect(Math.min(...Object.values(ROUTE_TYPE_OR))).toBe(ROUTE_TYPE_OR.cycle_track);
        for (const hazard of Object.values(HAZARD_OR)) expect(hazard).toBeGreaterThan(1);
    });
});

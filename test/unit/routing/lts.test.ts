import { describe, expect, test } from "vitest";
import { levelOfTrafficStress } from "../../../src/routing/graph/lts.js";

describe("levelOfTrafficStress", () => {
    test("separated from traffic is LTS 1", () => {
        expect(levelOfTrafficStress({ highway: "cycleway" }, "forward", "none", false)).toBe(1);
        expect(levelOfTrafficStress({ highway: "primary", maxspeed: "70" }, "forward", "track", true)).toBe(1);
    });

    test("mixed traffic", () => {
        expect(levelOfTrafficStress({ highway: "residential", maxspeed: "30" }, "forward", "none", true)).toBe(1);
        expect(levelOfTrafficStress({ highway: "tertiary", maxspeed: "30" }, "forward", "none", true)).toBe(2);
        expect(levelOfTrafficStress({ highway: "primary", maxspeed: "50" }, "forward", "none", true)).toBe(3);
        expect(levelOfTrafficStress({ highway: "primary", maxspeed: "30", lanes: "4" }, "forward", "none", true)).toBe(3);
        expect(levelOfTrafficStress({ highway: "primary", maxspeed: "30", lanes: "6" }, "forward", "none", true)).toBe(4);
        expect(levelOfTrafficStress({ highway: "primary", maxspeed: "70" }, "forward", "none", true)).toBe(4);
    });

    test("bike lanes", () => {
        expect(levelOfTrafficStress({ highway: "primary", maxspeed: "50" }, "forward", "lane", false)).toBe(1);
        expect(levelOfTrafficStress({ highway: "primary", maxspeed: "50" }, "forward", "lane", true)).toBe(2);
        expect(levelOfTrafficStress({ highway: "primary", maxspeed: "50", lanes: "4" }, "forward", "lane", false)).toBe(3);
        expect(levelOfTrafficStress({ highway: "primary", maxspeed: "70" }, "forward", "lane", false)).toBe(4);
    });
});

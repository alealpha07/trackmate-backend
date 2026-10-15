import { describe, expect, test, vi } from "vitest";
import { planRoute, PlanOptions } from "../../../src/routing/plan.js";
import { haversineMeters } from "../../../src/routing/haversine.js";
import { DISPLAY_CYCLING_SPEED_KMH } from "../../../src/routing/config.js";
import { LatLng, PlannedRoute } from "../../../src/routing/types.js";

// inside the fixture tiles, where Safest takes a longer and safer way
const START = { lat: 44.7815, lng: 9.846 };
const END = { lat: 44.7815, lng: 9.856 };
const STOP = { lat: 44.776, lng: 9.856 };

async function plan(points: LatLng[], options: Partial<PlanOptions> = {}): Promise<PlannedRoute> {
    const route = await planRoute(points, { policy: "shortest", filters: {}, ...options }, new AbortController().signal);
    if ("unreachableLeg" in route) throw new Error(`unreachable leg ${route.unreachableLeg}`);
    return route;
}

const meters = (a: LatLng, b: LatLng) => haversineMeters(a.lat, a.lng, b.lat, b.lng);

describe("planRoute on the fixture tiles", () => {
    test("shortest: a track from start to end", async () => {
        const route = await plan([START, END]);
        expect(route.distance).toBeGreaterThan(meters(START, END));
        expect(route.duration).toBeCloseTo(route.distance / (DISPLAY_CYCLING_SPEED_KMH / 3.6));
        expect(meters(route.track[0], START)).toBeLessThan(300);
        expect(meters(route.track[route.track.length - 1], END)).toBeLessThan(300);
        expect(route.legs).toHaveLength(1);
        expect(route.legs[0]).toMatchObject({ distance: route.distance, risk: route.risk });
    });

    test("safest: longer and less risky than shortest", async () => {
        const shortest = await plan([START, END]);
        const safest = await plan([START, END], { policy: "safest" });
        expect(safest.distance).toBeGreaterThan(shortest.distance);
        expect(safest.risk).toBeLessThan(shortest.risk);
    });

    test("a detour limit keeps safest within it", async () => {
        const shortest = await plan([START, END]);
        const safest = await plan([START, END], { policy: "safest" });
        const capped = await plan([START, END], { policy: "safest", maxDetour: 10 });
        expect(capped.distance).toBeLessThanOrEqual(shortest.distance * 1.1);
        expect(capped.risk).toBeLessThanOrEqual(shortest.risk);
        expect(capped.risk).toBeGreaterThanOrEqual(safest.risk);
        // shortest ignores the limit
        expect((await plan([START, END], { maxDetour: 10 })).distance).toBe(shortest.distance);
    });

    test("filters add their stats", async () => {
        const route = await plan([START, END], { filters: { avoidUnpaved: true, avoidLts4: true, cyclewaysOnly: true } });
        expect(route.unpaved).toBeGreaterThanOrEqual(0);
        expect(route.highStress).toBeGreaterThanOrEqual(0);
        expect(route.offBikeways).toBeLessThanOrEqual(route.distance);
        expect((await plan([START, END])).unpaved).toBeUndefined();
    });

    test("stops: one leg each, joined end to end", async () => {
        const route = await plan([START, STOP, END], { policy: "safest" });
        expect(route.legs).toHaveLength(2);
        expect(route.legs[0].to).toEqual(route.legs[1].from);
        expect(route.distance).toBeCloseTo(route.legs[0].distance + route.legs[1].distance);
    });

    test("a missing tile goes to the configured Overpass, never a public one", async () => {
        const fetch = vi.spyOn(globalThis, "fetch");
        const controller = new AbortController();
        const planning = planRoute([START, { lat: 44.7815, lng: 9.95 }], { policy: "shortest", filters: {} }, controller.signal);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
        controller.abort();
        await expect(planning).rejects.toThrow();
        for (const [url] of fetch.mock.calls) expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:9(\/|$)/);
        fetch.mockRestore();
    });
});

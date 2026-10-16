import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { fakeService, FakeReply } from "../helpers/fakeServices.js";
import { Client, signIn } from "../helpers/users.js";
import { binary, text } from "../helpers/data.js";

// 400 fails at once, a 5xx would be retried for a minute
const REFUSED: FakeReply = { status: 400, body: { error: "refused" } };

// tiles outside the fixtures come from here, the url is read when the config loads
const overpass = await fakeService(() => REFUSED);
process.env.OVERPASS_ENDPOINT = overpass.url;
process.env.PLAN_MAX_CONCURRENT = "1";
const { default: app } = await import("../../src/app.js");

// inside the fixture tiles
const START = { lat: 44.7815, lng: 9.846 };
const END = { lat: 44.7815, lng: 9.856 };
// a few km east, where no tile is cached
const OUTSIDE = { lat: 44.7815, lng: 9.95 };

const body = (extra: object = {}) => ({ start: START, end: END, vehicle: "bicycle", policy: "safest", ...extra });
const ndjson = (raw: Buffer) => raw.toString("utf8").trim().split("\n").map((line) => JSON.parse(line));

let users = 0;
// planning is limited to 20 a user, so groups of checks get their own user
const newPlanner = async () => (await signIn(app, `planner${++users}`)).agent;

afterEach(() => {
    overpass.handle = () => REFUSED;
    overpass.requests.length = 0;
    vi.restoreAllMocks();
});

afterAll(() => overpass.close());

describe("POST /route/plan input", () => {
    let planner: Client;
    beforeAll(async () => {
        planner = await newPlanner();
    });

    test("points, vehicle, policy and filters", async () => {
        const plan = (extra: object) => planner.post("/route/plan").send(body(extra));
        await planner.post("/route/plan").send({ start: START }).expect(422, /^Missing required parameters/);
        await plan({ start: { lat: 91, lng: 9 } }).expect(422, text("en", "route.errors.coordinates"));
        await plan({ end: { lat: "x", lng: 9 } }).expect(422, text("en", "route.errors.coordinates"));
        await plan({ via: { lat: 44, lng: 9 } }).expect(422, text("en", "route.errors.coordinates"));
        const stops = (count: number) => Array.from({ length: count }, () => ({ lat: 44.78, lng: 9.85 }));
        await plan({ via: stops(11) }).expect(422, text("en", "route.errors.too-many-stops", "10"));
        await plan({ vehicle: "car" }).expect(422, text("en", "route.errors.vehicle"));
        await plan({ policy: "fastest" }).expect(422, text("en", "route.errors.policy"));
        await plan({ filters: { avoidHills: true } }).expect(422, text("en", "route.errors.filters"));
        await plan({ filters: { avoidUnpaved: "yes" } }).expect(422, text("en", "route.errors.filters"));
        await plan({ filters: [] }).expect(422, text("en", "route.errors.filters"));
    });

    test("maxDetour is a number from 1 to 1000", async () => {
        for (const maxDetour of [0, -5, 0.5, 1001, "25", true, [25], {}]) {
            await planner.post("/route/plan").send(body({ maxDetour })).expect(422, text("en", "route.errors.max-detour"));
        }
    });

    test("legs longer than 50 km", async () => {
        const far = { lat: 45.3, lng: 9.846 };
        const it = await planner.post("/route/plan").set("Accept-Language", "it").send(body({ end: far })).expect(422);
        expect(it.text).toMatch(/^La tratta partenza → destinazione è di 57\.\d km in linea d'aria/);
        await planner.post("/route/plan").send(body({ via: [far] })).expect(422, /^The leg start → stop 1 is 57\.\d km/);
        expect(overpass.requests).toHaveLength(0);
    });
});

describe("POST /route/plan on the fixture tiles", () => {
    let planner: Client;
    beforeAll(async () => {
        planner = await newPlanner();
    });

    test("a route as JSON, with the detour limit at both ends", async () => {
        const { body: route } = await planner.post("/route/plan").send(body()).expect(200);
        expect(route.distance).toBeGreaterThan(700);
        expect(route.legs).toHaveLength(1);
        expect(route.track.length).toBeGreaterThan(2);
        for (const maxDetour of [1, 1000]) {
            await planner.post("/route/plan").send(body({ maxDetour })).expect(200);
        }
        expect(overpass.requests).toHaveLength(0);
    });

    test("streamed as NDJSON: progress, then the route", async () => {
        const response = await planner.post("/route/plan").query({ stream: "1" }).send(body({ policy: "shortest", via: [{ lat: 44.776, lng: 9.856 }] }))
            .buffer(true).parse(binary)
            .expect(200)
            .expect("Content-Type", /^application\/x-ndjson/);
        const lines = ndjson(response.body);
        expect(lines[0]).toEqual({ progress: { done: 0, total: 0 } });
        expect(lines.at(-1).route.legs).toHaveLength(2);
    });
});

describe("POST /route/plan with map data to download", () => {
    const stream = async (planner: Client, end = OUTSIDE) => {
        const response = await planner.post("/route/plan").query({ stream: "1" }).send(body({ end })).buffer(true).parse(binary);
        return { status: response.status, lines: ndjson(response.body) };
    };

    test("a failed download is a 502, or an error line once streaming", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const planner = await newPlanner();
        await planner.post("/route/plan").send(body({ end: OUTSIDE })).expect(502, text("en", "route.errors.map-data"));
        expect(overpass.requests.length).toBeGreaterThan(0);
        expect(overpass.requests[0].headers["user-agent"]).toMatch(/^trackmate-backend\//);
        expect(decodeURIComponent(overpass.requests[0].body)).toMatch(/^data=\[out:json\]/);

        const { status, lines } = await stream(planner);
        expect(status).toBe(200);
        expect(lines[0].progress.total).toBeGreaterThan(0);
        expect(lines.at(-1)).toEqual({ error: text("en", "route.errors.map-data"), status: 502 });
    });

    test("one plan per user, and at most PLAN_MAX_CONCURRENT at once", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const first = await newPlanner();
        const second = await newPlanner();
        let release!: (reply: FakeReply) => void;
        overpass.handle = () => new Promise((resolve) => (release = resolve));

        const running = first.post("/route/plan").send(body({ end: OUTSIDE })).then((response) => response);
        await vi.waitFor(() => expect(overpass.requests).toHaveLength(1));

        await first.post("/route/plan").send(body()).expect(429, text("en", "route.errors.plan-running"));
        await second.post("/route/plan").send(body()).expect(503, text("en", "route.errors.plan-busy"));

        release(REFUSED);
        expect((await running).status).toBe(502);
        await second.post("/route/plan").send(body()).expect(200);
    });
});

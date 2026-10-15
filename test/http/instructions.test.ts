import fs from "fs";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { fakeService, FakeRequest, valhallaTrace } from "../helpers/fakeServices.js";
import { Client, signIn } from "../helpers/users.js";
import { createTrack, text, trackJson } from "../helpers/data.js";

// the url is read when the config loads, so the fake starts before the app
const valhalla = await fakeService(valhallaTrace);
process.env.VALHALLA_URL = valhalla.url;
const { default: app } = await import("../../src/app.js");
const { trackFile } = await import("../../src/files.js");
const { INSTRUCTIONS_CACHE_DIR } = await import("../../src/routing/config.js");

let owner: Client;
let tester: Client;
let ownerId: number;
let testerId: number;

async function trackWithFile(userId: number, vehicle: "BICYCLE" | "CAR" = "BICYCLE") {
    const track = await createTrack(userId, vehicle);
    fs.mkdirSync(path.dirname(trackFile(track.id)), { recursive: true });
    fs.writeFileSync(trackFile(track.id), trackJson());
    return track.id;
}

const cacheFiles = (trackId: number) =>
    (fs.existsSync(INSTRUCTIONS_CACHE_DIR) ? fs.readdirSync(INSTRUCTIONS_CACHE_DIR) : []).filter((name) => name.startsWith(`${trackId}-`));
const sent = (request: FakeRequest) => ({ endpoint: request.url, ...JSON.parse(request.body) });

beforeAll(async () => {
    ({ agent: owner, user: { id: ownerId } } = await signIn(app, "owner"));
    ({ agent: tester, user: { id: testerId } } = await signIn(app, "tester"));
});

afterEach(() => {
    valhalla.handle = valhallaTrace;
    valhalla.requests.length = 0;
});

afterAll(() => valhalla.close());

describe("GET /track/instructions", () => {
    test("asks Valhalla once per track and language, then serves the cache", async () => {
        const id = await trackWithFile(ownerId);
        const { body } = await owner.get("/track/instructions").query({ id }).set("Accept-Language", "it").expect(200);
        expect(body).toMatchObject({ vehicle: "bicycle", language: "it-IT", speedLimits: [] });
        expect(body.maneuvers[0]).toMatchObject({ type: 1, text: "it-IT: Head east.", along: 0 });

        expect(valhalla.requests).toHaveLength(1);
        expect(sent(valhalla.requests[0])).toMatchObject({
            endpoint: "/trace_route", costing: "bicycle", shape_match: "map_snap", directions_options: { language: "it-IT" },
        });
        expect(valhalla.requests[0].headers["user-agent"]).toMatch(/^trackmate-backend\//);
        expect(cacheFiles(id)).toEqual([expect.stringMatching(new RegExp(`^${id}-bicycle-it-IT-`))]);

        await owner.get("/track/instructions").query({ id }).set("Accept-Language", "it").expect(200, body);
        expect(valhalla.requests).toHaveLength(1);

        const german = (await owner.get("/track/instructions").query({ id, lang: "de" }).expect(200)).body;
        expect(german.maneuvers[0].text).toBe("de-DE: Head east.");
        expect(valhalla.requests).toHaveLength(2);
        expect(cacheFiles(id)).toHaveLength(2);
    });

    test("another vehicle only of the same kind", async () => {
        const id = await trackWithFile(ownerId);
        await owner.get("/track/instructions").query({ id, vehicle: "car" }).expect(422, text("en", "track.errors.vehicle-class"));
        await owner.get("/track/instructions").query({ id, vehicle: "plane" }).expect(422, text("en", "track.errors.vehicle"));
        expect(valhalla.requests).toHaveLength(0);
    });

    test("a track without its file", async () => {
        const id = (await createTrack(testerId)).id;
        await tester.get("/track/instructions").query({ id }).expect(404, text("en", "file.errors.missing"));
    });

    test("Valhalla errors become clear answers, and nothing is cached", async () => {
        const noMatch = await trackWithFile(testerId);
        valhalla.handle = () => ({ status: 400, body: { error_code: 171, error: "No suitable edges near location" } });
        await tester.get("/track/instructions").query({ id: noMatch }).expect(422, text("en", "route.errors.instructions-no-match"));

        const down = await trackWithFile(testerId);
        valhalla.handle = () => ({ status: 500, body: { error: "Internal error" } });
        await tester.get("/track/instructions").query({ id: down }).expect(502, text("en", "route.errors.instructions"));
        expect([...cacheFiles(noMatch), ...cacheFiles(down)]).toEqual([]);
    });

    test("motor vehicles ask for speed limits too, and skip them when that fails", async () => {
        const id = await trackWithFile(testerId, "CAR");
        valhalla.handle = (request) => request.url === "/trace_route" ? valhallaTrace(request) : { status: 500 };
        const { body } = await tester.get("/track/instructions").query({ id }).expect(200);
        expect(body).toMatchObject({ vehicle: "car", speedLimits: [] });
        expect(valhalla.requests.map((r) => sent(r))).toMatchObject([
            { endpoint: "/trace_route", costing: "auto" },
            { endpoint: "/trace_attributes", costing: "auto" },
        ]);
        // incomplete answers aren't cached
        expect(cacheFiles(id)).toEqual([]);
    });

    test("deleting the track deletes its cached instructions", async () => {
        const id = await trackWithFile(ownerId);
        await owner.get("/track/instructions").query({ id }).expect(200);
        expect(cacheFiles(id)).toHaveLength(1);
        await owner.delete("/track").query({ id }).expect(200);
        expect(cacheFiles(id)).toEqual([]);
    });
});

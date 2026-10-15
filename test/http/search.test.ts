import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { fakeService, PHOTON_PARMA } from "../helpers/fakeServices.js";
import { Client, signIn } from "../helpers/users.js";
import { befriend, createPost, createTrack, createTravel, text } from "../helpers/data.js";

// the url is read when the module loads, so the fake starts before the app
const photon = await fakeService(() => ({ body: PHOTON_PARMA }));
process.env.PHOTON_URL = `${photon.url}/api`;
const { default: app } = await import("../../src/app.js");

const FAKE_KEY = "fake-stadia-key";

let searcher: Client;
let searcherId: number;

beforeAll(async () => {
    ({ agent: searcher, user: { id: searcherId } } = await signIn(app, "searcher"));
});

afterEach(() => {
    process.env.STADIA_API_KEY = "";
    photon.requests.length = 0;
    vi.restoreAllMocks();
});

afterAll(() => photon.close());

describe("GET /search", () => {
    beforeAll(async () => {
        const { prisma } = await import("../../src/utils.js");
        const rider = await prisma.user.create({ data: { username: "hillrider", password: "x", bio: "loves hills" } });
        const walker = await prisma.user.create({ data: { username: "walker", password: "x", bio: "hills on foot" } });
        await befriend(walker.id, searcherId);
        await createTravel(rider.id, null);
        await createPost((await createTrack(rider.id)).id, "Repeats", "hill repeats, up and down");
        await createPost((await createTrack(searcherId)).id, "Mine", "my hills");
    });

    test("users and posts, without the searcher or their posts", async () => {
        const { body } = await searcher.get("/search").query({ text: "HILL" }).expect(200);
        const users = body.filter((r: any) => r.type === "user");
        const posts = body.filter((r: any) => r.type === "post");
        expect(users.map((u: any) => u.username).sort()).toEqual(["hillrider", "walker"]);
        expect(posts.map((p: any) => p.title)).toEqual(["Repeats"]);
        expect(posts[0]).toMatchObject({ username: "hillrider", likesCount: 0, savesCount: 0 });
        expect((await searcher.get("/search").query({ text: "searcher" }).expect(200)).body).toEqual([]);
    });

    test("users sorted by friends, distance or posts", async () => {
        const first = async (sortBy?: string) =>
            (await searcher.get("/search").query(sortBy ? { text: "hill", sortBy } : { text: "hill" }).expect(200)).body[0];
        expect(await first()).toMatchObject({ username: "walker", friendsCount: 1 });
        expect(await first("distance")).toMatchObject({ username: "hillrider", totalTravelled: 3.5 });
        expect(await first("posts")).toMatchObject({ username: "hillrider", postsCount: 1 });
    });

    test("needs one text", async () => {
        await searcher.get("/search").expect(422, /^Missing required parameters/);
        await searcher.get("/search?text=hill&text=walk").expect(422, text("en", "server.bad-request"));
    });
});

describe("GET /route/geocode", () => {
    test("off without a Stadia key", async () => {
        await searcher.get("/route/geocode").query({ text: "Parma" }).expect(503, text("en", "route.errors.geocoding-disabled"));
        await searcher.get("/route/geocode").expect(422);
    });

    test("Stadia stays unreachable in tests, so the quick search fails cleanly", async () => {
        process.env.STADIA_API_KEY = FAKE_KEY;
        vi.spyOn(console, "error").mockImplementation(() => {});
        await searcher.get("/route/geocode").query({ text: "Parma" }).expect(502, text("en", "route.errors.geocoding"));
        expect(photon.requests).toHaveLength(0);
    });

    test("the full search falls back to Photon, near the given point, and caches it", async () => {
        process.env.STADIA_API_KEY = FAKE_KEY;
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const query = { text: "Parma", full: "1", lat: "44.8", lng: "10.33" };
        const { body } = await searcher.get("/route/geocode").query(query).expect(200);
        expect(body).toEqual([
            { label: "Parma, Italia", lat: 44.801, lng: 10.328 },
            { label: "Stazione di Parma, Parma, Italia", lat: 44.809, lng: 10.327 },
        ]);

        expect(photon.requests).toHaveLength(1);
        const url = new URL(photon.requests[0].url, photon.url);
        expect(url.pathname).toBe("/api");
        expect(Object.fromEntries(url.searchParams)).toEqual({ q: "Parma", limit: "8", lat: "44.8", lon: "10.33" });
        expect(photon.requests[0].url).not.toContain(FAKE_KEY);
        expect(photon.requests[0].headers["user-agent"]).toMatch(/^trackmate-backend\//);

        await searcher.get("/route/geocode").query(query).expect(200, body);
        expect(photon.requests).toHaveLength(1);
    });
});

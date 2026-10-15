import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, test } from "vitest";
import app from "../../src/app.js";
import { prisma } from "../../src/utils.js";
import { trackFile, travelFile } from "../../src/files.js";
import { INSTRUCTIONS_CACHE_DIR } from "../../src/routing/config.js";
import { Client, signIn } from "../helpers/users.js";
import { createPost, text, trackJson } from "../helpers/data.js";

const JSON_FILE = { filename: "track.json", contentType: "application/json" };
const travel = (id: number, time: number, extra: object = {}) =>
    ({ id, time, averageSpeed: 36_000 / time, maxSpeed: 30, distance: 10, ...extra });

let owner: Client;
let rider: Client;
let ownerId: number;
let riderId: number;
let trackId: number;

beforeAll(async () => {
    ({ agent: owner, user: { id: ownerId } } = await signIn(app, "owner"));
    ({ agent: rider, user: { id: riderId } } = await signIn(app, "rider"));
});

describe("creating a track", () => {
    test("needs a name and a known vehicle", async () => {
        await owner.post("/track").send({ vehicle: "bicycle" }).expect(422, /^Missing required parameters/);
        await owner.post("/track").send({ name: "Loop", vehicle: "plane" }).expect(422, text("en", "track.errors.vehicle"));
        for (const name of [42, ["Loop"], { name: "Loop" }, true]) {
            await owner.post("/track").send({ name, vehicle: "bicycle" }).expect(422, text("en", "server.bad-request"));
        }
        trackId = (await owner.post("/track").send({ name: "Loop", vehicle: "bicycle" }).expect(200)).body.id;
        expect(await prisma.track.findUniqueOrThrow({ where: { id: trackId } })).toMatchObject({ userId: ownerId, name: "Loop", vehicle: "BICYCLE" });
    });

    test("the file must be a list of valid points", async () => {
        const upload = (content: Buffer) => owner.post("/track/file").query({ id: trackId }).attach("file", content, JSON_FILE);
        const invalid = text("en", "track.errors.file");
        await owner.post("/track/file").query({ id: trackId }).expect(422, text("en", "file.errors.missing"));
        await upload(Buffer.from("not json")).expect(422, invalid);
        await upload(Buffer.from(JSON.stringify({ track: "x" }))).expect(422, invalid);
        await upload(trackJson([{ lat: 91, lng: 9 }])).expect(422, invalid);
        await upload(trackJson([{ lat: 44, lng: 181 }])).expect(422, invalid);
        await upload(Buffer.from(JSON.stringify({ track: [{ lat: "44", lng: "9" }] }))).expect(422, invalid);
        expect(fs.existsSync(trackFile(trackId))).toBe(false);

        await upload(trackJson()).expect(200, text("en", "file.success.upload"));
        const { body } = await owner.get("/track/file").query({ id: trackId }).expect(200);
        expect(body).toEqual(JSON.parse(trackJson().toString()));
    });
});

describe("travels", () => {
    let ownerTravelId: number;

    test("numbers that are numbers, not below zero", async () => {
        for (const bad of [{ time: "600" }, { distance: -1 }, { averageSpeed: [10] }, { maxSpeed: { kmh: 30 } }, { time: true }]) {
            await owner.post("/track/travel").send(travel(trackId, 600, bad)).expect(422, text("en", "server.bad-request"));
        }
        expect(await prisma.travel.count({ where: { trackId } })).toBe(0);
    });

    test("in a vehicle of the track's kind", async () => {
        await owner.post("/track/travel").send(travel(trackId, 600, { vehicle: "car" })).expect(422, text("en", "track.errors.vehicle-class"));
        await owner.post("/track/travel").send(travel(trackId, 600, { vehicle: "plane" })).expect(422, text("en", "track.errors.vehicle"));
        const { body } = await owner.post("/track/travel").send(travel(trackId, 600)).expect(200);
        expect(body).toEqual({ id: expect.any(Number), message: text("en", "track.success.travel") });
        ownerTravelId = body.id;
        await owner.post("/track/travel").send(travel(trackId, 700)).expect(200);
    });

    test("the points file goes with the travel", async () => {
        await owner.post("/track/travel/file").query({ id: ownerTravelId }).attach("file", trackJson(), JSON_FILE).expect(200);
        await owner.get("/track/travel/file").query({ id: ownerTravelId }).expect(200);
        // private until the track is posted
        await rider.get("/track/travel/file").query({ id: ownerTravelId }).expect(403);
        await createPost(trackId);
        await rider.get("/track/travel/file").query({ id: ownerTravelId }).expect(200);
    });

    test("stats, details and the leaderboard", async () => {
        await rider.post("/track/travel").send(travel(trackId, 500)).expect(200);

        const tracks = (await owner.get("/track").expect(200)).body;
        expect(tracks).toEqual([{ id: trackId, name: "Loop", vehicle: "bicycle", bestTime: 500, maxSpeed: 30, bestAverageSpeed: 72, travelCount: 3 }]);
        expect((await owner.get("/track").query({ vehicle: "car" }).expect(200)).body[0].travelCount).toBe(0);
        await owner.get("/track").query({ vehicle: "plane" }).expect(422);

        const details = (await owner.get("/track/details").query({ id: trackId }).expect(200)).body;
        expect(details).toMatchObject({ id: trackId, name: "Loop", vehicle: "bicycle", ownerId, travelCount: 2 });
        expect(details.userBest).toMatchObject({ time: 600, username: "owner" });
        expect(details.overallBest).toMatchObject({ time: 500, username: "rider", userId: riderId });

        const leaderboard = (await owner.get("/track/leaderboard").query({ id: trackId }).expect(200)).body;
        expect(leaderboard).toEqual([
            { userId: riderId, name: "rider", time: 500 },
            { userId: ownerId, name: "owner", time: 600 },
        ]);

        const all = (await owner.get("/track/travel/details").query({ id: trackId }).expect(200)).body;
        expect(all.map((t: any) => t.username).sort()).toEqual(["owner", "owner", "rider"]);
        const mine = (await owner.get("/track/travel").expect(200)).body;
        expect(mine).toHaveLength(2);
        expect(mine[0]).toMatchObject({ name: "Loop", vehicle: "bicycle" });
    });

    test("only the owner deletes a travel, with its file", async () => {
        await rider.delete("/track/travel").query({ id: ownerTravelId }).expect(403);
        await owner.delete("/track/travel").query({ id: ownerTravelId }).expect(200, text("en", "track.success.travel-delete"));
        expect(fs.existsSync(travelFile(ownerTravelId))).toBe(false);
        await owner.delete("/track/travel").query({ id: ownerTravelId }).expect(404);
    });
});

describe("editing a track", () => {
    test("rename, and a new kind of vehicle moves the owner's travels", async () => {
        const id = (await owner.post("/track").send({ name: "Commute", vehicle: "bicycle" }).expect(200)).body.id;
        await owner.post("/track/travel").send(travel(id, 900)).expect(200);

        await owner.put("/track").send({ id, name: "Drive", vehicle: "car" }).expect(200, text("en", "track.success.update"));
        expect(await prisma.track.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Drive", vehicle: "CAR" });
        expect((await prisma.travel.findMany({ where: { trackId: id } })).map((t) => t.vehicle)).toEqual(["CAR"]);
        await owner.put("/track").send({ id, name: "Drive", vehicle: "plane" }).expect(422);
        await owner.put("/track").send({ id, name: ["Drive"] }).expect(422, text("en", "server.bad-request"));
    });

    test("not to another kind once others travelled it", async () => {
        await owner.put("/track").send({ id: trackId, name: "Loop", vehicle: "foot" }).expect(409, text("en", "track.errors.vehicle-class-locked"));
        await owner.put("/track").send({ id: trackId, name: "Big loop" }).expect(200);
        expect(await prisma.track.findUniqueOrThrow({ where: { id: trackId } })).toMatchObject({ name: "Big loop", vehicle: "BICYCLE" });
    });
});

describe("deleting a track", () => {
    test("takes its posts and files, travels stay without it", async () => {
        const cache = path.join(INSTRUCTIONS_CACHE_DIR, `${trackId}-bicycle-en-US-0123456789abcdef-2.json`);
        fs.mkdirSync(INSTRUCTIONS_CACHE_DIR, { recursive: true });
        fs.writeFileSync(cache, "{}");

        await owner.delete("/track").query({ id: trackId }).expect(200, text("en", "track.success.delete"));
        expect(fs.existsSync(trackFile(trackId))).toBe(false);
        expect(fs.existsSync(cache)).toBe(false);
        expect(await prisma.post.count({ where: { trackId } })).toBe(0);
        const travels = await prisma.travel.findMany({ where: { OR: [{ userId: riderId }, { trackId }] } });
        expect(travels.map((t) => t.trackId)).toEqual([null]);
        await rider.get("/track/details").query({ id: trackId }).expect(404);
    });
});

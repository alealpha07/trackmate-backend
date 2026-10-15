import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, test } from "vitest";
import app from "../../src/app.js";
import { prisma } from "../../src/utils.js";
import { trackFile, travelFile } from "../../src/files.js";
import { Client, signIn } from "../helpers/users.js";
import { createPost, createTrack, createTravel, image, text, trackJson } from "../helpers/data.js";

const MISSING = 999_999;

function writeFile(file: string, content: Buffer) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

let owner: { id: number };
let other: Client;
let hiddenId: number;
let postedId: number;
let postId: number;
let travelId: number;
let questId: number;

beforeAll(async () => {
    const a = await signIn(app, "owner");
    owner = a.user;
    other = (await signIn(app, "other")).agent;

    hiddenId = (await createTrack(owner.id, "BICYCLE", "Private loop")).id;
    writeFile(trackFile(hiddenId), trackJson());
    travelId = (await createTravel(owner.id, hiddenId)).id;
    writeFile(travelFile(travelId), trackJson());
    postedId = (await createTrack(owner.id, "BICYCLE", "Shared loop")).id;
    postId = (await createPost(postedId, "Shared", "For everyone")).id;
    questId = (await prisma.quest.create({
        data: { userId: owner.id, description: "Ride 5 km", experience: 100, maxProgress: 5, progress: 5, type: "TRAVEL_DISTANCE", vehicle: "BICYCLE" },
    })).id;
});

describe("someone else's private track", () => {
    test("can't be changed", async () => {
        const notOwner = text("en", "track.errors.not-owner");
        await other.put("/track").send({ id: hiddenId, name: "Mine now" }).expect(403, notOwner);
        await other.put("/track").send({ id: hiddenId, name: "Mine now", vehicle: "car" }).expect(403, notOwner);
        await other.delete("/track").query({ id: hiddenId }).expect(403, notOwner);
        await other.post("/track/file").query({ id: hiddenId })
            .attach("file", trackJson([{ lat: 1, lng: 1 }]), { filename: "t.json", contentType: "application/json" })
            .expect(403, notOwner);
        await other.post("/post").send({ id: hiddenId, title: "t", description: "d" }).expect(403, notOwner);

        const track = await prisma.track.findUniqueOrThrow({ where: { id: hiddenId } });
        expect(track.name).toBe("Private loop");
        expect(fs.readFileSync(trackFile(hiddenId))).toEqual(trackJson());
    });

    test("can't be seen or travelled", async () => {
        const hidden = text("en", "track.errors.hidden");
        for (const route of ["/track/file", "/track/details", "/track/leaderboard", "/track/travel/details", "/track/instructions"]) {
            await other.get(route).query({ id: hiddenId }).expect(403, hidden);
        }
        await other.post("/track/travel").send({ id: hiddenId, time: 60, averageSpeed: 10, maxSpeed: 20, distance: 1 }).expect(403, hidden);
        await other.get("/track/travel/file").query({ id: travelId }).expect(403, hidden);
    });

    test("its travels can't be changed", async () => {
        const notOwner = text("en", "track.errors.travel-not-owner");
        await other.delete("/track/travel").query({ id: travelId }).expect(403, notOwner);
        await other.post("/track/travel/file").query({ id: travelId })
            .attach("file", trackJson(), { filename: "t.json", contentType: "application/json" })
            .expect(403, notOwner);
        expect(await prisma.travel.count({ where: { id: travelId } })).toBe(1);
    });
});

describe("someone else's post", () => {
    test("can't be edited, deleted or given images", async () => {
        const notOwner = text("en", "post.errors.not-owner");
        await other.put("/post").send({ id: postId, title: "Spam", description: "Spam" }).expect(403, notOwner);
        await other.delete("/post").query({ id: postId }).expect(403, notOwner);
        await other.post("/post/image").query({ id: postId })
            .attach("file", await image(), { filename: "a.jpg", contentType: "image/jpeg" })
            .expect(403, notOwner);

        const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
        expect(post).toMatchObject({ title: "Shared", description: "For everyone", imageCount: 0 });
    });

    test("makes its track visible, and a travel keeps it visible after the post goes", async () => {
        await other.get("/track/details").query({ id: postedId }).expect(200);
        await other.post("/track/travel").send({ id: postedId, time: 60, averageSpeed: 10, maxSpeed: 20, distance: 1 }).expect(200);
        await prisma.post.deleteMany({ where: { trackId: postedId } });
        await other.get("/track/details").query({ id: postedId }).expect(200);
    });
});

describe("other people's data", () => {
    test("quests can't be collected by someone else", async () => {
        await other.put("/quest").send({ id: questId }).expect(200, text("en", "quest.errors.missing"));
        expect(await prisma.quest.count({ where: { id: questId } })).toBe(1);
    });

    test("friend lists only for friends", async () => {
        await other.get("/friend").query({ id: owner.id }).expect(403, text("en", "friend.errors.not-friend"));
    });

    test("missing ids are a 404", async () => {
        await other.get("/track/details").query({ id: MISSING }).expect(404, text("en", "track.errors.missing"));
        await other.delete("/track").query({ id: MISSING }).expect(404);
        await other.get("/post").query({ id: MISSING }).expect(404, text("en", "post.errors.missing"));
        await other.post("/post/like").send({ id: MISSING }).expect(404);
        await other.delete("/track/travel").query({ id: MISSING }).expect(404, text("en", "track.errors.travel-missing"));
        await other.get("/user/image").query({ id: MISSING }).expect(404);
    });
});

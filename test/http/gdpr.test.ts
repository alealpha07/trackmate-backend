import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, test } from "vitest";
import app from "../../src/app.js";
import { prisma, UPLOAD_DIR } from "../../src/utils.js";
import { travelFile } from "../../src/files.js";
import { INSTRUCTIONS_CACHE_DIR } from "../../src/routing/config.js";
import { Client, login, PASSWORD, signIn } from "../helpers/users.js";
import { befriend, binary, createTravel, image, listFiles, text, trackJson } from "../helpers/data.js";
import { unzip } from "../helpers/zip.js";

let agent: Client;
let userId: number;
let friendId: number;
let trackId: number;
let postId: number;
let travelId: number;
let friendTravelId: number;

const JSON_FILE = { filename: "t.json", contentType: "application/json" };

// a bit of every kind of data, through the API where it has a route
beforeAll(async () => {
    ({ agent, user: { id: userId } } = await signIn(app, "gdpr"));
    friendId = (await signIn(app, "pal")).user.id;

    await agent.put("/user").send({ bio: "Cycling in Parma" }).expect(200);
    await agent.post("/user/image").attach("file", await image("png"), { filename: "me.png", contentType: "image/png" }).expect(200);
    trackId = (await agent.post("/track").send({ name: "Loop", vehicle: "bicycle" }).expect(200)).body.id;
    await agent.post("/track/file").query({ id: trackId }).attach("file", trackJson(), JSON_FILE).expect(200);
    postId = (await agent.post("/post").send({ id: trackId, title: "Loop", description: "Flat" }).expect(200)).body.id;
    await agent.post("/post/image").query({ id: postId }).attach("file", await image(), { filename: "a.jpg", contentType: "image/jpeg" }).expect(200);
    travelId = (await agent.post("/track/travel").send({ id: trackId, time: 600, averageSpeed: 20, maxSpeed: 35, distance: 3.3 }).expect(200)).body.id;
    await agent.post("/track/travel/file").query({ id: travelId }).attach("file", trackJson(), JSON_FILE).expect(200);
    await agent.post("/post/like").send({ id: postId }).expect(200);
    await agent.post("/post/save").send({ id: postId }).expect(200);
    await prisma.quest.create({
        data: { userId, description: "Ride 5 km", experience: 100, maxProgress: 5, type: "TRAVEL_DISTANCE", vehicle: "BICYCLE" },
    });
    await befriend(userId, friendId);

    // the friend rode the posted track
    friendTravelId = (await createTravel(friendId, trackId)).id;
    fs.mkdirSync(path.dirname(travelFile(friendTravelId)), { recursive: true });
    fs.writeFileSync(travelFile(friendTravelId), trackJson());
    fs.mkdirSync(INSTRUCTIONS_CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(INSTRUCTIONS_CACHE_DIR, `${trackId}-bicycle-en-US-0123456789abcdef-2.json`), "{}");
});

describe("GET /user/export", () => {
    test("a zip with every kind of data and file", async () => {
        const response = await agent.get("/user/export").buffer(true).parse(binary)
            .expect(200)
            .expect("Content-Type", /^application\/zip/)
            .expect("Content-Disposition", /trackmate-gdpr\.zip/);
        const files = unzip(response.body);
        expect([...files.keys()].sort()).toEqual([
            "data.json", `posts/${postId}-0.jpg`, "profile.jpg", `tracks/${trackId}.json`, `travels/${travelId}.json`,
        ].sort());
        expect(files.get(`tracks/${trackId}.json`)).toEqual(trackJson());
        expect(files.get("profile.jpg")!.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

        const raw = files.get("data.json")!.toString("utf8");
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        expect(raw).not.toContain(user.password);
        const data = JSON.parse(raw);
        expect(Object.keys(data.profile).sort()).toEqual(["bio", "experience", "id", "level", "termsAcceptedAt", "username"]);
        expect(data.profile).toMatchObject({ id: userId, username: "gdpr", bio: "Cycling in Parma" });
        expect(new Date(data.profile.termsAcceptedAt).getTime()).toBe(user.termsAcceptedAt!.getTime());
        expect(data.vehicles.sort()).toEqual(["bicycle", "car", "foot", "motorcycle"]);
        expect(data.quests).toHaveLength(1);
        expect(data.quests[0]).not.toHaveProperty("userId");
        expect(data.friends).toEqual([{ username: "pal", accepted: true, sentByMe: true }]);
        expect(data.tracks).toEqual([{ id: trackId, name: "Loop", vehicle: "bicycle" }]);
        expect(data.travels).toHaveLength(1);
        expect(data.travels[0]).toMatchObject({ id: travelId, trackName: "Loop", vehicle: "bicycle", distance: 3.3 });
        expect(data.posts).toHaveLength(1);
        expect(data.posts[0]).toMatchObject({ id: postId, title: "Loop", imageCount: 1 });
        expect(data.likedPostIds).toEqual([postId]);
        expect(data.savedPostIds).toEqual([postId]);
    });
});

describe("DELETE /user", () => {
    test("needs the password", async () => {
        await agent.delete("/user").send({ password: "wrong-password" }).expect(403, text("en", "auth.errors.wrong-password"));
        await agent.delete("/user").send({}).expect(403);
        expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
    });

    test("removes every row, file and session of the user, and nothing of others", async () => {
        const laptop = await login(app, "gdpr");
        const response = await agent.delete("/user").send({ password: PASSWORD }).expect(200, text("en", "user.success.delete"));
        expect(response.headers["set-cookie"]?.[0]).toMatch(/^connect\.sid=;/);

        expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
        expect(await prisma.userVehicle.count({ where: { userId } })).toBe(0);
        expect(await prisma.track.count()).toBe(0);
        expect(await prisma.post.count()).toBe(0);
        expect(await prisma.like.count()).toBe(0);
        expect(await prisma.save.count()).toBe(0);
        expect(await prisma.quest.count({ where: { userId } })).toBe(0);
        expect(await prisma.friendRequest.count()).toBe(0);
        expect(await prisma.travel.findMany({ select: { id: true, trackId: true } })).toEqual([{ id: friendTravelId, trackId: null }]);
        const sessions = await prisma.session.findMany();
        expect(sessions.filter((session) => JSON.parse(session.data).passport?.user === userId)).toEqual([]);

        expect(listFiles(UPLOAD_DIR)).toEqual([path.join("travel", `${friendTravelId}.json`)]);
        expect(listFiles(INSTRUCTIONS_CACHE_DIR)).toEqual([]);

        await agent.get("/auth/user").expect(401);
        await laptop.get("/auth/user").expect(401);
        await (await login(app, "pal")).get("/auth/user").expect(200);
    });
});

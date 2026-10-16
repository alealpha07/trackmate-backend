import sharp from "sharp";
import { beforeAll, describe, expect, test } from "vitest";
import app from "../../src/app.js";
import { prisma } from "../../src/utils.js";
import { postImageFiles } from "../../src/files.js";
import { Client, signIn } from "../helpers/users.js";
import { befriend, binary, createTrack, image, text } from "../helpers/data.js";

const JPEG = { filename: "photo.jpg", contentType: "image/jpeg" };
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

let author: Client;
let reader: Client;
let stranger: Client;
let authorId: number;
let trackId: number;
let postId: number;

beforeAll(async () => {
    const a = await signIn(app, "author");
    author = a.agent;
    authorId = a.user.id;
    const b = await signIn(app, "reader");
    reader = b.agent;
    stranger = (await signIn(app, "stranger")).agent;
    await befriend(authorId, b.user.id);
    trackId = (await createTrack(authorId)).id;
});

describe("creating a post", () => {
    test("needs a title, a description and an own track", async () => {
        await author.post("/post").send({ id: trackId, title: "No description" }).expect(422, /^Missing required parameters/);
        await author.post("/post").send({ id: 999_999, title: "t", description: "d" }).expect(404, text("en", "track.errors.missing"));
        for (const texts of [{ title: 1, description: "d" }, { title: "t", description: ["d"] }, { title: { t: 1 }, description: "d" }]) {
            await author.post("/post").send({ id: trackId, ...texts }).expect(422, text("en", "server.bad-request"));
        }
        expect(await prisma.post.count()).toBe(0);
    });

    test("a new post drops the author's posts that never got an image", async () => {
        const first = (await author.post("/post").send({ id: trackId, title: "Draft", description: "d" }).expect(200)).body.id;
        postId = (await author.post("/post").send({ id: trackId, title: "Hills", description: "Nice climbs" }).expect(200)).body.id;
        expect(await prisma.post.findMany({ select: { id: true } })).toEqual([{ id: postId }]);
        expect(first).not.toBe(postId);
    });
});

describe("post images", () => {
    test("missing, wrong type and too large", async () => {
        await author.post("/post/image").query({ id: postId }).expect(422, JSON.stringify(text("en", "file.errors.missing")));
        await author.post("/post/image").query({ id: postId })
            .attach("file", Buffer.from("not an image"), { filename: "notes.txt", contentType: "text/plain" })
            .expect(422, text("en", "file.errors.invalid"));
        await author.post("/post/image").query({ id: postId })
            .attach("file", Buffer.alloc(MAX_UPLOAD_BYTES + 1), JPEG)
            .expect(413, text("en", "file.errors.too-large"));
        expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).imageCount).toBe(0);
    });

    test("stored as 1024 px JPEGs, numbered in order", async () => {
        await author.post("/post/image").query({ id: postId }).attach("file", await image("jpeg", 300), JPEG).expect(200);
        await author.post("/post/image").query({ id: postId })
            .attach("file", await image("png", 2000), { filename: "map.png", contentType: "image/png" })
            .expect(200);
        expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).imageCount).toBe(2);

        for (const index of [0, 1]) {
            const response = await reader.get("/post/image").query({ id: postId, index }).buffer(true).parse(binary)
                .expect(200).expect("Content-Type", "image/jpeg");
            const { format, width, height } = await sharp(response.body).metadata();
            expect({ format, width, height }).toEqual({ format: "jpeg", width: 1024, height: 1024 });
        }
        await reader.get("/post/image").query({ id: postId, index: 2 }).expect(404);
        await reader.get("/post/image").query({ id: postId, index: "x" }).expect(422);
    });
});

describe("reading, likes and saves", () => {
    test("a post with its author's public fields", async () => {
        const { body } = await reader.get("/post").query({ id: postId }).expect(200);
        expect(body).toMatchObject({ id: postId, title: "Hills", username: "author", userId: authorId, liked: false, saved: false, likeCount: 0 });
        expect(Object.keys(body.Track.user).sort()).toEqual(["bio", "experience", "id", "level", "username"]);
    });

    test("likes count once per user", async () => {
        await reader.post("/post/like").send({ id: postId }).expect(200, text("en", "post.success.like"));
        await reader.post("/post/like").send({ id: postId }).expect(200);
        expect((await reader.get("/post").query({ id: postId })).body).toMatchObject({ liked: true, likeCount: 1 });
        expect((await author.get("/post").query({ id: postId })).body).toMatchObject({ liked: false, likeCount: 1 });
        await reader.delete("/post/like").query({ id: postId }).expect(200, text("en", "post.success.unlike"));
        expect((await reader.get("/post").query({ id: postId })).body).toMatchObject({ liked: false, likeCount: 0 });
    });

    test("saved posts are listed only for who saved them", async () => {
        await reader.post("/post/save").send({ id: postId }).expect(200, text("en", "post.success.save"));
        const { body } = await reader.get("/post/saved").expect(200);
        expect(body.map((post: any) => [post.id, post.saved])).toEqual([[postId, true]]);
        expect((await stranger.get("/post/saved").expect(200)).body).toEqual([]);
        await reader.delete("/post/save").query({ id: postId }).expect(200, text("en", "post.success.unsave"));
        expect((await reader.get("/post/saved").expect(200)).body).toEqual([]);
    });
});

describe("feeds", () => {
    const ids = (body: any[]) => body.map((post) => post.id);

    test("friends see the post in their feed, others don't", async () => {
        expect(ids((await reader.get("/post/friends").query({ offset: 0 }).expect(200)).body)).toEqual([postId]);
        expect(ids((await stranger.get("/post/friends").query({ offset: 0 }).expect(200)).body)).toEqual([]);
        expect(ids((await reader.get("/post/friends").query({ offset: 10 }).expect(200)).body)).toEqual([]);
    });

    test("trending leaves out the user's own posts", async () => {
        expect(ids((await stranger.get("/post/trending").query({ offset: 0 }).expect(200)).body)).toEqual([postId]);
        expect(ids((await author.get("/post/trending").query({ offset: 0 }).expect(200)).body)).toEqual([]);
    });

    test("a user's posts", async () => {
        expect(ids((await stranger.get("/post/user").query({ id: authorId }).expect(200)).body)).toEqual([postId]);
    });
});

describe("editing and deleting", () => {
    test("the author can edit, with texts only", async () => {
        await author.put("/post").send({ id: postId, title: ["Spam"], description: "d" }).expect(422, text("en", "server.bad-request"));
        const tooLong = text("en", "post.errors.length", "100", "2000");
        await author.put("/post").send({ id: postId, title: "t".repeat(101), description: "d" }).expect(422, tooLong);
        await author.put("/post").send({ id: postId, title: "t", description: "d".repeat(2001) }).expect(422, tooLong);
        await author.post("/post").send({ id: trackId, title: "t".repeat(101), description: "d" }).expect(422, tooLong);
        await author.put("/post").send({ id: postId, title: "Steep hills", description: "Bring water" })
            .expect(200, text("en", "post.success.update"));
        expect(await prisma.post.findUniqueOrThrow({ where: { id: postId } })).toMatchObject({ title: "Steep hills", description: "Bring water" });
    });

    test("deleting removes its images, likes and saves", async () => {
        await reader.post("/post/like").send({ id: postId }).expect(200);
        await reader.post("/post/save").send({ id: postId }).expect(200);
        expect(postImageFiles(postId)).toHaveLength(2);

        await author.delete("/post").query({ id: postId }).expect(200, text("en", "post.success.delete"));
        expect(postImageFiles(postId)).toEqual([]);
        expect(await prisma.like.count()).toBe(0);
        expect(await prisma.save.count()).toBe(0);
        await reader.get("/post").query({ id: postId }).expect(404);
        // the track stays
        expect(await prisma.track.count({ where: { id: trackId } })).toBe(1);
    });
});

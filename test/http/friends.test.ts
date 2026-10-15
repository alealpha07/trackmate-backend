import { beforeAll, describe, expect, test } from "vitest";
import app from "../../src/app.js";
import { prisma } from "../../src/utils.js";
import { Client, signIn } from "../helpers/users.js";
import { createTravel, text } from "../helpers/data.js";

let anna: Client;
let bruno: Client;
let carla: Client;
let annaId: number;
let brunoId: number;
let carlaId: number;

beforeAll(async () => {
    ({ agent: anna, user: { id: annaId } } = await signIn(app, "anna"));
    ({ agent: bruno, user: { id: brunoId } } = await signIn(app, "bruno"));
    ({ agent: carla, user: { id: carlaId } } = await signIn(app, "carla"));
});

const usernames = (body: any[]) => body.map((user) => user.username).sort();

describe("friend requests", () => {
    test("not to yourself, not to nobody, not twice", async () => {
        await anna.post("/friend/request").send({ id: annaId }).expect(422, text("en", "friend.errors.self"));
        await anna.post("/friend/request").send({ id: 999_999 }).expect(404, text("en", "user.errors.missing"));
        await anna.post("/friend/request").send({ id: brunoId }).expect(200, text("en", "friend.success.send"));
        await anna.post("/friend/request").send({ id: brunoId }).expect(409, text("en", "friend.errors.exists"));
        await bruno.post("/friend/request").send({ id: annaId }).expect(409, text("en", "friend.errors.exists"));
    });

    test("received ones come with the sender, sent ones with the receiver", async () => {
        const received = (await bruno.get("/friend/request").expect(200)).body;
        expect(received).toEqual([{
            senderId: annaId, receiverId: brunoId, status: false,
            sender: { id: annaId, username: "anna", bio: "", level: 0, experience: 0 },
        }]);
        const sent = (await anna.get("/friend/request/sent").expect(200)).body;
        expect(sent).toEqual([{
            senderId: annaId, receiverId: brunoId, status: false,
            receiver: { id: brunoId, username: "bruno", bio: "", level: 0, experience: 0 },
        }]);
        expect((await anna.get("/friend/request").expect(200)).body).toEqual([]);
    });

    test("only the receiver can accept", async () => {
        await anna.put("/friend/request").send({ id: brunoId }).expect(200);
        expect((await prisma.friendRequest.findFirstOrThrow()).status).toBe(false);
        await bruno.put("/friend/request").send({ id: annaId }).expect(200, text("en", "friend.success.accept"));
        expect((await prisma.friendRequest.findFirstOrThrow()).status).toBe(true);
    });
});

describe("friends", () => {
    test("both sides see each other, with public fields only", async () => {
        const annasFriends = (await anna.get("/friend").query({ id: annaId }).expect(200)).body;
        expect(usernames(annasFriends)).toEqual(["bruno"]);
        expect(Object.keys(annasFriends[0]).sort()).toEqual(["bio", "experience", "id", "level", "username"]);
        expect(usernames((await bruno.get("/friend").query({ id: brunoId }).expect(200)).body)).toEqual(["anna"]);
        // a friend can see the list, a stranger can't
        expect(usernames((await bruno.get("/friend").query({ id: annaId }).expect(200)).body)).toEqual(["bruno"]);
        await carla.get("/friend").query({ id: annaId }).expect(403);
    });

    test("the profile counts friends and travelled km", async () => {
        await createTravel(annaId, null);
        await createTravel(annaId, null);
        const { body } = await carla.get("/user").query({ id: annaId }).expect(200);
        expect(body).toEqual({ username: "anna", bio: "", level: 0, experience: 0, friendsNumber: 1, totalTravelledLength: 7 });
    });

    test("a refused request is gone and can be sent again", async () => {
        await carla.post("/friend/request").send({ id: annaId }).expect(200);
        await anna.patch("/friend/request").send({ id: carlaId }).expect(200, text("en", "friend.success.refuse"));
        expect(await prisma.friendRequest.count({ where: { senderId: carlaId } })).toBe(0);
        await carla.post("/friend/request").send({ id: annaId }).expect(200);
    });

    test("either side can remove the friendship", async () => {
        await bruno.delete("/friend").query({ id: annaId }).expect(200, text("en", "friend.success.remove"));
        expect((await anna.get("/friend").query({ id: annaId }).expect(200)).body).toEqual([]);
        expect(await prisma.friendRequest.count({ where: { OR: [{ senderId: brunoId }, { receiverId: brunoId }] } })).toBe(0);
    });
});

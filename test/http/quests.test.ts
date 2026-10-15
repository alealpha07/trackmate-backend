import { beforeAll, describe, expect, test } from "vitest";
import app from "../../src/app.js";
import { assignDailyQuests } from "../../src/cronJob.js";
import { QUESTS_PER_VEHICLE } from "../../src/quests.js";
import { prisma } from "../../src/utils.js";
import { Client, createUser, signIn } from "../helpers/users.js";
import { text } from "../helpers/data.js";

let rider: Client;
let riderId: number;

beforeAll(async () => {
    ({ agent: rider, user: { id: riderId } } = await signIn(app, "rider", ["BICYCLE"]));
});

describe("daily quests", () => {
    test("each user gets quests for their vehicles, replaced every day", async () => {
        const everything = await createUser("everything");
        await assignDailyQuests();

        const riderQuests = await prisma.quest.findMany({ where: { userId: riderId } });
        expect(riderQuests).toHaveLength(QUESTS_PER_VEHICLE);
        expect(new Set(riderQuests.map((q) => q.vehicle))).toEqual(new Set(["BICYCLE"]));
        expect(new Set(riderQuests.map((q) => q.type)).size).toBe(QUESTS_PER_VEHICLE);
        expect(await prisma.quest.count({ where: { userId: everything.id } })).toBe(4 * QUESTS_PER_VEHICLE);

        await assignDailyQuests();
        const replaced = await prisma.quest.findMany({ where: { userId: riderId } });
        expect(replaced).toHaveLength(QUESTS_PER_VEHICLE);
        expect(replaced.map((q) => q.id).some((id) => riderQuests.some((q) => q.id === id))).toBe(false);
    });
});

describe("quest progress", () => {
    let questId: number;
    beforeAll(async () => {
        await prisma.quest.deleteMany();
        questId = (await prisma.quest.create({
            data: { userId: riderId, description: "Ride 10 km by bicycle", experience: 200, maxProgress: 10, type: "TRAVEL_DISTANCE", vehicle: "BICYCLE" },
        })).id;
        await prisma.quest.create({
            data: { userId: riderId, description: "Record 1 track by bicycle", experience: 30, maxProgress: 1, type: "RECORD_TRACK", vehicle: "BICYCLE" },
        });
    });

    const progressOf = async (id: number) => (await prisma.quest.findUniqueOrThrow({ where: { id } })).progress;

    test("the texts follow the request language", async () => {
        for (const language of ["en", "it", "de"]) {
            const { body } = await rider.get("/quest").set("Accept-Language", language).expect(200);
            const quest = body.find((q: any) => q.id === questId);
            expect(quest).toMatchObject({ vehicle: "bicycle", description: text(language, "quest.text.distance.bicycle", "10") });
        }
    });

    test("bad input is a 422", async () => {
        const send = (body: object) => rider.post("/quest").send({ type: "TRAVEL_DISTANCE", progress: 1, vehicle: "bicycle", ...body });
        await send({ type: "FLY_AROUND" }).expect(422, text("en", "quest.errors.type"));
        await send({ type: ["TRAVEL_DISTANCE"] }).expect(422, text("en", "quest.errors.type"));
        await send({ vehicle: "plane" }).expect(422, text("en", "track.errors.vehicle"));
        for (const progress of [-1, 1.5, 10_001, "abc", "1e9"]) {
            await send({ progress }).expect(422, text("en", "quest.errors.progress"));
        }
        expect(await progressOf(questId)).toBe(0);
    });

    test("only quests of that type and vehicle advance, up to the goal", async () => {
        await rider.post("/quest").send({ type: "TRAVEL_DISTANCE", progress: 3, vehicle: "bicycle" }).expect(200, text("en", "quest.success.update"));
        expect(await progressOf(questId)).toBe(3);
        await rider.post("/quest").send({ type: "TRAVEL_DISTANCE", progress: 3, vehicle: "car" }).expect(200);
        expect(await progressOf(questId)).toBe(3);
        await rider.post("/quest").send({ type: "TRAVEL_DISTANCE", progress: 50, vehicle: "bicycle" }).expect(200);
        expect(await progressOf(questId)).toBe(10);
        const record = await prisma.quest.findFirstOrThrow({ where: { type: "RECORD_TRACK" } });
        expect(record.progress).toBe(0);
    });

    test("collecting gives the experience once, and levels up past 1000", async () => {
        const record = await prisma.quest.findFirstOrThrow({ where: { type: "RECORD_TRACK" } });
        await rider.put("/quest").send({ id: record.id }).expect(200, text("en", "quest.errors.uncompleted"));

        await rider.put("/quest").send({ id: questId }).expect(200, text("en", "quest.success.collect"));
        expect(await prisma.user.findUniqueOrThrow({ where: { id: riderId } })).toMatchObject({ level: 0, experience: 200 });
        await rider.put("/quest").send({ id: questId }).expect(200, text("en", "quest.errors.missing"));

        await prisma.user.update({ where: { id: riderId }, data: { experience: 990 } });
        await prisma.quest.update({ where: { id: record.id }, data: { progress: 1 } });
        await rider.put("/quest").send({ id: record.id }).expect(200);
        expect(await prisma.user.findUniqueOrThrow({ where: { id: riderId } })).toMatchObject({ level: 1, experience: 0 });
    });
});

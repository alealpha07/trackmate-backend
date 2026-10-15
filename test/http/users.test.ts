import fs from "fs";
import sharp from "sharp";
import { beforeAll, describe, expect, test } from "vitest";
import app from "../../src/app.js";
import { profileImageFile } from "../../src/files.js";
import { prisma } from "../../src/utils.js";
import { Client, signIn } from "../helpers/users.js";
import { binary, image, text } from "../helpers/data.js";

let agent: Client;
let other: Client;
let userId: number;

beforeAll(async () => {
    ({ agent, user: { id: userId } } = await signIn(app, "profile"));
    other = (await signIn(app, "visitor")).agent;
});

describe("profile", () => {
    test("anyone logged in sees the public fields", async () => {
        const { body } = await other.get("/user").query({ id: userId }).expect(200);
        expect(body).toEqual({ username: "profile", bio: "", level: 0, experience: 0, friendsNumber: 0, totalTravelledLength: 0 });
        await other.get("/user").expect(422, /^Missing required parameters/);
        await other.get("/user").query({ id: 999_999 }).expect(422, text("en", "user.errors.missing"));
    });

    test("the bio: a string of at most 500 characters, empty allowed", async () => {
        await agent.put("/user").send({}).expect(422);
        await agent.put("/user").send({ bio: 5 }).expect(422);
        await agent.put("/user").send({ bio: "x".repeat(501) }).expect(422, text("en", "user.errors.bio-long", "500"));
        await agent.put("/user").send({ bio: "Hello" }).expect(200, text("en", "user.success.update"));
        expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).bio).toBe("Hello");
        await agent.put("/user").send({ bio: "" }).expect(200);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).bio).toBe("");
    });
});

describe("vehicles", () => {
    test("all of them by default, in the planner's order", async () => {
        expect((await agent.get("/user/vehicles").expect(200)).body).toEqual(["car", "motorcycle", "bicycle", "foot"]);
        const { body } = await agent.get("/vehicle").expect(200);
        expect(body.map((v: any) => v.id)).toEqual(["car", "motorcycle", "bicycle", "foot"]);
    });

    test("a list of known vehicles, at least one, duplicates merged", async () => {
        await agent.put("/user/vehicles").send({ vehicles: "bicycle" }).expect(422, text("en", "user.errors.vehicle"));
        await agent.put("/user/vehicles").send({ vehicles: ["bicycle", "plane"] }).expect(422, text("en", "user.errors.vehicle"));
        await agent.put("/user/vehicles").send({ vehicles: [] }).expect(422, text("en", "user.errors.no-vehicles"));
        await agent.put("/user/vehicles").send({ vehicles: ["FOOT", "bicycle", "foot"] }).expect(200, text("en", "user.success.vehicles"));
        expect((await agent.get("/user/vehicles").expect(200)).body).toEqual(["bicycle", "foot"]);
    });
});

describe("profile image", () => {
    test("stored as a 512 px JPEG, seen by others, deleted once", async () => {
        await other.get("/user/image").query({ id: userId }).expect(404);
        await agent.post("/user/image")
            .attach("file", Buffer.from("<svg/>"), { filename: "a.svg", contentType: "image/svg+xml" })
            .expect(422, text("en", "file.errors.invalid"));
        await agent.post("/user/image")
            .attach("file", await image("png", 900), { filename: "me.png", contentType: "image/png" })
            .expect(200);

        const response = await other.get("/user/image").query({ id: userId }).buffer(true).parse(binary).expect(200);
        const { format, width, height } = await sharp(response.body).metadata();
        expect({ format, width, height }).toEqual({ format: "jpeg", width: 512, height: 512 });

        await agent.delete("/user/image").expect(200, text("en", "file.success.delete"));
        expect(fs.existsSync(profileImageFile(userId))).toBe(false);
        await agent.delete("/user/image").expect(404);
    });
});

import { describe, expect, test } from "vitest";
import app from "../../src/app.js";
import { prisma } from "../../src/utils.js";
import { client, createUser, login, PASSWORD } from "../helpers/users.js";
import { text } from "../helpers/data.js";

const PUBLIC_FIELDS = ["bio", "experience", "id", "level", "username"];

let lastIp = 0;
// registering is limited per address, so each call comes from its own
const nextIp = () => `198.51.100.${++lastIp}`;

const valid = (username: string) => ({ username, password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true });

function register(body: object, language = "en", ip = nextIp()) {
    return client(app).post("/auth/register").set("Accept-Language", language).set("X-Forwarded-For", ip).send(body);
}

describe("register", () => {
    test("needs the terms accepted, with the error in the request language", async () => {
        for (const language of ["en", "it", "de"]) {
            const { acceptTerms, ...withoutTerms } = valid("anna");
            await register(withoutTerms, language).expect(422, text(language, "register.errors.terms"));
        }
        for (const acceptTerms of [false, "true", 1, null]) {
            await register({ ...valid("anna"), acceptTerms }).expect(422, text("en", "register.errors.terms"));
        }
        expect(await prisma.user.count({ where: { username: "anna" } })).toBe(0);
    });

    test("bad usernames and passwords", async () => {
        await register({}).expect(422, /^Missing required parameters/);
        for (const username of ["ab", "a".repeat(31), "with space", "semi;colon", "émile"]) {
            await register(valid(username)).expect(422, text("en", "register.errors.username"));
        }
        await register({ ...valid("bruno"), password: "short", confirmPassword: "short" })
            .expect(422, text("en", "register.errors.password-short"));
        const long = "x".repeat(73);
        await register({ ...valid("bruno"), password: long, confirmPassword: long })
            .expect(422, text("en", "register.errors.password-long"));
        await register({ ...valid("bruno"), confirmPassword: `${PASSWORD}!` })
            .expect(422, text("en", "register.errors.passwords-not-match"));
    });

    test("a taken username", async () => {
        await createUser("taken");
        await register(valid("taken")).expect(422, text("en", "register.errors.username-taken"));
    });

    test("stores a hash, the acceptance date and every vehicle, without logging in", async () => {
        const before = Date.now();
        const agent = client(app);
        await agent.post("/auth/register").set("X-Forwarded-For", nextIp()).send(valid("newbie"))
            .expect(200, text("en", "register.success"));

        const user = await prisma.user.findUniqueOrThrow({ where: { username: "newbie" }, include: { vehicles: true } });
        expect(user.password).not.toBe(PASSWORD);
        expect(user.password).toMatch(/^\$2[aby]\$12\$/);
        expect(user.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(user.termsAcceptedAt!.getTime()).toBeLessThanOrEqual(Date.now());
        expect(user.vehicles.map((v) => v.vehicle).sort()).toEqual(["BICYCLE", "CAR", "FOOT", "MOTORCYCLE"]);

        // the app logs in right after
        await agent.get("/auth/user").expect(401);
        const loggedIn = await login(app, "newbie");
        const { body } = await loggedIn.get("/auth/user").expect(200);
        expect(Object.keys(body).sort()).toEqual(PUBLIC_FIELDS);
        expect(body.username).toBe("newbie");
    });

    test("at most 5 attempts an hour from one address", async () => {
        const ip = "203.0.113.5";
        for (let i = 0; i < 5; i++) await register(valid("x"), "en", ip).expect(422);
        await register(valid("late"), "en", ip).expect(429, text("en", "server.too-many-requests"));
        await register(valid("late"), "de", nextIp()).expect(200, text("de", "register.success"));
    });
});

describe("login and logout", () => {
    test("wrong and unknown users get the same answer", async () => {
        await createUser("carla");
        const wrong = text("en", "auth.errors.wrong-credentials");
        await client(app).post("/auth/login").send({ username: "carla", password: "wrong-password" }).expect(401, wrong);
        await client(app).post("/auth/login").send({ username: "nobody", password: PASSWORD }).expect(401, wrong);
    });

    // passport answers arrays and objects itself, the rest reaches the strategy
    test("credentials that aren't text are a 401, never a 500", async () => {
        await createUser("hanna");
        const answers = [text("en", "auth.errors.wrong-credentials"), text("en", "Missing credentials")];
        for (const body of [{ username: 123, password: PASSWORD }, { username: "hanna", password: 123 }, { username: ["hanna"], password: PASSWORD }, { username: "hanna", password: { a: 1 } }]) {
            const response = await client(app).post("/auth/login").send(body).expect(401);
            expect(answers, JSON.stringify(body)).toContain(response.text);
        }
    });

    test("a session cookie that scripts can't read, gone after logout", async () => {
        await createUser("dario");
        const agent = client(app);
        const response = await agent.post("/auth/login").send({ username: "dario", password: PASSWORD })
            .expect(200, text("en", "login.success"));
        const cookie = response.headers["set-cookie"]?.[0] ?? "";
        expect(cookie).toMatch(/^connect\.sid=/);
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Lax/);

        await agent.get("/auth/user").expect(200);
        await agent.post("/auth/logout").expect(200, text("en", "logout.success"));
        await agent.get("/auth/user").expect(401, text("en", "auth.errors.unauthorized"));
    });

    test("10 wrong passwords lock that username from that address", async () => {
        await createUser("elena");
        await createUser("fabio");
        const ip = "203.0.113.20";
        const attempt = (username: string, password: string, from = ip) =>
            client(app).post("/auth/login").set("X-Forwarded-For", from).send({ username, password });

        for (let i = 0; i < 10; i++) await attempt("elena", "wrong-password").expect(401);
        await attempt("elena", PASSWORD).expect(429, text("en", "auth.errors.too-many-attempts"));
        await attempt("fabio", PASSWORD).expect(200);
        await attempt("elena", PASSWORD, "203.0.113.21").expect(200);
    });
});

describe("change password", () => {
    test("checks the old one and logs out the other sessions", async () => {
        await createUser("gina");
        const phone = await login(app, "gina");
        const laptop = await login(app, "gina");
        const newPassword = "another-long-password";

        await phone.put("/auth/password").send({ oldPassword: "wrong-password", newPassword })
            .expect(403, text("en", "auth.errors.wrong-password"));
        await phone.put("/auth/password").send({ oldPassword: PASSWORD, newPassword: "short" })
            .expect(422, text("en", "register.errors.password-short"));
        await phone.put("/auth/password").send({ oldPassword: PASSWORD, newPassword })
            .expect(200, text("en", "auth.success.password"));

        await phone.get("/auth/user").expect(200);
        await laptop.get("/auth/user").expect(401);
        await client(app).post("/auth/login").send({ username: "gina", password: PASSWORD }).expect(401);
        await login(app, "gina", newPassword);
    });
});

import type { ILayer, Router } from "express-serve-static-core";
import { beforeAll, describe, expect, test } from "vitest";
import app from "../../src/app.js";
import auth from "../../src/routes/auth.js";
import user from "../../src/routes/user.js";
import friend from "../../src/routes/friend.js";
import post from "../../src/routes/post.js";
import quest from "../../src/routes/quest.js";
import track from "../../src/routes/track.js";
import search from "../../src/routes/search.js";
import route from "../../src/routes/route.js";
import vehicle from "../../src/routes/vehicle.js";
import share from "../../src/routes/share.js";
import legal from "../../src/routes/legal.js";
import { client, Client, signIn } from "../helpers/users.js";
import { image, text, trackJson } from "../helpers/data.js";

const MOUNTS: [Router, string][] = [
    [auth, "/auth"], [user, "/user"], [friend, "/friend"], [post, "/post"], [quest, "/quest"], [track, "/track"],
    [search, "/search"], [route, "/route"], [vehicle, "/vehicle"], [legal, ""], [share, ""],
];

// a new route goes in one of these two lists
const PUBLIC = [
    "GET /", "GET /privacy", "GET /terms", "GET /.well-known/assetlinks.json", "GET /p/:id", "GET /p/:id/image",
    "POST /auth/register", "POST /auth/login", "POST /auth/logout",
];
const PROTECTED = [
    "PUT /auth/password", "GET /auth/user",
    "POST /user/image", "GET /user/image", "DELETE /user/image", "PUT /user", "GET /user/vehicles", "PUT /user/vehicles",
    "GET /user", "GET /user/export", "DELETE /user",
    "POST /friend/request", "PUT /friend/request", "PATCH /friend/request", "DELETE /friend", "GET /friend/request",
    "GET /friend/request/sent", "GET /friend",
    "POST /post/image", "GET /post/image", "POST /post", "PUT /post", "DELETE /post", "GET /post", "POST /post/like",
    "DELETE /post/like", "POST /post/save", "DELETE /post/save", "GET /post/user", "GET /post/friends", "GET /post/saved",
    "GET /post/trending",
    "POST /quest", "PUT /quest", "GET /quest",
    "POST /track/file", "GET /track/file", "GET /track/instructions", "POST /track", "POST /track/travel",
    "POST /track/travel/file", "GET /track/travel/file", "DELETE /track/travel", "GET /track/travel",
    "GET /track/travel/details", "GET /track/leaderboard", "PUT /track", "DELETE /track", "GET /track", "GET /track/details",
    "GET /search",
    "POST /route/plan", "GET /route/geocode",
    "GET /vehicle",
];

function appRoutes(): string[] {
    const routes: string[] = [];
    const walk = (prefix: string, stack: ILayer[]) => {
        for (const layer of stack) {
            if (layer.route) {
                const path = `${prefix}${layer.route.path}`.replace(/(.)\/$/, "$1");
                for (const method of new Set(layer.route.stack.map((l) => l.method.toUpperCase()))) routes.push(`${method} ${path}`);
                continue;
            }
            const mount = MOUNTS.find(([router]) => (router as unknown) === layer.handle);
            if (mount) walk(mount[1], mount[0].stack);
            else if ("stack" in layer.handle) throw new Error(`A router not in MOUNTS: ${layer.name}`);
        }
    };
    walk("", app.router.stack);
    return routes;
}

const call = (agent: Client, route: string) => {
    const [method, path] = route.split(" ");
    return agent[method.toLowerCase() as "get"](path.replace(":id", "1"));
};

describe("route table", () => {
    test("every route is listed as public or protected", () => {
        const routes = appRoutes();
        expect(routes.length).toBeGreaterThan(50);
        expect([...routes].sort()).toEqual([...PUBLIC, ...PROTECTED].sort());
    });

    test("protected routes answer 401 without a session", async () => {
        for (const route of PROTECTED) {
            await call(client(app), route).expect(401, text("en", "auth.errors.unauthorized")).catch((error) => {
                throw new Error(`${route}: ${error.message}`);
            });
        }
    });

    // login without a body is a 401 too, but from passport, not the session check
    test("public routes answer without a session", async () => {
        for (const route of PUBLIC) {
            const response = await call(client(app), route);
            expect(response.text, route).not.toBe(text("en", "auth.errors.unauthorized"));
            expect(response.status, route).toBeLessThan(500);
        }
    });
});

type Where = "query" | "body";
// routes that take an id, with the other fields they need
const ID_ROUTES: [string, Where, object?][] = [
    ["GET /user", "query"], ["GET /user/image", "query"],
    ["POST /friend/request", "body"], ["PUT /friend/request", "body"], ["PATCH /friend/request", "body"],
    ["DELETE /friend", "query"], ["GET /friend", "query"],
    ["GET /post", "query"], ["POST /post", "body", { title: "t", description: "d" }],
    ["PUT /post", "body", { title: "t", description: "d" }], ["DELETE /post", "query"], ["POST /post/like", "body"],
    ["DELETE /post/like", "query"], ["POST /post/save", "body"], ["DELETE /post/save", "query"], ["GET /post/user", "query"],
    ["GET /post/image", "query", { index: "0" }],
    ["PUT /quest", "body"],
    ["GET /track/file", "query"], ["GET /track/instructions", "query"],
    ["POST /track/travel", "body", { time: 60, averageSpeed: 10, maxSpeed: 20, distance: 1 }],
    ["GET /track/travel/file", "query"], ["DELETE /track/travel", "query"], ["GET /track/travel/details", "query"],
    ["GET /track/leaderboard", "query"], ["PUT /track", "body", { name: "n" }], ["DELETE /track", "query"],
    ["GET /track/details", "query"],
];
const BAD_QUERY_IDS = ["abc", "0", "-1", "1.5", "../1", "1e3", "99999999999"];
const BAD_BODY_IDS = ["abc", "../1", 1.5, -1, 0, [1], { id: 1 }, true];

describe("ids from requests", () => {
    let agent: Client;
    beforeAll(async () => {
        ({ agent } = await signIn(app, "ids"));
    });

    const expect4xx = (status: number, label: string) => {
        expect(status, label).toBeGreaterThanOrEqual(400);
        expect(status, label).toBeLessThan(500);
    };

    test("bad ids get a 4xx, never a 500", async () => {
        for (const [route, where, extra] of ID_ROUTES) {
            for (const id of where === "query" ? BAD_QUERY_IDS : BAD_BODY_IDS) {
                const request = call(agent, route);
                const { status } = where === "query" ? await request.query({ ...extra, id }) : await request.send({ ...extra, id });
                expect4xx(status, `${route} id=${JSON.stringify(id)}`);
            }
        }
    });

    test("uploads with bad ids", async () => {
        const jpeg = await image();
        for (const id of BAD_QUERY_IDS) {
            const { status: postImage } = await agent.post("/post/image").query({ id }).attach("file", jpeg, { filename: "a.jpg", contentType: "image/jpeg" });
            expect4xx(postImage, `POST /post/image id=${id}`);
            const { status: trackFile } = await agent.post("/track/file").query({ id }).attach("file", trackJson(), { filename: "t.json", contentType: "application/json" });
            expect4xx(trackFile, `POST /track/file id=${id}`);
            const { status: travelFile } = await agent.post("/track/travel/file").query({ id }).attach("file", trackJson(), { filename: "t.json", contentType: "application/json" });
            expect4xx(travelFile, `POST /track/travel/file id=${id}`);
        }
    });

    test("shared pages with bad ids are a 404", async () => {
        for (const id of BAD_QUERY_IDS) {
            await client(app).get(`/p/${encodeURIComponent(id)}`).expect(404);
            await client(app).get(`/p/${encodeURIComponent(id)}/image`).expect(404);
        }
    });
});

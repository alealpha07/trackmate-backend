import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, test } from "vitest";
import app from "../../src/app.js";
import { postImageFile } from "../../src/files.js";
import { prisma } from "../../src/utils.js";
import { client, signIn } from "../helpers/users.js";
import { binary, createPost, createTrack, image, text } from "../helpers/data.js";

const LEGAL_DIR = path.join(import.meta.dirname, "..", "..", "legal");
const SCRIPT_TITLE = `<script>alert("x")</script>`;

const firstHeading = (name: string, language: string) =>
    fs.readFileSync(path.join(LEGAL_DIR, `${name}.${language}.html`), "utf8").match(/<h2>.*?<\/h2>/)![0];

describe("shared posts, /p/:id", () => {
    let plainId: number;
    let pictureId: number;

    beforeAll(async () => {
        const { user } = await signIn(app, "sharer");
        const track = await createTrack(user.id);
        plainId = (await createPost(track.id, SCRIPT_TITLE, `<img src=x onerror="alert(1)">`)).id;
        pictureId = (await createPost(track.id, "Lake", "Flat and quiet")).id;
        await prisma.post.update({ where: { id: pictureId }, data: { imageCount: 1 } });
        fs.mkdirSync(path.dirname(postImageFile(pictureId, 0)), { recursive: true });
        fs.writeFileSync(postImageFile(pictureId, 0), await image());
    });

    test("anyone can open it, search engines are asked to stay out", async () => {
        const response = await client(app).get(`/p/${pictureId}`).expect(200).expect("Content-Type", /^text\/html/);
        expect(response.headers["x-robots-tag"]).toBe("noindex");
        expect(response.text).toContain(`<meta name="robots" content="noindex">`);
        expect(response.text).toContain(`<meta property="og:title" content="Lake">`);
        expect(response.text).toMatch(new RegExp(`<meta property="og:url" content="https://[^"]+/p/${pictureId}">`));
        expect(response.text).toMatch(new RegExp(`<meta property="og:image" content="https://[^"]+/p/${pictureId}/image">`));
        expect(response.text).toContain(`<span class="user">sharer</span>`);
        expect(response.text).toContain(`<a href="/privacy?lang=en">`);
    });

    test("titles and descriptions are escaped", async () => {
        const { text: html } = await client(app).get(`/p/${plainId}`).expect(200);
        expect(html).not.toContain("<script>alert");
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
        expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
        expect(html).not.toContain("og:image");
    });

    test("the cover image, only for posts that have one", async () => {
        const response = await client(app).get(`/p/${pictureId}/image`).buffer(true).parse(binary)
            .expect(200).expect("Content-Type", "image/jpeg").expect("Cache-Control", "public, max-age=3600");
        expect(response.body).toEqual(fs.readFileSync(postImageFile(pictureId, 0)));
        await client(app).get(`/p/${plainId}/image`).expect(404);
    });

    test("a missing post is a 404 page in the visitor's language", async () => {
        const { text: html } = await client(app).get("/p/999999").set("Accept-Language", "de").expect(404);
        expect(html).toContain(`<html lang="de">`);
        expect(html).toContain(text("de", "share.not-found-title"));
    });
});

describe("assetlinks.json", () => {
    test("names the app package", async () => {
        const { body } = await client(app).get("/.well-known/assetlinks.json").expect(200).expect("Content-Type", /json/);
        expect(body).toEqual([{
            relation: ["delegate_permission/common.handle_all_urls"],
            target: { namespace: "android_app", package_name: process.env.ANDROID_PACKAGE_NAME || "com.example.trackmate", sha256_cert_fingerprints: expect.any(Array) },
        }]);
    });
});

describe("privacy notice and terms", () => {
    for (const name of ["privacy", "terms"] as const) {
        test(`/${name} in every language`, async () => {
            for (const language of ["en", "it", "de"]) {
                for (const request of [
                    client(app).get(`/${name}`).query({ lang: language }),
                    client(app).get(`/${name}`).set("Accept-Language", language),
                ]) {
                    const { text: html } = await request.expect(200).expect("Content-Type", /^text\/html/);
                    expect(html).toContain(`<html lang="${language}">`);
                    expect(html).toContain(`<h1>${text(language, `legal.${name}`)}</h1>`);
                    expect(html).toContain(firstHeading(name, language));
                    expect(html).toContain(`<nav class="languages">`);
                    expect(html).toContain(`<footer class="legal-links">`);
                }
            }
        });
    }

    test("other languages get English", async () => {
        const { text: html } = await client(app).get("/privacy").set("Accept-Language", "fr").expect(200);
        expect(html).toContain(`<html lang="en">`);
        expect(html).toContain(firstHeading("privacy", "en"));
    });

    test("app=1 drops the header, title, languages and footer for the app's WebView", async () => {
        const { text: html } = await client(app).get("/terms").query({ app: "1", lang: "it" }).expect(200);
        expect(html).toContain(firstHeading("terms", "it"));
        for (const part of [`class="app-bar"`, "<h1>", `class="languages"`, `class="legal-links"`]) expect(html).not.toContain(part);
    });
});

describe("headers and the front door", () => {
    test("a content security policy that allows only the map tiles from outside", async () => {
        const response = await client(app).get("/privacy").expect(200);
        const csp = response.headers["content-security-policy"];
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("img-src 'self' data: blob: https://tiles.stadiamaps.com");
        expect(csp).toContain("connect-src 'self' https://tiles.stadiamaps.com");
        expect(csp).not.toContain("upgrade-insecure-requests");
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
        expect(response.headers["x-powered-by"]).toBeUndefined();
    });

    test("/ sends visitors to the login and users to the planner", async () => {
        await client(app).get("/").redirects(0).expect(302).expect("Location", "/login");
        const { agent } = await signIn(app, "visitor");
        await agent.get("/").redirects(0).expect(302).expect("Location", "/plan");
        await client(app).get("/login").expect(200).expect("Content-Type", /^text\/html/);
    });

    test("bodies that are too large or broken", async () => {
        await client(app).post("/auth/login").send({ username: "x", password: "y".repeat(1024 * 1024) })
            .expect(413, text("en", "server.too-large"));
        await client(app).post("/auth/login").set("Content-Type", "application/json").send(`{"username":`)
            .expect(400, text("en", "server.bad-request"));
    });
});

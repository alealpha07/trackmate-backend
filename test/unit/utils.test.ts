import { describe, expect, test } from "vitest";
import { canSeeRoute, parseId, prisma, sanitizeParams } from "../../src/utils.js";
import { escapeHtml } from "../../src/pages.js";

describe("parseId", () => {
    test("positive 32-bit integers", () => {
        expect(parseId("1")).toBe(1);
        expect(parseId(42)).toBe(42);
        expect(parseId("2147483647")).toBe(2_147_483_647);
    });

    test("anything else is null", () => {
        for (const value of ["0", "-1", "01", "1.5", "1e3", " 1", "1 ", "abc", "", "../1", "2147483648", 0, 1.5, -3, null, undefined, {}, [1]]) {
            expect(parseId(value), String(value)).toBeNull();
        }
    });
});

describe("sanitizeParams", () => {
    test("missing, empty and null count as missing", () => {
        const { sanitizedParams, missingParams } = sanitizeParams(["a", "b", "c", "d", "e"], { a: 1, b: "", c: null, e: 0 });
        expect(sanitizedParams).toEqual({ a: 1, e: 0 });
        expect(missingParams).toEqual(["b", "c", "d"]);
    });
});

describe("escapeHtml", () => {
    test("the five special characters", () => {
        expect(escapeHtml(`<script>alert("x" & 'y')</script>`))
            .toBe("&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;");
    });
});

describe("canSeeRoute", () => {
    test("own tracks, posted tracks and tracks travelled", async () => {
        const owner = await prisma.user.create({ data: { username: "owner", password: "x" } });
        const other = await prisma.user.create({ data: { username: "other", password: "x" } });
        const hidden = await prisma.track.create({ data: { userId: owner.id, name: "hidden", vehicle: "BICYCLE" } });
        const posted = await prisma.track.create({ data: { userId: owner.id, name: "posted", vehicle: "BICYCLE" } });
        await prisma.post.create({ data: { trackId: posted.id, title: "t", description: "d" } });
        const travelled = await prisma.track.create({ data: { userId: owner.id, name: "travelled", vehicle: "BICYCLE" } });
        await prisma.travel.create({
            data: {
                trackId: travelled.id, userId: other.id, time: 60, dateTime: new Date(), maxSpeed: 20, averageSpeed: 15,
                distance: 1, vehicle: "BICYCLE",
            },
        });

        expect(await canSeeRoute(owner.id, hidden.id)).toBe(true);
        expect(await canSeeRoute(other.id, hidden.id)).toBe(false);
        expect(await canSeeRoute(other.id, posted.id)).toBe(true);
        expect(await canSeeRoute(other.id, travelled.id)).toBe(true);
        expect(await canSeeRoute(other.id, 999_999)).toBe(false);
    });
});

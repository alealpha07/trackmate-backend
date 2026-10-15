import { expect, Page, test as base } from "@playwright/test";
import { STRINGS } from "../../public/js/strings.js";
import { RIDER } from "./seed.js";

export { expect, STRINGS };
export type Language = "en" | "it" | "de";

// 1x1 transparent PNG, so the map loads without contacting Stadia
const BLANK_TILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
// the pages show API errors themselves, the browser logs them too
const API_ERROR = /^Failed to load resource: the server responded with a status of 4\d\d/;

interface Guards {
    outside: string[];
    consoleErrors: string[];
}

export const test = base.extend<Guards>({
    outside: [async ({ context, baseURL }, use) => {
        const outside: string[] = [];
        const origin = new URL(baseURL!).origin;
        await context.route("**/*", (route) => {
            const url = route.request().url();
            if (new URL(url).origin === origin) return route.fallback();
            if (url.startsWith("https://tiles.stadiamaps.com/")) return route.fulfill({ contentType: "image/png", body: BLANK_TILE });
            outside.push(url);
            return route.abort("blockedbyclient");
        });
        await use(outside);
        expect(outside, "requests to other hosts").toEqual([]);
    }, { auto: true }],

    // CSP violations show up here too
    consoleErrors: [async ({ page }, use) => {
        const errors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error" && !API_ERROR.test(message.text())) errors.push(message.text());
        });
        page.on("pageerror", (error) => errors.push(error.message));
        await use(errors);
        expect(errors, "console errors").toEqual([]);
    }, { auto: true }],
});

export async function logIn(page: Page) {
    const response = await page.request.post("/auth/login", { data: RIDER });
    expect(response.ok()).toBe(true);
}

export async function openSettings(page: Page, language: Language = "en") {
    await page.getByRole("button", { name: STRINGS[language]["plan.settings"], exact: true }).click();
}

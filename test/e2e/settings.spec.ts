import type { Page } from "@playwright/test";
import { expect, Language, logIn, openSettings, STRINGS, test } from "./fixtures.js";
import { RIDER } from "./seed.js";

const LIGHT_BACKGROUND = "rgb(245, 245, 245)";
const DARK_BACKGROUND = "rgb(18, 18, 18)";

// some labels repeat, "System" is a theme and a language
async function choose(page: Page, group: "plan.theme" | "plan.language", label: string, language: Language = "en") {
    await openSettings(page, language);
    const fieldset = page.locator(".settings fieldset", { has: page.locator("legend", { hasText: STRINGS[language][group] }) });
    await fieldset.getByLabel(label, { exact: true }).click();
}

const background = (page: Page) => page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);

test.beforeEach(async ({ page }) => {
    await logIn(page);
    await page.goto("/plan");
});

test("the language is kept across reloads and pages, and reaches the server", async ({ page }) => {
    await choose(page, "plan.language", "Italiano");
    await expect(page.locator("html")).toHaveAttribute("lang", "it");
    await expect(page.locator("h1")).toHaveText(STRINGS.it["plan.title"]);

    await page.reload();
    await expect(page.locator("h1")).toHaveText(STRINGS.it["plan.title"]);
    await openSettings(page, "it");
    await expect(page.locator(".control-menu .menu-links a").first()).toHaveAttribute("href", "/privacy?lang=it");

    const vehicles = page.waitForRequest("**/vehicle");
    await page.reload();
    expect((await vehicles).headers()["accept-language"]).toBe("it");

    await page.goto("/login");
    await expect(page).toHaveURL(/\/plan$/);
    await page.goto("/credits");
    await expect(page.locator("html")).toHaveAttribute("lang", "it");

    await page.goto("/plan");
    await choose(page, "plan.language", STRINGS.it["plan.languageSystem"], "it");
    await expect(page.locator("h1")).toHaveText(STRINGS.en["plan.title"]);
});

test("the theme is kept across reloads and pages", async ({ page }) => {
    expect(await background(page)).toBe(LIGHT_BACKGROUND);
    await choose(page, "plan.theme", STRINGS.en["plan.themeDark"]);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await background(page)).toBe(DARK_BACKGROUND);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.goto("/privacy");
    expect(await background(page)).toBe(DARK_BACKGROUND);

    await page.goto("/plan");
    await choose(page, "plan.theme", STRINGS.en["plan.themeSystem"]);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    expect(await background(page)).toBe(LIGHT_BACKGROUND);
});

test.describe("a German browser", () => {
    test.use({ locale: "de-DE" });

    test("gets German pages and German server errors", async ({ page }) => {
        await page.request.post("/auth/logout");
        await page.goto("/login");
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
        await expect(page.locator("h1")).toHaveText(STRINGS.de["login.title"]);

        await page.locator("#username").fill(RIDER.username);
        await page.locator("#password").fill("wrong-password");
        await page.locator("button[type=submit]").click();
        const german = await (await page.request.post("/auth/login", {
            data: { username: RIDER.username, password: "wrong-password" },
            headers: { "Accept-Language": "de" },
        })).text();
        await expect(page.locator("#error")).toHaveText(german);
    });
});

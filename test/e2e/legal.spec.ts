import { expect, STRINGS, test } from "./fixtures.js";

const en = STRINGS.en;

test("the footer and the language links move between the legal pages", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: en["legal.privacy"] })).toBeVisible();

    await page.locator("footer.legal-links a", { hasText: en["legal.terms"] }).click();
    await expect(page).toHaveURL(/\/terms\?lang=en$/);
    await expect(page.getByRole("heading", { level: 1, name: en["legal.terms"] })).toBeVisible();

    await page.locator("nav.languages a", { hasText: "Deutsch" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("heading", { level: 1, name: STRINGS.de["legal.terms"] })).toBeVisible();
    await expect(page.locator("footer.legal-links a").first()).toHaveAttribute("href", "/privacy?lang=de");
});

test("the legal pages follow a dark system theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    for (const url of ["/privacy", "/terms", "/login"]) {
        await page.goto(url);
        expect(await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor), url).toBe("rgb(18, 18, 18)");
    }
});

test("the credits page loads", async ({ page }) => {
    await page.goto("/credits");
    await expect(page.locator("h1")).toHaveText(en["credits.title"]);
    await expect(page.locator(".legal-links a").first()).toHaveAttribute("href", "/privacy?lang=en");
});

import { expect, logIn, STRINGS, test } from "./fixtures.js";
import { RIDER } from "./seed.js";

const en = STRINGS.en;

test("logged out, / goes to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("h1")).toHaveText(en["login.title"]);
    await expect(page.locator(".legal-links a")).toHaveText([en["legal.privacy"], en["legal.terms"]]);
});

test("a wrong password shows the server's message, the right one opens the planner", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#username").fill(RIDER.username);
    await page.locator("#password").fill("wrong-password");
    await page.locator("button[type=submit]").click();
    await expect(page.locator("#error")).toBeVisible();
    await expect(page.locator("#error")).not.toBeEmpty();
    await expect(page).toHaveURL(/\/login$/);

    await page.locator("#password").fill(RIDER.password);
    await page.locator("button[type=submit]").click();
    await expect(page).toHaveURL(/\/plan$/);
});

test("logged in, the login page and / go to the planner", async ({ page }) => {
    await logIn(page);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/plan$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/plan$/);
});

test.describe("register", () => {
    test("links the terms and privacy notice next to the checkbox", async ({ page }) => {
        await page.goto("/register");
        const links = page.locator("#acceptText a");
        await expect(links).toHaveText([en["legal.terms"], en["legal.privacy"]]);
        await expect(links.nth(0)).toHaveAttribute("href", "/terms?lang=en");
        await expect(links.nth(1)).toHaveAttribute("href", "/privacy?lang=en");
        await expect(links.nth(0)).toHaveAttribute("target", "_blank");

        const popup = page.waitForEvent("popup");
        await links.nth(1).click();
        await expect((await popup).getByRole("heading", { level: 1, name: en["legal.privacy"] })).toBeVisible();
    });

    test("needs the checkbox, then logs straight in", async ({ page }) => {
        let registered = false;
        page.on("request", (request) => (registered ||= request.url().endsWith("/auth/register")));
        await page.goto("/register");
        await page.locator("#username").fill("newcomer");
        await page.locator("#password").fill("a-long-password");
        await page.locator("#confirmPassword").fill("a-long-password");
        const terms = page.locator("input[name=acceptTerms]");

        await page.locator("button[type=submit]").click();
        expect(await terms.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
        await expect(page).toHaveURL(/\/register$/);
        expect(registered).toBe(false);

        await terms.check();
        await page.locator("button[type=submit]").click();
        await expect(page).toHaveURL(/\/plan$/);
    });

    test("server errors are shown on the form", async ({ page }) => {
        await page.goto("/register");
        await page.locator("#username").fill(RIDER.username);
        await page.locator("#password").fill("a-long-password");
        await page.locator("#confirmPassword").fill("a-long-password");
        await page.locator("input[name=acceptTerms]").check();
        await page.locator("button[type=submit]").click();
        await expect(page.locator("#error")).toBeVisible();
        await expect(page).toHaveURL(/\/register$/);
    });
});

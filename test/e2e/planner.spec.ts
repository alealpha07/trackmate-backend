import type { Page } from "@playwright/test";
import { expect, logIn, openSettings, STRINGS, test } from "./fixtures.js";

const en = STRINGS.en;
// inside the fixture tiles
const START = "44.7815, 9.846";
const END = "44.7815, 9.856";
const STOP = "44.776, 9.856";

async function setPoint(page: Page, input: string, text: string) {
    await page.locator(input).fill(text);
    await page.locator(input).press("Tab");
}

async function planAndWait(page: Page) {
    const request = page.waitForRequest("**/route/plan?stream=1");
    await page.locator("#plan").click();
    await expect(page.locator("#result")).toBeVisible();
    return (await request).postDataJSON();
}

const kilometers = async (page: Page) => Number((await page.locator("#distance").textContent())!.replace(" km", ""));

test.beforeEach(async ({ page }) => {
    await logIn(page);
    await page.goto("/plan");
    await expect(page.locator("h1")).toHaveText(en["plan.title"]);
});

test("plans with Safest and Shortest from typed coordinates", async ({ page }) => {
    await expect(page.locator("#plan")).toBeDisabled();
    await setPoint(page, "#start-input", START);
    await setPoint(page, "#end-input", END);
    await expect(page.locator(".map-pin")).toHaveCount(2);

    const safest = await planAndWait(page);
    expect(safest).toMatchObject({ start: { lat: 44.7815, lng: 9.846 }, end: { lat: 44.7815, lng: 9.856 }, via: [], vehicle: "bicycle", policy: "safest" });
    await expect(page.locator("#distance")).toHaveText(/^\d+\.\d km$/);
    await expect(page.locator("#duration")).toHaveText(/^\d+ min$/);
    await expect(page.locator("#off-bikeways-item")).toBeVisible();
    await expect(page.locator("#legs")).toBeHidden();
    const safestKm = await kilometers(page);

    await page.locator(".segmented label", { hasText: en["plan.shortest"] }).click();
    await expect(page.locator("#result")).toBeHidden();
    await expect(page.locator(".filters[data-policy=safest]")).toBeHidden();
    const shortest = await planAndWait(page);
    expect(shortest).toMatchObject({ policy: "shortest" });
    expect(shortest).not.toHaveProperty("maxDetour");
    expect(await kilometers(page)).toBeLessThanOrEqual(safestKm);
});

test("a stop splits the route into legs", async ({ page }) => {
    await setPoint(page, "#start-input", START);
    await setPoint(page, "#end-input", END);
    await page.locator("#add-stop").click();
    const stop = page.locator(".point[data-role=stop] input");
    await expect(stop).toBeFocused();
    await stop.fill(STOP);
    await stop.press("Tab");

    const body = await planAndWait(page);
    expect(body.via).toEqual([{ lat: 44.776, lng: 9.856 }]);
    const legs = page.locator("#legs li");
    await expect(legs).toHaveCount(2);
    await expect(legs.nth(0).locator(".leg-name")).toHaveText(`${en["plan.start"]} → ${en["plan.stop"].replace("{0}", "1")}`);
    await expect(legs.nth(1).locator(".leg-name")).toHaveText(`${en["plan.stop"].replace("{0}", "1")} → ${en["plan.destination"]}`);
});

test("a point too far away is flagged before asking the server", async ({ page }) => {
    let planned = false;
    page.on("request", (request) => (planned ||= request.url().includes("/route/plan")));
    await setPoint(page, "#start-input", START);
    await setPoint(page, "#end-input", "45.5, 9.846");

    const hint = page.locator(".points .hint");
    await expect(hint).toHaveClass(/error/);
    await expect(hint).toHaveText(/^.+ → .+ is 79\.\d km in a straight line/);
    await expect(page.locator(".point.too-far")).toHaveCount(2);
    await expect(page.locator("#plan")).toBeDisabled();
    expect(planned).toBe(false);
});

test("the detour slider sets maxDetour", async ({ page }) => {
    await setPoint(page, "#start-input", START);
    await setPoint(page, "#end-input", END);
    const slider = page.locator("input[name=maxDetour]");
    const shown = page.locator("#max-detour-value");

    await expect(shown).toHaveText("25%");
    expect(await planAndWait(page)).toMatchObject({ maxDetour: 25, filters: { cyclewaysOnly: true, avoidLts4: true, avoidUnpaved: false } });

    await slider.fill("0");
    await expect(shown).toHaveText("10%");
    expect((await planAndWait(page)).maxDetour).toBe(10);

    await slider.fill("4");
    await expect(shown).toHaveText(en["plan.noLimit"]);
    expect(await planAndWait(page)).not.toHaveProperty("maxDetour");
});

test("the settings menu links the privacy notice and terms", async ({ page }) => {
    await openSettings(page);
    const links = page.locator(".control-menu .menu-links a");
    await expect(links).toHaveText([en["legal.privacy"], en["legal.terms"]]);
    await expect(links.nth(0)).toHaveAttribute("href", "/privacy?lang=en");
    await expect(links.nth(1)).toHaveAttribute("href", "/terms?lang=en");

    const popup = page.waitForEvent("popup");
    await links.nth(1).click();
    await expect((await popup).getByRole("heading", { level: 1, name: en["legal.terms"] })).toBeVisible();
});

test("logout goes back to the login page", async ({ page }) => {
    await page.locator("#logout").click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/plan");
    await expect(page).toHaveURL(/\/login$/);
});

test("the keyboard picks a suggestion and Tab moves on to the next field", async ({ page }) => {
    const start = page.locator("#start-input");
    await start.fill(START);
    await expect(start).toHaveAttribute("aria-expanded", "true");
    await start.press("ArrowDown");
    const option = page.locator("#point-list .point").first().locator("[role=option]").first();
    await expect(option).toHaveAttribute("aria-selected", "true");
    await expect(start).toHaveAttribute("aria-activedescendant", (await option.getAttribute("id"))!);
    await start.press("Enter");
    await expect(page.locator(".map-pin")).toHaveCount(1);

    await page.locator("#end-input").fill(END);
    await page.locator("#end-input").press("Tab");
    await expect(page.locator("#end-input")).not.toBeFocused();
    await expect(page.locator("body")).not.toBeFocused();
    await expect(page.locator(".map-pin")).toHaveCount(2);
});

test("decimal commas, and numbers out of range get a message", async ({ page }) => {
    await setPoint(page, "#start-input", "44,7815, 9,846");
    await expect(page.locator("#start-input")).toHaveValue("44.78150, 9.84600");
    await page.locator("#end-input").fill("95, 10");
    await expect(page.locator("#point-list .point").last().locator(".suggestions")).toHaveText(en["plan.coordinatesOutOfRange"]);
});

test("at most 10 stops", async ({ page }) => {
    for (let i = 0; i < 10; i++) await page.locator("#add-stop").click();
    await expect(page.locator(".point[data-role=stop]")).toHaveCount(10);
    await expect(page.locator("#add-stop")).toBeDisabled();
    await page.locator(".point[data-role=stop] .remove").first().click();
    await expect(page.locator("#add-stop")).toBeEnabled();
});

test("an unreachable server is a translated message, and focus stays usable after planning", async ({ page, consoleErrors }) => {
    await setPoint(page, "#start-input", START);
    await setPoint(page, "#end-input", END);
    await page.route("**/route/plan?stream=1", (route) => route.abort("internetdisconnected"));
    await page.locator("#plan").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#status")).toHaveText(en["error.offline"]);
    await expect(page.locator("#plan")).toBeFocused();
    // the browser logs the failed request itself
    expect(consoleErrors.splice(0)).toEqual(["Failed to load resource: net::ERR_INTERNET_DISCONNECTED"]);

    await page.unroute("**/route/plan?stream=1");
    await page.keyboard.press("Enter");
    await expect(page.locator("#result")).toBeFocused();
});

test("buttons and the slider have names in the page language", async ({ page }) => {
    await expect(page.locator("#reverse")).toHaveAttribute("aria-label", en["plan.reverse"]);
    await expect(page.locator("input[name=maxDetour]")).toHaveAttribute("aria-label", en["plan.maxDetour"]);
    await expect(page.locator("input[name=maxDetour]")).toHaveAttribute("aria-valuetext", "25%");
    await page.locator("#add-stop").click();
    const stop = page.locator(".point[data-role=stop]");
    await expect(stop.locator(".remove")).toHaveAttribute("aria-label", en["plan.removeStop"]);
    await expect(stop.locator("input")).toHaveAccessibleName(/1/);
});

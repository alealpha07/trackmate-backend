import { expect, logIn, openSettings, test } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
    await logIn(page);
    await page.goto("/plan");
});

test("the panel is a bottom sheet, the map credits sit on it", async ({ page }) => {
    const viewport = page.viewportSize()!;
    const panel = (await page.locator(".panel").boundingBox())!;
    expect(panel.x).toBe(0);
    expect(panel.width).toBe(viewport.width);
    expect(panel.y + panel.height).toBeCloseTo(viewport.height, 0);
    expect(panel.height).toBeLessThanOrEqual(viewport.height * 0.6 + 1);

    const credits = (await page.locator(".maplibregl-ctrl-bottom-right").boundingBox())!;
    expect(credits.y + credits.height).toBeLessThanOrEqual(panel.y + 1);
});

test("an open menu stays on top of the credits and the panel", async ({ page }) => {
    await openSettings(page);
    const menu = page.locator(".control-menu:visible");
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    const points = [0.1, 0.5, 0.9].map((f) => ({ x: box.x + box.width / 2, y: box.y + box.height * f }));
    for (const point of points) {
        const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".control-menu"), point);
        expect(onTop, `${point.x}, ${point.y}`).toBe(true);
    }
});

test("planning works in the sheet", async ({ page }) => {
    for (const [input, text] of [["#start-input", "44.7815, 9.846"], ["#end-input", "44.7815, 9.856"]]) {
        await page.locator(input).fill(text);
        await page.locator(input).press("Tab");
    }
    await page.locator("#plan").click();
    await page.locator("#distance").scrollIntoViewIfNeeded();
    await expect(page.locator("#distance")).toBeInViewport();
    await expect(page.locator("#distance")).toHaveText(/^\d+\.\d km$/);
});

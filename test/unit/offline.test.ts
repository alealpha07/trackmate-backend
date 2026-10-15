import { expect, test } from "vitest";

test("requests to public hosts are blocked", async () => {
    await expect(fetch("https://tiles.stadiamaps.com/")).rejects.toThrow("Blocked request to tiles.stadiamaps.com");
    await expect(fetch(new URL("https://photon.komoot.io/api"))).rejects.toThrow(/Blocked/);
});

test("outside services point at a closed local port", () => {
    for (const name of ["OVERPASS_ENDPOINT", "DEM_URL", "VALHALLA_URL", "PHOTON_URL"]) {
        expect(new URL(process.env[name]!).hostname, name).toBe("127.0.0.1");
    }
    expect(process.env.STADIA_API_KEY).toBe("");
});

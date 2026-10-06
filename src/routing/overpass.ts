import { HIGHWAY_WHITELIST, OVERPASS_ENDPOINT, OVERPASS_TIMEOUT_SECONDS, OVERPASS_USER_AGENT } from "./config";
import { BBox, OverpassElement, OverpassResponse } from "./types";

function buildQuery(bbox: BBox): string {
    const box = [bbox.south, bbox.west, bbox.north, bbox.east].map((v) => v.toFixed(6)).join(",");
    return `
[out:json][timeout:${OVERPASS_TIMEOUT_SECONDS}];
(
  way["highway"~"^(${HIGHWAY_WHITELIST.join("|")})$"]
     ["highway"!="proposed"]
     ["highway"!="construction"]
     ["area"!="yes"]
     (${box});
);
out body;
>;
out skel qt;
`.trim();
}

// 429 = too many requests, 504 = server overloaded: both are temporary on Overpass.
const RETRY_STATUSES = [429, 504];
const RETRY_DELAYS_MS = [5_000, 15_000];

/** Road network (ways + their nodes) inside the box. */
export async function fetchOverpass(bbox: BBox): Promise<OverpassElement[]> {
    const body = "data=" + encodeURIComponent(buildQuery(bbox));
    let res: Response;
    for (let attempt = 0; ; attempt++) {
        res = await fetch(OVERPASS_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": OVERPASS_USER_AGENT,
            },
            body,
            signal: AbortSignal.timeout((OVERPASS_TIMEOUT_SECONDS + 30) * 1000),
        });
        if (!RETRY_STATUSES.includes(res.status) || attempt >= RETRY_DELAYS_MS.length) break;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Overpass request failed: ${res.status} ${res.statusText}\n${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as OverpassResponse;
    return json.elements;
}

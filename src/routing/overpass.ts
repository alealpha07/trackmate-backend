import { HIGHWAY_WHITELIST, OVERPASS_ENDPOINTS, OVERPASS_TIMEOUT_SECONDS, OVERPASS_USER_AGENT } from "./config";
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

// 429 = too many requests, 502/503/504 = server overloaded: all temporary on Overpass.
// Network errors and timeouts are retried too. Each retry moves to the next endpoint (if configured).
const RETRY_STATUSES = [429, 502, 503, 504];
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

/** Overpass error pages are HTML: keep only the human-readable message. */
function errorSummary(html: string): string {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return text.replace(/^.*?ODbL\.\s*/, "").slice(0, 200);
}

async function query(endpoint: string, body: string): Promise<OverpassElement[]> {
    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": OVERPASS_USER_AGENT,
        },
        body,
        signal: AbortSignal.timeout((OVERPASS_TIMEOUT_SECONDS + 30) * 1000),
    });
    if (!res.ok) {
        const error = new Error(`${res.status} ${res.statusText} ${errorSummary(await res.text())}`.trim());
        (error as any).retryable = RETRY_STATUSES.includes(res.status);
        throw error;
    }
    return ((await res.json()) as OverpassResponse).elements;
}

/** Road network (ways + their nodes) inside the box. Retries stop as soon as
 * `stillWanted()` returns false (every request waiting for it was cancelled). */
export async function fetchOverpass(bbox: BBox, stillWanted: () => boolean = () => true): Promise<OverpassElement[]> {
    const body = "data=" + encodeURIComponent(buildQuery(bbox));
    for (let attempt = 0; ; attempt++) {
        const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
        try {
            return await query(endpoint, body);
        } catch (error: any) {
            // fetch() throws TypeError/TimeoutError on network problems: also temporary
            const retryable = error.retryable ?? true;
            const message = `Overpass ${new URL(endpoint).host}: ${error.message}`;
            if (!retryable || attempt >= RETRY_DELAYS_MS.length || !stillWanted()) throw new Error(message);
            console.warn(`${message} (retry ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
            if (!stillWanted()) throw new Error(`${message} (no longer needed, not retrying)`);
        }
    }
}

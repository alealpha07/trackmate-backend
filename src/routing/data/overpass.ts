import { HIGHWAY_WHITELIST, OVERPASS_ENDPOINTS, OVERPASS_TIMEOUT_SECONDS, OVERPASS_USER_AGENT, RAILWAYS } from "../config";
import { BBox, OverpassElement, OverpassResponse } from "../types";

function buildQuery(bbox: BBox): string {
    const box = [bbox.south, bbox.west, bbox.north, bbox.east].map((v) => v.toFixed(6)).join(",");
    return `
[out:json][timeout:${OVERPASS_TIMEOUT_SECONDS}];
way["highway"~"^(${HIGHWAY_WHITELIST.join("|")})$"]
   ["highway"!="proposed"]
   ["highway"!="construction"]
   ["area"!="yes"]
   (${box})->.roads;
way["railway"~"^(${RAILWAYS.join("|")})$"](${box})->.rails;
.roads out body;
.rails out body;
.roads >;
out skel qt;
`.trim();
}

// retry 429 and 5xx on the next endpoint, other 4xx fail
const isRetryableStatus = (status: number) => status === 429 || status >= 500;
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
// on 429 wait for the free slot from /api/status
const MAX_SLOT_WAITS = 10;
const MAX_SLOT_WAIT_SECONDS = 60;
// overpass-api.de policy: pause 30 s after a 429
const MIN_429_PAUSE_MS = 30_000;

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
        (error as any).status = res.status;
        (error as any).retryable = isRetryableStatus(res.status);
        throw error;
    }
    return ((await res.json()) as OverpassResponse).elements;
}

// parses the /api/status slot lines
async function secondsUntilSlot(endpoint: string): Promise<number | null> {
    try {
        const res = await fetch(endpoint.replace(/\/interpreter\/?$/, "/status"), {
            headers: { "User-Agent": OVERPASS_USER_AGENT },
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        const text = await res.text();
        const available = text.match(/(\d+) slots? available now/);
        if (available && Number(available[1]) > 0) return 0;
        const waits = [...text.matchAll(/in (-?\d+) seconds?/g)].map((m) => Number(m[1]));
        return waits.length > 0 ? Math.max(0, Math.min(...waits)) : null;
    } catch {
        return null;
    }
}

async function wait(ms: number, stillWanted: () => boolean): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end && stillWanted()) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, end - Date.now())));
    }
}

export async function fetchOverpass(bbox: BBox, stillWanted: () => boolean = () => true): Promise<OverpassElement[]> {
    const body = "data=" + encodeURIComponent(buildQuery(bbox));
    let attempt = 0;
    let slotWaits = 0;
    for (;;) {
        const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
        try {
            return await query(endpoint, body);
        } catch (error: any) {
            const message = `Overpass ${new URL(endpoint).host}: ${error.message}`;
            if (!stillWanted()) throw new Error(message);

            let delayMs: number | null = null;
            if (error.status === 429 && slotWaits < MAX_SLOT_WAITS) {
                const seconds = await secondsUntilSlot(endpoint);
                if (seconds !== null) {
                    slotWaits++;
                    delayMs = (Math.min(seconds, MAX_SLOT_WAIT_SECONDS) + 1) * 1000;
                    console.warn(`${message} (waiting ${delayMs / 1000} s for a free slot)`);
                }
            }
            if (delayMs === null) {
                // Network errors and timeouts are temporary too
                const retryable = error.retryable ?? true;
                if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw new Error(message);
                delayMs = RETRY_DELAYS_MS[attempt];
                attempt++;
                console.warn(`${message} (retry ${attempt}/${RETRY_DELAYS_MS.length})`);
            }
            if (error.status === 429) delayMs = Math.max(delayMs, MIN_429_PAUSE_MS);
            await wait(delayMs, stillWanted);
            if (!stillWanted()) throw new Error(`${message} (no longer needed, not retrying)`);
        }
    }
}

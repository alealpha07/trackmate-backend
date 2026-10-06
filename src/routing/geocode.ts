// Place search for the start/destination fields, proxied so the Stadia key stays on the server.
// - Stadia autocomplete (fast) while typing:
//   https://docs.stadiamaps.com/geocoding-search-autocomplete/autocomplete/
// - Full search (Enter): Stadia + Photon. Stadia's index misses small OSM villages/hamlets
//   (e.g. Vezzolacca), Photon is built directly from OSM but the public server is slow (6-15 s).
const STADIA_AUTOCOMPLETE_URL = "https://api.stadiamaps.com/geocoding/v1/autocomplete";
const PHOTON_URL = process.env.PHOTON_URL || "https://photon.komoot.io/api";
const PHOTON_USER_AGENT = "trackmate-backend/1.0 (SafeTrack thesis, route planner)";
const RESULT_COUNT = 6;
const FULL_RESULT_COUNT = 8;
// Two results this close with the same name are the same place. Same full label: the services
// put a village's centre at different points, so allow more.
const DUPLICATE_DISTANCE_DEG = 0.002;
const DUPLICATE_LABEL_DISTANCE_DEG = 0.05;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;
// Per-user cap on searches, so one user can't burn the Stadia credits. Typing with the
// page's 300 ms debounce stays well below it.
const USER_LIMIT_PER_MINUTE = 30;

export interface GeocodeResult {
    label: string;
    lat: number;
    lng: number;
}

interface Focus {
    lat: number;
    lng: number;
}

interface CacheEntry {
    expires: number;
    results: GeocodeResult[];
}

const cache = new Map<string, CacheEntry>();
const userWindows = new Map<number, { start: number; count: number }>();

/** True when the user still has searches left in the current minute (and counts this one). */
export function takeGeocodeQuota(userId: number): boolean {
    const now = Date.now();
    const window = userWindows.get(userId);
    if (!window || now - window.start >= 60_000) {
        userWindows.set(userId, { start: now, count: 1 });
        return true;
    }
    window.count++;
    return window.count <= USER_LIMIT_PER_MINUTE;
}

export function isGeocodingConfigured(): boolean {
    return !!process.env.STADIA_API_KEY;
}

async function cached<T extends GeocodeResult>(key: string, load: () => Promise<T[]>): Promise<T[]> {
    const entry = cache.get(key);
    if (entry && entry.expires > Date.now()) return entry.results as T[];

    const results = await load();
    // Map keeps insertion order: drop the oldest entry when full
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, results });
    return results;
}

function cacheKey(source: string, text: string, lang: string, focus?: Focus): string {
    // Focus rounded to ~1 km so nearby users share cache entries
    return [source, lang, text.trim().toLowerCase(), focus?.lat.toFixed(2), focus?.lng.toFixed(2)].join("|");
}

function stadia(text: string, lang: string, focus?: Focus): Promise<GeocodeResult[]> {
    return cached<GeocodeResult>(cacheKey("stadia", text, lang, focus), async () => {
        const params = new URLSearchParams({
            text,
            lang,
            size: String(RESULT_COUNT),
            api_key: process.env.STADIA_API_KEY || "",
        });
        if (focus) {
            params.set("focus.point.lat", String(focus.lat));
            params.set("focus.point.lon", String(focus.lng));
        }

        const res = await fetch(`${STADIA_AUTOCOMPLETE_URL}?${params}`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) {
            throw new Error(`Stadia autocomplete failed: ${res.status} ${res.statusText}`);
        }
        const json: any = await res.json();
        return (json.features ?? []).map((f: any) => ({
            label: f.properties?.label ?? f.properties?.name ?? "",
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
        }));
    });
}

/** "Vezzolacca, Vernasca, Piacenza, Italia", like Stadia's labels. */
function photonLabel(p: any): string {
    const street = [p.street, p.housenumber].filter(Boolean).join(" ");
    const parts = [p.name || street, p.name ? street : "", p.city, p.county, p.country];
    return parts.filter((part, i) => part && parts.indexOf(part) === i).join(", ");
}

interface PhotonResult extends GeocodeResult {
    /** OSM place=* (village, hamlet...): what Stadia misses */
    isPlace: boolean;
}

function photon(text: string, focus?: Focus): Promise<PhotonResult[]> {
    // Photon only supports default/de/en/fr: "default" gives local (Italian) names
    return cached<PhotonResult>(cacheKey("photon", text, "default", focus), async () => {
        const params = new URLSearchParams({ q: text, limit: String(FULL_RESULT_COUNT) });
        if (focus) {
            params.set("lat", String(focus.lat));
            params.set("lon", String(focus.lng));
        }

        const res = await fetch(`${PHOTON_URL}?${params}`, {
            headers: { "User-Agent": PHOTON_USER_AGENT },
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
            throw new Error(`Photon search failed: ${res.status} ${res.statusText}`);
        }
        const json: any = await res.json();
        const features: any[] = json.features ?? [];
        return features.map((f) => ({
            label: photonLabel(f.properties ?? {}),
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
            isPlace: f.properties?.osm_key === "place",
        }));
    });
}

/** Lowercase, no accents, single spaces: "Città " -> "citta". */
function normalize(text: string): string {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isDuplicate(a: GeocodeResult, b: GeocodeResult): boolean {
    const near = (deg: number) => Math.abs(a.lat - b.lat) < deg && Math.abs(a.lng - b.lng) < deg;
    const name = (r: GeocodeResult) => normalize(r.label.split(",")[0]);
    if (normalize(a.label) === normalize(b.label)) return near(DUPLICATE_LABEL_DISTANCE_DEG);
    return name(a) === name(b) && near(DUPLICATE_DISTANCE_DEG);
}

/** Suggestions for `text`, biased towards the focus point when given.
 * `full` also asks Photon and merges its results in (slower). */
export async function geocode(text: string, lang: string, focus?: Focus, full = false): Promise<GeocodeResult[]> {
    if (!full) return stadia(text, lang, focus);

    const [fromStadia, fromPhoton] = await Promise.allSettled([stadia(text, lang, focus), photon(text, focus)]);
    if (fromStadia.status === "rejected" && fromPhoton.status === "rejected") throw fromStadia.reason;
    if (fromPhoton.status === "rejected") console.warn(`Geocoding: ${fromPhoton.reason.message}`);
    if (fromStadia.status === "rejected") console.warn(`Geocoding: ${fromStadia.reason.message}`);

    const photonResults = fromPhoton.status === "fulfilled" ? fromPhoton.value : [];
    const stadiaResults = fromStadia.status === "fulfilled" ? fromStadia.value : [];
    // Promote only places whose name contains what was typed: Photon also fuzzy-matches
    // (vezzolacca -> Venzolasca, Corsica), those go after Stadia's results
    // ("vezzolacca" or "vezzolacca vernasca" both promote Vezzolacca)
    const typed = normalize(text);
    const promoted = (r: PhotonResult) => {
        const name = normalize(r.label.split(",")[0]);
        return r.isPlace && (name.includes(typed) || typed.includes(name));
    };
    const ordered = [
        ...photonResults.filter(promoted),
        ...stadiaResults,
        ...photonResults.filter((r) => !promoted(r)),
    ];
    const merged: GeocodeResult[] = [];
    for (const { label, lat, lng } of ordered) {
        const result = { label, lat, lng };
        if (!merged.some((other) => isDuplicate(result, other))) merged.push(result);
    }
    return merged.slice(0, FULL_RESULT_COUNT);
}

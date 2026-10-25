import crypto from "crypto";
import fs from "fs";
import path from "path";
import { CONTACT_EMAIL } from "../src/routing/config.js";
import { CACHE_DIR, CITIES, VALHALLA_URL } from "./config.js";
import { ValhallaEdge } from "./graph.js";
import { Pair, outPath, readJson, writeJson } from "./io.js";

export const VALHALLA_DIR = path.join(CACHE_DIR, "valhalla");
export const VALHALLA_STATUS_FILE = path.join(VALHALLA_DIR, "status.json");

export interface ValhallaRoute {
    shape: string;
    // meters
    length: number;
    // seconds
    time: number;
    requestMs: number;
    attributes: { shape: string; edges: ValhallaEdge[] };
}

// FOSSGIS terms: at most 1 request a second, one at a time
const MIN_REQUEST_GAP_MS = 1100;
let lastRequestAt = 0;

async function request(endpoint: string, body?: object): Promise<any> {
    const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    const res = await fetch(`${VALHALLA_URL}/${endpoint}`, {
        method: body ? "POST" : "GET",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": `trackmate-benchmark/1.0 (routing comparison for a thesis, ${CONTACT_EMAIL})`,
            "X-Client-Id": "trackmate",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${endpoint}: ${res.status} ${json?.error_code ?? ""} ${json?.error ?? res.statusText}`);
    return json;
}

export function valhallaFile(city: string, pair: Pair): string {
    const hash = crypto.createHash("sha1").update(JSON.stringify([pair.from, pair.to])).digest("hex").slice(0, 10);
    return path.join(VALHALLA_DIR, `${city}-${pair.id}-${hash}.json`);
}

async function fetchRoute(pair: Pair): Promise<ValhallaRoute> {
    const start = performance.now();
    // default bicycle costing, as the backend sends it
    const route = await request("route", {
        locations: [{ lat: pair.from.lat, lon: pair.from.lng }, { lat: pair.to.lat, lon: pair.to.lng }],
        costing: "bicycle",
        directions_type: "none",
        units: "kilometers",
    });
    const requestMs = performance.now() - start;
    const leg = route.trip.legs[0];
    const filters = {
        attributes: ["edge.way_id", "edge.length", "edge.begin_shape_index", "edge.end_shape_index", "shape"],
        action: "include",
    };
    const trace = (shapeMatch: string) => request("trace_attributes", {
        encoded_polyline: leg.shape,
        shape_match: shapeMatch,
        costing: "bicycle",
        units: "kilometers",
        filters,
    });
    // the shape lies on valhalla's own edges, map_snap only if that fails
    const attributes = await trace("edge_walk").catch(() => trace("map_snap"));
    return {
        shape: leg.shape,
        length: leg.summary.length * 1000,
        time: leg.summary.time,
        requestMs,
        attributes: { shape: attributes.shape, edges: attributes.edges },
    };
}

export async function runValhalla() {
    const pairs = readJson<Record<string, Pair[]>>(outPath("pairs.json"));
    fs.mkdirSync(VALHALLA_DIR, { recursive: true });
    if (!fs.existsSync(VALHALLA_STATUS_FILE)) {
        const status = await request("status");
        writeJson(VALHALLA_STATUS_FILE, { ...status, checkedAt: new Date().toISOString() });
    }

    let failed = 0;
    for (const city of CITIES) {
        let fetched = 0;
        for (const pair of pairs[city.id]) {
            const file = valhallaFile(city.id, pair);
            if (fs.existsSync(file)) continue;
            try {
                writeJson(file, await fetchRoute(pair));
                fetched++;
            } catch (error) {
                failed++;
                console.warn(`  ${city.id} ${pair.id}: ${(error as Error).message}`);
            }
        }
        console.log(`${city.id}: ${fetched} routes fetched`);
    }
    // failures aren't cached, a later run tries them again
    if (failed > 0) console.warn(`${failed} Valhalla routes failed`);
}

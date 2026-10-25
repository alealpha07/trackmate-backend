import fs from "fs";
import path from "path";
import { CONTACT_EMAIL, OSM_CACHE_DIR } from "../src/routing/config.js";
import { planningBBox } from "../src/routing/data/bbox.js";
import { haversineMeters } from "../src/routing/haversine.js";
import { BBox, GraphEdge } from "../src/routing/types.js";
import {
    CACHE_DIR, CITIES, MAX_PAIR_METERS, MIN_PAIR_METERS, OVERPASS_ENDPOINTS, PAIRS_PER_CITY, SEED,
} from "./config.js";
import { loadNetwork } from "./graph.js";
import { Pair, outPath, readJson, writeJson } from "./io.js";
import { Score, scoreEdges } from "./score.js";

export const SNAPSHOT_FILE = path.join(CACHE_DIR, "snapshot.json");

export interface Snapshot {
    osmBase: string | null;
    recordedAt: string;
    tiles: number;
    oldestTile: string;
    newestTile: string;
}

export function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// the city box plus the planner's buffer, so every pair's graph is inside it
export const cityExtent = (box: BBox) => planningBBox({ lat: box.south, lng: box.west }, { lat: box.north, lng: box.east });

const inside = (box: BBox, lat: number, lon: number) =>
    lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;

async function osmBase(): Promise<string | null> {
    for (const endpoint of [...OVERPASS_ENDPOINTS, ...OVERPASS_ENDPOINTS]) {
        try {
            const res = await fetch(endpoint.replace(/interpreter$/, "timestamp"), {
                headers: { "User-Agent": `trackmate-benchmark/1.0 (routing comparison for a thesis, ${CONTACT_EMAIL})` },
                signal: AbortSignal.timeout(90_000),
            });
            const text = (await res.text()).trim();
            if (res.ok && /^\d{4}-\d\d-\d\dT/.test(text)) return text;
        } catch {
            // next endpoint
        }
    }
    return null;
}

function tileDates() {
    const dates = fs.readdirSync(OSM_CACHE_DIR)
        .filter((name) => name.endsWith(".json.gz"))
        .map((name) => fs.statSync(path.join(OSM_CACHE_DIR, name)).mtime.toISOString())
        .sort();
    return { tiles: dates.length, oldestTile: dates[0], newestTile: dates[dates.length - 1] };
}

// overpass gives up on a busy tile after a few tries, the tiles already saved stay
async function withRetries<T>(task: () => Promise<T>, attempts = 20): Promise<T> {
    for (let i = 1; ; i++) {
        try {
            return await task();
        } catch (error) {
            if (i >= attempts) throw error;
            console.warn(`\n  ${(error as Error).message}, trying again in 2 minutes (${i}/${attempts - 1})`);
            await new Promise((resolve) => setTimeout(resolve, 120_000));
        }
    }
}

export async function runData() {
    const pairs: Record<string, Pair[]> = {};
    const network: Record<string, Score> = {};
    let downloaded = 0;

    for (const city of CITIES) {
        console.log(`${city.id}: loading tiles and building the graph`);
        const net = await withRetries(() => loadNetwork(cityExtent(city.box), (done, total) => {
            if (total === 0) return;
            if (done === total) downloaded += total;
            process.stdout.write(`\r  ${done}/${total} tiles downloaded`);
            if (done === total) process.stdout.write("\n");
        }));
        const { graph } = net;

        // a two-way segment counts once
        const perSegment = new Map<string, number>();
        const segment = (edge: GraphEdge) => edge.id.slice(0, edge.id.lastIndexOf(":"));
        const inBox = graph.edges.filter((e) => {
            const a = graph.nodes[e.from];
            const b = graph.nodes[e.to];
            return inside(city.box, (a.lat + b.lat) / 2, (a.lon + b.lon) / 2);
        });
        inBox.forEach((e) => perSegment.set(segment(e), (perSegment.get(segment(e)) ?? 0) + 1));
        network[city.id] = scoreEdges(net, inBox, (e) => 1 / perSegment.get(segment(e))!);

        const candidates = Object.keys(graph.nodes)
            .filter((id) => graph.nodes[id].snappable && inside(city.box, graph.nodes[id].lat, graph.nodes[id].lon))
            .sort((a, b) => Number(a) - Number(b));
        const random = mulberry32(SEED);
        const pick = () => candidates[Math.floor(random() * candidates.length)];
        const end = (id: string) => ({ node: id, lat: graph.nodes[id].lat, lng: graph.nodes[id].lon });
        const cityPairs: Pair[] = [];
        while (cityPairs.length < PAIRS_PER_CITY) {
            const a = pick();
            const b = pick();
            const meters = haversineMeters(graph.nodes[a].lat, graph.nodes[a].lon, graph.nodes[b].lat, graph.nodes[b].lon);
            if (meters >= MIN_PAIR_METERS && meters <= MAX_PAIR_METERS) {
                cityPairs.push({ id: cityPairs.length + 1, from: end(a), to: end(b), meters });
            }
        }
        pairs[city.id] = cityPairs;
        console.log(`  ${graph.edges.length} edges, ${candidates.length} candidate nodes, ${cityPairs.length} pairs`);
    }

    // the snapshot date is the overpass database state when the tiles were fetched
    const previous = fs.existsSync(SNAPSHOT_FILE) ? readJson<Snapshot>(SNAPSHOT_FILE) : null;
    if (downloaded > 0 || !previous?.osmBase) {
        const snapshot: Snapshot = { osmBase: await osmBase(), recordedAt: new Date().toISOString(), ...tileDates() };
        writeJson(SNAPSHOT_FILE, snapshot);
        console.log(`OSM snapshot: ${snapshot.osmBase ?? "unknown"}`);
    }
    writeJson(outPath("pairs.json"), pairs);
    writeJson(outPath("network.json"), network);
}

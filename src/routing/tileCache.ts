import fs from "fs";
import path from "path";
import zlib from "zlib";
import { OSM_CACHE_DIR, OVERPASS_MAX_PARALLEL, TILE_SIZE_DEG } from "./config";
import { OSM_CACHE, isFresh as isFreshIn, markUsed, pruneSoon } from "./diskCache";
import { fetchOverpass } from "./overpass";
import { BBox, OverpassElement, OverpassNode, OverpassWay } from "./types";

interface Tile {
    x: number;
    y: number;
}

/** Shared by every request that needs the tile. */
interface TileJob {
    tile: Tile;
    key: string;
    /** A queued job nobody waits for is dropped. */
    waiters: number;
    promise: Promise<OverpassElement[]>;
    resolve: (elements: OverpassElement[]) => void;
    reject: (error: Error) => void;
}

// One queue for the whole server: Overpass limits slots per IP
const jobs = new Map<string, TileJob>();
const queue: TileJob[] = [];
let running = 0;
const PUMP_DELAY_MS = 50;

function tileKey(tile: Tile): string {
    return `${tile.x}_${tile.y}`;
}

function tilePath(tile: Tile): string {
    return path.join(OSM_CACHE_DIR, `${tileKey(tile)}.json.gz`);
}

function tileBBox(tile: Tile): BBox {
    return {
        south: tile.y * TILE_SIZE_DEG,
        west: tile.x * TILE_SIZE_DEG,
        north: (tile.y + 1) * TILE_SIZE_DEG,
        east: (tile.x + 1) * TILE_SIZE_DEG,
    };
}

export function tilesFor(bbox: BBox): Tile[] {
    const tiles: Tile[] = [];
    for (let x = Math.floor(bbox.west / TILE_SIZE_DEG); x <= Math.floor(bbox.east / TILE_SIZE_DEG); x++) {
        for (let y = Math.floor(bbox.south / TILE_SIZE_DEG); y <= Math.floor(bbox.north / TILE_SIZE_DEG); y++) {
            tiles.push({ x, y });
        }
    }
    return tiles;
}

function readTileFile(file: string): OverpassElement[] {
    markUsed(file);
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf-8"));
}

const isFresh = (file: string) => isFreshIn(OSM_CACHE, file);

async function fetchTile(job: TileJob): Promise<OverpassElement[]> {
    const file = tilePath(job.tile);
    try {
        // Stop retrying once every request that wanted this tile has given up
        const elements = await fetchOverpass(tileBBox(job.tile), () => job.waiters > 0);
        fs.mkdirSync(OSM_CACHE_DIR, { recursive: true });
        // Write then rename, so a crash never leaves a half-written tile behind
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(elements)));
        fs.renameSync(tmp, file);
        pruneSoon(OSM_CACHE);
        return elements;
    } catch (error) {
        // A stale tile is better than no route
        if (fs.existsSync(file)) {
            console.warn(`Tile ${job.key}: ${(error as Error).message}. Using the stale cached copy`);
            return readTileFile(file);
        }
        throw error;
    }
}

function pump() {
    while (running < OVERPASS_MAX_PARALLEL && queue.length > 0) {
        const job = queue.shift()!;
        if (job.waiters === 0) {
            jobs.delete(job.key);
            job.reject(new Error(`Tile ${job.key}: cancelled`));
            continue;
        }
        running++;
        fetchTile(job)
            .then(job.resolve, job.reject)
            .finally(() => {
                running--;
                jobs.delete(job.key);
                // Parsing and writing a big tile blocks the event loop, and a client that hung up
                // meanwhile is only noticed in the next I/O poll. Timers run before that poll and
                // setImmediate after it: start the next job only once its waiters are up to date
                setTimeout(() => setImmediate(pump), PUMP_DELAY_MS);
            });
    }
}

function abortError(): Error {
    const error = new Error("Route request cancelled");
    error.name = "AbortError";
    return error;
}

function loadTile(tile: Tile, signal: AbortSignal): Promise<OverpassElement[]> {
    const file = tilePath(tile);
    if (isFresh(file)) return Promise.resolve(readTileFile(file));
    if (signal.aborted) return Promise.reject(abortError());

    const key = tileKey(tile);
    let job = jobs.get(key);
    if (!job) {
        let resolve!: TileJob["resolve"];
        let reject!: TileJob["reject"];
        const promise = new Promise<OverpassElement[]>((res, rej) => ((resolve = res), (reject = rej)));
        // Dropped jobs may have no listener left: don't let that become an unhandled rejection
        promise.catch(() => {});
        job = { tile, key, waiters: 0, promise, resolve, reject };
        jobs.set(key, job);
        queue.push(job);
    }

    const current = job;
    current.waiters++;
    return new Promise((resolve, reject) => {
        let done = false;
        const leave = () => {
            if (done) return;
            done = true;
            current.waiters--;
        };
        signal.addEventListener("abort", () => {
            leave();
            reject(abortError());
        }, { once: true });
        current.promise.then(
            (elements) => (leave(), resolve(elements)),
            (error) => (leave(), reject(error)),
        );
        pump();
    });
}

/** File dates included, so a refreshed tile changes the key. */
function tileSetKey(tiles: Tile[]): string {
    return tiles
        .map((tile) => {
            const file = tilePath(tile);
            return `${tileKey(tile)}@${fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0}`;
        })
        .join(",");
}

export interface LoadedTiles {
    /** Same key, same graph. */
    key: string;
    /** Only called when the graph isn't cached. */
    elements: () => OverpassElement[];
}

/** The tiles that were downloaded stay cached, so planning again only fetches what is missing. */
export class PartialDownloadError extends Error {
    constructor(message: string, public downloaded: number, public total: number) {
        super(message);
    }
}

/** One reader per box (leg), returned only once every tile is on disk: a route is never planned on
 * partial map data. `onProgress(done, total)` counts downloaded tiles. */
export async function loadTiles(
    bboxes: BBox[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
): Promise<LoadedTiles[]> {
    const perBox = bboxes.map(tilesFor);
    const unique = new Map(perBox.flat().map((tile) => [tileKey(tile), tile]));
    const missing = [...unique.values()].filter((tile) => !isFresh(tilePath(tile)));

    // If one tile fails, release the others this request was waiting for
    const local = new AbortController();
    const onAbort = () => local.abort();
    signal.addEventListener("abort", onAbort, { once: true });

    let done = 0;
    onProgress?.(done, missing.length);
    try {
        await Promise.all(missing.map(async (tile) => {
            await loadTile(tile, local.signal);
            onProgress?.(++done, missing.length);
        }));
    } catch (error) {
        local.abort();
        if (signal.aborted) throw abortError();
        throw new PartialDownloadError((error as Error).message, done, missing.length);
    } finally {
        signal.removeEventListener("abort", onAbort);
    }

    // The graph may be cached and never read them: mark them in use for the cache pruning
    unique.forEach((tile) => markUsed(tilePath(tile)));

    // Read per leg, so a long route never holds every tile in memory at once
    return perBox.map((tiles) => ({
        key: tileSetKey(tiles),
        elements: () => {
            const nodes = new Map<number, OverpassNode>();
            const ways = new Map<number, OverpassWay>();
            for (const tile of tiles) {
                for (const el of readTileFile(tilePath(tile))) {
                    if (el.type === "node") nodes.set(el.id, el);
                    else if (el.type === "way") ways.set(el.id, el);
                }
            }
            return [...nodes.values(), ...ways.values()];
        },
    }));
}

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { OSM_CACHE_DIR, OSM_CACHE_TTL_DAYS, OVERPASS_MAX_PARALLEL, TILE_SIZE_DEG } from "./config";
import { fetchOverpass } from "./overpass";
import { BBox, OverpassElement, OverpassNode, OverpassWay } from "./types";

interface Tile {
    x: number;
    y: number;
}

/** A tile waiting for (or being fetched from) Overpass, shared by every request that needs it. */
interface TileJob {
    tile: Tile;
    key: string;
    /** Requests still waiting for this tile. A queued job nobody waits for is dropped. */
    waiters: number;
    promise: Promise<OverpassElement[]>;
    resolve: (elements: OverpassElement[]) => void;
    reject: (error: Error) => void;
}

const TTL_MS = OSM_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

// One queue for the whole server: Overpass limits slots per IP, so concurrent route requests
// must not each run their own parallel fetches.
const jobs = new Map<string, TileJob>();
const queue: TileJob[] = [];
let running = 0;

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
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf-8"));
}

function isFresh(file: string): boolean {
    return fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < TTL_MS;
}

async function fetchTile(job: TileJob): Promise<OverpassElement[]> {
    const file = tilePath(job.tile);
    try {
        // Stop retrying once every request that wanted this tile has given up
        const elements = await fetchOverpass(tileBBox(job.tile), () => job.waiters > 0);
        fs.mkdirSync(OSM_CACHE_DIR, { recursive: true });
        // Write then rename, so a crash never leaves a half-written tile behind.
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(elements)));
        fs.renameSync(tmp, file);
        return elements;
    } catch (error) {
        // Overpass down: a stale tile is better than no route.
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
                pump();
            });
    }
}

function abortError(): Error {
    const error = new Error("Route request cancelled");
    error.name = "AbortError";
    return error;
}

/** Elements of one tile: from disk when fresh, otherwise queued for Overpass. */
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

/** Cache identity of a tile set: tile keys plus file dates, so a refreshed tile changes it. */
function tileSetKey(tiles: Tile[]): string {
    return tiles
        .map((tile) => {
            const file = tilePath(tile);
            return `${tileKey(tile)}@${fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0}`;
        })
        .join(",");
}

export interface LoadedTiles {
    /** Identifies this exact data: same key, same graph. */
    key: string;
    /** Reads the elements (deduplicated), only called when the graph isn't cached. */
    elements: () => OverpassElement[];
}

/** Makes sure every tile covering the box is on disk (fetching missing or stale ones from Overpass).
 * Ways crossing a tile border appear in both tiles, so ways and nodes are deduplicated by OSM id.
 * Rejects with an AbortError when `signal` aborts (the client went away). */
export async function loadTiles(bbox: BBox, signal: AbortSignal): Promise<LoadedTiles> {
    const tiles = tilesFor(bbox);
    // If one tile fails, release the others this request was waiting for
    const local = new AbortController();
    const onAbort = () => local.abort();
    signal.addEventListener("abort", onAbort, { once: true });

    const fetched = new Map<string, OverpassElement[]>();
    try {
        await Promise.all(tiles.filter((tile) => !isFresh(tilePath(tile))).map(async (tile) => {
            fetched.set(tileKey(tile), await loadTile(tile, local.signal));
        }));
    } catch (error) {
        local.abort();
        throw signal.aborted ? abortError() : error;
    } finally {
        signal.removeEventListener("abort", onAbort);
    }

    return {
        key: tileSetKey(tiles),
        elements: () => {
            const nodes = new Map<number, OverpassNode>();
            const ways = new Map<number, OverpassWay>();
            for (const tile of tiles) {
                // Tiles that fell back to a stale copy, or were just fetched, are read from memory
                const elements = fetched.get(tileKey(tile)) ?? readTileFile(tilePath(tile));
                for (const el of elements) {
                    if (el.type === "node") nodes.set(el.id, el);
                    else if (el.type === "way") ways.set(el.id, el);
                }
            }
            return [...nodes.values(), ...ways.values()];
        },
    };
}

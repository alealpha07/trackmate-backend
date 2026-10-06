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

const TTL_MS = OSM_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
// Tiles being fetched right now, so concurrent requests share one Overpass call.
const inFlight = new Map<string, Promise<OverpassElement[]>>();

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
    return Date.now() - fs.statSync(file).mtimeMs < TTL_MS;
}

async function fetchTile(tile: Tile): Promise<OverpassElement[]> {
    const file = tilePath(tile);
    try {
        const elements = await fetchOverpass(tileBBox(tile));
        fs.mkdirSync(OSM_CACHE_DIR, { recursive: true });
        // Write then rename, so a crash never leaves a half-written tile behind.
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(elements)));
        fs.renameSync(tmp, file);
        return elements;
    } catch (error) {
        // Overpass down: a stale tile is better than no route.
        if (fs.existsSync(file)) {
            console.error(`Overpass failed for tile ${tileKey(tile)}, using stale cache`, error);
            return readTileFile(file);
        }
        throw error;
    }
}

function loadTile(tile: Tile): Promise<OverpassElement[]> {
    const file = tilePath(tile);
    if (fs.existsSync(file) && isFresh(file)) {
        return Promise.resolve(readTileFile(file));
    }

    const key = tileKey(tile);
    let pending = inFlight.get(key);
    if (!pending) {
        pending = fetchTile(tile).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
    }
    return pending;
}

/** All OSM elements covering the box: cached tiles are read from disk, missing or stale
 * ones are fetched from Overpass. Ways crossing a tile border appear in both tiles,
 * so ways and nodes are deduplicated by OSM id. */
export async function loadElements(bbox: BBox): Promise<OverpassElement[]> {
    const queue = tilesFor(bbox);
    const nodes = new Map<number, OverpassNode>();
    const ways = new Map<number, OverpassWay>();

    async function worker() {
        for (let tile = queue.shift(); tile; tile = queue.shift()) {
            for (const el of await loadTile(tile)) {
                if (el.type === "node") nodes.set(el.id, el);
                else if (el.type === "way") ways.set(el.id, el);
            }
        }
    }
    await Promise.all(Array.from({ length: OVERPASS_MAX_PARALLEL }, worker));

    return [...nodes.values(), ...ways.values()];
}

import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { fromFile } from "geotiff";
import { DEM_CACHE_DIR, DEM_GROUND_RADIUS, DEM_URL, OVERPASS_USER_AGENT } from "./config";
import { DEM_CACHE, isFresh, markUsed, pruneSoon } from "./diskCache";
import { BBox } from "./types";

/** Meters, 0 where there is no tile (open sea). */
export type Elevation = (lat: number, lon: number) => number;

/** Part of one tile: `values` row by row, north to south. */
interface Grid {
    values: ArrayLike<number>;
    width: number;
    height: number;
    /** Center of the first pixel and the step between pixels, in degrees (stepLat < 0). */
    lon0: number;
    lat0: number;
    stepLon: number;
    stepLat: number;
}

interface DemTile {
    lat: number;
    lon: number;
}

/** "Copernicus_DSM_COG_10_N44_00_E010_00_DEM": the tile whose south-west corner is 44°N 10°E. */
function tileName(tile: DemTile): string {
    const lat = `${tile.lat < 0 ? "S" : "N"}${String(Math.abs(tile.lat)).padStart(2, "0")}_00`;
    const lon = `${tile.lon < 0 ? "W" : "E"}${String(Math.abs(tile.lon)).padStart(3, "0")}_00`;
    return `Copernicus_DSM_COG_10_${lat}_${lon}_DEM`;
}

function tilesFor(bbox: BBox): DemTile[] {
    const tiles: DemTile[] = [];
    for (let lat = Math.floor(bbox.south); lat <= Math.floor(bbox.north); lat++) {
        for (let lon = Math.floor(bbox.west); lon <= Math.floor(bbox.east); lon++) tiles.push({ lat, lon });
    }
    return tiles;
}

const tifPath = (name: string) => path.join(DEM_CACHE_DIR, `${name}.tif`);
// Marks a tile the bucket doesn't have (open sea), so it isn't asked for again
const nonePath = (name: string) => path.join(DEM_CACHE_DIR, `${name}.none`);

// Shared by the requests that need them. A download keeps going when a request gives up: the next
// plan in the area needs the tile anyway
const downloads = new Map<string, Promise<void>>();

async function download(name: string): Promise<void> {
    fs.mkdirSync(DEM_CACHE_DIR, { recursive: true });
    const res = await fetch(`${DEM_URL}/${name}/${name}.tif`, { headers: { "User-Agent": OVERPASS_USER_AGENT } });
    // The bucket answers 403/404 for tiles it doesn't have
    if (res.status === 403 || res.status === 404) {
        fs.writeFileSync(nonePath(name), "");
        pruneSoon(DEM_CACHE);
        return;
    }
    if (!res.ok || !res.body) throw new Error(`DEM tile ${name}: HTTP ${res.status}`);
    // Write then rename, so a crash never leaves a half-written tile behind
    const tmp = `${tifPath(name)}.${process.pid}.tmp`;
    try {
        await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
        fs.renameSync(tmp, tifPath(name));
        pruneSoon(DEM_CACHE);
    } finally {
        fs.rmSync(tmp, { force: true });
    }
}

function ensureTile(name: string): Promise<void> {
    markUsed(tifPath(name));
    markUsed(nonePath(name));
    if (isFresh(DEM_CACHE, tifPath(name)) || isFresh(DEM_CACHE, nonePath(name))) return Promise.resolve();
    let job = downloads.get(name);
    if (!job) {
        job = download(name)
            .catch((error) => {
                // Download failed: a stale tile is better than no route
                if (!fs.existsSync(tifPath(name))) throw error;
                console.warn(`DEM tile ${name}: ${(error as Error).message}. Using the stale cached copy`);
            })
            .finally(() => downloads.delete(name));
        downloads.set(name, job);
    }
    return job;
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
}

export async function loadDemTiles(bbox: BBox, signal: AbortSignal): Promise<void> {
    await untilAborted(Promise.all(tilesFor(bbox).map((tile) => ensureTile(tileName(tile)))), signal);
}

async function readGrid(name: string, bbox: BBox): Promise<Grid> {
    const tiff = await fromFile(tifPath(name));
    try {
        const image = await tiff.getImage();
        const [originLon, originLat] = image.getOrigin();
        const [stepLon, stepLat] = image.getResolution();
        const col = (lon: number) => Math.floor((lon - originLon) / stepLon);
        const row = (lat: number) => Math.floor((lat - originLat) / stepLat);
        const clampCol = (c: number) => Math.max(0, Math.min(image.getWidth(), c));
        const clampRow = (r: number) => Math.max(0, Math.min(image.getHeight(), r));
        // A margin for the interpolation and the ground filter
        const margin = DEM_GROUND_RADIUS + 1;
        const left = clampCol(col(bbox.west) - margin);
        const right = clampCol(col(bbox.east) + margin + 1);
        const top = clampRow(row(bbox.north) - margin);
        const bottom = clampRow(row(bbox.south) + margin + 1);
        const [values] = (await image.readRasters({ window: [left, top, right, bottom] })) as unknown as ArrayLike<number>[];
        return {
            values,
            width: right - left,
            height: bottom - top,
            lon0: originLon + (left + 0.5) * stepLon,
            lat0: originLat + (top + 0.5) * stepLat,
            stepLon,
            stepLat,
        };
    } finally {
        tiff.close();
    }
}

/** The data includes roofs and tree tops, so a road between buildings would read their height. Taking
 * the lowest value around each pixel, then the highest of those (a morphological opening), lowers
 * anything narrower than the square to the ground around it, while hills keep their shape. */
function ground(grid: Grid, radius: number): Grid {
    if (radius <= 0) return grid;
    const { width, height } = grid;
    // Separable: a square min (max) is a row min (max) followed by a column min (max)
    const pass = (input: ArrayLike<number>, pick: (a: number, b: number) => number) => {
        const rows = new Float32Array(width * height);
        const out = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let v = input[y * width + x];
                for (let d = Math.max(0, x - radius); d <= Math.min(width - 1, x + radius); d++) v = pick(v, input[y * width + d]);
                rows[y * width + x] = v;
            }
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let v = rows[y * width + x];
                for (let d = Math.max(0, y - radius); d <= Math.min(height - 1, y + radius); d++) v = pick(v, rows[d * width + x]);
                out[y * width + x] = v;
            }
        }
        return out;
    };
    return { ...grid, values: pass(pass(grid.values, Math.min), Math.max) };
}

/** Bilinear between the four pixel centers around the point. */
function sample(grid: Grid, lat: number, lon: number): number {
    const x = Math.max(0, Math.min(grid.width - 1, (lon - grid.lon0) / grid.stepLon));
    const y = Math.max(0, Math.min(grid.height - 1, (lat - grid.lat0) / grid.stepLat));
    const x0 = Math.min(Math.floor(x), grid.width - 2);
    const y0 = Math.min(Math.floor(y), grid.height - 2);
    if (x0 < 0 || y0 < 0) return grid.values[0] ?? 0;
    const fx = x - x0;
    const fy = y - y0;
    const at = (dx: number, dy: number) => grid.values[(y0 + dy) * grid.width + x0 + dx];
    return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
}

/** Downloads missing tiles. The grids are only held while a graph is built (a 50 km leg: ~20 MB). */
export async function loadElevation(bbox: BBox, signal: AbortSignal): Promise<Elevation> {
    await loadDemTiles(bbox, signal);
    const grids = new Map<string, Grid>();
    for (const tile of tilesFor(bbox)) {
        const name = tileName(tile);
        if (!fs.existsSync(tifPath(name))) continue;
        const part: BBox = {
            south: Math.max(bbox.south, tile.lat),
            north: Math.min(bbox.north, tile.lat + 1),
            west: Math.max(bbox.west, tile.lon),
            east: Math.min(bbox.east, tile.lon + 1),
        };
        grids.set(`${tile.lat},${tile.lon}`, ground(await readGrid(name, part), DEM_GROUND_RADIUS));
    }
    return (lat, lon) => {
        const grid = grids.get(`${Math.floor(lat)},${Math.floor(lon)}`);
        return grid ? sample(grid, lat, lon) : 0;
    };
}

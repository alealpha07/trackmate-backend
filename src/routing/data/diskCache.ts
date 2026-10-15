import fs from "fs";
import path from "path";
import cron from "node-cron";
import {
    DEM_CACHE_DIR, DEM_CACHE_MAX_MB, DEM_CACHE_TTL_DAYS, INSTRUCTIONS_CACHE_DIR, INSTRUCTIONS_CACHE_MAX_MB,
    INSTRUCTIONS_CACHE_TTL_DAYS, OSM_CACHE_DIR, OSM_CACHE_MAX_MB, OSM_CACHE_TTL_DAYS,
} from "../config.js";

export interface DiskCache {
    dir: string;
    ttlMs: number;
    maxBytes: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const OSM_CACHE: DiskCache = {
    dir: OSM_CACHE_DIR, ttlMs: OSM_CACHE_TTL_DAYS * DAY_MS, maxBytes: OSM_CACHE_MAX_MB * 1024 * 1024,
};
export const DEM_CACHE: DiskCache = {
    dir: DEM_CACHE_DIR, ttlMs: DEM_CACHE_TTL_DAYS * DAY_MS, maxBytes: DEM_CACHE_MAX_MB * 1024 * 1024,
};
export const INSTRUCTIONS_CACHE: DiskCache = {
    dir: INSTRUCTIONS_CACHE_DIR, ttlMs: INSTRUCTIONS_CACHE_TTL_DAYS * DAY_MS, maxBytes: INSTRUCTIONS_CACHE_MAX_MB * 1024 * 1024,
};

export function isFresh(cache: DiskCache, file: string): boolean {
    return fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < cache.ttlMs;
}

// file access time is used across restarts
const lastUse = new Map<string, number>();

export function markUsed(file: string) {
    lastUse.set(file, Date.now());
}

// never delete a tile used this recently
const IN_USE_MS = 10 * 60 * 1000;

// prune by TTL, then by size; files in use are kept
export function pruneCache(cache: DiskCache) {
    let names: string[];
    try {
        names = fs.readdirSync(cache.dir);
    } catch {
        return;
    }
    const now = Date.now();
    const files: { file: string; size: number; used: number }[] = [];
    let removed = 0;
    let freed = 0;
    const remove = (file: string, size: number) => {
        try {
            fs.rmSync(file);
            lastUse.delete(file);
            removed++;
            freed += size;
        } catch {}
    };

    for (const name of names) {
        const file = path.join(cache.dir, name);
        let stat: fs.Stats;
        try {
            stat = fs.statSync(file);
        } catch {
            continue;
        }
        if (!stat.isFile()) continue;
        if (name.endsWith(".tmp")) {
            if (now - stat.mtimeMs > DAY_MS) remove(file, stat.size);
            continue;
        }
        const used = Math.max(lastUse.get(file) ?? 0, stat.atimeMs, stat.mtimeMs);
        if (now - used > cache.ttlMs) remove(file, stat.size);
        else files.push({ file, size: stat.size, used });
    }

    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const f of files.sort((a, b) => a.used - b.used)) {
        if (total <= cache.maxBytes || now - f.used < IN_USE_MS) break;
        remove(f.file, f.size);
        total -= f.size;
    }
    if (removed > 0) {
        console.log(`Cache ${cache.dir}: removed ${removed} files (${(freed / 1024 / 1024).toFixed(1)} MB), ${(total / 1024 / 1024).toFixed(1)} MB left`);
    }
}

const pending = new Map<DiskCache, NodeJS.Timeout>();

export function pruneSoon(cache: DiskCache) {
    clearTimeout(pending.get(cache));
    pending.set(cache, setTimeout(() => {
        pending.delete(cache);
        pruneCache(cache);
    }, 5000).unref());
}

export function scheduleCachePruning() {
    const pruneAll = () => [OSM_CACHE, DEM_CACHE, INSTRUCTIONS_CACHE].forEach(pruneCache);
    setImmediate(pruneAll);
    cron.schedule("30 3 * * *", pruneAll);
}

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Chunk, LatLng, TrackInstructions } from "../types";
import { INSTRUCTIONS_CACHE_DIR, VALHALLA_CLIENT_ID, VALHALLA_URL, VALHALLA_USER_AGENT } from "../config";
import { INSTRUCTIONS_CACHE, isFresh, markUsed, pruneSoon } from "../data/diskCache";
import { joinChunks, placeManeuvers, placeSpeedLimits, splitTrack, tripPieces } from "./maneuvers";
import { cumulativeMeters, encodePolyline6, traceShape } from "./polyline";

const TIMEOUT_MS = 20_000;
// bump when the cached shape or texts change
const CACHE_VERSION = 2;
// FOSSGIS terms: at most 1 request a second, one at a time
const MIN_REQUEST_GAP_MS = 1000;
const MAX_QUEUED = 30;
const MAX_TRACK_METERS = 1_000_000;
const NO_MATCH_CODES = [171, 442, 443, 444];
const TOO_LONG_CODE = 154;
const LANGUAGES = [
    "bg-BG", "ca-ES", "cs-CZ", "da-DK", "de-DE", "el-GR", "en-GB", "en-US", "es-ES", "et-EE", "fi-FI", "fr-FR",
    "he-IL", "hi-IN", "hu-HU", "it-IT", "ja-JP", "nb-NO", "nl-NL", "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU",
    "sk-SK", "sl-SI", "sv-SE", "tr-TR", "uk-UA",
];
const DEFAULT_LANGUAGE = "en-US";

export interface InstructionsRequest {
    trackId: number;
    points: LatLng[];
    costing: string;
    language: string;
    speedLimits: boolean;
}

export type InstructionsErrorKind = "no-match" | "too-long" | "timeout" | "unavailable";

export class InstructionsError extends Error {
    constructor(readonly kind: InstructionsErrorKind, message: string) {
        super(message);
    }
}

export function valhallaLanguage(locale: unknown): string {
    const tag = (typeof locale === "string" && locale ? locale : DEFAULT_LANGUAGE).replace("_", "-").toLowerCase();
    const exact = LANGUAGES.find((l) => l.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split("-")[0];
    if (base === "en") return DEFAULT_LANGUAGE;
    return LANGUAGES.find((l) => l.toLowerCase().startsWith(base + "-")) ?? DEFAULT_LANGUAGE;
}

export function trackPoints(file: any): LatLng[] | null {
    if (!Array.isArray(file?.track)) return null;
    const points = file.track
        .map((p: any) => ({ lat: Number(p?.lat), lng: Number(p?.lng) }))
        .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    return points.length > 0 ? points : null;
}

let queueTail: Promise<unknown> = Promise.resolve();
let queued = 0;
let lastRequestAt = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (queued >= MAX_QUEUED) {
        return Promise.reject(new InstructionsError("unavailable", `Valhalla queue is full (${queued} waiting)`));
    }
    queued++;
    const run = queueTail.then(async () => {
        const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        lastRequestAt = Date.now();
        try {
            return await task();
        } finally {
            queued--;
        }
    });
    queueTail = run.catch(() => {});
    return run;
}

async function valhalla(endpoint: string, body: object): Promise<any> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": VALHALLA_USER_AGENT,
        "X-Client-Id": VALHALLA_CLIENT_ID,
    };
    // FOSSGIS asks for a Referer when there is one
    if (process.env.PUBLIC_URL) headers.Referer = process.env.PUBLIC_URL;
    let res: globalThis.Response;
    try {
        res = await fetch(`${VALHALLA_URL}/${endpoint}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (error) {
        if ((error as Error).name === "TimeoutError") throw new InstructionsError("timeout", `Valhalla ${endpoint} timed out`);
        throw new InstructionsError("unavailable", `Valhalla ${endpoint} failed: ${(error as Error).message}`);
    }

    let json: any;
    try {
        json = await res.json();
    } catch {
        json = null;
    }
    if (!res.ok) {
        const code = json?.error_code;
        const detail = `${res.status} ${code ?? ""} ${json?.error ?? res.statusText}`.replace(/\s+/g, " ");
        if (res.status === 400 && NO_MATCH_CODES.includes(code)) {
            throw new InstructionsError("no-match", `Valhalla ${endpoint} found no roads: ${detail}`);
        }
        if (res.status === 400 && code === TOO_LONG_CODE) {
            throw new InstructionsError("too-long", `Valhalla ${endpoint} refused the length: ${detail}`);
        }
        throw new InstructionsError("unavailable", `Valhalla ${endpoint} failed: ${detail}`);
    }
    return json;
}

async function chunkInstructions(chunk: Chunk, request: InstructionsRequest): Promise<TrackInstructions & { complete: boolean }> {
    const shape = encodePolyline6(traceShape(chunk.points));
    const route = await enqueue(() => valhalla("trace_route", {
        encoded_polyline: shape,
        shape_match: "map_snap",
        costing: request.costing,
        directions_options: { units: "kilometers", language: request.language },
    }));
    const pieces = tripPieces(route);
    if (pieces.length === 0) throw new InstructionsError("no-match", "Valhalla trace_route returned no trip");
    const maneuvers = placeManeuvers(pieces, chunk.points);
    if (!request.speedLimits) return { maneuvers, speedLimits: [], complete: true };

    try {
        const attributes = await enqueue(() => valhalla("trace_attributes", {
            encoded_polyline: shape,
            shape_match: "map_snap",
            costing: request.costing,
            directions_options: { units: "kilometers" },
            filters: {
                attributes: ["edge.speed_limit", "edge.length", "edge.begin_shape_index", "edge.end_shape_index", "shape"],
                action: "include",
            },
        }));
        return { maneuvers, speedLimits: placeSpeedLimits(attributes, chunk.points), complete: true };
    } catch (error) {
        if (!(error instanceof InstructionsError)) throw error;
        console.error(`Speed limits skipped: ${error.message}`);
        return { maneuvers, speedLimits: [], complete: false };
    }
}

function cacheFile(request: InstructionsRequest): string {
    const hash = crypto.createHash("sha1").update(JSON.stringify(request.points)).digest("hex").slice(0, 16);
    return path.join(INSTRUCTIONS_CACHE_DIR, `${request.trackId}-${request.costing}-${request.language}-${hash}-${CACHE_VERSION}.json`);
}

function readCache(file: string): TrackInstructions | null {
    if (!isFresh(INSTRUCTIONS_CACHE, file)) return null;
    try {
        const cached = JSON.parse(fs.readFileSync(file, "utf-8"));
        markUsed(file);
        return cached;
    } catch {
        return null;
    }
}

function writeCache(file: string, instructions: TrackInstructions) {
    try {
        fs.mkdirSync(INSTRUCTIONS_CACHE_DIR, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(instructions));
        fs.renameSync(tmp, file);
        markUsed(file);
        pruneSoon(INSTRUCTIONS_CACHE);
    } catch (error) {
        console.error(`Instructions cache write failed: ${(error as Error).message}`);
    }
}

async function fetchInstructions(request: InstructionsRequest, file: string): Promise<TrackInstructions> {
    const chunks = splitTrack(request.points);
    const parts = [];
    for (const chunk of chunks) parts.push({ chunk, result: await chunkInstructions(chunk, request) });
    const instructions = joinChunks(parts);
    if (parts.every((p) => p.result.complete)) writeCache(file, instructions);
    return instructions;
}

const inFlight = new Map<string, Promise<TrackInstructions>>();

export async function trackInstructions(request: InstructionsRequest): Promise<TrackInstructions> {
    const length = cumulativeMeters(request.points).pop()!;
    if (length > MAX_TRACK_METERS) {
        throw new InstructionsError("too-long", `Track is ${Math.round(length / 1000)} km`);
    }
    const file = cacheFile(request);
    const cached = readCache(file);
    if (cached) return cached;

    let pending = inFlight.get(file);
    if (!pending) {
        pending = fetchInstructions(request, file).finally(() => inFlight.delete(file));
        inFlight.set(file, pending);
    }
    return pending;
}

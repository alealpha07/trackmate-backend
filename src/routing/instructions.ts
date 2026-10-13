import crypto from "crypto";
import fs from "fs";
import path from "path";
import { haversineMeters, toRadians, EARTH_RADIUS_METERS } from "./haversine";
import { LatLng } from "./types";
import { INSTRUCTIONS_CACHE_DIR, VALHALLA_CLIENT_ID, VALHALLA_URL, VALHALLA_USER_AGENT } from "./config";
import { INSTRUCTIONS_CACHE, isFresh, markUsed, pruneSoon } from "./diskCache";

const TIMEOUT_MS = 20_000;
// FOSSGIS terms: at most 1 request a second, one at a time
const MIN_REQUEST_GAP_MS = 1000;
const MAX_QUEUED = 30;
// Valhalla's default trace limit is 200 km, the overlap gives turns at the cut some context
const CHUNK_METERS = 100_000;
const CHUNK_OVERLAP_METERS = 1_000;
const MAX_TRACK_METERS = 1_000_000;
const MIN_SPACING_METERS = 10;
const MAX_SHAPE_POINTS = 16_000;
// farther apart, Valhalla breaks the trace there (its breakage distance is 2 km)
const MAX_GAP_METERS = 1_000;
// a meter off the expected place counts a tenth of a meter off the track, for junctions passed twice
const EXPECTED_ALONG_COST = 0.1;
const DEPART_TYPES = [1, 2, 3];
const ARRIVE_TYPES = [4, 5, 6];
const NO_MATCH_CODES = [171, 442, 443, 444];
const TOO_LONG_CODE = 154;
const LANGUAGES = [
    "bg-BG", "ca-ES", "cs-CZ", "da-DK", "de-DE", "el-GR", "en-GB", "en-US", "es-ES", "et-EE", "fi-FI", "fr-FR",
    "he-IL", "hi-IN", "hu-HU", "it-IT", "ja-JP", "nb-NO", "nl-NL", "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU",
    "sk-SK", "sl-SI", "sv-SE", "tr-TR", "uk-UA",
];
const DEFAULT_LANGUAGE = "en-US";
const METERS_PER_DEGREE = (EARTH_RADIUS_METERS * Math.PI) / 180;

export interface Maneuver {
    type: number;
    text: string;
    streets: string[];
    along: number;
    length: number;
    time: number;
    verbalPre: string | null;
    verbalPost: string | null;
}

export interface SpeedLimit {
    from: number;
    to: number;
    kmh: number;
}

export interface TrackInstructions {
    maneuvers: Maneuver[];
    speedLimits: SpeedLimit[];
}

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

function distance(a: LatLng, b: LatLng): number {
    return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

function thin(points: LatLng[], spacing: number): LatLng[] {
    const kept = [points[0]];
    for (const point of points.slice(1)) {
        if (distance(kept[kept.length - 1], point) >= spacing) kept.push(point);
    }
    const last = points[points.length - 1];
    if (kept.length > 1 && kept[kept.length - 1] !== last) kept[kept.length - 1] = last;
    else if (kept.length === 1 && points.length > 1) kept.push(last);
    return kept;
}

export function traceShape(points: LatLng[]): LatLng[] {
    let spacing = MIN_SPACING_METERS;
    let thinned = thin(points, spacing);
    while (thinned.length > MAX_SHAPE_POINTS) {
        spacing *= 2;
        thinned = thin(points, spacing);
    }

    const shape = [thinned[0]];
    for (const point of thinned.slice(1)) {
        const previous = shape[shape.length - 1];
        const steps = Math.ceil(distance(previous, point) / MAX_GAP_METERS);
        for (let i = 1; i < steps; i++) {
            shape.push({
                lat: previous.lat + ((point.lat - previous.lat) * i) / steps,
                lng: previous.lng + ((point.lng - previous.lng) * i) / steps,
            });
        }
        shape.push(point);
    }
    return shape;
}

export function encodePolyline6(points: LatLng[]): string {
    let encoded = "";
    let lastLat = 0;
    let lastLng = 0;
    const encodeValue = (value: number) => {
        let v = value < 0 ? ~(value << 1) : value << 1;
        while (v >= 0x20) {
            encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
            v >>= 5;
        }
        encoded += String.fromCharCode(v + 63);
    };
    for (const { lat, lng } of points) {
        const latE6 = Math.round(lat * 1e6);
        const lngE6 = Math.round(lng * 1e6);
        encodeValue(latE6 - lastLat);
        encodeValue(lngE6 - lastLng);
        lastLat = latE6;
        lastLng = lngE6;
    }
    return encoded;
}

export function decodePolyline6(encoded: string): LatLng[] {
    const points: LatLng[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const decodeValue = () => {
        let result = 0;
        let shift = 0;
        let byte;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (index < encoded.length) {
        lat += decodeValue();
        lng += decodeValue();
        points.push({ lat: lat / 1e6, lng: lng / 1e6 });
    }
    return points;
}

function cumulativeMeters(points: LatLng[]): number[] {
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
    return cumulative;
}

class TrackLine {
    private readonly cumulative: number[];
    readonly length: number;

    constructor(private readonly points: LatLng[]) {
        if (points.length === 1) this.points = [points[0], points[0]];
        this.cumulative = cumulativeMeters(this.points);
        this.length = this.cumulative[this.cumulative.length - 1];
    }

    locate(point: LatLng, from: number, expected: number, expectedCost = EXPECTED_ALONG_COST): number {
        let best = from;
        let bestScore = Infinity;
        for (let i = 0; i < this.points.length - 1; i++) {
            if (this.cumulative[i + 1] < from) continue;
            // every later segment is even farther from the expected place
            if (expectedCost * (this.cumulative[i] - expected) > bestScore) break;
            const projected = this.project(point, i);
            const along = Math.max(projected.along, from);
            const score = projected.distance + expectedCost * Math.abs(along - expected);
            if (score < bestScore) {
                best = along;
                bestScore = score;
            }
        }
        return best;
    }

    private project(point: LatLng, i: number): { along: number; distance: number } {
        const a = this.points[i];
        const b = this.points[i + 1];
        const metersPerLng = METERS_PER_DEGREE * Math.cos(toRadians(point.lat));
        const ax = (a.lng - point.lng) * metersPerLng;
        const ay = (a.lat - point.lat) * METERS_PER_DEGREE;
        const dx = (b.lng - a.lng) * metersPerLng;
        const dy = (b.lat - a.lat) * METERS_PER_DEGREE;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSquared));
        return {
            along: this.cumulative[i] + t * (this.cumulative[i + 1] - this.cumulative[i]),
            distance: Math.hypot(ax + t * dx, ay + t * dy),
        };
    }
}

const round1 = (value: number) => Math.round(value * 10) / 10;

// a broken match puts the pieces after the first one in alternates
export function tripPieces(json: any): any[] {
    return [json?.trip, ...(json?.alternates ?? []).map((a: any) => a?.trip)].filter((trip) => trip?.legs?.length);
}

export function placeManeuvers(pieces: any[], points: LatLng[]): Maneuver[] {
    const line = new TrackLine(points);
    const maneuvers: Maneuver[] = [];
    let along = 0;
    pieces.forEach((trip, p) => {
        const raw = (trip.legs as any[]).flatMap((leg) => {
            const shape = decodePolyline6(leg.shape ?? "");
            return (leg.maneuvers ?? []).map((m: any) => ({ m, begin: shape[m.begin_shape_index] ?? shape[0] }));
        });
        const matchedLength = raw.reduce((sum, { m }) => sum + (m.length ?? 0) * 1000, 0);
        if (raw.length === 0 || (p > 0 && matchedLength === 0)) return;
        const start = p === 0 || !raw[0].begin ? along : line.locate(raw[0].begin, along, along, 0);
        const scale = pieces.length === 1 && matchedLength > 0 ? line.length / matchedLength : 1;

        let matchedAlong = 0;
        raw.forEach(({ m, begin }, i) => {
            if (begin) along = line.locate(begin, Math.max(along, start), start + matchedAlong * scale);
            matchedAlong += (m.length ?? 0) * 1000;
            const inner = (p > 0 && i === 0 && DEPART_TYPES.includes(m.type))
                || (p < pieces.length - 1 && i === raw.length - 1 && ARRIVE_TYPES.includes(m.type));
            if (inner) return;
            maneuvers.push({
                type: m.type,
                text: m.instruction ?? "",
                streets: m.street_names ?? [],
                along: round1(along),
                length: round1((m.length ?? 0) * 1000),
                time: round1(m.time ?? 0),
                verbalPre: m.verbal_pre_transition_instruction ?? null,
                verbalPost: m.verbal_post_transition_instruction ?? null,
            });
        });
    });
    return maneuvers;
}

export function placeSpeedLimits(attributes: any, points: LatLng[]): SpeedLimit[] {
    const line = new TrackLine(points);
    const shape = decodePolyline6(attributes?.shape ?? "");
    const edges: any[] = attributes?.edges ?? [];
    const broken = (i: number) => i > 0 && edges[i].begin_shape_index !== edges[i - 1].end_shape_index;
    const matchedLength = edges.reduce((sum, e) => sum + (e.length ?? 0) * 1000, 0);
    const scale = matchedLength > 0 && !edges.some((_, i) => broken(i)) ? line.length / matchedLength : 1;

    let along = 0;
    let pieceStart = 0;
    let pieceMatched = 0;
    const starts = edges.map((edge, i) => {
        const begin = shape[edge.begin_shape_index];
        if (broken(i)) {
            pieceMatched = 0;
            if (begin) along = pieceStart = line.locate(begin, along, along, 0);
        } else if (begin) {
            along = line.locate(begin, along, pieceStart + pieceMatched * scale);
        }
        pieceMatched += (edge.length ?? 0) * 1000;
        return along;
    });

    const limits: SpeedLimit[] = [];
    edges.forEach((edge, i) => {
        const kmh = edge.speed_limit;
        if (typeof kmh !== "number" || kmh <= 0 || kmh > 200) return;
        const from = starts[i];
        const end = shape[edge.end_shape_index];
        let to = line.length;
        if (i + 1 < edges.length && !broken(i + 1)) to = starts[i + 1];
        else if (end) to = line.locate(end, from, from + (edge.length ?? 0) * 1000 * scale);
        if (to <= from) return;
        const previous = limits[limits.length - 1];
        if (previous && previous.kmh === kmh && from - previous.to < 1) previous.to = to;
        else limits.push({ from, to, kmh });
    });
    return limits.map((l) => ({ from: round1(l.from), to: round1(l.to), kmh: l.kmh }));
}

interface Chunk {
    points: LatLng[];
    offset: number;
    keepFrom: number;
    keepTo: number;
}

export function splitTrack(points: LatLng[]): Chunk[] {
    const cumulative = cumulativeMeters(points);
    const length = cumulative[cumulative.length - 1];
    const count = Math.max(1, Math.ceil(length / CHUNK_METERS));
    const chunks: Chunk[] = [];
    for (let k = 0; k < count; k++) {
        const keepFrom = k === 0 ? -Infinity : k * CHUNK_METERS;
        const keepTo = k === count - 1 ? Infinity : (k + 1) * CHUNK_METERS;
        let first = 0;
        while (first + 1 < points.length && cumulative[first + 1] <= keepFrom - CHUNK_OVERLAP_METERS) first++;
        let last = points.length - 1;
        while (last - 1 > first && cumulative[last - 1] >= keepTo + CHUNK_OVERLAP_METERS) last--;
        chunks.push({ points: points.slice(first, last + 1), offset: cumulative[first], keepFrom, keepTo });
    }
    return chunks;
}

export function joinChunks(parts: { chunk: Chunk; result: TrackInstructions }[]): TrackInstructions {
    const maneuvers: Maneuver[] = [];
    const speedLimits: SpeedLimit[] = [];
    for (const { chunk, result } of parts) {
        const kept = result.maneuvers
            .map((m) => ({ ...m, along: round1(m.along + chunk.offset) }))
            .filter((m) => m.along >= chunk.keepFrom && m.along < chunk.keepTo);
        // the last one before a cut ran to the chunk's own destination
        const previous = maneuvers[maneuvers.length - 1];
        if (previous && kept.length > 0) {
            const length = round1(kept[0].along - previous.along);
            previous.time = previous.length > 0 ? round1((previous.time * length) / previous.length) : previous.time;
            previous.length = length;
        }
        maneuvers.push(...kept);

        for (const limit of result.speedLimits) {
            const from = Math.max(limit.from + chunk.offset, chunk.keepFrom);
            const to = Math.min(limit.to + chunk.offset, chunk.keepTo);
            if (to <= from) continue;
            const last = speedLimits[speedLimits.length - 1];
            if (last && last.kmh === limit.kmh && from - last.to < 1) last.to = round1(to);
            else speedLimits.push({ from: round1(from), to: round1(to), kmh: limit.kmh });
        }
    }
    return { maneuvers, speedLimits };
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
    return path.join(INSTRUCTIONS_CACHE_DIR, `${request.trackId}-${request.costing}-${request.language}-${hash}.json`);
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

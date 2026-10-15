import { EARTH_RADIUS_METERS, toRadians } from "../haversine.js";
import { Chunk, LatLng, Maneuver, SpeedLimit, TrackInstructions } from "../types.js";
import { cumulativeMeters, decodePolyline6 } from "./polyline.js";

// Valhalla's default trace limit is 200 km, the overlap gives turns at the cut some context
const CHUNK_METERS = 100_000;
const CHUNK_OVERLAP_METERS = 1_000;
// a meter off the expected place counts a tenth of a meter off the track, for junctions passed twice
const EXPECTED_ALONG_COST = 0.1;
const DEPART_TYPES = [1, 2, 3];
const ARRIVE_TYPES = [4, 5, 6];
const METERS_PER_DEGREE = (EARTH_RADIUS_METERS * Math.PI) / 180;

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

        const innerArrive = (i: number) =>
            p < pieces.length - 1 && i === raw.length - 1 && ARRIVE_TYPES.includes(raw[i].m.type);
        let matchedAlong = 0;
        raw.forEach(({ m, begin }, i) => {
            if (begin) along = line.locate(begin, Math.max(along, start), start + matchedAlong * scale);
            matchedAlong += (m.length ?? 0) * 1000;
            if ((p > 0 && i === 0 && DEPART_TYPES.includes(m.type)) || innerArrive(i)) return;
            // the spoken texts before a dropped arrival still mention it ("Then You will arrive")
            const beforeCut = innerArrive(i + 1);
            maneuvers.push({
                type: m.type,
                text: m.instruction ?? "",
                streets: m.street_names ?? [],
                along: round1(along),
                length: round1((m.length ?? 0) * 1000),
                time: round1(m.time ?? 0),
                verbalPre: (beforeCut && m.verbal_multi_cue
                    ? m.verbal_transition_alert_instruction ?? m.instruction
                    : m.verbal_pre_transition_instruction) ?? null,
                verbalPost: beforeCut ? null : m.verbal_post_transition_instruction ?? null,
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
            previous.verbalPost = null;
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

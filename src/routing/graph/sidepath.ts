import { SIDEPATH_MAX_ANGLE_DEGREES, SIDEPATH_MAX_METERS } from "../config.js";
import { OverpassNode, OverpassWay } from "../types.js";

const MAJOR_ROAD = /^(trunk|primary|secondary|tertiary)(_link)?$/;
const METERS_PER_DEGREE = 111_320;
// about 55 m, so a point only needs its own cell and the 8 around it
const CELL_DEG = 0.0005;

interface Segment {
    ax: number;
    ay: number;
    bx: number;
    by: number;
}

// tells whether a piece of path runs next to a major road, for paths without is_sidepath
export function besideMajorRoad(ways: OverpassWay[], nodeById: Map<number, OverpassNode>) {
    const cells = new Map<string, Segment[]>();
    let lonScale = 1;
    const key = (cx: number, cy: number) => `${cx},${cy}`;

    for (const way of ways) {
        if (!MAJOR_ROAD.test(way.tags?.highway ?? "")) continue;
        for (let i = 0; i < way.nodes.length - 1; i++) {
            const a = nodeById.get(way.nodes[i]);
            const b = nodeById.get(way.nodes[i + 1]);
            if (!a || !b) continue;
            lonScale = Math.cos((a.lat * Math.PI) / 180);
            const segment = { ax: a.lon, ay: a.lat, bx: b.lon, by: b.lat };
            const [x0, x1] = [Math.min(a.lon, b.lon), Math.max(a.lon, b.lon)].map((x) => Math.floor(x / CELL_DEG));
            const [y0, y1] = [Math.min(a.lat, b.lat), Math.max(a.lat, b.lat)].map((y) => Math.floor(y / CELL_DEG));
            for (let cx = x0; cx <= x1; cx++) {
                for (let cy = y0; cy <= y1; cy++) {
                    const list = cells.get(key(cx, cy));
                    if (list) list.push(segment);
                    else cells.set(key(cx, cy), [segment]);
                }
            }
        }
    }

    // local meters around the point, good enough within a few hundred meters
    const toMeters = (lon: number, lat: number, originLon: number, originLat: number) =>
        [(lon - originLon) * METERS_PER_DEGREE * lonScale, (lat - originLat) * METERS_PER_DEGREE];
    const maxSin = Math.sin((SIDEPATH_MAX_ANGLE_DEGREES * Math.PI) / 180);

    return (a: OverpassNode, b: OverpassNode): boolean => {
        if (cells.size === 0) return false;
        const midLon = (a.lon + b.lon) / 2;
        const midLat = (a.lat + b.lat) / 2;
        const [dx, dy] = toMeters(b.lon, b.lat, a.lon, a.lat);
        const length = Math.hypot(dx, dy);
        if (length === 0) return false;
        const cx = Math.floor(midLon / CELL_DEG);
        const cy = Math.floor(midLat / CELL_DEG);
        for (let x = cx - 1; x <= cx + 1; x++) {
            for (let y = cy - 1; y <= cy + 1; y++) {
                for (const s of cells.get(key(x, y)) ?? []) {
                    const [sax, say] = toMeters(s.ax, s.ay, midLon, midLat);
                    const [sbx, sby] = toMeters(s.bx, s.by, midLon, midLat);
                    const [ex, ey] = [sbx - sax, sby - say];
                    const roadLength = Math.hypot(ex, ey);
                    if (roadLength === 0) continue;
                    // distance from the path's middle to the road segment
                    const t = Math.max(0, Math.min(1, -(sax * ex + say * ey) / (roadLength * roadLength)));
                    if (Math.hypot(sax + t * ex, say + t * ey) > SIDEPATH_MAX_METERS) continue;
                    // either direction counts, a crossing doesn't
                    const sin = Math.abs(dx * ey - dy * ex) / (length * roadLength);
                    if (sin <= maxSin) return true;
                }
            }
        }
        return false;
    };
}

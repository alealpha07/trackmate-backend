import fs from "fs";
import { planningBBox } from "../src/routing/data/bbox.js";
import { planRoute } from "../src/routing/plan.js";
import { edgeCost } from "../src/routing/search/edgeWeight.js";
import { GraphEdge, LatLng } from "../src/routing/types.js";
import { CITIES, PLANNER_VARIANTS, TIMING_REPEATS, VariantId } from "./config.js";
import { edgesFromTrack, loadNetwork, matchValhalla, Network } from "./graph.js";
import { Pair, outPath, readJson, writeJson } from "./io.js";
import { addScore, emptyScore, Score, scoreEdges } from "./score.js";
import { ValhallaRoute, valhallaFile } from "./valhalla.js";
import { decodePolyline6 } from "../src/routing/instructions/polyline.js";

export interface VariantResult {
    ok: boolean;
    error?: string;
    // meters, the router's own length
    distance?: number;
    // valhalla: matched risk scaled to its whole length
    risk?: number;
    score?: Score;
    // valhalla only
    coverage?: number;
    wrongWay?: number;
    // planner only: the scored edges add up to the planner's totals
    consistent?: boolean;
    // first call, graph build included
    firstMs?: number;
    ms?: number[];
    geometry?: [number, number][];
}

export interface PairResult {
    pair: Pair;
    graphMs: number;
    variants: Partial<Record<VariantId, VariantResult>>;
}

export interface CityRoutes {
    pairs: PairResult[];
    // every edge used by any variant, once
    travelled: Score;
}

const never = new AbortController().signal;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(b));
const lngLat = (points: LatLng[]): [number, number][] => points.map((p) => [+p.lng.toFixed(6), +p.lat.toFixed(6)]);

async function plannerVariants(points: LatLng[], net: Network, use: (edges: GraphEdge[]) => void) {
    const results: Partial<Record<VariantId, VariantResult>> = {};
    for (const variant of PLANNER_VARIANTS) {
        const options = { policy: variant.policy, filters: variant.filters, maxDetour: variant.maxDetour };
        let start = performance.now();
        const route = await planRoute(points, options, never);
        const firstMs = performance.now() - start;
        if ("unreachableLeg" in route) {
            results[variant.id] = { ok: false, error: "unreachable", firstMs };
            continue;
        }
        const ms: number[] = [];
        for (let i = 0; i < TIMING_REPEATS; i++) {
            start = performance.now();
            await planRoute(points, options, never);
            ms.push(performance.now() - start);
        }
        const edges = edgesFromTrack(net, route.track, edgeCost(variant.policy));
        const score = scoreEdges(net, edges);
        use(edges);
        results[variant.id] = {
            ok: true,
            distance: route.distance,
            risk: route.risk,
            score,
            consistent: close(score.distance, route.distance) && close(score.risk, route.risk),
            firstMs,
            ms,
            geometry: lngLat(route.track),
        };
    }
    return results;
}

function valhallaVariant(city: string, pair: Pair, net: Network, use: (edges: GraphEdge[]) => void): VariantResult {
    const file = valhallaFile(city, pair);
    if (!fs.existsSync(file)) return { ok: false, error: "no valhalla route" };
    const route = readJson<ValhallaRoute>(file);
    const match = matchValhalla(net, route.attributes.shape, route.attributes.edges);
    const score = scoreEdges(net, match.edges);
    use(match.edges);
    const coverage = match.total > 0 ? match.matched / match.total : 0;
    return {
        ok: score.distance > 0,
        distance: route.length,
        // unmatched meters at the mean risk of the matched ones
        risk: score.distance > 0 ? (score.risk / score.distance) * route.length : undefined,
        score,
        coverage,
        wrongWay: match.wrongWay,
        ms: [route.requestMs],
        geometry: lngLat(decodePolyline6(route.shape)),
    };
}

export async function runRoutes() {
    const pairs = readJson<Record<string, Pair[]>>(outPath("pairs.json"));
    for (const city of CITIES) {
        const results: PairResult[] = [];
        const travelled = emptyScore();
        const seen = new Set<string>();
        for (const pair of pairs[city.id]) {
            const points = [{ lat: pair.from.lat, lng: pair.from.lng }, { lat: pair.to.lat, lng: pair.to.lng }];
            const start = performance.now();
            const net = await loadNetwork(planningBBox(points[0], points[1]));
            const graphMs = performance.now() - start;
            const use = (edges: GraphEdge[]) => {
                const fresh = edges.filter((e) => !seen.has(e.id));
                fresh.forEach((e) => seen.add(e.id));
                addScore(travelled, scoreEdges(net, fresh));
            };

            const variants = await plannerVariants(points, net, use);
            variants.valhalla = valhallaVariant(city.id, pair, net, use);
            results.push({ pair, graphMs, variants });

            const line = Object.entries(variants)
                .map(([id, v]) => `${id} ${v.ok ? `${(v.distance! / 1000).toFixed(1)} km` : v.error}`
                    + (v.consistent === false ? " (MISMATCH)" : "")
                    + (v.coverage !== undefined ? ` (${(100 * v.coverage).toFixed(0)}% matched)` : ""))
                .join(", ");
            console.log(`${city.id} ${pair.id}: ${line}`);
        }
        writeJson(outPath("routes", `${city.id}.json`), { pairs: results, travelled } satisfies CityRoutes);
    }
}

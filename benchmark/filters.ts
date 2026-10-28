import { planningBBox } from "../src/routing/data/bbox.js";
import { planRoute } from "../src/routing/plan.js";
import { edgeCost } from "../src/routing/search/edgeWeight.js";
import { CITIES, FILTER_RUNS, FilterRunId } from "./config.js";
import { edgesFromTrack, loadNetwork } from "./graph.js";
import { Pair, outPath, readJson, writeJson } from "./io.js";
import { scoreEdges } from "./score.js";

// meters, risk as the planner gives it
export interface FilterRun {
    distance: number;
    risk: number;
    scored: number;
    lts4: number;
    bikeway: number;
}

export interface PairFilterRuns {
    pair: number;
    runs: Partial<Record<FilterRunId, FilterRun>>;
}

const never = new AbortController().signal;

export async function runFilters() {
    const pairs = readJson<Record<string, Pair[]>>(outPath("pairs.json"));
    for (const city of CITIES) {
        const results: PairFilterRuns[] = [];
        for (const pair of pairs[city.id]) {
            const points = [{ lat: pair.from.lat, lng: pair.from.lng }, { lat: pair.to.lat, lng: pair.to.lng }];
            const net = await loadNetwork(planningBBox(points[0], points[1]));
            const runs: PairFilterRuns["runs"] = {};
            for (const run of FILTER_RUNS) {
                const route = await planRoute(points, { policy: "safest", filters: run.filters, maxDetour: run.maxDetour }, never);
                if ("unreachableLeg" in route) continue;
                const score = scoreEdges(net, edgesFromTrack(net, route.track, edgeCost("safest")));
                runs[run.id] = { distance: route.distance, risk: route.risk, scored: score.distance, lts4: score.lts[3], bikeway: score.bikeway };
            }
            results.push({ pair: pair.id, runs });
            console.log(`${city.id} ${pair.id}: ${Object.entries(runs).map(([id, r]) => `${id} ${(r.distance / 1000).toFixed(1)} km`).join(", ")}`);
        }
        writeJson(outPath("filters", `${city.id}.json`), results);
    }
}

import { nodeExtent, planningBBox } from "./bbox";
import { buildGraph } from "./buildGraph";
import { DISPLAY_CYCLING_SPEED_KMH, GRAPH_CACHE_MAX_EDGES } from "./config";
import { markSnappable } from "./components";
import { loadDemTiles, loadElevation } from "./elevation";
import { buildAdjacency, dijkstra } from "./dijkstra";
import { Policy, edgeCost, edgePenalties } from "./edgeWeight";
import { RouteFilters } from "./filters";
import { nearestNode } from "./nearestNode";
import { loadTiles } from "./tileCache";
import { GraphEdge, LatLng, PlannedRoute, RouteLeg, RouteStats, RoutingGraph, TrackPoint } from "./types";

interface CachedGraph {
    graph: RoutingGraph;
    adjacency: Map<string, GraphEdge[]>;
}

// By tile set, one per leg: dragging one stop only rebuilds the two legs next to it
const graphCache = new Map<string, CachedGraph>();
let cachedEdges = 0;

async function cachedGraph(key: string, build: () => Promise<CachedGraph>): Promise<CachedGraph> {
    let entry = graphCache.get(key);
    // Another request may have built the same graph while this one waited for its elevation data
    if (!entry) {
        const built = await build();
        entry = graphCache.get(key);
        if (!entry) {
            entry = built;
            cachedEdges += entry.graph.edges.length;
            while (cachedEdges > GRAPH_CACHE_MAX_EDGES && graphCache.size > 0) {
                const [oldestKey, oldest] = graphCache.entries().next().value!;
                graphCache.delete(oldestKey);
                cachedEdges -= oldest.graph.edges.length;
            }
        }
    }
    // Map keeps insertion order: re-insert to mark as most recently used
    graphCache.delete(key);
    graphCache.set(key, entry);
    return entry;
}

type SoftStats = Pick<RouteStats, "offBikeways" | "highStress" | "unpaved">;

function stats(distance: number, risk: number, soft: SoftStats): RouteStats {
    return { distance, duration: distance / (DISPLAY_CYCLING_SPEED_KMH / 3.6), risk, ...soft };
}

/** Length on the roads each soft filter that is on avoids. */
function softStats(edges: GraphEdge[], filters: RouteFilters): SoftStats {
    const length = (test: (edge: GraphEdge) => boolean) => edges.reduce((sum, e) => sum + (test(e) ? e.distance : 0), 0);
    const soft: SoftStats = {};
    if (filters.cyclewaysOnly) soft.offBikeways = length((e) => !e.bikeway);
    if (filters.avoidLts4) soft.highStress = length((e) => e.lts === 4);
    if (filters.avoidUnpaved) soft.unpaved = length((e) => e.unpaved);
    return soft;
}

function latLng(graph: RoutingGraph, id: string): LatLng {
    return { lat: graph.nodes[id].lat, lng: graph.nodes[id].lon };
}

export interface PlanOptions {
    policy: Policy;
    filters: RouteFilters;
}

/** Each leg (start, stops, destination) gets its own box and graph, and the legs are joined end to
 * end: the best route through fixed stops is the sequence of best legs.
 * Rejects with an AbortError when `signal` aborts, and with a PartialDownloadError when map data
 * is missing. */
export async function planRoute(
    points: LatLng[],
    options: PlanOptions,
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
): Promise<PlannedRoute | { unreachableLeg: number }> {
    const boxes = points.slice(1).map((end, i) => planningBBox(points[i], end));
    const [legTiles] = await Promise.all([loadTiles(boxes, signal, onProgress), ...boxes.map((box) => loadDemTiles(box, signal))]);
    const cost = edgeCost(options.policy);
    const penalties = edgePenalties(options.filters, cost);

    const track: TrackPoint[] = [];
    const legs: RouteLeg[] = [];
    const routeEdges: GraphEdge[] = [];
    let joint: string | null = null;
    for (let i = 0; i < boxes.length; i++) {
        // Building a leg blocks the event loop: let other requests (and a client abort) in between legs
        if (i > 0) await new Promise((resolve) => setImmediate(resolve));
        signal.throwIfAborted();

        const { key, elements } = legTiles[i];
        const { graph, adjacency } = await cachedGraph(key, async () => {
            const data = elements();
            const elevation = await loadElevation(nodeExtent(data, boxes[i]), signal);
            const graph = buildGraph(data, boxes[i], elevation);
            const adjacency = buildAdjacency(graph);
            markSnappable(graph, adjacency);
            return { graph, adjacency };
        });

        // Legs join exactly at the stop
        const startId = joint !== null && graph.nodes[joint] ? joint : nearestNode(graph, points[i].lat, points[i].lng);
        const endId = nearestNode(graph, points[i + 1].lat, points[i + 1].lng);
        if (!startId || !endId) return { unreachableLeg: i };

        const result = dijkstra(adjacency, startId, endId, cost, penalties);
        if (!result) return { unreachableLeg: i };

        // The joint node is already the last point of the track
        const nodeIds = result.nodeIds[0] === joint ? result.nodeIds.slice(1) : result.nodeIds;
        for (const id of nodeIds) {
            track.push({ lat: graph.nodes[id].lat, lng: graph.nodes[id].lon, timestamp: 0, speed: 0 });
        }
        routeEdges.push(...result.edges);
        legs.push({
            ...stats(result.totalDistanceMeters, result.totalRisk, softStats(result.edges, options.filters)),
            from: latLng(graph, startId),
            to: latLng(graph, endId),
        });
        joint = endId;
    }

    const total = (field: "distance" | "risk") => legs.reduce((sum, l) => sum + l[field], 0);
    return { track, ...stats(total("distance"), total("risk"), softStats(routeEdges, options.filters)), legs };
}

import { planningBBox } from "./bbox";
import { buildGraph } from "./buildGraph";
import { DISPLAY_CYCLING_SPEED_KMH, GRAPH_CACHE_MAX_EDGES } from "./config";
import { markSnappable } from "./components";
import { buildAdjacency, dijkstra } from "./dijkstra";
import { Policy, edgeCost } from "./edgeWeight";
import { RouteFilters, edgeFilter } from "./filters";
import { nearestNode } from "./nearestNode";
import { loadTiles } from "./tileCache";
import { GraphEdge, LatLng, PlannedRoute, RouteLeg, RoutingGraph, TrackPoint } from "./types";

interface CachedGraph {
    graph: RoutingGraph;
    adjacency: Map<string, GraphEdge[]>;
}

// one graph per leg, moving a stop rebuilds only its legs
const graphCache = new Map<string, CachedGraph>();
let cachedEdges = 0;

function cachedGraph(key: string, build: () => CachedGraph): CachedGraph {
    let entry = graphCache.get(key);
    if (entry) {
        // re-insert to mark as recently used
        graphCache.delete(key);
    } else {
        entry = build();
        cachedEdges += entry.graph.edges.length;
        // drop least recently used graphs until it fits
        while (cachedEdges > GRAPH_CACHE_MAX_EDGES && graphCache.size > 0) {
            const [oldestKey, oldest] = graphCache.entries().next().value!;
            graphCache.delete(oldestKey);
            cachedEdges -= oldest.graph.edges.length;
        }
    }
    graphCache.set(key, entry);
    return entry;
}

function leg(distance: number, risk: number): RouteLeg {
    return { distance, duration: distance / (DISPLAY_CYCLING_SPEED_KMH / 3.6), risk };
}

export interface PlanOptions {
    policy: Policy;
    filters: RouteFilters;
}

// points snap only to nodes the filters allow
function usableNodes(graph: RoutingGraph, allowed: (edge: GraphEdge) => boolean): Set<string> {
    const nodes = new Set<string>();
    for (const edge of graph.edges) {
        if (!allowed(edge)) continue;
        nodes.add(String(edge.from));
        nodes.add(String(edge.to));
    }
    return nodes;
}

// each leg gets its own graph, legs are joined end to end
export async function planRoute(
    points: LatLng[],
    options: PlanOptions,
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
): Promise<PlannedRoute | { unreachableLeg: number }> {
    const boxes = points.slice(1).map((end, i) => planningBBox(points[i], end));
    const legTiles = await loadTiles(boxes, signal, onProgress);
    const cost = edgeCost(options.policy);
    const allowed = edgeFilter(options.filters);

    const track: TrackPoint[] = [];
    const legs: RouteLeg[] = [];
    let joint: string | null = null; // node where the previous leg ended
    for (let i = 0; i < boxes.length; i++) {
        // let other requests in between legs
        if (i > 0) await new Promise((resolve) => setImmediate(resolve));
        signal.throwIfAborted();

        const { key, elements } = legTiles[i];
        const { graph, adjacency } = cachedGraph(key, () => {
            const graph = buildGraph(elements(), boxes[i]);
            const adjacency = buildAdjacency(graph);
            markSnappable(graph, adjacency);
            return { graph, adjacency };
        });

        const usable = allowed && usableNodes(graph, allowed);
        // legs join exactly at the stop
        const continues = joint !== null && graph.nodes[joint] && (!usable || usable.has(joint));
        const startId = continues ? joint : nearestNode(graph, points[i].lat, points[i].lng, usable);
        const endId = nearestNode(graph, points[i + 1].lat, points[i + 1].lng, usable);
        if (!startId || !endId) return { unreachableLeg: i };

        const result = dijkstra(adjacency, startId, endId, cost, allowed);
        if (!result) return { unreachableLeg: i };

        const nodeIds = result.nodeIds[0] === joint ? result.nodeIds.slice(1) : result.nodeIds;
        for (const id of nodeIds) {
            track.push({ lat: graph.nodes[id].lat, lng: graph.nodes[id].lon, timestamp: 0, speed: 0 });
        }
        legs.push(leg(result.totalDistanceMeters, result.totalRisk));
        joint = endId;
    }

    const distance = legs.reduce((sum, l) => sum + l.distance, 0);
    const risk = legs.reduce((sum, l) => sum + l.risk, 0);
    return { track, ...leg(distance, risk), legs };
}

import { planningBBox } from "./bbox";
import { buildGraph } from "./buildGraph";
import { DISPLAY_CYCLING_SPEED_KMH, GRAPH_CACHE_SIZE } from "./config";
import { buildAdjacency, dijkstra } from "./dijkstra";
import { nearestNode } from "./nearestNode";
import { loadTiles } from "./tileCache";
import { GraphEdge, LatLng, PlannedRoute, RoutingGraph } from "./types";

interface CachedGraph {
    graph: RoutingGraph;
    adjacency: Map<string, GraphEdge[]>;
}

// reuse graphs when planning again in the same area
const graphCache = new Map<string, CachedGraph>();

function cachedGraph(key: string, build: () => CachedGraph): CachedGraph {
    let entry = graphCache.get(key);
    if (entry) {
        // re-insert to mark as recently used
        graphCache.delete(key);
    } else {
        entry = build();
        if (graphCache.size >= GRAPH_CACHE_SIZE) graphCache.delete(graphCache.keys().next().value!);
    }
    graphCache.set(key, entry);
    return entry;
}

// each leg gets its own graph, legs are joined end to end
export async function planRoute(start: LatLng, end: LatLng, signal: AbortSignal): Promise<PlannedRoute | null> {
    const bbox = planningBBox(start, end);
    const tiles = await loadTiles(bbox, signal);
    const { graph, adjacency } = cachedGraph(tiles.key, () => {
        const graph = buildGraph(tiles.elements(), bbox);
        return { graph, adjacency: buildAdjacency(graph) };
    });

    const startId = nearestNode(graph, start.lat, start.lng);
    const endId = nearestNode(graph, end.lat, end.lng);
    if (!startId || !endId) return null;

    const result = dijkstra(adjacency, startId, endId);
    if (!result) return null;

    const distance = result.totalDistanceMeters;
    return {
        track: result.nodeIds.map((id) => ({
            lat: graph.nodes[id].lat,
            lng: graph.nodes[id].lon,
            timestamp: 0,
            speed: 0,
        })),
        distance,
        duration: distance / (DISPLAY_CYCLING_SPEED_KMH / 3.6),
    };
}

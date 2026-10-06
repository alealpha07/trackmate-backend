import { planningBBox } from "./bbox";
import { buildGraph } from "./buildGraph";
import { DISPLAY_CYCLING_SPEED_KMH } from "./config";
import { buildAdjacency, dijkstra } from "./dijkstra";
import { nearestNode } from "./nearestNode";
import { loadElements } from "./tileCache";
import { LatLng, PlannedRoute } from "./types";

/** Plans a route between two points, or returns null when the snapped points aren't connected. */
export async function planRoute(start: LatLng, end: LatLng): Promise<PlannedRoute | null> {
    const bbox = planningBBox(start, end);
    const graph = buildGraph(await loadElements(bbox), bbox);

    const startId = nearestNode(graph, start.lat, start.lng);
    const endId = nearestNode(graph, end.lat, end.lng);
    if (!startId || !endId) return null;

    const result = dijkstra(buildAdjacency(graph), startId, endId);
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

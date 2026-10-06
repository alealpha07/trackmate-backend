import { RoutingGraph } from "./types";

/** Brute-force nearest node. Fine at BBOX size for two lookups per request. */
export function nearestNode(graph: RoutingGraph, lat: number, lon: number): string | null {
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const id in graph.nodes) {
        const n = graph.nodes[id];
        const d = (n.lat - lat) ** 2 + (n.lon - lon) ** 2;
        if (d < bestDist) {
            bestDist = d;
            bestId = id;
        }
    }
    return bestId;
}

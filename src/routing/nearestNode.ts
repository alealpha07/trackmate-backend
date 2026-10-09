import { RoutingGraph } from "./types";

/** Brute force, fine for a few lookups per request. Prefers nodes where points may snap (components.ts). */
export function nearestNode(graph: RoutingGraph, lat: number, lon: number): string | null {
    let bestId: string | null = null;
    let bestDist = Infinity;
    let anyId: string | null = null;
    let anyDist = Infinity;
    for (const id in graph.nodes) {
        const n = graph.nodes[id];
        const d = (n.lat - lat) ** 2 + (n.lon - lon) ** 2;
        if (d < anyDist) {
            anyDist = d;
            anyId = id;
        }
        if (n.snappable && d < bestDist) {
            bestDist = d;
            bestId = id;
        }
    }
    return bestId ?? anyId;
}

import { RoutingGraph } from "./types";

/** Brute-force nearest node, among `usable` nodes when given. Prefers nodes in a large connected
 * component (components.ts), so a point is never snapped onto an island without a way out.
 * Fine at BBOX size for a few lookups per request. */
export function nearestNode(graph: RoutingGraph, lat: number, lon: number, usable: Set<string> | null = null): string | null {
    let bestId: string | null = null;
    let bestDist = Infinity;
    let anyId: string | null = null;
    let anyDist = Infinity;
    for (const id in graph.nodes) {
        if (usable && !usable.has(id)) continue;
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

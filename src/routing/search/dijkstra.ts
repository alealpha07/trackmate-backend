import { GraphEdge, RouteResult, RoutingGraph } from "../types";
import { MinHeap, keyLess } from "./priorityQueue";

export function buildAdjacency(graph: RoutingGraph): Map<string, GraphEdge[]> {
    const adjacency = new Map<string, GraphEdge[]>();
    for (const edge of graph.edges) {
        const from = String(edge.from);
        const bucket = adjacency.get(from);
        if (bucket) bucket.push(edge);
        else adjacency.set(from, [edge]);
    }
    return adjacency;
}

// penalties first, in order, then the cost
export function dijkstra(
    adjacency: Map<string, GraphEdge[]>,
    startId: string,
    endId: string,
    cost: (edge: GraphEdge) => number,
    penalties: ((edge: GraphEdge) => number)[] = [],
): RouteResult | null {
    const keys = new Map<string, number[]>([[startId, new Array(penalties.length + 1).fill(0)]]);
    const prevEdge = new Map<string, GraphEdge>();
    const visited = new Set<string>();
    const heap = new MinHeap<string>();
    heap.push(startId, keys.get(startId)!);

    while (heap.size > 0) {
        const current = heap.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        if (current === endId) break;

        const currentKey = keys.get(current)!;
        for (const edge of adjacency.get(current) ?? []) {
            const to = String(edge.to);
            if (visited.has(to)) continue;

            const candidate = penalties.map((penalty, i) => currentKey[i] + penalty(edge));
            candidate.push(currentKey[penalties.length] + cost(edge));
            const known = keys.get(to);
            if (!known || keyLess(candidate, known)) {
                keys.set(to, candidate);
                prevEdge.set(to, edge);
                heap.push(to, candidate);
            }
        }
    }

    if (!keys.has(endId)) return null;

    const edges: GraphEdge[] = [];
    const nodeIds: string[] = [endId];
    let cursor = endId;
    while (cursor !== startId) {
        const edge = prevEdge.get(cursor);
        if (!edge) return null;
        edges.push(edge);
        cursor = String(edge.from);
        nodeIds.push(cursor);
    }
    edges.reverse();
    nodeIds.reverse();

    return {
        nodeIds,
        edges,
        totalCost: keys.get(endId)![penalties.length],
        totalDistanceMeters: edges.reduce((sum, e) => sum + e.distance, 0),
        totalRisk: edges.reduce((sum, e) => sum + e.distance * e.risk, 0),
    };
}

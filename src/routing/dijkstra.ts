import { edgeWeight } from "./edgeWeight";
import { GraphEdge, RoutingGraph } from "./types";
import { MinHeap } from "./priorityQueue";

export interface RouteResult {
    nodeIds: string[];
    edges: GraphEdge[];
    totalCost: number;
    totalDistanceMeters: number;
}

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

export function dijkstra(adjacency: Map<string, GraphEdge[]>, startId: string, endId: string): RouteResult | null {
    const dist = new Map<string, number>([[startId, 0]]);
    const prevEdge = new Map<string, GraphEdge>();
    const visited = new Set<string>();
    const heap = new MinHeap<string>();
    heap.push(startId, 0);

    while (heap.size > 0) {
        const current = heap.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        if (current === endId) break;

        const currentDist = dist.get(current)!;
        for (const edge of adjacency.get(current) ?? []) {
            const to = String(edge.to);
            if (visited.has(to)) continue;

            const candidate = currentDist + edgeWeight(edge);
            if (candidate < (dist.get(to) ?? Infinity)) {
                dist.set(to, candidate);
                prevEdge.set(to, edge);
                heap.push(to, candidate);
            }
        }
    }

    if (!dist.has(endId)) return null;

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
        totalCost: dist.get(endId)!,
        totalDistanceMeters: edges.reduce((sum, e) => sum + e.distance, 0),
    };
}

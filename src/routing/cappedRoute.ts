import { RouteResult, dijkstra } from "./dijkstra";
import { haversineMeters } from "./haversine";
import { MinHeap, keyLess } from "./priorityQueue";
import { GraphEdge, RoutingGraph } from "./types";

type Weight = (edge: GraphEdge) => number;

// past this the search gives up and the shortest route is used
const MAX_LABELS = 500_000;

interface Label {
    node: string;
    key: number[];
    length: number;
    edge: GraphEdge | null;
    previous: Label | null;
    dominated: boolean;
}

interface Search {
    // over incoming edges, so one-way roads still count only in their direction
    backward?: boolean;
    allowed?: (node: string, key: number[]) => boolean;
    target?: string;
    // A*: never more than the last key part from a node to the target
    estimate?: (node: string) => number;
}

// built once per cached graph
const reverseCache = new WeakMap<Map<string, GraphEdge[]>, Map<string, GraphEdge[]>>();

function reverseAdjacency(adjacency: Map<string, GraphEdge[]>): Map<string, GraphEdge[]> {
    let reverse = reverseCache.get(adjacency);
    if (reverse) return reverse;
    reverse = new Map<string, GraphEdge[]>();
    for (const edges of adjacency.values()) {
        for (const edge of edges) {
            const to = String(edge.to);
            const bucket = reverse.get(to);
            if (bucket) bucket.push(edge);
            else reverse.set(to, [edge]);
        }
    }
    reverseCache.set(adjacency, reverse);
    return reverse;
}

function keysFrom(adjacency: Map<string, GraphEdge[]>, sourceId: string, weights: Weight[], search: Search = {}): Map<string, number[]> {
    const { backward, allowed, target, estimate } = search;
    const last = weights.length - 1;
    const priority = (node: string, key: number[]) => {
        if (!estimate) return key;
        const withEstimate = [...key];
        withEstimate[last] += estimate(node);
        return withEstimate;
    };
    const keys = new Map<string, number[]>([[sourceId, new Array(weights.length).fill(0)]]);
    const done = new Set<string>();
    const heap = new MinHeap<string>();
    heap.push(sourceId, priority(sourceId, keys.get(sourceId)!));
    while (heap.size > 0) {
        const current = heap.pop()!;
        if (done.has(current)) continue;
        done.add(current);
        if (current === target) break;
        const currentKey = keys.get(current)!;
        for (const edge of adjacency.get(current) ?? []) {
            const next = String(backward ? edge.from : edge.to);
            if (done.has(next)) continue;
            const candidate = weights.map((weight, i) => currentKey[i] + weight(edge));
            if (allowed && !allowed(next, candidate)) continue;
            const known = keys.get(next);
            if (!known || keyLess(candidate, known)) {
                keys.set(next, candidate);
                heap.push(next, priority(next, candidate));
            }
        }
    }
    return keys;
}

// exact: A* over labels (key, length), a label is dropped when another at its node is no worse in both
function bestWithin(
    adjacency: Map<string, GraphEdge[]>,
    startId: string,
    endId: string,
    weights: Weight[],
    limit: number,
    fromStart: (node: string) => number,
): RouteResult | null {
    const reverse = reverseAdjacency(adjacency);
    const length: Weight[] = [(edge) => edge.distance];
    const lengthToEnd = keysFrom(reverse, endId, length, {
        backward: true,
        allowed: (node, [meters]) => meters + fromStart(node) <= limit,
    });
    // only nodes with from start + to end within the limit can be on the route
    const inside = keysFrom(adjacency, startId, length, {
        allowed: (node, [meters]) => meters + (lengthToEnd.get(node)?.[0] ?? Infinity) <= limit,
    });
    const keyToEnd = keysFrom(reverse, endId, weights, { backward: true, allowed: (node) => inside.has(node) });
    if (!keyToEnd.has(startId)) return null;

    const labels = new Map<string, Label[]>();
    const heap = new MinHeap<Label>();
    const start: Label = { node: startId, key: new Array(weights.length).fill(0), length: 0, edge: null, previous: null, dominated: false };
    heap.push(start, keyToEnd.get(startId)!);
    let popped = 0;
    while (heap.size > 0) {
        const label = heap.pop()!;
        if (label.dominated) continue;
        if (label.node === endId) return routeOf(label);
        if (++popped > MAX_LABELS) return null;

        for (const edge of adjacency.get(label.node) ?? []) {
            const to = String(edge.to);
            const length = label.length + edge.distance;
            const remaining = lengthToEnd.get(to);
            const bound = keyToEnd.get(to);
            if (remaining === undefined || bound === undefined || length + remaining[0] > limit) continue;

            const key = weights.map((weight, i) => label.key[i] + weight(edge));
            const others = labels.get(to) ?? [];
            if (others.some((other) => !keyLess(key, other.key) && other.length <= length)) continue;
            const kept = others.filter((other) => {
                other.dominated = !keyLess(other.key, key) && length <= other.length;
                return !other.dominated;
            });
            const next: Label = { node: to, key, length, edge, previous: label, dominated: false };
            kept.push(next);
            labels.set(to, kept);
            heap.push(next, key.map((value, i) => value + bound[i]));
        }
    }
    return null;
}

function routeOf(end: Label): RouteResult {
    const edges: GraphEdge[] = [];
    const nodeIds: string[] = [];
    for (let label: Label | null = end; label; label = label.previous) {
        nodeIds.push(label.node);
        if (label.edge) edges.push(label.edge);
    }
    edges.reverse();
    nodeIds.reverse();
    return {
        nodeIds,
        edges,
        totalCost: end.key[end.key.length - 1],
        totalDistanceMeters: edges.reduce((sum, e) => sum + e.distance, 0),
        totalRisk: edges.reduce((sum, e) => sum + e.distance * e.risk, 0),
    };
}

export function capDetour(
    graph: RoutingGraph,
    adjacency: Map<string, GraphEdge[]>,
    startId: string,
    endId: string,
    cost: Weight,
    penalties: Weight[],
    maxDetour: number,
    safest: RouteResult,
): RouteResult {
    // edges are straight lines between nodes, so a route is never shorter than this
    const straight = (from: string) => (node: string) => {
        const a = graph.nodes[from];
        const b = graph.nodes[node];
        return haversineMeters(a.lat, a.lon, b.lat, b.lon);
    };
    // the filters count too: within the limit they are kept as far as they fit
    const shortest = keysFrom(adjacency, startId, [(edge) => edge.distance], { target: endId, estimate: straight(endId) }).get(endId);
    if (!shortest) return safest;
    const limit = shortest[0] * (1 + maxDetour / 100);
    if (safest.totalDistanceMeters <= limit) return safest;
    return bestWithin(adjacency, startId, endId, [...penalties, cost], limit, straight(startId))
        ?? dijkstra(adjacency, startId, endId, (edge) => edge.distance)
        ?? safest;
}

import { SMALL_COMPONENT_SIZE } from "../config";
import { GraphEdge, RoutingGraph } from "../types";

// points only snap to big connected parts of the network (iterative Tarjan)
export function markSnappable(graph: RoutingGraph, adjacency: Map<string, GraphEdge[]>): void {
    const ids = Object.keys(graph.nodes);
    const position = new Map(ids.map((id, i) => [Number(id), i]));
    const next = ids.map((id) => (adjacency.get(id) ?? []).map((edge) => position.get(edge.to)!));
    const index = new Int32Array(ids.length).fill(-1);
    const low = new Int32Array(ids.length);
    const onStack = new Uint8Array(ids.length);
    const stack: number[] = [];
    // explicit stack, no recursion
    const frames: number[] = [];
    const edgePosition: number[] = [];
    let counter = 0;
    let largest: number[] = [];

    const visit = (node: number) => {
        index[node] = low[node] = counter++;
        stack.push(node);
        onStack[node] = 1;
        frames.push(node);
        edgePosition.push(0);
    };
    for (let root = 0; root < ids.length; root++) {
        if (index[root] !== -1) continue;
        visit(root);
        while (frames.length > 0) {
            const top = frames.length - 1;
            const node = frames[top];
            if (edgePosition[top] < next[node].length) {
                const to = next[node][edgePosition[top]++];
                if (index[to] === -1) visit(to);
                else if (onStack[to]) low[node] = Math.min(low[node], index[to]);
                continue;
            }
            frames.pop();
            edgePosition.pop();
            if (frames.length > 0) low[frames[top - 1]] = Math.min(low[frames[top - 1]], low[node]);
            if (low[node] !== index[node]) continue;
            // root of a component
            const component: number[] = [];
            let member: number;
            do {
                member = stack.pop()!;
                onStack[member] = 0;
                component.push(member);
            } while (member !== node);
            if (component.length >= SMALL_COMPONENT_SIZE) for (const m of component) graph.nodes[ids[m]].snappable = true;
            if (component.length > largest.length) largest = component;
        }
    }
    // a short leg may have no big component
    for (const m of largest) graph.nodes[ids[m]].snappable = true;
}

// brute force, fine for a few lookups
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

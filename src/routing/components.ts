import { SMALL_COMPONENT_SIZE } from "./config";
import { GraphEdge, RoutingGraph } from "./types";

/** Points may snap only to large connected parts of the network: a point next to a car park reached
 * only by a private road would otherwise snap onto an island with no way out. Iterative Tarjan. */
export function markSnappable(graph: RoutingGraph, adjacency: Map<string, GraphEdge[]>): void {
    const ids = Object.keys(graph.nodes);
    const position = new Map(ids.map((id, i) => [Number(id), i]));
    const next = ids.map((id) => (adjacency.get(id) ?? []).map((edge) => position.get(edge.to)!));
    const index = new Int32Array(ids.length).fill(-1);
    const low = new Int32Array(ids.length);
    const onStack = new Uint8Array(ids.length);
    const stack: number[] = [];
    // Explicit call stack: node and position of its next outgoing edge to visit
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
            // node is the root of a component: everything above it on the stack
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
    // A small graph (a short leg in the countryside) may have no big component at all
    for (const m of largest) graph.nodes[ids[m]].snappable = true;
}

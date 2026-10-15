import { GraphEdge, GraphNode, RoutingGraph } from "../../src/routing/types.js";

const BASE = { lat: 44.8, lon: 10.33 };
const METERS_PER_DEGREE = 111_195;

// a node x meters east and y meters north of a base point in Parma
export function nodeAt(x: number, y: number): GraphNode {
    return {
        lat: BASE.lat + y / METERS_PER_DEGREE,
        lon: BASE.lon + x / (METERS_PER_DEGREE * Math.cos((BASE.lat * Math.PI) / 180)),
    };
}

export function edge(from: number, to: number, distance: number, extra: Partial<GraphEdge> = {}): GraphEdge {
    return {
        id: `${from}-${to}`, from, to, distance, routeType: "local", risk: 1, grade: 0, lts: 1, bikeway: false,
        unpaved: false, ...extra,
    };
}

export function graphOf(nodes: Record<number, GraphNode>, edges: GraphEdge[]): RoutingGraph {
    return { bbox: { south: 0, west: 0, north: 0, east: 0 }, nodes, edges };
}

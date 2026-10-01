import { GraphEdge } from "./types";

export function edgeWeight(edge: GraphEdge): number {
    return edge.distance;
}

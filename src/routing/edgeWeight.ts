import { GraphEdge } from "./types";

// Phase 1: shortest by distance (parity with trackmate-router).
// Phase 3 adds the Safest policy (Teschke 2012 risk-weighted distance, see context/PlanNotes.md).
export function edgeWeight(edge: GraphEdge): number {
    return edge.distance;
}

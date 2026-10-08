import { GraphEdge } from "./types";

export type Policy = "safest" | "shortest";

/** Cost of an edge for Dijkstra:
 * Safest:   C(e) = len(e) · OR_type(e) · OR_hazard(e), risk-weighted distance (Teschke 2012)
 * Shortest: C(e) = len(e) */
export function edgeCost(policy: Policy): (edge: GraphEdge) => number {
    if (policy === "safest") return (edge) => edge.distance * edge.risk;
    return (edge) => edge.distance;
}

import { GraphEdge } from "./types";

export type Policy = "safest" | "shortest";

// safest: length times injury risk, shortest: length
export function edgeCost(policy: Policy): (edge: GraphEdge) => number {
    if (policy === "safest") return (edge) => edge.distance * edge.risk;
    return (edge) => edge.distance;
}

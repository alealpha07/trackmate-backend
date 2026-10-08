import { GraphEdge } from "./types";

export type Policy = "safest" | "shortest";

// safest: length times injury risk, shortest: length
export function edgeCost(policy: Policy): (edge: GraphEdge) => number {
    if (policy === "safest") return (edge) => edge.distance * edge.risk;
    return (edge) => edge.distance;
}

// more than any whole route costs
const CONNECTOR_WEIGHT = 1e9;

// cycleways only: other roads only where nothing else connects
export function preferBikeways(cost: (edge: GraphEdge) => number): (edge: GraphEdge) => number {
    return (edge) => (edge.bikeway ? cost(edge) : cost(edge) * (1 + CONNECTOR_WEIGHT));
}

import { GraphEdge } from "./types";

export type Policy = "safest" | "shortest";

/** Safest: length · relative injury risk (riskTable.ts). Shortest: length. */
export function edgeCost(policy: Policy): (edge: GraphEdge) => number {
    if (policy === "safest") return (edge) => edge.distance * edge.risk;
    return (edge) => edge.distance;
}

// More than the cost of any whole route, so a meter of connector outweighs any detour on bikeways
const CONNECTOR_WEIGHT = 1e9;

/** "Cycleways only": roads without bike infrastructure are used only where no bikeway connects, as
 * little as possible. When a route on bikeways alone exists, it is the one found. */
export function preferBikeways(cost: (edge: GraphEdge) => number): (edge: GraphEdge) => number {
    return (edge) => (edge.bikeway ? cost(edge) : cost(edge) * (1 + CONNECTOR_WEIGHT));
}

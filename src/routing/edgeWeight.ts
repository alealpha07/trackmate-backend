import { RouteFilters } from "./filters";
import { GraphEdge } from "./types";

export type Policy = "safest" | "shortest";

/** Safest: length · relative injury risk (riskTable.ts). Shortest: length. */
export function edgeCost(policy: Policy): (edge: GraphEdge) => number {
    if (policy === "safest") return (edge) => edge.distance * edge.risk;
    return (edge) => edge.distance;
}

// More than the cost of any whole route, so any high-stress road outweighs every road off cycleways
const HIGH_STRESS_WEIGHT = 1e8;

/** Soft filters: the roads they avoid are used only where nothing else connects, as little as possible.
 * When a route without them exists, it is the one found. High-stress roads are avoided first. */
export function edgePenalty(filters: RouteFilters, cost: (edge: GraphEdge) => number): ((edge: GraphEdge) => number) | null {
    const avoidLts4 = filters.avoidLts4 === true;
    const cyclewaysOnly = filters.cyclewaysOnly === true;
    if (!avoidLts4 && !cyclewaysOnly) return null;
    return (edge) => cost(edge) * ((avoidLts4 && edge.lts === 4 ? HIGH_STRESS_WEIGHT : 0) + (cyclewaysOnly && !edge.bikeway ? 1 : 0));
}

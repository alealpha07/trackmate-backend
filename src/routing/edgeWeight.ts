import { RouteFilters } from "./filters";
import { GraphEdge } from "./types";

export type Policy = "safest" | "shortest";

// safest: length times injury risk, shortest: length
export function edgeCost(policy: Policy): (edge: GraphEdge) => number {
    if (policy === "safest") return (edge) => edge.distance * edge.risk;
    return (edge) => edge.distance;
}

// more than any whole route costs
const HIGH_STRESS_WEIGHT = 1e8;

// soft filters, most important first: high stress, unpaved, off cycleways
export function edgePenalty(filters: RouteFilters, cost: (edge: GraphEdge) => number): ((edge: GraphEdge) => number) | null {
    const avoidLts4 = filters.avoidLts4 === true;
    const cyclewaysOnly = filters.cyclewaysOnly === true;
    if (!avoidLts4 && !cyclewaysOnly) return null;
    return (edge) => cost(edge) * ((avoidLts4 && edge.lts === 4 ? HIGH_STRESS_WEIGHT : 0) + (cyclewaysOnly && !edge.bikeway ? 1 : 0));
}

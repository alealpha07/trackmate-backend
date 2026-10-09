import { RouteFilters } from "./filters";
import { GraphEdge } from "./types";

export type Policy = "safest" | "shortest";

/** Safest: length · relative injury risk (riskTable.ts). Shortest: length. */
export function edgeCost(policy: Policy): (edge: GraphEdge) => number {
    if (policy === "safest") return (edge) => edge.distance * edge.risk;
    return (edge) => edge.distance;
}

/** Soft filters: the roads they avoid are used only where nothing else connects, as little as possible.
 * When a route without them exists, it is the one found. Each penalty is the cost on the roads it avoids,
 * most important first: high-stress roads, then unpaved roads, then roads off cycleways. So a gravel path is
 * taken before a fast road, and a paved street without a bike lane before an unpaved cycleway. */
export function edgePenalties(filters: RouteFilters, cost: (edge: GraphEdge) => number): ((edge: GraphEdge) => number)[] {
    const penalties: ((edge: GraphEdge) => number)[] = [];
    if (filters.avoidLts4) penalties.push((edge) => (edge.lts === 4 ? cost(edge) : 0));
    if (filters.avoidUnpaved) penalties.push((edge) => (edge.unpaved ? cost(edge) : 0));
    if (filters.cyclewaysOnly) penalties.push((edge) => (edge.bikeway ? 0 : cost(edge)));
    return penalties;
}

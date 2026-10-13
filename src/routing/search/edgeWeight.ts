import { GraphEdge, Policy, RouteFilters } from "../types";

// safest: length times injury risk, shortest: length
export function edgeCost(policy: Policy): (edge: GraphEdge) => number {
    if (policy === "safest") return (edge) => edge.distance * edge.risk;
    return (edge) => edge.distance;
}

// soft filters, most important first: high stress, unpaved, off cycleways
export function edgePenalties(filters: RouteFilters, cost: (edge: GraphEdge) => number): ((edge: GraphEdge) => number)[] {
    const penalties: ((edge: GraphEdge) => number)[] = [];
    if (filters.avoidLts4) penalties.push((edge) => (edge.lts === 4 ? cost(edge) : 0));
    if (filters.avoidUnpaved) penalties.push((edge) => (edge.unpaved ? cost(edge) : 0));
    if (filters.cyclewaysOnly) penalties.push((edge) => (edge.bikeway ? 0 : cost(edge)));
    return penalties;
}

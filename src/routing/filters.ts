import { FILTERS } from "./config";
import { GraphEdge } from "./types";

export type FilterName = (typeof FILTERS)[number];
export type RouteFilters = Partial<Record<FilterName, boolean>>;

/** An edge failing one is never used. "Cycleways only" and "Avoid high-stress roads" are penalties
 * instead (edgeWeight.ts), so gaps in the network they prefer don't leave trips without a route. */
const TESTS: Partial<Record<FilterName, (edge: GraphEdge) => boolean>> = {
    avoidUnpaved: (edge) => !edge.unpaved,
};

/** null when no hard filter is on. */
export function edgeFilter(filters: RouteFilters): ((edge: GraphEdge) => boolean) | null {
    const tests = FILTERS.filter((name) => filters[name] && TESTS[name]).map((name) => TESTS[name]!);
    if (tests.length === 0) return null;
    return (edge) => tests.every((test) => test(edge));
}

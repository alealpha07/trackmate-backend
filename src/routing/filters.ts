import { FILTERS } from "./config";
import { GraphEdge } from "./types";

export type FilterName = (typeof FILTERS)[number];
export type RouteFilters = Partial<Record<FilterName, boolean>>;

// all soft, so a trip always has a route
const TESTS: Partial<Record<FilterName, (edge: GraphEdge) => boolean>> = {
    avoidUnpaved: (edge) => !edge.unpaved,
};

export function edgeFilter(filters: RouteFilters): ((edge: GraphEdge) => boolean) | null {
    const tests = FILTERS.filter((name) => filters[name] && TESTS[name]).map((name) => TESTS[name]!);
    if (tests.length === 0) return null;
    return (edge) => tests.every((test) => test(edge));
}

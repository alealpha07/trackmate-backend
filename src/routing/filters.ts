import { FILTERS } from "./config";
import { GraphEdge } from "./types";

export type FilterName = (typeof FILTERS)[number];
export type RouteFilters = Partial<Record<FilterName, boolean>>;

/** Hard filters: an edge that fails one is not used at all, whatever the detour. */
const TESTS: Record<FilterName, (edge: GraphEdge) => boolean> = {
    cyclewaysOnly: (edge) => edge.bikeway,
    avoidUnpaved: (edge) => !edge.unpaved,
    avoidLts4: (edge) => edge.lts < 4,
};

/** Whether an edge may be used with these filters on, null when none is on. */
export function edgeFilter(filters: RouteFilters): ((edge: GraphEdge) => boolean) | null {
    const tests = FILTERS.filter((name) => filters[name]).map((name) => TESTS[name]);
    if (tests.length === 0) return null;
    return (edge) => tests.every((test) => test(edge));
}

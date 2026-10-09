import { FILTERS } from "./config";

export type FilterName = (typeof FILTERS)[number];
// all soft, so a trip always has a route
export type RouteFilters = Partial<Record<FilterName, boolean>>;

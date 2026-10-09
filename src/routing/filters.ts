import { FILTERS } from "./config";

export type FilterName = (typeof FILTERS)[number];
/** All soft: penalties (edgePenalties in edgeWeight.ts), so gaps in the roads they prefer never leave a trip
 * without a route. */
export type RouteFilters = Partial<Record<FilterName, boolean>>;

import { describe, expect, test } from "vitest";
import { capDetour } from "../../../src/routing/search/cappedRoute.js";
import { buildAdjacency, dijkstra } from "../../../src/routing/search/dijkstra.js";
import { edgeCost, edgePenalties } from "../../../src/routing/search/edgeWeight.js";
import { edge, graphOf, nodeAt } from "../../helpers/graph.js";

// 1 to 4, 55 m apart: direct 100 m risky, through 2 110 m unpaved, through 3 200 m and calm
const graph = graphOf(
    { 1: nodeAt(0, 0), 2: nodeAt(27, 20), 3: nodeAt(27, -90), 4: nodeAt(55, 0) },
    [
        edge(1, 4, 100, { risk: 1 }),
        edge(1, 2, 55, { risk: 0.5, unpaved: true }),
        edge(2, 4, 55, { risk: 0.5, unpaved: true }),
        edge(1, 3, 100, { risk: 0.1 }),
        edge(3, 4, 100, { risk: 0.1 }),
    ],
);
const adjacency = buildAdjacency(graph);
const cost = edgeCost("safest");
const safest = dijkstra(adjacency, "1", "4", cost)!;
const capped = (maxDetour: number, penalties = edgePenalties({}, cost)) =>
    capDetour(graph, adjacency, "1", "4", cost, penalties, maxDetour, dijkstra(adjacency, "1", "4", cost, penalties)!);

describe("capDetour", () => {
    test("the uncapped safest route is the long one", () => {
        expect(safest.nodeIds).toEqual(["1", "3", "4"]);
    });

    test("keeps the safest route when it fits", () => {
        expect(capped(100).nodeIds).toEqual(safest.nodeIds);
    });

    test("the safest route within the limit", () => {
        const route = capped(15);
        expect(route.nodeIds).toEqual(["1", "2", "4"]);
        expect(route.totalDistanceMeters).toBeLessThanOrEqual(115);
    });

    test("a tight limit leaves only the shortest route", () => {
        expect(capped(5).nodeIds).toEqual(["1", "4"]);
    });

    test("filters count within the limit", () => {
        expect(capped(15, edgePenalties({ avoidUnpaved: true }, cost)).nodeIds).toEqual(["1", "4"]);
    });
});

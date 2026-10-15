import { describe, expect, test } from "vitest";
import { buildAdjacency, dijkstra } from "../../../src/routing/search/dijkstra.js";
import { edgeCost, edgePenalties } from "../../../src/routing/search/edgeWeight.js";
import { RouteFilters } from "../../../src/routing/types.js";
import { edge, graphOf, nodeAt } from "../../helpers/graph.js";

// 1 to 4: direct and stressful, through 2 unpaved, through 3 long on a cycleway
const graph = graphOf(
    { 1: nodeAt(0, 0), 2: nodeAt(50, 40), 3: nodeAt(50, -80), 4: nodeAt(100, 0) },
    [
        edge(1, 4, 100, { risk: 1, lts: 4 }),
        edge(1, 2, 70, { risk: 0.5, lts: 2, unpaved: true }),
        edge(2, 4, 70, { risk: 0.5, lts: 2, unpaved: true }),
        edge(1, 3, 100, { risk: 0.2, bikeway: true }),
        edge(3, 4, 100, { risk: 0.2, bikeway: true }),
    ],
);
const adjacency = buildAdjacency(graph);

function shortestWith(filters: RouteFilters): string[] {
    const cost = edgeCost("shortest");
    return dijkstra(adjacency, "1", "4", cost, edgePenalties(filters, cost))!.nodeIds;
}

describe("edgeCost", () => {
    test("shortest is the length, safest the length times the risk", () => {
        const e = edge(1, 2, 100, { risk: 0.6 });
        expect(edgeCost("shortest")(e)).toBe(100);
        expect(edgeCost("safest")(e)).toBeCloseTo(60);
    });
});

describe("edgePenalties", () => {
    const cost = edgeCost("shortest");

    test("only the filters that are on, high stress first, then unpaved, then off cycleways", () => {
        expect(edgePenalties({}, cost)).toHaveLength(0);
        const penalties = edgePenalties({ cyclewaysOnly: true, avoidLts4: true, avoidUnpaved: true }, cost);
        expect(penalties.map((p) => p(edge(1, 2, 10, { lts: 4 })))).toEqual([10, 0, 10]);
        expect(penalties.map((p) => p(edge(1, 2, 10, { unpaved: true, bikeway: true })))).toEqual([0, 10, 0]);
    });
});

describe("dijkstra", () => {
    test("shortest takes the direct edge", () => {
        const route = dijkstra(adjacency, "1", "4", edgeCost("shortest"))!;
        expect(route.nodeIds).toEqual(["1", "4"]);
        expect(route.totalDistanceMeters).toBe(100);
        expect(route.totalRisk).toBe(100);
    });

    test("safest takes the calm detour", () => {
        const route = dijkstra(adjacency, "1", "4", edgeCost("safest"))!;
        expect(route.nodeIds).toEqual(["1", "3", "4"]);
        expect(route.totalCost).toBeCloseTo(40);
        expect(route.totalDistanceMeters).toBe(200);
    });

    test("filters are soft and apply in order", () => {
        expect(shortestWith({ avoidUnpaved: true })).toEqual(["1", "4"]);
        expect(shortestWith({ avoidLts4: true })).toEqual(["1", "2", "4"]);
        expect(shortestWith({ avoidLts4: true, avoidUnpaved: true })).toEqual(["1", "3", "4"]);
        expect(shortestWith({ cyclewaysOnly: true })).toEqual(["1", "3", "4"]);
    });

    test("edges are one-way", () => {
        expect(dijkstra(adjacency, "4", "1", edgeCost("shortest"))).toBeNull();
    });

    test("start and end on the same node", () => {
        const route = dijkstra(adjacency, "1", "1", edgeCost("shortest"))!;
        expect(route.nodeIds).toEqual(["1"]);
        expect(route.edges).toHaveLength(0);
    });
});

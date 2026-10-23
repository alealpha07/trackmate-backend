import { describe, expect, test } from "vitest";
import { buildGraph } from "../../../src/routing/graph/buildGraph.js";
import { markSnappable, nearestNode } from "../../../src/routing/graph/snap.js";
import { buildAdjacency } from "../../../src/routing/search/dijkstra.js";
import { HAZARD_OR, ROUTE_TYPE_OR } from "../../../src/routing/graph/riskTable.js";
import { OverpassElement, Tags } from "../../../src/routing/types.js";
import { nodeAt } from "../../helpers/graph.js";

const BBOX = { south: 44.79, west: 10.32, north: 44.81, east: 10.34 };

function node(id: number, x: number, y: number): OverpassElement {
    const { lat, lon } = nodeAt(x, y);
    return { type: "node", id, lat, lon };
}

function way(id: number, nodes: number[], tags: Tags): OverpassElement {
    return { type: "way", id, nodes, tags };
}

// nodes 100 m apart going east, 7 and 8 a separate piece
const NODES = [
    node(1, 0, 0), node(2, 100, 0), node(3, 200, 0), node(4, 300, 0), node(5, 400, 0), node(6, 500, 0),
    node(7, 0, 500), node(8, 100, 500), node(9, 100, 100),
];

const edgesOf = (elements: OverpassElement[]) => buildGraph([...NODES, ...elements], BBOX).edges;

describe("buildGraph", () => {
    test("a two-way street gives an edge each way per segment", () => {
        const edges = edgesOf([way(10, [1, 2, 3], { highway: "residential" })]);
        expect(edges.map((e) => e.id)).toEqual(["10:0:f", "10:0:b", "10:1:f", "10:1:b"]);
        expect(edges[0].distance).toBeCloseTo(100, 0);
        expect(edges[0].routeType).toBe("local");
        expect(edges[0].risk).toBe(ROUTE_TYPE_OR.local);
        expect(edges[1]).toMatchObject({ from: 2, to: 1 });
    });

    test("one-way for cars, unless bikes are exempt", () => {
        expect(edgesOf([way(11, [3, 4], { highway: "tertiary", oneway: "yes" })]).map((e) => e.id)).toEqual(["11:0:f"]);
        const contraflow = edgesOf([way(11, [3, 4], { highway: "tertiary", oneway: "yes", "oneway:bicycle": "no" })]);
        expect(contraflow).toHaveLength(2);
    });

    test("ways bikes can't use are left out", () => {
        expect(edgesOf([
            way(12, [4, 5], { highway: "footway" }),
            way(13, [5, 6], { highway: "residential", access: "private" }),
            way(14, [1, 9], { highway: "steps" }),
            way(15, [2, 9], { highway: "motorway" }),
            way(16, [3, 9], { highway: "residential", bicycle: "no" }),
            way(67, [4, 9], { highway: "primary", bicycle: "use_sidepath" }),
        ])).toHaveLength(0);
        expect(edgesOf([way(12, [4, 5], { highway: "footway", bicycle: "yes" })])).toHaveLength(2);
        expect(edgesOf([way(13, [5, 6], { highway: "residential", access: "no", bicycle: "yes" })])).toHaveLength(2);
    });

    test("hazards multiply the risk", () => {
        const [construction] = edgesOf([way(17, [1, 2], { highway: "residential", construction: "minor" })]);
        expect(construction.risk).toBeCloseTo(ROUTE_TYPE_OR.local * HAZARD_OR.construction);
        // a tram crossing at node 2, on the edge arriving there
        const crossing = edgesOf([
            way(18, [1, 2, 3], { highway: "residential" }),
            way(19, [9, 2], { railway: "tram" }),
        ]);
        const arriving = crossing.find((e) => e.id === "18:0:f")!;
        expect(crossing.find((e) => e.id === "18:1:f")!.risk).toBe(ROUTE_TYPE_OR.local);
        // the tracks weigh over the 5 m crossing site, not the whole 100 m edge
        const extra = arriving.distance * (arriving.risk - ROUTE_TYPE_OR.local);
        expect(extra).toBeCloseTo(5 * ROUTE_TYPE_OR.local * (HAZARD_OR.tracks - 1));
    });

    test("a crossing costs the same on short and long edges", () => {
        const extraCost = (stepMeters: number) => {
            const nodes = [node(60, 0, 0), node(61, stepMeters, 0), node(62, stepMeters, 100)];
            const [edge] = buildGraph([...nodes, way(63, [60, 61], { highway: "residential", oneway: "yes" }),
                way(64, [62, 61], { railway: "rail" })], BBOX).edges;
            return edge.distance * edge.risk - edge.distance * ROUTE_TYPE_OR.local;
        };
        expect(extraCost(3)).toBeCloseTo(3 * ROUTE_TYPE_OR.local * (HAZARD_OR.tracks - 1));
        expect(extraCost(40)).toBeCloseTo(extraCost(400));
    });

    test("a street that is a tram line too: crossing it counts, riding it counts once", () => {
        const edges = edgesOf([
            way(65, [9, 2], { highway: "residential" }),
            way(66, [1, 2, 3], { highway: "tertiary", railway: "tram" }),
        ]);
        expect(edges.find((e) => e.id === "65:0:f")!.risk).toBeGreaterThan(ROUTE_TYPE_OR.local);
        const along = edges.find((e) => e.id === "66:0:f")!;
        expect(along.risk).toBeCloseTo(ROUTE_TYPE_OR.major_parked * HAZARD_OR.tracks);
    });

    test("downhill only in the direction going down", () => {
        // 10% up going east
        const elevation = (_lat: number, lon: number) => (lon - 10.33) * 78_800 * 0.1;
        const edges = buildGraph([...NODES, way(20, [1, 2, 3, 4], { highway: "residential" })], BBOX, elevation).edges;
        const east = edges.find((e) => e.id === "20:1:f")!;
        const west = edges.find((e) => e.id === "20:1:b")!;
        expect(east.grade).toBeCloseTo(0.1, 2);
        expect(west.grade).toBeCloseTo(-0.1, 2);
        expect(east.risk).toBe(ROUTE_TYPE_OR.local);
        expect(west.risk).toBeCloseTo(ROUTE_TYPE_OR.local * HAZARD_OR.downhill);
    });

    test("descents gentler than 5% are not downhill", () => {
        // 4% up going east
        const elevation = (_lat: number, lon: number) => (lon - 10.33) * 78_800 * 0.04;
        const edges = buildGraph([...NODES, way(24, [1, 2, 3, 4], { highway: "residential" })], BBOX, elevation).edges;
        const west = edges.find((e) => e.id === "24:1:b")!;
        expect(west.grade).toBeCloseTo(-0.04, 2);
        expect(west.risk).toBe(ROUTE_TYPE_OR.local);
    });

    test("filter flags", () => {
        const [cycleway] = edgesOf([way(21, [1, 2], { highway: "cycleway" })]);
        expect(cycleway).toMatchObject({ bikeway: true, unpaved: false, lts: 1 });
        const [track] = edgesOf([way(22, [1, 2], { highway: "track" })]);
        expect(track).toMatchObject({ bikeway: false, unpaved: true });
        const [primary] = edgesOf([way(23, [1, 2], { highway: "primary", maxspeed: "70" })]);
        expect(primary.lts).toBe(4);
    });

    test("heights beyond the loaded area count as flat", () => {
        const elevation = (_lat: number, lon: number) => (lon < 10.331 ? 100 : NaN);
        const edges = buildGraph([...NODES, way(80, [1, 2, 3], { highway: "residential" })], BBOX, elevation).edges;
        expect(edges.every((e) => Number.isFinite(e.grade))).toBe(true);
    });

    test("only nodes on routable ways are kept", () => {
        const graph = buildGraph([...NODES, way(10, [1, 2], { highway: "residential" })], BBOX);
        expect(Object.keys(graph.nodes).sort()).toEqual(["1", "2"]);
    });
});

describe("snapping", () => {
    const graph = buildGraph([
        ...NODES,
        way(30, [1, 2, 3, 4, 5, 6], { highway: "residential" }),
        way(31, [7, 8], { highway: "residential" }),
    ], BBOX);
    markSnappable(graph, buildAdjacency(graph));

    test("only the biggest piece of a small graph is snappable", () => {
        expect(graph.nodes[1].snappable).toBe(true);
        expect(graph.nodes[7].snappable).toBeUndefined();
    });

    test("points snap to the snappable network even when another node is closer", () => {
        const nearSeven = nodeAt(0, 450);
        expect(nearestNode(graph, nearSeven.lat, nearSeven.lon)).toBe("1");
        const nearFour = nodeAt(310, 5);
        expect(nearestNode(graph, nearFour.lat, nearFour.lon)).toBe("4");
    });
});

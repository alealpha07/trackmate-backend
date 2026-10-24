import { RAILWAYS } from "../src/routing/config.js";
import { elevationExtent } from "../src/routing/data/bbox.js";
import { loadElevation } from "../src/routing/data/elevation.js";
import { loadTiles } from "../src/routing/data/tileCache.js";
import { buildGraph } from "../src/routing/graph/buildGraph.js";
import { markSnappable } from "../src/routing/graph/snap.js";
import { haversineMeters } from "../src/routing/haversine.js";
import { decodePolyline6 } from "../src/routing/instructions/polyline.js";
import { buildAdjacency } from "../src/routing/search/dijkstra.js";
import { BBox, GraphEdge, LatLng, OverpassWay, RoutingGraph } from "../src/routing/types.js";
import { MATCH_TOLERANCE_METERS } from "./config.js";

export interface Network {
    graph: RoutingGraph;
    adjacency: Map<string, GraphEdge[]>;
    edgeById: Map<string, GraphEdge>;
    ways: Map<number, OverpassWay>;
    railNodes: Set<number>;
}

const never = new AbortController().signal;

// same steps as planRoute, so the edges are the planner's own
export async function loadNetwork(box: BBox, onProgress?: (done: number, total: number) => void): Promise<Network> {
    const [tiles] = await loadTiles([box], never, onProgress);
    const elements = tiles.elements();
    const elevation = await loadElevation(elevationExtent(elements, box), never);
    const graph = buildGraph(elements, box, elevation);
    const adjacency = buildAdjacency(graph);
    markSnappable(graph, adjacency);

    const ways = new Map<number, OverpassWay>();
    const railNodes = new Set<number>();
    for (const el of elements) {
        if (el.type !== "way") continue;
        ways.set(el.id, el);
        if (RAILWAYS.includes(el.tags?.railway ?? "")) el.nodes.forEach((id) => railNodes.add(id));
    }
    return { graph, adjacency, edgeById: new Map(graph.edges.map((e) => [e.id, e])), ways, railNodes };
}

export const wayIdOf = (edge: GraphEdge) => Number(edge.id.split(":")[0]);

// the planner's track is a list of graph node coordinates
export function edgesFromTrack(network: Network, track: LatLng[], cost: (edge: GraphEdge) => number): GraphEdge[] {
    const { graph, adjacency } = network;
    const key = (lat: number, lon: number) => `${lat},${lon}`;
    const byCoord = new Map<string, string[]>();
    for (const id in graph.nodes) {
        const k = key(graph.nodes[id].lat, graph.nodes[id].lon);
        const ids = byCoord.get(k);
        if (ids) ids.push(id);
        else byCoord.set(k, [id]);
    }

    const edges: GraphEdge[] = [];
    let current = byCoord.get(key(track[0].lat, track[0].lng)) ?? [];
    for (let i = 1; i < track.length; i++) {
        const target = key(track[i].lat, track[i].lng);
        let best: GraphEdge | null = null;
        for (const id of current) {
            for (const edge of adjacency.get(id) ?? []) {
                const to = graph.nodes[edge.to];
                if (key(to.lat, to.lon) === target && (!best || cost(edge) < cost(best))) best = edge;
            }
        }
        if (!best) throw new Error(`track point ${i} has no edge from the previous one`);
        edges.push(best);
        current = [String(best.to)];
    }
    return edges;
}

export interface ValhallaEdge {
    way_id: number;
    length: number;
    begin_shape_index: number;
    end_shape_index: number;
}

export interface ValhallaMatch {
    edges: GraphEdge[];
    // meters of valhalla edges
    total: number;
    matched: number;
    // matched against the bike direction of our graph
    wrongWay: number;
}

function nearestWayIndex(network: Network, way: OverpassWay, point: LatLng): number {
    let best = -1;
    let bestDistance = MATCH_TOLERANCE_METERS;
    way.nodes.forEach((id, i) => {
        const node = network.graph.nodes[id];
        if (!node) return;
        const d = haversineMeters(node.lat, node.lon, point.lat, point.lng);
        if (d <= bestDistance) {
            best = i;
            bestDistance = d;
        }
    });
    return best;
}

// the segments of a way between two of its nodes, null if our graph lacks one
function waySegments(network: Network, way: OverpassWay, from: number, to: number): { edges: GraphEdge[]; wrongWay: number } | null {
    const forward = from < to;
    const edges: GraphEdge[] = [];
    let wrongWay = 0;
    for (let k = 0; k < Math.abs(to - from); k++) {
        const i = forward ? from + k : from - k - 1;
        const [own, other] = forward ? ["f", "b"] : ["b", "f"];
        const edge = network.edgeById.get(`${way.id}:${i}:${own}`);
        if (edge) {
            edges.push(edge);
            continue;
        }
        const reverse = network.edgeById.get(`${way.id}:${i}:${other}`);
        if (reverse) {
            edges.push(reverse);
            wrongWay += reverse.distance;
            continue;
        }
        // zero length segments have no edge
        const a = network.graph.nodes[way.nodes[i]];
        const b = network.graph.nodes[way.nodes[i + 1]];
        if (a && b && a.lat === b.lat && a.lon === b.lon) continue;
        return null;
    }
    return { edges, wrongWay };
}

// valhalla edges carry OSM way ids, each is walked on the same way in our graph
export function matchValhalla(network: Network, shapeEncoded: string, valhallaEdges: ValhallaEdge[]): ValhallaMatch {
    const shape = decodePolyline6(shapeEncoded);
    const match: ValhallaMatch = { edges: [], total: 0, matched: 0, wrongWay: 0 };
    for (const v of valhallaEdges) {
        const length = v.length * 1000;
        match.total += length;
        const way = network.ways.get(v.way_id);
        if (!way) continue;
        const from = nearestWayIndex(network, way, shape[v.begin_shape_index]);
        const to = nearestWayIndex(network, way, shape[v.end_shape_index]);
        if (from < 0 || to < 0 || from === to) continue;
        const segments = waySegments(network, way, from, to);
        if (!segments) continue;
        match.edges.push(...segments.edges);
        match.matched += length;
        match.wrongWay += segments.wrongWay;
    }
    return match;
}

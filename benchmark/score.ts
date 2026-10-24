import { DOWNHILL_GRADE, RAILWAYS } from "../src/routing/config.js";
import { hasConstruction, hasEmbeddedRails } from "../src/routing/graph/osmTags.js";
import { GraphEdge, RouteType } from "../src/routing/types.js";
import { GROUP_OF, GROUPS, GroupId, HAZARDS, HazardId } from "./config.js";
import { Network, wayIdOf } from "./graph.js";

export interface Score {
    // meters
    distance: number;
    // sum of meters times risk
    risk: number;
    bikeway: number;
    // meters at LTS 1 to 4
    lts: number[];
    types: Partial<Record<RouteType, number>>;
    groups: Record<GroupId, number>;
    // meters, crossings are counts
    hazards: Record<HazardId, number>;
}

export function emptyScore(): Score {
    return {
        distance: 0,
        risk: 0,
        bikeway: 0,
        lts: [0, 0, 0, 0],
        types: {},
        groups: Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<GroupId, number>,
        hazards: Object.fromEntries(HAZARDS.map((h) => [h, 0])) as Record<HazardId, number>,
    };
}

export function addScore(total: Score, part: Score): Score {
    total.distance += part.distance;
    total.risk += part.risk;
    total.bikeway += part.bikeway;
    part.lts.forEach((m, i) => (total.lts[i] += m));
    for (const [type, m] of Object.entries(part.types)) {
        total.types[type as RouteType] = (total.types[type as RouteType] ?? 0) + m;
    }
    for (const g of GROUPS) total.groups[g] += part.groups[g];
    for (const h of HAZARDS) total.hazards[h] += part.hazards[h];
    return total;
}

// weight < 1 counts an edge partly, for two-way segments of the whole network
export function scoreEdges(network: Network, edges: GraphEdge[], weight: (edge: GraphEdge) => number = () => 1): Score {
    const score = emptyScore();
    for (const edge of edges) {
        const w = weight(edge);
        const meters = edge.distance * w;
        const tags = network.ways.get(wayIdOf(edge))?.tags ?? {};
        score.distance += meters;
        score.risk += meters * edge.risk;
        if (edge.bikeway) score.bikeway += meters;
        score.lts[edge.lts - 1] += meters;
        score.types[edge.routeType] = (score.types[edge.routeType] ?? 0) + meters;
        score.groups[GROUP_OF[edge.routeType]] += meters;

        const h = score.hazards;
        if (hasEmbeddedRails(tags)) h.tram += meters;
        // same rule as the graph: the edge arriving at a rail node, unless the street is the rail line
        if (network.railNodes.has(edge.to) && !RAILWAYS.includes(tags.railway ?? "")) h.crossings += w;
        if (edge.grade < DOWNHILL_GRADE) h.downhill += meters;
        if (hasConstruction(tags)) h.construction += meters;
        if (edge.lts === 4) h.lts4 += meters;
        if (edge.routeType.startsWith("major_parked")) h.parked += meters;
        if (edge.unpaved) h.unpaved += meters;
    }
    return score;
}

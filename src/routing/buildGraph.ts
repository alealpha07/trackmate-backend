import { haversineMeters } from "./haversine";
import { BBox, EdgeTags, GraphEdge, OverpassElement, OverpassNode, OverpassWay, RoutingGraph } from "./types";

function pickTags(tags: Record<string, string> = {}): EdgeTags {
    return {
        highway: tags.highway,
        surface: tags.surface,
        smoothness: tags.smoothness,
        lit: tags.lit,
        bicycle: tags.bicycle,
        cycleway: tags.cycleway ?? tags["cycleway:both"] ?? tags["cycleway:right"] ?? tags["cycleway:left"],
        sac_scale: tags.sac_scale,
        oneway: tags.oneway,
        name: tags.name,
    };
}

/** Sidewalks alone would dwarf every other road type in a well-mapped city, so footway/pedestrian
 * ways are kept only when they're explicitly legal for bikes; steps are never routable. */
function isRoutable(tags: EdgeTags): boolean {
    const highway = tags.highway;
    if (!highway || highway === "steps") return false;
    if (tags.bicycle === "no" || tags.bicycle === "private") return false;
    if ((highway === "footway" || highway === "pedestrian") && !["yes", "designated", "permissive"].includes(tags.bicycle ?? "")) {
        return false;
    }
    return true;
}

/** Bikes are commonly exempt from a car oneway restriction: contraflow cycling, or the way
 * being a cycleway to begin with, both keep both directions usable. */
function isBicycleExemptFromOneway(tags: Record<string, string> = {}): boolean {
    return (
        tags["oneway:bicycle"] === "no" ||
        tags.cycleway === "opposite" ||
        tags["cycleway:left"] === "opposite" ||
        tags.highway === "cycleway"
    );
}

/** Directed routing graph built in memory from the Overpass elements of the request's BBOX. */
export function buildGraph(elements: OverpassElement[], bbox: BBox): RoutingGraph {
    const nodeById = new Map<number, OverpassNode>();
    const ways: OverpassWay[] = [];
    for (const el of elements) {
        if (el.type === "node") nodeById.set(el.id, el);
        else if (el.type === "way") ways.push(el);
    }

    const usedNodeIds = new Set<number>();
    const edges: GraphEdge[] = [];

    for (const way of ways) {
        const tags = pickTags(way.tags);
        if (!isRoutable(tags)) continue;

        const oneway = tags.oneway === "yes" || tags.oneway === "true" || tags.oneway === "1";
        const onewayReverse = tags.oneway === "-1";
        const bikeExempt = isBicycleExemptFromOneway(way.tags);

        for (let i = 0; i < way.nodes.length - 1; i++) {
            const a = nodeById.get(way.nodes[i]);
            const b = nodeById.get(way.nodes[i + 1]);
            if (!a || !b) continue;

            const distance = haversineMeters(a.lat, a.lon, b.lat, b.lon);
            if (distance <= 0) continue;

            usedNodeIds.add(a.id);
            usedNodeIds.add(b.id);

            if (!(onewayReverse && !bikeExempt)) {
                edges.push({ id: `${way.id}:${i}:f`, from: a.id, to: b.id, distance, tags });
            }
            if (!(oneway && !bikeExempt)) {
                edges.push({ id: `${way.id}:${i}:b`, from: b.id, to: a.id, distance, tags });
            }
        }
    }

    const nodes: RoutingGraph["nodes"] = {};
    for (const id of usedNodeIds) {
        const n = nodeById.get(id)!;
        nodes[id] = { lat: n.lat, lon: n.lon };
    }

    return { bbox, nodes, edges };
}

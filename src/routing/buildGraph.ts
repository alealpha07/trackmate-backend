import { haversineMeters } from "./haversine";
import { levelOfTrafficStress } from "./lts";
import {
    Direction, Tags, bicycleAllowed, bicycleDirection, bikeInfra, hasConstruction, hasParkedCars, isPaved,
} from "./osmTags";
import { HAZARD_OR, ROUTE_TYPE_OR, routeType } from "./riskTable";
import { BBox, GraphEdge, OverpassElement, OverpassNode, OverpassWay, RoutingGraph } from "./types";

/** Whether bikes may use the way at all. Sidewalks alone would dwarf every other road type in a
 * well-mapped city, so footway/pedestrian ways are kept only when they're explicitly legal for
 * bikes; steps are never routable. Motorways, trunk roads and motorroads are closed to bikes
 * unless signed otherwise (in Italy: CdS art. 175), and so are private roads. */
function isRoutable(tags: Tags): boolean {
    const highway = tags.highway;
    if (!highway || highway === "steps") return false;
    if (tags.bicycle === "no" || tags.bicycle === "private") return false;
    if ((highway === "footway" || highway === "pedestrian") && !bicycleAllowed(tags)) return false;
    const motorOnly = /^(motorway|trunk)(_link)?$/.test(highway) || tags.motorroad === "yes";
    if (motorOnly && !bicycleAllowed(tags)) return false;
    if (["no", "private"].includes(tags.access ?? "") && !bicycleAllowed(tags)) return false;
    return true;
}

/** Safety attributes of a way for a cyclist riding it in `direction`. */
function edgeProfile(tags: Tags, direction: Direction) {
    const infra = bikeInfra(tags, direction);
    const parked = hasParkedCars(tags, direction);
    const paved = isPaved(tags);
    const construction = hasConstruction(tags);
    const type = routeType(tags, infra, parked, paved);
    return {
        routeType: type,
        risk: ROUTE_TYPE_OR[type] * (construction ? HAZARD_OR.construction : 1),
        lts: levelOfTrafficStress(tags, direction, infra, parked),
        bikeway: type === "cycle_track" || type === "bike_path" || type === "local_bike_route"
            || infra === "lane" || tags.bicycle === "designated",
        unpaved: !paved,
        construction,
    };
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
        const tags = way.tags ?? {};
        if (!isRoutable(tags)) continue;

        const only = bicycleDirection(tags);
        const forward = only === "backward" ? null : edgeProfile(tags, "forward");
        const backward = only === "forward" ? null : edgeProfile(tags, "backward");

        for (let i = 0; i < way.nodes.length - 1; i++) {
            const a = nodeById.get(way.nodes[i]);
            const b = nodeById.get(way.nodes[i + 1]);
            if (!a || !b) continue;

            const distance = haversineMeters(a.lat, a.lon, b.lat, b.lon);
            if (distance <= 0) continue;

            usedNodeIds.add(a.id);
            usedNodeIds.add(b.id);

            if (forward) edges.push({ id: `${way.id}:${i}:f`, from: a.id, to: b.id, distance, ...forward });
            if (backward) edges.push({ id: `${way.id}:${i}:b`, from: b.id, to: a.id, distance, ...backward });
        }
    }

    const nodes: RoutingGraph["nodes"] = {};
    for (const id of usedNodeIds) {
        const n = nodeById.get(id)!;
        nodes[id] = { lat: n.lat, lon: n.lon };
    }

    return { bbox, nodes, edges };
}

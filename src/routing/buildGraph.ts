import { DOWNHILL_GRADE, GRADE_WINDOW_METERS, RAILWAYS } from "./config";
import { Elevation } from "./elevation";
import { haversineMeters } from "./haversine";
import { levelOfTrafficStress } from "./lts";
import {
    Direction, Tags, bicycleAllowed, bicycleDirection, bikeInfra, hasConstruction, hasEmbeddedRails, hasParkedCars, isPaved,
} from "./osmTags";
import { HAZARD_OR, ROUTE_TYPE_OR, routeType } from "./riskTable";
import { BBox, GraphEdge, OverpassElement, OverpassNode, OverpassWay, RoutingGraph } from "./types";

/** Footways only when bikes are explicitly allowed, never steps. Motorways, trunk roads and private
 * roads are closed to bikes unless signed otherwise. */
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

function edgeProfile(tags: Tags, direction: Direction) {
    const infra = bikeInfra(tags, direction);
    const parked = hasParkedCars(tags, direction);
    const paved = isPaved(tags);
    const type = routeType(tags, infra, parked, paved);
    return {
        routeType: type,
        risk: ROUTE_TYPE_OR[type]
            * (hasConstruction(tags) ? HAZARD_OR.construction : 1)
            * (hasEmbeddedRails(tags) ? HAZARD_OR.tracks : 1),
        lts: levelOfTrafficStress(tags, direction, infra, parked),
        bikeway: type === "cycle_track" || type === "bike_path" || type === "local_bike_route"
            || infra === "lane" || tags.bicycle === "designated",
        unpaved: !paved,
    };
}

/** Grade of each edge riding forward, measured over GRADE_WINDOW_METERS of the way around it. On
 * bridges and in tunnels the elevation data shows the river or the hill, so the way runs straight
 * between its ends. */
function wayGrades(points: OverpassNode[], tags: Tags, elevation: Elevation): number[] {
    const along = [0];
    for (let i = 1; i < points.length; i++) {
        along.push(along[i - 1] + haversineMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon));
    }
    const length = along[along.length - 1];
    if (length <= 0) return points.slice(1).map(() => 0);

    let heights = points.map((p) => elevation(p.lat, p.lon));
    const raised = (tags.bridge && tags.bridge !== "no") || (tags.tunnel && tags.tunnel !== "no");
    if (raised) {
        const [first, last] = [heights[0], heights[heights.length - 1]];
        heights = along.map((d) => first + ((last - first) * d) / length);
    }
    let segment = 0;
    const heightAt = (d: number) => {
        if (along[segment] > d) segment = 0;
        while (segment < along.length - 2 && along[segment + 1] < d) segment++;
        const span = along[segment + 1] - along[segment];
        const t = span > 0 ? (d - along[segment]) / span : 0;
        return heights[segment] + (heights[segment + 1] - heights[segment]) * Math.min(1, Math.max(0, t));
    };

    const window = Math.min(GRADE_WINDOW_METERS, length);
    return along.slice(1).map((end, i) => {
        const middle = (along[i] + end) / 2;
        const start = Math.min(Math.max(0, middle - window / 2), length - window);
        return (heightAt(start + window) - heightAt(start)) / window;
    });
}

/** Without `elevation`, every grade is 0. */
export function buildGraph(elements: OverpassElement[], bbox: BBox, elevation?: Elevation): RoutingGraph {
    const nodeById = new Map<number, OverpassNode>();
    const ways: OverpassWay[] = [];
    const railNodes = new Set<number>();
    for (const el of elements) {
        if (el.type === "node") nodeById.set(el.id, el);
        else if (el.tags?.highway) ways.push(el);
        else if (RAILWAYS.includes(el.tags?.railway ?? "")) el.nodes.forEach((id) => railNodes.add(id));
    }
    // A road node on a track is a crossing: its hazard goes on the edge arriving there, so each pass
    // counts once in either direction
    const crossing = (to: number) => (railNodes.has(to) ? HAZARD_OR.tracks : 1);

    const usedNodeIds = new Set<number>();
    const edges: GraphEdge[] = [];

    for (const way of ways) {
        const tags = way.tags ?? {};
        if (!isRoutable(tags)) continue;

        const only = bicycleDirection(tags);
        const forward = only === "backward" ? null : edgeProfile(tags, "forward");
        const backward = only === "forward" ? null : edgeProfile(tags, "backward");

        const points = way.nodes.map((id) => nodeById.get(id));
        const grades = elevation && points.every(Boolean)
            ? wayGrades(points as OverpassNode[], tags, elevation)
            : way.nodes.map(() => 0);
        const downhill = (grade: number) => (grade < DOWNHILL_GRADE ? HAZARD_OR.downhill : 1);

        for (let i = 0; i < way.nodes.length - 1; i++) {
            const a = nodeById.get(way.nodes[i]);
            const b = nodeById.get(way.nodes[i + 1]);
            if (!a || !b) continue;

            const distance = haversineMeters(a.lat, a.lon, b.lat, b.lon);
            if (distance <= 0) continue;

            usedNodeIds.add(a.id);
            usedNodeIds.add(b.id);

            const grade = grades[i];
            if (forward) {
                edges.push({
                    id: `${way.id}:${i}:f`, from: a.id, to: b.id, distance, ...forward, grade,
                    risk: forward.risk * crossing(b.id) * downhill(grade),
                });
            }
            if (backward) {
                edges.push({
                    id: `${way.id}:${i}:b`, from: b.id, to: a.id, distance, ...backward, grade: -grade,
                    risk: backward.risk * crossing(a.id) * downhill(-grade),
                });
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

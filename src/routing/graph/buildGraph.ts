import { nodeExtent } from "../data/bbox.js";
import { CROSSING_SITE_METERS, DOWNHILL_GRADE, GRADE_WINDOW_METERS, RAILWAYS } from "../config.js";
import { haversineMeters } from "../haversine.js";
import { levelOfTrafficStress } from "./lts.js";
import {
    bicycleAllowed, bicycleDirection, bikeInfra, drivingSide, drivingSideIn, hasConstruction,
    hasEmbeddedRails, hasParkedCars, isPaved, PATH_HIGHWAYS,
} from "./osmTags.js";
import { HAZARD_OR, ROUTE_TYPE_OR, routeType } from "./riskTable.js";
import { besideMajorRoad } from "./sidepath.js";
import {
    BBox, Direction, DrivingSide, Elevation, GraphEdge, OverpassElement, OverpassNode, OverpassWay, RoutingGraph, Tags,
} from "../types.js";

// footways only when bikes are allowed, never steps
function isRoutable(tags: Tags): boolean {
    const highway = tags.highway;
    if (!highway || highway === "steps") return false;
    // use_sidepath: German roads with a compulsory cycle path next to them (StVO 2(4))
    if (["no", "private", "use_sidepath"].includes(tags.bicycle ?? "")) return false;
    if ((highway === "footway" || highway === "pedestrian") && !bicycleAllowed(tags)) return false;
    const motorOnly = /^(motorway|trunk)(_link)?$/.test(highway) || tags.motorroad === "yes";
    if (motorOnly && !bicycleAllowed(tags)) return false;
    if (["no", "private"].includes(tags.access ?? "") && !bicycleAllowed(tags)) return false;
    return true;
}

function edgeProfile(tags: Tags, direction: Direction, driving: DrivingSide, besideMajor = false) {
    const infra = bikeInfra(tags, direction, driving);
    const parked = hasParkedCars(tags, direction, driving);
    const paved = isPaved(tags);
    const type = routeType(tags, infra, parked, paved, besideMajor);
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

// grade over GRADE_WINDOW_METERS, bridges and tunnels go straight between their ends
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
        const grade = (heightAt(start + window) - heightAt(start)) / window;
        // unknown height beyond the loaded area counts as flat
        return Number.isFinite(grade) ? grade : 0;
    });
}

export function buildGraph(elements: OverpassElement[], bbox: BBox, elevation?: Elevation): RoutingGraph {
    const nodeById = new Map<number, OverpassNode>();
    const ways: OverpassWay[] = [];
    const railNodes = new Set<number>();
    for (const el of elements) {
        if (el.type === "node") {
            nodeById.set(el.id, el);
            continue;
        }
        if (el.tags?.highway) ways.push(el);
        // a street can be a tram line too
        if (RAILWAYS.includes(el.tags?.railway ?? "")) el.nodes.forEach((id) => railNodes.add(id));
    }
    // railway crossing hazard goes on the edge arriving at the node, over the crossing site only
    const crossing = (to: number, distance: number) => (railNodes.has(to)
        ? 1 + ((HAZARD_OR.tracks - 1) * Math.min(CROSSING_SITE_METERS, distance)) / distance
        : 1);
    const besideMajor = besideMajorRoad(ways, nodeById);
    const graphSide = drivingSideIn(nodeExtent(elements, bbox));

    const usedNodeIds = new Set<number>();
    const edges: GraphEdge[] = [];

    for (const way of ways) {
        const tags = way.tags ?? {};
        if (!isRoutable(tags)) continue;

        const points = way.nodes.map((id) => nodeById.get(id));
        const first = points.find(Boolean);
        if (!first) continue;
        const driving = drivingSide(tags, graphSide, first.lat, first.lon);

        const only = bicycleDirection(tags);
        const forward = only === "backward" ? null : edgeProfile(tags, "forward", driving);
        const backward = only === "forward" ? null : edgeProfile(tags, "backward", driving);
        // the same path as a cycle track, used where it runs next to a major road
        const asSidepath = PATH_HIGHWAYS.includes(tags.highway)
            ? {
                forward: forward && edgeProfile(tags, "forward", driving, true),
                backward: backward && edgeProfile(tags, "backward", driving, true),
            }
            : null;
        const mayBeSidepath = asSidepath !== null
            && (asSidepath.forward ?? asSidepath.backward)!.routeType !== (forward ?? backward)!.routeType;
        // the street is the rail line itself, its own nodes aren't crossings
        const onRails = RAILWAYS.includes(tags.railway ?? "");
        const crossingOf = (to: number, distance: number) => (onRails ? 1 : crossing(to, distance));

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
            const sidepath = mayBeSidepath && besideMajor(a, b);
            const there = sidepath ? asSidepath!.forward : forward;
            const back = sidepath ? asSidepath!.backward : backward;
            if (there) {
                edges.push({
                    id: `${way.id}:${i}:f`, from: a.id, to: b.id, distance, ...there, grade,
                    risk: there.risk * crossingOf(b.id, distance) * downhill(grade),
                });
            }
            if (back) {
                edges.push({
                    id: `${way.id}:${i}:b`, from: b.id, to: a.id, distance, ...back, grade: -grade,
                    risk: back.risk * crossingOf(a.id, distance) * downhill(-grade),
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

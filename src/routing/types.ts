import { Lts } from "./lts";
import { RouteType } from "./riskTable";

export interface LatLng {
    lat: number;
    lng: number;
}

export interface BBox {
    south: number;
    west: number;
    north: number;
    east: number;
}

export interface OverpassNode {
    type: "node";
    id: number;
    lat: number;
    lon: number;
    tags?: Record<string, string>;
}

export interface OverpassWay {
    type: "way";
    id: number;
    nodes: number[];
    tags?: Record<string, string>;
}

export type OverpassElement = OverpassNode | OverpassWay;

export interface OverpassResponse {
    version: number;
    generator: string;
    elements: OverpassElement[];
}

export interface GraphEdge {
    id: string;
    /** OSM node id. */
    from: number;
    /** OSM node id. */
    to: number;
    /** Great-circle length of this edge, in meters. */
    distance: number;
    /** Teschke route type for a cyclist riding this way (side of the road, parked cars). */
    routeType: RouteType;
    /** Relative injury risk: OR of the route type times OR of the hazards (riskTable.ts). */
    risk: number;
    /** Level of Traffic Stress riding this way (lts.ts). */
    lts: Lts;
    /** Bike infrastructure: cycleway, cycle track, bike lane, bike street or bicycle=designated. */
    bikeway: boolean;
    unpaved: boolean;
}

export interface GraphNode {
    lat: number;
    lon: number;
    /** In a large strongly connected component: points may snap here (components.ts). */
    snappable?: boolean;
}

export interface RoutingGraph {
    bbox: BBox;
    nodes: Record<string, GraphNode>;
    edges: GraphEdge[];
}

/** One point of the existing track file format (see TrackPoint in the Kotlin app). */
export interface TrackPoint {
    lat: number;
    lng: number;
    timestamp: number;
    speed: number;
}

/** One part of a route, between two consecutive points (start, stops, destination). */
export interface RouteLeg {
    /** Meters. */
    distance: number;
    /** Seconds, estimated at the display cycling speed. */
    duration: number;
    /** Risk-weighted distance, Σ distance · risk (the Safest cost), in meters of a major street
     * with parked cars. risk / distance is the route's average relative injury risk. */
    risk: number;
}

export interface PlannedRoute extends RouteLeg {
    track: TrackPoint[];
    /** One per pair of consecutive points. Not part of the saved track file. */
    legs: RouteLeg[];
}

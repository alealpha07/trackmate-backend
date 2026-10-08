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
    // OSM node id
    from: number;
    // OSM node id
    to: number;
    // meters
    distance: number;
    routeType: RouteType;
    // road type times hazards
    risk: number;
    // traffic stress (lts.ts)
    lts: Lts;
    bikeway: boolean;
    unpaved: boolean;
    construction: boolean;
}

export interface GraphNode {
    lat: number;
    lon: number;
    snappable?: boolean;
}

export interface RoutingGraph {
    bbox: BBox;
    nodes: Record<string, GraphNode>;
    edges: GraphEdge[];
}

// same format as TrackPoint in the app
export interface TrackPoint {
    lat: number;
    lng: number;
    timestamp: number;
    speed: number;
}

export interface RouteLeg {
    // meters
    distance: number;
    // seconds
    duration: number;
    // sum of distance times risk (the safest cost)
    risk: number;
}

export interface PlannedRoute extends RouteLeg {
    track: TrackPoint[];
    // not saved in the track file
    legs: RouteLeg[];
}

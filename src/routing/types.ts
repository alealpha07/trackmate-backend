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
    // OSM node ids
    from: number;
    to: number;
    // meters
    distance: number;
    routeType: RouteType;
    // road type times hazards
    risk: number;
    // negative downhill
    grade: number;
    lts: Lts;
    bikeway: boolean;
    unpaved: boolean;
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

export interface RouteStats {
    // meters
    distance: number;
    // seconds
    duration: number;
    // sum of distance times risk (the safest cost)
    risk: number;
    // meters, only with cycleways only on
    offBikeways?: number;
    // meters at LTS 4
    highStress?: number;
    // meters unpaved
    unpaved?: number;
}

export interface RouteLeg extends RouteStats {
    from: LatLng;
    to: LatLng;
}

export interface PlannedRoute extends RouteStats {
    track: TrackPoint[];
    // not saved in the track file
    legs: RouteLeg[];
}

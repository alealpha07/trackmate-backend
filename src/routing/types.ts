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
    /** OSM node ids. */
    from: number;
    to: number;
    /** Meters. */
    distance: number;
    routeType: RouteType;
    /** Relative injury risk: road type times hazards (riskTable.ts). */
    risk: number;
    /** Rise over run riding this way, negative downhill. */
    grade: number;
    lts: Lts;
    /** Cycleway, cycle track, bike lane, bike street or bicycle=designated. */
    bikeway: boolean;
    unpaved: boolean;
}

export interface GraphNode {
    lat: number;
    lon: number;
    /** Points may snap here (components.ts). */
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

export interface RouteStats {
    /** Meters. */
    distance: number;
    /** Seconds. */
    duration: number;
    /** Risk-weighted distance, Σ distance · risk (the Safest cost), in meters of a major street
     * with parked cars. risk / distance is the route's average relative injury risk. */
    risk: number;
    /** Meters without bike infrastructure, only with "Cycleways only" on. */
    offBikeways?: number;
    /** Meters at LTS 4, only with "Avoid high-stress roads" on. */
    highStress?: number;
    /** Meters on unpaved roads, only with "Avoid unpaved" on. */
    unpaved?: number;
}

/** One part of a route, between two consecutive points (start, stops, destination). */
export interface RouteLeg extends RouteStats {
    /** The nodes the points snapped to. */
    from: LatLng;
    to: LatLng;
}

export interface PlannedRoute extends RouteStats {
    track: TrackPoint[];
    /** One per pair of consecutive points. Not part of the saved track file. */
    legs: RouteLeg[];
}

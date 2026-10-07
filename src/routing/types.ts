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

export interface EdgeTags {
    highway?: string;
    surface?: string;
    smoothness?: string;
    lit?: string;
    bicycle?: string;
    cycleway?: string;
    sac_scale?: string;
    oneway?: string;
    name?: string;
}

export interface GraphEdge {
    id: string;
    // OSM node id
    from: number;
    // OSM node id
    to: number;
    // meters
    distance: number;
    tags: EdgeTags;
}

export interface GraphNode {
    lat: number;
    lon: number;
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
}

export interface PlannedRoute extends RouteLeg {
    track: TrackPoint[];
    // not saved in the track file
    legs: RouteLeg[];
}

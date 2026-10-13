import { FILTERS, POLICIES } from "./config";

export type Policy = (typeof POLICIES)[number];

export type FilterName = (typeof FILTERS)[number];
// all soft, so a trip always has a route
export type RouteFilters = Partial<Record<FilterName, boolean>>;

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

export type Tags = Record<string, string>;

// forward = order of the way's nodes
export type Direction = "forward" | "backward";

// best first
export type BikeInfra = "track" | "lane" | "shared" | "none";

export type DrivingSide = "right" | "left";

// level of traffic stress, 1 to 4
export type Lts = 1 | 2 | 3 | 4;

// road types of the injury study the weights come from
export type RouteType =
    | "cycle_track"
    | "local_bike_route"
    | "local"
    | "major_lane"
    | "bike_path"
    | "major_shared"
    | "major"
    | "major_parked_lane"
    | "major_parked_shared"
    | "multiuse_unpaved"
    | "multiuse_paved"
    | "sidewalk"
    | "major_parked";

// meters, 0 at sea
export type Elevation = (lat: number, lon: number) => number;

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

export interface RouteResult {
    nodeIds: string[];
    edges: GraphEdge[];
    totalCost: number;
    totalDistanceMeters: number;
    totalRisk: number;
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

export interface Maneuver {
    type: number;
    text: string;
    streets: string[];
    along: number;
    length: number;
    time: number;
    verbalPre: string | null;
    verbalPost: string | null;
}

export interface SpeedLimit {
    from: number;
    to: number;
    kmh: number;
}

export interface TrackInstructions {
    maneuvers: Maneuver[];
    speedLimits: SpeedLimit[];
}

export interface Chunk {
    points: LatLng[];
    offset: number;
    keepFrom: number;
    keepTo: number;
}

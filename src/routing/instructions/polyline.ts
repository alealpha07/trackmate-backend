import { haversineMeters } from "../haversine";
import { LatLng } from "../types";

const MIN_SPACING_METERS = 10;
const MAX_SHAPE_POINTS = 16_000;
// farther apart, Valhalla breaks the trace there (its breakage distance is 2 km)
const MAX_GAP_METERS = 1_000;

function distance(a: LatLng, b: LatLng): number {
    return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

function thin(points: LatLng[], spacing: number): LatLng[] {
    const kept = [points[0]];
    for (const point of points.slice(1)) {
        if (distance(kept[kept.length - 1], point) >= spacing) kept.push(point);
    }
    const last = points[points.length - 1];
    if (kept.length > 1 && kept[kept.length - 1] !== last) kept[kept.length - 1] = last;
    else if (kept.length === 1 && points.length > 1) kept.push(last);
    return kept;
}

export function traceShape(points: LatLng[]): LatLng[] {
    let spacing = MIN_SPACING_METERS;
    let thinned = thin(points, spacing);
    while (thinned.length > MAX_SHAPE_POINTS) {
        spacing *= 2;
        thinned = thin(points, spacing);
    }

    const shape = [thinned[0]];
    for (const point of thinned.slice(1)) {
        const previous = shape[shape.length - 1];
        const steps = Math.ceil(distance(previous, point) / MAX_GAP_METERS);
        for (let i = 1; i < steps; i++) {
            shape.push({
                lat: previous.lat + ((point.lat - previous.lat) * i) / steps,
                lng: previous.lng + ((point.lng - previous.lng) * i) / steps,
            });
        }
        shape.push(point);
    }
    return shape;
}

export function encodePolyline6(points: LatLng[]): string {
    let encoded = "";
    let lastLat = 0;
    let lastLng = 0;
    const encodeValue = (value: number) => {
        let v = value < 0 ? ~(value << 1) : value << 1;
        while (v >= 0x20) {
            encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
            v >>= 5;
        }
        encoded += String.fromCharCode(v + 63);
    };
    for (const { lat, lng } of points) {
        const latE6 = Math.round(lat * 1e6);
        const lngE6 = Math.round(lng * 1e6);
        encodeValue(latE6 - lastLat);
        encodeValue(lngE6 - lastLng);
        lastLat = latE6;
        lastLng = lngE6;
    }
    return encoded;
}

export function decodePolyline6(encoded: string): LatLng[] {
    const points: LatLng[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const decodeValue = () => {
        let result = 0;
        let shift = 0;
        let byte;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (index < encoded.length) {
        lat += decodeValue();
        lng += decodeValue();
        points.push({ lat: lat / 1e6, lng: lng / 1e6 });
    }
    return points;
}

export function cumulativeMeters(points: LatLng[]): number[] {
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
    return cumulative;
}

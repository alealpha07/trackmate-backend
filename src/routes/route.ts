import express, { Request, Response } from "express";
import { sanitizeParams, isAuthenticated } from "../utils";
import { haversineMeters } from "../routing/haversine";
import { MAX_PLAN_DISTANCE_METERS, POLICIES, VEHICLES } from "../routing/config";
import { planRoute } from "../routing/plan";
import { LatLng } from "../routing/types";

const router = express.Router();

function parseLatLng(value: any): LatLng | null {
    const lat = Number(value?.lat);
    const lng = Number(value?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

// Plan a route between two points
router.post("/plan", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["start", "end", "vehicle", "policy"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const start = parseLatLng(sanitizedParams.start);
        const end = parseLatLng(sanitizedParams.end);
        if (!start || !end) {
            return response.status(422).send(response.__("route.errors.coordinates"));
        }
        if (!VEHICLES.includes(sanitizedParams.vehicle)) {
            return response.status(422).send(response.__("route.errors.vehicle"));
        }
        if (!POLICIES.includes(sanitizedParams.policy)) {
            return response.status(422).send(response.__("route.errors.policy"));
        }
        if (haversineMeters(start.lat, start.lng, end.lat, end.lng) > MAX_PLAN_DISTANCE_METERS) {
            return response.status(422).send(response.__("route.errors.too-far", String(MAX_PLAN_DISTANCE_METERS / 1000)));
        }

        let route;
        try {
            route = await planRoute(start, end);
        } catch (error) {
            console.error(error);
            return response.status(502).send(response.__("route.errors.map-data"));
        }
        if (!route) {
            return response.status(422).send(response.__("route.errors.no-route"));
        }

        response.json(route);
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

export default router;

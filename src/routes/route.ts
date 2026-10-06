import express, { Request, Response } from "express";
import { User } from "@prisma/client";
import { sanitizeParams, isAuthenticated } from "../utils";
import { haversineMeters } from "../routing/haversine";
import { MAX_PLAN_DISTANCE_METERS, POLICIES, VEHICLES } from "../routing/config";
import { planRoute } from "../routing/plan";
import { geocode, isGeocodingConfigured, takeGeocodeQuota } from "../routing/geocode";
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

        // The page aborts its previous request when the user re-plans: stop waiting for its map data
        const controller = new AbortController();
        response.on("close", () => {
            if (!response.writableFinished) controller.abort();
        });

        let route;
        try {
            route = await planRoute(start, end, controller.signal);
        } catch (error) {
            if ((error as Error).name === "AbortError") return;
            console.error(`Route planning failed: ${(error as Error).message}`);
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

// Search places for the start/destination fields
router.get("/geocode", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["text"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.query);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }
        if (!isGeocodingConfigured()) {
            return response.status(503).send(response.__("route.errors.geocoding-disabled"));
        }
        if (!takeGeocodeQuota((request.user as User).id)) {
            return response.status(429).send(response.__("route.errors.geocoding-limit"));
        }

        const focus = parseLatLng(request.query) ?? undefined;
        try {
            const full = request.query.full === "1";
            response.json(await geocode(String(sanitizedParams.text), response.getLocale(), focus, full));
        } catch (error) {
            console.error(error);
            response.status(502).send(response.__("route.errors.geocoding"));
        }
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

export default router;

import express, { Request, Response } from "express";
import { User } from "@prisma/client";
import { sanitizeParams, isAuthenticated } from "../utils";
import { haversineMeters } from "../routing/haversine";
import { MAX_PLAN_DISTANCE_METERS, POLICIES, VEHICLES } from "../routing/config";
import { planRoute } from "../routing/plan";
import { PartialDownloadError } from "../routing/tileCache";
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

/** Name of point `index` of `count` in server messages: start, stop N, destination. */
function pointName(response: Response, index: number, count: number): string {
    if (index === 0) return response.__("route.points.start");
    if (index === count - 1) return response.__("route.points.end");
    return response.__("route.points.stop", String(index));
}

/** "start → stop 1" */
function legName(response: Response, leg: number, count: number): string {
    return `${pointName(response, leg, count)} → ${pointName(response, leg + 1, count)}`;
}

// Plan a route from start to end, through the optional stops in `via` (in order).
// With ?stream=1 the answer is NDJSON: {"progress":{"done","total"}} lines while map data
// downloads (keeps proxies from timing out), then {"route":…} or {"error","status"}.
router.post("/plan", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    const stream = request.query.stream === "1";
    const fail = (status: number, message: string) => {
        if (!response.headersSent) return response.status(status).send(message);
        response.end(JSON.stringify({ error: message, status }) + "\n");
    };
    try {
        const requiredParams = ["start", "end", "vehicle", "policy"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const via = request.body.via ?? [];
        if (!Array.isArray(via)) {
            return response.status(422).send(response.__("route.errors.coordinates"));
        }
        const points = [sanitizedParams.start, ...via, sanitizedParams.end].map(parseLatLng);
        if (points.some((point) => !point)) {
            return response.status(422).send(response.__("route.errors.coordinates"));
        }
        const route = points as LatLng[];
        if (!VEHICLES.includes(sanitizedParams.vehicle)) {
            return response.status(422).send(response.__("route.errors.vehicle"));
        }
        if (!POLICIES.includes(sanitizedParams.policy)) {
            return response.status(422).send(response.__("route.errors.policy"));
        }
        // The cap is per leg (each leg has its own BBOX), there is no total
        for (let i = 0; i < route.length - 1; i++) {
            const meters = haversineMeters(route[i].lat, route[i].lng, route[i + 1].lat, route[i + 1].lng);
            if (meters > MAX_PLAN_DISTANCE_METERS) {
                return response.status(422).send(response.__(
                    "route.errors.leg-too-far",
                    legName(response, i, route.length),
                    (meters / 1000).toFixed(1),
                    String(MAX_PLAN_DISTANCE_METERS / 1000),
                ));
            }
        }

        // The page aborts its previous request when the user re-plans: stop waiting for its map data
        const controller = new AbortController();
        const abort = () => {
            if (!response.writableFinished) controller.abort();
        };
        response.on("close", abort);
        // A client hanging up shows first as the socket's "end", a loop turn before "close"
        const socket = request.socket;
        socket.once("end", abort);
        response.on("close", () => socket.off("end", abort));

        let onProgress: ((done: number, total: number) => void) | undefined;
        if (stream) {
            response.status(200).type("application/x-ndjson");
            response.setHeader("Cache-Control", "no-cache");
            response.setHeader("X-Accel-Buffering", "no"); // nginx: don't buffer the progress lines
            response.flushHeaders();
            onProgress = (done, total) => response.write(JSON.stringify({ progress: { done, total } }) + "\n");
        }

        let planned;
        try {
            planned = await planRoute(route, controller.signal, onProgress);
        } catch (error) {
            if ((error as Error).name === "AbortError") return;
            console.error(`Route planning failed: ${(error as Error).message}`);
            if (error instanceof PartialDownloadError && error.downloaded > 0) {
                return fail(502, response.__("route.errors.map-data-partial", String(error.downloaded), String(error.total)));
            }
            return fail(502, response.__("route.errors.map-data"));
        }
        if ("unreachableLeg" in planned) {
            return fail(422, response.__("route.errors.no-route-leg", legName(response, planned.unreachableLeg, route.length)));
        }

        if (stream) response.end(JSON.stringify({ route: planned }) + "\n");
        else response.json(planned);
    } catch (error) {
        fail(500, response.__("server.error"));
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

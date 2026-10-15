import { Request, Response } from "express";
import { User } from "@prisma/client";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const userOrIp = (request: Request) =>
    request.user ? `user-${(request.user as User).id}` : ipKeyGenerator(request.ip ?? "");

interface LimitOptions {
    message?: string;
    keyGenerator?: (request: Request) => string;
    failuresOnly?: boolean;
}

const limiter = (windowMs: number, limit: number, options: LimitOptions = {}) => rateLimit({
    windowMs,
    limit,
    keyGenerator: options.keyGenerator ?? userOrIp,
    skipSuccessfulRequests: options.failuresOnly ?? false,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (request: Request, response: Response) =>
        response.status(429).send(response.__(options.message ?? "server.too-many-requests")),
});

export const apiLimit = limiter(MINUTE_MS, 300);
// by username on login, by user when logged in
export const passwordLimit = limiter(15 * MINUTE_MS, 10, {
    message: "auth.errors.too-many-attempts",
    keyGenerator: (request) =>
        request.user ? userOrIp(request) : `${ipKeyGenerator(request.ip ?? "")}|${String(request.body?.username ?? "")}`,
    failuresOnly: true,
});
export const registerLimit = limiter(HOUR_MS, 5);
export const fileLimit = limiter(HOUR_MS, 30);
export const searchLimit = limiter(MINUTE_MS, 30);
// Stadia credits
export const geocodeLimit = limiter(MINUTE_MS, 30, { message: "route.errors.geocoding-limit" });
export const instructionsLimit = limiter(MINUTE_MS, 10);
export const planLimit = limiter(10 * MINUTE_MS, 20, { message: "route.errors.plan-limit" });

// planning is CPU and memory heavy, so few run at once
const planning = new Set<number>();

export function takePlanSlot(userId: number): "ok" | "running" | "busy" {
    if (planning.has(userId)) return "running";
    if (planning.size >= (Number(process.env.PLAN_MAX_CONCURRENT) || 2)) return "busy";
    planning.add(userId);
    return "ok";
}

export function releasePlanSlot(userId: number) {
    planning.delete(userId);
}

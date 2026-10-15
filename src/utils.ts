import path from "path"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client.js";
import { Request, Response, NextFunction } from "express";
import { databaseUrl } from "./databaseUrl.js";

export const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl() }) });

export function sanitizeParams(requiredParams: Array<string>, requestParams: any = {}) {
    const sanitizedParams:any = {};
    const missingParams:Array<string> = [];
    
    requiredParams.forEach((param: string) => {
        if (requestParams[param] === undefined || requestParams[param] === "" || requestParams[param] === null) {
            missingParams.push(param);
        } else {
            sanitizedParams[param] = requestParams[param];
        }
    });
    
    return { sanitizedParams, missingParams };
}

export const UPLOAD_DIR = path.join(import.meta.dirname, "..", "uploads");
export const UPLOAD_FILE_DIR = "uploads/";

export function isAuthenticated(request: Request, response: Response, next: NextFunction): void{
    if (!request.isAuthenticated()) {
        response.status(401).send(response.__("auth.errors.unauthorized"));
    }
    else{
        next();
    }
}

// ids also end up in file paths, so digits only
export function parseId(value: unknown): number | null {
    const text = typeof value === "number" ? String(value) : value;
    if (typeof text !== "string" || !/^[1-9]\d{0,9}$/.test(text)) return null;
    const id = Number(text);
    return id <= 2_147_483_647 ? id : null;
}

export function sendInvalidId(response: Response) {
    return response.status(422).send(response.__("server.invalid-id"));
}

export const PUBLIC_USER = { id: true, username: true, bio: true, level: true, experience: true } as const;

export async function canSeeRoute(userId: number, trackId: number): Promise<boolean> {
    const visible = await prisma.track.count({
        where: {
            id: trackId,
            OR: [{ userId }, { posts: { some: {} } }, { travels: { some: { userId } } }],
        },
    });
    return visible > 0;
}

export async function deleteUserSessions(userId: number, keepSid?: string) {
    const sessions = await prisma.session.findMany({ select: { sid: true, data: true } });
    const sids = sessions
        .filter((session) => session.sid !== keepSid && sessionUserId(session.data) === userId)
        .map((session) => session.sid);
    await prisma.session.deleteMany({ where: { sid: { in: sids } } });
}

function sessionUserId(data: string): number | undefined {
    try {
        return JSON.parse(data)?.passport?.user;
    } catch {
        return undefined;
    }
}

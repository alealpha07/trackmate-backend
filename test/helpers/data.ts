import fs from "fs";
import path from "path";
import sharp from "sharp";
import { Vehicle } from "../../src/generated/prisma/client.js";
import { prisma } from "../../src/utils.js";

const LOCALES_DIR = path.join(import.meta.dirname, "..", "..", "locales");
const locales = new Map<string, any>();

// a server text as i18n renders it, %s filled in order
export function text(language: string, key: string, ...args: string[]): string {
    if (!locales.has(language)) locales.set(language, JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8")));
    const value = key.split(".").reduce((node, part) => node?.[part], locales.get(language));
    if (typeof value !== "string") throw new Error(`No text ${language} ${key}`);
    return args.reduce((result: string, arg) => result.replace("%s", arg), value);
}

// collects a binary body, supertest only buffers text
export function binary(response: any, callback: (error: Error | null, body: Buffer) => void) {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => callback(null, Buffer.concat(chunks)));
}

export function image(format: "jpeg" | "png" = "jpeg", size = 64): Promise<Buffer> {
    return sharp({ create: { width: size, height: size, channels: 3, background: { r: 0, g: 128, b: 128 } } })
        .toFormat(format)
        .toBuffer();
}

// the file the app and the planner upload
export function trackJson(points = [{ lat: 44.7815, lng: 9.846 }, { lat: 44.7815, lng: 9.851 }, { lat: 44.7815, lng: 9.856 }]): Buffer {
    return Buffer.from(JSON.stringify({ track: points.map((point, i) => ({ ...point, timestamp: i * 1000, speed: 5 })) }));
}

export function createTrack(userId: number, vehicle: Vehicle = Vehicle.BICYCLE, name = "Morning ride") {
    return prisma.track.create({ data: { userId, name, vehicle } });
}

export function createPost(trackId: number, title = "Hills", description = "Nice climbs") {
    return prisma.post.create({ data: { trackId, title, description } });
}

export function createTravel(userId: number, trackId: number | null, time = 600, vehicle: Vehicle = Vehicle.BICYCLE) {
    return prisma.travel.create({
        data: { userId, trackId, time, vehicle, dateTime: new Date(), maxSpeed: 30, averageSpeed: 20, distance: 3.5 },
    });
}

export function befriend(senderId: number, receiverId: number, status = true) {
    return prisma.friendRequest.create({ data: { senderId, receiverId, status } });
}

export function listFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)));
}

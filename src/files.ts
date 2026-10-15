import fs from "fs";
import path from "path";
import { prisma, UPLOAD_DIR } from "./utils.js";
import { INSTRUCTIONS_CACHE_DIR } from "./routing/config.js";

const PROFILE_DIR = path.join(UPLOAD_DIR, "profile");
const POSTS_DIR = path.join(UPLOAD_DIR, "posts");
const TRACK_DIR = path.join(UPLOAD_DIR, "track");
const TRAVEL_DIR = path.join(UPLOAD_DIR, "travel");

export const profileImageFile = (userId: number) => path.join(PROFILE_DIR, `${userId}.jpg`);
export const postImageFile = (postId: number, index: number) => path.join(POSTS_DIR, `${postId}-${index}.jpg`);
export const trackFile = (trackId: number) => path.join(TRACK_DIR, `${trackId}.json`);
export const travelFile = (travelId: number) => path.join(TRAVEL_DIR, `${travelId}.json`);

function listFiles(dir: string): string[] {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}

export function removeFiles(files: string[]) {
    for (const file of files) fs.rmSync(file, { force: true });
}

export function postImageFiles(postId: number): string[] {
    const name = new RegExp(`^${postId}-\\d+\\.jpg$`);
    return listFiles(POSTS_DIR).filter((file) => name.test(file)).map((file) => path.join(POSTS_DIR, file));
}

// cache names start with the track id, see instructions/index.ts
function instructionFiles(trackId: number): string[] {
    const prefix = `${trackId}-`;
    return listFiles(INSTRUCTIONS_CACHE_DIR)
        .filter((file) => file.startsWith(prefix))
        .map((file) => path.join(INSTRUCTIONS_CACHE_DIR, file));
}

export function removeTrackFiles(trackId: number, postIds: number[]) {
    removeFiles([trackFile(trackId), ...instructionFiles(trackId), ...postIds.flatMap(postImageFiles)]);
}

// leftovers of deletes from before files were removed with their rows
export async function removeOrphanFiles(): Promise<number> {
    const ids = async (rows: Promise<{ id: number }[]>) => new Set((await rows).map((row) => row.id));
    const users = await ids(prisma.user.findMany({ select: { id: true } }));
    const posts = await ids(prisma.post.findMany({ select: { id: true } }));
    const tracks = await ids(prisma.track.findMany({ select: { id: true } }));
    const travels = await ids(prisma.travel.findMany({ select: { id: true } }));

    const orphans = (dir: string, pattern: RegExp, existing: Set<number>) => listFiles(dir)
        .filter((file) => {
            const match = pattern.exec(file);
            return match !== null && !existing.has(Number(match[1]));
        })
        .map((file) => path.join(dir, file));

    const files = [
        ...orphans(PROFILE_DIR, /^(\d+)\.jpg$/, users),
        ...orphans(POSTS_DIR, /^(\d+)-\d+\.jpg$/, posts),
        ...orphans(TRACK_DIR, /^(\d+)\.json$/, tracks),
        ...orphans(TRAVEL_DIR, /^(\d+)\.json$/, travels),
        ...orphans(INSTRUCTIONS_CACHE_DIR, /^(\d+)-/, tracks),
    ];
    removeFiles(files);
    return files.length;
}

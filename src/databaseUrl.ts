import path from "path";

const PRISMA_DIR = path.join(import.meta.dirname, "..", "prisma");

// relative paths stay relative to prisma/, as before Prisma 7
export function databaseUrl(): string {
    const url = process.env.DATABASE_URL || "file:./data/dev.db";
    if (!url.startsWith("file:")) return url;
    const file = url.slice("file:".length);
    return `file:${path.isAbsolute(file) ? file : path.join(PRISMA_DIR, file)}`;
}

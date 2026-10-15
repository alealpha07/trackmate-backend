import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
    export interface ProvidedContext {
        testRoot: string;
    }
}

const BACKEND_DIR = path.join(import.meta.dirname, "..", "..");

// one migrated database, copied by every test file
export default function setup(project: TestProject) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "trackmate-test-"));
    execFileSync(path.join(BACKEND_DIR, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        cwd: BACKEND_DIR,
        env: { ...process.env, DATABASE_URL: `file:${path.join(root, "template.db")}` },
        stdio: "pipe",
    });
    project.provide("testRoot", root);
    return () => fs.rmSync(root, { recursive: true, force: true });
}

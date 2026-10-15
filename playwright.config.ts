import os from "os";
import path from "path";
import { defineConfig, devices } from "@playwright/test";

// a scratch port, never the dev server's 3000
const PORT = Number(process.env.E2E_PORT) || 3917;

export default defineConfig({
    testDir: "test/e2e",
    testMatch: "*.spec.ts",
    // one plan per user at a time, so no parallel runs
    workers: 1,
    reporter: "list",
    outputDir: path.join(os.tmpdir(), "trackmate-e2e-results"),
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        locale: "en-US",
        colorScheme: "light",
        trace: "retain-on-failure",
    },
    projects: [
        { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: "phone.spec.ts" },
        { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: "phone.spec.ts" },
    ],
    webServer: {
        command: "npx tsx test/e2e/server.ts",
        url: `http://127.0.0.1:${PORT}/privacy`,
        reuseExistingServer: false,
        env: { E2E_PORT: String(PORT) },
        // lets the server remove its temp dir
        gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
});

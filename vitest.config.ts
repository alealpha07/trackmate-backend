import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        pool: "forks",
        globalSetup: ["test/setup/globalSetup.ts"],
        setupFiles: ["test/setup/env.ts"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/generated/**"],
        },
    },
});

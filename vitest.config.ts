import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        pool: "forks",
        // logins hash with bcrypt cost 12, a few hundred ms each
        testTimeout: 20_000,
        hookTimeout: 30_000,
        globalSetup: ["test/setup/globalSetup.ts"],
        setupFiles: ["test/setup/env.ts"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/generated/**"],
        },
    },
});

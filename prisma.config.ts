import "dotenv/config";
import { defineConfig } from "prisma/config";
import { databaseUrl } from "./src/databaseUrl.ts";

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
        seed: "tsx prisma/seed.ts",
    },
    datasource: {
        url: databaseUrl(),
    },
});

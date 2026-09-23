import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Tables only — relations.ts is deliberately excluded; drizzle-kit reads
  // table definitions, and including it would pull the barrel in twice.
  schema: "./src/drizzle/schemas/*.ts",
  out: "./src/drizzle/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Optional but recommended while the schema is still moving: shows the
  // exact statements before they run.
  verbose: true,
  strict: true,
});

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig uses jsx:"preserve" (Next compiles it); tests transform JSX themselves.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../src"),
      // `server-only` throws outside a React Server build; tests import
      // server modules directly (DB-backed ones are gated on TEST_DATABASE_URL).
      "server-only": path.resolve(__dirname, "stubs/server-only.ts"),
    },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});

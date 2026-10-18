import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig uses jsx:"preserve" (Next compiles it); tests transform JSX themselves.
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});

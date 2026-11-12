import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // In-memory Postgres (PGlite) and large jsdom renders pass in 1–8 s alone but
    // can exceed the 5 s default when the full suite saturates the machine.
    testTimeout: 20_000,
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
    ],
    coverage: {
      include: ["lib/transforms/**/*.ts"],
      reporter: ["text", "html"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});

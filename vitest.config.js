import { defineConfig } from "vitest/config";

// Unit tests run in Node against the dependency-free src modules (parse/runs/format/classify).
// TZ is pinned to UTC so the wall-clock Date logic (parseTimestamp builds a *local* Date) is
// deterministic on every machine and in CI — local getters then equal the parsed input.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    env: { TZ: "UTC" },
  },
});

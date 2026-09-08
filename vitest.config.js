import { defineConfig } from "vitest/config";

// Unit tests run in Node against the dependency-free src modules (parse/runs/format/classify).
// Controller wall-clock values use UTC components; keep the test process deterministic too.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    env: { TZ: "UTC" },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Vitest hides fully covered files in agent sessions unless explicitly disabled.
      reporter: [["text", { skipFull: false }], "html", "json-summary"],
      // app.js is the DOM layer: it can't even be imported in Node, so it reports ~0% and is
      // EXPECTED to. That number is the point — it's the visible measure of the blind spot
      // (see TESTING_AUDIT.md). Playwright separately checks the production DOM integration.
      //
      // Thresholds therefore cover the pure modules only, per-file. A global threshold would fail
      // on app.js every run and teach everyone to ignore the whole signal. These are set just under
      // today's real numbers: they're a ratchet against regression, not a target to chase.
      thresholds: {
        "src/parse.js": { statements: 95, branches: 85, functions: 100, lines: 95 },
        "src/runs.js": { statements: 95, branches: 95, functions: 100, lines: 95 },
        "src/classify.js": { statements: 95, branches: 90, functions: 100, lines: 95 },
        "src/format.js": { statements: 90, branches: 95, functions: 90, lines: 90 },
        "src/view.js": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "src/diagnostics.js": { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});

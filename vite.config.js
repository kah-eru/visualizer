import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Build-time metadata stamped into the bundle for the crash/feedback report.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));
let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  /* not a git checkout (e.g. tarball build) — leave as "unknown" */
}

export default defineConfig({
  // Project Pages serves from a subpath: https://<user>.github.io/visualizer/
  base: "/visualizer/",
  plugins: [tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}+${commit}`),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});

import { defineConfig, loadEnv } from "vite";
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

export default defineConfig(({ mode }) => ({
  // Project Pages serves from a subpath: https://<user>.github.io/visualizer/
  base: "/visualizer/",
  server: { host: "localhost" },
  preview: { host: "localhost", strictPort: true },
  plugins: [tailwindcss(), {
    name: "production-csp",
    apply: "build",
    transformIndexHtml() {
      const endpoint = loadEnv(mode, process.cwd()).VITE_FEEDBACK_ENDPOINT;
      let feedbackOrigin = "";
      if (endpoint) {
        const url = new URL(endpoint);
        if (url.protocol !== "https:") throw new Error("VITE_FEEDBACK_ENDPOINT must use HTTPS");
        feedbackOrigin = ` ${url.origin}`;
      }
      return [{
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; connect-src 'self' https://api.web3forms.com" + feedbackOrigin +
            "; object-src 'none'; base-uri 'self'; form-action 'none'; worker-src 'self' blob:",
        },
        injectTo: "head-prepend",
      }];
    },
  }],
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}+${commit}`),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
}));

/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { buildCsp } from "./csp.config.ts";

const SECURITY_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** Adds the CSP as a <meta> tag, as a header on `vite preview`, and as a `_headers` file for static hosts. */
function csp(): Plugin {
  let dev = false;
  return {
    name: "blackout-csp",
    configResolved(config) {
      dev = config.command === "serve";
    },
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: buildCsp({ dev }) },
          injectTo: "head-prepend",
        },
      ];
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", buildCsp({ header: true }));
        for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
        next();
      });
    },
    generateBundle() {
      const lines = [
        "/*",
        `  Content-Security-Policy: ${buildCsp({ header: true })}`,
        ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`),
        // Asset names carry a content hash, so a changed file gets a new name: safe to keep for a
        // year. index.html keeps the host's default and is checked on every visit.
        "/assets/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
      ];
      this.emitFile({ type: "asset", fileName: "_headers", source: lines.join("\n") });
    },
  };
}

/** The commit being built: GitHub Actions sets GITHUB_SHA; locally, ask git. */
function buildCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // Shown in the footer so people can see exactly which code they are running.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(buildCommit()),
  },
  base: "./",
  plugins: [react(), csp()],
  worker: { format: "es" },
  // pdf.js is large; it is bundled up front on purpose so nothing loads after startup.
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 2000 },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});

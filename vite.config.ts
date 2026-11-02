/// <reference types="vitest/config" />
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
        "",
      ];
      this.emitFile({ type: "asset", fileName: "_headers", source: lines.join("\n") });
    },
  };
}

export default defineConfig({
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

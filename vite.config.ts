import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * The web app is a real consumer of the analyzer's core. It imports `@core`
 * (types + graph algorithms) — the exact same code the CLI and Action use — and
 * renders the one JSON document. In dev, `/api/analyze` runs the Node analyzer
 * live so the app can re-read the current project on demand.
 */
export default defineConfig({
  root: "apps/web",
  plugins: [react(), analyzeEndpoint()],
  resolve: {
    alias: { "@core": resolve(import.meta.dirname, "src/core") },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

/** Dev-only middleware: GET /api/analyze?root=…&coverage=… -> the document. */
function analyzeEndpoint() {
  return {
    name: "codegraph-analyze",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/analyze", async (req, res) => {
        try {
          const { analyze } = await server.ssrLoadModule(
            resolve(import.meta.dirname, "src/analyzer/analyze.ts"),
          );
          const url = new URL(req.url ?? "", "http://localhost");
          const root = url.searchParams.get("root") ?? ".";
          const coverage = url.searchParams.get("coverage");
          const doc = analyze({ root: resolve(root), coveragePath: coverage, git: true });
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(doc));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

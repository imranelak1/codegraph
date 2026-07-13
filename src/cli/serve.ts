/**
 * `codegraph serve [root]` — the local app.
 *
 * Serves the built web UI AND the real Node analyzer from one process, then
 * opens the browser. Full features (git ownership, coverage, live re-analysis)
 * with no separate dev server and nothing degraded. Pure Node — no new deps.
 */

import { createServer, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { analyze } from "../analyzer/analyze";
import { version as VERSION } from "../analyzer/meta";
import type { CodeGraphDocument } from "../core/types";
import { color } from "./format";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export interface ServeOptions {
  root: string;
  port: number;
  coverage: string | null;
  open: boolean;
  git: boolean;
}

export function serve(opts: ServeOptions): void {
  const webDist = findWebDist();
  if (!webDist) {
    console.error(
      color.red("codegraph: the web UI is not built yet.") +
        "\n  Build it first:  " +
        color.cyan("npm run web:build") +
        "\n  (or use  " +
        color.cyan("npm run app") +
        "  which builds then serves)",
    );
    process.exit(1);
  }

  const analyzedRoot = resolve(opts.root);
  let startupDoc: CodeGraphDocument | null = null;
  const startupDocument = (): CodeGraphDocument => {
    if (!startupDoc) {
      startupDoc = analyze({ root: analyzedRoot, coveragePath: opts.coverage, git: opts.git });
    }
    return startupDoc;
  };

  const server = createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      sendJson(res, 400, { error: "bad request" });
      return;
    }

    // Live analysis — the same analyzer the CLI and Action use.
    if (url.pathname === "/api/analyze") {
      try {
        const root = url.searchParams.get("root") ?? analyzedRoot;
        const coverage = url.searchParams.get("coverage");
        const doc = analyze({
          root: resolve(root),
          coveragePath: coverage && coverage.length > 0 ? coverage : null,
          git: opts.git,
        });
        sendJson(res, 200, doc);
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // The document the app loads on open: the root you pointed serve at.
    if (url.pathname === "/codegraph.json") {
      try {
        sendJson(res, 200, startupDocument());
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    serveStatic(webDist, url.pathname, res);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        color.red(`codegraph: port ${opts.port} is in use.`) +
          `  Try a different one:  codegraph serve --port ${opts.port + 1}`,
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(opts.port, () => {
    const target = `http://localhost:${opts.port}/`;
    console.log(color.bold(`\ncodeGraph v${VERSION}`) + color.dim(" — local app"));
    console.log(`  ${color.cyan(target)}`);
    console.log(color.dim(`  analyzing ${analyzedRoot}${opts.git ? " · git on" : ""}`));
    console.log(color.dim("  Ctrl+C to stop\n"));
    if (opts.open) openBrowser(target);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

/** Serve a file from the web dist, with SPA fallback to index.html. No traversal. */
function serveStatic(webDist: string, pathname: string, res: ServerResponse): void {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidate = rel === "" ? join(webDist, "index.html") : normalize(join(webDist, rel));

  // Guard against path traversal outside the served directory.
  if (candidate !== webDist && !candidate.startsWith(webDist + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  // Real asset, else SPA fallback to index.html.
  const filePath = isFile(candidate) ? candidate : join(webDist, "index.html");
  if (!isFile(filePath)) {
    res.writeHead(404).end("not found");
    return;
  }

  res.writeHead(200, {
    "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
  });
  res.end(readFileSync(filePath));
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Locate apps/web/dist by walking up from this module (works from src or dist). */
function findWebDist(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "apps", "web", "dist", "index.html");
    if (isFile(candidate)) return join(dir, "apps", "web", "dist");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Non-fatal: the URL is printed above.
  }
}

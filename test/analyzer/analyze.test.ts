import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { analyze } from "../../src/analyzer/analyze";
import type { CodeGraphDocument, FileNode, ImportEdge } from "../../src/core/types";

/**
 * End-to-end contract test: run the real analyzer over the sample fixture and
 * assert the ONE document reports the honest numbers documented in the fixture
 * (14 files, 80% resolution, 4 unresolved w/ reasons, 4 external, coverage
 * applied, fan counts consistent, deterministic timestamp).
 *
 * Git is disabled so the document is fully deterministic from disk + coverage.
 */

/** Locate fixtures/sample-project by walking up from this test file to the repo root. */
function fixtureRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "fixtures", "sample-project");
    if (existsSync(join(candidate, "tsconfig.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the known layout (test/analyzer -> repo root).
  return resolve(here, "..", "..", "fixtures", "sample-project");
}

const ROOT = fixtureRoot();
const COVERAGE = join(ROOT, "lcov.info");
// Fixed instant so generatedAt is deterministic: 2026-07-11T12:00:00.000Z
const NOW = Date.UTC(2026, 6, 11, 12, 0, 0);

function run(): CodeGraphDocument {
  return analyze({ root: ROOT, coveragePath: COVERAGE, git: false, now: NOW });
}

function byId(doc: CodeGraphDocument, id: string): FileNode {
  const f = doc.files.find((n) => n.id === id);
  if (!f) throw new Error(`no file node with id ${id}`);
  return f;
}

function edgesFrom(doc: CodeGraphDocument, from: string): ImportEdge[] {
  return doc.edges.filter((e) => e.from === from);
}

describe("analyze() end-to-end over fixtures/sample-project", () => {
  it("resolves the fixture path robustly and reads all 14 modules", () => {
    const doc = run();
    expect(doc.files.length).toBe(14);
    expect(doc.resolution.modules).toBe(14);
    // Every id is a POSIX repo-relative path under src/.
    for (const f of doc.files) {
      expect(f.id.startsWith("src/")).toBe(true);
      expect(f.id.includes("\\")).toBe(false);
    }
    // The .cjs module is read alongside the ESM ones.
    expect(byId(doc, "src/legacy.cjs").module).toBe("cjs");
  });

  it("reports the honest resolution stats (16 resolved, 4 unresolved, 4 external, rate 0.8)", () => {
    const doc = run();
    const r = doc.resolution;
    expect(r.resolved).toBe(16);
    expect(r.unresolved).toBe(4);
    expect(r.external).toBe(4);
    expect(r.internalImports).toBe(20); // resolved + unresolved, external excluded
    expect(r.rate).toBeCloseTo(0.8, 10);
    // Internal edges: one per resolved internal import, none self, none to non-graphed.
    expect(doc.edges.length).toBe(16);
  });

  it("records exactly the four expected unresolved imports, each with a machine-readable reason", () => {
    const doc = run();
    expect(doc.unresolved.length).toBe(4);

    // The three misses in src/broken.ts, one per distinct reason.
    const broken = doc.unresolved.filter((u) => u.from === "src/broken.ts");
    expect(broken.length).toBe(3);
    const brokenByReason = new Map(broken.map((u) => [u.reason, u]));
    expect(brokenByReason.get("module-not-found")?.specifier).toBe("./does-not-exist");
    expect(brokenByReason.get("unmatched-tsconfig-path")?.specifier).toBe("@app/security/secret");
    expect(brokenByReason.get("extension-miss")?.specifier).toBe("./models");

    // The dynamic import in src/routes/posts.ts is honestly unresolved, not guessed.
    const dyn = doc.unresolved.filter((u) => u.reason === "dynamic-expression");
    expect(dyn.length).toBe(1);
    expect(dyn[0]?.from).toBe("src/routes/posts.ts");
    expect(dyn[0]?.kind).toBe("dynamic");

    // Reasons across all four are exactly the documented set.
    expect(new Set(doc.unresolved.map((u) => u.reason))).toEqual(
      new Set(["module-not-found", "unmatched-tsconfig-path", "extension-miss", "dynamic-expression"]),
    );
    // Every unresolved import carries a non-empty detail.
    for (const u of doc.unresolved) expect(u.detail.length).toBeGreaterThan(0);
  });

  it("separates external packages and builtins without counting them as failures", () => {
    const doc = run();
    expect(doc.external.length).toBe(4);
    const bySpec = new Map(doc.external.map((e) => [e.specifier, e]));

    const http = bySpec.get("node:http");
    expect(http).toBeDefined();
    expect(http?.builtin).toBe(true);
    expect(http?.from).toBe("src/server.ts");

    const express = bySpec.get("express");
    expect(express).toBeDefined();
    expect(express?.builtin).toBe(false);

    const pg = bySpec.get("pg");
    expect(pg).toBeDefined();
    expect(pg?.builtin).toBe(false);
    expect(pg?.from).toBe("src/db.ts");

    // node:path (require in the .cjs file) is the fourth external.
    expect(bySpec.get("node:path")?.builtin).toBe(true);
  });

  it("emits edges for the barrel re-export", () => {
    const doc = run();
    const barrel = edgesFrom(doc, "src/routes/index.ts");
    const targets = new Set(barrel.map((e) => e.to));
    expect(targets).toEqual(new Set(["src/routes/users.ts", "src/routes/posts.ts"]));
    // These are re-exports, not plain imports.
    for (const e of barrel) expect(e.kind).toBe("export-star");
  });

  it("resolves @app/* tsconfig-path aliases into real internal edges", () => {
    const doc = run();
    const fromIndex = edgesFrom(doc, "src/index.ts");
    const targets = new Set(fromIndex.map((e) => e.to));
    // index.ts imports ./server, @app/routes, @app/config.
    expect(targets).toEqual(
      new Set(["src/server.ts", "src/routes/index.ts", "src/config.ts"]),
    );
    // The alias is followed but the specifier is preserved exactly as written.
    const aliasEdge = fromIndex.find((e) => e.to === "src/config.ts");
    expect(aliasEdge?.specifier).toBe("@app/config");

    // @app/routes resolves through the directory to its index barrel.
    const routesEdge = fromIndex.find((e) => e.specifier === "@app/routes");
    expect(routesEdge?.to).toBe("src/routes/index.ts");
  });

  it("applies lcov coverage, keeps unknown files null, and grades a low file as crit", () => {
    const doc = run();

    // Fully covered file -> 100, grade A.
    const index = byId(doc, "src/index.ts");
    expect(index.coverage).toBe(100);
    expect(index.grade).toBe("A");
    expect(index.status).toBe("good");

    // A low-coverage file is critical (routes/posts.ts: 1/12 lines hit).
    const posts = byId(doc, "src/routes/posts.ts");
    expect(posts.coverage).toBeCloseTo(8.33, 2);
    expect(posts.status).toBe("crit");
    expect(posts.grade).toBe("E");

    // Files absent from lcov stay null (unknown, not zero) with grade U.
    for (const id of ["src/models/post.ts", "src/models/user.ts", "src/broken.ts"]) {
      const f = byId(doc, id);
      expect(f.coverage).toBeNull();
      expect(f.grade).toBe("U");
      expect(f.status).toBe("unknown");
    }

    // Coverage summary reflects 11 matched / 3 unmatched of the 14 modules.
    expect(doc.coverage).not.toBeNull();
    expect(doc.coverage?.source).toBe("lcov.info");
    expect(doc.coverage?.filesWithCoverage).toBe(11);
    expect(doc.coverage?.filesWithoutCoverage).toBe(3);
  });

  it("keeps fanIn/fanOut consistent with the edge set", () => {
    const doc = run();
    const totalFanIn = doc.files.reduce((s, f) => s + f.fanIn, 0);
    const totalFanOut = doc.files.reduce((s, f) => s + f.fanOut, 0);
    expect(totalFanIn).toBe(doc.edges.length);
    expect(totalFanOut).toBe(doc.edges.length);

    // Spot-check a hub: src/db.ts is imported by posts, users, server (fanIn 3)
    // and imports ./pool (fanOut 1); pg is external and does not count.
    const db = byId(doc, "src/db.ts");
    expect(db.fanIn).toBe(3);
    expect(db.fanOut).toBe(1);

    // Recompute expected fan counts straight from edges and compare per node.
    const expectIn = new Map<string, number>();
    const expectOut = new Map<string, number>();
    for (const e of doc.edges) {
      expectOut.set(e.from, (expectOut.get(e.from) ?? 0) + 1);
      expectIn.set(e.to, (expectIn.get(e.to) ?? 0) + 1);
    }
    for (const f of doc.files) {
      expect(f.fanIn).toBe(expectIn.get(f.id) ?? 0);
      expect(f.fanOut).toBe(expectOut.get(f.id) ?? 0);
    }
  });

  it("derives generatedAt from the injected clock and omits git when disabled", () => {
    const doc = run();
    expect(doc.generatedAt).toBe(new Date(NOW).toISOString());
    expect(doc.generatedAt).toBe("2026-07-11T12:00:00.000Z");
    expect(doc.git).toBeNull();
    expect(doc.root).toBe(resolve(ROOT));
    expect(doc.schema).toBe("1");
  });
});

import { describe, it, expect } from "vitest";
import {
  buildIndex,
  blastRadius,
  blastStats,
  dependencyClosure,
  computeFanCounts,
  findCycles,
} from "../../src/core/graph";
import { gradeCoverage } from "../../src/core/health";
import type { CodeGraphDocument, FileNode, ImportEdge } from "../../src/core/types";

function file(id: string, coverage: number | null = null): FileNode {
  return {
    id,
    path: id,
    ext: ".ts",
    module: "esm",
    loc: 10,
    isBarrel: false,
    isTest: false,
    fanIn: 0,
    fanOut: 0,
    coverage,
    grade: "U",
    status: "unknown",
    owner: null,
    lastChanged: null,
    staleDays: null,
  };
}

function edge(from: string, to: string): ImportEdge {
  return { from, to, specifier: `./${to}`, kind: "static", typeOnly: false, line: 1 };
}

/**
 * Sample graph (edge A->B means "A imports B"):
 *   app -> gv -> index -> resolver
 *   app -> br -> graph -> resolver
 * So changing `resolver` should blast to: index, graph, gv, br, app.
 */
function sampleDoc(): CodeGraphDocument {
  const files = [
    file("app", 8),
    file("gv", 22),
    file("br", 12),
    file("index", 91),
    file("graph", 74),
    file("resolver", 63),
    file("leaf", 100), // depends on nothing, nothing depends on it
  ];
  const edges = [
    edge("app", "gv"),
    edge("app", "br"),
    edge("gv", "index"),
    edge("br", "graph"),
    edge("index", "resolver"),
    edge("graph", "resolver"),
  ];
  return {
    schema: "1",
    tool: { name: "codegraph", version: "test" },
    root: "/x",
    generatedAt: "2020-01-01T00:00:00.000Z",
    files,
    edges,
    unresolved: [],
    external: [],
    resolution: { modules: 7, internalImports: 6, resolved: 6, unresolved: 0, external: 0, rate: 1 },
    coverage: null,
    git: null,
    warnings: [],
  };
}

describe("blastRadius", () => {
  it("finds every module that reaches the changed file", () => {
    const doc = sampleDoc();
    const idx = buildIndex(doc);
    const br = blastRadius(idx, "resolver");
    expect(new Set(br.affected)).toEqual(new Set(["index", "graph", "gv", "br", "app"]));
    expect(br.affected).not.toContain("resolver"); // root excluded
    expect(br.affected).not.toContain("leaf");
  });

  it("computes hop depth (deepest reach)", () => {
    const doc = sampleDoc();
    const idx = buildIndex(doc);
    const br = blastRadius(idx, "resolver");
    expect(br.depth.get("index")).toBe(1);
    expect(br.depth.get("gv")).toBe(2);
    expect(br.depth.get("app")).toBe(3);
    expect(br.maxDepth).toBe(3);
  });

  it("a leaf with no dependents has an empty blast radius", () => {
    const idx = buildIndex(sampleDoc());
    expect(blastRadius(idx, "leaf").affected).toEqual([]);
  });

  it("returns empty for an unknown id", () => {
    const idx = buildIndex(sampleDoc());
    expect(blastRadius(idx, "nope").affected).toEqual([]);
  });
});

describe("blastStats", () => {
  it("counts affected files that are unknown-or-low coverage as 'dark'", () => {
    const doc = sampleDoc();
    const idx = buildIndex(doc);
    // affected = index(91), graph(74), gv(22), br(12), app(8)
    // dark (<50) = gv, br, app => 3 of 5
    const s = blastStats(doc, idx, "resolver", 50);
    expect(s.affectedCount).toBe(5);
    expect(s.darkCount).toBe(3);
    expect(s.darkPct).toBeCloseTo(3 / 5);
    expect(s.maxDepth).toBe(3);
    expect(s.deepest).toBe("app");
  });

  it("treats unknown (null) coverage as dark", () => {
    const doc = sampleDoc();
    doc.files.find((f) => f.id === "index")!.coverage = null;
    const idx = buildIndex(doc);
    const s = blastStats(doc, idx, "resolver", 50);
    expect(s.darkCount).toBe(4); // index now dark too
  });
});

describe("cycles", () => {
  it("detects an import cycle", () => {
    const files = [file("a"), file("b"), file("c")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];
    const doc = { ...sampleDoc(), files, edges };
    const cycles = findCycles(buildIndex(doc));
    expect(cycles.length).toBe(1);
    expect(new Set(cycles[0])).toEqual(new Set(["a", "b", "c"]));
  });

  it("reports no cycles for a DAG", () => {
    expect(findCycles(buildIndex(sampleDoc()))).toEqual([]);
  });
});

describe("computeFanCounts", () => {
  it("derives fanIn/fanOut from edges", () => {
    const doc = sampleDoc();
    computeFanCounts(doc.files, doc.edges);
    const resolver = doc.files.find((f) => f.id === "resolver")!;
    expect(resolver.fanIn).toBe(2); // index + graph
    expect(resolver.fanOut).toBe(0);
    const app = doc.files.find((f) => f.id === "app")!;
    expect(app.fanOut).toBe(2); // gv + br
    expect(app.fanIn).toBe(0);
  });
});

describe("dependencyClosure", () => {
  it("collects everything a file transitively imports", () => {
    const idx = buildIndex(sampleDoc());
    expect(dependencyClosure(idx, "app")).toEqual(
      new Set(["gv", "br", "index", "graph", "resolver"]),
    );
  });
});

describe("gradeCoverage", () => {
  it("never grades unknown coverage as passing", () => {
    expect(gradeCoverage(null).grade).toBe("U");
    expect(gradeCoverage(null).status).toBe("unknown");
    expect(gradeCoverage(undefined).grade).toBe("U");
  });

  it("maps coverage to grade/status", () => {
    expect(gradeCoverage(95).status).toBe("good");
    expect(gradeCoverage(82).grade).toBe("B");
    expect(gradeCoverage(63).status).toBe("warn");
    expect(gradeCoverage(12).status).toBe("crit");
    expect(gradeCoverage(0).grade).toBe("E");
  });
});

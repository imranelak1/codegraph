import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { analyze } from "../../src/analyzer/analyze";
import { parseFile } from "../../src/analyzer/parser";
import { resolveViaPaths } from "../../src/analyzer/resolver";
import { applyCoverage, type FileCoverage } from "../../src/analyzer/coverage";

const REVIEW = resolve("test/fixtures/review");

/**
 * Regression tests for the adversarial-review findings. Each pins a behaviour
 * that was wrong (or missing) before the review and would silently make the
 * graph less honest if it regressed.
 */
describe("review regression: coverage never fabricates from a shared basename", () => {
  it("a file with no lcov record stays unknown even if another file shares its basename", () => {
    const records = new Map<string, FileCoverage>([
      ["/proj/src/a/util.ts", { linesFound: 10, linesHit: 8, rate: 0.8 }],
    ]);
    const app = applyCoverage(["src/a/util.ts", "src/b/util.ts"], records, "lcov.info");
    expect(app.byId.get("src/a/util.ts")).toBeCloseTo(80);
    // src/b/util.ts has NO record — it must not inherit src/a's numbers.
    expect(app.byId.has("src/b/util.ts")).toBe(false);
    expect(app.summary.filesWithoutCoverage).toBe(1);
  });

  it("ambiguous ties (two equally-good suffix matches) resolve to unknown, not a guess", () => {
    const records = new Map<string, FileCoverage>([
      ["x/src/index.ts", { linesFound: 4, linesHit: 4, rate: 1 }],
      ["y/src/index.ts", { linesFound: 4, linesHit: 0, rate: 0 }],
    ]);
    const app = applyCoverage(["src/index.ts"], records, "lcov.info");
    expect(app.byId.has("src/index.ts")).toBe(false);
  });
});

describe("review regression: tsconfig paths use longest-prefix precedence", () => {
  it("falls through a greedy '*' miss to the more specific '@lib/*' that resolves", () => {
    const cfg = {
      baseUrl: REVIEW,
      paths: { "*": ["./vendor/*"], "@lib/*": ["./src/lib/*"] },
    };
    const r = resolveViaPaths("@lib/thing", cfg);
    expect(r.matched).toBe(true);
    expect(r.absPath).not.toBeNull();
    expect(r.absPath!.replace(/\\/g, "/")).toContain("src/lib/thing.ts");
  });
});

describe("review regression: analyze() honesty accounting", () => {
  const doc = analyze({ root: REVIEW, git: false, now: 0 });

  it("dedups repeated imports of the same module into one edge (fan counts stay honest)", () => {
    const aToB = doc.edges.filter((e) => e.from === "src/a.ts" && e.to === "src/b.ts");
    expect(aToB.length).toBe(1);
    expect(aToB[0]!.typeOnly).toBe(false); // a value import makes the dep non-type-only
    const b = doc.files.find((f) => f.id === "src/b.ts")!;
    expect(b.fanIn).toBe(1); // not 2
  });

  it("records an import into an ignored dir as unresolved (reason: excluded), not resolved", () => {
    const excluded = doc.unresolved.filter((u) => u.reason === "excluded");
    expect(excluded.length).toBe(1);
    expect(excluded[0]!.from).toBe("src/into-dist.ts");
  });

  it("the '@lib/*' import resolves to a real edge (precedence fix, end to end)", () => {
    const edge = doc.edges.find((e) => e.from === "src/uses-lib.ts" && e.to === "src/lib/thing.ts");
    expect(edge).toBeTruthy();
    // and it is NOT reported as an unresolved tsconfig-path miss
    expect(doc.unresolved.some((u) => u.from === "src/uses-lib.ts")).toBe(false);
  });

  it("resolution rate reflects the excluded import honestly", () => {
    // resolved: a->b (x2 imports counted), uses-lib->thing = 3 ; unresolved: into-dist = 1
    expect(doc.resolution.resolved).toBe(3);
    expect(doc.resolution.unresolved).toBe(1);
    expect(doc.resolution.rate).toBeCloseTo(0.75);
  });
});

describe("review regression: parser captures import-equals require", () => {
  it("`import x = require('./m')` is recorded as an internal require import", () => {
    const parsed = parseFile("x.ts", 'import x = require("./m");\nexport const y = x;\n');
    const imp = parsed.imports.find((i) => i.specifier === "./m");
    expect(imp).toBeTruthy();
    expect(imp!.kind).toBe("require");
  });
});

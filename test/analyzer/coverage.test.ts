import { describe, it, expect } from "vitest";
import { parseLcov, applyCoverage } from "../../src/analyzer/coverage";
import type { FileCoverage } from "../../src/analyzer/coverage";

describe("parseLcov", () => {
  it("reads SF/LF/LH/end_of_record and computes rate", () => {
    const lcov = [
      "SF:/abs/proj/src/a.ts",
      "DA:1,1", // ignored detail lines
      "LF:10",
      "LH:8",
      "end_of_record",
      "SF:/abs/proj/src/b.ts",
      "LF:4",
      "LH:4",
      "end_of_record",
    ].join("\n");

    const map = parseLcov(lcov);
    expect(map.size).toBe(2);

    const a = map.get("/abs/proj/src/a.ts")!;
    expect(a).toEqual({ linesFound: 10, linesHit: 8, rate: 0.8 });

    const b = map.get("/abs/proj/src/b.ts")!;
    expect(b).toEqual({ linesFound: 4, linesHit: 4, rate: 1 });
  });

  it("handles CRLF line endings and whitespace", () => {
    const lcov = "SF:/p/x.ts\r\nLF:2\r\nLH:1\r\nend_of_record\r\n";
    const map = parseLcov(lcov);
    expect(map.get("/p/x.ts")).toEqual({ linesFound: 2, linesHit: 1, rate: 0.5 });
  });

  it("treats a record with zero found lines as rate 0 (never divides by zero)", () => {
    const lcov = "SF:/p/empty.ts\nLF:0\nLH:0\nend_of_record\n";
    const map = parseLcov(lcov);
    expect(map.get("/p/empty.ts")).toEqual({ linesFound: 0, linesHit: 0, rate: 0 });
  });

  it("resets counters between records so LF/LH do not leak forward", () => {
    // Second record omits LF/LH entirely; must not inherit the first record's 10/8.
    const lcov = [
      "SF:/p/first.ts",
      "LF:10",
      "LH:8",
      "end_of_record",
      "SF:/p/second.ts",
      "end_of_record",
    ].join("\n");
    const map = parseLcov(lcov);
    expect(map.get("/p/second.ts")).toEqual({ linesFound: 0, linesHit: 0, rate: 0 });
  });
});

describe("applyCoverage", () => {
  function rec(rate: number, lf: number, lh: number): FileCoverage {
    return { linesFound: lf, linesHit: lh, rate };
  }

  it("matches records to file ids by longest common path suffix", () => {
    const ids = ["src/a.ts", "src/b.ts"];
    const records = new Map<string, FileCoverage>([
      ["/abs/proj/src/a.ts", rec(0.8, 10, 8)],
      ["/abs/proj/src/b.ts", rec(1, 4, 4)],
    ]);

    const { byId, summary } = applyCoverage(ids, records, "lcov.info");

    expect(byId.get("src/a.ts")).toBe(80);
    expect(byId.get("src/b.ts")).toBe(100);

    expect(summary).toEqual({
      source: "lcov.info",
      filesWithCoverage: 2,
      filesWithoutCoverage: 0,
      linesCovered: 12,
      linesTotal: 14,
      lineRate: 12 / 14,
    });
  });

  it("maps same-basename files in different dirs to the correct record", () => {
    // Both ids end in util.ts; only the directory segment disambiguates them.
    const ids = ["src/a/util.ts", "src/b/util.ts"];
    const records = new Map<string, FileCoverage>([
      ["/proj/src/a/util.ts", rec(0.9, 10, 9)],
      ["/proj/src/b/util.ts", rec(0.5, 10, 5)],
    ]);

    const { byId } = applyCoverage(ids, records, "lcov.info");

    // If matched only on basename, both would collide; the longer suffix wins.
    expect(byId.get("src/a/util.ts")).toBe(90);
    expect(byId.get("src/b/util.ts")).toBe(50);
  });

  it("leaves files with no matching record absent so caller keeps coverage null", () => {
    const ids = ["src/a.ts", "src/orphan.ts"];
    const records = new Map<string, FileCoverage>([
      ["/proj/src/a.ts", rec(0.75, 4, 3)],
    ]);

    const { byId, summary } = applyCoverage(ids, records, "lcov.info");

    expect(byId.has("src/a.ts")).toBe(true);
    expect(byId.get("src/a.ts")).toBe(75);
    // No record whose suffix matches "orphan.ts" -> stays absent (unknown, not zero).
    expect(byId.has("src/orphan.ts")).toBe(false);

    expect(summary.filesWithCoverage).toBe(1);
    expect(summary.filesWithoutCoverage).toBe(1);
    expect(summary.linesCovered).toBe(3);
    expect(summary.linesTotal).toBe(4);
    expect(summary.lineRate).toBe(0.75);
  });

  it("produces a zeroed summary when there are no records at all", () => {
    const { byId, summary } = applyCoverage(["src/a.ts", "src/b.ts"], new Map(), "lcov.info");
    expect(byId.size).toBe(0);
    expect(summary.filesWithCoverage).toBe(0);
    expect(summary.filesWithoutCoverage).toBe(2);
    expect(summary.linesCovered).toBe(0);
    expect(summary.linesTotal).toBe(0);
    expect(summary.lineRate).toBe(0);
  });

  it("round-trips lcov text through parse + apply", () => {
    const lcov = [
      "SF:/build/repo/src/core/graph.ts",
      "LF:50",
      "LH:45",
      "end_of_record",
    ].join("\n");
    const { byId, summary } = applyCoverage(
      ["src/core/graph.ts"],
      parseLcov(lcov),
      "coverage/lcov.info",
    );
    expect(byId.get("src/core/graph.ts")).toBe(90);
    expect(summary.source).toBe("coverage/lcov.info");
    expect(summary.lineRate).toBe(0.9);
  });
});

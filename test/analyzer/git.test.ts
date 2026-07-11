import { describe, it, expect } from "vitest";
import { parseGitLog, topAuthor, daysSince } from "../../src/analyzer/git";

const MARK = "__CG_COMMIT__";

/** Build one commit block: header line + touched file paths. */
function commit(author: string, iso: string, files: string[]): string[] {
  return [`${MARK}\t${author}\t${iso}`, ...files];
}

/**
 * Synthetic log, newest commit first (as `git log` emits). Same wire format the
 * code requests: a `__CG_COMMIT__\t<author>\t<iso>` header, then file paths.
 *
 * Commits (newest -> oldest):
 *   C1 Alice 07-10  a, b
 *   C2 Bob   07-05  a, b, c
 *   C3 Alice 07-01  a, zzz        (zzz is NOT a known id -> ignored)
 *   C4 Carol 06-20  b, c
 *   C5 Dave  06-10  w1, w2, w3, w4  (4 files > maxFilesPerCommit=3 -> no coupling)
 *   C6 Alice 06-01  d
 */
function sampleLog(): string {
  return [
    ...commit("Alice", "2026-07-10T00:00:00Z", ["a", "b"]),
    ...commit("Bob", "2026-07-05T00:00:00Z", ["a", "b", "c"]),
    ...commit("Alice", "2026-07-01T00:00:00Z", ["a", "zzz"]),
    ...commit("Carol", "2026-06-20T00:00:00Z", ["b", "c"]),
    ...commit("Dave", "2026-06-10T00:00:00Z", ["w1", "w2", "w3", "w4"]),
    ...commit("Alice", "2026-06-01T00:00:00Z", ["d"]),
  ].join("\n");
}

const KNOWN = new Set(["a", "b", "c", "d", "w1", "w2", "w3", "w4"]);

function run() {
  return parseGitLog(sampleLog(), KNOWN, { maxFilesPerCommit: 3, maxCoupling: 40 });
}

describe("parseGitLog — per-file aggregation", () => {
  it("counts commits touching each known file", () => {
    const { perFile } = run();
    expect(perFile.get("a")!.commits).toBe(3); // C1, C2, C3
    expect(perFile.get("b")!.commits).toBe(3); // C1, C2, C4
    expect(perFile.get("c")!.commits).toBe(2); // C2, C4
    expect(perFile.get("d")!.commits).toBe(1); // C6
  });

  it("reports the top author (most commits) per file", () => {
    const { perFile } = run();
    // a: Alice(C1,C3)=2, Bob(C2)=1 -> Alice
    expect(topAuthor(perFile.get("a")!)).toBe("Alice");
    // c: Bob(C2)=1, Carol(C4)=1 -> first seen wins the tie => Bob
    expect(topAuthor(perFile.get("c")!)).toBe("Bob");
  });

  it("lastIso is the newest commit touching the file (log is newest-first)", () => {
    const { perFile } = run();
    expect(perFile.get("a")!.lastIso).toBe("2026-07-10T00:00:00Z"); // C1, not C3
    expect(perFile.get("c")!.lastIso).toBe("2026-07-05T00:00:00Z"); // C2, not C4
    expect(perFile.get("d")!.lastIso).toBe("2026-06-01T00:00:00Z");
  });

  it("tracks commitsAnalyzed and the oldest `since`", () => {
    const { commitsAnalyzed, since } = run();
    expect(commitsAnalyzed).toBe(6);
    expect(since).toBe("2026-06-01T00:00:00Z"); // oldest flushed
  });
});

describe("parseGitLog — files not in knownIds are ignored", () => {
  it("does not create entries for unknown paths", () => {
    const { perFile } = run();
    expect(perFile.has("zzz")).toBe(false);
  });

  it("does not let an unknown co-touched file inflate a known file's coupling", () => {
    const { coupling } = run();
    // C3 touched a + zzz; zzz must never appear in any pair.
    expect(coupling.some((c) => c.a === "zzz" || c.b === "zzz")).toBe(false);
  });
});

describe("parseGitLog — change coupling", () => {
  it("scores together / min(commitsA, commitsB) and sorts by score desc", () => {
    const { coupling } = run();
    // pair (b,c): together=2, min(b=3,c=2)=2 -> 1.0
    // pair (a,b): together=2, min(a=3,b=3)=3 -> 0.67
    // pair (a,c): together=1 -> dropped (< 2)
    expect(coupling).toEqual([
      { a: "b", b: "c", together: 2, score: 1 },
      { a: "a", b: "b", together: 2, score: 0.67 },
    ]);
  });

  it("drops pairs that co-occur in only one commit", () => {
    const { coupling } = run();
    expect(coupling.some((c) => c.a === "a" && c.b === "c")).toBe(false);
  });

  it("skips coupling for commits touching more than maxFilesPerCommit files", () => {
    const { coupling, perFile } = run();
    // C5 touched w1..w4 (4 > maxFilesPerCommit=3): no wN pair emitted...
    for (const w of ["w1", "w2", "w3", "w4"]) {
      expect(coupling.some((c) => c.a === w || c.b === w)).toBe(false);
      // ...but the files are still counted per-file.
      expect(perFile.get(w)!.commits).toBe(1);
    }
  });

  it("honors maxCoupling by truncating the sorted list", () => {
    const capped = parseGitLog(sampleLog(), KNOWN, { maxFilesPerCommit: 3, maxCoupling: 1 });
    expect(capped.coupling).toHaveLength(1);
    expect(capped.coupling[0]).toEqual({ a: "b", b: "c", together: 2, score: 1 });
  });
});

describe("daysSince", () => {
  it("computes whole days between an iso and now", () => {
    const now = Date.parse("2026-07-11T00:00:00Z");
    expect(daysSince("2026-07-10T00:00:00Z", now)).toBe(1);
    expect(daysSince("2026-07-11T00:00:00Z", now)).toBe(0);
  });

  it("returns null for null or unparseable input, never negative", () => {
    const now = Date.parse("2026-07-11T00:00:00Z");
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("not-a-date", now)).toBeNull();
    // future date clamps to 0, not negative
    expect(daysSince("2026-08-01T00:00:00Z", now)).toBe(0);
  });
});

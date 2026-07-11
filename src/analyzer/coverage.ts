/**
 * lcov ingestion. We read line coverage (LF/LH) per file and match records to
 * graph nodes by longest common path suffix, because lcov `SF:` paths are often
 * absolute or tool-relative and rarely match our repo-relative ids exactly.
 *
 * A file with no matching record keeps `coverage: null` — unknown, not zero.
 */

import { readFileSafe, toPosix } from "./fs-util";
import type { CoverageSummary } from "../core/types";

export interface FileCoverage {
  linesFound: number;
  linesHit: number;
  rate: number; // 0..1
}

export function parseLcov(lcovText: string): Map<string, FileCoverage> {
  const byPath = new Map<string, FileCoverage>();
  let sf: string | null = null;
  let lf = 0;
  let lh = 0;
  for (const raw of lcovText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      sf = toPosix(line.slice(3));
      lf = 0;
      lh = 0;
    } else if (line.startsWith("LF:")) {
      lf = toInt(line.slice(3));
    } else if (line.startsWith("LH:")) {
      lh = toInt(line.slice(3));
    } else if (line === "end_of_record" && sf) {
      byPath.set(sf, { linesFound: lf, linesHit: lh, rate: lf > 0 ? lh / lf : 0 });
      sf = null;
    }
  }
  return byPath;
}

export interface CoverageApplication {
  /** file id -> coverage percentage 0..100 */
  byId: Map<string, number>;
  summary: CoverageSummary;
}

/**
 * Match lcov records to file ids by suffix and produce per-file percentages
 * plus an overall summary. `fileIds` are the repo-relative POSIX node ids.
 */
export function applyCoverage(
  fileIds: string[],
  records: Map<string, FileCoverage>,
  source: string,
): CoverageApplication {
  const byId = new Map<string, number>();
  const idSet = new Set(fileIds);

  // Index lcov records by their own suffix segments for fast longest-suffix match.
  const recordList = [...records.entries()];

  for (const id of idSet) {
    const match = bestMatch(id, recordList);
    if (match) byId.set(id, round2(match.rate * 100));
  }

  let linesCovered = 0;
  let linesTotal = 0;
  for (const [, cov] of records) {
    linesCovered += cov.linesHit;
    linesTotal += cov.linesFound;
  }

  const summary: CoverageSummary = {
    source,
    filesWithCoverage: byId.size,
    filesWithoutCoverage: idSet.size - byId.size,
    linesCovered,
    linesTotal,
    lineRate: linesTotal > 0 ? linesCovered / linesTotal : 0,
  };

  return { byId, summary };
}

/**
 * Match a graph id to an lcov record by path suffix — but only a FULL suffix
 * counts: every segment of the shorter path must align with the tail of the
 * longer one. A merely-shared basename never matches, so a file with no record
 * stays unknown instead of inheriting an unrelated file's coverage. The longest
 * full-suffix wins; if two different records tie for longest, the match is
 * ambiguous and we return null (unknown) rather than guess.
 */
function bestMatch(
  id: string,
  records: Array<[string, FileCoverage]>,
): FileCoverage | null {
  const idLen = id.split("/").length;
  let best: FileCoverage | null = null;
  let bestScore = 0;
  let ambiguous = false;
  for (const [path, cov] of records) {
    const shared = suffixSegments(id, path);
    const shorter = Math.min(idLen, path.split("/").length);
    // Require the entire shorter path to be a suffix of the longer one.
    if (shared === 0 || shared !== shorter) continue;
    if (shared > bestScore) {
      best = cov;
      bestScore = shared;
      ambiguous = false;
    } else if (shared === bestScore && best !== null && cov !== best) {
      ambiguous = true;
    }
  }
  return ambiguous ? null : best;
}

function suffixSegments(a: string, b: string): number {
  const as = a.split("/");
  const bs = b.split("/");
  let i = as.length - 1;
  let j = bs.length - 1;
  let n = 0;
  while (i >= 0 && j >= 0 && as[i] === bs[j]) {
    n++;
    i--;
    j--;
  }
  return n;
}

function toInt(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function loadLcov(path: string): Map<string, FileCoverage> | null {
  const text = readFileSafe(path);
  if (text === null) return null;
  return parseLcov(text);
}

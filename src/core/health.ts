/**
 * Health grading from coverage. Browser-safe.
 *
 * Grade encodes only what we actually know: coverage. Unknown coverage yields
 * grade "U" / status "unknown" — never a passing grade by default. The blast
 * radius (risk) is presented alongside health, not folded into it, so the graph
 * never implies test confidence it cannot back.
 */

import type { HealthGrade, HealthStatus } from "./types";

export interface Health {
  grade: HealthGrade;
  status: HealthStatus;
  label: string;
}

const UNKNOWN: Health = { grade: "U", status: "unknown", label: "unknown" };

export function gradeCoverage(coverage: number | null | undefined): Health {
  if (coverage === null || coverage === undefined || Number.isNaN(coverage)) {
    return UNKNOWN;
  }
  const c = clamp(coverage, 0, 100);
  if (c >= 90) return { grade: "A", status: "good", label: "well tested" };
  if (c >= 80) return { grade: "B", status: "good", label: "tested" };
  if (c >= 60) return { grade: "C", status: "warn", label: "partial" };
  if (c >= 40) return { grade: "D", status: "warn", label: "thin" };
  return { grade: "E", status: "crit", label: "untested" };
}

export function statusColorRole(status: HealthStatus): "good" | "warn" | "crit" | "ghost" {
  return status === "unknown" ? "ghost" : status;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

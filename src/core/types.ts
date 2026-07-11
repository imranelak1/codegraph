/**
 * The one JSON document.
 *
 * codeGraph emits exactly one of these. Every consumer — the web app, the CLI,
 * the GitHub Action — renders from this document and nothing else.
 *
 * The invariant is honesty: every import we could not resolve is recorded in
 * `unresolved[]` with a machine-readable `reason`, bare specifiers to packages
 * we do not analyze are separated into `external[]` (not counted as failures),
 * and `resolution.rate` reports the real number — printed even when it is bad.
 *
 * This module is browser-safe: it imports no Node built-ins.
 */

export const SCHEMA_VERSION = "1" as const;

export type ModuleKind = "esm" | "cjs" | "mixed" | "unknown";

export type ImportKind =
  | "static" // import x from './x'
  | "dynamic" // import('./x')
  | "require" // require('./x')
  | "export" // export { x } from './x'
  | "export-star"; // export * from './x'

export type HealthStatus = "good" | "warn" | "crit" | "unknown";
export type HealthGrade = "A" | "B" | "C" | "D" | "E" | "U";

/**
 * Why an internal-looking import did not resolve to a file in the graph.
 * These are surfaced verbatim in the UI and the JSON export.
 */
export type UnresolvedReason =
  | "module-not-found" // relative/aliased target does not exist on disk
  | "dynamic-expression" // import(`./${x}`) — specifier is not statically knowable
  | "unmatched-tsconfig-path" // matched no `paths` pattern that pointed at a real file
  | "baseurl-miss" // baseUrl resolution found nothing
  | "workspace-miss" // workspace/package specifier pointed nowhere real
  | "extension-miss" // path exists as a directory/name but no resolvable extension
  | "excluded" // resolved to a file outside the analyzed root / ignored
  | "parse-error"; // the importing file could not be parsed

export interface FileNode {
  /** Stable id — the POSIX repo-relative path (e.g. "src/analyzer/resolver.ts"). */
  id: string;
  path: string;
  ext: string;
  module: ModuleKind;
  /** Non-blank lines of code. */
  loc: number;
  /** Re-export-only file (a barrel). */
  isBarrel: boolean;
  isTest: boolean;
  /** Number of modules that import this file (resolved edges in). */
  fanIn: number;
  /** Number of resolved imports out of this file. */
  fanOut: number;
  /** 0..100 line coverage, or null when unknown. Null is not zero. */
  coverage: number | null;
  grade: HealthGrade;
  status: HealthStatus;
  /** Top author by lines (git), or null. */
  owner: string | null;
  /** ISO date of last commit touching the file, or null. */
  lastChanged: string | null;
  /** Whole days since last change, or null. */
  staleDays: number | null;
}

export interface ImportEdge {
  from: string; // FileNode.id (importer)
  to: string; // FileNode.id (imported)
  specifier: string; // the import string exactly as written
  kind: ImportKind;
  typeOnly: boolean; // `import type` / `export type`
  line: number;
}

export interface UnresolvedImport {
  from: string; // FileNode.id
  specifier: string;
  kind: ImportKind;
  reason: UnresolvedReason;
  /** Human- and machine-readable elaboration (e.g. "no tsconfig path matched '@app/config'"). */
  detail: string;
  line: number;
}

/** A bare specifier to a package or Node built-in — out of scope, tracked honestly. */
export interface ExternalImport {
  from: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  builtin: boolean; // node:fs, path, etc.
}

export interface ResolutionStats {
  modules: number;
  /** Internal imports considered = resolved + unresolved. External is excluded. */
  internalImports: number;
  resolved: number;
  unresolved: number;
  external: number;
  /**
   * resolved / (resolved + unresolved), in 0..1.
   * 1 when there are no internal imports to resolve. External imports never
   * flatter this number, and unresolved ones never disappear from it.
   */
  rate: number;
}

export interface CoverageSummary {
  source: string; // e.g. "lcov.info"
  filesWithCoverage: number;
  filesWithoutCoverage: number;
  linesCovered: number;
  linesTotal: number;
  lineRate: number; // 0..1 overall
}

export interface ChangeCoupling {
  a: string; // FileNode.id
  b: string; // FileNode.id
  together: number; // commits touching both files
  score: number; // together / min(commitsA, commitsB), 0..1
}

export interface GitSummary {
  commitsAnalyzed: number;
  since: string | null;
  coupling: ChangeCoupling[];
}

export interface CodeGraphDocument {
  schema: typeof SCHEMA_VERSION;
  tool: { name: string; version: string };
  /** Absolute analyzed root, as reported by the analyzer. */
  root: string;
  generatedAt: string; // ISO
  files: FileNode[];
  edges: ImportEdge[];
  unresolved: UnresolvedImport[];
  external: ExternalImport[];
  resolution: ResolutionStats;
  coverage: CoverageSummary | null;
  git: GitSummary | null;
  /** Non-fatal problems worth surfacing (e.g. "tsconfig.json not found; using defaults"). */
  warnings: string[];
}

/**
 * Module resolution — the honest core.
 *
 * Every import is classified into exactly one of:
 *   - internal:   resolves to a real file on disk (candidate graph node)
 *   - external:   a bare specifier to a package or Node built-in (out of scope)
 *   - unresolved: an internal-looking import we could not follow, WITH A REASON
 *
 * The resolution rate only ever counts internal vs unresolved. External imports
 * never flatter it; unresolved ones never vanish from it.
 */

import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, resolve, extname, sep } from "node:path";
import { isDir, isFile } from "./fs-util";
import type { UnresolvedReason } from "../core/types";

const BUILTINS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/** Order matters: prefer TS/ESM sources over plain JS, mirroring tsc/bundlers. */
const RESOLVE_EXTS = [".ts", ".tsx", ".mjs", ".cts", ".mts", ".cjs", ".js", ".jsx", ".json"];

export interface ResolverPaths {
  baseUrl: string | null;
  paths: Record<string, string[]>;
}

export type ResolveResult =
  | { kind: "internal"; absPath: string }
  | { kind: "external"; builtin: boolean }
  | { kind: "unresolved"; reason: UnresolvedReason; detail: string };

export function isBuiltin(specifier: string): boolean {
  return BUILTINS.has(specifier) || specifier.startsWith("node:");
}

export function resolveImport(
  specifier: string | null,
  importerAbs: string,
  root: string,
  cfg: ResolverPaths,
): ResolveResult {
  if (specifier === null || specifier.length === 0) {
    return {
      kind: "unresolved",
      reason: "dynamic-expression",
      detail: "import specifier is a runtime expression, not a static string",
    };
  }

  // Relative
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..") {
    const base = resolve(dirname(importerAbs), specifier);
    const hit = tryResolveFile(base);
    if (hit) return classify(hit, root);
    return {
      kind: "unresolved",
      reason: isDir(base) ? "extension-miss" : "module-not-found",
      detail: `relative import '${specifier}' points at nothing on disk`,
    };
  }

  // Absolute filesystem path (rare, but real)
  if (isAbsolute(specifier)) {
    const hit = tryResolveFile(specifier);
    return hit
      ? classify(hit, root)
      : { kind: "unresolved", reason: "module-not-found", detail: `absolute path '${specifier}' not found` };
  }

  // Node built-ins
  if (isBuiltin(specifier)) return { kind: "external", builtin: true };

  // tsconfig `paths`
  if (Object.keys(cfg.paths).length > 0) {
    const viaPaths = resolveViaPaths(specifier, cfg);
    if (viaPaths.matched) {
      if (viaPaths.absPath) return classify(viaPaths.absPath, root);
      return {
        kind: "unresolved",
        reason: "unmatched-tsconfig-path",
        detail: `'${specifier}' matched a tsconfig path pattern but no target exists on disk`,
      };
    }
  }

  // baseUrl (non-relative resolution)
  if (cfg.baseUrl) {
    const hit = tryResolveFile(join(cfg.baseUrl, specifier));
    if (hit) return classify(hit, root);
  }

  // Anything else is a bare specifier to an external package we do not analyze.
  return { kind: "external", builtin: false };
}

/** A resolved file is internal iff it lives under the analyzed root. */
function classify(absPath: string, root: string): ResolveResult {
  const normalizedRoot = resolve(root);
  const normalized = resolve(absPath);
  if (normalized === normalizedRoot || normalized.startsWith(normalizedRoot + sep)) {
    return { kind: "internal", absPath: normalized };
  }
  // Resolved to a real file outside the analyzed root: real, but out of scope.
  return { kind: "external", builtin: false };
}

/**
 * Resolve a base path to a concrete file:
 *   - exact file
 *   - base + extension
 *   - base/index + extension  (directory / barrel entry)
 */
export function tryResolveFile(base: string): string | null {
  if (extname(base) && isFile(base)) return base;
  for (const ext of RESOLVE_EXTS) {
    const cand = base + ext;
    if (isFile(cand)) return cand;
  }
  if (isDir(base)) {
    for (const ext of RESOLVE_EXTS) {
      const cand = join(base, "index" + ext);
      if (isFile(cand)) return cand;
    }
  }
  return null;
}

interface PathsResult {
  matched: boolean;
  absPath: string | null;
}

interface PathCandidate {
  captured: string | null;
  targets: string[];
  /** Higher wins: exact match beats any wildcard; among wildcards, longest prefix. */
  specificity: number;
}

/**
 * TypeScript `paths` mapping with a single `*` wildcard per pattern.
 *
 * Mirrors tsc precedence: an exact (non-wildcard) match wins, then the wildcard
 * pattern with the longest literal prefix. Crucially, ALL matching patterns are
 * tried in precedence order before we declare a miss — a specifier that matches
 * a greedy `*` pattern with no file on disk must still fall through to a more
 * specific pattern that does resolve, instead of being reported unresolved.
 */
export function resolveViaPaths(specifier: string, cfg: ResolverPaths): PathsResult {
  const base = cfg.baseUrl ?? ".";
  const candidates: PathCandidate[] = [];

  for (const [pattern, targets] of Object.entries(cfg.paths)) {
    const star = pattern.indexOf("*");
    if (star >= 0) {
      const pre = pattern.slice(0, star);
      const post = pattern.slice(star + 1);
      if (
        specifier.length >= pre.length + post.length &&
        specifier.startsWith(pre) &&
        specifier.endsWith(post)
      ) {
        candidates.push({
          captured: specifier.slice(pre.length, specifier.length - post.length),
          targets,
          specificity: pre.length,
        });
      }
    } else if (specifier === pattern) {
      candidates.push({ captured: null, targets, specificity: Number.POSITIVE_INFINITY });
    }
  }

  if (candidates.length === 0) return { matched: false, absPath: null };

  candidates.sort((a, b) => b.specificity - a.specificity);
  for (const cand of candidates) {
    for (const target of cand.targets) {
      const filled = cand.captured !== null ? target.replace("*", cand.captured) : target;
      const abs = isAbsolute(filled) ? filled : join(base, filled);
      const hit = tryResolveFile(abs);
      if (hit) return { matched: true, absPath: hit };
    }
  }
  // Some pattern matched but none of them pointed at a real file — an honest miss.
  return { matched: true, absPath: null };
}

/**
 * Pure graph algorithms over a CodeGraphDocument. Browser-safe (no Node APIs).
 *
 * Blast radius is the product's core question: "if I change this file, what
 * else is affected?" That is reverse reachability — every module that can reach
 * the changed file by following `imports` edges.
 */

import type { CodeGraphDocument, FileNode, ImportEdge } from "./types";

export interface GraphIndex {
  byId: Map<string, FileNode>;
  /** id -> ids it imports (dependencies / out-edges). */
  out: Map<string, string[]>;
  /** id -> ids that import it (dependents / in-edges). */
  in: Map<string, string[]>;
}

/** Build adjacency maps once; reuse across queries. Ignores edges to unknown nodes. */
export function buildIndex(doc: CodeGraphDocument): GraphIndex {
  const byId = new Map<string, FileNode>();
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const f of doc.files) {
    byId.set(f.id, f);
    out.set(f.id, []);
    inn.set(f.id, []);
  }
  for (const e of doc.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (e.from === e.to) continue; // ignore self-imports in traversal
    out.get(e.from)!.push(e.to);
    inn.get(e.to)!.push(e.from);
  }
  return { byId, out, in: inn };
}

export function dependencies(index: GraphIndex, id: string): string[] {
  return index.out.get(id) ?? [];
}

export function dependents(index: GraphIndex, id: string): string[] {
  return index.in.get(id) ?? [];
}

export interface BlastRadius {
  root: string;
  /** Affected ids, excluding the root, in breadth-first order. */
  affected: string[];
  /** id -> hop distance from root (root = 0). */
  depth: Map<string, number>;
  maxDepth: number;
}

/**
 * Reverse-reachable set from `id`: everyone whose behaviour can depend on it.
 * BFS over in-edges (dependents). Cycle-safe.
 */
export function blastRadius(index: GraphIndex, id: string): BlastRadius {
  const depth = new Map<string, number>();
  const affected: string[] = [];
  if (!index.byId.has(id)) return { root: id, affected, depth, maxDepth: 0 };
  depth.set(id, 0);
  const queue: string[] = [id];
  let maxDepth = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const dep of index.in.get(cur) ?? []) {
      if (!depth.has(dep)) {
        depth.set(dep, d + 1);
        maxDepth = Math.max(maxDepth, d + 1);
        affected.push(dep);
        queue.push(dep);
      }
    }
  }
  return { root: id, affected, depth, maxDepth };
}

/** Forward-reachable set: everything `id` (transitively) depends on. */
export function dependencyClosure(index: GraphIndex, id: string): Set<string> {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const dep of index.out.get(cur) ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return seen;
}

export interface BlastStats {
  root: string;
  affectedCount: number;
  /** Affected files whose coverage is unknown or below `darkThreshold`. */
  darkCount: number;
  darkPct: number; // 0..1 of affected; 0 when nothing is affected
  maxDepth: number;
  deepest: string | null;
}

/**
 * "How much of the blast radius lands in the dark?" A file is dark when its
 * coverage is unknown (null) or below `darkThreshold`. Unknown counts as dark
 * on purpose — we do not get to assume untested code is fine.
 */
export function blastStats(
  doc: CodeGraphDocument,
  index: GraphIndex,
  id: string,
  darkThreshold = 50,
): BlastStats {
  const br = blastRadius(index, id);
  let darkCount = 0;
  let deepest: string | null = null;
  let deepestDepth = 0;
  for (const affId of br.affected) {
    const node = index.byId.get(affId);
    if (!node) continue;
    if (node.coverage === null || node.coverage < darkThreshold) darkCount++;
    const d = br.depth.get(affId) ?? 0;
    if (d > deepestDepth) {
      deepestDepth = d;
      deepest = affId;
    }
  }
  const affectedCount = br.affected.length;
  return {
    root: id,
    affectedCount,
    darkCount,
    darkPct: affectedCount === 0 ? 0 : darkCount / affectedCount,
    maxDepth: br.maxDepth,
    deepest,
  };
}

/**
 * Recompute fanIn/fanOut from edges. The analyzer calls this so the numbers on
 * FileNode are always consistent with the edge list a consumer would traverse.
 */
export function computeFanCounts(files: FileNode[], edges: ImportEdge[]): void {
  const ids = new Set(files.map((f) => f.id));
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    fanOut.set(e.from, (fanOut.get(e.from) ?? 0) + 1);
    fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1);
  }
  for (const f of files) {
    f.fanIn = fanIn.get(f.id) ?? 0;
    f.fanOut = fanOut.get(f.id) ?? 0;
  }
}

/** Detect import cycles (each returned array is one cycle of file ids). */
export function findCycles(index: GraphIndex): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen implicit, 1 on-stack, 2 done
  const stack: string[] = [];

  const visit = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of index.out.get(node) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 0) {
        visit(next);
      } else if (s === 1) {
        const idx = stack.indexOf(next);
        if (idx >= 0) cycles.push(stack.slice(idx));
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const id of index.byId.keys()) {
    if ((state.get(id) ?? 0) === 0) visit(id);
  }
  return cycles;
}

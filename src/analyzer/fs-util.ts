import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, sep, relative } from "node:path";

/** Extensions we treat as graph nodes (modules). */
export const SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  ".vite",
]);

export function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Repo-relative POSIX id for a file, used as its stable node id. */
export function relId(root: string, absPath: string): string {
  return toPosix(relative(root, absPath));
}

export function isTestFile(path: string): boolean {
  const p = toPosix(path);
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
    p.includes("/__tests__/") ||
    p.includes("/__mocks__/")
  );
}

export function readFileSafe(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Count non-blank lines. */
export function countLoc(text: string): number {
  let n = 0;
  let inLine = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 /* \n */) {
      if (inLine) n++;
      inLine = false;
    } else if (c !== 13 /* \r */ && c !== 32 /* space */ && c !== 9 /* tab */) {
      inLine = true;
    }
  }
  if (inLine) n++;
  return n;
}

/** Walk source files under root, skipping ignored dirs, hidden dirs, and .d.ts. */
export function walkSourceFiles(root: string, extraIgnore: string[] = []): string[] {
  const ignore = new Set([...DEFAULT_IGNORE_DIRS, ...extraIgnore]);
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (ignore.has(e.name)) continue;
        if (e.name.startsWith(".") && e.name !== ".") continue;
        stack.push(full);
      } else if (e.isFile()) {
        if (e.name.endsWith(".d.ts")) continue;
        const ext = extname(e.name);
        if ((SOURCE_EXTS as readonly string[]).includes(ext)) out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

export { existsSync };

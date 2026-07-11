import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  resolveImport,
  resolveViaPaths,
  tryResolveFile,
  isBuiltin,
  type ResolverPaths,
} from "../../src/analyzer/resolver";

// ── Fixture layout (all real files on disk) ────────────────────────────────
//
//   test/fixtures/resolver/
//     proj/                        <- the analyzed ROOT
//       src/
//         importer.ts              <- the importing file (importerAbs)
//         target.ts                <- extensionless probe -> .ts
//         comp.tsx                 <- extensionless probe -> .tsx
//         legacy.js                <- extensionless probe -> .js
//         barrel/index.ts          <- directory index resolution
//         emptydir/note.txt        <- a real dir with no resolvable index
//       app/config.ts              <- baseUrl + tsconfig-paths target
//     ext-out/ext.ts               <- a real file OUTSIDE the root
//
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../fixtures/resolver/proj");
const IMPORTER = join(ROOT, "src", "importer.ts");
const OUTSIDE = resolve(here, "../fixtures/resolver/ext-out/ext.ts");

/** cfg with tsconfig `paths` and a baseUrl anchored at the analyzed root. */
const CFG_PATHS: ResolverPaths = {
  baseUrl: ROOT,
  paths: { "@app/*": ["app/*"] },
};
/** cfg with a baseUrl but no `paths`. */
const CFG_BASEURL: ResolverPaths = { baseUrl: ROOT, paths: {} };
/** cfg with nothing configured — bare specifiers must fall through to external. */
const CFG_BARE: ResolverPaths = { baseUrl: null, paths: {} };

describe("resolveImport — relative internal", () => {
  it("resolves a relative import to an existing .ts file", () => {
    const r = resolveImport("./target.ts", IMPORTER, ROOT, CFG_BARE);
    expect(r).toEqual({ kind: "internal", absPath: join(ROOT, "src", "target.ts") });
  });

  it("resolves a relative import to an existing .tsx file", () => {
    const r = resolveImport("./comp.tsx", IMPORTER, ROOT, CFG_BARE);
    expect(r).toEqual({ kind: "internal", absPath: join(ROOT, "src", "comp.tsx") });
  });

  it("resolves a relative import to an existing .js file", () => {
    const r = resolveImport("./legacy.js", IMPORTER, ROOT, CFG_BARE);
    expect(r).toEqual({ kind: "internal", absPath: join(ROOT, "src", "legacy.js") });
  });

  it("resolves an extensionless relative import via extension probe", () => {
    // "./target" has no extension; the probe should find target.ts.
    const r = resolveImport("./target", IMPORTER, ROOT, CFG_BARE);
    expect(r).toEqual({ kind: "internal", absPath: join(ROOT, "src", "target.ts") });
  });

  it("prefers .ts/.tsx over .js in the extension probe order", () => {
    // "./comp" (no ext) resolves to comp.tsx because .tsx precedes .js.
    const r = resolveImport("./comp", IMPORTER, ROOT, CFG_BARE);
    expect(r).toEqual({ kind: "internal", absPath: join(ROOT, "src", "comp.tsx") });
  });

  it("resolves an extensionless relative import via directory index", () => {
    // "./barrel" is a directory; resolution should find barrel/index.ts.
    const r = resolveImport("./barrel", IMPORTER, ROOT, CFG_BARE);
    expect(r).toEqual({ kind: "internal", absPath: join(ROOT, "src", "barrel", "index.ts") });
  });
});

describe("resolveImport — relative unresolved", () => {
  it("missing relative file -> module-not-found", () => {
    const r = resolveImport("./does-not-exist", IMPORTER, ROOT, CFG_BARE);
    expect(r.kind).toBe("unresolved");
    if (r.kind === "unresolved") {
      expect(r.reason).toBe("module-not-found");
      expect(r.detail).toContain("./does-not-exist");
    }
  });

  it("a directory with no index -> extension-miss", () => {
    // emptydir exists on disk but has no index.{ts,tsx,js,...}.
    const r = resolveImport("./emptydir", IMPORTER, ROOT, CFG_BARE);
    expect(r.kind).toBe("unresolved");
    if (r.kind === "unresolved") {
      expect(r.reason).toBe("extension-miss");
    }
  });
});

describe("resolveImport — absolute filesystem paths", () => {
  it("an absolute path to a real file inside the root -> internal", () => {
    const abs = join(ROOT, "src", "target.ts");
    const r = resolveImport(abs, IMPORTER, ROOT, CFG_BARE);
    expect(r).toEqual({ kind: "internal", absPath: abs });
  });

  it("an absolute path to a missing file -> module-not-found", () => {
    const abs = join(ROOT, "src", "nope.ts");
    const r = resolveImport(abs, IMPORTER, ROOT, CFG_BARE);
    expect(r.kind).toBe("unresolved");
    if (r.kind === "unresolved") expect(r.reason).toBe("module-not-found");
  });
});

describe("resolveImport — external (packages & builtins)", () => {
  it("classifies a node: builtin as external with builtin=true", () => {
    expect(resolveImport("node:path", IMPORTER, ROOT, CFG_BARE)).toEqual({
      kind: "external",
      builtin: true,
    });
  });

  it("classifies a bare builtin (fs) as external with builtin=true", () => {
    expect(resolveImport("fs", IMPORTER, ROOT, CFG_BARE)).toEqual({
      kind: "external",
      builtin: true,
    });
  });

  it("classifies a bare package (react) as external with builtin=false", () => {
    expect(resolveImport("react", IMPORTER, ROOT, CFG_BARE)).toEqual({
      kind: "external",
      builtin: false,
    });
  });

  it("classifies a scoped bare package as external", () => {
    expect(resolveImport("@scope/pkg", IMPORTER, ROOT, CFG_BARE)).toEqual({
      kind: "external",
      builtin: false,
    });
  });
});

describe("resolveImport — tsconfig paths", () => {
  it("'@app/*' -> app/* mapping that hits a real file -> internal", () => {
    const r = resolveImport("@app/config", IMPORTER, ROOT, CFG_PATHS);
    expect(r).toEqual({ kind: "internal", absPath: join(ROOT, "app", "config.ts") });
  });

  it("matches a paths pattern but the target is missing -> unmatched-tsconfig-path", () => {
    const r = resolveImport("@app/ghost", IMPORTER, ROOT, CFG_PATHS);
    expect(r.kind).toBe("unresolved");
    if (r.kind === "unresolved") {
      expect(r.reason).toBe("unmatched-tsconfig-path");
      expect(r.detail).toContain("@app/ghost");
    }
  });

  it("a specifier matching no pattern falls through to external", () => {
    // "@other/x" matches no configured pattern and is not a builtin.
    const r = resolveImport("@other/x", IMPORTER, ROOT, CFG_PATHS);
    expect(r).toEqual({ kind: "external", builtin: false });
  });
});

describe("resolveImport — baseUrl", () => {
  it("resolves a non-relative specifier via baseUrl -> internal", () => {
    // baseUrl=ROOT, so "app/config" resolves to <ROOT>/app/config.ts.
    const r = resolveImport("app/config", IMPORTER, ROOT, CFG_BASEURL);
    expect(r).toEqual({ kind: "internal", absPath: join(ROOT, "app", "config.ts") });
  });

  it("a baseUrl miss falls through to external (resolver never emits baseurl-miss)", () => {
    // Documents actual resolver behavior: an unmatched baseUrl lookup is treated
    // as a bare external specifier, not an unresolved 'baseurl-miss'.
    const r = resolveImport("app/ghost", IMPORTER, ROOT, CFG_BASEURL);
    expect(r).toEqual({ kind: "external", builtin: false });
  });
});

describe("resolveImport — resolution outside the analyzed root", () => {
  it("a relative import resolving OUTSIDE root is external, not internal", () => {
    // ../../ext-out/ext resolves to a real file outside ROOT.
    const r = resolveImport("../../ext-out/ext", IMPORTER, ROOT, CFG_BARE);
    // Sanity: the target really exists on disk.
    expect(tryResolveFile(OUTSIDE)).toBe(OUTSIDE);
    expect(r).toEqual({ kind: "external", builtin: false });
  });
});

describe("resolveImport — dynamic / null specifier", () => {
  it("a null specifier -> dynamic-expression", () => {
    const r = resolveImport(null, IMPORTER, ROOT, CFG_BARE);
    expect(r.kind).toBe("unresolved");
    if (r.kind === "unresolved") expect(r.reason).toBe("dynamic-expression");
  });

  it("an empty-string specifier -> dynamic-expression", () => {
    const r = resolveImport("", IMPORTER, ROOT, CFG_BARE);
    expect(r.kind).toBe("unresolved");
    if (r.kind === "unresolved") expect(r.reason).toBe("dynamic-expression");
  });
});

describe("isBuiltin", () => {
  it("recognizes node: prefixed builtins", () => {
    expect(isBuiltin("node:path")).toBe(true);
    expect(isBuiltin("node:fs/promises")).toBe(true);
  });

  it("recognizes bare builtins", () => {
    expect(isBuiltin("fs")).toBe(true);
    expect(isBuiltin("path")).toBe(true);
  });

  it("rejects packages and relative specifiers", () => {
    expect(isBuiltin("react")).toBe(false);
    expect(isBuiltin("./local")).toBe(false);
    expect(isBuiltin("@app/config")).toBe(false);
  });
});

describe("tryResolveFile", () => {
  it("returns an exact file that already has an extension", () => {
    const abs = join(ROOT, "src", "target.ts");
    expect(tryResolveFile(abs)).toBe(abs);
  });

  it("resolves an extensionless base via the extension probe", () => {
    const base = join(ROOT, "src", "target");
    expect(tryResolveFile(base)).toBe(join(ROOT, "src", "target.ts"));
  });

  it("resolves a directory to its index file", () => {
    const base = join(ROOT, "src", "barrel");
    expect(tryResolveFile(base)).toBe(join(ROOT, "src", "barrel", "index.ts"));
  });

  it("returns null for a base that matches nothing", () => {
    expect(tryResolveFile(join(ROOT, "src", "phantom"))).toBeNull();
  });

  it("returns null for a directory with no resolvable index", () => {
    expect(tryResolveFile(join(ROOT, "src", "emptydir"))).toBeNull();
  });
});

describe("resolveViaPaths", () => {
  it("matches a wildcard pattern and returns the real target file", () => {
    const r = resolveViaPaths("@app/config", CFG_PATHS);
    expect(r).toEqual({ matched: true, absPath: join(ROOT, "app", "config.ts") });
  });

  it("reports matched=true, absPath=null when the pattern hits but the file is missing", () => {
    const r = resolveViaPaths("@app/ghost", CFG_PATHS);
    expect(r).toEqual({ matched: true, absPath: null });
  });

  it("reports matched=false when no pattern applies", () => {
    const r = resolveViaPaths("@other/config", CFG_PATHS);
    expect(r).toEqual({ matched: false, absPath: null });
  });
});

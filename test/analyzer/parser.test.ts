import { describe, it, expect } from "vitest";
import { parseFile } from "../../src/analyzer/parser";

/**
 * These tests drive the parser with INLINE source via
 * parseFile(absPathHint, sourceText). The path hint only decides the
 * TS ScriptKind (extension); the source text is what's parsed.
 */

const TS = "C:/x/mod.ts";

describe("parser: static imports", () => {
  it("extracts a plain static import (kind 'static', typeOnly false)", () => {
    const r = parseFile(TS, `import { a } from "./a";\n`);
    expect(r.parseError).toBe(false);
    expect(r.module).toBe("esm");
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0]).toMatchObject({
      specifier: "./a",
      kind: "static",
      typeOnly: false,
    });
  });

  it("marks `import type` as typeOnly", () => {
    const r = parseFile(TS, `import type { T } from "./types";\n`);
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0]).toMatchObject({
      specifier: "./types",
      kind: "static",
      typeOnly: true,
    });
  });
});

describe("parser: export-from declarations", () => {
  it("`export { x } from` is kind 'export'", () => {
    const r = parseFile(TS, `export { x } from "./x";\n`);
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0]).toMatchObject({
      specifier: "./x",
      kind: "export",
      typeOnly: false,
    });
  });

  it("`export * from` is kind 'export-star'", () => {
    const r = parseFile(TS, `export * from "./x";\n`);
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0]).toMatchObject({
      specifier: "./x",
      kind: "export-star",
    });
  });

  it("`export type { T } from` is kind 'export' and typeOnly", () => {
    const r = parseFile(TS, `export type { T } from "./t";\n`);
    expect(r.imports[0]).toMatchObject({
      specifier: "./t",
      kind: "export",
      typeOnly: true,
    });
  });

  it("a bare `export { x }` (no `from`) yields no import edge", () => {
    const r = parseFile(TS, `const x = 1;\nexport { x };\n`);
    expect(r.imports).toEqual([]);
  });
});

describe("parser: dynamic import()", () => {
  it("dynamic import with a string literal (kind 'dynamic', specifier set)", () => {
    const r = parseFile(TS, `const p = import("./lazy");\n`);
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0]).toMatchObject({
      specifier: "./lazy",
      kind: "dynamic",
      typeOnly: false,
    });
  });

  it("dynamic import with a template/expression has specifier null", () => {
    const r = parseFile(
      TS,
      "const x = 'a';\nconst p = import(`./mods/${x}`);\n",
    );
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0]).toMatchObject({ specifier: null, kind: "dynamic" });
  });

  it("dynamic import with a plain identifier argument has specifier null", () => {
    const r = parseFile(TS, `const name = "z";\nconst p = import(name);\n`);
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0]).toMatchObject({ specifier: null, kind: "dynamic" });
  });
});

describe("parser: CommonJS", () => {
  it("require() is kind 'require' and marks module 'cjs'", () => {
    const r = parseFile(TS, `const a = require("./a");\n`);
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0]).toMatchObject({
      specifier: "./a",
      kind: "require",
      typeOnly: false,
    });
    expect(r.module).toBe("cjs");
  });

  it("require() with a non-literal argument has specifier null", () => {
    const r = parseFile(TS, `const n = "x";\nconst a = require(n);\n`);
    expect(r.imports[0]).toMatchObject({ specifier: null, kind: "require" });
    expect(r.module).toBe("cjs");
  });

  it("`module.exports = ...` marks module 'cjs' (no import edge)", () => {
    const r = parseFile(TS, `module.exports = { a: 1 };\n`);
    expect(r.imports).toEqual([]);
    expect(r.module).toBe("cjs");
  });

  it("`exports.foo = ...` marks module 'cjs'", () => {
    const r = parseFile(TS, `exports.foo = 1;\n`);
    expect(r.module).toBe("cjs");
  });
});

describe("parser: module kind", () => {
  it("esm import + require => 'mixed'", () => {
    const r = parseFile(TS, `import { a } from "./a";\nconst b = require("./b");\n`);
    expect(r.module).toBe("mixed");
    expect(r.imports.map((i) => i.kind).sort()).toEqual(["require", "static"]);
  });

  it("static import + module.exports => 'mixed'", () => {
    const r = parseFile(TS, `import { a } from "./a";\nmodule.exports = a;\n`);
    expect(r.module).toBe("mixed");
  });

  it("a file with no imports/exports => 'unknown'", () => {
    const r = parseFile(TS, `const x = 1;\nconsole.log(x);\n`);
    expect(r.module).toBe("unknown");
    expect(r.imports).toEqual([]);
  });

  it("dynamic import counts as esm", () => {
    const r = parseFile(TS, `const p = import("./lazy");\n`);
    expect(r.module).toBe("esm");
  });
});

describe("parser: isBarrel", () => {
  it("true when every statement re-exports from elsewhere", () => {
    const r = parseFile(TS, `export { a } from "./a";\nexport * from "./b";\n`);
    expect(r.isBarrel).toBe(true);
  });

  it("false when the file has non-reexport statements", () => {
    const r = parseFile(TS, `export { a } from "./a";\nconst local = 1;\n`);
    expect(r.isBarrel).toBe(false);
  });

  it("false for a file that only imports (import is not a re-export)", () => {
    const r = parseFile(TS, `import { a } from "./a";\n`);
    expect(r.isBarrel).toBe(false);
  });

  it("false for an empty file", () => {
    const r = parseFile(TS, ``);
    expect(r.isBarrel).toBe(false);
  });
});

describe("parser: loc", () => {
  it("counts non-blank lines only", () => {
    // 3 non-blank lines; blank + whitespace-only lines excluded.
    const src = [
      `import { a } from "./a";`, // 1
      ``, // blank
      `   `, // whitespace-only -> blank
      `const x = a;`, // 2
      `\t`, // tab-only -> blank
      `export default x;`, // 3
    ].join("\n");
    const r = parseFile(TS, src);
    expect(r.loc).toBe(3);
  });
});

describe("parser: line numbers are 1-based", () => {
  it("reports the line of the module specifier / call", () => {
    const src = [
      `// header comment`, // line 1
      `import { a } from "./a";`, // line 2
      ``, // line 3
      `export * from "./b";`, // line 4
      `const p = import("./c");`, // line 5
    ].join("\n");
    const r = parseFile(TS, src);
    const byKind = Object.fromEntries(r.imports.map((i) => [i.specifier, i.line]));
    expect(byKind["./a"]).toBe(2);
    expect(byKind["./b"]).toBe(4);
    expect(byKind["./c"]).toBe(5);
  });
});

describe("parser: error handling", () => {
  it("returns parseError when the file cannot be read and no source is given", () => {
    const r = parseFile("C:/definitely/missing/nope.ts");
    expect(r.parseError).toBe(true);
    expect(r.imports).toEqual([]);
    expect(r.module).toBe("unknown");
    expect(r.loc).toBe(0);
    expect(r.isBarrel).toBe(false);
  });
});

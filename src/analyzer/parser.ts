/**
 * Import extraction via the TypeScript compiler API.
 *
 * We never regex over source to find imports — the AST is the source of truth.
 * Captures static imports, `export ... from`, `export *`, dynamic `import()`,
 * and CommonJS `require()`. Dynamic imports with a non-literal specifier are
 * reported with `specifier: null` so the resolver can record them honestly
 * rather than silently dropping them.
 */

import ts from "typescript";
import { extname } from "node:path";
import { countLoc, readFileSafe } from "./fs-util";
import type { ImportKind, ModuleKind } from "../core/types";

export interface RawImport {
  /** null when the specifier is a runtime expression (e.g. import(`./${x}`)). */
  specifier: string | null;
  kind: ImportKind;
  typeOnly: boolean;
  line: number;
}

export interface ParsedFile {
  imports: RawImport[];
  loc: number;
  module: ModuleKind;
  isBarrel: boolean;
  parseError: boolean;
}

function scriptKind(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

export function parseFile(absPath: string, sourceText?: string): ParsedFile {
  const text = sourceText ?? readFileSafe(absPath);
  if (text === null) {
    return { imports: [], loc: 0, module: "unknown", isBarrel: false, parseError: true };
  }

  const sf = ts.createSourceFile(
    absPath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind(absPath),
  );

  const imports: RawImport[] = [];
  let hasEsm = false;
  let hasCjs = false;
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      hasEsm = true;
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteralLike(spec)) {
        imports.push({
          specifier: spec.text,
          kind: "static",
          typeOnly: node.importClause?.isTypeOnly ?? false,
          line: lineOf(spec.getStart(sf)),
        });
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      hasEsm = true;
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteralLike(spec)) {
        imports.push({
          specifier: spec.text,
          kind: node.exportClause ? "export" : "export-star",
          typeOnly: node.isTypeOnly,
          line: lineOf(spec.getStart(sf)),
        });
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        hasEsm = true;
        const arg = node.arguments[0];
        imports.push({
          specifier: arg && ts.isStringLiteralLike(arg) ? arg.text : null,
          kind: "dynamic",
          typeOnly: false,
          line: lineOf(node.getStart(sf)),
        });
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        hasCjs = true;
        const arg = node.arguments[0];
        imports.push({
          specifier: arg && ts.isStringLiteralLike(arg) ? arg.text : null,
          kind: "require",
          typeOnly: false,
          line: lineOf(node.getStart(sf)),
        });
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      // TypeScript `import x = require("./m")` — an ExternalModuleReference, not
      // a call expression, so it is invisible to the require() branch above.
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteralLike(ref.expression)) {
        hasEsm = true;
        imports.push({
          specifier: ref.expression.text,
          kind: "require",
          typeOnly: node.isTypeOnly,
          line: lineOf(ref.expression.getStart(sf)),
        });
      }
    } else if (isModuleExportsAssignment(node)) {
      hasCjs = true;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);

  // A barrel is a file whose every top-level statement re-exports from elsewhere.
  const statements = sf.statements;
  const isBarrel =
    statements.length > 0 &&
    statements.every(
      (st) =>
        (ts.isExportDeclaration(st) && st.moduleSpecifier !== undefined) ||
        ts.isEmptyStatement(st),
    );

  const module: ModuleKind =
    hasEsm && hasCjs ? "mixed" : hasEsm ? "esm" : hasCjs ? "cjs" : "unknown";

  return { imports, loc: countLoc(text), module, isBarrel, parseError: false };
}

/** module.exports = ... / exports.foo = ... */
function isModuleExportsAssignment(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) return false;
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  const left = node.left;
  if (!ts.isPropertyAccessExpression(left) && !ts.isElementAccessExpression(left)) return false;
  const obj = left.expression;
  if (ts.isIdentifier(obj)) return obj.text === "module" || obj.text === "exports";
  if (ts.isPropertyAccessExpression(obj) && ts.isIdentifier(obj.expression)) {
    return obj.expression.text === "module" && obj.name.text === "exports";
  }
  return false;
}

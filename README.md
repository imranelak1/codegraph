# codeGraph

**Turn a TypeScript/JavaScript codebase into an honest dependency graph — and see what a change puts at risk.**

codeGraph reads your imports with the TypeScript compiler (never regex), builds the
dependency graph, and answers one question well:

> If I change this file, what else is affected — and how much of that is untested?

It is a **comprehension instrument, not a code-quality dashboard**.

---

## The one invariant: the graph must be honest

Every derived feature — blast radius, health grade, coupling — inherits the resolver's
errors. A confident wrong answer is worse than a hedged right one. So:

- Every import we can't resolve is recorded in **`unresolved[]` with a machine-readable reason** — never silently dropped.
- Bare specifiers to packages and Node built-ins go in **`external[]`** and are **not** counted as failures.
- The **resolution rate** (`resolved / (resolved + unresolved)`) is printed in the UI, the CLI, the JSON, and the CI summary — **even when it's bad**.
- Unknown coverage is **`null`**, not `0`, and never earns a passing grade.

One analyzer library. Three surfaces — **web app, CLI, GitHub Action** — all rendering the
*same* JSON document and nothing else.

---

## Quick start

```bash
npm install
npm run check          # typecheck + tests
npm run cli -- .       # analyze this repo, print an honest summary
```

Example (analyzing the bundled sample project, which contains deliberately-unresolvable imports):

```bash
npm run cli -- fixtures/sample-project --coverage fixtures/sample-project/lcov.info --no-git
```

```
codegraph  ·  14 modules
███████████████████░░░░░  80.0% resolved   16/20 internal imports · 4 external
4 unresolved — shown below, never dropped
coverage 49.3% (11/14 files) from lcov.info

unresolved imports
  from                  specifier              reason
  src/broken.ts         ./does-not-exist       not found
  src/broken.ts         @app/security/secret   tsconfig path miss
  src/broken.ts         ./models               extension miss
  src/routes/posts.ts   <expression>           dynamic expression
```

That 80% is the honest number: three real misses and one dynamic `import()` that cannot be
statically known. codeGraph shows them rather than rounding up.

---

## The web app

```bash
npm run analyze:sample   # generate apps/web/public/codegraph.sample.json
npm run web              # Vite dev server — interactive graph, blast radius, coverage
```

The web app imports `@core` (the same types + graph algorithms the CLI and Action use) and
renders the JSON document. In dev, `GET /api/analyze?root=…` runs the real analyzer live.

- Nodes are colored by **file health** (coverage); size is **fan-in**.
- Click a node to trace its **blast radius**; the dependency chain highlights.
- Unresolved imports are drawn as **quiet dashed stubs** — "we don't know" is never styled like "it's broken".
- The **resolution gauge** is always on screen.

---

## CLI

```
codegraph [root] [options]

  -o, --out <file>          write the JSON document
  -c, --coverage <lcov>     ingest an lcov.info for coverage/health
      --no-git              skip git history (ownership, staleness, coupling)
      --blast <file-id>     print the blast radius for one file
      --min-resolution <n>  exit non-zero if resolution rate < n percent
      --json                print the full document to stdout
```

---

## GitHub Action

```yaml
# .github/workflows/codegraph.yml
name: codeGraph
on: [push, pull_request]
jobs:
  graph:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/codegraph@v1
        with:
          path: .
          coverage: coverage/lcov.info   # optional
          min-resolution: "85"           # optional CI gate
```

The Action runs the same analyzer, writes an honest job summary (resolution rate front and
center, largest blast radii, every unresolved import with its reason), exposes outputs
(`resolution-rate`, `unresolved`, `modules`, `document`), and can fail the check when
resolution drops below a floor.

---

## The one document

Everything renders from a single JSON document (`src/core/types.ts`):

```ts
interface CodeGraphDocument {
  files: FileNode[];              // id, coverage, grade, fanIn/out, owner, staleness…
  edges: ImportEdge[];            // resolved imports (from → to, kind, typeOnly)
  unresolved: UnresolvedImport[]; // every miss, with a reason
  external: ExternalImport[];     // packages & builtins (out of scope, tracked)
  resolution: ResolutionStats;    // the honest rate
  coverage: CoverageSummary | null;
  git: GitSummary | null;         // ownership + change coupling
  warnings: string[];
}
```

---

## Architecture

```
src/core/        browser-safe: the document contract + pure graph algorithms
src/analyzer/    Node: parser (tsc API), resolver, coverage (lcov), git, analyze()
src/cli/         the CLI surface
src/action/      the GitHub Action entry point
apps/web/        Vite + React app (imports @core, renders the document)
fixtures/        a sample project with intentional unresolved imports
test/            fixture-driven tests (every resolver behaviour is pinned)
```

**Constraints (kept on purpose):** the analyzer is a pure library with no DOM and no network;
parsing uses the TypeScript compiler API, never regex; the analyzer emits one JSON document
and every consumer renders from that and nothing else.

## Scope

**In:** TypeScript/JavaScript (`.ts .tsx .js .jsx .mjs .cjs`), ESM & CommonJS, `tsconfig`
`paths`/`baseUrl`, barrels and re-export chains, git history, lcov coverage.

**Out (do not add):** other languages, security scanning, design-pattern detection, runtime
tracing, an actual type checker.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run build       # tsup -> dist/ (core, analyzer, cli, action)
npm run web:build   # vite build -> apps/web/dist
```

## License

MIT

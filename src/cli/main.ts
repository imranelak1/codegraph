#!/usr/bin/env node
/**
 * codegraph CLI.
 *
 *   codegraph [root] [options]
 *
 * Prints an honest summary — the real resolution rate, the unresolved imports
 * (with reasons), and the riskiest blast radii — and can emit the one JSON
 * document that the web app and the Action render from.
 */

import { writeFileSync } from "node:fs";
import { relative } from "node:path";
import { analyze } from "../analyzer/analyze";
import { version as VERSION } from "../analyzer/meta";
import { buildIndex, blastStats } from "../core/graph";
import type { CodeGraphDocument, UnresolvedReason } from "../core/types";
import { color, pct, bar, table } from "./format";
import { serve } from "./serve";

interface Cli {
  root: string;
  out: string | null;
  coverage: string | null;
  git: boolean;
  pretty: boolean;
  json: boolean;
  blast: string | null;
  minResolution: number | null;
  top: number;
}

function parseArgs(argv: string[]): Cli | { help: true } | { version: true } {
  const cli: Cli = {
    root: ".",
    out: null,
    coverage: null,
    git: true,
    pretty: false,
    json: false,
    blast: null,
    minResolution: null,
    top: 8,
  };
  let sawRoot = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "-h":
      case "--help":
        return { help: true };
      case "-v":
      case "--version":
        return { version: true };
      case "--out":
      case "-o":
        cli.out = argv[++i] ?? null;
        break;
      case "--coverage":
      case "-c":
        cli.coverage = argv[++i] ?? null;
        break;
      case "--no-git":
        cli.git = false;
        break;
      case "--pretty":
        cli.pretty = true;
        break;
      case "--json":
        cli.json = true;
        break;
      case "--blast":
        cli.blast = argv[++i] ?? null;
        break;
      case "--min-resolution":
        cli.minResolution = Number(argv[++i]);
        break;
      case "--top":
        cli.top = Number(argv[++i] ?? 8) || 8;
        break;
      default:
        if (!a.startsWith("-") && !sawRoot) {
          cli.root = a;
          sawRoot = true;
        }
    }
  }
  return cli;
}

const HELP = `codegraph v${VERSION} — an honest dependency graph for TS/JS

USAGE
  codegraph [root] [options]

OPTIONS
  -o, --out <file>          write the JSON document to <file>
  -c, --coverage <lcov>     ingest an lcov.info for coverage/health
      --no-git              skip git history (ownership, staleness, coupling)
      --blast <file-id>     print the blast radius for one file and exit
      --min-resolution <n>  exit non-zero if resolution rate < n percent
      --top <n>             how many rows in each ranked list (default 8)
      --pretty              pretty-print the JSON output
      --json                print the full document to stdout
  -h, --help                show this help
  -v, --version             print version

COMMANDS
  codegraph serve [root]    open the local app (UI + live analyzer) in the browser

EXAMPLES
  codegraph .                          summarise the current project
  codegraph src --coverage lcov.info   include coverage & health
  codegraph . --blast src/core/types.ts
  codegraph . --out codegraph.json --pretty
  codegraph serve .                    run the app locally on this repo`;

const SERVE_HELP = `codegraph serve [root] [options] — the local app (UI + live analyzer)

OPTIONS
      --port <n>        port to listen on (default 4300)
  -c, --coverage <lcov> ingest an lcov.info for the initial view
      --no-git          skip git history
      --no-open         don't open the browser automatically
  -h, --help            show this help`;

function runServe(argv: string[]): void {
  let root = ".";
  let port = 4300;
  let coverage: string | null = null;
  let open = true;
  let git = true;
  let sawRoot = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      console.log(SERVE_HELP);
      return;
    } else if (a === "--port") {
      port = Number(argv[++i]) || port;
    } else if (a === "--coverage" || a === "-c") {
      coverage = argv[++i] ?? null;
    } else if (a === "--no-git") {
      git = false;
    } else if (a === "--no-open") {
      open = false;
    } else if (!a.startsWith("-") && !sawRoot) {
      root = a;
      sawRoot = true;
    }
  }
  serve({ root, port, coverage, open, git });
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv[0] === "serve") {
    runServe(argv.slice(1));
    return;
  }

  const parsed = parseArgs(argv);
  if ("help" in parsed) {
    console.log(HELP);
    return;
  }
  if ("version" in parsed) {
    console.log(VERSION);
    return;
  }
  const cli = parsed;

  const doc = analyze({ root: cli.root, coveragePath: cli.coverage, git: cli.git });

  if (cli.json) {
    process.stdout.write(JSON.stringify(doc, null, cli.pretty ? 2 : 0) + "\n");
    return;
  }

  if (cli.out) {
    writeFileSync(cli.out, JSON.stringify(doc, null, cli.pretty ? 2 : 0));
  }

  if (cli.blast) {
    printBlast(doc, cli.blast);
  } else {
    printSummary(doc, cli);
  }

  if (cli.out) {
    console.log(color.dim(`\nwrote ${relative(process.cwd(), cli.out) || cli.out}`));
  }

  if (cli.minResolution !== null) {
    const rate = doc.resolution.rate * 100;
    if (rate < cli.minResolution) {
      console.error(
        color.red(
          `\nresolution ${rate.toFixed(1)}% is below the required ${cli.minResolution}%`,
        ),
      );
      process.exit(1);
    }
  }
}

const REASON_LABEL: Record<UnresolvedReason, string> = {
  "module-not-found": "not found",
  "dynamic-expression": "dynamic expression",
  "unmatched-tsconfig-path": "tsconfig path miss",
  "baseurl-miss": "baseUrl miss",
  "workspace-miss": "workspace miss",
  "extension-miss": "extension miss",
  excluded: "outside root",
  "parse-error": "parse error",
};

function printSummary(doc: CodeGraphDocument, cli: Cli): void {
  const r = doc.resolution;
  const rate = r.rate * 100;
  const rateColor = rate >= 95 ? color.green : rate >= 80 ? color.yellow : color.red;

  console.log(color.bold(`\ncodegraph  ${color.dim("·")}  ${doc.files.length} modules`));
  console.log(
    `${bar(r.rate, 24)}  ${rateColor(`${rate.toFixed(1)}%`)} resolved   ` +
      color.dim(`${r.resolved}/${r.internalImports} internal imports · ${r.external} external`),
  );
  if (r.unresolved > 0) {
    console.log(color.dim(`${r.unresolved} unresolved — shown below, never dropped`));
  }

  if (doc.coverage) {
    const cv = doc.coverage.lineRate * 100;
    console.log(
      color.dim(
        `coverage ${cv.toFixed(1)}% (${doc.coverage.filesWithCoverage}/${
          doc.coverage.filesWithCoverage + doc.coverage.filesWithoutCoverage
        } files) from ${doc.coverage.source}`,
      ),
    );
  }

  // Riskiest blast radii: high fan-in + dark
  const index = buildIndex(doc);
  const ranked = doc.files
    .map((f) => ({ f, s: blastStats(doc, index, f.id) }))
    .filter((x) => x.s.affectedCount > 0)
    .sort((a, b) => b.s.affectedCount - a.s.affectedCount || b.s.darkPct - a.s.darkPct)
    .slice(0, cli.top);

  if (ranked.length) {
    console.log(color.bold("\nlargest blast radius"));
    console.log(
      table(
        ["file", "affected", "dark", "cov"],
        ranked.map((x) => [
          x.f.id,
          String(x.s.affectedCount),
          `${Math.round(x.s.darkPct * 100)}%`,
          x.f.coverage === null ? color.dim("—") : `${Math.round(x.f.coverage)}%`,
        ]),
      ),
    );
  }

  if (doc.unresolved.length) {
    console.log(color.bold("\nunresolved imports"));
    console.log(
      table(
        ["from", "specifier", "reason"],
        doc.unresolved
          .slice(0, cli.top)
          .map((u) => [u.from, u.specifier, color.yellow(REASON_LABEL[u.reason])]),
      ),
    );
    if (doc.unresolved.length > cli.top) {
      console.log(color.dim(`  … and ${doc.unresolved.length - cli.top} more`));
    }
  }

  for (const w of doc.warnings) console.log(color.dim(`! ${w}`));
}

function printBlast(doc: CodeGraphDocument, id: string): void {
  const node = doc.files.find((f) => f.id === id);
  if (!node) {
    console.error(color.red(`no such file in the graph: ${id}`));
    process.exit(2);
  }
  const index = buildIndex(doc);
  const s = blastStats(doc, index, id);
  console.log(color.bold(`\nblast radius · ${id}`));
  console.log(
    `${color.red(String(s.affectedCount))} files affected   ` +
      `${color.red(`${Math.round(s.darkPct * 100)}%`)} in the dark   ` +
      color.dim(`deepest ${s.deepest ?? "—"} at ${s.maxDepth} hops`),
  );
  const rows = index.in
    .get(id)!
    .map((depId) => doc.files.find((f) => f.id === depId))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));
  if (rows.length) {
    console.log(color.bold("\ndirect dependents"));
    console.log(
      table(
        ["file", "coverage"],
        rows.map((f) => [f.id, f.coverage === null ? color.dim("unknown") : `${Math.round(f.coverage)}%`]),
      ),
    );
  }
}

main();

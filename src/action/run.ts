/**
 * GitHub Action entry point.
 *
 * Runs the same analyzer as the CLI and the web app, writes the JSON document,
 * renders an honest job summary (resolution rate front and centre), exposes
 * outputs, and optionally fails the check when resolution drops below a floor.
 */

import { writeFileSync, appendFileSync } from "node:fs";
import { analyze } from "../analyzer/analyze";
import { version as VERSION } from "../analyzer/meta";
import { buildIndex, blastStats } from "../core/graph";
import type { CodeGraphDocument } from "../core/types";

function input(name: string, fallback = ""): string {
  const v = process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`];
  return (v ?? fallback).trim();
}

function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
  else console.log(`::set-output name=${name}::${value}`);
}

function summary(md: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, md + "\n");
  else process.stdout.write(md + "\n");
}

function run(): void {
  const root = input("path", ".") || ".";
  const coverage = input("coverage") || null;
  const outFile = input("out", "codegraph.json") || "codegraph.json";
  const minResolutionRaw = input("min-resolution");
  const minResolution = minResolutionRaw ? Number(minResolutionRaw) : null;

  const doc = analyze({ root, coveragePath: coverage, git: true });
  writeFileSync(outFile, JSON.stringify(doc, null, 2));

  const r = doc.resolution;
  const ratePct = r.rate * 100;

  setOutput("modules", String(doc.files.length));
  setOutput("resolution-rate", ratePct.toFixed(1));
  setOutput("resolved", String(r.resolved));
  setOutput("unresolved", String(r.unresolved));
  setOutput("document", outFile);

  summary(renderMarkdown(doc));

  console.log(
    `codegraph: ${doc.files.length} modules · ${ratePct.toFixed(1)}% resolved · ${r.unresolved} unresolved`,
  );

  if (minResolution !== null && ratePct < minResolution) {
    console.error(
      `::error::codegraph resolution ${ratePct.toFixed(1)}% is below the required ${minResolution}%`,
    );
    process.exit(1);
  }
}

function renderMarkdown(doc: CodeGraphDocument): string {
  const r = doc.resolution;
  const ratePct = r.rate * 100;
  const badge = ratePct >= 95 ? "🟢" : ratePct >= 80 ? "🟡" : "🔴";
  const index = buildIndex(doc);

  const ranked = doc.files
    .map((f) => ({ f, s: blastStats(doc, index, f.id) }))
    .filter((x) => x.s.affectedCount > 0)
    .sort((a, b) => b.s.affectedCount - a.s.affectedCount || b.s.darkPct - a.s.darkPct)
    .slice(0, 10);

  const lines: string[] = [];
  lines.push(`## codeGraph — v${VERSION}`);
  lines.push("");
  lines.push(`${badge} **${ratePct.toFixed(1)}%** of internal imports resolved`);
  lines.push("");
  lines.push("| metric | value |");
  lines.push("| --- | ---: |");
  lines.push(`| modules | ${doc.files.length} |`);
  lines.push(`| internal imports | ${r.internalImports} |`);
  lines.push(`| resolved | ${r.resolved} |`);
  lines.push(`| **unresolved** | **${r.unresolved}** |`);
  lines.push(`| external | ${r.external} |`);
  if (doc.coverage) {
    lines.push(`| line coverage | ${(doc.coverage.lineRate * 100).toFixed(1)}% |`);
  }
  lines.push("");

  if (ranked.length) {
    lines.push("### Largest blast radius");
    lines.push("");
    lines.push("| file | affected | in the dark | coverage |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const { f, s } of ranked) {
      const cov = f.coverage === null ? "—" : `${Math.round(f.coverage)}%`;
      lines.push(`| \`${f.id}\` | ${s.affectedCount} | ${Math.round(s.darkPct * 100)}% | ${cov} |`);
    }
    lines.push("");
  }

  if (doc.unresolved.length) {
    lines.push(`### Unresolved imports (${doc.unresolved.length})`);
    lines.push("");
    lines.push("These are printed, never dropped — the graph stays honest.");
    lines.push("");
    lines.push("| from | specifier | reason |");
    lines.push("| --- | --- | --- |");
    for (const u of doc.unresolved.slice(0, 20)) {
      lines.push(`| \`${u.from}\` | \`${u.specifier}\` | ${u.reason} |`);
    }
    if (doc.unresolved.length > 20) {
      lines.push(`| … | … | ${doc.unresolved.length - 20} more |`);
    }
    lines.push("");
  }

  for (const w of doc.warnings) lines.push(`> ⚠️ ${w}`);
  return lines.join("\n");
}

run();

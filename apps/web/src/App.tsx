import { useMemo, useState, useEffect } from "react";
import {
  buildIndex,
  blastStats,
  gradeCoverage,
  type CodeGraphDocument,
  type HealthStatus,
} from "@core";
import { useDocument } from "./lib/useDocument";
import { GraphCanvas } from "./components/GraphCanvas";
import "./theme.css";
import "./app.css";

const STATUS_LABEL: Record<HealthStatus, string> = {
  good: "Well tested",
  warn: "Partial",
  crit: "Untested",
  unknown: "Unknown",
};

export default function App() {
  const state = useDocument();
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  if (state.status === "loading") {
    return (
      <div className="center-state">
        <div className="box">
          <h2>Reading the graph…</h2>
          <p className="mono">loading the document</p>
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="center-state">
        <div className="box">
          <h2>No document yet</h2>
          <p>
            {state.message.split("npm run")[0]}
            <br />
            <code>npm run analyze:sample</code>
          </p>
        </div>
      </div>
    );
  }

  return <Explorer doc={state.doc} source={state.source} theme={theme} setTheme={setTheme} />;
}

function Explorer({
  doc,
  source,
  theme,
  setTheme,
}: {
  doc: CodeGraphDocument;
  source: string;
  theme: "light" | "dark" | null;
  setTheme: (t: "light" | "dark") => void;
}) {
  const index = useMemo(() => buildIndex(doc), [doc]);

  // Default selection: the file with the largest blast radius (most at stake).
  const defaultId = useMemo(() => {
    let best: string | null = null;
    let bestN = -1;
    for (const f of doc.files) {
      const n = blastStats(doc, index, f.id).affectedCount;
      if (n > bestN) {
        bestN = n;
        best = f.id;
      }
    }
    return best ?? doc.files[0]?.id ?? null;
  }, [doc, index]);

  const [selectedId, setSelectedId] = useState<string | null>(defaultId);
  useEffect(() => setSelectedId(defaultId), [defaultId]);

  const counts = useMemo(() => {
    const c = { good: 0, warn: 0, crit: 0, unknown: 0 };
    for (const f of doc.files) c[f.status]++;
    return c;
  }, [doc]);

  const topBlast = useMemo(
    () =>
      doc.files
        .map((f) => {
          const s = blastStats(doc, index, f.id);
          return { id: f.id, status: f.status, n: s.affectedCount, darkPct: s.darkPct };
        })
        .filter((x) => x.n > 0)
        // Same ordering as the CLI and Action: affected count, then how much is dark.
        .sort((a, b) => b.n - a.n || b.darkPct - a.darkPct)
        .slice(0, 8),
    [doc, index],
  );

  const r = doc.resolution;
  const ratePct = r.rate * 100;
  const isDark = theme
    ? theme === "dark"
    : typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">
          <Glyph />
          <b>codeGraph</b>
          <span className="mono">/ {doc.files.length} modules</span>
        </span>
        <div className="header-gauge">
          <span className="header-src mono">{source}</span>
          <ResolutionGauge doc={doc} />
          <button className="tog" onClick={() => setTheme(isDark ? "light" : "dark")}>
            {isDark ? "☾ Dark" : "☀ Light"}
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="rail">
          <div className="grp">
            <h4>Color by health</h4>
            <LegendRow color="var(--st-good)" label={STATUS_LABEL.good} n={counts.good} />
            <LegendRow color="var(--st-warn)" label={STATUS_LABEL.warn} n={counts.warn} />
            <LegendRow color="var(--st-crit)" label={STATUS_LABEL.crit} n={counts.crit} />
            <LegendRow color="var(--ghost)" hollow label={STATUS_LABEL.unknown} n={counts.unknown} />
          </div>
          <div className="grp">
            <h4>Largest blast radius</h4>
            <div className="rail-list">
              {topBlast.map((b) => (
                <div
                  key={b.id}
                  className={"rail-item" + (b.id === selectedId ? " on" : "")}
                  onClick={() => setSelectedId(b.id)}
                  title={b.id}
                >
                  <span className="dot" style={{ background: statusColor(b.status) }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{baseName(b.id)}</span>
                  <span className="b">{b.n}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <GraphCanvas doc={doc} selectedId={selectedId} onSelect={setSelectedId} />

        <Inspector doc={doc} index={index} selectedId={selectedId} />
      </div>

      <footer className="statusbar">
        <div style={{ flex: 1, minWidth: 220 }}>
          <ResolutionGauge doc={doc} withCounts />
        </div>
        <span className="sb-item">
          imports <b>{r.internalImports}</b>
        </span>
        <span className="sb-item">
          external <b>{r.external}</b>
        </span>
        {doc.coverage && (
          <span className="sb-item">
            coverage <b>{(doc.coverage.lineRate * 100).toFixed(0)}%</b>
          </span>
        )}
        {doc.warnings.length > 0 && (
          <span className="sb-item" title={doc.warnings.join("\n")}>
            ⚠ {doc.warnings.length} warnings
          </span>
        )}
      </footer>
    </div>
  );
}

function ResolutionGauge({ doc, withCounts = false }: { doc: CodeGraphDocument; withCounts?: boolean }) {
  const r = doc.resolution;
  const ratePct = r.rate * 100;
  const resW = ratePct;
  const unrW = 100 - ratePct;
  return (
    <div className="gauge">
      <div className="track">
        <i className="res" style={{ width: `${resW}%` }} />
        <i className="unr" style={{ width: `${unrW}%` }} />
      </div>
      <span className="lab">
        <b>{ratePct.toFixed(1)}%</b> resolved
        {withCounts && (
          <>
            {" "}
            · <b>{r.unresolved}</b> unresolved
          </>
        )}
      </span>
    </div>
  );
}

function Inspector({
  doc,
  index,
  selectedId,
}: {
  doc: CodeGraphDocument;
  index: ReturnType<typeof buildIndex>;
  selectedId: string | null;
}) {
  const node = selectedId ? doc.files.find((f) => f.id === selectedId) ?? null : null;
  if (!node) {
    return (
      <aside className="inspector">
        <h4>Inspector</h4>
        <p className="mono" style={{ color: "var(--ink-3)", fontSize: "0.8rem" }}>
          select a node
        </p>
      </aside>
    );
  }
  const stats = blastStats(doc, index, node.id);
  const health = gradeCoverage(node.coverage);
  const unresolved = doc.unresolved.filter((u) => u.from === node.id);
  const darkPct = Math.round(stats.darkPct * 100);

  return (
    <aside className="inspector">
      <h4>Inspector</h4>
      <div className="insp-path">{baseName(node.id)}</div>
      <div className="insp-dir">{dirName(node.id) || "./"}</div>

      <span className={"grade " + health.status}>
        {health.grade} · {health.label}
      </span>

      <div className="cov-bar">
        <i
          style={{
            width: `${node.coverage ?? 0}%`,
            background: statusColor(node.status),
          }}
        />
      </div>
      <div className="metric">
        <span>Line coverage</span>
        <b>{node.coverage === null ? "unknown" : `${Math.round(node.coverage)}%`}</b>
      </div>
      <div className="metric">
        <span>Fan-in / fan-out</span>
        <b>
          {node.fanIn} / {node.fanOut}
        </b>
      </div>
      <div className="metric">
        <span>Blast radius</span>
        <b>{stats.affectedCount} files</b>
      </div>

      <div className="blast-note">
        Changing <b className="mono">{baseName(node.id)}</b> reaches{" "}
        <b>{stats.affectedCount}</b> file{stats.affectedCount === 1 ? "" : "s"}.{" "}
        {stats.affectedCount > 0 && (
          <>
            <b className="crit">{darkPct}%</b> of them are in the dark
            {stats.deepest && (
              <>
                {" "}
                — deepest <b className="mono">{baseName(stats.deepest)}</b> at {stats.maxDepth} hops
              </>
            )}
            .
          </>
        )}
      </div>

      {unresolved.length > 0 && (
        <>
          <h4 style={{ marginTop: 18 }}>Unresolved · shown</h4>
          <div className="unresolved-list">
            {unresolved.map((u, i) => (
              <div className="u" key={i}>
                <span className="d">⇢</span>
                <span>{u.specifier}</span>
                <span className="r">{u.reason}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {node.owner && (
        <>
          <h4 style={{ marginTop: 18 }}>Ownership · git</h4>
          <div className="own">
            <span className="avatar">{initials(node.owner)}</span>
            <div>
              <div style={{ fontSize: "0.86rem" }}>{node.owner}</div>
              <div className="mono" style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>
                {node.staleDays === null ? "" : `last touched ${node.staleDays}d ago`}
              </div>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function LegendRow({ color, label, n, hollow = false }: { color: string; label: string; n: number; hollow?: boolean }) {
  return (
    <div className="legend-row">
      <span
        className="swatch"
        style={hollow ? { background: "transparent", border: `1.5px solid ${color}` } : { background: color }}
      />
      {label}
      <span className="n">{n}</span>
    </div>
  );
}

function Glyph() {
  return (
    <svg className="glyph" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <line x1="9" y1="9" x2="16" y2="16" stroke="var(--accent)" strokeWidth="1.6" />
      <line x1="23" y1="8" x2="16" y2="16" stroke="var(--accent)" strokeWidth="1.6" />
      <line x1="16" y1="16" x2="11" y2="24" stroke="var(--accent)" strokeWidth="1.6" />
      <line x1="16" y1="16" x2="24" y2="23" stroke="var(--ghost)" strokeWidth="1.6" strokeDasharray="2.4 2.6" />
      <circle cx="9" cy="9" r="3.4" fill="var(--st-good)" />
      <circle cx="23" cy="8" r="3.4" fill="var(--st-warn)" />
      <circle cx="16" cy="16" r="4" fill="var(--accent)" />
      <circle cx="11" cy="24" r="3.4" fill="var(--st-crit)" />
      <circle cx="24" cy="23" r="2.6" fill="none" stroke="var(--ghost)" strokeWidth="1.5" />
    </svg>
  );
}

function statusColor(s: HealthStatus): string {
  return s === "good"
    ? "var(--st-good)"
    : s === "warn"
      ? "var(--st-warn)"
      : s === "crit"
        ? "var(--st-crit)"
        : "var(--ghost)";
}
function baseName(id: string): string {
  const i = id.lastIndexOf("/");
  return i >= 0 ? id.slice(i + 1) : id;
}
function dirName(id: string): string {
  const i = id.lastIndexOf("/");
  return i >= 0 ? id.slice(0, i + 1) : "";
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

import { useEffect, useRef } from "react";
import {
  buildIndex,
  blastRadius,
  type CodeGraphDocument,
  type HealthStatus,
} from "@core";

interface SimNode {
  id: string;
  label: string;
  dir: string;
  ghost: boolean;
  reason: string;
  status: HealthStatus;
  coverage: number | null;
  fanIn: number;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimEdge {
  from: string;
  to: string;
  ghost: boolean;
}

interface Props {
  doc: CodeGraphDocument;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function baseName(id: string): string {
  const i = id.lastIndexOf("/");
  return i >= 0 ? id.slice(i + 1) : id;
}
function dirName(id: string): string {
  const i = id.lastIndexOf("/");
  return i >= 0 ? id.slice(0, i + 1) : "";
}

export function GraphCanvas({ doc, selectedId, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const tip = tipRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const DPR = Math.min(2, window.devicePixelRatio || 1);

    // ---- build sim graph from the document ----
    const nodes: SimNode[] = doc.files.map((f) => ({
      id: f.id,
      label: baseName(f.id),
      dir: dirName(f.id),
      ghost: false,
      reason: "",
      status: f.status,
      coverage: f.coverage,
      fanIn: f.fanIn,
      r: 8 + Math.min(9, f.fanIn * 1.5),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    }));
    const edges: SimEdge[] = doc.edges.map((e) => ({ from: e.from, to: e.to, ghost: false }));

    // ghost stubs for unresolved imports (honesty: draw what we couldn't follow)
    doc.unresolved.forEach((u, i) => {
      const gid = `∅${i}:${u.from}`;
      nodes.push({
        id: gid,
        label: u.specifier,
        dir: "",
        ghost: true,
        reason: u.reason,
        status: "unknown",
        coverage: null,
        fanIn: 0,
        r: 5,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      });
      edges.push({ from: u.from, to: gid, ghost: true });
    });

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const index = buildIndex(doc);

    nodes.forEach((n, i) => {
      const ang = i * 2.399963;
      const rad = 26 + i * 6;
      n.x = Math.cos(ang) * rad;
      n.y = Math.sin(ang) * rad;
    });

    let W = 0;
    let H = 0;
    let alpha = 1;
    let hovered: SimNode | null = null;
    let dragging: SimNode | null = null;

    const colors = {
      good: "",
      warn: "",
      crit: "",
      ghost: "",
      accent: "",
      ink3: "",
      hairline: "",
      surface: "",
      ink2: "",
    };
    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      colors.good = cs.getPropertyValue("--st-good").trim();
      colors.warn = cs.getPropertyValue("--st-warn").trim();
      colors.crit = cs.getPropertyValue("--st-crit").trim();
      colors.ghost = cs.getPropertyValue("--ghost").trim();
      colors.accent = cs.getPropertyValue("--accent").trim();
      colors.ink3 = cs.getPropertyValue("--ink-3").trim();
      colors.hairline = cs.getPropertyValue("--hairline").trim();
      colors.surface = cs.getPropertyValue("--surface").trim();
      colors.ink2 = cs.getPropertyValue("--ink-2").trim();
    };
    const nodeColor = (n: SimNode): string =>
      n.status === "good" ? colors.good : n.status === "warn" ? colors.warn : n.status === "crit" ? colors.crit : colors.ghost;

    const T = (n: SimNode) => ({ x: W / 2 + n.x, y: H / 2 + n.y });

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      W = rect.width;
      H = Math.max(320, rect.height);
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      alpha = Math.max(alpha, 0.5);
    };

    // Layout is scaled to the canvas so the graph fills it instead of clustering
    // in a small central blob. All lengths tie to S = min(W,H) (relative to a
    // reference canvas REF), and are normalized by node count N so density — and
    // therefore the settled cloud radius, which scales as (rep·N/centering)^(1/3) —
    // stays ∝ S regardless of how many files the document has. Centering is left
    // constant on purpose: strengthening it packs nodes tighter and provokes the
    // 1/d² repulsion singularity. SPREAD controls how much of the canvas is used.
    const REF = 720;
    const NREF = 18;
    const SPREAD = 1.5;
    const step = () => {
      const S = Math.min(W, H) || REF;
      const sc = S / REF;
      const nScale = NREF / nodes.length; // NREF/N density normalization
      const repFull = sc * sc * sc * nScale * SPREAD;
      const repNormal = 2400 * repFull;
      const repGhost = 800 * repFull;
      const restScale = sc * Math.sqrt(nScale);
      const restNormal = 74 * restScale;
      const restGhost = 42 * restScale;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const d = Math.sqrt(d2);
          // Clamp the separation used for the 1/d² term to the sum of radii so
          // overlapping nodes can't produce an unbounded impulse (keeps the sim
          // stable on small/thin canvases). Direction still uses the true d.
          const dMin = a.r + b.r;
          const dRep = d < dMin ? dMin : d;
          const rep = (a.ghost || b.ghost ? repGhost : repNormal) / (dRep * dRep);
          const fx = (dx / d) * rep;
          const fy = (dy / d) * rep;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      for (const e of edges) {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const rest = e.ghost ? restGhost : restNormal;
        const k = e.ghost ? 0.006 : 0.012;
        const f = (d - rest) * k;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      for (const n of nodes) {
        n.vx += (0 - n.x) * 0.0016;
        n.vy += (0 - n.y) * 0.0016;
        if (n === dragging) continue;
        n.vx *= 0.86; n.vy *= 0.86;
        n.x += n.vx * alpha; n.y += n.vy * alpha;
      }
      alpha *= 0.985;
      if (alpha < 0.02) alpha = 0.02;
    };

    const arrow = (ax: number, ay: number, bx: number, by: number, rB: number, col: string, al: number) => {
      const dx = bx - ax, dy = by - ay, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const ux = dx / d, uy = dy / d;
      const tx = bx - ux * (rB + 3), ty = by - uy * (rB + 3);
      ctx.globalAlpha = al;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - ux * 6 - uy * 3.2, ty - uy * 6 + ux * 3.2);
      ctx.lineTo(tx - ux * 6 + uy * 3.2, ty - uy * 6 - ux * 3.2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    const draw = () => {
      if (!W) return;
      ctx.clearRect(0, 0, W, H);
      const sel = selectedRef.current;
      const blast = sel ? blastRadius(index, sel) : null;
      const inBlast = (id: string) => (blast ? blast.depth.has(id) : false);

      for (const e of edges) {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) continue;
        const pa = T(a), pb = T(b);
        const hi = sel && !e.ghost && inBlast(e.from) && (e.to === sel || inBlast(e.to));
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        if (e.ghost) {
          ctx.setLineDash([4, 4]); ctx.strokeStyle = colors.ghost; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.9;
        } else if (hi) {
          ctx.setLineDash([]); ctx.strokeStyle = colors.accent; ctx.lineWidth = 2.4; ctx.globalAlpha = 1;
        } else {
          ctx.setLineDash([]); ctx.strokeStyle = colors.hairline; ctx.lineWidth = 1.3; ctx.globalAlpha = sel ? 0.5 : 0.9;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        if (!e.ghost) arrow(pa.x, pa.y, pb.x, pb.y, b.r, hi ? colors.accent : colors.hairline, hi ? 1 : 0.7);
      }

      for (const n of nodes) {
        const p = T(n);
        const dim = sel && !n.ghost && n.id !== sel && !inBlast(n.id);
        ctx.globalAlpha = dim ? 0.32 : 1;
        if (n.ghost) {
          ctx.beginPath(); ctx.arc(p.x, p.y, n.r, 0, 7);
          ctx.setLineDash([2.6, 2.6]); ctx.strokeStyle = colors.ghost; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        } else {
          if (n.id === sel) {
            ctx.beginPath(); ctx.arc(p.x, p.y, n.r + 5, 0, 7);
            ctx.fillStyle = colors.accent; ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1;
          }
          ctx.beginPath(); ctx.arc(p.x, p.y, n.r, 0, 7);
          ctx.fillStyle = nodeColor(n); ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = colors.surface; ctx.stroke();
          if (n.id === sel) {
            ctx.lineWidth = 2; ctx.strokeStyle = colors.accent;
            ctx.beginPath(); ctx.arc(p.x, p.y, n.r + 2.5, 0, 7); ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        const labelled = !n.ghost && (n.r >= 12 || n.id === sel || n === hovered || inBlast(n.id));
        if (labelled) {
          ctx.font = "600 10px ui-monospace, Consolas, monospace";
          ctx.fillStyle = dim ? colors.ink3 : colors.ink2;
          ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.globalAlpha = dim ? 0.5 : 1;
          ctx.fillText(n.label, p.x, p.y + n.r + 3);
          ctx.globalAlpha = 1;
        } else if (n.ghost && n === hovered) {
          ctx.font = "10px ui-monospace, Consolas, monospace";
          ctx.fillStyle = colors.ghost; ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillText(n.label, p.x, p.y + n.r + 3);
        }
      }
    };

    const nodeAt = (mx: number, my: number): SimNode | null => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]!;
        const p = T(n);
        const dx = mx - p.x, dy = my - p.y;
        if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) return n;
      }
      return null;
    };
    const rel = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };

    const onMove = (ev: MouseEvent) => {
      const m = rel(ev);
      if (dragging) {
        dragging.x = m.x - W / 2; dragging.y = m.y - H / 2; dragging.vx = 0; dragging.vy = 0;
        alpha = Math.max(alpha, 0.35);
        if (reduce) draw();
        return;
      }
      const n = nodeAt(m.x, m.y);
      hovered = n;
      canvas.style.cursor = n ? "pointer" : "default";
      if (n) {
        tip.style.left = m.x + "px";
        tip.style.top = m.y - n.r + "px";
        tip.style.opacity = "1";
        tip.innerHTML = n.ghost
          ? `<div class="tp">${escapeHtml(n.label)}</div><div class="tr"><span>unresolved</span><b>${n.reason}</b></div>`
          : `<div class="tp">${escapeHtml(n.dir + n.label)}</div>` +
            `<div class="tr"><span>coverage</span><b style="color:${coverageColor(n.status)}">${n.coverage === null ? "unknown" : Math.round(n.coverage) + "%"}</b></div>` +
            `<div class="tr"><span>fan-in</span><b>${n.fanIn}</b></div>`;
      } else {
        tip.style.opacity = "0";
      }
      if (reduce) draw();
    };
    const onLeave = () => { hovered = null; tip.style.opacity = "0"; };
    const onDown = (ev: MouseEvent) => {
      const m = rel(ev);
      const n = nodeAt(m.x, m.y);
      if (n) { dragging = n; canvas.style.cursor = "grabbing"; }
    };
    const onUp = () => { if (dragging) { dragging = null; canvas.style.cursor = "pointer"; } };
    const onClick = (ev: MouseEvent) => {
      const m = rel(ev);
      const n = nodeAt(m.x, m.y);
      if (n && !n.ghost) { onSelectRef.current(n.id); alpha = Math.max(alpha, 0.2); if (reduce) draw(); }
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("click", onClick);

    const themeObserver = new MutationObserver(() => { readColors(); draw(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => { readColors(); draw(); };
    mq.addEventListener("change", onScheme);

    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(wrap);

    let raf = 0;
    const frame = () => { if (!reduce) step(); draw(); raf = requestAnimationFrame(frame); };

    readColors();
    resize();
    if (reduce) {
      for (let k = 0; k < 240; k++) step();
      draw();
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("click", onClick);
      themeObserver.disconnect();
      mq.removeEventListener("change", onScheme);
      ro.disconnect();
    };
  }, [doc]);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
      <div className="canvas-hint">drag nodes · click to trace blast radius</div>
      <div className="graph-tip" ref={tipRef} />
    </div>
  );
}

function coverageColor(s: HealthStatus): string {
  // Unknown coverage reads as ghost/muted — never tinted with a health hue that
  // would imply confidence the data can't back.
  return s === "unknown" ? "var(--ink-3)" : `var(--st-${s})`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

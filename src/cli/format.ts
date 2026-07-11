/** Tiny zero-dependency terminal formatting. Honors NO_COLOR. */

const enabled = !process.env.NO_COLOR && process.stdout.isTTY !== false;

function wrap(code: number): (s: string) => string {
  return (s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export const color = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  cyan: wrap(36),
};

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** A unicode meter, filled proportionally to `rate` (0..1). */
export function bar(rate: number, width: number): string {
  const clamped = Math.max(0, Math.min(1, rate));
  const filled = Math.round(clamped * width);
  const on = "█".repeat(filled);
  const off = "░".repeat(width - filled);
  const paint = clamped >= 0.95 ? color.green : clamped >= 0.8 ? color.yellow : color.red;
  return paint(on) + color.dim(off);
}

/** Left-aligned columns; strips ANSI when measuring widths. */
export function table(headers: string[], rows: string[][]): string {
  const cols = headers.length;
  const widths = headers.map((h) => visibleLen(h));
  for (const row of rows) {
    for (let i = 0; i < cols; i++) {
      widths[i] = Math.max(widths[i] ?? 0, visibleLen(row[i] ?? ""));
    }
  }
  const line = (cells: string[]): string =>
    "  " +
    cells
      .map((c, i) => c + " ".repeat(Math.max(0, (widths[i] ?? 0) - visibleLen(c))))
      .join("   ")
      .replace(/\s+$/, "");
  const head = line(headers.map((h) => color.dim(h)));
  const body = rows.map((r) => line(r));
  return [head, ...body].join("\n");
}

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

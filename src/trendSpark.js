// Small trend line for a self-check result: earlier usable checks, today's value, the usual range
// (rolling baseline ± tolerance) and the starting level (locked baseline used for drift). Returns
// SVG markup so it can be tested without a DOM. Values only; no axes, the row text carries numbers.
export const SPARK = Object.freeze({ width: 220, height: 30, pad: 4 });

export function sparklineSvg({ series = [], value, band = null, start = null, changed = false, label = "" } = {}) {
  const points = [...series, value].filter(Number.isFinite);
  if (points.length < 2) return "";
  const { width, height, pad } = SPARK;
  const all = [...points, ...(band ? band : []), ...(Number.isFinite(start) ? [start] : [])];
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const x = i => pad + (i * (width - 2 * pad)) / (points.length - 1);
  const y = v => pad + ((hi - v) * (height - 2 * pad)) / (hi - lo);
  const r = v => Math.round(v * 10) / 10;
  const line = points.map((v, i) => `${i ? "L" : "M"}${r(x(i))} ${r(y(v))}`).join(" ");
  const last = points.length - 1;
  const parts = [`<svg class="sc-spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeAttr(label)}">`];
  if (band) parts.push(`<rect class="sc-spark-band" x="${pad}" y="${r(y(Math.max(...band)))}" width="${width - 2 * pad}" height="${r(Math.abs(y(band[0]) - y(band[1])))}"/>`);
  if (Number.isFinite(start)) parts.push(`<line class="sc-spark-start" x1="${pad}" x2="${width - pad}" y1="${r(y(start))}" y2="${r(y(start))}"/>`);
  parts.push(`<path class="sc-spark-line" d="${line}"/>`);
  parts.push(`<circle class="sc-spark-now${changed ? " sc-spark-changed" : ""}" cx="${r(x(last))}" cy="${r(y(points[last]))}" r="3"/>`);
  parts.push("</svg>");
  return parts.join("");
}

function escapeAttr(text) {
  return String(text).replace(/[&"<>]/g, c => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]);
}

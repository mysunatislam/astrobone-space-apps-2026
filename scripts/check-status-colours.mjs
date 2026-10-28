// Can the self-check's status colours be told apart without the words? Simulates protanopia,
// deuteranopia and tritanopia (Machado, Oliveira & Fernandes, IEEE TVCG 2009, severity 1.0, applied in
// linear sRGB), then measures the colour difference between every pair of statuses (CIEDE2000) and each
// colour's text contrast on the drawer background (WCAG 2.1). Usage: node scripts/check-status-colours.mjs
export const BACKGROUND = "#060e1c"; // .tw-drawer glass over --tw-bg
// The --st-* tokens in src/twin.css (notChecked uses --tw-dim). Before this check, "contact today" was
// orange #ff9a4d and "baseline"/"repeat" amber #ffd27a: under deuteranopia "contact today" and "review"
// were 3.9 apart, close to identical. Pink and soft blue fixed that (src/statusColours.test.js).
export const STATUS_COLOURS = Object.freeze({
  urgent: "#ff7a6b", attention: "#ff6fb5", changed: "#ffb347", repeat: "#a9c7ff", baseline: "#a9c7ff", stable: "#6dffb0", notChecked: "#8ea7c4",
});

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const clamp = v => Math.min(1, Math.max(0, v));

export function simulate(hex, vision) {
  const lin = hexRgb(hex).map(toLinear);
  return vision === "normal" ? lin : MACHADO[vision].map(row => clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]));
}

function linearToLab([r, g, b]) {
  const xyz = [0.4124 * r + 0.3576 * g + 0.1805 * b, 0.2126 * r + 0.7152 * g + 0.0722 * b, 0.0193 * r + 0.1192 * g + 0.9505 * b];
  const white = [0.95047, 1, 1.08883];
  const f = t => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const [fx, fy, fz] = xyz.map((v, i) => f(v / white[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIEDE2000 (Sharma, Wu & Dalal, Color Res Appl 2005).
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => { const v = Math.atan2(b, a) / rad; return v < 0 ? v + 360 : v; };
  const h1p = C1p === 0 ? 0 : h(b1, a1p), h2p = C2p === 0 ? 0 : h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) dhp = Math.abs(h2p - h1p) <= 180 ? h2p - h1p : h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) hm = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

const luminance = lin => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
export const contrast = (fg, bg = BACKGROUND) => { const [a, b] = [luminance(simulate(fg, "normal")), luminance(simulate(bg, "normal"))].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };

// Smallest colour difference between two different statuses, per type of vision. Repeat and baseline
// share a colour on purpose (both mean "not compared yet"), so that pair is skipped.
export function statusColourReport(colours = STATUS_COLOURS) {
  const keys = Object.keys(colours), pairs = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (colours[keys[i]] !== colours[keys[j]]) pairs.push([keys[i], keys[j]]);
  const visions = ["normal", "protan", "deutan", "tritan"].map(vision => {
    const lab = Object.fromEntries(keys.map(k => [k, linearToLab(simulate(colours[k], vision))]));
    const diffs = pairs.map(([a, b]) => ({ a, b, dE: deltaE2000(lab[a], lab[b]) })).sort((x, y) => x.dE - y.dE);
    return { vision, closest: diffs[0], under10: diffs.filter(d => d.dE < 10) };
  });
  return { visions, contrast: Object.fromEntries(keys.map(k => [k, contrast(colours[k])])) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = statusColourReport();
  console.log(`Text contrast on ${BACKGROUND} (WCAG AA needs 4.5):`);
  for (const [k, c] of Object.entries(report.contrast)) console.log(`  ${k.padEnd(10)} ${STATUS_COLOURS[k]}  ${c.toFixed(1)}:1`);
  console.log("\nStatus pairs closer than CIEDE2000 10 (hard to tell apart at a glance):");
  for (const v of report.visions) console.log(`  ${v.vision.padEnd(7)} ${v.under10.length ? v.under10.map(d => `${d.a}/${d.b} ${d.dE.toFixed(1)}`).join(", ") : "none"}`);
}

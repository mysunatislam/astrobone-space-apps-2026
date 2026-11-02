// Face cues for the crewmate check, from MediaPipe Face Landmarker (478 landmarks + 52 blendshapes)
// and a few skin-colour patches sampled from the same camera frame. Ported in spirit from NeuroBridge
// Asha's NeuroFace Sense (mysunatislam/neurobridge-asha-unified-app, app/face-analysis.js and
// neuroface/utils/metrics.js): eye-aspect blink counting against a recent open-eye reference, the
// roll-corrected mouth-corner asymmetry (4 % of face width) and the sad-like composite. Added here:
//  - PERCLOS: share of time the eyes are at least 80 % closed (P80), the drowsiness measure Dinges et al.
//    compared against lapses on the vigilance test (FHWA-MCRT-98-006, 1998).
//  - A pain-expression score after the Prkachin & Solomon Pain Intensity (PSPI = AU4 + max(AU6, AU7) +
//    max(AU9, AU10) + AU43; Pain 2008, 139:267-274), with MediaPipe blendshapes standing in for the
//    action units. The blendshape stand-ins are an engineering approximation, not a scored PSPI.
//  - Under-eye darkness and eyelid opening against the person's own baseline. Sundelin et al. (Sleep 2013,
//    36:1355-1360) found raters judged sleep-deprived faces to have darker circles, more hanging
//    eyelids and paler skin. Lighting changes all of these, so they are compared only with the same
//    person's own earlier checks in the same place, and only as observations.
// None of these is a measure of pain, mood, sleep or a stroke. Expressions are voluntary and vary between
// people and cultures; the crewmate's own words come first.

import { estimateWavePulse } from "./wavePulse.js";

export const FACE_CUES = Object.freeze({
  minFrames: 90, // about 3 s at 30 fps before anything is summarised
  closedP80: 0.8, // PERCLOS counts frames at least 80 % closed
  blinkClose: 0.5, blinkOpen: 0.25, // blink = closure rises past 0.5 then falls under 0.25
  maxBlinkMs: 500, // longer closures are not blinks
  asymmetry: 0.04, // NeuroBridge's corner-asymmetry threshold, share of face width
  asymmetryShare: 0.6, // ...held in at least 60 % of the frames
  maxYaw: 20, // degrees; turned faces are not scored for asymmetry
});

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const quantile = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const clamp01 = v => Math.max(0, Math.min(1, v));

// Eye aspect ratio (Soukupova & Cech 2016) on the face mesh: vertical lid gaps over eye width.
const EYES = { left: [33, 160, 158, 133, 153, 144], right: [362, 385, 387, 263, 373, 380] };
export function eyeAspect(lm, side) {
  const [p1, p2, p3, p4, p5, p6] = EYES[side].map(i => lm?.[i]);
  if (![p1, p2, p3, p4, p5, p6].every(Boolean)) return NaN;
  const w = dist(p1, p4);
  return w > 1e-6 ? (dist(p2, p6) + dist(p3, p5)) / (2 * w) : NaN;
}

// Mouth-corner height difference, corrected for head roll, as a share of face width (NeuroBridge
// lipAsymmetry with no neutral reference). Positive: the subject's left corner (image right) is lower.
export function mouthAsymmetry(lm) {
  if (!lm?.[454] || !lm[234] || !lm[61] || !lm[291] || !lm[33] || !lm[263]) return NaN;
  const fw = Math.max(1e-6, dist(lm[234], lm[454]));
  const roll = Math.atan2(lm[263].y - lm[33].y, lm[263].x - lm[33].x);
  return (lm[291].y - lm[61].y - (lm[291].x - lm[61].x) * Math.tan(roll)) / fw;
}

export function headYaw(lm) {
  if (!lm?.[1] || !lm[234] || !lm[454]) return NaN;
  const l = dist(lm[1], lm[234]), r = dist(lm[1], lm[454]);
  return Math.asin(Math.max(-1, Math.min(1, (r - l) / Math.max(1e-6, r + l)))) * 180 / Math.PI * 2;
}

const bs = (shapes, name) => {
  if (!shapes) return 0;
  if (Array.isArray(shapes)) return shapes.find(c => c.categoryName === name)?.score ?? 0;
  return shapes[name] ?? 0;
};
// PSPI stand-in, 0-4: brow lowering + max(cheek raise, lid tightening) + max(nose wrinkle, upper lip raise) + eyes closed.
export function painExpression(shapes, closed = false) {
  const pair = n => (bs(shapes, `${n}Left`) + bs(shapes, `${n}Right`)) / 2;
  const au4 = pair("browDown"), au6 = pair("cheekSquint"), au7 = pair("eyeSquint"), au9 = pair("noseSneer"), au10 = pair("mouthUpperUp");
  return au4 + Math.max(au6, au7) + Math.max(au9, au10) + (closed ? 1 : 0);
}
// NeuroBridge's sad-like composite, with blendshapes for its geometry terms.
export function sadLike(shapes) {
  const pair = n => (bs(shapes, `${n}Left`) + bs(shapes, `${n}Right`)) / 2;
  return clamp01(0.35 * bs(shapes, "browInnerUp") + 0.30 * pair("mouthFrown") + 0.20 * pair("browDown") + 0.15 * (1 - pair("mouthSmile")));
}

// Skin patches (normalised boxes) the worker samples for colour: under each eye and the cheek below it.
export const SKIN_PATCHES = Object.freeze({
  underEyeL: [[230, 231, 232, 22, 23, 24], 0.0], underEyeR: [[450, 451, 452, 252, 253, 254], 0.0],
  cheekL: [[205, 50, 187, 207], 0.0], cheekR: [[425, 280, 411, 427], 0.0],
});
export function patchBoxes(lm) {
  if (!lm || lm.length < 468) return null;
  const out = {};
  for (const [name, [ids]] of Object.entries(SKIN_PATCHES)) {
    const pts = ids.map(i => lm[i]).filter(Boolean);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    out[name] = { x: x0, y: y0, w: Math.max(0.004, x1 - x0), h: Math.max(0.004, y1 - y0) };
  }
  return out;
}
const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

// One frame -> the per-frame numbers summarised below. `patches` holds mean RGB per SKIN_PATCHES name.
export function frameCues({ t, landmarks, blendshapes, patches } = {}) {
  if (!landmarks || landmarks.length < 468) return { t, face: false };
  const ear = mean([eyeAspect(landmarks, "left"), eyeAspect(landmarks, "right")].filter(Number.isFinite));
  const yaw = headYaw(landmarks);
  let underEye = NaN, redness = NaN;
  if (patches?.underEyeL && patches.underEyeR && patches.cheekL && patches.cheekR) {
    const ue = (luma(patches.underEyeL) + luma(patches.underEyeR)) / 2, ch = (luma(patches.cheekL) + luma(patches.cheekR)) / 2;
    if (ch > 20) underEye = 1 - ue / ch; // higher = darker under the eyes than the cheeks
    const c = [0, 1, 2].map(k => (patches.cheekL[k] + patches.cheekR[k]) / 2), s = c[0] + c[1] + c[2];
    if (s > 0) redness = c[0] / s;
  }
  return { t, face: true, ear, yaw, asym: mouthAsymmetry(landmarks), shapes: blendshapes ?? null, underEye, redness };
}

// Summarise a run of frames (about 60 s). Eye closure is measured against this run's own open-eye
// reference (90th percentile of the eye aspect), so it does not depend on eye shape.
export function summarizeFaceCues(frames, { cues = FACE_CUES } = {}) {
  const seen = frames.filter(f => f.face && Number.isFinite(f.ear));
  if (seen.length < cues.minFrames) return { status: "insufficient", reason: `Face seen in ${seen.length} frames; ${cues.minFrames} needed. Face the camera in steady light.`, frames: seen.length };
  const openRef = quantile(seen.map(f => f.ear), 0.9);
  if (!(openRef > 0.05)) return { status: "insufficient", reason: "Eyes could not be measured", frames: seen.length };
  const closure = seen.map(f => clamp01(1 - f.ear / openRef));
  const perclos = closure.filter(c => c >= cues.closedP80).length / closure.length;
  let blinks = 0, closedAt = null;
  seen.forEach((f, i) => {
    if (closedAt === null && closure[i] >= cues.blinkClose) closedAt = f.t;
    else if (closedAt !== null && closure[i] <= cues.blinkOpen) { if (f.t - closedAt <= cues.maxBlinkMs) blinks++; closedAt = null; }
  });
  const minutes = (seen.at(-1).t - seen[0].t) / 60000;
  const pain = seen.map((f, i) => painExpression(f.shapes, closure[i] >= cues.closedP80));
  const sad = seen.map(f => sadLike(f.shapes));
  const frontal = seen.filter(f => Number.isFinite(f.asym) && (!Number.isFinite(f.yaw) || Math.abs(f.yaw) <= cues.maxYaw));
  const asymMedian = frontal.length ? quantile(frontal.map(f => f.asym), 0.5) : NaN;
  const asymShare = frontal.length ? frontal.filter(f => Math.abs(f.asym) >= cues.asymmetry && Math.sign(f.asym) === Math.sign(asymMedian)).length / frontal.length : 0;
  const ue = seen.map(f => f.underEye).filter(Number.isFinite), red = seen.map(f => f.redness).filter(Number.isFinite);
  const round = (v, d = 3) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
  return {
    status: "measured", frames: seen.length, seconds: round(minutes * 60, 1),
    perclos: round(perclos), blinksPerMin: minutes > 0.1 ? round(blinks / minutes, 1) : null,
    eyeOpening: round(openRef), // the open-eye aspect itself: a lower value on a later day = heavier lids
    painExpression: round(quantile(pain, 0.5), 2), painExpressionPeak: round(quantile(pain, 0.95), 2),
    sadLike: round(quantile(sad, 0.5), 2),
    mouthAsymmetry: round(asymMedian), asymmetryHeld: frontal.length >= cues.minFrames && asymShare >= cues.asymmetryShare,
    underEyeDarkness: round(quantile(ue, 0.5)), skinRedness: round(quantile(red, 0.5)),
  };
}

// Compare today's summary with the person's own earlier summaries. Returns observations, never a verdict.
export const FACE_CHANGE = Object.freeze({
  perclos: { label: "Eyes closed (PERCLOS)", up: 0.1, direction: "up", note: "more time with the eyes mostly closed: drowsiness or fatigue" },
  painExpression: { label: "Pain-like expression", up: 0.6, direction: "up", note: "more brow lowering, squinting and nose wrinkling than usual" },
  underEyeDarkness: { label: "Under-eye darkness", up: 0.05, direction: "up", note: "darker under the eyes than usual, relative to the cheeks" },
  eyeOpening: { label: "Eye opening", up: 0.03, direction: "down", note: "eyelids lower than usual" },
  skinRedness: { label: "Skin colour", up: 0.015, direction: "down", note: "paler cheeks than usual" },
});
export function compareFaceCues(today, history = []) {
  if (today?.status !== "measured") return [];
  const out = [];
  for (const [key, rule] of Object.entries(FACE_CHANGE)) {
    const past = history.map(h => h?.[key]).filter(Number.isFinite);
    if (!Number.isFinite(today[key])) continue;
    if (past.length < 2) { out.push({ key, label: rule.label, value: today[key], status: "baseline", text: `${rule.label}: recorded as a baseline (${past.length + 1} of 3)` }); continue; }
    const usual = quantile(past, 0.5), delta = today[key] - usual;
    const changed = rule.direction === "up" ? delta >= rule.up : -delta >= rule.up;
    out.push({ key, label: rule.label, value: today[key], usual: Number(usual.toFixed(3)), status: changed ? "changed" : "stable", text: changed ? `${rule.label}: ${rule.note}` : `${rule.label}: close to usual` });
  }
  if (today.asymmetryHeld) out.push({ key: "mouthAsymmetry", label: "Mouth asymmetry", value: today.mouthAsymmetry, status: "changed", text: "One mouth corner sat lower for most of the minute. Ask the crewmate to smile and raise both arms (BE-FAST)." });
  return out;
}

// Breathing rate from the slow up-and-down of the head (the mean face-landmark height), as NeuroBridge's
// VitalSense does: 6-36 breaths a minute, at least 30 s, peak-share gate. Experimental: talking,
// swallowing and posture shifts move the head too. scripts/validation/nb-pulse-compare.mjs scores it on
// MCD-rPPG against each recording's measured respiratory rate.
export const BREATHING = Object.freeze({ lowHz: 0.1, highHz: 0.6, windowSeconds: 60, minSeconds: 30, minQuality: 0.3 });
export function breathingFromHead(samples, options = {}) {
  const wave = samples.filter(s => Number.isFinite(s.t) && Number.isFinite(s.headY)).map(s => ({ t: s.t, v: s.headY }));
  const r = estimateWavePulse(wave, { ...BREATHING, ...options });
  return r.status === "estimated" ? { status: "estimated", rate: r.bpmExact, quality: r.quality } : { status: "insufficient", reason: r.reason === "No clear pulse peak" ? "No clear breathing rhythm in head movement" : r.reason.replace(/pulse/gi, "breathing"), quality: r.quality };
}

// How much the camera's knee reading moves when nothing about the knee changed, measured on the saved
// real-video results (REHAB24-6: 9 people, squats and lunges, two cameras and Vicon motion capture;
// docs/real-video-validation.md). The self-check compares each knee check with the same person's own
// earlier checks, so the number that matters is not the absolute error but how much the error itself
// moves from one repeat to the next.
//
// data/validation/rehab24-knee-reps.csv has one row per repetition, camera and knee (camera minus
// motion capture is the error) in the order the validation wrote them: repetitions grouped by video,
// each repetition as its facing-camera knees (or one part-turned knee) and then the other camera's knee.
// It has no person or video column, so repeats are taken as consecutive repetitions of the same knee
// on the same camera. The few pairs that straddle two videos (and so two people) make the estimate
// larger, never smaller.
// data/validation/rehab24-squat-video.csv is one person's 21 squats frame by frame (both cameras).

const POSITIONS = Object.freeze({ front: "facing", half: "part-turned", side: "side-on" });
const EXERCISES = Object.freeze({ Ex6: "squat", Ex5: "lunge" });
const D2 = 1.128; // moving-range constant: SD = mean |x[i] - x[i-1]| / 1.128 (Montgomery)

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1));
const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (x, d = 1) => Number(x.toFixed(d));
const percentile = (xs, q) => { const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.min(lo + 1, s.length - 1); return s[lo] + (s[hi] - s[lo]) * (i - lo); };

// Comma-separated text with a header row; quoted fields may hold commas. Numbers become numbers, empty cells null.
export function parseCsv(text) {
  const split = line => (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).slice(0, -1).map(f => f.replace(/,$/, "")).map(f => (f.startsWith('"') ? f.slice(1, -1).replace(/""/g, '"') : f));
  const [head, ...lines] = text.trim().split(/\r?\n/), keys = split(head);
  return lines.map(line => Object.fromEntries(split(line).map((v, i) => [keys[i], /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === "" ? null : v])));
}

// Rows -> repetitions. Facing set-up: up to two facing knees, then the side camera's near knee (the
// same knee as the first facing row). Part-turned set-up: one near knee per camera.
export function repetitions(rows) {
  const reps = [];
  for (let i = 0; i < rows.length;) {
    const r = rows[i], same = (j, view) => j < rows.length && rows[j].view === view && rows[j].exercise === r.exercise;
    const rep = { exercise: r.exercise, setup: r.view === "half" ? "part-turned" : "facing+side", knees: {} };
    let j = i;
    if (r.view === "half") { rep.knees.cam1 = rows[j++]; if (same(j, "half")) rep.knees.cam2 = rows[j++]; }
    else {
      if (r.view === "front") { rep.knees.facingA = rows[j++]; if (same(j, "front")) rep.knees.facingB = rows[j++]; }
      if (same(j, "side")) rep.knees.sideOn = rows[j++];
    }
    reps.push(rep); i = j;
  }
  return reps;
}

export function agreement(errors) {
  const bias = mean(errors), s = sd(errors);
  return { n: errors.length, bias: round(bias), sd: round(s), loa: [round(bias - 1.96 * s), round(bias + 1.96 * s)], mae: round(mean(errors.map(Math.abs))) };
}

// Repeat noise from consecutive differences of the error, pooled over streams (one knee on one camera).
// `sd` is the moving-range estimate; `robustSd` uses the median difference (median |d| / 0.954 for
// Gaussian noise), which a few cross-video pairs barely move. `mdc95` is the smallest change between two
// single readings that noise alone exceeds only 5 % of the time: 1.96 x sqrt(2) x SD.
export function repeatNoise(streams) {
  const steps = streams.flatMap(s => s.slice(1).map((x, i) => Math.abs(x - s[i])));
  const s = mean(steps) / D2;
  return { pairs: steps.length, sd: round(s), robustSd: round(median(steps) / (0.6745 * Math.SQRT2)), mdc95: round(1.96 * Math.SQRT2 * s) };
}

const errorOf = (row, method) => row[method === "before" ? "app_before_rom_deg" : "hybrid_rom_deg"] - row.mocap_rom_deg;

// Agreement with motion capture and repeat noise for each camera position and movement.
export function kneeNoiseByPosition(rows, method = "hybrid") {
  const reps = repetitions(rows), out = [];
  const slots = { "side-on": ["sideOn"], facing: ["facingA", "facingB"], "part-turned": ["cam1", "cam2"] };
  for (const exercise of Object.keys(EXERCISES)) for (const [position, keys] of Object.entries(slots)) {
    const streams = keys.map(k => reps.filter(r => r.exercise === exercise && r.knees[k]).map(r => errorOf(r.knees[k], method))).filter(s => s.length > 1);
    const all = streams.flat();
    if (all.length < 10) continue;
    out.push({ movement: EXERCISES[exercise], position, agreement: agreement(all), repeat: repeatNoise(streams) });
  }
  return out;
}

// The same knee in the same repetition, seen facing the camera and side-on at once: how far apart the
// two positions read. This is why the app keeps a separate baseline for each camera position.
export function facingMinusSideOn(rows, method = "hybrid") {
  const reps = repetitions(rows);
  return Object.entries(EXERCISES).map(([exercise, movement]) => {
    const d = reps.filter(r => r.exercise === exercise && r.knees.facingA && r.knees.sideOn && Math.abs(r.knees.facingA.mocap_rom_deg - r.knees.sideOn.mocap_rom_deg) < 0.15)
      .map(r => errorOf(r.knees.facingA, method) - errorOf(r.knees.sideOn, method));
    return { movement, ...agreement(d) };
  });
}

// One video frame by frame: split it into squats with the motion-capture angle (a squat starts below
// 140° and ends back above 150°, the window running to halfway to the next squat), then per squat the
// app's two numbers, extension (95th percentile) and range of motion (95th - 5th), camera minus truth.
export function videoRepetitions(frames, camera) {
  const truth = frames.map(f => f[`${camera}_mocap_deg`]), est = frames.map(f => f[`${camera}_hybrid_deg`]), dips = [];
  let start = null;
  truth.forEach((g, i) => { if (g === null) return; if (start === null && g < 140) start = i; else if (start !== null && g >= 150) { dips.push([start, i]); start = null; } });
  return dips.map(([s, e], k) => {
    const a = k ? (dips[k - 1][1] + s) >> 1 : Math.max(0, s - 8), b = k + 1 < dips.length ? (e + dips[k + 1][0]) >> 1 : Math.min(truth.length - 1, e + 8);
    const idx = []; for (let i = a; i <= b; i++) if (truth[i] !== null && est[i] !== null) idx.push(i);
    const g = idx.map(i => truth[i]), h = idx.map(i => est[i]);
    return { extensionError: round(percentile(h, 0.95) - percentile(g, 0.95)), romError: round(percentile(h, 0.95) - percentile(h, 0.05) - (percentile(g, 0.95) - percentile(g, 0.05))) };
  });
}

// The one split of a series into before and after that moves its mean the most (at least 3 values each side).
export function largestStep(values, minSide = 3) {
  let best = null;
  for (let k = minSide; k <= values.length - minSide; k++) {
    const shift = mean(values.slice(k)) - mean(values.slice(0, k));
    if (!best || Math.abs(shift) > Math.abs(best.shift)) best = { after: k, shift: round(shift) };
  }
  return best;
}

// Within one video and one person: how much the error moves between consecutive squats.
export function videoRepeatNoise(frames, camera) {
  const reps = videoRepetitions(frames, camera), out = { reps: reps.length };
  for (const key of ["extensionError", "romError"]) {
    const e = reps.map(r => r[key]), steps = e.slice(1).map((x, i) => Math.abs(x - e[i]));
    out[key.replace("Error", "")] = { ...agreement(e), repeatSd: round(mean(steps) / D2), medianStep: round(median(steps)), stepsOver5: steps.filter(s => s > 5).length, steps: steps.length, largestStep: largestStep(e) };
  }
  return out;
}

// The figures the app and the false-alarm simulation use (src/selfCheck.js KNEE_REPEAT_NOISE):
// side-on squats, because the self-check asks for a side-on, one-plane knee movement. Extension noise
// is not in the per-repetition file, so it is the range-of-motion noise scaled by the side-on ratio of
// extension error to range-of-motion error on the same repetitions (data/validation/rehab24-knee-methods.csv).
export const SHIPPED_METHOD = "Learned trees + fallback (shipped)";
export function kneeRepeatNoiseEstimate(rows, methods) {
  const side = kneeNoiseByPosition(rows).find(r => r.movement === "squat" && r.position === "side-on");
  const m = methods.find(r => r.method === SHIPPED_METHOD && r.exercise_view === "Ex6|side");
  const ratio = m.extension_mae_deg / m.rom_mae_deg;
  return { romSd: side.repeat.sd, romMdc95: side.repeat.mdc95, extensionToRomError: round(ratio, 2), extensionSd: round(side.repeat.sd * ratio), extensionMdc95: round(1.96 * Math.SQRT2 * side.repeat.sd * ratio), pairs: side.repeat.pairs };
}

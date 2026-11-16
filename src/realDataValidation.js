// What AstroBone has been tested against on real people, and what it has not, for the Evidence view.
// Every number is recomputed from the derived tables in data/validation/ (src/realDataValidation.test.js),
// so the screen cannot drift from the measurements in docs/real-video-validation.md.
import { KNEE_REPEAT_NOISE, SIMULATED_RELIABILITY } from "./selfCheck.js";

const round = (x, d = 1) => Number(x.toFixed(d));
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

export const REAL_DATA_VALIDATION = Object.freeze({
  knee: Object.freeze({ dataset: "REHAB24-6", people: 9, reps: 928, romErrorBefore: 21.7, romErrorAfter: 13.2, iccBefore: 0.549, iccAfter: 0.769, improvedPeople: 9, sideOnSquatError: 6.5 }),
  pulse: Object.freeze({ dataset: "MCD-rPPG", people: 40, windows: 308, mae: 2.1, gatedMae: 0.6, gatedAnsweredPct: 76.9, gate: 0.3, changeError: 4.2, changePeople: 38 }),
  // November 2026 expansion (docs/validation-expansion-2026-11.md): a second knee lab and new pulse people on three cameras.
  knee2: Object.freeze({dataset: "Zenodo 19720803", people: 19, reps: 1080, sideOnSquatError: 7.8, facingSquatError: 52.1, sideOnRepeatSd: 3.6}),
  cameras: Object.freeze({people: 58, windows: 1341, answeredFront: 80.5, answeredPhone: 45.7, answeredSide: 34, mae: 1.05, ungatedMae: 6.21, hrvRecordings: 343, hrvAnswered: 16, hrvMaeMs: 53.4}),
});

// From data/validation/sync21-knee-summary.csv (Zenodo 19720803: OptiTrack vs smartphone keypoints).
export function secondKneeSummary(rows) {
  const side = rows.find(r => r.movement === "Squat" && r.camera === "side-on"), facing = rows.find(r => r.movement === "Squat" && r.camera === "facing");
  return { dataset: "Zenodo 19720803", people: side.people, reps: side.reps, sideOnSquatError: side.rom_mae_deg, facingSquatError: facing.rom_mae_deg, sideOnRepeatSd: side.rom_repeat_sd_deg };
}

// From data/validation/mcd-scale-pulse.csv and mcd-scale-summary.json (new MCD-rPPG people, three cameras).
export function cameraPulseSummary(rows, summary) {
  const row = (camera, method) => rows.find(r => r.camera === camera && r.state === "both" && r.method.startsWith(method));
  const shipped = camera => row(camera, "Self-check hybrid (as shipped"), all = shipped("all three"), off = row("all three", "Self-check hybrid, gate off");
  return {
    people: summary.people, windows: summary.windows, answeredFront: shipped("front webcam").answered_pct, answeredPhone: shipped("phone camera (Iriun)").answered_pct,
    answeredSide: shipped("side USB camera").answered_pct, mae: all.mae_bpm, ungatedMae: off.mae_bpm,
    hrvRecordings: summary.videos, hrvAnswered: summary.hrv_answered, hrvMaeMs: summary.hrv_mae_ms,
  };
}

// The per-person and per-method rows the Evidence charts draw (data/validation/rehab24-knee-per-person.csv
// and mcd-pulse-methods.csv; src/realDataValidation.test.js checks every value against the files).
// Knee: range-of-motion error in degrees for each person, with that person left out of training.
export const KNEE_PER_PERSON = Object.freeze([
  [1, 23.21, 12.74], [2, 28.1, 16.96], [3, 17.51, 12.16], [4, 13.51, 9.37], [5, 24.29, 14.2],
  [6, 23.18, 16.06], [7, 22.44, 12.93], [8, 20.06, 13.31], [9, 22.72, 10.89],
].map(([person, before, after]) => Object.freeze({ person, before, after })));
// Pulse: average error in beats per minute against the finger sensor, 30-second windows. A selection of
// the 15 methods in the file: the shipped one, the deep models and the classic colour methods.
export const PULSE_METHODS = Object.freeze([
  ["AstroBone hybrid", "AstroBone (shipped)", 2.14, true], ["ME-rPPG, app", "ME-rPPG deep model", 2.44], ["FacePhys", "FacePhys deep model", 4.81],
  ["AstroBone live", "AstroBone, colour only", 6.88, true], ["POS", "POS (Wang 2017)", 7.1], ["GREEN", "Green channel (2008)", 10.19],
  ["PhysNet", "PhysNet deep model", 10.3], ["CHROM", "CHROM (de Haan 2013)", 18.16],
].map(([method, label, mae, ours = false]) => Object.freeze({ method, label, mae, ours })));

// From data/validation/rehab24-knee-methods.csv and rehab24-knee-per-person.csv.
export function kneeSummary(methods, perPerson) {
  const row = (method, view) => methods.find(m => m.method === method && m.exercise_view === view);
  const before = row("Pretrained, 3D angle (app before)", "all|all"), after = row("Learned trees + fallback (shipped)", "all|all");
  return {
    people: perPerson.length, reps: after.rep_knee_pairs,
    romErrorBefore: round(before.rom_mae_deg), romErrorAfter: round(after.rom_mae_deg), iccBefore: before.rom_icc21, iccAfter: after.rom_icc21,
    improvedPeople: perPerson.filter(p => p["Learned trees + fallback (shipped)"] < p["Pretrained, 3D angle (app before)"]).length,
    sideOnSquatError: round(row("Learned trees + fallback (shipped)", "Ex6|side").rom_mae_deg),
  };
}

// From data/validation/mcd-pulse-methods.csv, mcd-pulse-gate-sweep.csv and mcd-pulse-rest-vs-squats.csv.
export function pulseSummary(methods, sweep, restVsSquats, gate = 0.3) {
  const hybrid = methods.find(m => m.method === "AstroBone hybrid"), gated = sweep.find(s => s.method === "AstroBone hybrid" && s.quality_gate === gate);
  const pairs = restVsSquats.filter(p => [p.finger_rest_bpm, p.finger_after_squats_bpm, p.camera_rest_bpm, p.camera_after_squats_bpm].every(Number.isFinite));
  const change = mean(pairs.map(p => Math.abs((p.camera_after_squats_bpm - p.camera_rest_bpm) - (p.finger_after_squats_bpm - p.finger_rest_bpm))));
  return { people: restVsSquats.length, windows: hybrid.windows, mae: round(hybrid.mae_bpm), gatedMae: gated.mae_bpm, gatedAnsweredPct: gated.windows_answered_pct, gate, changeError: round(change), changePeople: pairs.length };
}

// The lines the Evidence view shows: what was measured, on whom, and the limit of each.
export function testedOnRealData(v = REAL_DATA_VALIDATION, noise = KNEE_REPEAT_NOISE, sim = SIMULATED_RELIABILITY) {
  const knee = sim.detected.find(d => d.key === "kneeExtension");
  return {
    tested: [
      `Knee angle against motion capture (${v.knee.dataset}, ${v.knee.people} people, ${v.knee.reps} repetitions of squats and lunges): range-of-motion error ${v.knee.romErrorBefore}° → ${v.knee.romErrorAfter}° with the hybrid knee model, ICC ${v.knee.iccBefore} → ${v.knee.iccAfter}, better for ${v.knee.improvedPeople} of ${v.knee.people} people it was not trained on; ${v.knee.sideOnSquatError}° side-on in squats.`,
      `Knee repeat noise on the same videos: the side-on reading moved ±${noise.kneeExtension.sd}° (extension) and ±${noise.kneeRom.sd}° (range) between repetitions with no change in the knee, so two checks must differ by about ${Math.round(noise.kneeExtension.mdc95)}° before noise is an unlikely cause.`,
      `Camera pulse against a finger sensor (${v.pulse.dataset}, ${v.pulse.people} people at rest and after squats): ${v.pulse.mae} bpm average error on ${v.pulse.windows} 30-second windows; ${v.pulse.gatedMae} bpm on the ${Math.round(v.pulse.gatedAnsweredPct)} % the quality gate passes; the rise from rest tracked within ${v.pulse.changeError} bpm in ${v.pulse.changePeople} people.`,
      `False alarms, simulated with the measured knee noise and published day-to-day spreads for heart rate, blood pressure, sleep and temperature: a healthy astronaut doing all 14 checks daily sees REVIEW on ${sim.reviewPct} % of days; a real 10° knee drop is flagged within 3 checks in ${knee.withinThree} % of runs and within 14 in ${knee.withinTwoWeeks} %.`,
      `A second knee lab (${v.knee2.dataset}, ${v.knee2.people} people, ${v.knee2.reps} squats, motion capture against smartphone keypoints): side-on, the knee angle the app falls back on was ${v.knee2.sideOnSquatError}° off per squat; facing the camera, ${v.knee2.facingSquatError}°. That is why the check asks you to sit side-on.`,
      `Camera pulse on ${v.cameras.people} more people and three cameras, one a phone: the self-check answered ${Math.round(v.cameras.answeredFront)} % of windows on the front webcam, ${Math.round(v.cameras.answeredPhone)} % on the phone and ${Math.round(v.cameras.answeredSide)} % on the side camera, ${v.cameras.mae} bpm from the finger sensor when it answered; with its quality gate off it would have been ${v.cameras.ungatedMae} bpm off.`,
      "Real spaceflight: the personal-baseline rule replayed on the four Inspiration4 crew members' blood (NASA OSDR OSD-569 and OSD-575), each against their own pre-flight draws; ISS area-dosimeter rates from OSDR set the radiation comparison band.",
    ],
    notYet: [
      "No astronaut has used the camera checks; every camera test above is healthy adults on Earth.",
      "The seated knee test has not been compared with a goniometer on different days; the in-app angle check records exactly those pairs.",
      "The crewmate check's face cues (pain-like expression, eye closure, mouth asymmetry, under-eye darkness) and reading pauses have not been tested on people in pain, drowsy or unwell; the pain-like expression uses face-model blendshapes in place of scored facial action units. Breathing from head movement lost to a fixed guess on 40 recorded people, so breaths are counted by the crew.",
      "The pulse is untested on darker skin tones, dim light and moving subjects. On recorded phone video it was accurate when it answered but answered less than half the time; a live phone next to a pulse oximeter is still untested.",
      `Heart-rate variability from the camera is not shown: on ${v.cameras.hrvRecordings} recordings it answered ${v.cameras.hrvAnswered} times, ${v.cameras.hrvMaeMs} ms from a finger sensor on average.`,
      "The reaction test has not been timed with a robot finger on a real phone. Published measurements put the delay a touch screen or keyboard adds at 58–133 ms depending on the device and browser, so each result is compared only with tests answered the same way on the same kind of device.",
      "Heart rate, blood pressure, sleep and temperature spreads in the false-alarm simulation come from studies of adults on Earth, not astronauts. The reaction test's usual levels come from 45 adults who took it 16 times (Basner 2018); its day-to-day spread, oxygen and the ratings use stated assumptions.",
    ],
  };
}

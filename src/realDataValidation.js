// What AstroBone has been tested against on real people, and what it has not, for the Evidence view.
// Every number is recomputed from the derived tables in data/validation/ (src/realDataValidation.test.js),
// so the screen cannot drift from the measurements in docs/real-video-validation.md.
import { KNEE_REPEAT_NOISE, SIMULATED_RELIABILITY } from "./selfCheck.js";

const round = (x, d = 1) => Number(x.toFixed(d));
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

export const REAL_DATA_VALIDATION = Object.freeze({
  knee: Object.freeze({ dataset: "REHAB24-6", people: 9, reps: 928, romErrorBefore: 21.7, romErrorAfter: 13.2, iccBefore: 0.549, iccAfter: 0.769, improvedPeople: 9, sideOnSquatError: 6.5 }),
  pulse: Object.freeze({ dataset: "MCD-rPPG", people: 40, windows: 308, mae: 2.1, gatedMae: 0.6, gatedAnsweredPct: 76.9, gate: 0.3, changeError: 4.2, changePeople: 38 }),
});

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
      "Real spaceflight: the personal-baseline rule replayed on the four Inspiration4 crew members' blood (NASA OSDR OSD-569 and OSD-575), each against their own pre-flight draws; ISS area-dosimeter rates from OSDR set the radiation comparison band.",
    ],
    notYet: [
      "No astronaut has used the camera checks; every camera test above is healthy adults on Earth.",
      "The seated knee test has not been compared with a goniometer on different days; the in-app angle check records exactly those pairs.",
      "The pulse is untested on darker skin tones, dim light and moving subjects, and on a real phone next to a pulse oximeter.",
      "Heart rate, blood pressure, sleep and temperature spreads in the false-alarm simulation come from studies of adults on Earth, not astronauts; oxygen, the reaction test and the ratings use stated assumptions.",
    ],
  };
}

// Knee repeat noise from the saved real-video results (no download needed): agreement with motion
// capture and repetition-to-repetition noise for each camera position, the same knee seen facing and
// side-on at once, and one person's 21 squats frame by frame. Prints section 5 of
// docs/real-video-validation.md (write_validation_doc.py includes it); --json prints the raw numbers.
// Usage: node scripts/validation/knee-repeatability.mjs [--json]
import { readFileSync } from "node:fs";
import { parseCsv, kneeNoiseByPosition, facingMinusSideOn, videoRepeatNoise, kneeRepeatNoiseEstimate } from "../../src/kneeRepeatability.js";
import { SIMULATED_RELIABILITY } from "../../src/selfCheck.js";
import { CALIBRATION } from "../../src/angleCheck.js";

const read = name => parseCsv(readFileSync(new URL(`../../data/validation/${name}`, import.meta.url), "utf8"));

export function kneeRepeatability() {
  const reps = read("rehab24-knee-reps.csv"), methods = read("rehab24-knee-methods.csv"), video = read("rehab24-squat-video.csv");
  return {
    byPosition: { hybrid: kneeNoiseByPosition(reps), before: kneeNoiseByPosition(reps, "before") },
    facingMinusSideOn: facingMinusSideOn(reps),
    oneVideo: { sideOn: videoRepeatNoise(video, "side_on"), facing: videoRepeatNoise(video, "facing") },
    estimate: kneeRepeatNoiseEstimate(reps, methods),
  };
}

export function kneeRepeatabilityMarkdown(r = kneeRepeatability()) {
  const L = [], w = L.push.bind(L), e = r.estimate, side = r.oneVideo.sideOn, face = r.oneVideo.facing;
  const [squat, lunge] = r.facingMinusSideOn, knee = SIMULATED_RELIABILITY.detected.find(d => d.key === "kneeExtension");
  const before = (m, p) => r.byPosition.before.find(x => x.movement === m && x.position === p).repeat.sd;
  w("## 5. Repeat noise: what one knee check can tell\n");
  w("AstroBone compares each knee check with the same person's earlier checks, never with a population norm. Whether a change is real therefore depends less on the absolute " +
    "error above than on how much the error itself moves when nothing about the knee changed. No volunteer has been measured on different days yet, so this section takes the " +
    "closest answer the saved data hold: consecutive repetitions of the same knee, on the same camera, in the same video. The saved per-repetition table has no person column, " +
    "so the few pairs that straddle two videos (and two people) are counted too; they can only make the noise look larger. `scripts/validation/knee-repeatability.mjs` " +
    "computes this section from the files in `data/validation/` (derived from REHAB24-6), with no download.\n");
  w("| Movement, camera position | Reps | Bias | 95 % limits of agreement | Repeat noise (SD) | Detectable change (MDC95) |");
  w("|---|---|---|---|---|---|");
  for (const x of r.byPosition.hybrid) w(`| ${x.movement[0].toUpperCase()}${x.movement.slice(1)}, ${x.position} | ${x.agreement.n} | ${x.agreement.bias}° | ${x.agreement.loa[0]}° to ${x.agreement.loa[1]}° | ${x.repeat.sd}° | ${x.repeat.mdc95}° |`);
  w("\nRange of motion per repetition, shipped hybrid, camera minus motion capture. **Repeat noise** is the mean difference between consecutive repetitions' errors divided by 1.128 " +
    "(the moving-range estimate), so a person's steady offset cancels the way it cancels against their own baseline. In every position it is smaller than the spread of the error " +
    `across people: part of the error is a steady offset of each person and set-up. **MDC95** = 1.96 × √2 × repeat noise, the smallest difference between two single readings that ` +
    `noise alone exceeds only 1 time in 20. Side-on, the hybrid repeats no worse than the old 3D angle (squats ${r.byPosition.hybrid[0].repeat.sd}° against ${before("squat", "side-on")}°).\n`);
  w(`**One person, ${side.reps} squats, frame by frame.** The one video kept frame by frame (person 6) splits into ${side.reps} squats. Side-on, the extension error moved ${side.extension.repeatSd}° ` +
    `and the range-of-motion error ${side.rom.repeatSd}° from squat to squat (facing: ${face.extension.repeatSd}° and ${face.rom.repeatSd}°), less than the pooled figures, so the pooled ones are the cautious choice. ` +
    `The steps are uneven: the median extension step was ${side.extension.medianStep}°, but the error sat at a different level in the first few squats than in the rest ` +
    `(side-on extension shifted ${Math.abs(side.extension.largestStep.shift)}° after squat ${side.extension.largestStep.after}, facing ${Math.abs(face.extension.largestStep.shift)}° after squat ${face.extension.largestStep.after}). ` +
    "That looks like a change in how or where the person squatted rather than random camera noise (the saved file does not record which). The camera repeats closely " +
    "when the movement is repeated closely, which is why the self-check asks for the same position every day.\n");
  w(`**The same knee, facing and side-on at once.** In ${squat.n} squats the facing camera read the same knee's range of motion ${Math.abs(squat.bias)}° lower than the side-on camera on average ` +
    `(SD ${squat.sd}°; lunges ${Math.abs(lunge.bias)}° lower, SD ${lunge.sd}°). A change of camera position is a change of reading, so the app keeps a separate baseline for each position and refuses part-turned captures.\n`);
  w(`**What the app now uses.** Side-on squats are the closest match to the side-on seated test: range of motion ±${e.romSd}° (MDC95 ${e.romMdc95}°, ${e.pairs} pairs). The per-repetition table ` +
    `holds range of motion only, so extension is scaled by the side-on ratio of extension error to range-of-motion error on the same repetitions (${e.extensionToRomError}): ±${e.extensionSd}° ` +
    `(MDC95 ${e.extensionMdc95}°). These are \`KNEE_REPEAT_NOISE\` in \`src/selfCheck.js\`, and they replace the 3° and 4° that \`scripts/simulate-false-alarms.mjs\` used to assume. ` +
    `With them, and published day-to-day spreads for heart rate, blood pressure and sleep ([self-check method](self-check.md)), a healthy astronaut doing all 14 checks daily is told REVIEW on ${SIMULATED_RELIABILITY.reviewPct} % of days, and a real 10° drop in knee extension ` +
    `is flagged within three checks in ${knee.withinThree} % of runs and within 14 checks in ${knee.withinTwoWeeks} %. The knee is one of the noisiest daily checks, and the app says so: ` +
    "the result shows the measured noise beside each knee capture, and **How often is this wrong?** shows the simulated figures.\n");
  w("**What this does not prove.** These are repeats within one session, of squats and lunges, by nine healthy adults in one lab. Day-to-day repeatability of the seated test (new camera " +
    "placement, clothing and light), and anything in microgravity, still needs the same volunteers checked on different days against a goniometer. The in-app angle check records exactly " +
    `those pairs and raises the knee review trigger to the measured detectable change once there are ${CALIBRATION.minPairs} pairs from ${CALIBRATION.minPeople} people.\n`);
  return L.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(process.argv.includes("--json") ? JSON.stringify(kneeRepeatability(), null, 2) : kneeRepeatabilityMarkdown());

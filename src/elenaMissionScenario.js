// All fictional mission values live here. Never join this fixture to NASA subjects.
const field = (value, unit, boundary = "Authored demonstration value; not a sensor measurement or validated health threshold.") =>
  ({ value, unit, provenance: "SYNTHETIC DEMO", boundary });
const frame = (day, stage, extension, rom, heart, dose) => ({
  day: field(day, "mission day"), stage: field(stage, "label"),
  kneeExtension: field(extension, "deg"), kneeRom: field(rom, "deg"),
  heartRate: field(heart, "bpm"), absorbedDose: field(dose, "mGy", "Illustrative dosimeter history, not a radiation transport calculation; not effective dose."),
  trackingQuality: field(.94, "fraction", "Synthetic input-quality indicator, not accuracy or clinical confidence."),
  sampleCount: field(120, "samples"), heartQuality: field(.95, "fraction"),
});
export const ELENA = {
  schema: "astrobone-elena-synthetic-v1",
  identity: { id: field("DEMO-ELENA", "identifier"), name: field("Commander Elena Torres", "name"),
    mission: field("ARES TRANSIT-1", "mission"), destination: field("Earth-to-Mars transit", "context"),
    duration: field(240, "days"), currentDay: field(147, "mission day"), gravity: field("microgravity", "context") },
  protocol: field("restrained-knee-extension-demo-v1", "protocol"),
  model: field("synthetic-script-v2", "input source"),
  observations: [
    frame(1, "Baseline established", 165, 80, 64, 0),
    frame(30, "Early observation", 165, 80, 65, 4.5),
    frame(60, "Movement observation", 163, 78, 66, 9),
    frame(90, "Dosimeter update", 160, 74, 69, 13.5),
    frame(120, "Cardiovascular follow-up", 157, 69, 72, 18),
    frame(147, "Multisystem review", 151, 62, 76, 22.05),
    frame(180, "Planned scenario checkpoint", 153, 66, 73, 27),
    frame(240, "Planned scenario endpoint", 160, 74, 68, 36),
  ],
  event: { label: field("Space-weather scenario", "label"), increment: field(10, "mGy", "Tabletop increment only; no radiation injury, biological effect or real space-weather event inferred.") },
  whatIf: { poorQuality: field(.35, "fraction"), reducedExtension: field(140, "deg"),
    stableExtension: field(165, "deg"), exposureMax: field(100, "mGy", "Scenario control bound, not a permissible exposure limit.") },
  boundary: "Fictional crew and mission. Later checkpoints are authored scenarios, not forecasts. External research is never a measurement from Elena.",
};

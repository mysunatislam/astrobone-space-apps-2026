// The clickable body: for each structure the 3D twin can pick, what it does, how spaceflight affects
// it, and which self-check indicators watch it. The card built from this shows today's status from the
// astronaut's latest self-check and offers to measure it now.
export const BODY_PARTS = Object.freeze({
  tibia: {
    picks: ["tibiaL", "tibiaR"], name: "Shin bone (tibia)", domain: "musculoskeletal", indicators: ["kneeExtension", "kneeRom"], step: "movement",
    does: "Carries your body weight from the knee to the ankle.",
    space: "On 4-7 month space station missions the lower shin bone lost density and estimated strength, and many astronauts had not fully recovered a year after landing.",
    sources: ["Gabel et al., Sci Rep 2022"],
  },
  femur: {
    picks: ["femurL", "femurR"], name: "Thigh bone (femur)", domain: "musculoskeletal", indicators: ["kneeExtension", "kneeRom"], step: "movement",
    does: "The longest bone: carries your weight from the hip to the knee.",
    space: "In NASA's OSD-804 mouse flight study, the end of the femur just above the knee moved most clearly toward bone loss of the five sites tested.",
    sources: ["NASA OSDR OSD-804"],
  },
  pelvis: {
    picks: ["pelvis"], name: "Hip and pelvis", domain: "musculoskeletal", indicators: ["kneeExtension", "kneeRom"], step: "movement",
    does: "Joins the spine to the legs and carries the weight of the upper body.",
    space: "Hip bone mineral fell about 1-1.5 % a month on long flights.",
    sources: ["LeBlanc et al., J Musculoskelet Neuronal Interact 2000"],
  },
  lumbar: {
    picks: ["lumbar"], name: "Lower spine", domain: "musculoskeletal", indicators: [], step: "movement",
    does: "Carries the upper body and lets you bend and twist.",
    space: "Without gravity the spine lengthens and the deep back muscles get smaller; back pain is common early in flight.",
    sources: ["Chang et al., Spine 2016"],
  },
  heart: {
    picks: ["heart"], name: "Heart", domain: "cardiovascular", indicators: ["restingHr", "systolicBp", "diastolicBp"], step: "body",
    does: "Pumps blood around the body. Resting heart rate and blood pressure show how hard it is working.",
    space: "Fluid shifts toward the head; 24-hour blood pressure fell on long ISS flights, and heart rate on standing was higher on landing day.",
    sources: ["Norsk et al., J Physiol 2015", "Lee et al., Front Physiol 2020"],
  },
  vessels: {
    picks: ["major"], name: "Major blood vessels", domain: "cardiovascular", indicators: ["systolicBp", "diastolicBp"], step: "body",
    does: "Carry blood away from and back to the heart.",
    space: "Neck arteries were stiffer after six months in space.",
    sources: ["Hughson et al., Am J Physiol Heart Circ Physiol 2016"],
  },
  lungs: {
    picks: ["pulmonary"], name: "Lung circulation", domain: "cardiovascular", indicators: ["spo2"], step: "body",
    does: "Carries blood through the lungs to pick up oxygen.",
    space: "Cabin air is recycled; oxygen saturation shows whether the lungs and the air deliver enough oxygen.",
    sources: ["NHS England pulse oximetry guidance"],
  },
  kidneys: {
    picks: ["renal"], name: "Kidney vessels", domain: null, indicators: [], step: "body",
    does: "The kidneys filter the blood and remove waste, including calcium released from bone.",
    space: "Calcium lost from bone raises the risk of kidney stones in flight. The self-check does not measure this; drink your planned fluids.",
    sources: ["NASA HRP: risk of renal stone formation"],
  },
  quadriceps: {
    picks: ["quadriceps"], name: "Front thigh muscles (quadriceps)", domain: "musculoskeletal", indicators: ["kneeExtension", "kneeRom"], step: "movement",
    does: "Straighten the knee. They do the work in the knee test.",
    space: "Leg lean tissue fell on long flights; this is the muscle group the knee test watches.",
    sources: ["LeBlanc et al., J Musculoskelet Neuronal Interact 2000"],
  },
  hamstrings: {
    picks: ["hamstrings"], name: "Back thigh muscles (hamstrings)", domain: "musculoskeletal", indicators: ["kneeRom"], step: "movement",
    does: "Bend the knee and straighten the hip.",
    space: "Leg lean tissue fell on long flights; tight hamstrings also narrow the knee's range of motion.",
    sources: ["LeBlanc et al., J Musculoskelet Neuronal Interact 2000"],
  },
  gluteal: {
    picks: ["gluteal"], name: "Buttock muscles (gluteals)", domain: "musculoskeletal", indicators: [], step: "movement",
    does: "Straighten and steady the hip when you stand and walk.",
    space: "Postural muscles that work against gravity on Earth do little in weightlessness.",
    sources: ["NASA HRP: risk of impaired performance due to reduced muscle mass"],
  },
  calf: {
    picks: ["calf"], name: "Calf muscles", domain: "musculoskeletal", indicators: [], step: "movement",
    does: "Point the foot and push off when you walk.",
    space: "Calf muscle volume fell by about 10-15 % after six months on the ISS despite exercise.",
    sources: ["Trappe et al., J Appl Physiol 2009"],
  },
  trunk: {
    picks: ["trunk"], name: "Core muscles", domain: "musculoskeletal", indicators: [], step: "movement",
    does: "Hold you upright and protect the spine.",
    space: "The deep muscles beside the lower spine get smaller after long flights.",
    sources: ["Chang et al., Spine 2016"],
  },
  radiation: {
    picks: ["radiation"], name: "Space radiation", domain: null, indicators: [], step: "body",
    does: "Charged particles pass through the body (the tracks are illustrative).",
    space: "Raises long-term risks such as cancer. Your dosimeter logs the dose; AstroBone never turns dose into a health status.",
    sources: ["NASA HRP: space radiation"],
  },
});

export const bodyPartFor = pick => Object.entries(BODY_PARTS).find(([, part]) => part.picks.includes(pick))?.[0] ?? null;

// Today's status for one part from a self-check evaluation: its domain's status and each watched indicator.
export function bodyPartStatus(partKey, evaluation) {
  const part = BODY_PARTS[partKey];
  if (!part) return null;
  const domain = part.domain ? evaluation?.domains.find(d => d.key === part.domain) ?? null : null;
  const rows = part.indicators.map(key => domain?.indicators.find(r => r.key === key)).filter(Boolean);
  return { part, status: part.domain ? domain?.status ?? "notChecked" : null, domainLabel: domain?.label ?? null, rows };
}

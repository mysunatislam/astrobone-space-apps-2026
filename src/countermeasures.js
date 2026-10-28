// What helps: general guidance for each self-check domain, drawn from NASA Human Research Program
// evidence and published spaceflight studies. It tells the astronaut which part of their mission plan
// supports that system and why. It never names a medicine, a dose or a new exercise prescription;
// the crew medical officer and flight surgeon decide on any treatment.
export const GUIDANCE_BOUNDARY = "General guidance from spaceflight research. Follow your mission's countermeasure plan; your crew medical officer decides on any treatment.";

export const GUIDANCE = Object.freeze({
  musculoskeletal: {
    title: "What helps bone and muscle",
    helps: [
      "Do every scheduled resistance and treadmill session. On the ISS, high-load resistance exercise with enough energy and vitamin D kept bone mineral density close to preflight.",
      "Tell your crew medical officer about missed sessions or new joint pain, so the plan can be adjusted.",
      "Do the knee test at the same time and in the same position each day, so a change means a real change.",
    ],
    sources: ["Smith et al., J Bone Miner Res 2012 (ARED and nutrition on the ISS)"],
  },
  cardiovascular: {
    title: "What helps the heart and circulation",
    helps: [
      "Keep your aerobic sessions on the treadmill or cycle. Aerobic capacity fell early in long flights and recovered with in-flight exercise.",
      "Before landing or any return to gravity, follow your fluid-loading and compression-garment plan and stand up slowly: heart rate on standing was higher on landing day.",
      "Measure blood pressure seated after 5 minutes of rest, at the same time each day.",
    ],
    sources: ["Moore et al., J Appl Physiol 2014 (peak oxygen uptake in flight)", "Lee et al., Front Physiol 2020 (landing-day stand test)", "AHA home blood pressure guidance"],
  },
  metabolic: {
    title: "What helps blood sugar and nutrition",
    helps: [
      "Eat your full planned menu and drink your planned fluids. Astronauts often eat less than they need in flight.",
      "Keep exercising: working muscles take up sugar from the blood.",
      "Measure fasting blood sugar before breakfast, so readings compare like with like.",
    ],
    sources: ["Hughson et al., Am J Physiol Heart Circ Physiol 2016 (insulin resistance in flight)", "NASA HRP evidence on inadequate nutrition (Smith, Zwart and Heer)"],
  },
  behavioral: {
    title: "What helps sleep, mood and attention",
    helps: [
      "Protect your sleep window: keep the same schedule and use the cabin lighting's pre-sleep setting where there is one. Astronauts averaged about 6 hours of sleep on the ISS.",
      "Talk to someone. Scheduled family calls and private conferences with the mission psychologist exist for this.",
      "If lapses stay high, ask to move demanding tasks such as robotics or spacewalk preparation to when you are most alert.",
    ],
    sources: ["Barger et al., Lancet Neurol 2014 (sleep in spaceflight)", "Basner et al., Acta Astronautica 2011 (PVT-B)", "NASA HRP: isolation and confinement"],
  },
  immune: {
    title: "What helps the immune system",
    helps: [
      "Clean your hands before eating and after exercise, and keep cuts clean and covered.",
      "Report new symptoms early. Dormant viruses such as herpes viruses reactivate more often in flight.",
      "Sleep, nutrition and exercise all support immune function in flight.",
    ],
    sources: ["Crucian et al., Front Immunol 2018 (immune dysregulation and countermeasures)"],
  },
});

export const guidanceFor = domain => GUIDANCE[domain] ?? null;

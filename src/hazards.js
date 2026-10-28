// NASA Human Research Program: the five hazards of human spaceflight (nasa.gov/hrp/hazards, names as
// NASA writes them) and which self-check indicators watch for their effects. Radiation and distance
// have no daily body measurement: dose is logged as context, and distance sets the escalation ladder.
export const HRP_HAZARDS = Object.freeze([
  { key: "radiation", name: "Space Radiation", effect: "Raises long-term risks such as cancer. No daily body measurement shows it.",
    domains: [], indicators: [], context: "Your dosimeter reading is logged beside your results as context. AstroBone never turns dose into a health status." },
  { key: "isolation", name: "Isolation and Confinement", effect: "Sleep loss, fatigue, low mood and slower reactions build up over long missions.",
    domains: ["behavioral"], indicators: ["sleepHours", "fatigue", "mood", "stress", "pvtSpeed", "pvtLapses"] },
  { key: "distance", name: "Distance from Earth", effect: "Help from Earth is delayed or out of reach, so the crew must spot problems and act first.",
    domains: [], indicators: [], context: "Sets who you contact and how fast, for the place you choose (space station, Moon, Mars)." },
  { key: "gravity", name: "Gravity Fields", effect: "Bone and muscle loss, fluid shifts toward the head, a warmer body at rest, and dizziness on return to gravity.",
    domains: ["musculoskeletal", "cardiovascular"], indicators: ["kneeExtension", "kneeRom", "restingHr", "systolicBp", "diastolicBp", "bodyTemp"] },
  { key: "environment", name: "Hostile/Closed Environments", effect: "Recycled air, microbes shared in a closed cabin and a fixed food system.",
    domains: ["immune", "metabolic", "cardiovascular"], indicators: ["spo2", "glucose", "bodyTemp"], context: "The immune symptom checklist watches for infection." },
]);

export const hazardsForIndicator = key => HRP_HAZARDS.filter(h => h.indicators.includes(key));
export const hazardsForDomain = domain => HRP_HAZARDS.filter(h => h.domains.includes(domain));

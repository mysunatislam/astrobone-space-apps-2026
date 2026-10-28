// Where the astronaut is decides who can help and how fast. The same self-check result leads to a
// different next step on the ISS, where a flight surgeon answers in real time and Earth is about a day
// away, than on Mars, where every question to Earth waits minutes for an answer and the crew must act
// first (NASA's Earth-independent medical operations). Delays are one-way light time: the Moon is
// about 384,400 km away (1.3 s); Mars is 3 to 22 min away depending on where the planets are.
export const ENVIRONMENTS = Object.freeze([
  { key: "station", label: "Space station", place: "ISS, low Earth orbit", gravity: "Microgravity", gravityG: 0, delaySec: [0, 1], delayText: "under 1 s",
    earth: "Return to Earth is possible within about a day.",
    reviewText: "send it to your flight surgeon for your next private medical conference",
    surgeon: "Mission Control's flight surgeon can join in real time.",
    now: "Call Mission Control as well; the flight surgeon can talk you through it live." },
  { key: "lunarTransit", label: "Spacecraft", place: "Orion, Earth-Moon transit", gravity: "Microgravity", gravityG: 0, delaySec: [1.3, 1.3],
    earth: "Earth is about 3 days away.",
    surgeon: "The flight surgeon can join live, with about 2.6 s between speaking and hearing the reply." },
  { key: "lunarBase", label: "Lunar base", place: "Surface habitat on the Moon", gravity: "1/6 g", gravityG: 0.17, delaySec: [1.3, 1.3],
    earth: "Earth is at least 3 days away.",
    surgeon: "The flight surgeon can join live, with about 2.6 s between speaking and hearing the reply." },
  { key: "rover", label: "Rover", place: "Pressurized rover, away from the base", gravity: "1/6 g", gravityG: 0.17, delaySec: [1.3, 1.3],
    earth: "You are away from the base's medical supplies, and Earth is at least 3 days away.",
    surgeon: "The flight surgeon can join live, with about 2.6 s between speaking and hearing the reply.",
    now: "Stop the drive and start back toward the base if your crew medical officer agrees." },
  { key: "marsTransit", label: "Spacecraft", place: "Earth-Mars transit", gravity: "Microgravity", gravityG: 0, delaySec: [180, 1320],
    earth: "There is no return to Earth for months.",
    surgeon: "Advice from Earth arrives at least twice the one-way delay later, so the crew decides first." },
  { key: "marsBase", label: "Mars base", place: "Surface habitat on Mars", gravity: "3/8 g", gravityG: 0.38, delaySec: [180, 1320],
    earth: "There is no return to Earth for months, and contact stops for about two weeks at solar conjunction.",
    surgeon: "Advice from Earth arrives at least twice the one-way delay later, so the crew decides first." },
].map(env => Object.freeze({ ...env, delayText: env.delayText ?? delayText(env.delaySec), reviewText: env.reviewText ?? defaultReview(env) })));

function delayText([min, max]) {
  const one = s => (s < 60 ? `${s} s` : `${Math.round(s / 60)} min`);
  return min === max ? one(min) : `${one(min).replace(/ min$/, "")}-${one(max)}`;
}
function defaultReview(env) {
  return env.delaySec[1] < 60 ? "send it to your flight surgeon today" : `send it to your flight surgeon now; the message takes ${delayText(env.delaySec)} to reach Earth`;
}

export const environmentFor = key => ENVIRONMENTS.find(env => env.key === key) ?? null;
// Elena is on her way to Mars; a person using the app on Earth tries it as if on the station.
export const DEFAULT_ENVIRONMENT = Object.freeze({ elena: "marsTransit", you: "station" });

// Escalation ladder: self-care, a logged review, the crew medical officer today, or now.
export const ESCALATION = Object.freeze([
  { level: 0, key: "self", title: "Self-care", who: "You" },
  { level: 1, key: "log", title: "Logged for review", who: "Flight surgeon" },
  { level: 2, key: "cmo", title: "Crew medical officer today", who: "Crew medical officer" },
  { level: 3, key: "now", title: "Contact now", who: "Crew medical officer, then Earth" },
]);
const LEVEL = { urgent: 3, attention: 2, changed: 1 };
export const escalationLevel = overall => LEVEL[overall] ?? 0;

// The ladder for one result in one place: every rung worded for that environment, the active one marked.
export function escalationPlan(overall, env) {
  const level = escalationLevel(overall);
  const detail = {
    self: "Keep your routine. Next self-check in 24 h.",
    log: `Re-check in 24 h and ${env.reviewText}.`,
    cmo: `Repeat the measurement and tell your crew medical officer today. ${env.surgeon}`,
    now: `Your crew medical officer leads with the onboard emergency procedure. ${env.now ?? env.surgeon} ${env.earth}`,
  };
  return { level, environment: env, steps: ESCALATION.map(step => ({ ...step, active: step.level === level, detail: detail[step.key] })) };
}

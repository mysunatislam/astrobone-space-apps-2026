// The guided demo is the whole mission simulation for Elena, a fictional astronaut, split into chapters.
// Every chapter can be opened on its own (src/twinApp.js prepares its starting point). Playback never
// writes a personal record: demo checks stay in the separate demo profile.
export const DEMO_CHAPTERS = Object.freeze([
  { title: "Baseline and spaceflight change", description: "Day 1 locks Elena's personal baseline. The twin shows model-estimated bone change and her synthetic heart rate over the first 90 days." },
  { title: "Prediction against observation", description: "A functional knee check on Day 120, then the model's Day 147 prediction against what was observed." },
  { title: "Gather health indicators", description: "The daily self-check. Poor framing fails the quality gate, so no movement estimate enters the comparison; the repeat passes." },
  { title: "Reaction, sleep and body", description: "The 3-minute reaction test (PVT-B), sleep and mood answers, and typed vital signs, each labelled with its source." },
  { title: "Evaluate and act", description: "Usable observations are compared with Elena's earlier comparable checks. A change is a reason for review, not a diagnosis. The demo check is saved to the demo profile only." },
  { title: "My Health and the crew", description: "Her whole check on one screen, then the crew view a medical officer or flight surgeon sees, most serious first." },
  { title: "Where the crew is", description: "The same result on the space station and on the way to Mars: who acts first depends on how far away Earth is." },
  { title: "The body and an unexpected event", description: "Tap a bone to learn what spaceflight does to it, then a reconstructed impact, a 10,000-run Monte Carlo and the post-event check." },
  { title: "Inspect the evidence", description: "NASA sources, population labels and what was tested on real people. External research explains the check; it does not describe your health or validate the camera." },
]);

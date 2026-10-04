# UI And Visual Experience Requirement

Added 2026-10-03 as direction for the interface. Implemented 2026-10-04 as a separate page, `twin.html` (see Part 3).

Part 1 is the requirement as supplied. Part 2 maps each visual to the state, solver or asset that exists in this repository, and lists where the requirement's example values or wording conflict with the existing model contract. Part 3 records what was built and how each conflict was resolved. **Where Part 1 and Part 2 disagree, Part 2 wins.** The example numbers in Part 1 show layout only; real values come from the code named in Part 2.

## Part 1: Requirement

### Critical Requirement

The AstroBone interface must NOT look like a normal healthcare dashboard. It should feel like an advanced NASA biomedical digital-twin command center: dynamic, immersive, glowing, interactive, cinematic, and visually impressive enough that judges immediately understand they are looking at a real-time digital astronaut simulation.

The visual experience is a major part of the project. However, do NOT sacrifice scientific clarity for decoration. The UI should communicate:

> living digital human + physiological simulation + mission timeline + real-time risk analysis

rather than cards and charts.

### Central 3D Digital Astronaut

The main dashboard contains a large interactive 3D model of Elena at the center. Elena's body should:

- rotate slowly when idle
- allow mouse/touch drag rotation
- support zoom
- support anatomical-layer switching
- animate smoothly between systems
- glow according to physiological state
- highlight organs dynamically
- highlight skeletal regions dynamically
- support localized injury visualization
- respond visually when mission time changes
- respond visually when an impact event occurs

The body should feel alive, not static. Suggested tools: Three.js, React Three Fiber, Drei, GLSL shaders where useful, GSAP or Framer Motion, careful post-processing, WebGL. Prefer performance over unnecessary graphical complexity. (See Part 2, "Stack".)

**Elena is the navigation system.** Instead of clicking menu cards: clicking her heart opens cardiovascular analysis, clicking the tibia opens the bone twin, clicking the kidneys opens renal biomarkers, clicking the radiation particles opens exposure analysis. AstroBone should feel like a digital twin, not a dashboard with a 3D model pasted in the middle.

### Idle Rotation

- One 360° rotation every ~20–35 seconds.
- Smooth, subtle, premium, not distracting.
- Interaction pauses auto-rotation; it resumes after a short period of inactivity.

### Visual Style

Dark deep-space background (near-black / midnight blue) with cyan, electric blue, violet, subtle magenta, and occasional amber/red for warnings. Luminous elements rather than flat colors.

Visual language: glass panels, transparent overlays, soft neon borders, glowing anatomical structures, volumetric-style lighting where practical, dynamic particles, subtle grids, orbit lines, animated data streams, mission trajectories, translucent plots, holographic-style biological layers.

Not a cheap cyberpunk dashboard. It should read as NASA + biomedical simulation + premium scientific visualization.

### System Modes

Selectable modes: **BODY, SKELETON, MUSCLE, CARDIOVASCULAR, RENAL, RADIATION, MULTISYSTEM.** At minimum support skeletal, cardiovascular, lungs, kidneys, muscular; brain optional; vascular network where feasible. When a system is selected, irrelevant layers fade and the selected system illuminates.

#### Skeletal

- Fade the skin/body shell to ~10–25% opacity and reveal the skeleton.
- Emphasize femur, tibia, pelvis, lumbar spine, hip region.
- Bone color responds to modeled state: healthy/high capacity → cool cyan/blue; moderate deterioration → yellow/orange; high-risk region → red.
- Colors visualize model estimates. Do NOT imply diagnostic imaging.

#### Dynamic Bone Degradation

As the timeline moves Day 1 → 30 → 60 → 90 → 120, the skeleton updates (e.g. Day 1 strong uniform cyan; Day 120 subtle yellow/orange in lower-extremity bones based on predicted deterioration). This visualizes the digital-twin prediction, not microscopic bone loss. Label: **MODEL-ESTIMATED SKELETAL CHANGE**.

#### Cardiovascular

- Reveal heart, major vessels, and an animated blood-flow effect (subtle luminous particles/pulses).
- The heart contracts at Elena's current modeled or measured HR (72 BPM → ~72 beats per minute of animation). If HR changes, the pulse responds.
- It need not be an electromechanical heart simulation, but must be synchronized to the HR value.
- Display: current HR, baseline HR, ΔHR, rPPG confidence, model vs observed.
- No ECG unless actual ECG data exist.
- Glow intensity may rise with cardiovascular stress; no dramatic red flashing unless an alert condition exists.

#### Renal / Urinary

Highlight the kidneys and show an animated explanatory pathway beside the body:

> SKELETAL UNLOADING → MODELED MINERAL MOBILIZATION → URINARY CALCIUM TREND → RENAL-STONE-RISK PROXY

#### Muscle

Independently selectable. Highlight quadriceps, hamstrings, gluteals, calves, trunk. During the standardized squat/knee-extension test, relevant muscles may softly pulse. Do NOT claim muscle force is measured unless calculated/estimated.

#### Radiation

- Show Elena inside a simplified 3D space environment with incoming particles/trajectories (animated particles, rays, density variation) that intersect the body without looking cartoonish.
- Overlay: current mission exposure, cumulative exposure, mission day, modelled biological burden.
- When viewing an organ/system, indicate modeled exposure/risk by glow intensity.
- MODELLED RISK ≠ DIRECT MEASUREMENT.

#### Multisystem

One of the most impressive views. Elena rotates slowly with internal systems as semi-transparent layers: skeleton cyan, heart/vessels luminous red/magenta, kidneys violet, muscle muted orange, radiation as external particles. Do not overload; use depth, transparency and selective illumination.

Orbiting or connected nodes: MUSCULOSKELETAL, CARDIOVASCULAR, IMMUNE, RENAL, RADIATION, FUNCTIONAL. Each shows current state, change from baseline, and confidence. Clicking a node zooms into that system.

### Organ Focus Transitions

Clicking a system triggers a cinematic 600–1200 ms transition, never a page reload. Cardiovascular example: camera moves toward Elena → exterior becomes translucent → skeleton fades slightly → heart illuminates → camera zooms to thorax → heart begins beating → major vessels illuminate → cardiovascular charts slide in. Same principle for kidney, tibia, femur, spine, muscles.

### Impact Lab

#### Event Reconstruction

Example: Mission Day 120, an object strikes Elena's left tibia. Animate:

> OBJECT TRAJECTORY → IMPACT POINT → LOAD TRANSFER → TIBIA MODEL → STRESS PROPAGATION

Camera zooms from whole body to the leg; skin and muscle fade; the tibia becomes the focal object. Animate the object trajectory with floating parameters (mass, velocity, impact angle, contact area). The animation stops at impact with a brief expanding shock/load visualization. Label: **RECONSTRUCTED EVENT**. Do not imply biological footage.

#### Structural Simulation

After impact, show a 3D stress/strain map on the affected bone with a blue → cyan → green → yellow → orange → red scale and a legend (LOW STRESS … HIGH STRESS). The distribution must come from the actual simulation result wherever possible. Do NOT paint a random red area.

#### Damage Wording

Never show "MICROCRACK DETECTED". Use wording such as "PREDICTED MICRODAMAGE HOTSPOT" or "LOCAL STRUCTURAL DAMAGE RISK" (see Part 2, conflict 7). Show a magnified view of the highest-risk region (whole tibia → zoom → cortical region → highlighted hotspot). Do not render a literal crack unless an actual structural model produces one.

#### Monte Carlo

Not just a static histogram. Simulation particles/runs stream through the model and converge into a distribution, with run count and outcome buckets, then the real probability plot beside it. The streaming animation is decorative; **the numbers must come from the deterministic Monte Carlo engine.**

### Mission Timeline

A draggable timeline at the bottom of the main screen (DAY 1 ━ DAY 30 ━ DAY 60 ━ DAY 90 ━ DAY 120). As it moves: body, organ states, plots, skeleton visualization, heart rate, accumulated radiation, biomarkers, physiological cards and confidence indicators all update. It should feel like moving through Elena's mission.

**Time-travel effect:** when scrubbing quickly, show a subtle transition around Elena (day counter updating, particles increasing, bone state gradually changing, graphs drawing themselves). No warp-speed effect.

### Baseline Vs Current

Day 1 vs current, side by side or as a ghost overlay. Skeleton: Day 1 as transparent cyan ghost, current as state glow. Movement: overlaid pose paths. Metrics shown as before → after pairs (knee, hip, velocity, function). The body itself should communicate change.

### Predicted Vs Observed

A major visual mode: the predicted digital-twin trajectory as a luminous curve, camera assessments as measurement points. One of the most important scientific visualizations in AstroBone.

### Functional Scan (Camera)

- Live-analysis scene: left is live video with pose skeleton, joint points, joint-angle arcs and motion path; right is 3D Elena.
- **Live twin sync:** map pose landmarks to the avatar so Elena performs the same squat/knee extension. Show LIVE TWIN SYNC, tracking quality, FPS, joint angles. Major demo feature if time allows.
- **Post-impact assessment:** pre-event vs post-event motion with both paths overlaid, differences highlighted (left knee ROM, movement velocity, symmetry), affected limb highlighted.

### Glow And Confidence Encoding

Glow encodes information; not everything glows equally. Normal: subtle. Selected: bright. Changing: animated pulse. Warning: amber. Elevated: orange. Critical modeled risk: red. Unknown/low confidence: desaturated/dim.

Every modeled result has a visible quality indicator, encoded visually as well as numerically: high quality solid/sharp, low quality more transparent.

### Floating Data Panels

Small glass panels around the body, ~4–6 values at a time (e.g. mission day, bone capacity, functional score, heart rate, radiation, renal monitor), changing with the selected system. No walls of 20 panels.

### Dynamic Background

Faint star field, slow particles, coordinate grid, orbit curves, slowly rotating mission geometry. Never distracting; the body stays the focus.

### Page Structure

1. **Mission Control:** rotating Elena, overall state, timeline, multisystem status.
2. **Digital Twin:** full anatomical exploration, system selection, organ inspection, mission time.
3. **Functional Scan:** camera pose assessment, live avatar mirroring, joint metrics, baseline comparison.
4. **Impact Lab:** event reconstruction, impact animation, stress simulation, Monte Carlo.
5. **Physiology:** system views, biomarkers, trends, predicted vs observed.
6. **Evidence:** NASA dataset provenance, model sources, quality, citations.

### Landing View

Dark screen → "ASTROBONE / DIGITAL PHYSIOLOGICAL TWIN" → Elena's glowing silhouette appears → skeleton and organs illuminate in sequence → mission data appears (ELENA / SYNTHETIC ASTRONAUT / MISSION DAY / DIGITAL TWIN ONLINE) → rotating interactive body. 2–4 seconds maximum, not forced on every visit. Ambient sound optional and off by default.

### Guided Demo

Button **START MISSION SIMULATION**: Day 1 baseline scan → timeline moves → Day 30 minor adaptations → Day 60 multisystem changes → Day 90 increased changes → Day 120 functional assessment → UNEXPECTED EVENT (trajectory, IMPACT DETECTED, zoom to tibia) → STRUCTURAL SIMULATION RUNNING (stress map) → MONTE CARLO (run count, result) → POST-EVENT FUNCTIONAL TEST (pose comparison, updated assessment) → closing card: **ASTROBONE — PREDICT. OBSERVE. UPDATE. PROTECT.**

### Real Simulation Requirement

Every visual is driven by real numerical code wherever feasible: heart animation ← HR variable; radiation particles ← accumulated-dose variable; bone color ← bone-state variable; stress map ← structural solver output; Monte Carlo result ← Monte Carlo engine; joint motion ← pose-estimation output; timeline ← digital-twin state at time t. No disconnected fake animations.

### Assets

Anatomically recognizable GLB/GLTF, separated into layers where useful (body, skeleton, heart, vascular, kidneys, muscles), realistic geometry with stylized scientific materials. Optimize with mesh compression, simplification, texture compression and lazy loading. Never load a hospital-grade dataset that crashes the browser.

### Performance

Runs smoothly on a normal laptop: ~60 FPS where practical, ~30 FPS minimum during complex views. Use LOD, lazy loading, instancing, optimized shaders, compressed meshes, memoization, selective post-processing. Do not destroy performance for glow.

### Priority

- **Must build:** (1) rotating interactive Elena, (2) skeleton layer, (3) mission timeline, (4) dynamic bone-state visualization, (5) live pose tracking, (6) impact visualization, (7) structural stress map, (8) Monte Carlo visualization, (9) predicted vs observed chart.
- **Should build:** (10) beating heart, (11) major vessels, (12) kidneys, (13) radiation particles, (14) muscle layer, (15) live 3D pose mirroring.
- **Optional:** (16) organ deformation, (17) detailed fluid simulation, (18) cellular-level visualization.

Do not spend competition time on cinematic effects instead of functional simulations.

### Final Principle

A judge should understand AstroBone before reading much text: a living computational model of an astronaut, rotating at the center; time can be moved; the skeleton changes; the heart beats; systems respond; camera observations update the twin. When an accident occurs, they watch the software move from **EVENT → PHYSICS → STRUCTURAL SIMULATION → FUNCTIONAL OBSERVATION → RISK UPDATE.**

Visually extraordinary, but every important animation corresponds to a real state, calculation, measurement, or explicitly labeled simulation. Immersive, luminous, premium, scientific, aerospace-grade, memorable.

## Part 2: Grounding In This Repository

### Stack

Part 1 suggests React Three Fiber, Drei, GSAP and Framer Motion. The app is Vite plus vanilla `three@0.168` with no React, and [mission-intelligence.md](mission-intelligence.md) records that no framework migration was made. Do not migrate before October 7. The current stack covers what is needed:

- Idle rotation: the mission scene in `src/missionHuman.js` already uses `OrbitControls`, which has built-in `autoRotate`. `autoRotateSpeed = 2` is about 30 s per revolution. Pass the frame delta to `controls.update(delta)` so speed does not depend on frame rate. Pause on the controls' `start` event and resume after a few seconds of inactivity.
- Glow: `EffectComposer` + `UnrealBloomPass` from `three/examples/jsm/postprocessing`, applied selectively so only lit systems bloom.
- Transitions: extend the existing hand-written 550 ms camera/layer tweens to the 600–1200 ms range. GSAP is optional and adds a dependency.

Do not put NASA logos or insignia on the interface. "NASA-grade" is a style reference, not an affiliation claim.

### Where Each Visual Gets Its Numbers

| Visual | Driving value | Source today | Status |
| --- | --- | --- | --- |
| Timeline, mission day | `ELENA.observations[].day` | `src/elenaMissionScenario.js` | Exists: Days 1, 30, 60, 90, 120, 147, 180, 240. Days 180 and 240 are authored scenarios, not forecasts |
| Knee extension, knee ROM | `kneeExtension`, `kneeRom` | same fixture, `SYNTHETIC DEMO` | Exists |
| Heart beat rate | `heartRate` (synthetic), or `bpm` from `estimatePulse` / `PulseCapture` | fixture; `src/rppg.js` for live camera | Exists. rPPG also returns `quality` and a measured `waveform` |
| Radiation particle density | `absorbedDose` (mGy, cumulative) plus `event.increment` | fixture | Exists. Illustrative dosimeter history |
| Bone color | microgravity capacity-loss fraction `min(days / 30.4375 × 0.0125, 0.30)` | `calculateRisk` in `src/riskModel.js` | Exists, uniform across bones (conflict 8) |
| Impact parameters | `calculateRisk` inputs and outputs | `src/riskModel.js` | Exists |
| Stress map | no spatial field exists | Level-A gives one scalar contact stress; `src/mechanicsV2.js` gives cross-section bounds and is `reference-kernel-not-active` | **Gap** (conflict 6) |
| Monte Carlo | precomputed 5,000 runs, seed 24072026 | `public/simulations/astrobone-level-a-v1.json` | Exists (precomputed) |
| Live twin sync | pose landmarks to rig bones | `SkeletalRetargeter` in `src/skeletalRetargeter.js`; [live-retargeting.md](live-retargeting.md) | Exists in Research Lab |
| Skeleton and muscles | 277 bones, 683 muscle structures, 64 joints (10.5 MB) | `public/models/anatomy/musculoskeletal-rigged.glb` | Exists |
| Heart and vessels | atria, ventricles, valves, named arteries and veins; 358,819 triangles, 2.3 MB | `public/models/anatomy/cardiovascular.glb` | Exists |
| Kidneys | renal arteries only, no kidney mesh | cardiovascular atlas | **Gap** |
| Lungs, brain | pulmonary arteries only, no lung or brain mesh | none | **Gap** |
| Predicted function curve | no functional prediction model | none | **Gap** (conflict 9) |
| Hip angle, movement velocity, symmetry, function score | not in the Elena fixture | none | **Gap** |
| Renal calcium pathway values | no calcium or urinary data | none | **Gap.** Conceptual diagram only |
| Radiation biological burden, per-organ dose | no model; dose explicitly does not imply injury | none | Do not show |
| "Confidence" | `trackingQuality`, `heartQuality`: input-quality indicators, not accuracy | fixture | Exists; label as quality (conflict 14) |

### Conflicts To Resolve Before Building

1. **Example numbers.** The requirement's HR 72→81, knee 138°→126°, hip 74°→69°, velocity 1.00×→0.89×, function 96→87, bone capacity −7.2%, and post-impact 138°→121° / 0.76× / 96%→81% match nothing in the fixture. In the fixture, Day 1→120 is knee extension 165°→157°, ROM 80°→69°, HR 64→72 bpm, dose 0→18 mGy. View code reads from the fixture. New quantities are added there with `SYNTHETIC DEMO` provenance, units and a boundary, never hard-coded in a view.
2. **Mission day.** The requirement ends the timeline and places the impact at Day 120. The fixture's `currentDay` is 147 of 240, Mission Intelligence resets to Day 147, and the README and [mission-intelligence.md](mission-intelligence.md) describe Day 147. Choose one story and update the fixture, docs and demo script together.
3. **Impact mass and angle.** 6.2 kg is outside `RESEARCH_RANGES.massKg` [0.1, 5], so `calculateRisk` marks the result "Outside frozen scope". Use ≤5 kg or show the warning. The reference scenario is 2 kg, 4 m/s, 75°, 60 mm², 8 ms. Every displayed angle states its convention: measured from the surface plane, 90° = normal impact. The Monte Carlo sensitivity field uses the angle from the surface normal; convert, don't mix.
4. **Two capacity definitions.** `MODEL_DEFAULTS.baselineCapacityMPa` is 110 (tissue-level stress proxy, max loss 0.30). The Level-A simulation JSON uses 25 MPa ("effective research-envelope stress proxy", max loss 0.35). A live Monte Carlo through `calculateRisk` defaults will not reproduce the JSON distribution. The animation and the number shown beside it come from one engine and one parameter set, and the screen says which.
5. **Monte Carlo count and buckets.** The existing run count is 5,000. Show "10,000 simulations" only if 10,000 are actually run; `calculateRisk` is cheap enough to do that in the browser with a seeded RNG. Buckets are the existing demand/capacity-ratio (DCR) bands: lower < 0.50, monitor 0.50–0.80, elevated 0.80–1.00, capacity exceeded ≥ 1.00. Never "normal / high damage / failure". Show the JSON's interpretation next to the result: fractions of simulated scenarios under assumed input distributions, not mission-occurrence or clinical probabilities.
6. **Stress map.** Nothing produces a spatial stress field, so a gradient cannot "come from the solver" yet. Options:
   - (a) Evaluate beam-theory stress along the tibia shaft and around its circumference, σ(z, θ) = N/A ± M(z)·c(θ)/I, from the `src/mechanicsV2.js` inputs, and color tibia vertices by axial position and angle. This is a real calculation. Label it "beam-theory estimate, not finite-element analysis". Activating Mechanics V2 requires sourced section geometry in [parameter-evidence-table.md](parameter-evidence-table.md).
   - (b) Without (a), color the whole tibia by its scalar DCR band and show no gradient.
   Never paint a gradient that was not computed.
7. **Damage wording.** There is no damage model, only a demand/capacity ratio. "PREDICTED MICRODAMAGE HOTSPOT" overclaims. Use "PEAK MODELED STRESS REGION" and "DEMAND / CAPACITY RATIO". "LOCAL STRUCTURAL DAMAGE RISK" is acceptable only when shown with the DCR band.
8. **Site-specific bone change.** The capacity-loss rate is one uniform rate, and only the tibia is in research scope (`TARGET_META.femur.inResearchScope` is false). Making lower-extremity bones tint differently requires per-site rates with citations in [parameter-evidence-table.md](parameter-evidence-table.md) first. Until then, bones in scope share one tint and out-of-scope bones stay neutral or desaturated. On a 0–30% loss scale, Day 120 (≈4.9% loss) is only slightly tinted. Show the scale; do not stretch it to make Day 120 look dramatic.
9. **Predicted vs observed.** No functional prediction exists, and the fixture's later checkpoints are authored, not forecasts. Either implement a documented trend extrapolation from prior observations with an interval, labeled as such, or plot the capacity-loss curve on its own axis. Do not present authored scenario values as "predicted".
10. **Radiation.** `absorbedDose` is illustrative dosimeter history in mGy, not effective dose or a transport calculation. There is no organ-dose or biological-burden model. Omit "MODELLED BIOLOGICAL BURDEN" and per-organ exposure glow; show cumulative dose and the event increment only.
11. **Renal.** No kidney mesh and no calcium or urinary data. Until an asset is added, RENAL mode shows the renal arteries and the pathway labeled "physiological pathway from literature, not measured in Elena". A kidney mesh goes through the same pinned-source pipeline as `scripts/build-cardiovascular-atlas.mjs`, with its license recorded in `THIRD_PARTY_NOTICES.md`.
12. **Muscle.** The rig records no muscle activation or force. A highlight during movement means "muscles typically recruited in this movement (reference)", not measured activity.
13. **Heart.** Beat frequency = HR / 60 Hz, applied as a pulse on the atlas heart. Label it a rate-synchronized visualization, not a cardiac simulation. No ECG is acquired, so none is shown. During live capture, the rPPG `waveform` may be shown, labeled as rPPG.
14. **Confidence.** No calibrated confidence exists. The fixture's fields are input-quality indicators. Label them "INPUT QUALITY" and encode them with opacity and saturation as Part 1 asks. Do not show "CONFIDENCE 72%".
15. **State glow.** Only systems with a driving value glow by state. Other systems use a neutral selection glow, so brightness never implies a measurement that does not exist.
16. **Rendering cost.** Idle rotation forces continuous rendering. Today the scene renders on demand and stops when idle, and the multisystem view is about 1.36 M triangles before adding about 0.36 M for the cardiovascular atlas. Measure FPS before adding bloom. Options: a lower-detail idle mesh, a capped pixel ratio, pausing when the tab is hidden or the canvas is offscreen. Honor `prefers-reduced-motion`: no auto-rotation, no intro, instant transitions.
17. **Body as navigation.** Pick by raycasting named meshes and mapping manifest structure names to systems. Keep the existing keyboard-accessible system buttons; clicking Elena is an extra path, not the only one.

### Suggested Order For October 7

1. Rotating Elena: auto-rotate with idle resume in `src/missionHuman.js`. Small.
2. Skeleton layer: exists; add the 10–25% shell fade.
3. Timeline: exists in Mission Intelligence; wire bone tint, heart rate and dose to it.
4. Bone-state color: from the capacity-loss fraction, with the "MODEL-ESTIMATED SKELETAL CHANGE" legend.
5. Beating heart and vessel flow: asset exists, rate comes from HR. Cheap and high impact.
6. Radiation particles: count from cumulative dose. Cheap.
7. Live pose and twin sync: exists in Research Lab; expose it in Functional Scan.
8. Impact visualization: trajectory animation from `calculateRisk` inputs.
9. Monte Carlo: seeded live run or the precomputed JSON, with DCR bands.
10. Stress map: needs conflict 6 option (a). The largest new science work.
11. Predicted vs observed: needs a defined predictor (conflict 9).
12. Kidneys, lungs: need assets.

Each mapping from model state to visual (for example `boneTint(day)`, `beatPeriod(hr)`, `particleCount(dose)`, `dcrBand(ratio)`) should be a pure function with a `node --test` file like the existing modules. That makes the rule "every animation corresponds to real state" testable.

## Part 3: Implementation (`twin.html`)

Open `http://127.0.0.1:5173/twin.html` with `npm run dev` (or `/twin.html` on any build). It is a second Vite page (`vite.config.js`), so the existing `index.html` app and `/#mission-demo` route are unchanged.

| File | Role |
| --- | --- |
| `src/twinModel.js` | Twin state at day t: fixture observations (step to last checkpoint), bone capacity change, tint, beat rate, track count, DCR bands, least-squares trend prediction |
| `src/twinImpact.js` | Impact branch fixture, Level-A event evaluation, seeded Monte Carlo, relative bending-stress field |
| `src/twinScene.js` | Three.js scene: atlas buckets, shaders, depth pre-pass hologram skin, heart/vessel pulses, radiation tracks, impact sequence, picking, camera focus |
| `src/twinApp.js`, `src/twin.css`, `src/twinMain.js`, `twin.html` | Six experiences, system rail, floating panels, multisystem nodes, timeline, intro, guided demo |
| `src/twinModel.test.js` | 16 tests, including the engine checks below |
| `scripts/build-cardiovascular-atlas.mjs` | Now also emits display groups (heart, renal, pulmonary, major, arteries, veins, other) so systems can be lit separately |

### How Part 2's conflicts were resolved

1. **Example numbers:** every displayed value comes from `src/elenaMissionScenario.js` or a calculation. Hip angle, velocity, symmetry and function score are shown as "not recorded".
2. **Mission day:** the twin keeps the fixture's Day 147 story. The impact happens on Day 147, and the authored post-event check is on Day 148.
3. **Impact inputs:** the event reuses the stored Level-A reference inputs (2 kg, 4 m/s, 75° from the surface plane, 60 mm², 8 ms). At 6 months, the browser reproduces the stored DCR of 0.696 exactly (test). At Day 147 the DCR is 0.685, in the MONITOR band.
4. **Capacity definition:** the twin uses the Level-A effective capacity (25 MPa) throughout and shows the calculator's out-of-range warning.
5. **Monte Carlo:** 10,000 seeded `calculateRisk()` runs. An engine check runs the stored envelope distributions and matches the stored 5,000-run fractions within sampling error (test tolerance 2 percentage points). Results use DCR bands and the stored interpretation sentence.
6. **Stress map:** option (a). Relative Euler–Bernoulli bending stress σ/σmax on the atlas left tibia: pinned ends, Level-A normal force at the impact, section from mesh slices. Shape only, labeled not finite-element.
7. **Damage wording:** "PEAK MODELED STRESS REGION" with "not a detected crack".
8. **Bone tint:** a uniform B-05 rate on six weight-bearing regions. The scale is 0 to −10 % (about the Day 240 value) and is shown in the legend, desaturated for low evidence. Red is never used for bone tint.
9. **Predicted vs observed:** a least-squares trend with a 95 % prediction interval, fitted only to earlier observations. Day 147 falls inside the interval. The authored Day 148 post-event value falls outside it and is flagged for human review.
10. **Radiation:** tracks appear only in the Radiation view, 2 per mGy of synthetic dose, and are labeled illustrative. Biological burden is shown as "not modeled".
11. **Renal:** renal vessels plus a literature pathway in which only the first step has a value.
12. **Muscle:** Muscle view shows the full atlas muscular system (683 structures, including the hands) as shaded tissue. Fascia sheets are hidden. Key groups are labeled "typically recruited, not measured activation".
13. **Heart:** pulse frequency = HR / 60. No ECG and no "model vs observed" claim.
14. **Confidence:** shown as input quality (fixture) or parameter evidence level (B-05: low). Lower values render dimmer.
15. **State glow:** only state-driven layers change color (bone tint, heart pulse, stress map). Bloom is restrained so color carries data rather than decoration.
16. **Performance:** measured 7.4 ms/frame (~136 FPS) at 1440×900 with bloom on an RTX 3050 laptop GPU. Adaptive quality lowers pixel ratio, then disables bloom, if a sustained frame rate falls below 30 FPS. Throttled background frames are ignored. Reduced motion disables auto-rotation, the intro and transitions.
17. **Navigation:** clicking the left tibia opens Impact Lab; the heart or vessels open cardiovascular physiology; renal vessels open the renal pathway; radiation tracks open radiation; key muscles open Functional Scan; other key bones focus the skeleton. The system rail and tabs remain keyboard-accessible.

### Not built

- Live camera mirroring inside `twin.html`. Functional Scan links to the existing Movement capture workspace, which already retargets MediaPipe pose to the rig.
- Kidney, lung and brain tissue (not in the atlas).
- A spacecraft hull around Elena in Radiation view.
- Ambient sound.

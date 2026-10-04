# Mission Intelligence

Local revision: 2026-10-03. Route: `/#mission-demo`.

## Inspected Implementation

The existing Vite/Three.js application, rigged anatomical GLB, skeletal retargeter, MotionGuard, health layers, browser companion, quality comparator, saved X-ray output and prepared OSDR summaries were inspected before implementation. The Research Lab remains intact. No framework migration, new model download, APK build, public deployment or database migration was required.

| Category | Actual implementation |
| --- | --- |
| Measured / user-entered | Consented camera aggregates and manually entered sensor context remain in Research Lab. They are not loaded into Elena's presentation. |
| Synthetic demo | `src/elenaMissionScenario.js`: fictional identity, mission, every checkpoint value, quality indicators and the tabletop dose increment. Each authored field has provenance, unit and boundary. |
| Derived | `missionIntelligenceState.js` reuses the protocol/source/gravity/calibration-aware movement comparator and matched cardiovascular series. Differences are arithmetic, not trained risk predictions. |
| NASA research | Prepared OSD-804 mouse microCT, OSD-575 Inspiration4 serum panel, OSD-435 mouse irradiation/cardiac data, OSD-569 blood counts and OSD-656 urine immune assays. External populations only. |
| Model output | Saved FracAtlas DenseNet121 score and U-Net++ mask. Precomputed, uncalibrated, not Elena's image or live inference. |
| Visualization | Z-Anatomy/BodyParts3D reference bones, muscles, heart and vessels; generic outer-surface mesh; schematic exposure envelope. Not internal measurements. |
| Reference physiology | Separate published Physiome left-heart/Windkessel equations; pressure, volume and flow traces, numerically checked but not clinically validated or calibrated to a person. |
| AI | Existing camera ML, optional local Ollama companion and research integrations remain available separately. Presentation Astra is fixed structured output plus local source lookup, not an LLM or independent agents. |
| Validation | Engineering unit/UI/data tests exist. Independent clinical validation, mission qualification and individual joint-angle accuracy are not established. |

## Shared State And Isolation

`missionIntelligence.js` holds selected day, system, evidence node, event, communication demo flag and Scenario Lab options. The pure state module derives all observations, gates and assistant answers. The original saved profiles are not read or modified. Reset returns Day 147, multisystem view, no event, no what-if overrides, no assistant response or pending playback. Later Days 180/240 are authored scenarios, not forecasts.

Day 147 fixture: knee extension 165 to 151 degrees (-14); resting heart-rate illustration 64 to 76 bpm (+12); cumulative absorbed-dose illustration 22.05 mGy. These numbers are **not NASA findings or acquired instrument data**. The event adds one centrally defined +10 mGy context increment at/after its selected day, without changing the authored dosimeter history. It does not imply radiation injury.

Eight actual gates: input availability, explicit synthetic provenance, compatible baseline, movement quality, cardiovascular input, availability of all three core NASA sources, fixed output scope, external data separation. Two added human-assay datasets are counted separately and cannot substitute for missing core sources. Pass counts come from evaluated gate results. Four separately retained limitations cover accuracy, causality, unmeasured physiology and reference anatomy. Gates are engineering safeguards, not clinical safety certification or a general scientific-claim verifier.

## Source Lineage

The Data Origin panel traces OSDR metadata and research artifacts through deterministic preparation to bundled summaries and current local lookup. OSD-804's source hash was compared with the existing prepared summary. OSD-575/435 hashes were recorded during preparation; they were **not** authenticated against an independent publisher checksum. No new NASA API call occurs on timeline movement. See `mission-health-data.md` and `scripts/build_mission_research.py` for actual artifacts, transformations and exclusions.

Only loaded in-memory summaries are available without network during the current page session. The Earth-link toggle is a scenario flag, not a network test. It never sends a report. This revision does not add a service worker or guarantee a cold offline reload. Missing evidence is shown as unavailable, never fabricated.

## Controls

- Timeline: eight checkpoint buttons, keyboard-accessible slider, play/pause and jump to Day 147.
- Human systems: multisystem, outer body, skeletal, muscular, cardiovascular, radiation context and movement. Orbit by dragging. Cardiovascular selection briefly frames the thorax.
- Why: seven-step auditable observation/tool/result/verification pathway. No hidden chain-of-thought or fake agent execution.
- Evidence graph: selectable source-family nodes; links indicate review relevance, not biological causation.
- Data Origin: API/artifact links, hashes, preparation and scope.
- Scenario Lab: quality, sensor and evidence failure; alternate extension/dose; day and simulated communications. The main mission record is unchanged.
- Astra: evidence, missing inputs, recheck, baseline comparison. Unsupported questions abstain in the pure answer function; there is no unrestricted chat.
- Handoff: current state, arithmetic, gates, limitations, NASA/raw-file references, separate external X-ray metadata and complete synthetic source; JSON download.
- Play demo: ten 5-second steps ending in handoff; Stop demo cancels. Interactive controls remain available.
- Shift+D: presenter controls. Reset demo clears transient state and closes dialogs/logs.
- Research Lab: returns to the existing health-review and technical tools; camera/video capture remains separate.

## Performance And Limitations

The new reference scene renders on demand. Layer/camera transitions run for 550 ms; reduced-motion skips them. Hidden scenes stop rendering. GPU resources, observers and listeners have explicit disposal; failed 3D loading leaves the review usable. The outer GLB loads only when selected. No lungs/brain assets were present; none are presented as recovered anatomy.

The atlas is large (roughly 1.36 million rendered triangles in multisystem); idle rendering stops but this is not yet a low-end-device benchmark. The existing main bundle still exceeds Vite's 500 kB warning threshold. Real acquisition, clinical interpretation and treatment selection remain outside this presentation's claims.

## Reproduce Checks

```powershell
npm test
npm run build
.\.venv-companion\Scripts\python.exe -m pytest companion/test_mission_case.py companion/test_companion.py companion/tests/test_health.py -q
.\.venv-companion\Scripts\python.exe scripts/test_mission_research.py
node scripts/qa-mission-intelligence.mjs
node scripts/qa-mission-case.mjs
```

Browser output and screenshots: `.artifacts/mission-intelligence-qa/`. The obsolete `qa-mission-command.mjs` tests the replaced Alex-Morgan presentation and is superseded by `qa-mission-intelligence.mjs`; it is not a test of the current route.

## Recorded Verification

The records below describe the initial presentation revision. The later anatomical
cardiovascular asset, five-dataset explorer and published circulation reference
are documented in [cardiovascular-nasa-research.md](cardiovascular-nasa-research.md).
Their additional browser checks are in `.artifacts/cardiovascular-research-qa/`.

- JavaScript: 198 passed, 0 failed (includes 10 new mission-state tests).
- Selected companion/backend regression: 30 passed; two dependency deprecation warnings.
- NASA transformation/unit checks: 2 passed. The test file must be run directly as above because its sibling import is not package-qualified.
- Vite production build: passed; large-bundle warning retained (about 1.20 MB main JavaScript before gzip).
- Desktop 1440x1100 and mobile 390x844: all seven layers nonblank, full-body framing, orbit response, timeline synchronization, evidence graph, data-origin hashes, external image, event isolation, quality/sensor/evidence refusals, reset, offline-in-memory explanations, handoff export, presenter controls, playback cancellation and Research Lab navigation passed. No uncaught browser errors or horizontal page overflow.
- Failure injection: blocked anatomical GLB and mission-research JSON; review remained usable, unavailable sources did not appear as retrieved, reset remained functional.
- Complete 50-second automated sequence: reached Day 147 event review and handoff. Reduced-motion and cancellation passed.
- Existing Research Lab desktop/mobile case flow passed after namespacing the new milestone controls.
- Last development-browser timing samples: 2.9 ms desktop / 0.7 ms mobile for state derivation plus DOM update (not camera latency or end-to-end input latency). The atlas rendered in 14 draw calls; idle frame count remained unchanged across the test interval. This is a functional check, not a general hardware benchmark.
- Final production-build browser checks also passed at both sizes. The refined schematic used 12 draw calls; measured structured-update samples were 1.0 ms desktop / 0.8 ms mobile. Final screenshots and machine-readable results: `.artifacts/mission-intelligence-production/`.

No public deployment was performed. Real webcam acquisition, optional GPU/LLM services and independent clinical accuracy were not revalidated in this presentation-only revision.

## Changed Files In This Revision

New: `src/elenaMissionScenario.js`, `src/missionIntelligenceState.js`, `src/missionIntelligenceState.test.js`, `src/missionIntelligence.js`, `src/missionIntelligence.css`, `scripts/qa-mission-intelligence.mjs`, `scripts/qa-mission-intelligence-failures.mjs`, and this document.

Updated: `src/missionHuman.js` (layered demand-rendered reference viewer), `src/missionCasePanel.js` and `src/companionPanel.js` (isolated presentation routing), `src/missionResearchPanel.js` (exposes loaded bone-source metadata), `README.md`, and `AI_USE_DISCLOSURE.md`.

Existing dirty changes from earlier work were retained; this list describes this revision, not every uncommitted file in the repository.

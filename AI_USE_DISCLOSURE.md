# AI Use Disclosure

AstroBone is developed by Mysunat Islam with AI-assisted coding, debugging, documentation, and test generation. The owner supplied the project direction, datasets and model assets, training work, and UI revisions described in the project history. This disclosure does not assign authorship of third-party materials to the team.

The development assistant helped implement the application, camera-to-rig integration, evidence summaries, comparison UI, tests, and draft documentation. Runtime computer vision uses MediaPipe Pose Landmarker and EfficientDet-Lite0. Fracture research components use DenseNet121 and U-Net++ outputs. The current in-app text assistant uses application-state explanations and is not evidence of an independently validated clinical language model.

AI-generated code and prose may contain errors. Tests and limitations are documented, but the application has not been independently clinically or operationally validated. The team must review the final submission's claims, citations, licenses, and current competition AI-use rules.

The local Crew companion adds Ollama-hosted Llama 3.2 (tested with the 3B model)
and an optional Gemma adapter, plus embeddinggemma and FAISS retrieval. The local
LLM chooses schema-constrained tool plans and existing evidence/action IDs;
deterministic code computes the comparisons and renders the report. It cannot
prescribe treatment, alter crew profiles or generate unrestricted medical prose.
Gemma is configurable but has not been exercised in the recorded Llama smoke
test. The curated seven-passage NASA corpus is not a systematic medical review.
The October 3 mission-case fixture, comparison interface, follow-up workflow,
tests, and presentation drafts are AI-assisted. Day 1-194 records are explicitly
synthetic and do not validate deterioration prediction. Browser-only review
does not run an LLM. The optional local LLM was not rerun during the October 3
audit; earlier smoke results must not be described as new evaluation results.
See `docs/local-companion-architecture.md` for implementation limits.

The Mission Intelligence presentation (`#mission-demo`) adds the separately
authored Elena Torres / ARES TRANSIT-1 scenario, interactive reference anatomy,
provenance views and test coverage with AI-assisted development. All Elena
observations are synthetic. Presentation Astra uses deterministic structured
responses and prepared local evidence lookup; no LLM call or independent
multi-agent reasoning is claimed. Cardiovascular and exposure overlays are
reference and schematic visual context, not personalized physiological simulation.

The cardiovascular update uses the attributed Z-Anatomy atlas and unmodified
published Physiome CellML-generated equations with a separate numerical wrapper.
These are not AI-generated organ anatomy or inferred crew physiology. Additional
NASA OSD-569 and OSD-656 summaries are deterministic CSV aggregates, not LLM
findings. Model traces and research cohorts are kept separate from crew inputs.

The October 3-4 digital twin page (`twin.html`) and Daily Self-Check were
implemented with an AI coding assistant (Claude Code) from the owner's written
requirements: 3D presentation, shaders, impact visualization, Monte Carlo view,
reaction test, self-check evaluation rules, tests and documentation. The
reaction test follows published PVT-B parameters; review triggers are
engineering defaults, not clinical thresholds. Elena's self-check records are
authored synthetic values. The browser Monte Carlo engine was checked against
the stored Simulink reference, not against clinical outcomes.

The 240-second presentation (`pitch.html`) was built with the same assistant.
Its cold-open and concept clips are videos the team generated with Google
Gemini and are labeled as AI-generated on screen. The squat clip is Pexels
stock footage; its pose tracking runs live in the browser. NASA values on screen
come from the prepared OSDR summaries.

This is a pre-event prototype. Identify which work predates the hackathon and which work was produced during it. Do not claim AI-generated results, simulated cases, public radiographs, or synthetic QA streams as newly collected astronaut measurements.

See THIRD_PARTY_NOTICES.md for dataset, model, software, and skeleton credits. NASA references do not imply NASA endorsement.

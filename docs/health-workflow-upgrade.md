# Connected health workflow

The daily workflow is Gather → Evaluate → Act. Personal observations, Elena's authored demonstration and external NASA research retain distinct identities throughout the app.

## One health record

Self-checks, their follow-ups and breathing readings live in one record on this device (`astrobone-self-check-v1`: `you` and `respiratory:you`), under one consent switch and one optional passcode. The header's **My health / Demo mission** switch picks whose record every view shows; Elena's demo checks are kept separately and are refused when restoring a personal backup. Breathing readings saved on the Live Capture page go to the same record, and the page can unlock it. Readings from the old per-crew-code list move only after the person picks their own code, and the old plaintext rows are removed only after the move has reached storage.

A follow-up chosen with a check is saved inside that check, with due, re-check, awaiting-review and completed states and completion times. Reopening a saved check re-evaluates it against strictly earlier checks only, with the flight surgeon's limits if set.

## Guided demo

The guided demo is the full mission simulation in nine chapters (baseline, prediction, gather, reaction/sleep/body, evaluate and act, My Health and crew, where the crew is, body and impact, evidence). Play runs it; Pause holds; Back, Next and the chapter numbers jump straight to a chapter; Exit returns to where the person was, including an unfinished check of their own. A synthetic capture that is still running when the profile or check changes is dropped, so it can never land on a personal check.

## NASA explanations beside results

Each result domain includes a **Why are we monitoring this?** disclosure. It identifies the relevant NASA hazards, the purpose of the check, the source population and the limits of that evidence. This release adds three verified human-research references: NASA's sleep risk overview, Ames fatigue and HERA analog research, and NASA's food and nutrition research synthesis. They are labeled research context; no new participant dataset is claimed for these references.

For cardiovascular and immune context, the disclosure reads the existing bundled OSD-575 CRP and OSD-569 white-blood-cell summaries. Tables preserve source units, visit labels, available record counts, and the four-participant cohort size. L labels are days before launch; R labels are days after return. They are not mission days. Repeated visits are not independent participants. The same view exposes the original file link and SHA-256 checksum.

No NASA research table is written into a personal record or used as a personal respiratory threshold. Study data never validates a camera merely by being displayed beside its output. If the local research summary cannot load, the disclosure retains its source links and offers retry; the personal evaluation is unchanged.

Sources verified November 2, 2026:
- [NASA sleep risk](https://www.nasa.gov/reference/risk-from-inadequate-sleep-and-irregular-schedules/)
- [NASA Fatigue Countermeasures Laboratory](https://www.nasa.gov/human-systems-integration-division/human-performance/fatigue-countermeasures-laboratory/)
- [NASA food and nutrition research](https://www.nasa.gov/directorates/esdmd/hhp/human-adaptation-to-spaceflight-the-role-of-food-and-nutrition/)

## Remaining measurement work

Respiratory motion remains experimental. Hardware-paired validation against a belt or another suitable reference requires new consented recordings; software tests and synthetic browser fixtures cannot replace those recordings. The existing reference comparison panel reports accepted coverage and descriptive errors without claiming clinical accuracy. Direct depth-camera capture also remains outside this release; measured depth recordings can be imported.

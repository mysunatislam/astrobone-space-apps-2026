import { beamCase, runEngineeringChecks, evaluateReferencePairs } from "./engineeringValidation.js";
import "./researchWorkspace.css";

export function initResearchWorkspace({ controller, video }) {
  const $ = selector => document.querySelector(selector);
  $("#source-live").onclick = () => { if (controller.sourceKind === "video") controller.stopCamera(); if (!controller.active) $("#toggle-camera").click(); };
  $("#source-video").onclick = () => $("#exercise-video-file").click();
  $("#video-play-pause").onclick = () => {
    if (controller.videoWindowComplete) void controller.replayVideo();
    else if (video.paused) void video.play();
    else video.pause();
  };
  $("#video-speed").onchange = event => { video.playbackRate = Number(event.target.value); };
  $("#video-scrub").oninput = event => {
    controller.assessment = null; controller.worldFilter.reset(); controller.imageFilter.reset();
    controller.onPose(null); video.currentTime = Math.max(0, Math.min(Number(event.target.value), controller.videoWindow?.endSeconds ?? video.duration));
    controller.onStatus({ key: "ready", label: "Video seek / assessment reset" });
  };
  const updateSource = () => {
    const recorded = controller.sourceKind === "video";
    $("#source-live").setAttribute("aria-pressed", String(!recorded)); $("#source-video").setAttribute("aria-pressed", String(recorded));
    $("#recorded-playback").hidden = !recorded || controller.starting;
    if (recorded) {
      $("#video-scrub").max = String(controller.videoWindow?.endSeconds ?? (video.duration || 120)); $("#video-scrub").value = video.currentTime;
      $("#video-time").textContent = `${Math.floor(video.currentTime / 60)}:${String(Math.floor(video.currentTime % 60)).padStart(2, "0")}`;
      $("#video-play-pause").textContent = controller.videoWindowComplete ? "Replay" : video.paused ? "Play" : "Pause";
      $("#video-play-pause").setAttribute("aria-label", `${controller.videoWindowComplete ? "Replay" : video.paused ? "Play" : "Pause"} recorded video`);
    }
    const window = controller.videoWindow;
    $("#video-clip-info").hidden = !recorded || !window;
    if (window) {
      const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
      $("#video-clip-info").textContent = window.autoTrimmed
        ? `Auto-trimmed: 0:00 - ${time(window.endSeconds)} of ${time(window.sourceDurationSeconds)}. Original file unchanged.`
        : window.assessmentEligible ? `Analysis clip: 0:00 - ${time(window.endSeconds)}` : `Short clip: ${time(window.endSeconds)}. Motion preview only; assessment unavailable.`;
      if (window.assessmentEligible) $("#video-clip-info").textContent += ` Observation: ${window.assessmentDurationMs / 1000} s.`;
    }
  };
  for (const event of ["timeupdate", "play", "pause", "loadedmetadata", "emptied"]) video.addEventListener(event, updateSource);
  new MutationObserver(updateSource).observe($("#camera-status"), { childList: true });

  const section = document.createElement("section"); section.id = "engineering-validation"; section.className = "engineering-band";
  section.innerHTML = `<header><div><span class="section-label">Mechanical engineering & biomechanics</span><h3>Verification workbench</h3></div><strong id="engineering-check-status"></strong></header>
    <p>Analytical checks verify equations. Reference measurements validate performance. Neither proves clinical safety.</p>
    <div class="engineering-inputs"><label>Transverse load (N)<input id="beam-force" type="number" min="0" max="10000" value="100" step="10"></label><label>Moment arm (mm)<input id="beam-offset" type="number" min="0" max="1000" value="50"></label><label>Section radius (mm)<input id="beam-radius" type="number" min="1" max="100" value="10"></label></div>
    <p id="beam-result" role="status"></p><code>M = r x F; sigma = M c / I; tau = 4 V / (3 A)</code>
    <small>Illustrative solid circular beam, not patient bone geometry. No measured joint force, muscle force, tissue damage or fracture probability.</small>
    <details open><summary>Fixed analytical verification cases</summary><div class="engineering-table"><table><caption>Reference beam: 100 N, 50 mm moment arm, 10 mm radius. Independent of the interactive load case.</caption><thead><tr><th>Case</th><th>Expected</th><th>Computed</th><th>Result</th></tr></thead><tbody id="engineering-checks"></tbody></table></div></details>
    <h4>Reference agreement</h4><p>Matched goniometer or contact-PPG observations. Failed predictions remain in the coverage denominator.</p>
    <div class="engineering-actions"><button id="reference-import" type="button">Import paired JSON</button><button id="reference-template" type="button">Download schema example</button><button id="reference-export" type="button" disabled>Export report</button><input id="reference-file" type="file" accept="application/json,.json" hidden></div>
    <output id="reference-result">No independent reference data loaded.</output>
    <details><summary>Model and evidence status</summary><dl><dt>Body biomechanics</dt><dd>MediaPipe joint-angle estimates; physical reference validation pending. Upright stabilization affects the display rig only.</dd><dt>3D reconstruction</dt><dd>Optional MHR research surface; higher latency than the rig. Not a validated anatomical reconstruction.</dd><dt>Pulse</dt><dd>POS experimental baseline active on request. PHASE-Net and FactorizePhys are evaluation candidates, not deployed or validated here.</dd><dt>Mission, radiation and AI</dt><dd>Context and evidence demonstrations. No autonomous medical prescription or fused health score.</dd></dl>
    <a href="https://github.com/Alex036225/PhaseNet" target="_blank" rel="noopener noreferrer">PHASE-Net source</a> / <a href="https://github.com/PhysiologicAILab/FactorizePhys" target="_blank" rel="noopener noreferrer">FactorizePhys source</a></details>`;
  $(".twin-kinematics-deck").after(section);
  const checks = runEngineeringChecks(); let report = null;
  $("#engineering-check-status").textContent = `${checks.filter(c => c.passed).length}/${checks.length} analytical checks`;
  for (const c of checks) {
    const row = document.createElement("tr");
    for (const value of [c.name, `${c.expected.toPrecision(5)} ${c.unit}`, `${c.actual.toPrecision(5)} ${c.unit}`, c.passed ? "PASS" : "FAIL"]) { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }
    $("#engineering-checks").append(row);
  }
  const calculate = () => {
    try {
      const result = beamCase({ forceN: Number($("#beam-force").value), offsetM: Number($("#beam-offset").value) / 1000, radiusM: Number($("#beam-radius").value) / 1000 });
      $("#beam-result").textContent = `Bending ${result.sectionResultants.bendingMomentYNm.toFixed(2)} N m / stress ${(result.demandsPa.bendingStressBound / 1e6).toFixed(3)} MPa / shear ${(result.demandsPa.transverseShear / 1e6).toFixed(3)} MPa`;
    } catch (error) { $("#beam-result").textContent = error.message; }
  };
  for (const input of section.querySelectorAll("input[type=number]")) input.addEventListener("input", calculate); calculate();
  const download = (name, value) => { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  $("#reference-template").onclick = () => download("reference-schema-SYNTHETIC.json", { schema: "astrobone-reference-v1", metric: "knee_flexion", unit: "deg", synthetic: true, reference_device: "SYNTHETIC example", protocol: "SYNTHETIC arithmetic check", pairs: [{ id: "example-1", subject_id: "synthetic-A", reference: 90, estimate: 92 }, { id: "example-2", subject_id: "synthetic-A", reference: 60, estimate: 58 }, { id: "example-3", subject_id: "synthetic-A", reference: 30, estimate: null }] });
  $("#reference-import").onclick = () => $("#reference-file").click();
  $("#reference-file").onchange = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    report = null; $("#reference-export").disabled = true;
    try {
      if (file.size > 2000000) throw new Error("Reference file must be under 2 MB");
      report = evaluateReferencePairs(JSON.parse(await file.text()));
      $("#reference-result").textContent = `${report.synthetic ? "SYNTHETIC / " : "USER-SUPPLIED REFERENCE / "}${report.evaluated}/${report.total} pairs; ${report.subjects} subjects; coverage ${(report.coverage * 100).toFixed(1)}%; MAE ${report.mae.toFixed(2)} ${report.unit}; RMSE ${report.rmse.toFixed(2)} ${report.unit}; bias ${report.bias.toFixed(2)} ${report.unit}. ${report.limitation}`;
      $("#reference-export").disabled = false;
    } catch (error) { $("#reference-result").textContent = error.message; }
    event.target.value = "";
  };
  $("#reference-export").onclick = () => download("astrobone-reference-validation.json", { ...report, analyticalChecks: checks, generatedAt: new Date().toISOString() });
}

import { cardiovascularAtDay, describeXray } from "./missionHealth.js";
import { validateMissionResearch, validateExtendedResearch, validateBoneResearch, validateCirculationReference } from "./missionEvidenceValidation.js";

const node = (tag, text = "", className = "") => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
const asset = path => `${import.meta.env.BASE_URL}${path}`;
const external = (text, url) => { const a = node("a", text); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; return a; };
const signed = n => `${n > 0 ? "+" : ""}${n}`;

function table(headers, rows) {
  const wrap = node("div", "", "research-table"), table = node("table"), head = node("thead"), body = node("tbody"), tr = node("tr");
  tr.append(...headers.map(text => node("th", text))); head.append(tr);
  for (const row of rows) { const tr = node("tr"); tr.append(...row.map(text => node("td", String(text)))); body.append(tr); }
  table.append(head, body); wrap.append(table); return wrap;
}

export function createMissionResearchPanel({ parent, onCardio }) {
  let state = {}, research = null, extended = null, circulation = null, xray = null, bone = null, channel = "movement", radiationGroup = "O-16 ion radiation|0.1";
  const host = node("section", "", "mission-research"); parent.append(host);
  host.id = "case-research-panel"; host.hidden = true;
  const errors = {}, validation = {};
  async function load(path, key, accept) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    validation[key] = { path, status: "loading", scope: "File consistency only; not clinical validation or source authentication" };
    try {
      const response = await fetch(asset(path), { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      accept(await response.json());
      validation[key].status = "accepted";
    } catch (error) {
      errors[key] = "Bundled evidence unavailable or failed consistency checks. No substitute values are shown.";
      validation[key].status = "withheld";
      validation[key].reason = error.name === "AbortError" ? "File load timed out" : error instanceof SyntaxError ? "Invalid JSON file" : error.message;
    } finally { clearTimeout(timeout); }
    render();
  }
  const ready = Promise.all([
    load("data/mission-research.json", "research", value => {
      research = validateMissionResearch(value);
    }),
    load("data/osdr-804-summary.json", "bone", value => { bone = validateBoneResearch(value); }),
    load("data/mission-research-extended.json", "extended", value => {
      extended = validateExtendedResearch(value);
    }),
    load("data/circulation-reference.json", "circulation", value => {
      circulation = validateCirculationReference(value);
    }),
    load("inference/demo/IMG0001739_prediction.json", "xray", value => { xray = describeXray(value); }),
  ]);
  function researchHeading(source) {
    const block = node("section", "", "research-reference");
    block.append(node("span", "NASA OSDR / EXTERNAL RESEARCH", "section-label"), node("h3", source.title),
      external(`${source.accession} / ${source.population}`, source.url));
    return block;
  }
  function referenceDetails(source) {
    const detail = node("details"), summary = node("summary", "Data provenance & method");
    detail.append(summary, node("p", source.method || source.boundary));
    for (const file of source.sources) detail.append(external(file.file, file.url), node("small", `SHA-256 ${file.sha256}`));
    return detail;
  }
  function render() {
    const cardio = cardiovascularAtDay(state.health || [], state.day);
    onCardio(cardio);
    host.hidden = channel === "movement";
    if (host.hidden) return;
    host.replaceChildren();
    if (channel === "xray") {
      if (!xray) { host.append(node("p", errors.xray || "Loading X-ray evidence...", "evidence-load-status")); return; }
      const grid = node("div", "", "xray-evidence"), figure = node("figure"), image = node("img");
      image.src = asset(`inference/demo/${xray.imageId}_overlay.png`); image.alt = "FracAtlas radiograph with the precomputed predicted fracture-region overlay";
      image.width = 256; image.height = 256;
      image.onerror = () => { image.hidden = true; figure.append(node("p", "X-ray image unavailable; review withheld.")); };
      figure.append(image, node("figcaption", `${xray.imageId} / predicted mask overlay`));
      const info = node("section"); info.append(node("span", "EXTERNAL IMAGE / NOT CREW IMAGING", "section-label"), node("h3", "Current X-ray evidence"),
        node("p", "Real FracAtlas radiograph with saved DenseNet121 and U-Net++ output. This example is not assigned to the astronaut."),
        table(["Model output", "Value"], [[xray.scoreLabel, xray.fractureScore.toFixed(4)], ["Predicted mask area", `${(xray.maskAreaFraction * 100).toFixed(2)}% of image`], ["Inference", "Precomputed / not live"]]),
        node("p", "The score is not a calibrated fracture probability. Mask size is not injury severity. No diagnosis or bone-density estimate is issued."),
        external("FracAtlas dataset paper / CC BY 4.0", "https://doi.org/10.1038/s41597-023-02432-4"));
      const detail = node("details"); detail.append(node("summary", "Model and split provenance"), node("p", `${xray.classifier}; ${xray.segmenter}. The saved file labels this image "${xray.split}"; the split and model performance have not been independently re-audited for this review.`), external("Saved prediction JSON", asset(`inference/demo/${xray.imageId}_prediction.json`)));
      info.append(detail); grid.append(figure, info); host.append(grid);
      if (research && bone) {
        const reference = researchHeading(research.bone);
        const row = bone.flightVsGroundControl.find(row => row.site === "CorticalFemur" && row.measure === "cortical_thickness_millimeter");
        if (row) reference.append(node("p", `Cortical thickness: spaceflight mean ${row.flightMean.toFixed(3)} mm (n=${row.flightN} records), ground control ${row.groundMean.toFixed(3)} mm (n=${row.groundN}). Female mice; 37-day flight.`));
        reference.append(node("small", "Separate bone research context. Neither these mice nor this X-ray calibrate the astronaut's fracture risk."), referenceDetails(research.bone)); host.append(reference);
      }
      return;
    }
    const grid = node("div", "", "research-columns"), personal = node("section");
    personal.append(node("span", state.synthetic ? "CREW SCENARIO / SYNTHETIC" : "CREW RECORD / USER-SUPPLIED", "section-label"));
    if (channel === "cardiovascular") {
      personal.append(node("h3", "Resting heart-rate observations"));
      if (!cardio.current) personal.append(node("p", "No cardiovascular reading recorded. NASA research is not substituted for a personal measurement."));
      else {
        const row = cardio.current;
        personal.append(node("strong", cardio.status === "withheld" ? "Reading withheld" : `${row.metrics.heart_rate_bpm} bpm`, "channel-value"),
          node("p", cardio.status === "withheld" ? "The newest signal fails the engineering quality gate. Obtain a usable repeat; no trend is calculated."
            : `${cardio.delta === null ? "First quality-qualified reading" : `${signed(cardio.delta)} bpm from Day ${cardio.baseline.mission_day}`} / reading from Day ${row.mission_day}${cardio.status === "earlier" ? "; not current-day data" : ""}.`),
          table(["Mission day", "Heart rate", "Quality"], cardio.points.map(r => [r.mission_day, r.quality >= .6 ? `${r.metrics.heart_rate_bpm} bpm` : "Withheld", r.quality >= .6 ? "Usable*" : "Low signal*"])),
          node("small", `*Engineering quality gate >=60%, not clinical validation. Same device and protocol: ${row.device_id} / ${row.protocol}.`));
      }
      personal.append(node("p", "A descriptive trend, not a cardiovascular-event prediction. The demo does not measure HRV or oxygen saturation."));
    } else {
      const dose = state.dose;
      personal.append(node("h3", "Personal absorbed-dose context"), node("strong", dose ? `${dose.cumulative_personal_absorbed_dose_mgy} mGy` : "Not recorded", "channel-value"),
        node("p", dose ? `Cumulative reading from Day ${dose.mission_day} / ${dose.instrument_id}.${dose.mission_day < state.day ? " Not a current-day reading." : ""}` : "No personal dosimeter data are available."));
      const rows = (state.radiation || []).filter(row => row.mission_day <= state.day);
      if (rows.length) personal.append(table(["Mission day", "Cumulative dose"], rows.map(r => [r.mission_day, `${r.cumulative_personal_absorbed_dose_mgy} mGy`])));
      personal.append(node("p", "Absorbed dose (mGy) is not dose equivalent (mSv). No conversion, clinical limit, bone-dose estimate, or causal health score is calculated."));
    }
    grid.append(personal);
    if (!research) grid.append(node("p", errors.research || "Loading NASA data...", "evidence-load-status"));
    else {
      const source = research[channel], reference = researchHeading(source);
      if (channel === "cardiovascular") {
        reference.append(node("p", `${source.participants} crew members / ${source.records} serum observations. CRP assay medians, ${source.unit}.`),
          table(["Study visit", "CRP (mg/L)", "n"], source.points.map(p => [p.visit, p.median.toFixed(2), p.n])),
          node("small", "L: days before launch. R: days after return, not mission duration. CRP is an inflammatory marker, not a heart-rate measurement."));
      } else {
        const options = [...new Set(source.groups.map(r => `${r.radiation}|${r.doseGy}`))], select = node("select");
        select.id = "case-radiation-group"; select.setAttribute("aria-label", "NASA radiation study exposure group");
        for (const key of options) { const [name, dose] = key.split("|"); select.append(new Option(`${name} / ${dose} Gy`, key)); }
        select.value = options.includes(radiationGroup) ? radiationGroup : options[0]; radiationGroup = select.value;
        select.onchange = () => { radiationGroup = select.value; render(); };
        const points = source.groups.filter(r => `${r.radiation}|${r.doseGy}` === radiationGroup);
        reference.append(node("p", "Mouse cardiac ejection fraction, grouped by exposure and time. Descriptive medians; not paired treatment effects."), select,
          table(["Months after exposure", "Median EF (%)", "n records"], points.map(p => [p.month, p.median.toFixed(2), p.n])),
          node("small", `${source.records} source records; ${source.exclusions.nonScalarDose} non-scalar-dose records excluded, ${source.exclusions.invalidTimeOrMetric} excluded for missing time/metric. Repeated observations are not independent animals.`));
      }
      reference.append(node("p", source.boundary, "research-boundary"), referenceDetails(source)); grid.append(reference);
    }
    host.append(grid);
  }
  return { ready, update(value) { state = value; render(); }, select(value) { channel = value; render(); },
    exportEvidence() { return { scope: "External research and image evidence, not assigned to the crew profile", research, extended, circulation, bone, xray, validation: structuredClone(validation), unavailable: { ...errors } }; } };
}

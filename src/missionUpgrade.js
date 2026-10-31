import "./missionUpgrade.css";
import { NASA_RESPIRATORY_EVIDENCE, SPACE_APPS_2026 } from "./data/nasaRespiratoryEvidence.js";
import { initNasaExpansionPanel } from "./nasaExpansionPanel.js";

const logoUrl = `${import.meta.env.BASE_URL}brand/astrobone-logo.png`;
const node = (tag, text, className = "") => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  element.className = className;
  return element;
};

export function applyAstroBoneBrand(scope = document) {
  for (const brand of scope.querySelectorAll(".tw-brand")) {
    if (brand.querySelector(".ab-brand-logo")) continue;
    const image = new Image(); image.src = logoUrl; image.alt = "AstroBone";
    image.className = "ab-brand-logo"; image.width = 88; image.height = 72;
    brand.querySelector(".tw-mark")?.remove(); brand.prepend(image);
  }
  const title = scope.querySelector(".tw-intro-title");
  if (title && !title.querySelector("img")) {
    const image = new Image(); image.src = logoUrl; image.alt = "AstroBone";
    image.className = "ab-intro-logo"; image.width = 280; image.height = 228;
    title.prepend(image);
  }
}

export function mountMissionUpgrade(root, app) {
  applyAstroBoneBrand(root);
  const overview = node("section", undefined, "ab-mission-overview");
  overview.setAttribute("aria-label", "AstroBone mission overview");
  overview.innerHTML = `<div class="ab-overview-top"><span class="ab-kicker">HUMAN HEALTH / DEEP SPACE</span><span class="ab-prototype">RESEARCH PROTOTYPE</span></div>
    <h1>Human health, <br><span>in focus.</span></h1>
    <p class="ab-overview-description">A clearer view of movement, physiology, and the science behind a longer mission.</p>
    <div class="ab-scope-note"><span aria-hidden="true">◇</span><span>The twin shows a <b>synthetic mission</b>.<br>Start a capture to collect your own observations.</span></div>
    <a class="ab-breathing-cta" href="${import.meta.env.BASE_URL}lab.html#respiratory-monitor"><span><small>NEW / EXPERIMENTAL</small>Start a breathing check</span><span aria-hidden="true">↗</span></a>
    <div class="ab-overview-actions"><button type="button" data-ab-action="twin">Explore the twin <span aria-hidden="true">→</span></button><button type="button" data-ab-action="evidence">NASA evidence <span aria-hidden="true">↗</span></button></div>
    <div class="ab-device-note"><span class="ab-device-dot" aria-hidden="true"></span><span>Camera processing on your device</span></div>`;
  root.append(overview);
  overview.querySelector('[data-ab-action="twin"]').onclick = () => app.setExperience("twin");

  const evidenceDialog = node("dialog", undefined, "ab-evidence-dialog");
  evidenceDialog.setAttribute("aria-labelledby", "ab-evidence-title");
  evidenceDialog.innerHTML = `<header class="ab-evidence-heading"><div><span class="ab-kicker">NASA / OPEN SCIENCE</span><h2 id="ab-evidence-title">Trace the evidence.</h2><p>Explore the source, population, and limits behind the research.</p></div><button type="button" class="ab-dialog-close" aria-label="Close NASA evidence">×</button></header>
    <div class="ab-evidence-boundary">These external studies provide research context. They do not validate camera breathing estimates or describe your health.</div>
    <div class="ab-evidence-controls"><label>Find a source<input type="search" id="ab-evidence-search" placeholder="Search datasets, populations, or topics"></label><label>Research domain<select id="ab-evidence-domain"><option value="">All domains</option></select></label></div>
    <p class="ab-evidence-count" role="status"></p><div class="ab-evidence-grid"></div><footer class="ab-evidence-footer"></footer>`;
  root.append(evidenceDialog);
  const expansion = node("section", undefined, "ab-nasa-expansion");
  evidenceDialog.querySelector(".ab-evidence-controls").before(expansion);
  let expansionStarted = false;
  const close = evidenceDialog.querySelector(".ab-dialog-close");
  close.onclick = () => evidenceDialog.close();
  let evidencePausedTwin = false;
  evidenceDialog.addEventListener("close", () => {
    if (evidencePausedTwin) app.scene.setPaused(false);
    evidencePausedTwin = false;
  });
  evidenceDialog.addEventListener("click", event => { if (event.target === evidenceDialog) { const rect = evidenceDialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) evidenceDialog.close(); } });
  const sources = Array.isArray(NASA_RESPIRATORY_EVIDENCE) ? NASA_RESPIRATORY_EVIDENCE : [];
  const selector = evidenceDialog.querySelector("#ab-evidence-domain"), search = evidenceDialog.querySelector("#ab-evidence-search");
  [...new Set(sources.map(source => source.domain).filter(Boolean))].forEach(domain => { const option = node("option", domain); option.value = domain; selector.append(option); });
  function renderSources() {
    const query = search.value.trim().toLowerCase();
    const selected = sources.filter(source => (!selector.value || source.domain === selector.value) && (!query || JSON.stringify(source).toLowerCase().includes(query)));
    evidenceDialog.querySelector(".ab-evidence-count").textContent = `${selected.length} of ${sources.length} sources · integration status shown for every source`;
    const grid = evidenceDialog.querySelector(".ab-evidence-grid"); grid.replaceChildren();
    for (const source of selected) {
      const article = node("article", undefined, "ab-source-card");
      const heading = node("div", undefined, "ab-source-meta");
      heading.append(node("span", source.accession || source.id || "NASA"), node("span", source.integrationStatus || "Reference catalog"));
      const title = node("a", source.title); title.href = source.url; title.target = "_blank"; title.rel = "noopener noreferrer";
      const population = node("p", source.population, "ab-source-population");
      const summary = node("p", source.summary);
      const limits = node("details"); limits.append(node("summary", "Use and limitations"), node("p", Array.isArray(source.limits) ? source.limits.join(" ") : source.limits || "External research context; no individual health inference."));
      article.append(heading, node("h3"), population, summary, limits); article.querySelector("h3").append(title); grid.append(article);
    }
    if (!selected.length) grid.append(node("p", "No sources match this search. Try a different topic."));
  }
  search.addEventListener("input", renderSources); selector.addEventListener("change", renderSources);
  const footer = evidenceDialog.querySelector(".ab-evidence-footer");
  const eventLink = node("a", "2026 NASA Space Apps Challenge ↗");
  eventLink.href = SPACE_APPS_2026.sourceUrl || "https://www.spaceappschallenge.org/2026/"; eventLink.target = "_blank"; eventLink.rel = "noopener noreferrer";
  footer.append(node("span", "Open data, clear provenance, honest uncertainty."), eventLink);
  function openEvidence() {
    // The covered anatomical scene can hold its last frame while sources are read.
    evidencePausedTwin = app.state.experience === "mission";
    if (evidencePausedTwin) app.scene.setPaused(true);
    renderSources(); evidenceDialog.showModal(); search.focus();
    if (!expansionStarted) { expansionStarted = true; void initNasaExpansionPanel(expansion); }
  }
  overview.querySelector('[data-ab-action="evidence"]').onclick = openEvidence;

  const respiratoryLink = node("a", undefined, "ab-respiratory-shortcut");
  respiratoryLink.href = `${import.meta.env.BASE_URL}lab.html#respiratory-monitor`;
  respiratoryLink.innerHTML = '<span class="ab-respiratory-glyph" aria-hidden="true">⌁</span><span>Respiratory motion<small>Experimental / camera capture</small></span><span aria-hidden="true">↗</span>';
  root.append(respiratoryLink);
  return { openEvidence };
}

import { dashboardModel, adherenceStrip, crewRoster, crewSummaryText } from "./healthDashboard.js";
import { CREW, CREW_BOUNDARY, crewMember } from "./crewDemo.js";
import { environmentFor, DEFAULT_ENVIRONMENT } from "./missionEnvironment.js";
import { routineStatus } from "./routine.js";
import { sparklineSvg } from "./trendSpark.js";
import { indicatorHistory, historyChartSvg, legendFor, pointLabel, STATUS_MARKS } from "./historyChart.js";
import { DOMAINS } from "./selfCheck.js";
import { ELENA_CHECK_DAYS, elenaDay147, ELENA_SELF_CHECK_BOUNDARY } from "./elenaSelfCheck.js";
import { dayNumber } from "./routine.js";
import { surgeonReport } from "./surgeonReport.js";

// My Health: the astronaut's own dashboard. Every number comes from the self-check panel (its saved
// checks, today's check, its environment and floors) through healthDashboard.js, so this screen and the
// self-check result can never disagree.

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value; else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value); else if (key === "style") node.style.cssText = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child?.nodeType ? child : String(child));
  return node;
}
const GRID_ORDER = ["musculoskeletal", "cardiovascular", "behavioral", "metabolic", "immune"];
const DOMAIN_LABEL = Object.fromEntries(DOMAINS.map(([key, label]) => [key, label]));
const signed = (v, digits = 0) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Number(v.toFixed(digits)))}`;
const mark = (status, extra = "") => el("span", { class: `db-mark db-st-${status} ${extra}`.trim() }, el("i", { "aria-hidden": "true" }, STATUS_MARKS[status].glyph), STATUS_MARKS[status].word);

export function createDashboardPanel({ selfCheck, dose = () => null, onMeasure = () => {} }) {
  const element = el("section", { class: "db", "aria-label": "My Health dashboard" });
  // view: "self" (the self-check's profile: Elena or You), "crew" (the roster) or a crew member's id.
  let chartKey = null, report = false, view = "self";
  const crewEnv = () => environmentFor(DEFAULT_ENVIRONMENT.elena);

  function data() {
    const member = view !== "self" && view !== "crew" ? crewMember(view) : null;
    if (member) {
      const environment = crewEnv(), status = routineStatus(member.checkDays.map(day => ({ day, complete: true })), 147);
      return { profile: member.id, member, environment, routine: { status, due: null }, floors: {}, records: member.history, current: member.today,
        model: dashboardModel({ records: member.history, current: member.today, environment, routine: status }) };
    }
    const profile = selfCheck.state.profile;
    const environment = selfCheck.environment(), floors = selfCheck.floors(), routine = selfCheck.routine();
    const records = selfCheck.history();
    let current = selfCheck.current, evaluation = current ? selfCheck.state.evaluation : null;
    if (!current && profile === "elena" && !records.some(r => r.missionDay === 147)) current = elenaDay147();
    return { profile, environment, routine, floors, model: dashboardModel({ records, current, evaluation, environment, routine: routine.status, floors }), records, current };
  }

  function tile(t, selected) {
    const spark = sparklineSvg({ series: t.series, value: t.value, band: t.band, start: t.start, changed: t.flagged, label: `${t.def.label} over the mission` });
    return el("button", { type: "button", class: `db-tile db-st-${t.status}`, "data-key": t.key, "aria-pressed": String(selected),
      title: "Show over time", onclick: () => { chartKey = t.key; render(); element.querySelector(".db-chart")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); } },
    el("span", { class: "db-tile-head" }, el("span", {}, t.def.short ?? t.def.label), mark(t.status)),
    el("strong", {}, t.text, el("small", {}, t.unit)),
    spark ? el("span", { class: "db-tile-spark", html: spark }) : el("span", { class: "db-tile-spark db-none" }, t.status === "notChecked" ? "Not measured yet" : "One check so far"),
    el("small", { class: "db-tile-foot" }, t.limit ? `Safety limit: ${t.limit}` : t.usualText ?? (t.status === "baseline" ? "Building baseline" : ""),
      t.sinceFirst ? el("em", {}, ` · ${signed(t.sinceFirst.delta, t.def.digits ?? 0)}${t.unit} since ${t.sinceFirst.day ? `Day ${t.sinceFirst.day}` : "first check"}`) : null));
  }

  function chart(model, records, current, floors) {
    const key = model.tiles.some(t => t.key === chartKey && t.points >= 2) ? chartKey : model.chartKey;
    if (!key) return el("section", { class: "db-chart db-card" }, el("header", {}, el("b", {}, "Over time")), el("p", { class: "db-note" }, "Charts appear after two checks of the same measurement."));
    const all = [...records.filter(r => !current || r.id !== current.id)];
    const hist = indicatorHistory(key, all, current ?? null, { floors });
    const box = el("div", { class: "db-chart-box", html: historyChartSvg(hist, { width: 560, height: 236 }) });
    return el("section", { class: "db-chart db-card", "aria-label": "Over time" },
      el("header", {}, el("b", {}, `Over time · ${hist.def.label}`), el("small", {}, "Tap any tile to chart it. Each point is judged as it was on its own day.")),
      box,
      el("ul", { class: "sc-legend", "aria-label": "Legend" },
        legendFor(hist).map(m => el("li", { class: `sc-${m.status}` }, el("i", {}, m.glyph), m.word)),
        hist.points.some(p => p.band) ? el("li", { class: "sc-legend-band" }, el("i", {}), "usual range that day") : null,
        Number.isFinite(hist.start) ? el("li", { class: "sc-legend-start" }, el("i", {}), "starting level") : null,
        hist.limitLines.length ? el("li", { class: "sc-legend-limit" }, el("i", {}), "safety limit") : null),
      el("details", { class: "sc-htable" }, el("summary", {}, "Show as a table"), el("ol", {}, hist.points.map(p => el("li", {}, pointLabel(p, hist.def))))));
  }

  function adherence(profile, routine, member) {
    const demo = profile === "elena" || member;
    const strip = member ? adherenceStrip(member.checkDays, 147, { from: 1, to: 147 }) : profile === "elena" ? adherenceStrip([...ELENA_CHECK_DAYS, ...(routine.status.doneToday ? [147] : [])], 147, { from: 1, to: 147 })
      : adherenceStrip(selfCheck.history().map(c => dayNumber(c.at)), dayNumber(), { from: dayNumber() - 59, to: dayNumber() });
    const label = d => (demo ? `Day ${d.day}` : new Date((d.day + 0.5) * 86400e3).toLocaleDateString());
    return el("section", { class: "db-adherence db-card", "aria-label": "Checks done" },
      el("header", {}, el("b", {}, demo ? "Daily checks, mission days 1-147" : "Daily checks, last 60 days"), el("small", {}, `${strip.done} done · ${strip.missed} missed`)),
      el("div", { class: "db-days", role: "img", "aria-label": `${strip.done} days checked and ${strip.missed} missed` },
        strip.cells.map(c => el("i", { class: `db-day db-${c.state}`, title: `${label(c)}: ${c.state.startsWith("today") ? (c.state === "today" ? "today, not saved yet" : "today, done") : c.state}` }))),
      el("small", { class: "db-note" }, "Filled = checked · empty = missed. Rewards the habit, never a health value."));
  }

  function profileToggle(active) {
    const pick = key => { chartKey = null; report = false; if (key === "crew") view = "crew"; else { view = "self"; selfCheck.setProfile(key); } render(); element.closest(".tw-dash")?.scrollTo?.({ top: 0 }); };
    return el("div", { class: "db-profile", role: "group", "aria-label": "Whose dashboard" },
      [["elena", "Elena · synthetic demo"], ["crew", `Crew · ${CREW.length}`], ["you", "You · this device"]].map(([key, label]) =>
        el("button", { type: "button", "aria-pressed": String(active === key), onclick: () => pick(key) }, label)));
  }
  const whereText = env => `${env.label} · ${env.place} · message to Earth ${env.delayText} one way`;

  // Crew view: everyone's latest check, most serious first, for the crew medical officer and flight surgeon.
  function renderCrew() {
    const environment = crewEnv(), roster = crewRoster(CREW, environment);
    const summary = crewSummaryText(roster, environment);
    const who = el("div", { class: "db-who" }, el("span", { class: "tw-eyebrow" }, "CREW HEALTH · TODAY"),
      el("h2", {}, "Crew of four"), el("small", {}, `Mission day 147 · ${whereText(environment)} · for the crew medical officer and the flight surgeon`), profileToggle("crew"));
    const counts = el("div", { class: "db-overall db-card" },
      el("div", { class: "db-crew-counts" }, Object.entries(roster.counts).map(([status, n]) => el("span", { class: `db-st-${status}` }, mark(status), el("b", {}, String(n))))),
      el("p", {}, `${roster.rows[0].name} needs attention first: ${roster.rows[0].mark.word.toLowerCase()}.`),
      el("p", { class: "db-who-tell" }, "Each person is judged by the same rules against their own earlier checks, never against each other."));
    const rows = el("ol", { class: "db-crew", "aria-label": "Crew, most serious first" }, roster.rows.map(r => {
      const lead = r.lead ?? r.model.tiles.find(t => t.key === r.model.chartKey);
      const spark = lead ? sparklineSvg({ series: lead.series, value: lead.value, band: lead.band, start: lead.start, changed: lead.flagged, label: `${r.name}: ${lead.def.label} over the mission` }) : "";
      return el("li", { class: `db-crew-row db-card db-st-${r.status}` },
        el("div", { class: "db-crew-who" }, mark(r.status), el("b", {}, r.name), el("small", {}, r.role)),
        el("div", { class: "db-crew-what" }, el("span", {}, r.flagged.length ? r.flagged.join(" · ") : "No change outside usual range"),
          el("small", {}, r.model.actions.find(a => a.priority !== "info")?.text ?? "Next self-check in 24 h.")),
        el("div", { class: "db-crew-spark" }, lead ? el("small", {}, lead.def.label) : null, spark ? el("span", { html: spark }) : null),
        el("div", { class: "db-crew-meta" }, el("small", {}, `Checked ${r.adherence.done} of ${r.adherence.of} days`),
          el("button", { type: "button", class: "tw-secondary", "data-crew": r.id, "aria-label": `Open dashboard for ${r.name}`, onclick: () => { chartKey = null; report = false; if (r.id === "elena") { view = "self"; selfCheck.setProfile("elena"); } else view = r.id; render(); element.closest(".tw-dash")?.scrollTo?.({ top: 0 }); } }, "Open dashboard")));
    }));
    fillRoot(el("header", { class: "db-hero db-hero-crew" }, who, counts), rows,
      el("section", { class: "db-card db-crew-report", "aria-label": "Crew summary for the flight surgeon" },
        el("header", {}, el("b", {}, "Crew summary for the flight surgeon"), el("small", {}, `${(new TextEncoder().encode(summary).length / 1024).toFixed(1)} kB of plain text, for a slow deep-space link`)),
        el("pre", { class: "db-report", tabindex: "0" }, summary)),
      el("small", { class: "db-boundary" }, CREW_BOUNDARY));
  }

  function render() {
    if (view === "crew") { renderCrew(); return; }
    const { profile, member, environment, routine, model, records, current, floors } = data();
    const where = whereText(environment);
    const who = el("div", { class: "db-who" }, el("span", { class: "tw-eyebrow" }, member ? "CREW MEMBER · TODAY" : "MY HEALTH · TODAY"),
      el("h2", {}, member ? `${member.role} ${member.name}` : profile === "elena" ? "Commander Elena Torres" : "You"),
      el("small", {}, member || profile === "elena" ? `Mission day 147 · ${where}` : where), profileToggle(member ? "crew" : profile));

    if (model.empty) {
      fillRoot(el("header", { class: "db-hero" }, who,
        el("div", { class: "db-overall db-card" }, el("p", {}, selfCheck.locked() ? "Your saved checks are locked. Unlock them in Self-Check to see your dashboard." : "No self-checks on this device yet. Your dashboard fills in from your first check; comparisons start after 3."),
          el("button", { type: "button", class: "tw-primary", onclick: () => onMeasure() }, "Start my first self-check"))));
      return;
    }
    const s = routine.status, dueText = profile === "elena" || member ? (s.doneToday ? "Today's check saved" : "Today's check: open") : routine.due?.label;
    const active = model.plan?.steps.find(step => step.active);
    const hero = el("header", { class: "db-hero" }, who,
      el("div", { class: `db-overall db-card db-st-${model.overall}` },
        el("div", { class: "db-overall-word" }, el("i", { "aria-hidden": "true" }, model.mark.glyph), el("b", {}, model.mark.word)),
        el("p", {}, model.headline),
        active ? el("p", { class: "db-who-tell" }, el("b", {}, `${active.title} · ${active.who}. `), active.detail) : null),
      el("div", { class: "db-routine db-card" },
        el("div", { class: "db-streak" }, el("strong", {}, String(s.streak)), el("span", {}, "day streak"), el("small", {}, `${s.total} checks · longest ${s.longest}`)),
        el("small", {}, dueText),
        el("div", { class: "sc-badges", role: "list", "aria-label": "Badges" }, s.badges.map(b => el("span", { role: "listitem", class: `sc-badge ${b.earned ? "sc-earned" : ""}`, title: b.detail }, b.earned ? "★ " : "☆ ", b.label)))));

    const domains = el("div", { class: "db-domains", role: "list", "aria-label": "Body systems" }, model.domains.map(d =>
      el("div", { role: "listitem", class: `db-domain db-card db-st-${d.status}` },
        el("span", { class: "db-domain-head" }, el("b", {}, d.label), mark(d.status)),
        el("small", {}, d.flagged.length ? d.flagged.join(", ") : d.status === "notChecked" ? "Not measured" : "Within usual range"))));

    const selected = model.tiles.some(t => t.key === chartKey && t.points >= 2) ? chartKey : model.chartKey;
    // Two-tile systems share the last row, so the grid has no half-empty rows.
    const grid = el("div", { class: "db-grid" }, GRID_ORDER.map(key => {
      const tiles = model.tiles.filter(t => t.domain === key);
      return el("section", { class: "db-group", "aria-label": DOMAIN_LABEL[key] }, el("h3", {}, DOMAIN_LABEL[key]), el("div", { class: "db-tiles" }, tiles.map(t => tile(t, t.key === selected))));
    }));

    const actions = el("section", { class: "db-actions db-card", "aria-label": "Next steps" },
      el("header", {}, el("b", {}, "Next steps"), el("small", {}, "Bounded actions only. AstroBone never diagnoses or prescribes.")),
      el("ol", {}, model.actions.slice(0, 4).map(a => el("li", { class: `db-act db-pr-${a.priority}` }, a.text))),
      el("div", { class: "db-buttons" },
        member ? el("button", { type: "button", class: "tw-primary", onclick: () => { view = "crew"; render(); } }, "Back to crew")
          : el("button", { type: "button", class: "tw-primary", onclick: () => onMeasure() }, profile === "elena" ? "Open Elena's self-check" : "Do today's self-check"),
        el("button", { type: "button", class: "tw-secondary", "aria-expanded": String(report), onclick: () => { report = !report; render(); } }, "Report for flight surgeon")),
      report ? el("pre", { class: "db-report", tabindex: "0", "aria-label": "Report for flight surgeon" },
        surgeonReport(model.evaluation, model.check, { environment, profile: member ? `DEMO-${member.id.toUpperCase()} (synthetic)` : profile === "elena" ? "DEMO-ELENA (synthetic)" : "This device" })) : null);

    // The crew share one spacecraft, so they share the cabin dosimeter's rate.
    const doseInfo = profile === "elena" || member ? dose() : null;
    const radiation = doseInfo ? el("section", { class: "db-dose db-card", "aria-label": "Radiation dose" },
      el("header", {}, el("b", {}, "Radiation dose"), el("small", {}, "Synthetic dosimeter")),
      el("strong", {}, doseInfo.text, el("small", {}, " mGy")), el("small", {}, doseInfo.detail)) : null;

    fillRoot(hero, domains, grid,
      el("div", { class: "db-bottom" }, chart(model, records, current, floors), el("div", { class: "db-side" }, actions, radiation)),
      adherence(profile, routine, member),
      el("small", { class: "db-boundary" }, member ? CREW_BOUNDARY : profile === "elena" ? ELENA_SELF_CHECK_BOUNDARY : "Your checks stay on this device. A self-monitoring record, not a diagnosis."));
  }
  function fillRoot(...children) { element.replaceChildren(...children.filter(Boolean)); }

  return { element, render, showCrew() { view = "crew"; chartKey = null; report = false; render(); } };
}

import { dashboardModel, adherenceStrip } from "./healthDashboard.js";
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
  let chartKey = null, report = false;

  function data() {
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
      "aria-label": `${t.def.label}: ${t.text}${t.unit}, ${t.mark.word}. Show over time.`, onclick: () => { chartKey = t.key; render(); element.querySelector(".db-chart")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); } },
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

  function adherence(profile, routine) {
    const strip = profile === "elena" ? adherenceStrip([...ELENA_CHECK_DAYS, ...(routine.status.doneToday ? [147] : [])], 147, { from: 1, to: 147 })
      : adherenceStrip(selfCheck.history().map(c => dayNumber(c.at)), dayNumber(), { from: dayNumber() - 59, to: dayNumber() });
    const label = d => (profile === "elena" ? `Day ${d.day}` : new Date((d.day + 0.5) * 86400e3).toLocaleDateString());
    return el("section", { class: "db-adherence db-card", "aria-label": "Checks done" },
      el("header", {}, el("b", {}, profile === "elena" ? "Daily checks, mission days 1-147" : "Daily checks, last 60 days"), el("small", {}, `${strip.done} done · ${strip.missed} missed`)),
      el("div", { class: "db-days", role: "img", "aria-label": `${strip.done} days checked and ${strip.missed} missed` },
        strip.cells.map(c => el("i", { class: `db-day db-${c.state}`, title: `${label(c)}: ${c.state.startsWith("today") ? (c.state === "today" ? "today, not saved yet" : "today, done") : c.state}` }))),
      el("small", { class: "db-note" }, "Filled = checked · empty = missed. Rewards the habit, never a health value."));
  }

  function render() {
    const { profile, environment, routine, model, records, current, floors } = data();
    const toggle = el("div", { class: "db-profile", role: "group", "aria-label": "Whose dashboard" },
      [["elena", "Elena · synthetic demo"], ["you", "You · this device"]].map(([key, label]) =>
        el("button", { type: "button", "aria-pressed": String(profile === key), onclick: () => { selfCheck.setProfile(key); chartKey = null; report = false; render(); } }, label)));
    const where = `${environment.label} · ${environment.place} · message to Earth ${environment.delayText} one way`;
    const who = el("div", { class: "db-who" }, el("span", { class: "tw-eyebrow" }, "MY HEALTH · TODAY"),
      el("h2", {}, profile === "elena" ? "Commander Elena Torres" : "You"),
      el("small", {}, profile === "elena" ? `Mission day 147 · ${where}` : where), toggle);

    if (model.empty) {
      fillRoot(el("header", { class: "db-hero" }, who,
        el("div", { class: "db-overall db-card" }, el("p", {}, selfCheck.locked() ? "Your saved checks are locked. Unlock them in Self-Check to see your dashboard." : "No self-checks on this device yet. Your dashboard fills in from your first check; comparisons start after 3."),
          el("button", { type: "button", class: "tw-primary", onclick: () => onMeasure() }, "Start my first self-check"))));
      return;
    }
    const s = routine.status, dueText = profile === "elena" ? (s.doneToday ? "Today's check saved" : "Today's check: open") : routine.due?.label;
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
        el("button", { type: "button", class: "tw-primary", onclick: () => onMeasure() }, profile === "elena" ? "Open Elena's self-check" : "Do today's self-check"),
        el("button", { type: "button", class: "tw-secondary", "aria-expanded": String(report), onclick: () => { report = !report; render(); } }, "Report for flight surgeon")),
      report ? el("pre", { class: "db-report", tabindex: "0", "aria-label": "Report for flight surgeon" },
        surgeonReport(model.evaluation, model.check, { environment, profile: profile === "elena" ? "DEMO-ELENA (synthetic)" : "This device" })) : null);

    const doseInfo = profile === "elena" ? dose() : null;
    const radiation = doseInfo ? el("section", { class: "db-dose db-card", "aria-label": "Radiation dose" },
      el("header", {}, el("b", {}, "Radiation dose"), el("small", {}, "Synthetic dosimeter")),
      el("strong", {}, doseInfo.text, el("small", {}, " mGy")), el("small", {}, doseInfo.detail)) : null;

    fillRoot(hero, domains, grid,
      el("div", { class: "db-bottom" }, chart(model, records, current, floors), el("div", { class: "db-side" }, actions, radiation)),
      adherence(profile, routine),
      el("small", { class: "db-boundary" }, profile === "elena" ? ELENA_SELF_CHECK_BOUNDARY : "Your checks stay on this device. A self-monitoring record, not a diagnosis."));
  }
  function fillRoot(...children) { element.replaceChildren(...children.filter(Boolean)); }

  return { element, render };
}

const el = (tag, text = "") => { const n = document.createElement(tag); n.textContent = text; return n; };
const link = (text, url) => { const n = el("a", text); n.href = url; n.target = "_blank"; n.rel = "noopener noreferrer"; return n; };

export function researchSeries(external) {
  const choices = [];
  const c = external.research?.cardiovascular, r = external.research?.radiation;
  if (c) choices.push({ ...c, id: c.accession, label: `${c.accession} / Serum CRP`, statistic: "Median", points: c.points });
  if (r) for (const key of new Set(r.groups.map(p => `${p.radiation}|${p.doseGy}`))) {
    const [name, dose] = key.split("|");
    choices.push({ ...r, id: `${r.accession}-${key}`, label: `${r.accession} / ${name}, ${dose} Gy`, statistic: "Median",
      points: r.groups.filter(p => `${p.radiation}|${p.doseGy}` === key).map(p => ({ ...p, visit: `Month ${p.month}` })) });
  }
  const bone = external.bone, source = external.research?.bone;
  if (bone && source) {
    const row = bone.flightVsGroundControl.find(r => r.site === "CorticalFemur" && r.measure === "cortical_thickness_millimeter");
    if (row) choices.push({ ...source, id: source.accession, label: `${source.accession} / Femoral cortical thickness`, statistic: "Mean", unit: "mm",
      method: "Prepared flight-versus-ground-control means; distinct mouse groups, not a longitudinal crew trend.",
      points: [{ visit: "Ground control", median: row.groundMean, n: row.groundN }, { visit: "Spaceflight", median: row.flightMean, n: row.flightN }] });
  }
  for (const study of external.extended?.studies || []) for (const metric of study.metrics) {
    choices.push({ ...study, ...metric, id: `${study.accession}-${metric.field}`, label: `${study.accession} / ${metric.label}`, statistic: "Median" });
  }
  return choices;
}

export function renderResearchExplorer(parent, external) {
  const choices = researchSeries(external);
  if (!choices.length) { parent.append(el("p", "NASA research unavailable. No substitute values.")); return; }
  parent.append(el("p", "NASA OSDR / external cohorts. These observations do not update Elena's measurements or predict personal risk."));
  const label = el("label", "Dataset and measurement"), select = el("select"), content = el("div");
  select.id = "mi-research-metric"; select.setAttribute("aria-label", "NASA dataset and measurement");
  choices.forEach(c => select.append(new Option(c.label, c.id))); label.append(select); parent.append(label, content);
  function render() {
    const s = choices.find(c => c.id === select.value); content.replaceChildren();
    content.append(el("h3", s.title), el("p", `${s.population} / ${s.records} source records${s.participants ? ` / ${s.participants} participants` : ""}`),
      el("p", `${s.statistic} ${s.metric || s.label.split(" / ").at(-1)} (${s.unit})`));
    const canvas = el("canvas"); canvas.width = 760; canvas.height = 220; canvas.className = "mi-science-chart";
    canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", s.points.map(p => `${p.visit}: ${p.median ?? "missing"} ${s.unit}, n=${p.n}`).join("; "));
    content.append(canvas);
    const width = Math.max(280, Math.round(canvas.clientWidth)), ratio = Math.min(devicePixelRatio, 2);
    canvas.width = width*ratio; canvas.height = 220*ratio;
    const ctx = canvas.getContext("2d"), valid = s.points.filter(p => Number.isFinite(p.median)); ctx.scale(ratio,ratio);
    if (valid.length) {
      const lo = Math.min(...valid.map(p => p.min ?? p.median)), hi = Math.max(...valid.map(p => p.max ?? p.median)), span = hi-lo || 1;
      const y = v => 170-(v-lo)/span*120, x = i => 55+i/Math.max(1,s.points.length-1)*(width-80);
      ctx.font = "11px sans-serif"; ctx.fillStyle = "#a0b4ba";
      ctx.fillText(hi.toFixed(2), 2, 54); ctx.fillText(lo.toFixed(2), 2, 174);
      ctx.strokeStyle = "#294045"; ctx.beginPath(); ctx.moveTo(43, 40); ctx.lineTo(43, 180); ctx.lineTo(width-10, 180); ctx.stroke();
      s.points.forEach((p,i) => {
        ctx.fillStyle = "#a0b4ba"; ctx.textAlign = "center"; ctx.fillText(p.visit, x(i), 204);
        if (!Number.isFinite(p.median)) return;
        ctx.strokeStyle = "#8e72a8"; ctx.lineWidth = 2;
        if (Number.isFinite(p.min) && Number.isFinite(p.max)) { ctx.beginPath(); ctx.moveTo(x(i),y(p.min)); ctx.lineTo(x(i),y(p.max)); ctx.stroke(); }
        ctx.fillStyle = "#64decc"; ctx.beginPath(); ctx.arc(x(i),y(p.median),5,0,Math.PI*2); ctx.fill();
      });
    }
    content.append(el("small", "Categorical study visits. Points: aggregate; whiskers when present: observed min-max, not confidence intervals."));
    const wrap = el("div"), table = el("table"), head = el("thead"), body = el("tbody"), tr = el("tr"); wrap.className = "mi-science-table";
    ["Visit", `${s.statistic} (${s.unit})`, "n", "Missing"].forEach(t => tr.append(el("th", t))); head.append(tr);
    s.points.forEach(p => { const row = el("tr"); [p.visit, Number.isFinite(p.median) ? p.median.toFixed(3) : "Unavailable", p.n, p.missing ?? "--"].forEach(v => row.append(el("td", String(v)))); body.append(row); });
    table.append(head, body); wrap.append(table); content.append(wrap, el("p", s.boundary), el("p", s.exclusions || ""));
    const details = el("details"); details.append(el("summary", "Method and original NASA files"), el("p", s.method || s.boundary), link(s.accession, s.url));
    for (const f of s.sources || []) details.append(link(f.file, f.url), el("code", `SHA-256 ${f.sha256}`)); content.append(details);
  }
  select.onchange = render; render();
}

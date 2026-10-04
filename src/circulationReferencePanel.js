const el = (tag, text = "") => { const n = document.createElement(tag); n.textContent = text; return n; };

export function renderCirculationReference(parent, data) {
  if (!data) { parent.append(el("p", "Reference simulation unavailable. No invented waveforms are substituted.")); return () => {}; }
  parent.append(el("p", "REFERENCE SIMULATION / not Elena's pressure, flow or organ function."), el("h3", data.title));
  const controls = el("div"), rate = el("select"), play = el("button", "Play cycle"), slider = el("input"), values = el("p");
  controls.className = "mi-cycle-controls"; rate.id = "mi-model-rate"; rate.setAttribute("aria-label", "Reference cycle rate");
  data.scenarios.forEach(s => rate.append(new Option(`${s.bpm} bpm / reference preset`, s.bpm)));
  play.type = "button"; play.id = "mi-cycle-play"; play.setAttribute("aria-pressed", "false");
  slider.type = "range"; slider.min = 0; slider.max = data.scenarios[0].samples.length-1; slider.step = 1; slider.value = 0; slider.id = "mi-cycle-phase"; slider.setAttribute("aria-label", "Reference cardiac cycle phase");
  values.id = "mi-cycle-values"; controls.append(rate, play); parent.append(controls, slider, values);
  const phase = el("div"); phase.className = "mi-flow-circuit";
  const atrium = el("span", "Left atrium"), mitral = el("span"), ventricle = el("span", "Left ventricle"), aortic = el("span"), systemic = el("span", "Systemic R / C");
  phase.append(atrium, mitral, ventricle, aortic, systemic); parent.append(phase);
  const plots = el("div"); plots.className = "mi-cycle-plots";
  const pressure = el("canvas"), pv = el("canvas");
  for (const [canvas, label] of [[pressure, "Arterial and left ventricular pressure over one cycle"], [pv, "Left ventricular pressure-volume loop"]]) {
    canvas.width = 560; canvas.height = 250; canvas.className = "mi-science-chart"; canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", label); plots.append(canvas);
  }
  parent.append(plots, el("small", "Coral: arterial pressure. Cyan: left ventricular pressure. Right: pressure-volume loop. Marker follows the selected cycle time."));
  const verification = el("p"); verification.id = "mi-model-verification"; parent.append(verification, el("p", data.boundary));
  const details = el("details"), source = el("a", "Physiome model, equations and license"); source.href = data.source; source.target = "_blank"; source.rel = "noopener noreferrer";
  details.append(el("summary", "Model provenance and numerical checks"), el("p", data.method), source,
    el("code", `Source SHA-256 ${data.sourceSha256}`), el("p", "Conservation, tighter-tolerance agreement and periodicity are engineering checks only. No comparison with a measured cardiovascular reference has been performed.")); parent.append(details);
  let scenario = data.scenarios[0], frame = null, started = 0, disposed = false, lastPaint = -Infinity;
  function stop() { if (frame !== null) cancelAnimationFrame(frame); frame = null; play.textContent = "Play cycle"; play.setAttribute("aria-pressed", "false"); }
  function axes(canvas, xLabel, yLabel, xMax, yMax, xMin = 0) {
    const c = canvas.getContext("2d"); c.clearRect(0,0,560,250); c.strokeStyle = "#345051"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(52,30); c.lineTo(52,206); c.lineTo(535,206); c.stroke(); c.fillStyle = "#a0b4ba"; c.font = canvas.clientWidth < 400 ? "18px sans-serif" : "12px sans-serif";
    c.fillText(yLabel, 8, 16); c.fillText(xLabel, 210, 243); c.fillText(yMax.toFixed(0), 8, 37); c.fillText("0", 29, 206);
    c.fillText(xMin.toFixed(1), 49, 225); c.fillText(xMax.toFixed(1), 500, 225);
    return { c, x: v => 52+(v-xMin)/Math.max(.001,xMax-xMin)*470, y: v => 206-v/yMax*172 };
  }
  function path(plot, points, getX, getY, color) {
    plot.c.strokeStyle = color; plot.c.lineWidth = 2; plot.c.beginPath(); points.forEach((p,i) => plot.c[i ? "lineTo" : "moveTo"](plot.x(getX(p)),plot.y(getY(p)))); plot.c.stroke();
  }
  function dot(plot,x,y) { plot.c.fillStyle = "#f3df9d"; plot.c.beginPath(); plot.c.arc(plot.x(x),plot.y(y),5,0,Math.PI*2); plot.c.fill(); }
  function render() {
    const sample = scenario.samples[Number(slider.value)], samples = scenario.samples;
    const maxPressure = Math.ceil(Math.max(...samples.flatMap(s => [s.arterialPressure,s.ventricularPressure]))/20)*20;
    const p = axes(pressure,"Time (s)","Pressure (mmHg)",scenario.periodSeconds,maxPressure);
    path(p,samples,s=>s.t,s=>s.arterialPressure,"#df9587"); path(p,samples,s=>s.t,s=>s.ventricularPressure,"#64decc"); dot(p,sample.t,sample.ventricularPressure);
    const minV = Math.floor(Math.min(...samples.map(s=>s.ventricularVolume))/10)*10, maxV = Math.ceil(Math.max(...samples.map(s=>s.ventricularVolume))/10)*10;
    const v = axes(pv,"LV volume (mL)","LV pressure (mmHg)",maxV,maxPressure,minV);
    path(v,samples,s=>s.ventricularVolume,s=>s.ventricularPressure,"#64decc"); dot(v,sample.ventricularVolume,sample.ventricularPressure);
    values.textContent = `${sample.t.toFixed(2)} s / LV ${sample.ventricularPressure.toFixed(1)} mmHg / ${sample.ventricularVolume.toFixed(1)} mL / aortic outflow ${sample.aorticFlow.toFixed(1)} mL/s`;
    mitral.textContent = `Mitral ${sample.mitralFlow > .1 ? "forward flow" : "no resolved flow"}`; aortic.textContent = `Aortic ${sample.aorticFlow > .1 ? "forward flow" : "no resolved flow"}`;
    mitral.dataset.open = String(sample.mitralFlow > .1); aortic.dataset.open = String(sample.aorticFlow > .1);
    slider.setAttribute("aria-valuetext", `${sample.t.toFixed(2)} seconds`);
    verification.textContent = `Numerical checks passed / conserved-volume error ${scenario.verification.conservedVolumeErrorMl.toExponential(1)} mL / cycle rate ${scenario.bpm} bpm. Not clinical validation.`;
  }
  function tick(now) {
    if (disposed || document.hidden || !parent.isConnected) { stop(); return; }
    if (now-lastPaint >= 1000/30) {
      slider.value = Math.floor(((now-started)/1000%scenario.periodSeconds)/scenario.periodSeconds*(scenario.samples.length-1)); render(); lastPaint=now;
    }
    frame = requestAnimationFrame(tick);
  }
  play.onclick = () => { if (frame !== null) { stop(); return; } started = performance.now()-Number(slider.value)/(scenario.samples.length-1)*scenario.periodSeconds*1000; lastPaint=-Infinity; play.textContent = "Pause cycle"; play.setAttribute("aria-pressed", "true"); frame = requestAnimationFrame(tick); };
  rate.onchange = () => { stop(); scenario = data.scenarios.find(s=>s.bpm===Number(rate.value)); slider.max=scenario.samples.length-1; slider.value=0; render(); };
  slider.oninput = () => { stop(); render(); };
  const visibility = () => { if (document.hidden) stop(); }; document.addEventListener("visibilitychange",visibility);
  render(); return () => { disposed=true; stop(); document.removeEventListener("visibilitychange",visibility); };
}

import "./uiV5.css";

const root = document.documentElement;
const themeToggle = document.getElementById("theme-toggle");
const themeLabel = document.getElementById("theme-label");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const compactViewport = window.matchMedia("(max-width: 700px)");

function preferredTheme() {
  try {
    const saved = localStorage.getItem("astrobone-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Theme persistence can be unavailable in privacy-restricted WebViews.
  }
  return "light";
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  try {
    localStorage.setItem("astrobone-theme", theme);
  } catch {
    // The selected theme still applies for the current session.
  }
  if (themeLabel) themeLabel.textContent = theme === "dark" ? "Dark" : "Light";
  if (themeToggle) {
    themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
    themeToggle.dataset.theme = theme;
  }
  window.dispatchEvent(new CustomEvent("astrobone-theme-change", { detail: { theme } }));
}

applyTheme(preferredTheme());
themeToggle?.addEventListener("click", () => {
  applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
});

// --- Ambient star / orbital field -------------------------------------------------
const starCanvas = document.getElementById("astro-particles");
const starCtx = starCanvas?.getContext("2d");
let stars = [];
let starDpr = 1;
let lastStarFrame = performance.now();
let starFrame = 0;
let starTimer = 0;

function queueStarFrame() {
  if (!starFrame && !starTimer && !reducedMotion && !compactViewport.matches && !document.hidden) {
    starTimer = window.setTimeout(() => {
      starTimer = 0;
      if (!document.hidden && !compactViewport.matches) {
        starFrame = requestAnimationFrame(drawStars);
      }
    }, 100);
  }
}

function resizeStars() {
  if (!starCanvas || !starCtx) return;
  starDpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  starCanvas.width = Math.max(1, Math.round(w * starDpr));
  starCanvas.height = Math.max(1, Math.round(h * starDpr));
  starCanvas.style.width = `${w}px`;
  starCanvas.style.height = `${h}px`;
  starCtx.setTransform(starDpr, 0, 0, starDpr, 0, 0);
  const count = Math.max(45, Math.min(115, Math.floor((w * h) / 13500)));
  stars = Array.from({ length: count }, (_, i) => ({
    x: (i * 97.31) % w,
    y: (i * 53.77) % h,
    r: 0.45 + ((i * 17) % 13) / 16,
    v: 1.2 + ((i * 11) % 17) / 8,
    phase: (i * 0.73) % (Math.PI * 2),
  }));
}

function drawStars(now) {
  starFrame = 0;
  if (!starCanvas || !starCtx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dt = Math.min(0.15, (now - lastStarFrame) / 1000);
  lastStarFrame = now;
  starCtx.clearRect(0, 0, w, h);
  const isLight = root.dataset.theme === "light";
  for (const star of stars) {
    star.y += star.v * dt;
    if (star.y > h + 3) star.y = -3;
    const twinkle = 0.45 + Math.sin(now / 1100 + star.phase) * 0.22;
    starCtx.beginPath();
    starCtx.fillStyle = isLight
      ? `rgba(23, 94, 128, ${Math.max(0.05, twinkle * 0.18)})`
      : `rgba(188, 247, 239, ${Math.max(0.08, twinkle * 0.52)})`;
    starCtx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    starCtx.fill();
  }
  queueStarFrame();
}

if (!reducedMotion && !compactViewport.matches) {
  resizeStars();
  queueStarFrame();
}
window.addEventListener("resize", () => {
  resizeStars();
  queueStarFrame();
}, { passive: true });

// --- Sampled scenario history ----------------------------------------------------
import { appendScenarioSample, normalizeScenarioSample } from "./scenarioHistory.js";
const telemetryCanvas = document.getElementById("live-telemetry-canvas");
const telemetryCtx = telemetryCanvas?.getContext("2d");
const historyLength = 110;
const histories = {
  demand: Array(historyLength).fill(null),
  capacity: Array(historyLength).fill(null),
  evidence: Array(historyLength).fill(null),
};
let telemetryDpr = 1;
let lastSample = 0;
let telemetryFrame = 0;
let telemetryTimer = 0;

function queueTelemetryFrame() {
  if (!telemetryFrame && !telemetryTimer && !document.hidden) {
    telemetryTimer = window.setTimeout(() => {
      telemetryTimer = 0;
      if (!document.hidden) {
        telemetryFrame = requestAnimationFrame(drawTelemetry);
      }
    }, 200);
  }
}

function readNumber(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const match = String(el.textContent || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function readCoverage() {
  const text = document.getElementById("decision-coverage")?.textContent || document.getElementById("scene-evidence-count")?.textContent || "";
  const match = text.match(/(\d+)\s*(?:of|\/)\s*(\d+)/i);
  if (!match) return null;
  return Math.max(0, Math.min(1, Number(match[1]) / Math.max(1, Number(match[2]))));
}

function targetsFromApp() {
  const dcr = readNumber("risk-score");
  const capacityReduction = readNumber("source-fragility-value");
  return normalizeScenarioSample({
    demandCapacityRatio: dcr,
    capacityReductionPercent: capacityReduction,
    evidenceCoverage: readCoverage(),
  });
}

function resizeTelemetry() {
  if (!telemetryCanvas || !telemetryCtx) return;
  const rect = telemetryCanvas.getBoundingClientRect();
  telemetryDpr = Math.min(window.devicePixelRatio || 1, 2);
  telemetryCanvas.width = Math.max(1, Math.round(rect.width * telemetryDpr));
  telemetryCanvas.height = Math.max(1, Math.round(rect.height * telemetryDpr));
  telemetryCtx.setTransform(telemetryDpr, 0, 0, telemetryDpr, 0, 0);
}

function cssColor(name, fallback) {
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  return value || fallback;
}

function sampleTelemetry(now) {
  if (now - lastSample < 190) return;
  lastSample = now;
  const target = targetsFromApp();
  appendScenarioSample(histories, target, historyLength);

  const demandEl = document.getElementById("telemetry-demand");
  const capacityEl = document.getElementById("telemetry-capacity");
  const evidenceEl = document.getElementById("telemetry-evidence");
  if (demandEl) demandEl.textContent = dcrLabel(readNumber("risk-score"));
  if (capacityEl) {
    capacityEl.textContent = capacityReductionLabel(readNumber("source-fragility-value"));
  }
  if (evidenceEl) evidenceEl.textContent = target.evidence === null ? "--" : `${Math.round(target.evidence * 100)}%`;
}

function dcrLabel(value) {
  return value == null ? "--" : `${value.toFixed(2)} DCR`;
}

function capacityReductionLabel(value) {
  return value == null ? "--" : `${Math.round(value)}%`;
}

function drawTelemetry(now) {
  telemetryFrame = 0;
  if (!telemetryCanvas || !telemetryCtx) return;
  const rect = telemetryCanvas.getBoundingClientRect();
  if (Math.abs(telemetryCanvas.width / telemetryDpr - rect.width) > 2 || Math.abs(telemetryCanvas.height / telemetryDpr - rect.height) > 2) {
    resizeTelemetry();
  }
  sampleTelemetry(now);
  const w = rect.width;
  const h = rect.height;
  const ctx = telemetryCtx;
  ctx.clearRect(0, 0, w, h);

  const isLight = root.dataset.theme === "light";
  const grid = isLight ? "rgba(43,83,105,.10)" : "rgba(126,228,213,.085)";
  ctx.lineWidth = 1;
  ctx.strokeStyle = grid;
  for (let i = 1; i < 5; i += 1) {
    const y = (h / 5) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  for (let i = 1; i < 9; i += 1) {
    const x = (w / 9) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }

  const colors = {
    demand: cssColor("--curve-demand", "#3fe7cb"),
    capacity: cssColor("--curve-capacity", "#9e8cff"),
    evidence: cssColor("--curve-evidence", "#67b7ff"),
  };

  Object.entries(histories).forEach(([key, values], index) => {
    ctx.save();
    ctx.beginPath();
    let connected = false;
    values.forEach((value, i) => {
      if (value === null) { connected = false; return; }
      const x = (i / (values.length - 1)) * w;
      const y = h - (0.10 + value * 0.78) * h;
      if (!connected) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      connected = true;
    });
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = index === 0 ? 2.2 : 1.8;
    ctx.strokeStyle = colors[key];
    ctx.shadowBlur = isLight ? 4 : 15;
    ctx.shadowColor = colors[key];
    ctx.stroke();
    ctx.shadowBlur = 0;

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, `${colors[key]}20`);
    gradient.addColorStop(1, `${colors[key]}00`);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  });

  if (!reducedMotion) {
    const cursorX = ((now / 22) % Math.max(1, w));
    const cursorGradient = ctx.createLinearGradient(cursorX - 24, 0, cursorX + 24, 0);
    cursorGradient.addColorStop(0, "rgba(255,255,255,0)");
    cursorGradient.addColorStop(.5, isLight ? "rgba(20,117,142,.16)" : "rgba(113,255,232,.22)");
    cursorGradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = cursorGradient;
    ctx.fillRect(cursorX - 24, 0, 48, h);
  }

  queueTelemetryFrame();
}

if (telemetryCanvas && telemetryCtx) {
  resizeTelemetry();
  if (reducedMotion) {
    drawTelemetry(performance.now());
  } else {
    queueTelemetryFrame();
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resizeTelemetry).observe(telemetryCanvas);
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    lastStarFrame = performance.now();
    queueStarFrame();
    queueTelemetryFrame();
  }
});

// --- Subtle reveal animations -----------------------------------------------------
const revealTargets = document.querySelectorAll(
  ".mission-brief, .support-lifecycle, .simulation-shell, .controls, .decision-panel, .competition-panel, .validation-panel, .care-plan"
);
if (reducedMotion || typeof IntersectionObserver === "undefined") {
  revealTargets.forEach((node) => node.classList.add("ui-revealed"));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("ui-revealed");
    });
  }, { threshold: 0.08 });
  revealTargets.forEach((node) => observer.observe(node));
}

// Keep the active panel visually alive when values change.
["risk-score", "decision-score", "ai-score", "decision-coverage"].forEach((id) => {
  const node = document.getElementById(id);
  if (!node || reducedMotion) return;
  new MutationObserver(() => {
    node.classList.remove("metric-flash");
    void node.offsetWidth;
    node.classList.add("metric-flash");
  }).observe(node, { childList: true, characterData: true, subtree: true });
});


// --- Astra floating copilot window ------------------------------------------------
const copilotLauncher = document.getElementById("copilot-launcher");
const copilotPanel = document.getElementById("copilot-panel");
const copilotMinimize = document.getElementById("copilot-minimize");
const copilotClose = document.getElementById("copilot-close");
const copilotInput = document.getElementById("chat-input");
const workflowPanel = document.querySelector(".controls");

function positionCopilot() {
  if (!copilotPanel) return;
  // On wide screens, place Astra immediately to the left of the guided workflow
  // so the assistant never hides the evidence/actions the user is discussing.
  if (window.innerWidth >= 1181 && workflowPanel) {
    const rect = workflowPanel.getBoundingClientRect();
    const panelWidth = Math.min(430, window.innerWidth - 32);
    const desiredRight = Math.max(24, window.innerWidth - rect.left + 16);
    const leftEdge = window.innerWidth - desiredRight - panelWidth;
    root.style.setProperty("--astra-safe-right", `${leftEdge >= 16 ? desiredRight : 24}px`);
  } else {
    root.style.setProperty("--astra-safe-right", "24px");
  }
}

function setCopilotOpen(open, { focus = true } = {}) {
  if (!copilotPanel || !copilotLauncher) return;
  copilotPanel.hidden = !open;
  copilotLauncher.setAttribute("aria-expanded", String(open));
  copilotLauncher.classList.toggle("is-open", open);
  root.classList.toggle("astra-open", open);
  if (open) positionCopilot();
  if (open && focus) {
    window.setTimeout(() => copilotInput?.focus(), 80);
  } else if (!open && focus) {
    copilotLauncher.focus();
  }
}

copilotLauncher?.addEventListener("click", () => {
  setCopilotOpen(Boolean(copilotPanel?.hidden));
});
copilotMinimize?.addEventListener("click", () => setCopilotOpen(false));
copilotClose?.addEventListener("click", () => setCopilotOpen(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && copilotPanel && !copilotPanel.hidden) {
    setCopilotOpen(false);
  }
});


window.addEventListener("resize", () => {
  if (copilotPanel && !copilotPanel.hidden) positionCopilot();
}, { passive: true });

// When a user clicks a quick prompt from elsewhere in future, reveal the assistant.
document.querySelectorAll("[data-open-copilot]").forEach((button) => {
  button.addEventListener("click", () => setCopilotOpen(true));
});

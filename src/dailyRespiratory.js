import "./dailyRespiratory.css";
import { getHealthRecordStore } from "./healthRecordStore.js";
import { RESPIRATORY_HISTORY_PROFILE, respiratoryAttachment, mergeRespiratoryRecords } from "./respiratoryHistory.js";

const node = (tag, text, className) => { const item = document.createElement(tag); if (text != null) item.textContent = text; if (className) item.className = className; return item; };

// Capture remains in the laboratory, using its existing pose camera. Linking is
// explicit, so a previous day or a demo cannot silently become today's reading.
export function createDailyRespiratorySection({ getContext, onAttach }) {
  const context = getContext(), panel = node("section", null, "daily-respiratory");
  panel.setAttribute("aria-label", "Optional breathing record");
  panel.append(node("h3", "Optional breathing record"), node("p", "Attach a usable experimental respiratory-motion capture to this check and its reviewer report. It does not change the health assessment."));
  if (context.profile !== "you") {
    panel.append(node("p", "Demo mission: personal breathing recordings remain separate.", "daily-respiratory-note"));
    return panel;
  }
  if (context.locked) {
    panel.append(node("p", "Unlock your health record above to see or attach saved breathing captures.", "daily-respiratory-note"));
    return panel;
  }
  const store = getHealthRecordStore();
  const records = mergeRespiratoryRecords(store.load(RESPIRATORY_HISTORY_PROFILE, context.persist)).reverse();
  const attached = respiratoryAttachment(context.check?.respiratory);
  if (attached) {
    const summary = node("div", null, "daily-respiratory-attached");
    summary.append(node("strong", attached.rate.toFixed(1) + " breaths/min · experimental"), node("span", new Date(attached.recordedAt).toLocaleString() + " · " + (attached.source === "depth" ? "RGB-D import" : "Webcam") + " · " + Math.round(attached.quality * 100) + "% signal quality"));
    const detach = node("button", "Remove attachment", "sc-secondary"); detach.type = "button"; detach.dataset.respiratoryDetach = "";
    detach.addEventListener("click", () => onAttach(null)); summary.append(detach); panel.append(summary);
  }
  if (records.length) {
    const label = node("label", "Choose a saved capture "), select = document.createElement("select");
    select.setAttribute("aria-label", "Saved breathing capture"); select.dataset.respiratoryPicker = "";
    for (const record of records) { const option = node("option", new Date(record.recordedAt).toLocaleString() + " · " + record.rate.toFixed(1) + " breaths/min · " + (record.source === "depth" ? "RGB-D" : "Webcam")); option.value = record.id; select.append(option); }
    if (attached && records.some(r => r.id === attached.id)) select.value = attached.id;
    label.append(select); panel.append(label);
    const attach = node("button", "Attach selected capture", "sc-secondary"); attach.type = "button"; attach.dataset.respiratoryAttach = "";
    attach.addEventListener("click", () => {
      const fresh = getContext();
      if (fresh.profile !== "you" || fresh.locked) return;
      const current = mergeRespiratoryRecords(store.load(RESPIRATORY_HISTORY_PROFILE, fresh.persist));
      const record = current.find(r => r.id === select.value), summary = respiratoryAttachment(record);
      if (summary) onAttach(summary);
    });
    panel.append(attach, node("p", "Check the capture date before attaching. The original timestamp, source, protocol and signal quality stay with the report; signal quality is not measurement accuracy.", "daily-respiratory-note"));
  } else panel.append(node("p", "No saved usable breathing capture yet. Refused captures and synthetic examples never appear here.", "daily-respiratory-note"));
  const link = node("a", "Open breathing capture ↗", "daily-respiratory-link");
  link.href = (import.meta.env.BASE_URL || "/") + "lab.html#respiratory-monitor";
  link.target = "_blank"; link.rel = "noopener noreferrer"; panel.append(link);
  panel.append(node("p", "The capture opens separately so this check stays here. Enable saving on this device to carry a reading between pages, then refresh the saved-capture list.", "daily-respiratory-note"));
  const refresh = node("button", "Refresh saved captures", "sc-secondary"); refresh.type = "button"; refresh.dataset.respiratoryRefresh = "";
  refresh.addEventListener("click", () => {
    const fresh = createDailyRespiratorySection({ getContext, onAttach }); panel.replaceWith(fresh);
  });
  panel.append(refresh);
  return panel;
}

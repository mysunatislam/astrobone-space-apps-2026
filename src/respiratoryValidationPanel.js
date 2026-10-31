import { compareRespiratoryReference } from "./respiratoryValidation.js";

export function initRespiratoryValidationPanel(container) {
  if (!container) return;
  const panel = document.createElement("details"); panel.className = "resp-reference";
  panel.innerHTML = `<summary>Compare with a respiratory belt</summary><p>Import paired camera and reference windows to calculate error and usable coverage on this device. Include every attempt, including refused estimates. No reference study has been completed for this module.</p><label>Paired reference JSON<input type="file" accept=".json,application/json" data-reference-file></label><div role="status" data-reference-report>No paired reference data loaded.</div><p>Use pseudonymous participant codes. Files stay in memory. Error summaries describe your submitted windows; repeated measurements from one person are not independent validation.</p>`;
  container.append(panel);
  panel.querySelector("input").addEventListener("change", async event => {
    const input = event.currentTarget, file = input.files?.[0], output = panel.querySelector("[data-reference-report]");
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Use a file smaller than 2 MB.");
      const report = compareRespiratoryReference(JSON.parse(await file.text()));
      output.replaceChildren();
      const label = document.createElement("strong"); label.textContent = report.synthetic ? "SYNTHETIC ENGINEERING TEST" : "SUBMITTED REFERENCE COMPARISON"; output.append(label);
      const format = x => x === null ? "Unavailable" : x.toFixed(2);
      for (const [source, result] of Object.entries(report.bySource)) {
        const paragraph = document.createElement("p");
        paragraph.textContent = `${source}: ${result.usable}/${result.windows} usable windows (${Math.round(result.coverage * 100)}% coverage), ${result.subjects} participant(s). MAE ${format(result.mae)}, bias ${format(result.bias)} breaths/min. ${result.agreement ? `Exploratory 95% limits: ${format(result.agreement.lower)} to ${format(result.agreement.upper)} breaths/min.` : "At least two usable pairs are required for agreement limits."}`;
        output.append(paragraph);
      }
      const note = document.createElement("p"); note.textContent = report.limits; output.append(note);
    } catch (error) { output.textContent = `Reference file rejected: ${error.message}`; }
    finally { input.value = ""; }
  });
}

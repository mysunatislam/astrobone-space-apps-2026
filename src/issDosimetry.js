// Where a crew dosimeter reading sits against absorbed dose rates NASA actually measured aboard the
// ISS. Data: public/data/iss-dosimetry.json, built by scripts/build_iss_dosimetry.py from the
// radiation dosimetry records of NASA OSDR GeneLab flight studies. Those are area dosimeters in
// the module that held each payload, in mGy (absorbed), not a personal or effective (mSv) dose,
// so the app gives context only: no limit, risk or health effect is inferred.
export const ISS_DOSIMETRY_FILE = "data/iss-dosimetry.json";

const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const positive = v => Number.isFinite(v) && v > 0;
const study = v => typeof v === "string" && /^OSD-\d+$/.test(v);

export function validateIssDosimetry(data) {
  requireValue(data?.schema === "astrobone-iss-dosimetry-v1", "Unsupported dosimetry schema");
  requireValue(Array.isArray(data.missions) && data.missions.length > 0, "No dosimetry measurements");
  for (const m of data.missions) {
    requireValue(positive(m.days) && positive(m.dose_mGy) && positive(m.rate_mGy_per_day), "Invalid dose, rate or duration");
    requireValue(Math.abs(m.dose_mGy / m.rate_mGy_per_day - m.days) <= 1, "Dose, rate and duration do not agree");
    requireValue(typeof m.flight === "string" && m.flight.trim() && Array.isArray(m.studies) && m.studies.length && m.studies.every(study), "Missing NASA study identity");
  }
  const rates = data.missions.map(m => m.rate_mGy_per_day), s = data.summary?.rate_mGy_per_day;
  requireValue(s && s.min === Math.min(...rates) && s.max === Math.max(...rates) && s.min <= s.median && s.median <= s.max, "Summary does not match measurements");
  for (const source of data.sources?.studies ?? []) {
    const url = new URL(source.url);
    requireValue(url.protocol === "https:" && url.hostname === "osdr.nasa.gov" && /^[a-f0-9]{64}$/.test(source.sha256), "Unexpected NASA source");
  }
  return data;
}

// Mean absorbed dose rate from cumulative readings: the change between the first and last reading,
// or the last reading over its mission day when there is only one.
export function personalDoseRate(readings) {
  const rows = (readings ?? [])
    .filter(r => Number.isFinite(r?.mission_day) && Number.isFinite(r?.cumulative_personal_absorbed_dose_mgy))
    .sort((a, b) => a.mission_day - b.mission_day);
  if (!rows.length) return null;
  const first = rows[0], last = rows.at(-1);
  if (rows.length > 1 && last.mission_day > first.mission_day) {
    return { rate: (last.cumulative_personal_absorbed_dose_mgy - first.cumulative_personal_absorbed_dose_mgy) / (last.mission_day - first.mission_day),
      fromDay: first.mission_day, toDay: last.mission_day };
  }
  return last.mission_day > 0 ? { rate: last.cumulative_personal_absorbed_dose_mgy / last.mission_day, fromDay: 0, toDay: last.mission_day } : null;
}

export function doseRateContext(readings, reference) {
  const personal = personalDoseRate(readings);
  if (!personal || !reference) return null;
  const { min, median, max } = reference.summary.rate_mGy_per_day;
  const position = personal.rate < min ? "below" : personal.rate > max ? "above" : "within";
  const [from, to] = reference.summary.years;
  const range = `${min.toFixed(2)}-${max.toFixed(2)} mGy/day (median ${median.toFixed(2)})`;
  return {
    ...personal, position, min, median, max,
    text: `Day ${personal.fromDay}-${personal.toDay}: ${personal.rate.toFixed(2)} mGy/day, ${position} the ${range} that NASA measured aboard the ISS across ${reference.summary.flights.length} cargo flights, ${from}-${to} (NASA OSDR).`,
    note: position === "above"
      ? "Higher than every ISS measurement here. Expected beyond low Earth orbit or during a solar particle event; otherwise check the dosimeter and tell the flight surgeon."
      : "Area dosimeters, not a personal or effective dose. Context only; no limit or risk is inferred.",
  };
}

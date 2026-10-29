// Real solar energetic particle (SEP) events that NASA's DONKI database recorded, for the radiation
// panel. Data: public/data/donki-sep.json, built by scripts/build_donki_space_weather.py from the
// DONKI SEP web service (NASA Goddard CCMC). DONKI files one row per instrument and energy channel,
// and some rows are REleASE model forecasts, so rows are split into measured and forecast and the
// measured ones are grouped into episodes. Context only: an event says nothing about a crew dose.
export const SPACE_WEATHER_FILE = "data/donki-sep.json";

const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const DAY_MS = 864e5;
const donkiHosts = new Set(["ccmc.gsfc.nasa.gov", "kauai.ccmc.gsfc.nasa.gov", "api.nasa.gov"]);

export const isForecast = instrument => /^MODEL:/i.test(instrument);
// GOES orbits Earth; SOHO and ACE sit at L1, 1.5 million km sunward. STEREO-A can be far from Earth.
export const nearEarth = instrument => /^(GOES|SOHO|ACE)\b/i.test(instrument);
export const highEnergy = instrument => /^GOES\b.*>\s*100\s*MeV/i.test(instrument);

export function validateSpaceWeather(data) {
  requireValue(data?.schema === "astrobone-donki-sep-v1", "Unsupported space-weather schema");
  requireValue(Array.isArray(data.events) && data.events.length > 0, "No DONKI events");
  const ids = new Set();
  for (const e of data.events) {
    requireValue(typeof e.id === "string" && /-SEP-\d+$/.test(e.id) && !ids.has(e.id), "Missing or repeated DONKI SEP id");
    ids.add(e.id);
    requireValue(Number.isFinite(Date.parse(e.time)), "Invalid event time");
    requireValue(Array.isArray(e.instruments) && Array.isArray(e.linked), "Invalid event fields");
    if (e.link) requireValue(donkiHosts.has(new URL(e.link).hostname), "Unexpected event link");
  }
  requireValue(data.summary?.events === data.events.length, "Summary does not match events");
  const urls = [data.source?.url].flat();
  requireValue(urls.length && urls.every(u => donkiHosts.has(new URL(u).hostname)) && /^[a-f0-9]{64}$/.test(data.source.sha256), "Unexpected DONKI source");
  return data;
}

// Measured rows that share a linked flare/CME, or start within a day of the episode's last row,
// are one episode. Forecast-only rows are counted separately and never make an episode.
export function sepEpisodes(events) {
  const measured = events
    .map(e => ({ ...e, observed: e.instruments.filter(i => !isForecast(i)) }))
    .filter(e => e.observed.length)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const episodes = [];
  for (const e of measured) {
    const t = Date.parse(e.time), last = episodes.at(-1);
    if (last && (t - last.lastMs <= DAY_MS || e.linked.some(id => last.linked.has(id)))) {
      last.rows.push(e); last.lastMs = Math.max(last.lastMs, t); e.linked.forEach(id => last.linked.add(id));
    } else episodes.push({ rows: [e], startMs: t, lastMs: t, linked: new Set(e.linked) });
  }
  return episodes.map(({ rows, startMs, linked }) => {
    const instruments = [...new Set(rows.flatMap(r => r.observed))].sort();
    return {
      start: new Date(startMs).toISOString().slice(0, 16) + "Z",
      ids: rows.map(r => r.id), link: rows[0].link, instruments,
      nearEarth: instruments.some(nearEarth), highEnergy: instruments.some(highEnergy),
      flare: [...linked].some(id => /-FLR-/.test(id)), cme: [...linked].some(id => /-CME-/.test(id)),
    };
  });
}

export function spaceWeatherContext(data, recent = 3) {
  const episodes = sepEpisodes(data.events);
  const forecastRows = data.events.filter(e => e.instruments.length && e.instruments.every(isForecast)).length;
  const near = episodes.filter(e => e.nearEarth), high = episodes.filter(e => e.highEnergy);
  const { start, end } = data.window;
  return {
    episodes, near, high, forecastRows,
    recent: episodes.slice(-recent).reverse(),
    text: `NASA DONKI recorded ${episodes.length} measured solar particle events from ${start} to ${end}: ${near.length} seen near Earth, ${high.length} reaching >100 MeV at GOES.`,
    note: `${forecastRows} model-forecast rows left out. Real events, not this crew's dose: what one adds depends on location, shielding and the event.`,
  };
}

const spacecraft = instruments => [...new Set(instruments.map(i => i.split(":")[0].trim()))];

export const describeEpisode = e => [
  `${e.start.slice(0, 10)} ${e.start.slice(11, 16)} UTC: measured by ${spacecraft(e.instruments).join(", ")}`,
  e.highEnergy && ">100 MeV protons at GOES",
  (e.flare || e.cme) && `after a ${[e.flare && "flare", e.cme && "CME"].filter(Boolean).join(" + ")}`,
].filter(Boolean).join("; ");

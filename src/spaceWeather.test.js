import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SPACE_WEATHER_FILE, validateSpaceWeather, sepEpisodes, spaceWeatherContext, describeEpisode } from "./spaceWeather.js";

const data = validateSpaceWeather(JSON.parse(await readFile(new URL(`../public/${SPACE_WEATHER_FILE}`, import.meta.url), "utf8")));
const row = (id, time, instruments, linked = []) => ({ id, time, instruments, linked, link: "https://ccmc.gsfc.nasa.gov/DONKI/view/SEP/1/-1" });

test("bundle: real DONKI SEP rows, hashed, from a NASA DONKI host", () => {
  assert.ok(data.events.length >= 50, data.events.length);
  assert.match(data.source.sha256, /^[0-9a-f]{64}$/);
  // The May 2024 storm reached >100 MeV at GOES; a real bundle over that window must hold it.
  const may2024 = sepEpisodes(data.events).find(e => e.start.startsWith("2024-05-1"));
  assert.ok(!data.window.start || data.window.start > "2024-05-10" || may2024?.highEnergy, "May 2024 event missing");
});

test("model forecasts never count as a measured event", () => {
  const episodes = sepEpisodes([row("a-SEP-001", "2025-01-01T00:00Z", ["MODEL: REleASE:ACE/EPAM 15.8-39.8 MeV"])]);
  assert.equal(episodes.length, 0);
  const mixed = sepEpisodes([row("b-SEP-001", "2025-01-01T00:00Z", ["MODEL: REleASE:ACE/EPAM 15.8-39.8 MeV", "GOES-P: SEISS >10 MeV"])]);
  assert.deepEqual(mixed[0].instruments, ["GOES-P: SEISS >10 MeV"]);
});

test("channels within a day or sharing a flare are one episode; separate days are two", () => {
  const episodes = sepEpisodes([
    row("c-SEP-001", "2025-03-01T10:00Z", ["GOES-P: SEISS >10 MeV"], ["2025-03-01T08:00:00-FLR-001"]),
    row("c-SEP-002", "2025-03-01T14:00Z", ["GOES-P: SEISS >100 MeV"]),
    row("c-SEP-003", "2025-03-03T09:00Z", ["SOHO: COSTEP 15.8-39.8 MeV"], ["2025-03-01T08:00:00-FLR-001"]),
    row("d-SEP-001", "2025-04-10T00:00Z", ["STEREO A: IMPACT 13-100 MeV"]),
  ]);
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes[0].ids, ["c-SEP-001", "c-SEP-002", "c-SEP-003"]);
  assert.ok(episodes[0].highEnergy && episodes[0].nearEarth && episodes[0].flare);
  assert.ok(!episodes[1].nearEarth && !episodes[1].highEnergy);
  assert.equal(describeEpisode(episodes[0]), "2025-03-01 10:00 UTC: measured by GOES-P, SOHO; >100 MeV protons at GOES; after a flare");
});

test("context counts only measured episodes and says it is not a crew dose", () => {
  const c = spaceWeatherContext(data);
  assert.equal(c.forecastRows, data.events.filter(e => e.instruments.length && e.instruments.every(i => i.startsWith("MODEL"))).length);
  assert.ok(c.episodes.length > 0 && c.episodes.length < data.events.length);
  assert.ok(c.high.every(e => e.nearEarth));
  assert.match(c.note, /not this crew's dose/);
  assert.equal(c.recent[0], c.episodes.at(-1));
});

test("validator refuses a foreign link, a repeated id or a summary that disagrees", () => {
  const foreign = structuredClone(data); foreign.events[0].link = "https://example.com/x";
  assert.throws(() => validateSpaceWeather(foreign), /link/);
  const repeated = structuredClone(data); repeated.events[1].id = repeated.events[0].id;
  assert.throws(() => validateSpaceWeather(repeated), /repeated/);
  const summary = structuredClone(data); summary.summary.events += 1;
  assert.throws(() => validateSpaceWeather(summary), /Summary/);
});

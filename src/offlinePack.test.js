import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { OFFLINE_CACHE } from "./offline.js";

const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const core = JSON.parse(`[${sw.match(/const CORE = \[([\s\S]*?)\];/)[1].replace(/\/\/.*$/gm, "").replace(/,\s*$/, "")}]`);

test("the page reads the same offline cache the service worker writes", () => {
  assert.equal(sw.match(/const CACHE = "([^"]+)"/)[1], OFFLINE_CACHE);
});

test("every NASA data file ships in the offline pack, so the self-check works after one visit", () => {
  for (const file of readdirSync(new URL("../public/data/", import.meta.url))) assert.ok(core.includes(`data/${file}`), `data/${file} missing from CORE in public/sw.js`);
});

test("every file in the offline pack exists", () => {
  for (const path of core.filter(p => p !== "./")) {
    const inPublic = existsSync(new URL(`../public/${path}`, import.meta.url)), page = existsSync(new URL(`../${path}`, import.meta.url));
    assert.ok(inPublic || page, path);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { OFFLINE_CACHE, afterFirstLoad } from "./offline.js";

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

test("the pack holds the one MediaPipe build the vision workers load, not the 23 MB they never request", () => {
  const src = new URL("./", import.meta.url), calls = [];
  for (const file of readdirSync(src).filter(f => f.endsWith(".js") && !f.endsWith(".test.js"))) {
    for (const match of readFileSync(new URL(file, src), "utf8").matchAll(/forVisionTasks\(([^)]*)\)/g)) calls.push([file, match[1]]);
  }
  assert.ok(calls.length >= 4, "pose, pulse, detail and object workers");
  for (const [file, args] of calls) assert.match(args, /,\s*true$/, `${file} must load the module build (or CORE in public/sw.js must change)`);
  assert.ok(core.includes("mediapipe/vision_wasm_module_internal.js") && core.includes("mediapipe/vision_wasm_module_internal.wasm"));
  assert.deepEqual(core.filter(p => /vision_wasm_(internal|nosimd)/.test(p)), []);
});

// A stand-in window: the document is still loading until fireLoad() runs.
function fakeWindow(readyState = "loading") {
  let onLoad = null;
  return {
    document: { readyState },
    addEventListener: (type, fn) => { if (type === "load") onLoad = fn; },
    fireLoad: () => onLoad?.(),
    setTimeout, clearTimeout,
  };
}
const settledWithin = (promise, ms) => Promise.race([promise.then(() => true), new Promise(r => setTimeout(() => r(false), ms))]);

test("the offline pack waits for the page's own download before starting", async () => {
  const win = fakeWindow("complete");
  let finishTwin;
  const twin = new Promise(r => { finishTwin = r; });
  const start = afterFirstLoad(twin, { win, maxWait: 5000 });
  assert.equal(await settledWithin(start, 50), false, "not while the twin is still loading");
  finishTwin(true);
  assert.equal(await settledWithin(start, 200), true);
});

test("the offline pack also waits for the window load event", async () => {
  const win = fakeWindow("loading"), start = afterFirstLoad(Promise.resolve(), { win, maxWait: 5000 });
  assert.equal(await settledWithin(start, 50), false);
  win.fireLoad();
  assert.equal(await settledWithin(start, 200), true);
});

test("a failed or stalled page load never stops the offline pack", async () => {
  assert.equal(await settledWithin(afterFirstLoad(Promise.reject(new Error("no WebGL")), { win: fakeWindow("complete") }), 200), true);
  assert.equal(await settledWithin(afterFirstLoad(new Promise(() => {}), { win: fakeWindow("loading"), maxWait: 30 }), 300), true);
});

test("the twin page hands its 3D load to the offline pack", () => {
  const main = readFileSync(new URL("./twinMain.js", import.meta.url), "utf8");
  assert.match(main, /registerOffline\(app\.loaded\)/);
  assert.match(readFileSync(new URL("./twinApp.js", import.meta.url), "utf8"), /return \{ scene, state, loaded,/);
});

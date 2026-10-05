import { chromium } from "playwright";

// Verifies the offline pack: load once online, cut the network, reload, and check the
// twin and Live Capture still start. Run against a production build (vite preview).
const base = process.argv[2] ?? "http://127.0.0.1:5190/";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
// ERR_ABORTED is a scene releasing its video on purpose, not a missing file.
page.on("requestfailed", r => { if (r.failure()?.errorText !== "net::ERR_ABORTED") errors.push(`failed ${r.url()} ${r.failure()?.errorText}`); });
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`${base}`, { waitUntil: "load" });
await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready, null, { timeout: 30000 });
await page.evaluate(() => navigator.serviceWorker.ready);
// Wait until the install step has cached the core pack.
await page.waitForFunction(async () => (await (await caches.open("astrobone-offline-v5")).keys()).length >= 20, null, { timeout: 120000, polling: 1000 });
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__astroboneTwin?.scene?.ready, null, { timeout: 120000 });
const cachedKeys = await page.evaluate(async () => (await (await caches.open("astrobone-offline-v5")).keys()).map(r => r.url.replace(location.origin, "")));
const cached = cachedKeys.length;
console.log(cachedKeys.filter(k => /assets|mediapipe|task/.test(k)).join(" | "));
await context.setOffline(true);
const result = {};
for (const path of ["", "lab.html"]) {
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  if (path === "") {
    await page.waitForFunction(() => window.__astroboneTwin?.scene?.ready, null, { timeout: 120000 });
    result.twin = await page.evaluate(() => ({ online: navigator.onLine, layers: document.getElementById("tw-canvas").dataset.layers.split(",").length }));
  } else {
    await page.waitForSelector(".lab-top", { timeout: 60000 });
    result.lab = await page.evaluate(() => ({ online: navigator.onLine, header: !!document.querySelector(".lab-top .tw-live"), tabs: [...document.querySelectorAll(".companion-tabs button")].map(b => b.textContent) }));
  }
}
console.log(JSON.stringify({ cached, ...result, errors }, null, 2));
await browser.close();

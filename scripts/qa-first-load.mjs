// First visit on a slow link: when does the self-check appear, when is the 3D twin ready, and when is the
// offline pack complete? Serve a Pages build through scripts/throttled-server.mjs, then run
//   node scripts/qa-first-load.mjs http://127.0.0.1:5193/astrobone-space-apps-2026/ allow   (or block: no service worker)
// The headless flags are the ones this project uses for SwiftShader WebGL; CHROMIUM_PATH picks another browser build.
import { chromium } from "playwright";
const [base, mode] = [process.argv[2], process.argv[3] ?? "allow"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: mode });
const page = await ctx.newPage();
await page.addInitScript(() => sessionStorage.setItem("astrobone-twin-intro", "1"));
let bytes = 0; page.on("response", async r => { const l = Number(r.headers()["content-length"] ?? 0); bytes += l; });
const t0 = Date.now();
await page.goto(`${base}#selfcheck`, { waitUntil: "domcontentloaded", timeout: 300000 });
const dcl = Date.now() - t0;
await page.waitForSelector(".sc-routine", { timeout: 300000 });
const selfCheck = Date.now() - t0, bytesAtSelfCheck = bytes;
await page.waitForFunction(() => window.__astroboneTwin?.scene?.ready, null, { timeout: 300000, polling: 200 });
const twin = Date.now() - t0;
let packS = null, packFiles = null, packMB = null;
if (mode === "allow") {
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then(r => r?.active), null, { timeout: 600000, polling: 500 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  packS = (Date.now() - t0) / 1000;
  ({ packFiles, packMB } = await page.evaluate(async () => { const name = (await caches.keys()).find(k => k.startsWith("astrobone-offline")); const c = await caches.open(name), keys = await c.keys(); let total = 0; for (const k of keys) total += (await (await c.match(k)).blob()).size; return { packFiles: keys.length, packMB: +(total / 1048576).toFixed(1) }; }));
}
console.log(JSON.stringify({ mode, dclS: dcl / 1000, selfCheckS: selfCheck / 1000, twinReadyS: twin / 1000, pageMBAtSelfCheck: +(bytesAtSelfCheck / 1048576).toFixed(1), pageMBAtTwin: +(bytes / 1048576).toFixed(1), packS, packFiles, packMB }));
await browser.close();

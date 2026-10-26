// Video assets from the validation report: 1920 x 1080 stills of each panel and short screen clips of the
// animations (replay, pulse wave, hybrid charts), recorded headless. Usage:
//   PW_PATH=<playwright> CHROMIUM_PATH=<chrome> node assets.mjs <report.html> <out dir>
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || "playwright");
const [file, out] = process.argv.slice(2);
mkdirSync(`${out}/stills`, { recursive: true }); mkdirSync(`${out}/clips`, { recursive: true });
const html = readFileSync(file, "utf8");
const doc = extra => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${html}<style>${extra || ""}</style></body></html>`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

// Stills: each panel on its own, at 2x for crisp 1080p crops (CLIPS_ONLY=1 skips them).
if (!process.env.CLIPS_ONLY) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 2000 }, deviceScaleFactor: 2 });
  await page.setContent(doc(), { waitUntil: "load" });
  await page.waitForTimeout(3000);
  const shots = [["#stage", "01-knee-replay"], ["#tiles", "02-headline-numbers"], ["#pose", "03-pose-models"], ["#flow", "04-hybrid-diagram"],
    ["#dumbbell", "05-every-person-improved", ".card"], ["#byview", "06-error-by-camera-position", ".card"], ["#ba", "07-bland-altman", ".card"], ["#hytable", "08-six-ways-table", ".card"],
    ["#wave", "09-pulse-wave", ".card"], ["#old-callout", "10-old-vs-hybrid-pulse", ".card"], ["#leader", "11-pulse-leaderboard", ".card"], ["#sweep", "12-accuracy-vs-coverage", ".card"],
    ["#slope", "13-rest-vs-after-squats", ".card"], ["#delta-card", "14-baseline-change-table"], ["#nasa", "15-nasa-context"], ["#changes", "16-what-changed"],
    ["#tune", "17-pulse-hybrid-tuning", ".card"], ["#parts-card", "18-pulse-hybrid-vs-parts"]];
  for (const [sel, name, up] of shots) {
    const handle = up ? await page.$(`${sel} >> xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]`) : await page.$(sel);
    if (!handle) { console.log("missing", sel); continue; }
    // Clip from the viewport by the element's box: the page never stops animating, so Playwright's
    // "element is stable" wait would time out, and a full-page capture repaints every animation.
    await handle.evaluate(el => el.scrollIntoView({ block: "start" })); await page.waitForTimeout(1500);
    const box = await handle.evaluate(el => { const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: Math.min(r.height, innerHeight - Math.max(0, r.top)) }; });
    await page.screenshot({ path: `${out}/stills/${name}.png`, clip: box, timeout: 120000 });
  }
  await page.close();
}

// Clips: one element filling a 1920 x 1080 frame, recorded for a few seconds.
async function clip(name, selector, seconds, extraCss, width = "min(1800px,96vw)") {
  const dir = `${out}/clips/tmp-${name}`;
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir, size: { width: 1920, height: 1080 } } });
  const page = await context.newPage();
  const css = `body{overflow:hidden} .wrap{max-width:none;padding:0} body > .wrap > *:not(:has(${selector})), ${extraCss || ""}`;
  await page.setContent(doc(`body > .wrap > * { display: none !important } body > .wrap > *:has(${selector}) { display: grid !important } ${extraCss || ""}`), { waitUntil: "load" });
  // The element's card, centred on a plain backdrop so nothing else on the page shows around it.
  await page.evaluate(([sel, width]) => {
    const el = document.querySelector(sel), box = el.closest(".stage, .card, .panel") || el;
    const backdrop = document.createElement("div"); backdrop.style.cssText = `position:fixed;inset:0;z-index:49;background:${getComputedStyle(document.body).backgroundColor}`;
    document.body.append(backdrop);
    box.style.cssText += `;position:fixed;inset:0;margin:auto;width:${width};height:fit-content;max-height:96vh;overflow:hidden;z-index:50`;
  }, [selector, width]);
  await page.waitForTimeout(seconds * 1000);
  await context.close();
  const webm = readdirSync(dir).find(f => f.endsWith(".webm"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "1.2", "-i", `${dir}/${webm}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", "30", `${out}/clips/${name}.mp4`]);
  rmSync(dir, { recursive: true, force: true });
  console.log("clip", name);
}
await clip("knee-replay-two-cameras", "#stage", 24, ".cams{grid-template-columns:1fr 1fr} .cam{aspect-ratio:16/10}", "1400px");
await clip("pulse-wave-camera-vs-finger", "#wave", 14, "", "1600px");
await clip("every-person-improved", "#dumbbell", 6, "", "1000px");
await clip("pulse-leaderboard", "#leader", 6, "", "980px");
await clip("pulse-hybrid-tuning", "#tune", 5, "", "1000px");
await browser.close();

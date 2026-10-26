// Camera resting-pulse check in a real browser: Chromium's fake camera plays a real face video
// (converted to .y4m) and the self-check's Body step measures it with the shipped hybrid.
//   node scripts/qa-camera-pulse.mjs http://127.0.0.1:4173/ face.y4m [expectedBpm]
// expectedBpm is the contact-PPG heart rate of the same stretch, from the dataset.
import { chromium } from "playwright";

const [url = "http://127.0.0.1:4173/", y4m, expected] = process.argv.slice(2);
if (!y4m) throw new Error("Pass a .y4m face video for the fake camera.");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`, "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["camera"] });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") console.error("console:", m.text()); });
  page.on("worker", w => w.on("console", m => console.error("worker:", m.text())));
  await page.goto(url, { waitUntil: "load" });
  await page.locator(".tw-skip").click({ timeout: 15000 }).catch(() => {});
  await page.locator('[data-experience="selfcheck"]').click();
  await page.getByText("You · this device").click();
  await page.locator(".sc-steps button").nth(4).click();
  await page.getByText(/Measure resting pulse/).click();
  const statusLog = setInterval(async () => console.error("status:", await page.locator(".sc-pulse .sc-cam-status").textContent().catch(() => "?")), 10000);
  const result = page.locator(".sc-pulse .sc-result strong");
  await result.waitFor({ timeout: 180000 });
  clearInterval(statusLog);
  const text = await result.textContent(), detail = await page.locator(".sc-pulse .sc-result p").textContent().catch(() => "");
  const bpm = Number(text.match(/^(\d+) bpm/)?.[1]);
  const report = { result: text, detail, bpm: Number.isFinite(bpm) ? bpm : null, expected: expected ? Number(expected) : null, errors };
  console.log(JSON.stringify(report));
  if (!Number.isFinite(bpm) || (expected && Math.abs(bpm - Number(expected)) > 5) || errors.length) process.exitCode = 1;
} finally { await browser.close(); }

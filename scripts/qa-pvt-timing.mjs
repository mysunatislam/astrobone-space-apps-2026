// Reaction-test timing check in a real browser: a simulated person responds exactly 300 ms after the
// stimulus is drawn, and the test should score 300 ms. Run against a served build:
//   node scripts/qa-pvt-timing.mjs http://127.0.0.1:4173/
// Software rendering (no GPU) is the worst case for a stimulus drawn late behind the 3D view.
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:4173/", TRUE_RT = 300;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: "load" });
  await page.locator(".tw-skip").click({ timeout: 15000 }).catch(() => {});
  await page.locator('[data-experience="selfcheck"]').click();
  await page.getByText("You · this device").click();
  await page.locator(".sc-steps button").nth(2).click();
  await page.evaluate(trueRt => {
    const stage = document.querySelector(".sc-pvt-stage");
    window.qa = { drawDelays: [], scored: [] };
    new MutationObserver(() => {
      if (!stage.classList.contains("sc-on")) return;
      const set = performance.now();
      requestAnimationFrame(drawn => {
        window.qa.drawDelays.push(drawn - set);
        setTimeout(() => {
          stage.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true }));
          setTimeout(() => window.qa.scored.push(parseFloat(stage.dataset.count)), 5);
        }, Math.max(0, trueRt - (performance.now() - drawn)));
      });
    }).observe(stage, { attributes: true, attributeFilter: ["class"] });
  }, TRUE_RT);
  await page.getByText("1-minute practice").click();
  await page.waitForTimeout(45000);
  const { drawDelays, scored } = await page.evaluate(() => window.qa);
  const rts = scored.filter(Number.isFinite), mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  const report = { trueRtMs: TRUE_RT, responses: rts.length, scoredMeanMs: Math.round(mean(rts)), scoredMaxMs: Math.round(Math.max(...rts)), lapses: rts.filter(rt => rt >= 355).length, meanDrawDelayMs: Math.round(mean(drawDelays)) };
  console.log(JSON.stringify(report));
  if (rts.length < 5 || Math.abs(report.scoredMeanMs - TRUE_RT) > 20 || report.lapses) process.exitCode = 1;
} finally { await browser.close(); }

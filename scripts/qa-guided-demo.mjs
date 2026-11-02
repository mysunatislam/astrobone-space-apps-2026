// Browser checks for the chaptered guided demo and the personal/demo separation around it.
//   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/qa-guided-demo.mjs [base-url]
// Checks: every chapter opens directly and shows its view; Pause holds the chapter; Exit restores the
// person's own unfinished check; a demo capture started before a switch never lands on a personal check;
// the header fits without overflow from phone to wide desktop.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:5173/";
const out = resolve(".artifacts/guided-demo"); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" }), headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const EXPECT = ["mission|twin", "functional|physiology", "selfcheck", "selfcheck", "selfcheck", "health", "selfcheck", "twin|impact|functional", "evidence"];
async function open(viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce", serviceWorkers: "block" });
  const page = await context.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => { sessionStorage.setItem("astrobone-twin-intro", "1"); });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__astroboneTwin?.selfCheck?.snapshot), null, { timeout: 60000 });
  return { context, page, errors };
}
try {
  const { context, page, errors } = await open({ width: 1600, height: 900 });
  const app = fn => page.evaluate(fn);
  console.log("Personal draft survives the demo");
  await app(() => { const a = window.__astroboneTwin; a.selectProfile("you"); a.setExperience("selfcheck"); a.selfCheck.reset(); a.selfCheck.state.check.values.restingHr = 71; a.selfCheck.state.check.quality.restingHr = true; a.selfCheck.go(4); });
  const draftId = await app(() => window.__astroboneTwin.selfCheck.state.check.id);
  await app(() => window.__astroboneTwin.runDemo());
  await page.locator(".ab-demo-controls").waitFor();
  console.log("Pause holds, chapters open directly");
  await page.locator(".ab-demo-controls").getByRole("button", { name: "Pause", exact: true }).click();
  for (let i = 0; i < EXPECT.length; i++) {
    await page.getByRole("button", { name: new RegExp(`^Chapter ${i + 1}:`) }).click();
    await page.waitForTimeout(i === 7 ? 4000 : 1500);
    const now = await app(() => ({ exp: window.__astroboneTwin.state.experience, chapter: window.__astroboneTwin.state.demo?.chapter, profile: window.__astroboneTwin.selfCheck.state.profile }));
    assert.equal(now.chapter, i, `chapter ${i + 1} selected`);
    assert.match(now.exp, new RegExp(`^(${EXPECT[i]})$`), `chapter ${i + 1} shows ${EXPECT[i]} (got ${now.exp})`);
    assert.equal(now.profile, "elena");
    await page.screenshot({ path: resolve(out, `chapter-${i + 1}.png`), animations: "disabled" });
  }
  const held = await app(() => window.__astroboneTwin.state.demo.chapter); await page.waitForTimeout(6000);
  assert.equal(await app(() => window.__astroboneTwin.state.demo.chapter), held, "paused demo does not advance");
  console.log("Play advances on its own");
  await page.getByRole("button", { name: /^Chapter 6:/ }).click(); await page.locator(".ab-demo-controls").getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => window.__astroboneTwin.state.demo?.chapter === 6, null, { timeout: 30000 });
  console.log("Exit restores the personal check");
  await page.locator(".ab-demo-controls").getByRole("button", { name: "Exit demo", exact: true }).click();
  const after = await app(() => { const s = window.__astroboneTwin.selfCheck.state; return { profile: s.profile, id: s.check.id, hr: s.check.values.restingHr, step: s.step, demo: window.__astroboneTwin.state.demo }; });
  assert.deepEqual(after, { profile: "you", id: draftId, hr: 71, step: 4, demo: null });
  console.log("A pending demo capture never lands on a personal check");
  await app(() => { const a = window.__astroboneTwin; a.selectProfile("elena"); a.selfCheck.go(1); window.__pendingCapture = a.selfCheck.demoCapture("usable"); a.selectProfile("you"); });
  assert.equal(await app(() => window.__pendingCapture), false);
  assert.equal(await app(() => window.__astroboneTwin.selfCheck.state.check.values.kneeExtension), undefined);
  assert.equal(await app(() => window.__astroboneTwin.selfCheck.snapshot("you").history.some(c => /DEMO/.test(c.id))), false, "no demo check in personal history");
  assert.deepEqual(errors, []);
  await context.close();
  for (const width of [390, 768, 1280, 1440, 1600, 1920]) {
    const { context, page, errors } = await open({ width, height: 900 });
    for (const exp of ["mission", "health", "selfcheck", "crewmate", "evidence"]) {
      await page.evaluate(e => window.__astroboneTwin.setExperience(e), exp);
      const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth + 2, header: [...document.querySelectorAll(".tw-top > *")].some(n => { const r = n.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }) }));
      assert.equal(overflow.page, false, `${width} ${exp}: page scrolls sideways`);
      assert.equal(overflow.header, false, `${width} ${exp}: header item off screen`);
    }
    await page.evaluate(() => window.__astroboneTwin.setExperience("health"));
    await page.screenshot({ path: resolve(out, `health-${width}.png`), animations: "disabled" });
    assert.deepEqual(errors, []); await context.close();
  }
  console.log("Guided demo checks passed.");
} finally { await browser.close(); }

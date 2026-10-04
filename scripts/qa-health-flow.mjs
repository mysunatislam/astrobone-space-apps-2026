import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:5180/";
const output = resolve(".artifacts", "ui-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator("#companion-tab").click();
    await page.locator("#companion-service").getByText("Browser-only / no LLM").waitFor();
    assert.equal(await page.locator("#companion-prompt-group").isVisible(), false);
    assert.equal(await page.locator("#browser-review-note").isVisible(), true);
    await page.locator("#crew-demo").click();
    await page.locator("#crew-identity").getByText("SYNTHETIC DEMO").waitFor();
    assert.match(await page.locator("#crew-baseline-note").innerText(), /Day 1/);
    assert.equal(await page.locator("#crew-timeline").isVisible(), true);
    assert.equal(await page.locator("#companion-use-llm").isDisabled(), true);
    await page.locator("#companion-run").click();
    await page.locator("#companion-result").getByText("change observed").waitFor();
    assert.match(await page.locator("#companion-result").innerText(), /SYNTHETIC/);
    assert.match(await page.locator("#companion-message").innerText(), /Clinical predictions remain unavailable/i);
    assert.equal(await page.locator("#companion-sources a[href^='https://www.nasa.gov/']").count(), 2);
    assert.equal(await page.locator("#crew-comparison tr").count(), 4);
    assert.equal(await page.locator("#companion-export").isEnabled(), true);
    await page.locator("#crew-new").click();
    await page.locator("#crew-id-input").fill(`QA-${viewport.name.toUpperCase()}`);
    await page.locator("#crew-name-input").fill("Pseudonymous QA crew");
    await page.locator("#crew-create-form button[type='submit']").click();
    await page.locator("#crew-identity").getByText("Pseudonymous QA crew").waitFor();
    await page.locator(".companion-radiation summary").click();
    await page.locator("#crew-dose-day").fill("30");
    await page.locator("#crew-dose-mgy").fill("7.2");
    await page.locator("#crew-instrument-id").fill("DOS-QA-1");
    await page.locator("#crew-dose-consent").check();
    await page.locator("#crew-save-dose").click();
    await page.locator("#crew-radiation-status").getByText("7.2 mGy").waitFor();
    await page.locator("#companion-run").click();
    await page.locator("#companion-result").getByText("insufficient evidence").waitFor();
    assert.match(await page.locator("#companion-result").innerText(), /User-entered personal dosimeter: 7\.2 mGy/);
    assert.match(await page.locator("#companion-result").innerText(), /No organ or bone dose/);
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    assert.equal(horizontalOverflow, false, `${viewport.name} layout overflows horizontally`);
    await page.screenshot({
      path: resolve(output, `health-review-${viewport.name}.png`),
      fullPage: true, animations: "disabled",
    });
    await page.locator("#crew-camera").click();
    assert.equal(await page.locator(".health-overview").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(`[qa] ${viewport.name}: browser-only review and dosimeter context passed`);
    await page.close();
  }
} finally {
  await browser.close();
}

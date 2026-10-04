import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.cameraRequests = 0;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          window.cameraRequests++;
          throw new DOMException("Test permission denial", "NotAllowedError");
        },
      });
    });
    await page.goto(process.argv[2] || "http://127.0.0.1:5180/");
    await page.waitForFunction(() => document.querySelector("#risk-score")?.textContent.includes("x"));
    const button = page.locator("#toggle-camera");
    for (let count = 1; count <= 2; count++) {
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0);
      // DOM button.click() bypasses pointer capture and misses this regression.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction((expected) => window.cameraRequests === expected, count, { timeout: 10_000 });
      await page.waitForFunction(() => document.querySelector("#camera-status")?.textContent === "Camera unavailable");
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport, physicalPointerClicks: 2, cameraRequests: 2, errors }));
    await page.close();
  }
} finally {
  await browser.close();
}

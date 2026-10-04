import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const source = `data:image/jpeg;base64,${(await readFile('.artifacts/densepose-nasa-exercise.jpg')).toString('base64')}`;
for (let attempt = 0; attempt < 60; attempt++) {
  try { if ((await fetch('http://127.0.0.1:8012/health')).ok) break; } catch {}
  if (attempt === 59) throw new Error('DensePose localhost service unavailable');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(imageUrl => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const image = new Image(); image.src = imageUrl; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 427;
      const context = canvas.getContext('2d');
      const draw = () => context.drawImage(image, 0, 0, 640, 427);
      draw(); const timer = setInterval(draw, 80); const stream = canvas.captureStream(12);
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer)); return stream;
    } });
  }, source);
  await page.goto('http://127.0.0.1:5180/', { timeout: 60000 });
  await page.locator('#detail-tracking').uncheck();
  await page.locator('#object-awareness').uncheck();
  await page.locator('#densepose-consent').check();
  await page.locator('#densepose-start').click();
  await page.waitForFunction(() => ['Ready', 'Off'].includes(document.querySelector('#densepose-state').textContent), null, { timeout: 180000 });
  assert.equal(await page.locator('#densepose-state').textContent(), 'Ready', await page.locator('#densepose-status').textContent());
  await page.locator('#toggle-camera').click();
  await page.waitForFunction(() => !document.querySelector('.densepose-overlay').hidden || document.querySelector('#densepose-status').textContent.includes('unavailable'), null, { timeout: 90000 });
  assert.equal(await page.locator('.densepose-overlay').isVisible(), true, await page.locator('#densepose-status').textContent());
  await page.waitForTimeout(2500);
  const status = await page.locator('#densepose-status').textContent();
  assert.equal(await page.locator('#densepose-state').textContent(), 'GPU');
  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector('.densepose-overlay'), data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let colored = 0; for (let i=0;i<data.length;i+=4) if (data[i] > 100 && data[i] > data[i+1] * 1.3) colored++;
    return colored;
  });
  assert.ok(pixels > 1000, 'DensePose surface pixels must be visible');
  await page.locator('#pose-viewport').screenshot({ path: '.artifacts/ui-qa/densepose-gpu-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
  await page.locator('#pose-viewport').screenshot({ path: '.artifacts/ui-qa/densepose-gpu-mobile.png' });
  await page.locator('#densepose-stop').click();
  await page.locator('#toggle-camera').click();
  assert.deepEqual(errors, []);
  const result = { test: 'Real CUDA service plus browser plus MediaPipe', source: 'Repeated NASA exercise photograph, not live human validation', status, surfacePixelsVisible: pixels, desktopMobile: true, errors };
  await writeFile('.artifacts/ui-qa/densepose-gpu-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }

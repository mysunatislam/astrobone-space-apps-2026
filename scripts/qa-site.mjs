import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.argv[2] || "http://127.0.0.1:5180/";
const qaXrayArg = process.argv[3] || process.env.ASTROBONE_QA_XRAY || "";
const qaXray = qaXrayArg === "-" ? "" : qaXrayArg;
const viewportFilter = process.argv[4] || "";
const artifactDir = resolve(".artifacts", "ui-qa");
await mkdir(artifactDir, { recursive: true });

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
].filter((viewport) => !viewportFilter || viewport.name === viewportFilter);

const browser = await chromium.launch({ headless: true });
const results = [];

async function clickCameraButton(page) {
  const button = page.locator("#toggle-camera");
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error("Camera button has no pointer target.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    await page.addInitScript(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext("2d");
      let frame = 0;
      const draw = () => {
        context.fillStyle = "#101513";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#56e0c3";
        context.fillRect(250 + Math.sin(frame / 10) * 12, 80, 140, 320);
        frame += 1;
      };
      draw();
      globalThis.__astroboneQaCamera = {
        canvas,
        timer: setInterval(draw, 66),
        streams: [],
        requests: [],
      };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async (constraints) => {
          const stream = canvas.captureStream(15);
          globalThis.__astroboneQaCamera.streams.push(stream);
          globalThis.__astroboneQaCamera.requests.push(constraints);
          return stream;
        },
      });
      Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
        configurable: true,
        value: async () => [
          {
            kind: "videoinput",
            deviceId: "qa-integrated-camera",
            groupId: "qa-built-in",
            label: "QA Integrated Camera",
          },
          {
            kind: "videoinput",
            deviceId: "qa-usb-camera",
            groupId: "qa-usb",
            label: "QA USB Webcam",
          },
        ],
      });
    });
    const errors = [];
    page.on("console", (message) => {
      const text = message.text();
      const informationalRuntimeLine = text.startsWith(
        "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.",
      );
      if (message.type() === "error" && !informationalRuntimeLine) {
        errors.push(text);
      }
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForFunction(
      () => document.querySelector("#simulation-evidence-status")?.textContent
        !== "Loading",
      undefined,
      { timeout: 90_000 },
    );
    await page.waitForFunction(
      () => document.querySelector("#nasa-evidence-status")?.textContent
        !== "Loading",
      undefined,
      { timeout: 90_000 },
    );
    await page.waitForTimeout(1800);
    console.log(`[qa] ${viewport.name}: app and evidence loaded`);

    if (!await page.locator("body").evaluate((body) => body.classList.contains("health-active"))
      || !await page.locator(".health-overview").isVisible()
      || await page.locator("#ai-panel").isVisible()
      || await page.locator(".telemetry-deck").isVisible()) {
      throw new Error(`${viewport.name}: the first screen is not the focused health-monitoring workflow.`);
    }
    await page.screenshot({
      path: resolve(artifactDir, `health-capture-${viewport.name}.png`),
      fullPage: false,
      animations: "disabled",
    });
    await page.locator("#research-tab").click();
    if (!await page.locator("#ai-panel").isVisible()
      || !await page.locator(".telemetry-deck").isVisible()) {
      throw new Error(`${viewport.name}: research tools did not remain available after the focus change.`);
    }

    await page.waitForFunction(
      () => document.querySelectorAll("#camera-device option").length === 3,
      undefined,
      { timeout: 15_000 },
    );
    const motionGuardControls = await page.evaluate(() => ({
      jointRows: document.querySelectorAll(".motionguard-joint-row[data-joint]").length,
      traceJoints: [...document.querySelectorAll("#motionguard-trace-joint option")]
        .map((option) => option.value),
      protocols: [...document.querySelectorAll("#motionguard-mode option")]
        .map((option) => option.value),
      cameras: [...document.querySelectorAll("#camera-device option")]
        .map((option) => option.value),
    }));
    if (motionGuardControls.jointRows !== 4
      || !motionGuardControls.traceJoints.includes("shoulder")
      || !motionGuardControls.protocols.includes("reach")
      || !motionGuardControls.cameras.includes("qa-usb-camera")) {
      throw new Error(`${viewport.name}: full-body MotionGuard or webcam controls are incomplete.`);
    }
    await page.locator("#motionguard-trace-joint").selectOption("shoulder");
    if (await page.locator("#twin-left-joint-label").textContent() !== "Shoulder elevation") {
      throw new Error(`${viewport.name}: joint trace selection did not update the twin readout.`);
    }
    await page.locator("#motionguard-trace-joint").selectOption("knee");

    const twinLayout = await page.evaluate(() => {
      const box = (selector) => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        return rect ? {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        } : null;
      };
      const cameraAction = document.querySelector("#toggle-camera");
      return {
        feed: box(".live-view"),
        model: box(".skeleton-view"),
        trace: box("#motionguard-trace-canvas"),
        cameraActionInsideFeed: Boolean(cameraAction?.closest(".live-view")),
        feedLabel: document.querySelector("#twin-feed-label")?.textContent,
        modelLabel: document.querySelector(".twin-pane-header--model strong")?.textContent,
      };
    });
    if (!twinLayout.feed || !twinLayout.model || !twinLayout.trace
      || !twinLayout.cameraActionInsideFeed
      || twinLayout.feedLabel !== "Live crew feed"
      || twinLayout.modelLabel !== "3D movement view") {
      throw new Error(`${viewport.name}: synchronized camera/twin stage is incomplete.`);
    }
    if (viewport.name === "desktop") {
      const aligned = Math.abs(twinLayout.feed.top - twinLayout.model.top) <= 2
        && Math.abs(twinLayout.feed.height - twinLayout.model.height) <= 2;
      const sideBySide = twinLayout.feed.right <= twinLayout.model.left + 2;
      if (!aligned || !sideBySide || twinLayout.feed.width < 300 || twinLayout.model.width < 300) {
        throw new Error(`${viewport.name}: camera and digital twin are not a balanced side-by-side pair.`);
      }
    } else {
      const stacked = twinLayout.feed.bottom <= twinLayout.model.top + 2;
      if (!stacked || twinLayout.feed.height < 260 || twinLayout.model.height < 260) {
        throw new Error(`${viewport.name}: camera and digital twin are not preserved in the mobile stack.`);
      }
    }
    const tracePixelCheck = await page.evaluate(() => {
      const canvas = document.querySelector("#motionguard-trace-canvas");
      const context = canvas.getContext("2d");
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let minimum = 255;
      let maximum = 0;
      for (let index = 0; index < pixels.length; index += 16) {
        const luminance = pixels[index] * 0.2126
          + pixels[index + 1] * 0.7152
          + pixels[index + 2] * 0.0722;
        minimum = Math.min(minimum, luminance);
        maximum = Math.max(maximum, luminance);
      }
      return { width: canvas.width, height: canvas.height, minimum, maximum };
    });
    if (tracePixelCheck.width < 260 || tracePixelCheck.height < 68
      || tracePixelCheck.maximum - tracePixelCheck.minimum < 3) {
      throw new Error(`${viewport.name}: MotionGuard telemetry canvas is blank or undersized.`);
    }

    const initialTheme = await page.locator("html").getAttribute("data-theme");
    if (initialTheme !== "light") {
      throw new Error(`${viewport.name}: V5 did not start in the readable light theme.`);
    }
    const lightThemeLuminance = await page.evaluate(() => {
      const luminance = (selector) => {
        const color = getComputedStyle(document.querySelector(selector)).backgroundColor;
        const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      return { controls: luminance(".controls"), twin: luminance(".simulation-shell") };
    });
    if (lightThemeLuminance.controls < 170 || lightThemeLuminance.twin > 70) {
      throw new Error(`${viewport.name}: light surfaces or the dark twin viewport have incorrect contrast.`);
    }
    await page.waitForFunction(
      () => ["telemetry-demand", "telemetry-capacity", "telemetry-evidence"]
        .every((id) => document.getElementById(id)?.textContent !== "--"),
      undefined,
      { timeout: 15_000 },
    );
    const telemetry = await page.evaluate(() => ({
      demand: document.querySelector("#telemetry-demand")?.textContent,
      capacity: document.querySelector("#telemetry-capacity")?.textContent,
      evidence: document.querySelector("#telemetry-evidence")?.textContent,
      disclaimer: document.querySelector(".telemetry-disclaimer")?.textContent,
    }));
    if (!telemetry.disclaimer?.includes("does not combine")) {
      throw new Error(`${viewport.name}: telemetry evidence-separation disclaimer is missing.`);
    }

    await page.locator("#theme-toggle").evaluate((button) => button.click());
    if (await page.locator("html").getAttribute("data-theme") !== "dark") {
      throw new Error(`${viewport.name}: dark theme did not activate.`);
    }
    const darkThemeLuminance = await page.evaluate(() => {
      const luminance = (selector) => {
        const color = getComputedStyle(document.querySelector(selector)).backgroundColor;
        const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      return { controls: luminance(".controls"), twin: luminance(".simulation-shell") };
    });
    if (darkThemeLuminance.controls > 85 || darkThemeLuminance.twin > 70) {
      throw new Error(`${viewport.name}: dark theme or twin viewport contrast is incorrect.`);
    }
    await page.locator("#theme-toggle").evaluate((button) => button.click());
    if (await page.locator("html").getAttribute("data-theme") !== "light") {
      throw new Error(`${viewport.name}: light theme did not restore.`);
    }

    const messageCountBefore = await page.locator("#chat-log .message").count();
    await page.locator("#copilot-launcher").evaluate((button) => button.click());
    await page.locator("#copilot-panel").waitFor({ state: "visible" });
    const astraGeometry = await page.evaluate(() => {
      const panel = document.querySelector("#copilot-panel").getBoundingClientRect();
      const controls = document.querySelector(".controls").getBoundingClientRect();
      return {
        panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom },
        controlsLeft: controls.left,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });
    if (astraGeometry.panel.left < 0
      || astraGeometry.panel.right > astraGeometry.viewport.width + 1
      || astraGeometry.panel.top < 0
      || astraGeometry.panel.bottom > astraGeometry.viewport.height + 1) {
      throw new Error(`${viewport.name}: Astra is outside the visible viewport.`);
    }
    if (viewport.name === "desktop"
      && astraGeometry.panel.right > astraGeometry.controlsLeft + 1) {
      throw new Error(`${viewport.name}: Astra overlaps the guided workflow.`);
    }
    await page
      .locator('.copilot-suggestions button[data-prompt="What evidence is missing?"]')
      .evaluate((button) => button.click());
    await page.waitForFunction(
      (minimum) => document.querySelectorAll("#chat-log .message").length >= minimum + 2,
      messageCountBefore,
      { timeout: 10_000 },
    );
    const astraScreenshotPath = resolve(
      artifactDir,
      `astrobone-${viewport.name}-astra.png`,
    );
    await page.screenshot({
      path: astraScreenshotPath,
      fullPage: false,
      animations: "disabled",
      timeout: 120_000,
    });
    await page.locator("#copilot-close").evaluate((button) => button.click());
    const focusAfterAstra = await page.evaluate(
      () => document.activeElement?.id,
    );
    if (focusAfterAstra !== "copilot-launcher") {
      throw new Error(`${viewport.name}: Astra did not return keyboard focus to its launcher.`);
    }
    console.log(`[qa] ${viewport.name}: V5 theme, telemetry, and Astra passed`);

    const canvas = page.locator("#twin-canvas");
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox || canvasBox.width < 240 || canvasBox.height < 300) {
      throw new Error(`${viewport.name}: skeleton canvas is not correctly framed.`);
    }

    const pixelCheck = await page.evaluate(() => {
      const target = document.querySelector("#twin-canvas");
      const context = target.getContext("webgl2") || target.getContext("webgl");
      const width = context.drawingBufferWidth;
      const height = context.drawingBufferHeight;
      let minimum = 255;
      let maximum = 0;
      let visible = 0;
      const sampleSize = Math.max(24, Math.min(72, Math.floor(Math.min(width, height) / 8)));
      for (const xFraction of [0.15, 0.5, 0.85]) {
        for (const yFraction of [0.15, 0.5, 0.85]) {
          const x = Math.max(0, Math.min(width - sampleSize, Math.floor(width * xFraction - sampleSize / 2)));
          const y = Math.max(0, Math.min(height - sampleSize, Math.floor(height * yFraction - sampleSize / 2)));
          const pixels = new Uint8Array(sampleSize * sampleSize * 4);
          context.readPixels(
            x,
            y,
            sampleSize,
            sampleSize,
            context.RGBA,
            context.UNSIGNED_BYTE,
            pixels,
          );
          for (let index = 0; index < pixels.length; index += 16) {
            const luminance =
              pixels[index] * 0.2126
              + pixels[index + 1] * 0.7152
              + pixels[index + 2] * 0.0722;
            minimum = Math.min(minimum, luminance);
            maximum = Math.max(maximum, luminance);
            if (pixels[index + 3] > 0 && luminance > 4) visible += 1;
          }
        }
      }
      return { width, height, minimum, maximum, visible };
    });
    if (pixelCheck.visible < 500 || pixelCheck.maximum - pixelCheck.minimum < 35) {
      throw new Error(`${viewport.name}: skeleton canvas pixel check is blank.`);
    }

    const evidenceStatus = await page
      .locator("#simulation-evidence-status")
      .textContent();
    if (evidenceStatus !== "Verified source") {
      throw new Error(`${viewport.name}: evidence package was not validated.`);
    }

    const nasaStatus = await page.locator("#nasa-evidence-status").textContent();
    const nasaDistalChange = await page.locator("#nasa-distal-change").textContent();
    if (!nasaStatus?.includes("170 records") || nasaDistalChange !== "-54.5% vs ground") {
      throw new Error(`${viewport.name}: NASA OSDR evidence did not load.`);
    }

    let aiScore = "held-out only";
    if (qaXray) {
      await page.locator("#xray-file").setInputFiles({
        name: "qa-fractured-xray.jpg",
        mimeType: "image/jpeg",
        buffer: await readFile(qaXray),
      });
      await page.waitForFunction(
        () => document.querySelector("#ai-score")?.textContent !== "--",
        undefined,
        { timeout: 120_000 },
      );
      aiScore = await page.locator("#ai-score").textContent();
      const serviceStatus = await page.locator("#ai-service-status").textContent();
      if (!serviceStatus?.includes("Local AI ready") || aiScore !== "99.9/100") {
        throw new Error(`${viewport.name}: live X-ray inference did not reach the UI.`);
      }
      console.log(`[qa] ${viewport.name}: live X-ray inference passed`);
    }

    await clickCameraButton(page);
    try {
      await page.waitForFunction(
        () => document.querySelector("#camera-status")?.textContent
          === "Live, processed locally",
        undefined,
        { timeout: 120_000 },
      );
    } catch (error) {
      const status = await page.locator("#camera-status").textContent();
      const detail = await page.locator("#functional-warning").textContent();
      throw new Error(
        `${viewport.name}: camera did not become ready (status: ${status}; detail: ${detail}; errors: ${errors.join(" | ") || "none"}). ${error.message}`,
      );
    }
    const cameraStatus = await page.locator("#camera-status").textContent();
    try {
      await page.waitForFunction(
        () => {
          const status = document.querySelector("#object-inference");
          return /ms object pass/.test(status?.textContent ?? "")
            || status?.dataset.state === "error";
        },
        undefined,
        { timeout: 120_000 },
      );
      const objectState = await page.locator("#object-inference").getAttribute("data-state");
      if (objectState === "error") {
        const detail = await page.locator("#object-inference").getAttribute("data-detail");
        throw new Error(detail || "Object detector reported an unknown error.");
      }
    } catch (error) {
      const objectStatus = await page.locator("#object-inference").textContent();
      const objectDetail = await page.locator("#object-inference").getAttribute("data-detail");
      throw new Error(
        viewport.name
        + ": object inference did not produce a frame (status: "
        + objectStatus
        + (objectDetail ? "; detail: " + objectDetail : "")
        + "; errors: "
        + (errors.join(" | ") || "none")
        + "). "
        + error.message,
      );
    }
    if (await page.locator("#safety-monitor-status").textContent() !== "Monitoring") {
      throw new Error(viewport.name + ": safety monitor did not enter monitoring state.");
    }

    await page.locator("#camera-device").selectOption("qa-usb-camera");
    await page.waitForFunction(
      () => {
        const requests = globalThis.__astroboneQaCamera?.requests ?? [];
        return requests.at(-1)?.video?.deviceId?.exact === "qa-usb-camera"
          && document.querySelector("#camera-status")?.textContent === "Live, processed locally"
          && document.querySelector("#twin-feed-label")?.textContent === "QA USB Webcam";
      },
      undefined,
      { timeout: 120_000 },
    );
    if (await page.locator("#twin-feed-label").textContent() !== "QA USB Webcam") {
      throw new Error(viewport.name + ": selected PC webcam is not identified in the live feed.");
    }

    await page
      .locator('.camera-facing-button[data-facing="environment"]')
      .evaluate((button) => button.click());
    await page.waitForFunction(
      () => document.querySelector(
        '.camera-facing-button[data-facing="environment"]',
      )?.getAttribute("aria-pressed") === "true"
        && document.querySelector("#camera-status")?.textContent === "Live, processed locally",
      undefined,
      { timeout: 120_000 },
    );
    if (await page.locator("#pose-viewport").getAttribute("data-mirrored") !== "false") {
      throw new Error(viewport.name + ": environment camera preview remained mirrored.");
    }

    await page
      .locator('.camera-facing-button[data-facing="user"]')
      .evaluate((button) => button.click());
    await page.waitForFunction(
      () => document.querySelector(
        '.camera-facing-button[data-facing="user"]',
      )?.getAttribute("aria-pressed") === "true"
        && document.querySelector("#camera-status")?.textContent === "Live, processed locally",
      undefined,
      { timeout: 120_000 },
    );
    if (await page.locator("#pose-viewport").getAttribute("data-mirrored") !== "true") {
      throw new Error(viewport.name + ": crew camera preview did not restore mirroring.");
    }

    await page.locator("#test-voice").evaluate((button) => button.click());
    const safetyMonitor = await page.evaluate(() => ({
      status: document.querySelector("#safety-monitor-status")?.textContent,
      posture: document.querySelector("#posture-status")?.textContent,
      objects: document.querySelector("#object-count")?.textContent,
      objectInference: document.querySelector("#object-inference")?.textContent,
      approach: document.querySelector("#approach-status")?.textContent,
      voice: document.querySelector("#voice-status")?.textContent,
      cameraRequests: globalThis.__astroboneQaCamera?.requests?.length ?? 0,
    }));
    if (safetyMonitor.cameraRequests < 4) {
      throw new Error(viewport.name + ": webcam and front/rear switching did not request fresh streams.");
    }
    if (safetyMonitor.voice?.includes("unavailable")) {
      throw new Error(viewport.name + ": browser voice fallback is unavailable.");
    }
    await clickCameraButton(page);
    console.log("[qa] " + viewport.name + ": camera, object, safety, and voice runtime passed");

    const beforeMotion = await page.evaluate(
      () => document.querySelector("#twin-canvas").toDataURL("image/png"),
    );
    await page.locator('[data-motion="walk"]').click({ force: true });
    await page.waitForTimeout(700);
    const afterMotion = await page.evaluate(
      () => document.querySelector("#twin-canvas").toDataURL("image/png"),
    );
    const motionChanged =
      createHash("sha256").update(beforeMotion).digest("hex")
      !== createHash("sha256").update(afterMotion).digest("hex");
    if (!motionChanged) {
      throw new Error(`${viewport.name}: skeleton motion did not change the canvas.`);
    }

    await page.locator("#load-simulation-case").evaluate((button) => button.click());
    const activeStatus = await page
      .locator("#simulation-evidence-status")
      .textContent();
    const loadedDcr = await page.locator("#risk-score").textContent();
    if (activeStatus !== "Case active" || loadedDcr !== "0.70x") {
      throw new Error(`${viewport.name}: verified EVA case did not activate.`);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 1) {
      throw new Error(`${viewport.name}: page has ${overflow}px horizontal overflow.`);
    }

    const screenshotPath = resolve(
      artifactDir,
      `astrobone-${viewport.name}.png`,
    );
    const twinScreenshotPath = resolve(
      artifactDir,
      `astrobone-${viewport.name}-synchronized-twin.png`,
    );
    const originalViewport = page.viewportSize();
    const twinHeight = await page.locator(".simulation-shell").evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await page.setViewportSize({
      width: originalViewport.width,
      height: Math.ceil(twinHeight + 24),
    });
    await page.locator(".topbar").evaluate((element) => {
      element.dataset.qaVisibility = element.style.visibility;
      element.style.visibility = "hidden";
    });
    await page.locator(".simulation-shell").evaluate((element) => {
      element.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(120);
    const twinClip = await page.locator(".simulation-shell").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.max(0, rect.left),
        y: Math.max(0, rect.top),
        width: rect.width,
        height: rect.height,
      };
    });
    await page.screenshot({
      path: twinScreenshotPath,
      clip: twinClip,
      animations: "disabled",
      timeout: 120_000,
    });
    await page.locator(".topbar").evaluate((element) => {
      element.style.visibility = element.dataset.qaVisibility || "";
      delete element.dataset.qaVisibility;
    });
    await page.setViewportSize(originalViewport);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      animations: "disabled",
      timeout: 120_000,
    });
    results.push({
      viewport: viewport.name,
      screenshotPath,
      canvas: pixelCheck,
      evidenceStatus: activeStatus,
      nasaStatus,
      nasaDistalChange,
      aiScore,
      cameraStatus,
      safetyMonitor,
      loadedDcr,
      motionChanged,
      initialTheme,
      themeLuminance: { light: lightThemeLuminance, dark: darkThemeLuminance },
      telemetry,
      twinLayout,
      tracePixelCheck,
      twinScreenshotPath,
      astraGeometry,
      astraScreenshotPath,
      consoleErrors: errors,
    });
    console.log(`[qa] ${viewport.name}: canvas, motion, and overflow passed`);
    await page.close();
  }
} finally {
  await browser.close();
}

const consoleErrors = results.flatMap((result) => result.consoleErrors);
if (consoleErrors.length > 0) {
  throw new Error(`Browser console errors:\n${consoleErrors.join("\n")}`);
}

console.log(JSON.stringify(results, null, 2));

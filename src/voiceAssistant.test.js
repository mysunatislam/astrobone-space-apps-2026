import test from "node:test";
import assert from "node:assert/strict";
import { VoiceAssistant } from "./voiceAssistant.js";

test("uses native speech on Android and enforces alert cooldowns", async () => {
  const spoken = [];
  let currentTime = 1_000;
  const plugin = {
    isAvailable: async () => ({ available: true }),
    speak: async (options) => spoken.push(options),
    stop: async () => {},
  };
  const assistant = new VoiceAssistant({
    nativePlugin: plugin,
    isNative: true,
    clock: () => currentTime,
  });

  const status = await assistant.initialize();
  assert.equal(status.available, true);
  assert.equal(await assistant.speak("First", { key: "cue", cooldownMs: 5_000 }), true);
  assert.equal(await assistant.speak("Blocked", { key: "cue", cooldownMs: 5_000 }), false);
  currentTime = 6_100;
  assert.equal(await assistant.speak("Second", { key: "cue", cooldownMs: 5_000 }), true);
  assert.deepEqual(spoken.map((item) => item.text), ["First", "Second"]);
});

test("falls back to browser speech when not running natively", async () => {
  const utterances = [];
  class FakeUtterance {
    constructor(text) {
      this.text = text;
    }
  }
  const speech = {
    cancel() {},
    speak(utterance) {
      utterances.push(utterance);
    },
  };
  const assistant = new VoiceAssistant({
    isNative: false,
    speechSynthesis: speech,
    Utterance: FakeUtterance,
  });

  await assistant.initialize();
  assert.equal(await assistant.test(), true);
  assert.equal(utterances.length, 1);
  assert.match(utterances[0].text, /camera estimates remain advisory/i);
});

test("does not speak while voice alerts are disabled", async () => {
  let calls = 0;
  const assistant = new VoiceAssistant({
    enabled: false,
    isNative: false,
    speechSynthesis: {
      cancel() {},
      speak() {
        calls += 1;
      },
    },
    Utterance: class {},
  });

  assert.equal(await assistant.speak("Muted"), false);
  assert.equal(calls, 0);
});

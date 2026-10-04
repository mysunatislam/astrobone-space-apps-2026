import { Capacitor, registerPlugin } from "@capacitor/core";

const AstroBoneVoice = registerPlugin("AstroBoneVoice");

export class VoiceAssistant {
  constructor({
    enabled = true,
    nativePlugin = AstroBoneVoice,
    isNative = Capacitor.isNativePlatform(),
    speechSynthesis = globalThis.speechSynthesis,
    Utterance = globalThis.SpeechSynthesisUtterance,
    clock = () => Date.now(),
    onStatus = () => {},
  } = {}) {
    this.enabled = enabled;
    this.nativePlugin = nativePlugin;
    this.isNative = isNative;
    this.speechSynthesis = speechSynthesis;
    this.Utterance = Utterance;
    this.clock = clock;
    this.onStatus = onStatus;
    this.cooldowns = new Map();
    this.available = null;
    this.backend = isNative ? "Android TTS" : "Browser voice";
  }

  async initialize() {
    if (this.isNative) {
      try {
        const result = await this.nativePlugin.isAvailable();
        this.available = Boolean(result?.available);
      } catch {
        this.available = Boolean(this.speechSynthesis && this.Utterance);
        this.backend = "Browser voice fallback";
      }
    } else {
      this.available = Boolean(this.speechSynthesis && this.Utterance);
    }
    this.emitStatus();
    return this.getStatus();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.stop();
    this.emitStatus();
  }

  async speak(
    text,
    {
      key = "general",
      cooldownMs = 5_000,
      interrupt = false,
      rate = 0.94,
      pitch = 1,
    } = {},
  ) {
    const message = String(text ?? "").trim();
    if (!this.enabled || !message) return false;

    const currentTime = this.clock();
    const nextAllowed = this.cooldowns.get(key) ?? -Infinity;
    if (currentTime < nextAllowed) return false;
    this.cooldowns.set(key, currentTime + Math.max(0, cooldownMs));

    if (this.isNative) {
      try {
        await this.nativePlugin.speak({
          text: message,
          queueMode: interrupt ? "flush" : "add",
          rate,
          pitch,
        });
        this.available = true;
        this.backend = "Android TTS";
        this.emitStatus();
        return true;
      } catch {
        this.backend = "Browser voice fallback";
      }
    }

    if (!this.speechSynthesis || !this.Utterance) {
      this.available = false;
      this.emitStatus();
      return false;
    }

    if (interrupt) this.speechSynthesis.cancel();
    const utterance = new this.Utterance(message);
    utterance.lang = "en-US";
    utterance.rate = clamp(rate, 0.5, 1.5);
    utterance.pitch = clamp(pitch, 0.5, 1.5);
    utterance.volume = 1;
    this.speechSynthesis.speak(utterance);
    this.available = true;
    this.emitStatus();
    return true;
  }

  async test() {
    return this.speak(
      "AstroBone voice alerts are ready. Camera estimates remain advisory.",
      {
        key: "voice-test",
        cooldownMs: 0,
        interrupt: true,
      },
    );
  }

  stop() {
    this.speechSynthesis?.cancel?.();
    if (this.isNative) {
      void this.nativePlugin.stop().catch(() => {});
    }
  }

  dispose() {
    this.stop();
    this.cooldowns.clear();
  }

  getStatus() {
    return {
      enabled: this.enabled,
      available: this.available,
      backend: this.backend,
    };
  }

  emitStatus() {
    this.onStatus(this.getStatus());
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

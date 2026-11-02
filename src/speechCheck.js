// Speech check for the crewmate check: the person reads the same short passage each time and the app
// measures how they spoke, against their own earlier readings. Ported from NeuroBridge Asha's
// SenseAssist idea (mysunatislam/neurobridge-asha-unified-app, app/speech-capture.js: user-started,
// time-limited listening, browser transcription when available), with timing measured on the device:
//  - Voice activity: Silero VAD v5 (snakers4/silero-vad, MIT), a widely used pretrained detector,
//    run in the browser with ONNX Runtime on 32 ms frames at 16 kHz. If it cannot load, a simple
//    energy detector is used instead and the result says so.
//  - Pauses inside speech of 250 ms or longer (a common cut-off in pause research, e.g. Goldman-Eisler),
//    speaking rate and repeated words. Longer and more frequent pauses and slower reading are reported
//    with fatigue, low mood and some neurological problems, but they vary with many things (language,
//    the microphone, the room), so only a change from the person's own readings is shown, as an observation.
// Audio never leaves the device. The words, when the browser can transcribe, are used for counting only.

export const READING_PASSAGE = "When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. The rainbow is a division of white light into many beautiful colors. These take the shape of a long round arch, with its path high above, and its two ends apparently beyond the horizon.";
export const PASSAGE_SOURCE = "The Rainbow Passage (Fairbanks, Voice and Articulation Drillbook, 1960), a standard reading passage in speech research.";

export const SPEECH = Object.freeze({
  sampleRate: 16000, frame: 512, context: 64, // Silero VAD v5 at 16 kHz: 512-sample frames with 64 samples of context
  on: 0.5, off: 0.35, // hysteresis on the speech probability
  minSpeechMs: 120, minPauseMs: 250,
  maxSeconds: 25, minSpeechSeconds: 4,
});
const FRAME_MS = (SPEECH.frame / SPEECH.sampleRate) * 1000; // 32 ms

// Speech probabilities per frame -> speech segments [{ start, end }] in ms.
export function vadSegments(probs, { frameMs = FRAME_MS, on = SPEECH.on, off = SPEECH.off, minSpeechMs = SPEECH.minSpeechMs, minPauseMs = SPEECH.minPauseMs } = {}) {
  const raw = []; let start = null;
  probs.forEach((p, i) => {
    if (start === null && p >= on) start = i * frameMs;
    else if (start !== null && p < off) { raw.push({ start, end: i * frameMs }); start = null; }
  });
  if (start !== null) raw.push({ start, end: probs.length * frameMs });
  // Join gaps too short to be pauses, then drop blips.
  const joined = [];
  for (const s of raw) {
    const last = joined.at(-1);
    if (last && s.start - last.end < minPauseMs) last.end = s.end; else joined.push({ ...s });
  }
  return joined.filter(s => s.end - s.start >= minSpeechMs);
}

const WORD = /[a-z']+/g;
export const words = text => (String(text ?? "").toLowerCase().match(WORD) ?? []);
const FILLERS = new Set(["um", "uh", "er", "erm", "ah", "hmm", "mm"]);

// Repeats: a word said twice in a row ("the the"), a two-word phrase said twice in a row, and fillers.
export function repetitions(text) {
  const w = words(text), out = { words: w.length, repeatedWords: 0, repeatedPhrases: 0, fillers: 0, examples: [] };
  for (let i = 0; i < w.length; i++) {
    if (FILLERS.has(w[i])) out.fillers++;
    if (i > 0 && w[i] === w[i - 1] && !FILLERS.has(w[i])) { out.repeatedWords++; if (out.examples.length < 3) out.examples.push(`${w[i]} ${w[i]}`); }
    if (i >= 3 && w[i - 3] === w[i - 1] && w[i - 2] === w[i]) { out.repeatedPhrases++; if (out.examples.length < 3) out.examples.push(`${w[i - 1]} ${w[i]}, ${w[i - 1]} ${w[i]}`); }
  }
  return out;
}

// Share of the passage's words that were read, in order (longest common subsequence).
export function passageCoverage(text, passage = READING_PASSAGE) {
  const a = words(passage), b = words(text);
  if (!b.length) return null;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) { const up = prev[j]; prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]); diag = up; }
  }
  return prev[b.length] / a.length;
}

export function speechMetrics(segments, { transcript = null, detector = "silero-vad-v5" } = {}) {
  if (!segments.length) return { status: "insufficient", reason: "No speech heard. Read the passage aloud, close to the device." };
  const speakingMs = segments.reduce((s, x) => s + x.end - x.start, 0);
  if (speakingMs < SPEECH.minSpeechSeconds * 1000) return { status: "insufficient", reason: `Only ${(speakingMs / 1000).toFixed(1)} s of speech heard; read the whole passage.` };
  const pauses = segments.slice(1).map((s, i) => s.start - segments[i].end);
  const spanMs = segments.at(-1).end - segments[0].start;
  const round = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
  const out = {
    status: "measured", detector, seconds: round(spanMs / 1000, 1), speakingSeconds: round(speakingMs / 1000, 1),
    pauses: pauses.length, pausesPerMin: round(pauses.length / (spanMs / 60000), 1),
    meanPauseMs: pauses.length ? Math.round(pauses.reduce((s, v) => s + v, 0) / pauses.length) : 0,
    longestPauseMs: pauses.length ? Math.round(Math.max(...pauses)) : 0,
    pauseShare: round(1 - speakingMs / spanMs, 3),
  };
  if (transcript) {
    const rep = repetitions(transcript), cov = passageCoverage(transcript);
    Object.assign(out, { transcribed: true, words: rep.words, wordsPerMin: round(rep.words / (spanMs / 60000), 0), repeatedWords: rep.repeatedWords, repeatedPhrases: rep.repeatedPhrases, fillers: rep.fillers, repeatExamples: rep.examples, passageRead: round(cov, 2) });
  } else out.transcribed = false;
  return out;
}

// Against the person's own earlier readings (median of up to the last 10).
export const SPEECH_CHANGE = Object.freeze({
  pauseShare: { label: "Time spent pausing", up: 0.1, direction: "up", note: "more of the reading spent in pauses than usual" },
  longestPauseMs: { label: "Longest pause", up: 700, direction: "up", note: "a longer stop than usual" },
  pausesPerMin: { label: "Pauses per minute", up: 8, direction: "up", note: "stopping more often than usual" },
  seconds: { label: "Reading time", up: 4, direction: "up", note: "slower reading than usual" },
  repeatedWords: { label: "Repeated words", up: 2, direction: "up", note: "more words said twice than usual" },
});
export function compareSpeech(today, history = []) {
  if (today?.status !== "measured") return [];
  const out = [];
  for (const [key, rule] of Object.entries(SPEECH_CHANGE)) {
    if (!Number.isFinite(today[key])) continue;
    const past = history.slice(-10).map(h => h?.[key]).filter(Number.isFinite);
    if (past.length < 2) { out.push({ key, label: rule.label, value: today[key], status: "baseline", text: `${rule.label}: recorded as a baseline (${past.length + 1} of 3)` }); continue; }
    const usual = [...past].sort((a, b) => a - b)[Math.floor(past.length / 2)], delta = today[key] - usual;
    const changed = rule.direction === "up" ? delta >= rule.up : -delta >= rule.up;
    out.push({ key, label: rule.label, value: today[key], usual, status: changed ? "changed" : "stable", text: changed ? `${rule.label}: ${rule.note}` : `${rule.label}: close to usual` });
  }
  return out;
}

// Energy fallback: frame RMS against a noise floor from the quietest 10 % of frames.
export function energyProbabilities(samples, frame = SPEECH.frame) {
  const rms = [];
  for (let i = 0; i + frame <= samples.length; i += frame) { let s = 0; for (let k = i; k < i + frame; k++) s += samples[k] * samples[k]; rms.push(Math.sqrt(s / frame)); }
  if (!rms.length) return [];
  const sorted = [...rms].sort((a, b) => a - b), floor = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.1)]);
  return rms.map(r => Math.max(0, Math.min(1, Math.log10(r / floor) / 1.0))); // 10x the floor (+20 dB) = 1
}

// Silero VAD v5 in ONNX Runtime: `ort` is the onnxruntime-web module. Returns { probabilities(samples) }.
export async function loadSileroVad(ort, modelUrl) {
  const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"] });
  const sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(SPEECH.sampleRate)]), []);
  return {
    async probabilities(samples) {
      let state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
      const ctx = new Float32Array(SPEECH.context), probs = [];
      for (let i = 0; i + SPEECH.frame <= samples.length; i += SPEECH.frame) {
        const x = new Float32Array(SPEECH.context + SPEECH.frame);
        x.set(ctx, 0); x.set(samples.subarray(i, i + SPEECH.frame), SPEECH.context);
        const out = await session.run({ input: new ort.Tensor("float32", x, [1, x.length]), state, sr });
        probs.push(out.output.data[0]); state = out.stateN;
        ctx.set(samples.subarray(i + SPEECH.frame - SPEECH.context, i + SPEECH.frame));
      }
      return probs;
    },
  };
}

// Linear resampling to 16 kHz (the browser may not honour a 16 kHz AudioContext).
export function resampleTo16k(samples, fromRate) {
  if (fromRate === SPEECH.sampleRate) return samples;
  const ratio = fromRate / SPEECH.sampleRate, n = Math.floor(samples.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i * ratio, k = Math.floor(x), f = x - k; out[i] = samples[k] * (1 - f) + (samples[k + 1] ?? samples[k]) * f; }
  return out;
}

// Browser recorder: microphone for up to SPEECH.maxSeconds, with the browser's own transcription when it has one.
export function createSpeechRecorder({ onLevel = () => {}, onWords = () => {} } = {}) {
  let stream = null, ctx = null, node = null, source = null, chunks = [], recognition = null, transcript = "", stopTimer = null, resolveStop = null;
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open a microphone.");
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
    ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    source = ctx.createMediaStreamSource(stream);
    node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = e => { const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d)); let s = 0; for (const v of d) s += v * v; onLevel(Math.sqrt(s / d.length)); };
    source.connect(node); node.connect(ctx.destination);
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (SR) {
      try {
        recognition = new SR(); recognition.lang = "en-US"; recognition.continuous = true; recognition.interimResults = true;
        recognition.onresult = e => { transcript = Array.from(e.results).map(r => r[0].transcript).join(" "); onWords(transcript); };
        recognition.onerror = () => {}; recognition.start();
      } catch { recognition = null; }
    }
    return new Promise(resolve => { resolveStop = resolve; stopTimer = setTimeout(stop, SPEECH.maxSeconds * 1000); });
  }
  function stop() {
    clearTimeout(stopTimer);
    try { recognition?.stop(); } catch { /* already stopped */ }
    node?.disconnect(); source?.disconnect(); stream?.getTracks().forEach(t => t.stop());
    const rate = ctx?.sampleRate ?? SPEECH.sampleRate; void ctx?.close();
    const total = chunks.reduce((s, c) => s + c.length, 0), all = new Float32Array(total); let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    chunks = [];
    const result = { samples: resampleTo16k(all, rate), transcript: transcript.trim() || null, speechRecognition: Boolean(recognition) };
    resolveStop?.(result); resolveStop = null;
    return result;
  }
  return { start, stop };
}

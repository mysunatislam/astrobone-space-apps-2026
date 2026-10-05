// A hidden copy of the uploaded video plays ahead of the visible one. Every frame it decodes is
// handed over with its exact media time, so by the time the visible video presents a frame, that
// frame's pose is already known. Decoding sequentially is far faster than seeking frame by frame.
export const LEAD = Object.freeze({
  start: 0.45, // seconds analysed before the visible video starts
  hold: 0.12, // visible playback waits if analysis is closer than this
  resume: 0.5, // and resumes once this much is analysed again
  catchUp: 1.0, // below this the look-ahead plays faster
  max: 3.0, // above this the look-ahead rests
});

export const supportsFrameCallbacks = video => typeof video?.requestVideoFrameCallback === "function";

// How the look-ahead copy should play for a given lead over the visible video.
export function planLookahead({ lead, resting }) {
  if (lead >= LEAD.max || (resting && lead > LEAD.max - 1)) return { action: "rest" };
  return { action: "play", rate: lead < LEAD.catchUp ? 2 : 1.25 };
}

// Whether visible playback can show the frame at visibleTime with a known pose. analysisComplete:
// the look-ahead reached the end and everything up to its last frame is analysed (the last frame of
// a clip sits up to one frame interval before its duration).
export function planPlayback({ visibleTime, coveredUntil, end, held, analysisComplete = false }) {
  if (analysisComplete) return "play";
  const need = Math.min(visibleTime + (held ? LEAD.resume : LEAD.hold), end - 0.02);
  return coveredUntil >= need ? "play" : "hold";
}

export class VideoLookahead {
  constructor({ url, endSeconds, onFrame, host = document.body }) {
    this.endSeconds = endSeconds;
    this.onFrame = onFrame;
    this.position = -Infinity;
    this.seekTarget = null;
    this.resting = false;
    this.stopped = false;
    const video = this.video = document.createElement("video");
    Object.assign(video, { muted: true, playsInline: true, preload: "auto", src: url });
    video.setAttribute("aria-hidden", "true");
    // Kept on screen (1 px, invisible) so the browser keeps decoding and presenting its frames.
    video.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1";
    host.append(video);
    this.onVideoFrame = (now, metadata) => {
      if (this.stopped) return;
      this.position = metadata.mediaTime;
      if (this.seekTarget !== null && metadata.mediaTime >= this.seekTarget - 0.15) this.seekTarget = null;
      if (this.position >= this.endSeconds) this.video.pause();
      this.onFrame(this.video, metadata.mediaTime);
      this.video.requestVideoFrameCallback(this.onVideoFrame);
    };
    video.requestVideoFrameCallback(this.onVideoFrame);
  }

  get finished() { return this.seekTarget === null && (this.video.ended || this.position >= this.endSeconds - 0.05); }

  // Waits for the models: called when the look-ahead has got further ahead of the analysis than
  // the pose track tolerates as a gap. Analysis results resume it through steer().
  wait() { if (!this.stopped && !this.video.paused) this.video.pause(); }

  async ready() {
    if (this.video.readyState >= 1) return;
    await new Promise((resolve, reject) => {
      this.video.addEventListener("loadedmetadata", resolve, { once: true });
      this.video.addEventListener("error", () => reject(new Error("The browser cannot decode this video.")), { once: true });
    });
  }

  async seek(seconds) {
    if (this.stopped) return;
    // Start a few frames early so the first visible frame has samples on both sides.
    const target = Math.max(0, seconds - 0.1);
    this.seekTarget = target;
    this.position = -Infinity;
    await this.ready();
    if (this.stopped || this.seekTarget !== target) return;
    this.video.currentTime = target;
    this.play(2);
  }

  play(rate) {
    if (this.stopped || this.finished) return;
    this.resting = false;
    rate = Math.min(4, Math.max(0.25, rate));
    if (Math.abs(this.video.playbackRate - rate) > 0.01) this.video.playbackRate = rate;
    if (this.video.paused) this.video.play().catch(() => {});
  }

  // lead: seconds analysed ahead of the visible video; maxRate: what inference can sustain;
  // visibleRate: the visible video's playback speed (slow motion, 2x review).
  steer(lead, maxRate = 2, visibleRate = 1) {
    if (this.stopped) return;
    const plan = planLookahead({ lead, resting: this.resting });
    if (plan.action === "rest") { this.resting = true; if (!this.video.paused) this.video.pause(); }
    else this.play(Math.min(plan.rate * visibleRate, maxRate));
  }

  stop() {
    this.stopped = true;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
  }
}

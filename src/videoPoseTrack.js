// Poses of an uploaded video, keyed by media time. A look-ahead pass (videoLookahead.js) fills the
// track ahead of the playhead; playback reads it at the exact media time of each presented frame,
// so the overlay and the twin show the pose of the frame on screen. Reads fit a line through the
// neighbouring samples with centered Gaussian weights: jitter is smoothed without the lag of a
// causal filter.
export const SYNC_SIGMA_SECONDS = 0.035;
const MAX_GAP_SECONDS = 0.25;

export function isPausedVideoPose(frame, video) {
  return Boolean(frame?.detected !== false && Number.isFinite(frame?.mediaTime)
    && video?.paused && !video.seeking && video.readyState >= 2
    && Number.isFinite(video.currentTime) && Math.abs(frame.mediaTime - video.currentTime) <= .2);
}

// Weighted mean of several landmark lists of equal length (x, y, z, visibility, presence).
export function blendPoints(lists, weights) {
  const total = weights.reduce((sum, w) => sum + w, 0), length = lists[0]?.length ?? 0;
  if (!length || !(total > 0)) return null;
  const out = new Array(length);
  for (let index = 0; index < length; index++) {
    const point = { x: 0, y: 0, z: 0 };
    let visibility = 0, presence = 0, hasVisibility = false, hasPresence = false;
    lists.forEach((list, k) => {
      const p = list[index], w = weights[k] / total;
      point.x += p.x * w; point.y += p.y * w; point.z += p.z * w;
      if (Number.isFinite(p.visibility)) { visibility += p.visibility * w; hasVisibility = true; }
      if (Number.isFinite(p.presence)) { presence += p.presence * w; hasPresence = true; }
    });
    // Local-linear weights can be slightly negative; confidences stay within [0, 1].
    if (hasVisibility) point.visibility = Math.min(1, Math.max(0, visibility));
    if (hasPresence) point.presence = Math.min(1, Math.max(0, presence));
    out[index] = point;
  }
  return out;
}

// Local-linear (weighted least-squares line) weights for estimating the value at t from samples
// around it: exact for steady motion wherever t falls between samples, unlike a plain weighted mean.
export function localLinearWeights(near, t) {
  let s0 = 0, s1 = 0, s2 = 0;
  for (const { sample, weight } of near) { const d = sample.mediaTime - t; s0 += weight; s1 += weight * d; s2 += weight * d * d; }
  const det = s0 * s2 - s1 * s1;
  if (near.length < 3 || !(det > 1e-12 * s0 * s0)) return near.map(({ weight }) => weight / s0);
  return near.map(({ sample, weight }) => weight * (s2 - s1 * (sample.mediaTime - t)) / det);
}

export class PoseTrack {
  constructor() { this.samples = []; }
  get size() { return this.samples.length; }
  clear() { this.samples = []; }

  // Index of the first sample later than t.
  indexAfter(t) {
    let lo = 0, hi = this.samples.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.samples[mid].mediaTime <= t) lo = mid + 1; else hi = mid; }
    return lo;
  }

  add(sample) {
    if (!Number.isFinite(sample?.mediaTime)) return;
    const index = this.indexAfter(sample.mediaTime);
    if (index > 0 && Math.abs(this.samples[index - 1].mediaTime - sample.mediaTime) < 1e-4) this.samples[index - 1] = sample;
    else this.samples.splice(index, 0, sample);
  }

  // Media time reached by unbroken samples (gaps up to maxGap) from t onwards; -Infinity if t is not covered.
  coveredUntil(t, maxGap = MAX_GAP_SECONDS) {
    let index = this.indexAfter(t) - 1;
    if (index < 0) return this.samples.length && this.samples[0].mediaTime - t <= maxGap / 2 ? this.coveredUntil(this.samples[0].mediaTime, maxGap) : -Infinity;
    if (t - this.samples[index].mediaTime > maxGap) return -Infinity;
    while (index + 1 < this.samples.length && this.samples[index + 1].mediaTime - this.samples[index].mediaTime <= maxGap) index++;
    return this.samples[index].mediaTime;
  }

  // Samples per second of media within ±window of t.
  rateAround(t, window = 1) {
    const from = this.indexAfter(t - window), to = this.indexAfter(t + window);
    if (to - from < 2) return 0;
    const span = this.samples[to - 1].mediaTime - this.samples[from].mediaTime;
    return span > 0 ? (to - from - 1) / span : 0;
  }

  nearest(t, maxDistance = 0.2) {
    const index = this.indexAfter(t);
    const candidates = [this.samples[index - 1], this.samples[index]].filter(Boolean);
    const best = candidates.sort((a, b) => Math.abs(a.mediaTime - t) - Math.abs(b.mediaTime - t))[0];
    return best && Math.abs(best.mediaTime - t) <= maxDistance ? best : null;
  }

  // Samples within ±3 sigma of t with their Gaussian weights.
  around(t, sigma = SYNC_SIGMA_SECONDS) {
    const radius = 3 * sigma, result = [];
    for (let index = this.indexAfter(t - radius); index < this.samples.length && this.samples[index].mediaTime <= t + radius; index++) {
      const sample = this.samples[index], d = (sample.mediaTime - t) / sigma;
      result.push({ sample, weight: Math.exp(-0.5 * d * d) });
    }
    return result;
  }

  // Pose at media time t: { landmarks: [points], worldLandmarks: [points] }, empty lists when the
  // body is mostly undetected near t, or null when nothing was analysed near t.
  poseAt(t, sigma = SYNC_SIGMA_SECONDS) {
    let near = this.around(t, sigma);
    if (near.length < 2) {
      // Sparse analysis (slow device): interpolate between the samples either side of t.
      const index = this.indexAfter(t), a = this.samples[index - 1], b = this.samples[index];
      if (a && b && b.mediaTime - a.mediaTime <= MAX_GAP_SECONDS) {
        const f = (t - a.mediaTime) / (b.mediaTime - a.mediaTime);
        near = [{ sample: a, weight: 1 - f }, { sample: b, weight: f }];
      }
    }
    if (!near.length) {
      const sample = this.nearest(t);
      return sample ? { landmarks: sample.landmarks ?? [], worldLandmarks: sample.worldLandmarks ?? [] } : null;
    }
    const seen = near.filter(({ sample }) => sample.landmarks?.[0]?.length && sample.worldLandmarks?.[0]?.length);
    const seenWeight = seen.reduce((sum, s) => sum + s.weight, 0), allWeight = near.reduce((sum, s) => sum + s.weight, 0);
    if (seenWeight < allWeight / 2) return { landmarks: [], worldLandmarks: [] };
    const weights = localLinearWeights(seen, t);
    return {
      landmarks: [blendPoints(seen.map(s => s.sample.landmarks[0]), weights)],
      worldLandmarks: [blendPoints(seen.map(s => s.sample.worldLandmarks[0]), weights)],
    };
  }

  // Face and hands at media time t. The face mesh is blended (it locates the skin regions for the
  // camera pulse); hands come from the nearest analysed frame.
  detailsAt(t, sigma = 0.06, maxFaceGap = 1) {
    const hasFace = sample => sample.face?.landmarks?.length;
    const near = this.around(t, sigma).filter(({ sample }) => hasFace(sample));
    let face = null;
    if (near.length) face = { ...near[0].sample.face, landmarks: blendPoints(near.map(s => s.sample.face.landmarks), near.map(s => s.weight)) };
    else {
      // The face mesh is analysed less often than the body: interpolate between the face samples
      // either side (a still face barely moves), or hold the nearest one briefly.
      const index = this.indexAfter(t);
      let before = null, after = null;
      for (let i = index - 1; i >= 0 && t - this.samples[i].mediaTime <= maxFaceGap; i--) if (hasFace(this.samples[i])) { before = this.samples[i]; break; }
      for (let i = index; i < this.samples.length && this.samples[i].mediaTime - t <= maxFaceGap; i++) if (hasFace(this.samples[i])) { after = this.samples[i]; break; }
      if (before && after && after.mediaTime - before.mediaTime <= maxFaceGap) {
        const f = (t - before.mediaTime) / (after.mediaTime - before.mediaTime || 1);
        face = { ...before.face, landmarks: blendPoints([before.face.landmarks, after.face.landmarks], [1 - f, f]) };
      } else face = (before ?? after)?.face ?? null;
    }
    // Hands from the nearest frame where the hand model ran.
    let closest = null;
    for (const { sample } of this.around(t, 0.15)) if (sample.hands && (!closest || Math.abs(sample.mediaTime - t) < Math.abs(closest.mediaTime - t))) closest = sample;
    if (!face && !closest) return null;
    return { face, hands: closest?.hands ?? [] };
  }
}

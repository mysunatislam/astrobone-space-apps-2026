export const VIDEO_POSE_HZ = 12;

export function isPausedVideoPose(frame, video) {
  return Boolean(frame?.detected !== false && Number.isFinite(frame?.mediaTime)
    && video?.paused && !video.seeking && video.readyState >= 2
    && Number.isFinite(video.currentTime) && Math.abs(frame.mediaTime - video.currentTime) <= .2);
}

export function videoPoseAt(track, seconds) {
  if (!track?.length || !Number.isFinite(seconds)) return null;
  let lo = 0, hi = track.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (track[mid].mediaTime <= seconds) lo = mid; else hi = mid - 1; }
  return Math.abs(track[lo].mediaTime - seconds) <= .2 ? track[lo] : null;
}

export async function seekVideoFrame(video, seconds, signal) {
  if (signal.aborted) throw new Error("Video preparation cancelled");
  await new Promise((resolve, reject) => {
    let timer, poll;
    const clean = () => { clearTimeout(timer); clearInterval(poll); signal.removeEventListener("abort", cancel); };
    const cancel = () => { clean(); reject(new Error("Video preparation cancelled")); };
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => { clean(); reject(new Error("Timed out decoding video frame")); }, 10000);
    video.currentTime = seconds;
    poll = setInterval(() => { if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - seconds) < .02) { clean(); resolve(); } }, 10);
  });
}

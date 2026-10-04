export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MIN_VIDEO_SECONDS = 7;
export const MAX_VIDEO_SECONDS = 120;

export function validateExerciseVideo(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
    throw new Error("Choose an exercise video smaller than 100 MB.");
  }
  const type = (file.type || "").toLowerCase();
  const untypedVideo = (!type || type === "application/octet-stream") && /\.(mp4|webm)$/i.test(file.name || "");
  // Metadata decoding remains the final check; some OS pickers omit MIME types.
  if (!["video/mp4", "video/webm"].includes(type) && !untypedVideo) {
    throw new Error("Choose an MP4 or WebM video supported by this browser.");
  }
}

export function validateVideoMetadata(video) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error("The video has no readable duration. Choose a complete MP4 or WebM file.");
  }
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("The video has no readable picture track.");
  }
  return {
    startSeconds: 0,
    endSeconds: Math.min(video.duration, MAX_VIDEO_SECONDS),
    sourceDurationSeconds: video.duration,
    autoTrimmed: video.duration > MAX_VIDEO_SECONDS,
    assessmentEligible: video.duration >= MIN_VIDEO_SECONDS,
    assessmentDurationMs: Math.min(8000, Math.max(0, Math.round(video.duration * 1000) - 500)),
  };
}

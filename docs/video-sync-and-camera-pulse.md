# Uploaded Video: Synchronized Motion and Camera Pulse

## Synchronized motion

A hidden copy of the uploaded video plays slightly ahead of the visible one (`src/videoLookahead.js`). Every frame it decodes goes to the pose model (and the face and hand models) with its exact media time, so the pose of each frame is known before that frame is shown. When the visible video presents a frame, its pose is read from the track at that frame's own time (`src/videoPoseTrack.js`). The read fits a line through the neighbouring analysed frames with centred Gaussian weights (sigma 35 ms). That smooths jitter without the delay of a causal filter, and it is exact for steady motion between analysed frames.

- Playback waits briefly if analysis is ever less than 0.12 s ahead, and resumes once 0.5 s is ready. Seeking moves the look-ahead to the new position, and a replay uses the poses already analysed.
- Every frame is analysed while the GPU has headroom. Where one inference takes longer than 25 ms, about 15 frames per second of video are analysed to keep the GPU free for playback.
- The pose model is loaded and warmed in the background when Live Capture opens. The first inference compiles GPU programs, which can take seconds on a first visit.
- The 3D twin is drawn once per new video frame, as soon as its pose arrives, and follows it without extra smoothing.

Measured with `scripts/qa-video-sync.mjs` (headless Chromium, production build, on the development laptop, model warmed):

| Clip | Upload to first pose | Pose vs video on screen (median / p95) | Twin knee vs driven knee (median / p95 abs) | Waits |
| --- | --- | --- | --- | --- |
| Squat, 7 s, 24 fps | 0.8-1.9 s | 7 / 26 ms | 0.00 / 0.05 deg | 0 |
| Squat (Pexels 4921644), 25 fps | 1.0-1.4 s | -7 / 18 ms | 0.00 / 0.05 deg | 0-3 |
| Front view, 24 fps | 1.4-1.7 s | 0 / 17 ms | not applicable (legs not tracked) | 0 |

Offsets within half a frame (21 ms at 24 fps) are the measurement's own resolution. Before this change, uploaded video either took 20-33 s to prepare and showed 12 poses per second, or showed live poses 62-83 ms behind the video with stalls.

## Camera pulse and stress (experimental)

Skin colour is averaged over the inner forehead and both cheeks, located by the face mesh (`src/rppg.js`). The pulse uses the POS method (Wang et al., 2017) on up to 30 s of samples: the first estimate comes after 12 s, and it is withheld unless one spectral peak holds at least 60 % of the 0.75-3 Hz power. Uploaded video is timed by each frame's media time, and the live camera by each frame's capture time.

Stress is Baevsky's stress index from beat-to-beat intervals. The pulse wave is band-passed around the pulse rate (zero phase), then each beat is timed with sub-sample peak interpolation. It needs at least 30 s, at least 24 frames per second, few gaps, 20 clean beats and agreement with the pulse rate; otherwise the reason is shown instead of a number. It is never saved as a health record, and a pulse from an uploaded video is never saved as a current reading.

Validation used a face video with a known injected pulse (`scripts/make-pulse-test-video.py`): a still face, a 72.2 bpm pulse whose beat intervals vary with breathing (true RMSSD 51.6 ms), sensor noise and H.264 compression.

- **Pulse:** the browser read 72 bpm from the uploaded video (continuous from 16 s).
- **Stress:** the estimator gives RMSSD 58-60 ms on the full-frame-rate signal (+16 %) and 60-68 ms with 15 % of frames missing. In the browser on the development laptop, the page received about 20 frames per second, so stress was correctly withheld.

Limits: the test pulse is synthetic and the face still. Real skin, motion, lighting and compression reduce quality. No comparison against a contact sensor or ECG has been made yet; that is the next validation step. The live-camera path could not be validated on the development laptop, because its emulated camera delivered 13-21 irregular frames per second.

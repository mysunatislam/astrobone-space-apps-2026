# AstroBone Android Application

## Scope

AstroBone is packaged as a Capacitor 8 Android application with the package ID
`com.mysunatislam.astrobone`. The Android shell reuses the tested Vite,
Three.js, and MediaPipe application while adding native camera permission,
Android TextToSpeech alerts, safe-area handling, cached evidence files, and
the Android share sheet.

This remains a research prototype. Packaging it as an APK does not make it a
medical device, validate its fracture models, or authorize clinical or flight
use.

## Supported Android Environment

- Android API 24 or newer.
- An updated Android System WebView.
- Camera optional for the rest of the workflow; required for live movement
  assessment.
- Internet optional for the offline workflow; required only for a configured
  live X-ray service and external source links.

The project targets SDK 36 through the Capacitor 8 Android template.

## Build A Debug APK

Install Node.js 22 or newer, Java 21 or newer, Android Studio 2025.2.1 or newer,
and Android SDK 36. Then run:

```powershell
npm install
npm run android:apk
```

The command:

1. copies the committed MediaPipe WASM assets;
2. builds the Vite bundle with relative Android asset paths;
3. synchronizes web assets and native plugins;
4. runs Gradle's `assembleDebug`; and
5. copies the installable APK to
   `.artifacts/android/AstroBone-Twin-debug.apk`.

Open the generated native project with:

```powershell
npm run android:open
```

Use `npm run android:run` to select and run on a connected device or emulator.

## AI Service Connection

The packaged app must not call the development computer's
`127.0.0.1:8000`; on a phone that address means the phone itself. AstroBone
therefore starts with live X-ray inference disconnected while retaining:

- the complete 3D skeleton and mechanics workflow;
- browser-local MediaPipe movement assessment;
- NASA OSDR evidence;
- the verified held-out FracAtlas case; and
- all deterministic decision and export functions.

For live DenseNet121 and U-Net++ inference, deploy the FastAPI service behind
HTTPS and enter its base URL in **AI service connection**. The app rejects
cleartext HTTP, credentials embedded in URLs, query strings, and fragments.
The backend allowlist includes Android's `https://localhost` WebView origin.

For a reproducible build-time default, copy `.env.android.example` to
`.env.android` and set:

```dotenv
VITE_ASTROBONE_API_BASE=https://your-astrobone-api.example.com
```

Do not enable Capacitor mixed-content or cleartext modes for a release build.

## Privacy And Data Flow

- MediaPipe camera frames are processed inside the Android WebView. Pose and
  EfficientDet-Lite0 inference run in separate Web Workers so model execution
  does not block the camera controls, visual warnings, or native voice path.
- Both inference pipelines stay on-device. Frames are transferred directly to
  the workers and closed after each pass; the app stores neither camera frames
  nor raw pose landmarks.
- The Crew and Environment controls switch between the phone's preferred front
  and rear cameras. One active camera cannot provide all-around awareness.
- Android TextToSpeech speaks cooldown-protected movement and approach cues.
  Labels, direction, and posture duration remain prototype estimates.
- AstroBone does not upload, retain, or export raw webcam frames or landmarks.
- Uploaded X-rays are sent only after the user chooses a file and taps the
  analysis action.
- The FastAPI service decodes X-rays in memory and does not retain them.
- Exported JSON is written to the app cache and passed to Android's share sheet
  only after the user selects an export action.
- Android application backup is disabled.

The recipient selected in Android's share sheet is outside AstroBone's privacy
boundary. Users must treat medical handoff exports as sensitive data.

## Device Verification

Before competition release, test on at least one physical phone and one API 24+
emulator:

1. cold launch and offline launch;
2. skeleton loading, animation, touch orbit, and no blank WebGL frame;
3. camera permission grant, denial, retry, and full-body retargeting;
4. screen rotation and safe-area behavior;
5. native JSON sharing;
6. HTTPS AI health check, X-ray selection, inference, and failure recovery;
7. background/resume behavior; and
8. TalkBack labels and minimum touch target review.

Record the device, Android version, System WebView version, FPS, inference
latency, failures, and release commit.

## Release Build

The generated debug APK is for testing. For distribution:

1. open `android/` in Android Studio;
2. use **Build > Generate Signed App Bundle or APK**;
3. create or select a private signing keystore;
4. generate an Android App Bundle for Google Play; and
5. retain the keystore securely outside the repository.

Before any store submission, add a public privacy policy, complete Google Play
data-safety declarations, provide the research-only/non-diagnostic disclosure,
run the device verification matrix, and freeze a reviewed version.

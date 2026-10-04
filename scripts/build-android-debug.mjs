import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const androidDirectory = join(repositoryRoot, "android");
const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const buildCommand = process.platform === "win32"
  ? (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe")
  : gradleCommand;
const buildArguments = process.platform === "win32"
  ? ["/d", "/c", gradleCommand, "assembleDebug"]
  : ["assembleDebug"];
const defaultSdk = process.platform === "win32"
  ? join(homedir(), "AppData", "Local", "Android", "Sdk")
  : join(homedir(), "Android", "Sdk");
const sdkRoot = process.env.ANDROID_SDK_ROOT
  || process.env.ANDROID_HOME
  || (existsSync(defaultSdk) ? defaultSdk : "");

function findWindowsJava21Home() {
  if (process.platform !== "win32") {
    return "";
  }

  const roots = [
    join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft"),
    join(process.env.ProgramFiles || "C:\\Program Files", "Eclipse Adoptium"),
  ];

  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }

    const candidate = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /(?:jdk|temurin)[-_]?21/i.test(entry.name))
      .map((entry) => join(root, entry.name))
      .filter((home) => existsSync(join(home, "bin", "java.exe")))
      .sort()
      .at(-1);

    if (candidate) {
      return candidate;
    }
  }

  return "";
}

const javaHome = findWindowsJava21Home() || process.env.JAVA_HOME || "";
const environment = {
  ...process.env,
  ...(sdkRoot
    ? {
      ANDROID_HOME: sdkRoot,
      ANDROID_SDK_ROOT: sdkRoot,
    }
    : {}),
  ...(javaHome ? { JAVA_HOME: javaHome } : {}),
};

if (!existsSync(androidDirectory)) {
  throw new Error("Android project not found. Run npm run android:sync first.");
}

const build = spawnSync(buildCommand, buildArguments, {
  cwd: androidDirectory,
  env: environment,
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const sourceApk = join(
  androidDirectory,
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);
const artifactDirectory = join(repositoryRoot, ".artifacts", "android");
const artifactApk = join(artifactDirectory, "AstroBone-Twin-debug.apk");

if (!existsSync(sourceApk)) {
  throw new Error(`Gradle completed but no debug APK was found at ${sourceApk}.`);
}

mkdirSync(artifactDirectory, { recursive: true });
copyFileSync(sourceApk, artifactApk);
console.log(`AstroBone Android APK: ${artifactApk}`);

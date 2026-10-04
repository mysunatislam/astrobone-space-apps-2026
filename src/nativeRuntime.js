import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export const nativeRuntime = Object.freeze({
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),
});

export function buildTimestampedJsonFilename(
  filenameBase,
  generatedAt = new Date(),
) {
  const timestamp = generatedAt.toISOString().replace(/[:.]/g, "-");
  return `${filenameBase}-${timestamp}.json`;
}

export async function shareJsonEvidence(filename, payload) {
  if (!nativeRuntime.isNative) return false;
  const result = await Filesystem.writeFile({
    path: `exports/${filename}`,
    data: JSON.stringify(payload, null, 2),
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  await Share.share({
    title: "AstroBone evidence",
    text: "AstroBone research evidence package. Not a diagnosis.",
    files: [result.uri],
    dialogTitle: "Share AstroBone evidence",
  });
  return true;
}

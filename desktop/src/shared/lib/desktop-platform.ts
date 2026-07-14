export type DesktopPlatform = "windows" | "macos" | "other";

export function detectDesktopPlatform(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): DesktopPlatform {
  if (/Windows/i.test(userAgent)) {
    return "windows";
  }

  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return "macos";
  }

  return "other";
}

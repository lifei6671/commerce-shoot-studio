import { detectDesktopPlatform } from "./desktop-platform";

describe("detectDesktopPlatform", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "macos"],
    ["Mozilla/5.0 (X11; Linux x86_64)", "other"],
  ] as const)("maps %s to %s", (userAgent, expectedPlatform) => {
    expect(detectDesktopPlatform(userAgent)).toBe(expectedPlatform);
  });
});

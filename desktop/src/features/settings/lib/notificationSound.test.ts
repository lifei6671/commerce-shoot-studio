import { afterEach, describe, expect, it, vi } from "vitest";
import { playNotificationSound } from "./notificationSound";

const originalAudio = window.Audio;
const originalAudioContext = window.AudioContext;

describe("playNotificationSound", () => {
  afterEach(() => {
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: originalAudio,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: originalAudioContext,
    });
    vi.restoreAllMocks();
  });

  it("plays a generated wav with HTMLAudio when AudioContext is unavailable", async () => {
    const play = vi.fn(() => Promise.resolve());
    const audioSources: string[] = [];

    class MockAudio {
      volume = 1;

      constructor(source: string) {
        audioSources.push(source);
      }

      play = play;
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: MockAudio,
    });

    await expect(playNotificationSound("viral")).resolves.toBe(true);

    expect(play).toHaveBeenCalledTimes(1);
    expect(audioSources).toHaveLength(1);
    expect(audioSources[0]).toMatch(/^data:audio\/wav;base64,/);
  });
});

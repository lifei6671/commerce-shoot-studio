export type NotificationSoundId = "clear" | "soft" | "success";

type SoundNote = {
  duration: number;
  frequency: number;
  start: number;
  type: OscillatorType;
};

const soundProfiles: Record<NotificationSoundId, { duration: number; notes: SoundNote[] }> = {
  clear: {
    duration: 0.28,
    notes: [
      { duration: 0.18, frequency: 880, start: 0, type: "sine" },
      { duration: 0.16, frequency: 1320, start: 0.1, type: "triangle" },
    ],
  },
  soft: {
    duration: 0.36,
    notes: [
      { duration: 0.3, frequency: 523.25, start: 0, type: "sine" },
      { duration: 0.24, frequency: 659.25, start: 0.1, type: "sine" },
    ],
  },
  success: {
    duration: 0.42,
    notes: [
      { duration: 0.16, frequency: 659.25, start: 0, type: "triangle" },
      { duration: 0.18, frequency: 783.99, start: 0.11, type: "triangle" },
      { duration: 0.2, frequency: 1046.5, start: 0.23, type: "sine" },
    ],
  },
};

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export async function playNotificationSound(soundId: NotificationSoundId) {
  const AudioContextConstructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;

  if (!AudioContextConstructor) {
    return false;
  }

  const profile = soundProfiles[soundId];
  const audioContext = new AudioContextConstructor();

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  const now = audioContext.currentTime;
  const masterGain = audioContext.createGain();
  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.gain.linearRampToValueAtTime(0.24, now + 0.018);
  masterGain.gain.exponentialRampToValueAtTime(0.001, now + profile.duration + 0.04);
  masterGain.connect(audioContext.destination);

  profile.notes.forEach((note) => {
    const oscillator = audioContext.createOscillator();
    oscillator.type = note.type;
    oscillator.frequency.setValueAtTime(note.frequency, now + note.start);
    oscillator.connect(masterGain);
    oscillator.start(now + note.start);
    oscillator.stop(now + note.start + note.duration);
  });

  window.setTimeout(() => {
    void audioContext.close();
  }, Math.ceil((profile.duration + 0.08) * 1000));

  return true;
}

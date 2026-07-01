export type NotificationSoundId = "clear" | "soft" | "success" | "viral";

type SoundNote = {
  duration: number;
  frequency: number;
  start: number;
  type: OscillatorType;
};

type SoundProfile = { duration: number; notes: SoundNote[] };

const sampleRate = 44100;

const soundProfiles: Record<NotificationSoundId, SoundProfile> = {
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
  viral: {
    duration: 0.5,
    notes: [
      { duration: 0.12, frequency: 987.77, start: 0, type: "triangle" },
      { duration: 0.12, frequency: 1318.51, start: 0.1, type: "triangle" },
      { duration: 0.18, frequency: 1760, start: 0.2, type: "sine" },
      { duration: 0.16, frequency: 1174.66, start: 0.34, type: "square" },
    ],
  },
};

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export async function playNotificationSound(soundId: NotificationSoundId) {
  const profile = soundProfiles[soundId];

  try {
    const audio = new Audio(createWavDataUrl(profile));
    audio.volume = 0.82;
    await audio.play();
    return true;
  } catch {
    return playWithAudioContext(profile);
  }
}

async function playWithAudioContext(profile: SoundProfile) {
  const AudioContextConstructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;

  if (!AudioContextConstructor) {
    return false;
  }

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

function createWavDataUrl(profile: SoundProfile) {
  const samples = synthesizePcmSamples(profile);
  const wavBytes = encodeWav(samples);
  return `data:audio/wav;base64,${bytesToBase64(wavBytes)}`;
}

function synthesizePcmSamples(profile: SoundProfile) {
  const totalSamples = Math.ceil((profile.duration + 0.08) * sampleRate);
  const samples = new Float32Array(totalSamples);

  profile.notes.forEach((note) => {
    const startSample = Math.floor(note.start * sampleRate);
    const noteSampleCount = Math.max(1, Math.floor(note.duration * sampleRate));
    const endSample = Math.min(totalSamples, startSample + noteSampleCount);

    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += 1) {
      const noteTime = (sampleIndex - startSample) / sampleRate;
      const progress = noteTime / note.duration;
      // 每个音符做短淡入淡出，避免 WAV 播放时出现明显爆音。
      const envelope = Math.min(1, progress / 0.08, (1 - progress) / 0.18);
      samples[sampleIndex] += oscillatorValue(note.type, note.frequency, noteTime) * Math.max(0, envelope) * 0.24;
    }
  });

  return samples;
}

function oscillatorValue(type: OscillatorType, frequency: number, time: number) {
  const phase = (time * frequency) % 1;
  if (type === "square") {
    return phase < 0.5 ? 1 : -1;
  }
  if (type === "triangle") {
    return 4 * Math.abs(phase - 0.5) - 1;
  }
  if (type === "sawtooth") {
    return 2 * phase - 1;
  }
  return Math.sin(2 * Math.PI * frequency * time);
}

function encodeWav(samples: Float32Array) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * bytesPerSample, clamped * 0x7fff, true);
  });

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

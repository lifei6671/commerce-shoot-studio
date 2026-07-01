import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, SaveSettingsInput, SettingsPort } from "../index";

export const localSettingsPort: SettingsPort = {
  getSettings() {
    return invoke<AppSettings>("settings_get");
  },
  playNotificationSound(soundId) {
    return invoke<void>("settings_play_notification_sound", { soundId });
  },
  saveSettings(input: SaveSettingsInput) {
    return invoke<AppSettings>("settings_save", { input });
  },
};

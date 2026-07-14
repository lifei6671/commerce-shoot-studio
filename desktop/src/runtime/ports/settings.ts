import type { AppSettings, SaveSettingsInput } from "../types";

export interface SettingsPort {
  getSettings(): Promise<AppSettings>;
  playNotificationSound(soundId: AppSettings["notificationSound"]): Promise<void>;
  saveSettings(input: SaveSettingsInput): Promise<AppSettings>;
}

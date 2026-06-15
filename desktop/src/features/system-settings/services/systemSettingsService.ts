import { invoke } from "@tauri-apps/api/core";

import type {
  CacheStats,
  ClearCacheResult,
  SystemSettings,
  SystemSettingsView,
  TestProxyResult,
} from "../model/systemSettingsTypes";

export async function getSystemSettings(): Promise<SystemSettingsView> {
  return invoke<SystemSettingsView>("get_system_settings");
}

export async function saveSystemSettings(
  settings: SystemSettings,
): Promise<SystemSettingsView> {
  return invoke<SystemSettingsView>("save_system_settings_command", { settings });
}

export async function getCacheStats(): Promise<CacheStats> {
  return invoke<CacheStats>("get_cache_stats");
}

export async function clearWorkspaceCache(): Promise<ClearCacheResult> {
  return invoke<ClearCacheResult>("clear_workspace_cache");
}

export async function testProxyConnection(
  settings: SystemSettings,
  testDomain: string,
): Promise<TestProxyResult> {
  return invoke<TestProxyResult>("test_proxy_connection", { settings, testDomain });
}

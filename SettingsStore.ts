import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLanguage } from './Translations';

export type AudioQuality = 'best' | 'balanced' | 'low';

export interface AppSettings {
  autoplay: boolean;
  audioQuality: AudioQuality;
  animationsEnabled: boolean;
  developerMode: boolean;
  language: AppLanguage;
  dynamicTheme: boolean;
}

const SETTINGS_KEY = 'snowify_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  autoplay: true,
  audioQuality: 'best',
  animationsEnabled: true,
  developerMode: false,
  language: 'en',
  dynamicTheme: false,
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore write failure, non-critical
  }
}

export async function resetAllData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      'snowify_liked_songs',
      'snowify_playlists',
      'snowify_downloads',
      SETTINGS_KEY,
    ]);
  } catch {
    // ignore
  }
}
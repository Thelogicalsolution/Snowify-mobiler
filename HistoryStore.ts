import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from './PlaylistStore';

const HISTORY_KEY = 'snowify_history';

export async function loadHistory(): Promise<Track[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t: any) => t && typeof t.url === 'string' && typeof t.name === 'string')
      .map((t: any) => ({
        url: t.url,
        name: t.name,
        thumbnailUrl: typeof t.thumbnailUrl === 'string' ? t.thumbnailUrl : '',
      }));
  } catch {
    return [];
  }
}

export async function saveHistory(tracks: Track[]): Promise<void> {
  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(tracks));
  } catch {
    // non-critical
  }
}
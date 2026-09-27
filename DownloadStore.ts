import AsyncStorage from '@react-native-async-storage/async-storage';

export interface DownloadedTrack {
  url: string; // original YouTube URL - used as the lookup key
  name: string;
  thumbnailUrl?: string;
  localPath: string;
}

const DOWNLOADS_KEY = 'snowify_downloads';

export async function loadDownloads(): Promise<DownloadedTrack[]> {
  try {
    const raw = await AsyncStorage.getItem(DOWNLOADS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveDownloads(downloads: DownloadedTrack[]): Promise<void> {
  try {
    await AsyncStorage.setItem(DOWNLOADS_KEY, JSON.stringify(downloads));
  } catch {
    // ignore write failure, non-critical
  }
}
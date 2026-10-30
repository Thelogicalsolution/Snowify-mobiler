import AsyncStorage from '@react-native-async-storage/async-storage';

export type DownloadedVideo = {
  url: string;
  name: string;
  thumbnailUrl: string;
  videoPath: string;
  audioPath: string;
  height: number;
  bytes: number;
  at: number;
};

const KEY = 'snowify_video_downloads';

export async function loadVideoDownloads(): Promise<DownloadedVideo[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (d: any) =>
          d && typeof d.url === 'string' && typeof d.videoPath === 'string' && typeof d.audioPath === 'string',
      )
      .map((d: any) => ({
        url: d.url,
        name: typeof d.name === 'string' ? d.name : d.url,
        thumbnailUrl: typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl : '',
        videoPath: d.videoPath,
        audioPath: d.audioPath,
        height: Number(d.height) || 0,
        bytes: Number(d.bytes) || 0,
        at: Number(d.at) || 0,
      }));
  } catch {
    return [];
  }
}

export async function saveVideoDownloads(list: DownloadedVideo[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // non-critical
  }
}
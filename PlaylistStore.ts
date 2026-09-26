import AsyncStorage from '@react-native-async-storage/async-storage';

export type Track = {
  url: string;
  name: string;
  thumbnailUrl: string;
};

export type Playlist = {
  id: string;
  name: string;
  tracks: Track[];
};

const LIKED_KEY = 'snowify_liked_songs';
const PLAYLISTS_KEY = 'snowify_playlists';

export async function loadLikedSongs(): Promise<Track[]> {
  try {
    const raw = await AsyncStorage.getItem(LIKED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveLikedSongs(tracks: Track[]): Promise<void> {
  await AsyncStorage.setItem(LIKED_KEY, JSON.stringify(tracks));
}

export async function loadPlaylists(): Promise<Playlist[]> {
  try {
    const raw = await AsyncStorage.getItem(PLAYLISTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function savePlaylists(playlists: Playlist[]): Promise<void> {
  await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
}

export function makePlaylistId(): string {
  return `pl_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}
import AsyncStorage from '@react-native-async-storage/async-storage';

export type FollowedChannel = {
  url: string;
  name: string;
  avatarUrl: string;
};

const FOLLOW_KEY = 'snowify_following';

export async function loadFollowing(): Promise<FollowedChannel[]> {
  try {
    const raw = await AsyncStorage.getItem(FOLLOW_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c: any) => c && typeof c.url === 'string' && typeof c.name === 'string')
      .map((c: any) => ({
        url: c.url,
        name: c.name,
        avatarUrl: typeof c.avatarUrl === 'string' ? c.avatarUrl : '',
      }));
  } catch {
    return [];
  }
}

export async function saveFollowing(list: FollowedChannel[]): Promise<void> {
  try {
    await AsyncStorage.setItem(FOLLOW_KEY, JSON.stringify(list));
  } catch {
    // non-critical
  }
}
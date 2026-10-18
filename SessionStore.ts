import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from './PlaylistStore';

export type SavedRepeat = 'off' | 'all' | 'one';

export interface SavedSession {
  queue: Track[];
  queueIndex: number;
  shuffleOn: boolean;
  shuffleOrder: number[];
  shufflePos: number;
  repeatMode: SavedRepeat;
}

export interface SavedPosition {
  url: string;
  position: number;
  volume: number;
}

const SESSION_KEY = 'snowify_session';
const POSITION_KEY = 'snowify_session_position';

export async function saveSession(session: SavedSession): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore write failure, non-critical
  }
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.queue) || p.queue.length === 0) return null;

    const queue: Track[] = [];
    for (const t of p.queue) {
      if (!t || typeof t.url !== 'string' || typeof t.name !== 'string') return null;
      queue.push({
        url: t.url,
        name: t.name,
        thumbnailUrl: typeof t.thumbnailUrl === 'string' ? t.thumbnailUrl : '',
      });
    }

    const queueIndex = Number.isInteger(p.queueIndex) ? p.queueIndex : -1;
    if (queueIndex < 0 || queueIndex >= queue.length) return null;

    const repeatMode: SavedRepeat =
      p.repeatMode === 'all' || p.repeatMode === 'one' ? p.repeatMode : 'off';
    const shuffleOrder: number[] =
      Array.isArray(p.shuffleOrder) &&
      p.shuffleOrder.every((n: unknown) => Number.isInteger(n))
        ? p.shuffleOrder
        : [];

    return {
      queue,
      queueIndex,
      shuffleOn: p.shuffleOn === true,
      shuffleOrder,
      shufflePos: Number.isInteger(p.shufflePos) ? p.shufflePos : 0,
      repeatMode,
    };
  } catch {
    return null;
  }
}

export async function savePlaybackPosition(pos: SavedPosition): Promise<void> {
  try {
    await AsyncStorage.setItem(POSITION_KEY, JSON.stringify(pos));
  } catch {
    // ignore write failure, non-critical
  }
}

export async function loadPlaybackPosition(): Promise<SavedPosition | null> {
  try {
    const raw = await AsyncStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.url !== 'string') return null;
    return {
      url: p.url,
      position:
        typeof p.position === 'number' && isFinite(p.position) && p.position > 0
          ? p.position
          : 0,
      volume:
        typeof p.volume === 'number' && isFinite(p.volume) ? p.volume : 1,
    };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<string> {
  const results: string[] = [];
  for (const key of [SESSION_KEY, POSITION_KEY]) {
    try {
      await AsyncStorage.removeItem(key);
      const left = await AsyncStorage.getItem(key);
      results.push(`${key}: ${left === null ? 'cleared' : 'STILL PRESENT'}`);
    } catch (e: any) {
      results.push(`${key}: error ${e?.message ?? e}`);
    }
  }
  return results.join(', ');
}
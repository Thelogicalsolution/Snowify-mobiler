import AsyncStorage from '@react-native-async-storage/async-storage';

export type BookEntry = {
  url: string;
  name: string;
  thumbnailUrl: string;
  position: number;
  duration: number;
  updatedAt: number;
  isBook: boolean;
  finished: boolean;
};

export type BookMap = { [url: string]: BookEntry };

const BOOKS_KEY = 'snowify_books';
const BOOKS_MAX = 120;

// Anything this long (seconds) remembers its position and gets the speed and skip buttons.
export const LONG_FORM_SECONDS = 1200;

const BOOK_WORDS = /audio\s*-?\s*book|аудіокниг|аудиокниг|unabridged|narrated by|read by|full book/i;

export function looksLikeBook(name: string, uploader: string, duration: number): boolean {
  return duration >= 1800 && BOOK_WORDS.test(`${name} ${uploader}`);
}

export function formatHM(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

export function formatClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export async function loadBooks(): Promise<BookMap> {
  try {
    const raw = await AsyncStorage.getItem(BOOKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: BookMap = {};
    for (const key of Object.keys(parsed)) {
      const b = parsed[key];
      if (!b || typeof b.url !== 'string') continue;
      out[key] = {
        url: b.url,
        name: typeof b.name === 'string' ? b.name : b.url,
        thumbnailUrl: typeof b.thumbnailUrl === 'string' ? b.thumbnailUrl : '',
        position: Number(b.position) || 0,
        duration: Number(b.duration) || 0,
        updatedAt: Number(b.updatedAt) || 0,
        isBook: !!b.isBook,
        finished: !!b.finished,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveBooks(map: BookMap): Promise<void> {
  try {
    let entries = Object.values(map);
    if (entries.length > BOOKS_MAX) {
      const books = entries.filter(e => e.isBook);
      const others = entries
        .filter(e => !e.isBook)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, Math.max(0, BOOKS_MAX - books.length));
      entries = [...books, ...others];
    }
    const out: BookMap = {};
    for (const e of entries) out[e.url] = e;
    await AsyncStorage.setItem(BOOKS_KEY, JSON.stringify(out));
  } catch {
    // non-critical
  }
}
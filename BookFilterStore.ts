import AsyncStorage from '@react-native-async-storage/async-storage';

export type FilterChannel = { key: string; name: string };
export type BookFilter = { blocked: FilterChannel[]; trusted: FilterChannel[] };

const FILTER_KEY = 'snowify_book_filter';

export function channelKey(uploaderUrl: string | undefined, uploader: string | undefined): string {
  if (uploaderUrl) return uploaderUrl;
  return `name:${uploader ?? ''}`;
}

function clean(list: any): FilterChannel[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c: any) => c && typeof c.key === 'string' && c.key)
    .map((c: any) => ({ key: c.key, name: typeof c.name === 'string' ? c.name : c.key }));
}

export async function loadBookFilter(): Promise<BookFilter> {
  try {
    const raw = await AsyncStorage.getItem(FILTER_KEY);
    if (!raw) return { blocked: [], trusted: [] };
    const parsed = JSON.parse(raw);
    return { blocked: clean(parsed?.blocked), trusted: clean(parsed?.trusted) };
  } catch {
    return { blocked: [], trusted: [] };
  }
}

export async function saveBookFilter(filter: BookFilter): Promise<void> {
  try {
    await AsyncStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    // non-critical
  }
}
import AsyncStorage from '@react-native-async-storage/async-storage';

export type LyricsLine = { time: number; text: string };

export type LyricsResult = {
  synced: LyricsLine[] | null;
  plain: string | null;
  instrumental: boolean;
};

type CacheEntry = LyricsResult & { at: number };

const CACHE_KEY = 'snowify_lyrics';
const CACHE_MAX = 100;
const LRCLIB = 'https://lrclib.net/api';
const CLIENT_NAME = 'Snowify Mobile (https://github.com/Thelogicalsolution/Snowify-mobiler)';
// A lyrics record only counts when its length is within this many seconds of the song's.
const DURATION_TOLERANCE = 3;
const NOISE =
  /official|video|audio|lyric|visuali[sz]er|\bhd\b|\bhq\b|4k|remaster|\bmv\b|m\/v|music video|clip|explicit/i;

const enc = encodeURIComponent;

async function readCache(): Promise<{ [url: string]: CacheEntry }> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function loadCachedLyrics(url: string): Promise<LyricsResult | null> {
  const cache = await readCache();
  const hit = cache[url];
  if (!hit) return null;
  return {
    synced: hit.synced ?? null,
    plain: hit.plain ?? null,
    instrumental: !!hit.instrumental,
  };
}

export async function saveCachedLyrics(url: string, result: LyricsResult): Promise<void> {
  try {
    const cache = await readCache();
    cache[url] = { ...result, at: Date.now() };
    const urls = Object.keys(cache);
    if (urls.length > CACHE_MAX) {
      urls.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0));
      for (const old of urls.slice(0, urls.length - CACHE_MAX)) {
        delete cache[old];
      }
    }
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // non-critical
  }
}

// "[01:23.45] some words" -> { time: 83.45, text: "some words" }
export function parseLrc(text: string): LyricsLine[] {
  const lines: LyricsLine[] = [];
  for (const raw of text.split('\n')) {
    const stamps = raw.match(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g);
    if (!stamps) continue;
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const st of stamps) {
      const m = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/.exec(st);
      if (!m) continue;
      const frac = m[3] ? Number('0.' + m[3]) : 0;
      lines.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text: content });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[\s\-_.,'"“”‘’!?()\[\]{}:;|\/\\&+*]+/g, '');
}

function titlesMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  const shorter = x.length <= y.length ? x : y;
  if (shorter.length < 3) return x === y;
  return x.includes(y) || y.includes(x);
}

function stripNoise(s: string): string {
  const out = s.replace(/[(\[][^)\]]*[)\]]/g, m => (NOISE.test(m) ? '' : m));
  return out.replace(/\s{2,}/g, ' ').trim();
}

function guessArtistTitle(rawTitle: string, uploader: string): { artist: string; track: string } {
  const title = stripNoise(rawTitle);
  const parts = title.split(/\s[-–—]\s/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), track: parts.slice(1).join(' - ').trim() };
  }
  const artist = (uploader || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*official$/i, '')
    .trim();
  return { artist, track: title };
}

async function getJson(url: string): Promise<any> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    if (controller) controller.abort();
  }, 12000);
  try {
    const res = await fetch(url, {
      headers: { 'Lrclib-Client': CLIENT_NAME },
      signal: controller ? controller.signal : undefined,
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function pickBest(results: any[], track: string, artist: string, duration: number): any | null {
  const wantArtist = norm(artist);
  const scored = results
    .filter(r => r && (r.syncedLyrics || r.plainLyrics || r.instrumental))
    .filter(r => duration <= 0 || Math.abs((r.duration || 0) - duration) <= DURATION_TOLERANCE)
    .filter(r => titlesMatch(r.trackName || r.name || '', track))
    .map(r => {
      const haveArtist = norm(r.artistName || '');
      const artistMatch =
        !!wantArtist && !!haveArtist && (haveArtist.includes(wantArtist) || wantArtist.includes(haveArtist));
      const diff = duration > 0 ? Math.abs((r.duration || 0) - duration) : 0;
      const score = (r.syncedLyrics ? 2 : 0) + (r.plainLyrics ? 1 : 0) + (artistMatch ? 3 : 0) - diff * 0.1;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.length > 0 ? scored[0].r : null;
}

function toResult(r: any): LyricsResult {
  const synced =
    typeof r.syncedLyrics === 'string' && r.syncedLyrics.trim() ? parseLrc(r.syncedLyrics) : [];
  const plain =
    typeof r.plainLyrics === 'string' && r.plainLyrics.trim() ? r.plainLyrics.trim() : null;
  const hasSynced = synced.length > 0;
  return {
    synced: hasSynced ? synced : null,
    plain,
    instrumental: !!r.instrumental && !hasSynced && !plain,
  };
}

// Looks the song up on LRCLIB. Returns null when nothing matches; throws when the network failed.
export async function fetchLyrics(
  rawTitle: string,
  uploader: string,
  duration: number,
): Promise<LyricsResult | null> {
  const { artist, track } = guessArtistTitle(rawTitle, uploader);
  if (!track) return null;

  const queries: string[] = [];
  if (artist) {
    queries.push(`${LRCLIB}/search?track_name=${enc(track)}&artist_name=${enc(artist)}`);
  }
  queries.push(`${LRCLIB}/search?q=${enc(track)}`);
  if (artist) {
    queries.push(`${LRCLIB}/search?q=${enc(artist + ' ' + track)}`);
  }

  let gotAnswer = false;
  let lastError: any = null;
  for (const q of queries) {
    try {
      const results = await getJson(q);
      gotAnswer = true;
      const pick = pickBest(Array.isArray(results) ? results : [], track, artist, duration);
      if (pick) return toResult(pick);
    } catch (e) {
      lastError = e;
    }
  }
  if (!gotAnswer && lastError) throw lastError;
  return null;
}
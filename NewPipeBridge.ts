import { NativeModules } from 'react-native';

type SearchResult = {
  url: string;
  name: string;
  thumbnailUrl: string;
};

type StreamResult = {
  streamUrl: string;
  title: string;
  duration: string;
  thumbnailUrl: string;
  format: string;
};

export type StreamQuality = 'best' | 'balanced' | 'low';

export type PaletteSwatch = {
  color: string;
  share: number;
};

const { NewPipeExtractorModule } = NativeModules;

export async function searchVideos(query: string): Promise<SearchResult[]> {
  if (!query.trim()) {
    return [];
  }
  return NewPipeExtractorModule.searchVideos(query);
}

export async function getStreamUrl(
  videoUrl: string,
  quality: StreamQuality = 'best',
): Promise<StreamResult> {
  return NewPipeExtractorModule.getStreamUrl(videoUrl, quality);
}

// Returns up to 3 {color, share} entries ranked by how much of the
// thumbnail's area each color covers (index 0 = most space). `share` is
// that color's fraction (0-1) of the total population across the returned
// swatches.
export async function extractPalette(imageUrl: string): Promise<PaletteSwatch[]> {
  return NewPipeExtractorModule.extractPalette(imageUrl);
}

// Songs YouTube suggests after the given one (1-15 minutes, no live streams).
export async function getRelatedStreams(videoUrl: string): Promise<SearchResult[]> {
  return NewPipeExtractorModule.getRelatedStreams(videoUrl);
}

// True when the phone is on Wi-Fi (or Ethernet); false on mobile data or offline.
export async function isOnWifi(): Promise<boolean> {
  return NewPipeExtractorModule.isOnWifi();
}

export type PlaylistResult = {
  url: string;
  name: string;
  thumbnailUrl: string;
  uploader: string;
  count: number;
};

export type PlaylistTracks = {
  name: string;
  uploader: string;
  count: number;
  tracks: SearchResult[];
};

// YouTube playlists and mixes matching the query.
export async function searchPlaylists(query: string): Promise<PlaylistResult[]> {
  if (!query.trim()) {
    return [];
  }
  return NewPipeExtractorModule.searchPlaylists(query);
}

// The songs of a playlist or mix (up to maxItems).
export async function getPlaylistTracks(
  playlistUrl: string,
  maxItems: number = 300,
): Promise<PlaylistTracks> {
  return NewPipeExtractorModule.getPlaylistTracks(playlistUrl, maxItems);
}

export type TrackMeta = {
  title: string;
  uploader: string;
  duration: number;
};

// Title, uploader (usually the artist) and length in seconds of a video.
export async function getTrackMeta(videoUrl: string): Promise<TrackMeta> {
  return NewPipeExtractorModule.getTrackMeta(videoUrl);
}

export type VideoResult = {
  positionMs: number;
  ended: boolean;
  error: string | null;
  label: string;
};

// Opens the native full-screen video player; resolves when it is closed.
export async function playVideo(
  videoUrl: string,
  startSeconds: number,
  maxHeight: number = 1080,
): Promise<VideoResult> {
  return NewPipeExtractorModule.playVideo(videoUrl, startSeconds, maxHeight);
}
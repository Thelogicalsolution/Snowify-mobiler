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

// Returns up to 3 hex color strings, ranked by how much of the thumbnail's
// area each color covers (index 0 = most space).
export async function extractPalette(imageUrl: string): Promise<string[]> {
  return NewPipeExtractorModule.extractPalette(imageUrl);
}
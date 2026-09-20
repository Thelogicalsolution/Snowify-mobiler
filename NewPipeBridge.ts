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
};

const { NewPipeExtractorModule } = NativeModules;

export async function searchVideos(query: string): Promise<SearchResult[]> {
  if (!query.trim()) {
    return [];
  }
  return NewPipeExtractorModule.searchVideos(query);
}

export async function getStreamUrl(videoUrl: string): Promise<StreamResult> {
  return NewPipeExtractorModule.getStreamUrl(videoUrl);
}
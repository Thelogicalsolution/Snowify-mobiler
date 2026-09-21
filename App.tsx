/**
 * Snowify Mobile
 * @format
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TrackPlayer, { useIsPlaying } from '@rntp/player';
import { searchVideos, getStreamUrl } from './NewPipeBridge';

type SearchResult = {
  url: string;
  name: string;
  thumbnailUrl: string;
};

let playerSetupDone = false;

async function setupPlayer() {
  if (playerSetupDone) return;
  await TrackPlayer.setupPlayer({
    contentType: 'music',
    handleAudioBecomingNoisy: true,
    android: { wakeMode: 'network' },
  });
  playerSetupDone = true;
}

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loadingTrack, setLoadingTrack] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<SearchResult | null>(null);

  const playing = useIsPlaying();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setupPlayer().catch(error => {
      setSearchError(error?.message ?? 'Audio player failed to initialize');
    });
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setSearchError(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const found = await searchVideos(query);
        setResults(found);
      } catch (e: any) {
        setSearchError(e?.message ?? 'Search failed');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 600);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  async function handleSelectTrack(item: SearchResult) {
    setLoadingTrack(item.url);
    try {
      const stream = await getStreamUrl(item.url);

      await TrackPlayer.setMediaItems([
        {
          url: stream.streamUrl,
          title: stream.title || item.name,
          artist: 'YouTube',
          artworkUrl: stream.thumbnailUrl || item.thumbnailUrl,
        },
      ]);
      await TrackPlayer.play();
      setNowPlaying(item);
    } catch (e: any) {
      setSearchError(e?.message ?? 'Could not play this track');
    } finally {
      setLoadingTrack(null);
    }
  }

  async function togglePlayPause() {
    if (playing) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Snowify</Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search YouTube..."
          placeholderTextColor="#8A8A9A"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {searching && (
        <ActivityIndicator style={styles.loadingIndicator} color="#00E5FF" />
      )}

      {searchError && <Text style={styles.errorText}>{searchError}</Text>}

      <FlatList
        data={results}
        keyExtractor={item => item.url}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.trackRow}
            onPress={() => handleSelectTrack(item)}
            disabled={loadingTrack === item.url}
          >
            {item.thumbnailUrl ? (
              <Image
                source={{ uri: item.thumbnailUrl }}
                style={styles.trackArt}
              />
            ) : (
              <View style={styles.trackArt} />
            )}
            <View style={styles.trackInfo}>
              <Text style={styles.trackTitle} numberOfLines={2}>
                {item.name}
              </Text>
            </View>
            {loadingTrack === item.url && (
              <ActivityIndicator color="#00E5FF" size="small" />
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !searching && query.trim() ? (
            <Text style={styles.emptyText}>No results</Text>
          ) : undefined
        }
      />

      {nowPlaying && (
        <View style={styles.miniPlayer}>
          {nowPlaying.thumbnailUrl ? (
            <Image
              source={{ uri: nowPlaying.thumbnailUrl }}
              style={styles.miniPlayerArt}
            />
          ) : (
            <View style={styles.miniPlayerArt} />
          )}
          <View style={styles.miniPlayerInfo}>
            <Text style={styles.miniPlayerTitle} numberOfLines={1}>
              {nowPlaying.name}
            </Text>
          </View>
          <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
            <Text style={styles.playButtonText}>{playing ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0D0D12' },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { color: '#00E5FF', fontSize: 28, fontWeight: '700' },
  searchContainer: { paddingHorizontal: 20, paddingBottom: 12 },
  searchInput: {
    backgroundColor: '#1A1A22',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 15,
  },
  loadingIndicator: { marginBottom: 8 },
  errorText: {
    color: '#FF6B6B',
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  listContent: { paddingHorizontal: 20, paddingBottom: 100 },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A2A34',
  },
  trackArt: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#2A2A34',
    marginRight: 12,
  },
  trackInfo: { flex: 1 },
  trackTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  emptyText: { color: '#8A8A9A', textAlign: 'center', marginTop: 40 },
  miniPlayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A22',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A2A34',
  },
  miniPlayerArt: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#2A2A34',
    marginRight: 12,
  },
  miniPlayerInfo: { flex: 1 },
  miniPlayerTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00E5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonText: { color: '#0D0D12', fontSize: 16 },
});

export default App;
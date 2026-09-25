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
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import TrackPlayer, { useIsPlaying } from '@rntp/player';
import { searchVideos, getStreamUrl } from './NewPipeBridge';

type SearchResult = {
  url: string;
  name: string;
  thumbnailUrl: string;
};

const ACCENT = '#A855F7';
const BG = '#0B0B0F';
const CARD = '#17171D';
const BORDER = '#252530';
const TEXT_DIM = '#8A8A9A';

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

function AppContent() {
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loadingTrack, setLoadingTrack] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<SearchResult | null>(null);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatOn, setRepeatOn] = useState(false);

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

  function toggleLike(url: string) {
    setLiked(prev => ({ ...prev, [url]: !prev[url] }));
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Snowify</Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="What do you want to listen to?"
          placeholderTextColor={TEXT_DIM}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {searching && (
        <ActivityIndicator style={styles.loadingIndicator} color={ACCENT} />
      )}

      {searchError && <Text style={styles.errorText}>{searchError}</Text>}

      <FlatList
        data={results}
        keyExtractor={item => item.url}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: nowPlaying ? 110 + insets.bottom : 24 },
        ]}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={styles.trackRow}
            onPress={() => handleSelectTrack(item)}
            disabled={loadingTrack === item.url}
          >
            <Text style={styles.trackIndex}>{index + 1}</Text>
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
            {loadingTrack === item.url ? (
              <ActivityIndicator color={ACCENT} size="small" />
            ) : (
              <TouchableOpacity
                hitSlop={10}
                onPress={() => toggleLike(item.url)}
              >
                <Text
                  style={[
                    styles.heartIcon,
                    liked[item.url] && styles.heartIconActive,
                  ]}
                >
                  ♥
                </Text>
              </TouchableOpacity>
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
        <View
          style={[
            styles.miniPlayer,
            { paddingBottom: 10 + insets.bottom },
          ]}
        >
          <TouchableOpacity style={styles.miniPlayerTop}>
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
              <Text style={styles.miniPlayerArtist} numberOfLines={1}>
                YouTube
              </Text>
            </View>
            <TouchableOpacity
              hitSlop={10}
              onPress={() => toggleLike(nowPlaying.url)}
            >
              <Text
                style={[
                  styles.heartIcon,
                  liked[nowPlaying.url] && styles.heartIconActive,
                ]}
              >
                ♥
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>

          <View style={styles.transportRow}>
            <TouchableOpacity
              hitSlop={10}
              onPress={() => setShuffleOn(s => !s)}
            >
              <Text
                style={[
                  styles.transportIconSmall,
                  shuffleOn && styles.transportIconActive,
                ]}
              >
                ⤨
              </Text>
            </TouchableOpacity>

            <TouchableOpacity hitSlop={10} disabled>
              <Text style={[styles.transportIconSmall, styles.disabledIcon]}>
                ⏮
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.playButton}
              onPress={togglePlayPause}
            >
              <Text style={styles.playButtonText}>
                {playing ? '⏸' : '▶'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity hitSlop={10} disabled>
              <Text style={[styles.transportIconSmall, styles.disabledIcon]}>
                ⏭
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              hitSlop={10}
              onPress={() => setRepeatOn(r => !r)}
            >
              <Text
                style={[
                  styles.transportIconSmall,
                  repeatOn && styles.transportIconActive,
                ]}
              >
                ⟳
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { color: ACCENT, fontSize: 28, fontWeight: '700' },
  searchContainer: { paddingHorizontal: 20, paddingBottom: 12 },
  searchInput: {
    backgroundColor: CARD,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  listContent: { paddingHorizontal: 20 },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  trackIndex: {
    color: TEXT_DIM,
    width: 22,
    fontSize: 13,
  },
  trackArt: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: CARD,
    marginRight: 12,
  },
  trackInfo: { flex: 1 },
  trackTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  emptyText: { color: TEXT_DIM, textAlign: 'center', marginTop: 40 },
  heartIcon: { color: TEXT_DIM, fontSize: 18, paddingHorizontal: 4 },
  heartIconActive: { color: ACCENT },
  miniPlayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: CARD,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  miniPlayerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  miniPlayerArt: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: BORDER,
    marginRight: 12,
  },
  miniPlayerInfo: { flex: 1 },
  miniPlayerTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  miniPlayerArtist: { color: TEXT_DIM, fontSize: 11, marginTop: 2 },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingVertical: 4,
  },
  transportIconSmall: { color: '#FFFFFF', fontSize: 18 },
  transportIconActive: { color: ACCENT },
  disabledIcon: { color: BORDER },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonText: { color: '#0B0B0F', fontSize: 16 },
});

export default App;
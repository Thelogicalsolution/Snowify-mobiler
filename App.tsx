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
import TrackPlayer, {
  Event,
  RepeatMode,
  useIsPlaying,
  useProgress,
} from '@rntp/player';
import { searchVideos, getStreamUrl } from './NewPipeBridge';

type SearchResult = {
  url: string;
  name: string;
  thumbnailUrl: string;
};

type RepeatSetting = 'off' | 'all' | 'one';

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

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

function shuffledOrder(length: number, frontIndex: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  if (frontIndex >= 0) {
    const pos = indices.indexOf(frontIndex);
    if (pos > 0) {
      indices.splice(pos, 1);
      indices.unshift(frontIndex);
    }
  }
  return indices;
}

function DraggableBar({
  value,
  onChange,
  height = 4,
  commitOnRelease = false,
}: {
  value: number;
  onChange: (v: number) => void;
  height?: number;
  commitOnRelease?: boolean;
}) {
  const wrapperRef = useRef<View>(null);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(value);
  const latestRef = useRef(value);
  const originXRef = useRef(0);
  const widthRef = useRef(0);

  useEffect(() => {
    if (!dragging) {
      setDragValue(value);
      latestRef.current = value;
    }
  }, [value, dragging]);

  function pageXToValue(pageX: number): number {
    if (!widthRef.current) return latestRef.current;
    const relative = pageX - originXRef.current;
    return Math.max(0, Math.min(1, relative / widthRef.current));
  }

  function handleGrant(evt: any) {
    const node = wrapperRef.current;
    if (node) {
      node.measure((_x, _y, w, _h, pageX) => {
        originXRef.current = pageX;
        widthRef.current = w;
        const v = pageXToValue(evt.nativeEvent.pageX);
        latestRef.current = v;
        setDragging(true);
        setDragValue(v);
        if (!commitOnRelease) onChange(v);
      });
    }
  }

  function handleMove(evt: any) {
    const v = pageXToValue(evt.nativeEvent.pageX);
    latestRef.current = v;
    setDragValue(v);
    if (!commitOnRelease) onChange(v);
  }

  function handleRelease() {
    if (commitOnRelease) onChange(latestRef.current);
    setDragging(false);
  }

  const displayed = dragging ? dragValue : Math.max(0, Math.min(1, value));

  return (
    <View
      ref={wrapperRef}
      style={styles.barTouchWrapper}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={handleGrant}
      onResponderMove={handleMove}
      onResponderRelease={handleRelease}
      onResponderTerminate={handleRelease}
    >
      <View style={[styles.barTrack, { height }]}>
        <View
          style={[styles.barFill, { width: `${displayed * 100}%`, height }]}
        />
      </View>
    </View>
  );
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

  const [queue, setQueue] = useState<SearchResult[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);
  const [shufflePos, setShufflePos] = useState(0);
  const [repeatMode, setRepeatMode] = useState<RepeatSetting>('off');
  const [volume, setVolume] = useState(1);

  const playing = useIsPlaying();
  const progress = useProgress(0.5);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setupPlayer().catch(error => {
      setSearchError(error?.message ?? 'Audio player failed to initialize');
    });
  }, []);

  useEffect(() => {
    if (!playerSetupDone) return;
    TrackPlayer.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (!playerSetupDone) return;
    TrackPlayer.setRepeatMode(
      repeatMode === 'one' ? RepeatMode.One : RepeatMode.Off,
    );
  }, [repeatMode]);

  const goNextRef = useRef<() => void>(() => {});
  const goPreviousRef = useRef<() => void>(() => {});

  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
      if (repeatMode === 'all') {
        goNextRef.current();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatMode]);

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

  async function playAtIndex(
    list: SearchResult[],
    index: number,
    isNewQueue: boolean,
  ) {
    const item = list[index];
    if (!item) return;

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

      setQueue(list);
      setQueueIndex(index);
      setNowPlaying(item);

      if (isNewQueue) {
        const order = shuffledOrder(list.length, index);
        setShuffleOrder(order);
        setShufflePos(0);
      } else if (shuffleOn) {
        const pos = shuffleOrder.indexOf(index);
        if (pos >= 0) setShufflePos(pos);
      }
    } catch (e: any) {
      setSearchError(e?.message ?? 'Could not play this track');
    } finally {
      setLoadingTrack(null);
    }
  }

  function handleSelectTrack(item: SearchResult, index: number) {
    playAtIndex(results, index, true);
  }

  function goNext() {
    if (queue.length === 0) return;

    if (shuffleOn) {
      let nextPos = shufflePos + 1;
      if (nextPos >= shuffleOrder.length) {
        if (repeatMode === 'off') return;
        const newOrder = shuffledOrder(queue.length, -1);
        setShuffleOrder(newOrder);
        setShufflePos(0);
        playAtIndex(queue, newOrder[0], false);
        return;
      }
      setShufflePos(nextPos);
      playAtIndex(queue, shuffleOrder[nextPos], false);
    } else {
      let nextIndex = queueIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeatMode === 'off') return;
        nextIndex = 0;
      }
      playAtIndex(queue, nextIndex, false);
    }
  }

  function goPrevious() {
    if (queue.length === 0) return;

    if (progress.position > 3) {
      TrackPlayer.seekTo(0);
      return;
    }

    if (shuffleOn) {
      let prevPos = shufflePos - 1;
      if (prevPos < 0) {
        if (repeatMode === 'off') return;
        prevPos = shuffleOrder.length - 1;
      }
      setShufflePos(prevPos);
      playAtIndex(queue, shuffleOrder[prevPos], false);
    } else {
      let prevIndex = queueIndex - 1;
      if (prevIndex < 0) {
        if (repeatMode === 'off') return;
        prevIndex = queue.length - 1;
      }
      playAtIndex(queue, prevIndex, false);
    }
  }

  goNextRef.current = goNext;
  goPreviousRef.current = goPrevious;

  function toggleShuffle() {
    setShuffleOn(on => {
      const next = !on;
      if (next && queue.length > 0) {
        const order = shuffledOrder(queue.length, queueIndex);
        setShuffleOrder(order);
        setShufflePos(0);
      }
      return next;
    });
  }

  function cycleRepeat() {
    setRepeatMode(mode =>
      mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off',
    );
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
          { paddingBottom: nowPlaying ? 150 + insets.bottom : 24 },
        ]}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={styles.trackRow}
            onPress={() => handleSelectTrack(item, index)}
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
        <View style={[styles.miniPlayer, { paddingBottom: 10 + insets.bottom }]}>
          <View style={styles.progressBarWrapper}>
            <DraggableBar
              value={
                progress.duration > 0
                  ? progress.position / progress.duration
                  : 0
              }
              onChange={v => TrackPlayer.seekTo(v * progress.duration)}
              height={3}
              commitOnRelease
            />
          </View>

          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(progress.position)}</Text>
            <Text style={styles.timeText}>{formatTime(progress.duration)}</Text>
          </View>

          <View style={styles.miniPlayerTop}>
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
          </View>

          <View style={styles.transportRow}>
            <TouchableOpacity hitSlop={10} onPress={toggleShuffle}>
              <Text
                style={[
                  styles.transportIconSmall,
                  shuffleOn && styles.transportIconActive,
                ]}
              >
                ⤨
              </Text>
            </TouchableOpacity>

            <TouchableOpacity hitSlop={10} onPress={goPrevious}>
              <Text style={styles.transportIconSmall}>⏮</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.playButton}
              onPress={togglePlayPause}
            >
              <Text style={styles.playButtonText}>
                {playing ? '⏸' : '▶'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity hitSlop={10} onPress={goNext}>
              <Text style={styles.transportIconSmall}>⏭</Text>
            </TouchableOpacity>

            <TouchableOpacity hitSlop={10} onPress={cycleRepeat}>
              <View>
                <Text
                  style={[
                    styles.transportIconSmall,
                    repeatMode !== 'off' && styles.transportIconActive,
                  ]}
                >
                  ⟳
                </Text>
                {repeatMode === 'one' && (
                  <Text style={styles.repeatOneBadge}>1</Text>
                )}
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.volumeRow}>
            <Text style={styles.volumeIcon}>🔊</Text>
            <View style={styles.volumeBarWrapper}>
              <DraggableBar value={volume} onChange={setVolume} height={3} />
            </View>
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
  trackIndex: { color: TEXT_DIM, width: 22, fontSize: 13 },
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
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  progressBarWrapper: {
    marginHorizontal: 48,
  },
  barTouchWrapper: {
    width: '100%',
    paddingVertical: 14,
    justifyContent: 'center',
  },
  barTrack: {
    width: '100%',
    backgroundColor: BORDER,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: { backgroundColor: ACCENT, borderRadius: 2 },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -8,
    marginHorizontal: 4,
  },
  timeText: { color: TEXT_DIM, fontSize: 10 },
  miniPlayerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
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
  repeatOneBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    color: ACCENT,
    fontSize: 9,
    fontWeight: '700',
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonText: { color: '#0B0B0F', fontSize: 16 },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 4,
    gap: 8,
    marginHorizontal: 28,
  },
  volumeIcon: { fontSize: 12 },
  volumeBarWrapper: { flex: 1 },
});

export default App;
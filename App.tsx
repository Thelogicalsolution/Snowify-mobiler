/**
 * Snowify Mobile
 * @format
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  ScrollView,
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
import {
  Track,
  Playlist,
  loadLikedSongs,
  saveLikedSongs,
  loadPlaylists,
  savePlaylists,
  makePlaylistId,
} from './PlaylistStore';

type SearchResult = Track;
type RepeatSetting = 'off' | 'all' | 'one';
type ViewName = 'search' | 'library' | 'playlist';

const ACCENT = '#A855F7';
const LIKE_RED = '#FF3B5C';
const BG = '#0B0B0F';
const CARD = '#17171D';
const BORDER = '#252530';
const TEXT_DIM = '#8A8A9A';
const TAB_BAR_HEIGHT = 52;

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

function AnimatedHeart({
  liked,
  onLikeToggle,
  size = 18,
}: {
  liked: boolean;
  onLikeToggle: () => void;
  size?: number;
}) {
  const crack = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const [cracking, setCracking] = useState(false);

  function handlePress() {
    if (liked) {
      setCracking(true);
      crack.setValue(0);
      Animated.timing(crack, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }).start(() => {
        setCracking(false);
        crack.setValue(0);
        onLikeToggle();
      });
    } else {
      onLikeToggle();
      pop.setValue(1.4);
      Animated.spring(pop, {
        toValue: 1,
        useNativeDriver: true,
        friction: 4,
      }).start();
    }
  }

  const leftStyle = {
    transform: [
      { translateX: crack.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) },
      {
        rotate: crack.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '-20deg'],
        }),
      },
    ],
    opacity: crack.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
  };
  const rightStyle = {
    transform: [
      { translateX: crack.interpolate({ inputRange: [0, 1], outputRange: [0, 7] }) },
      {
        rotate: crack.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '20deg'],
        }),
      },
    ],
    opacity: crack.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
  };

  return (
    <TouchableOpacity hitSlop={10} onPress={handlePress}>
      {cracking ? (
        <View style={{ width: size, height: size }}>
          <Animated.View
            style={[
              styles.heartHalfLeft,
              { width: size / 2, height: size },
              leftStyle,
            ]}
          >
            <Text style={[styles.heartGlyph, { fontSize: size, width: size, color: LIKE_RED }]}>
              ♥
            </Text>
          </Animated.View>
          <Animated.View
            style={[
              styles.heartHalfRight,
              { width: size / 2, height: size, left: size / 2 },
              rightStyle,
            ]}
          >
            <Text
              style={[
                styles.heartGlyph,
                {
                  fontSize: size,
                  width: size,
                  marginLeft: -size / 2,
                  color: LIKE_RED,
                },
              ]}
            >
              ♥
            </Text>
          </Animated.View>
        </View>
      ) : (
        <Animated.Text
          style={[
            styles.heartIcon,
            { fontSize: size, transform: [{ scale: pop }] },
            liked && styles.heartIconActive,
          ]}
        >
          ♥
        </Animated.Text>
      )}
    </TouchableOpacity>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();

  const [view, setView] = useState<ViewName>('search');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loadingTrack, setLoadingTrack] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<SearchResult | null>(null);

  const [queue, setQueue] = useState<SearchResult[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);
  const [shufflePos, setShufflePos] = useState(0);
  const [repeatMode, setRepeatMode] = useState<RepeatSetting>('off');
  const [volume, setVolume] = useState(1);

  const [storeLoaded, setStoreLoaded] = useState(false);
  const [likedSongs, setLikedSongs] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [viewingPlaylist, setViewingPlaylist] = useState<{
    id: string;
    name: string;
    tracks: Track[];
  } | null>(null);

  const [addToPlaylistTarget, setAddToPlaylistTarget] =
    useState<Track | null>(null);
  const [newPlaylistModalVisible, setNewPlaylistModalVisible] =
    useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const playing = useIsPlaying();
  const progress = useProgress(0.5);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setupPlayer().catch(error => {
      setSearchError(error?.message ?? 'Audio player failed to initialize');
    });
  }, []);

  useEffect(() => {
    (async () => {
      const [liked, pls] = await Promise.all([
        loadLikedSongs(),
        loadPlaylists(),
      ]);
      setLikedSongs(liked);
      setPlaylists(pls);
      setStoreLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!storeLoaded) return;
    saveLikedSongs(likedSongs);
  }, [likedSongs, storeLoaded]);

  useEffect(() => {
    if (!storeLoaded) return;
    savePlaylists(playlists);
  }, [playlists, storeLoaded]);

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

  function isLiked(url: string): boolean {
    return likedSongs.some(t => t.url === url);
  }

  function toggleLike(item: Track) {
    setLikedSongs(prev =>
      prev.some(t => t.url === item.url)
        ? prev.filter(t => t.url !== item.url)
        : [...prev, item],
    );
  }

  function addTrackToPlaylist(playlistId: string, track: Track) {
    setPlaylists(prev =>
      prev.map(p =>
        p.id === playlistId
          ? {
              ...p,
              tracks: p.tracks.some(t => t.url === track.url)
                ? p.tracks
                : [...p.tracks, track],
            }
          : p,
      ),
    );
    setAddToPlaylistTarget(null);
  }

  function handleCreatePlaylist() {
    const name = newPlaylistName.trim() || 'My Playlist';
    const id = makePlaylistId();
    const track = addToPlaylistTarget;
    setPlaylists(prev => [...prev, { id, name, tracks: track ? [track] : [] }]);
    setNewPlaylistModalVisible(false);
    setAddToPlaylistTarget(null);
    setNewPlaylistName('');
  }

  function openPlaylistView(id: 'liked' | string) {
    if (id === 'liked') {
      setViewingPlaylist({ id: 'liked', name: 'Liked Songs', tracks: likedSongs });
    } else {
      const pl = playlists.find(p => p.id === id);
      if (!pl) return;
      setViewingPlaylist({ id: pl.id, name: pl.name, tracks: pl.tracks });
    }
    setView('playlist');
  }

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

  function renderTrackRow(item: SearchResult, index: number, list: SearchResult[]) {
    return (
      <TouchableOpacity
        key={item.url}
        style={styles.trackRow}
        onPress={() => playAtIndex(list, index, true)}
        disabled={loadingTrack === item.url}
      >
        <Text style={styles.trackIndex}>{index + 1}</Text>
        {item.thumbnailUrl ? (
          <Image source={{ uri: item.thumbnailUrl }} style={styles.trackArt} />
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
          <View style={styles.rowActions}>
            <AnimatedHeart
              liked={isLiked(item.url)}
              onLikeToggle={() => toggleLike(item)}
            />
            <TouchableOpacity
              hitSlop={10}
              onPress={() => setAddToPlaylistTarget(item)}
            >
              <Text style={styles.dotsIcon}>⋮</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  const bottomPad =
    TAB_BAR_HEIGHT + insets.bottom + (nowPlaying ? 150 : 10);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />

      {view === 'search' && (
        <>
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
              { paddingBottom: bottomPad },
            ]}
            renderItem={({ item, index }) =>
              renderTrackRow(item, index, results)
            }
            ListEmptyComponent={
              !searching && query.trim() ? (
                <Text style={styles.emptyText}>No results</Text>
              ) : undefined
            }
          />
        </>
      )}

      {view === 'library' && (
        <>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Your Library</Text>
          </View>
          <View style={styles.libraryHeaderRow}>
            <Text style={styles.libraryHeaderLabel}>Playlists</Text>
            <TouchableOpacity onPress={() => setNewPlaylistModalVisible(true)}>
              <Text style={styles.libraryAddButton}>+ New</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={playlists}
            keyExtractor={p => p.id}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: bottomPad },
            ]}
            ListHeaderComponent={
              <TouchableOpacity
                style={styles.playlistRow}
                onPress={() => openPlaylistView('liked')}
              >
                <View style={styles.likedSongsIcon}>
                  <Text style={styles.likedSongsIconText}>♥</Text>
                </View>
                <View style={styles.trackInfo}>
                  <Text style={styles.trackTitle}>Liked Songs</Text>
                  <Text style={styles.playlistSubtitle}>
                    {likedSongs.length} songs
                  </Text>
                </View>
              </TouchableOpacity>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.playlistRow}
                onPress={() => openPlaylistView(item.id)}
              >
                <View style={styles.playlistIcon}>
                  <Text style={styles.playlistIconText}>🎵</Text>
                </View>
                <View style={styles.trackInfo}>
                  <Text style={styles.trackTitle}>{item.name}</Text>
                  <Text style={styles.playlistSubtitle}>
                    {item.tracks.length} songs
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </>
      )}

      {view === 'playlist' && viewingPlaylist && (
        <>
          <View style={styles.playlistDetailHeader}>
            <TouchableOpacity onPress={() => setView('library')} hitSlop={10}>
              <Text style={styles.backArrow}>←</Text>
            </TouchableOpacity>
            <Text style={styles.playlistDetailTitle} numberOfLines={1}>
              {viewingPlaylist.name}
            </Text>
          </View>
          <FlatList
            data={viewingPlaylist.tracks}
            keyExtractor={t => t.url}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: bottomPad },
            ]}
            renderItem={({ item, index }) =>
              renderTrackRow(item, index, viewingPlaylist.tracks)
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>No songs yet</Text>
            }
          />
        </>
      )}

      {nowPlaying && (
        <View
          style={[
            styles.miniPlayer,
            { bottom: TAB_BAR_HEIGHT + insets.bottom },
          ]}
        >
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
            <AnimatedHeart
              liked={isLiked(nowPlaying.url)}
              onLikeToggle={() => toggleLike(nowPlaying)}
            />
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

            <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
              <Text style={styles.playButtonText}>{playing ? '⏸' : '▶'}</Text>
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

      <View style={[styles.tabBar, { paddingBottom: insets.bottom }]}>
        <TouchableOpacity style={styles.tabButton} onPress={() => setView('search')}>
          <Text style={[styles.tabIcon, view === 'search' && styles.tabIconActive]}>
            🔍
          </Text>
          <Text
            style={[styles.tabLabel, view === 'search' && styles.tabLabelActive]}
          >
            Search
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabButton}
          onPress={() => setView('library')}
        >
          <Text
            style={[
              styles.tabIcon,
              (view === 'library' || view === 'playlist') &&
                styles.tabIconActive,
            ]}
          >
            📚
          </Text>
          <Text
            style={[
              styles.tabLabel,
              (view === 'library' || view === 'playlist') &&
                styles.tabLabelActive,
            ]}
          >
            Library
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={!!addToPlaylistTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setAddToPlaylistTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add to playlist</Text>
            <ScrollView style={styles.modalScroll}>
              {playlists.length === 0 && (
                <Text style={styles.modalEmptyText}>No playlists yet</Text>
              )}
              {playlists.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.modalRow}
                  onPress={() => {
                    if (addToPlaylistTarget) {
                      addTrackToPlaylist(p.id, addToPlaylistTarget);
                    }
                  }}
                >
                  <Text style={styles.modalRowText}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalNewPlaylistRow}
              onPress={() => setNewPlaylistModalVisible(true)}
            >
              <Text style={styles.modalNewPlaylistText}>+ New Playlist</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setAddToPlaylistTarget(null)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={newPlaylistModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNewPlaylistModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create playlist</Text>
            <TextInput
              style={styles.modalInput}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              placeholder="My Playlist"
              placeholderTextColor={TEXT_DIM}
              autoFocus
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                onPress={() => {
                  setNewPlaylistModalVisible(false);
                  setNewPlaylistName('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalOkButton}
                onPress={handleCreatePlaylist}
              >
                <Text style={styles.modalOkText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heartIcon: { color: TEXT_DIM, fontSize: 18, paddingHorizontal: 4 },
  heartIconActive: { color: LIKE_RED },
  heartHalfLeft: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  heartHalfRight: { position: 'absolute', top: 0, overflow: 'hidden' },
  heartGlyph: { textAlign: 'left' },
  dotsIcon: { color: TEXT_DIM, fontSize: 18, paddingHorizontal: 4 },
  libraryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  libraryHeaderLabel: { color: TEXT_DIM, fontSize: 12, fontWeight: '700' },
  libraryAddButton: { color: ACCENT, fontSize: 13, fontWeight: '700' },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  likedSongsIcon: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: LIKE_RED,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  likedSongsIconText: { color: '#FFFFFF', fontSize: 18 },
  playlistIcon: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: CARD,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  playlistIconText: { fontSize: 18 },
  playlistSubtitle: { color: TEXT_DIM, fontSize: 12, marginTop: 2 },
  playlistDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 12,
  },
  backArrow: { color: '#FFFFFF', fontSize: 20 },
  playlistDetailTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', flex: 1 },
  miniPlayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: CARD,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  progressBarWrapper: { marginHorizontal: 48 },
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
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    backgroundColor: CARD,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  tabButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 6,
  },
  tabIcon: { fontSize: 18, opacity: 0.5 },
  tabIconActive: { opacity: 1 },
  tabLabel: { color: TEXT_DIM, fontSize: 10, marginTop: 2 },
  tabLabelActive: { color: ACCENT, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    width: '85%',
    backgroundColor: CARD,
    borderRadius: 14,
    padding: 20,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalScroll: { maxHeight: 220 },
  modalEmptyText: { color: TEXT_DIM, fontSize: 13, paddingVertical: 8 },
  modalRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  modalRowText: { color: '#FFFFFF', fontSize: 14 },
  modalNewPlaylistRow: { paddingVertical: 12 },
  modalNewPlaylistText: { color: ACCENT, fontSize: 14, fontWeight: '700' },
  modalCancelButton: { alignItems: 'center', paddingTop: 8 },
  modalCancelText: { color: TEXT_DIM, fontSize: 14 },
  modalInput: {
    backgroundColor: BG,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
    marginBottom: 16,
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 20,
  },
  modalOkButton: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  modalOkText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});

export default App;
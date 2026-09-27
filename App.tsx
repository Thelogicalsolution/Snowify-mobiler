/**
 * Snowify Mobile
 * @format
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
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
import Clipboard from '@react-native-clipboard/clipboard';
import TrackPlayer, {
  Event,
  RepeatMode,
  useIsPlaying,
  useProgress,
} from '@rntp/player';
import {
  Heart,
  MoreVertical,
  Music,
  Search,
  Library,
  ChevronLeft,
  ChevronDown,
  Shuffle,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Repeat,
  Repeat1,
  Volume2,
  Settings as SettingsIcon,
} from 'lucide-react-native';
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
import {
  AppSettings,
  AudioQuality,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  resetAllData,
} from './SettingsStore';
import { logDebug, getDebugLogs, clearDebugLogs } from './DebugLog';

type SearchResult = Track;
type RepeatSetting = 'off' | 'all' | 'one';
type ViewName = 'search' | 'library' | 'playlist' | 'settings';

const ACCENT = '#A855F7';
const LIKE_RED = '#FF3B5C';
const BG = '#0B0B0F';
const CARD = '#17171D';
const BORDER = '#252530';
const TEXT_DIM = '#8A8A9A';
const TAB_BAR_FALLBACK_HEIGHT = 70;

const AUDIO_QUALITY_LABELS: Record<AudioQuality, string> = {
  best: 'Best',
  balanced: 'Balanced',
  low: 'Low',
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
  animationsEnabled = true,
}: {
  liked: boolean;
  onLikeToggle: () => void;
  size?: number;
  animationsEnabled?: boolean;
}) {
  const crack = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const [cracking, setCracking] = useState(false);

  function handlePress() {
    if (!animationsEnabled) {
      onLikeToggle();
      return;
    }

    if (liked) {
      setCracking(true);
      crack.setValue(0);
      Animated.timing(crack, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }).start(() => {
        // Flip the parent's liked state FIRST, so that by the time we
        // switch back to the plain (non-cracking) heart render below,
        // it already picks up liked=false. Doing this in the old order
        // (setCracking(false) before onLikeToggle()) caused a one-frame
        // flash of a solid red heart, since the plain render briefly
        // saw cracking=false with a still-stale liked=true.
        onLikeToggle();
        setCracking(false);
        crack.setValue(0);
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
            <Heart size={size} color={LIKE_RED} fill={LIKE_RED} />
          </Animated.View>
          <Animated.View
            style={[
              styles.heartHalfRight,
              { width: size / 2, height: size, left: size / 2 },
              rightStyle,
            ]}
          >
            <View style={{ marginLeft: -size / 2 }}>
              <Heart size={size} color={LIKE_RED} fill={LIKE_RED} />
            </View>
          </Animated.View>
        </View>
      ) : (
        <Animated.View style={{ transform: [{ scale: pop }] }}>
          <Heart
            size={size}
            color={liked ? LIKE_RED : TEXT_DIM}
            fill={liked ? LIKE_RED : 'none'}
          />
        </Animated.View>
      )}
    </TouchableOpacity>
  );
}

function SettingsRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <View style={styles.settingsRow}>
      <View style={styles.settingsRowText}>
        <Text style={styles.settingsRowLabel}>{label}</Text>
        {description ? (
          <Text style={styles.settingsRowDescription}>{description}</Text>
        ) : null}
      </View>
      {control}
    </View>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.settingsSection}>
      <Text style={styles.settingsSectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();

  const [view, setView] = useState<ViewName>('search');
  const [tabBarHeight, setTabBarHeight] = useState(TAB_BAR_FALLBACK_HEIGHT);
  const viewOpacity = useRef(new Animated.Value(1)).current;

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

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [debugLogsText, setDebugLogsText] = useState('');

  const playing = useIsPlaying();
  const progress = useProgress(0.5);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setupPlayer().catch(error => {
      const msg = error?.message ?? 'Audio player failed to initialize';
      setSearchError(msg);
      logDebug(`Player init failed: ${msg}`);
    });
  }, []);

  useEffect(() => {
    (async () => {
      const [liked, pls, loadedSettings] = await Promise.all([
        loadLikedSongs(),
        loadPlaylists(),
        loadSettings(),
      ]);
      setLikedSongs(liked);
      setPlaylists(pls);
      setSettings(loadedSettings);
      setStoreLoaded(true);
      setSettingsLoaded(true);
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
    if (!settingsLoaded) return;
    saveSettings(settings);
  }, [settings, settingsLoaded]);

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

  useEffect(() => {
    if (view === 'settings' && settings.developerMode) {
      setDebugLogsText(getDebugLogs());
    }
  }, [view, settings.developerMode]);

  const goNextRef = useRef<() => void>(() => {});

  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
      if (repeatMode === 'all' || (repeatMode === 'off' && settings.autoplay)) {
        goNextRef.current();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatMode, settings.autoplay]);

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
        const msg = e?.message ?? 'Search failed';
        setSearchError(msg);
        setResults([]);
        logDebug(`Search failed for "${query}": ${msg}`);
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

  function changeView(newView: ViewName) {
    if (newView === view) return;

    if (!settings.animationsEnabled) {
      setView(newView);
      return;
    }

    viewOpacity.stopAnimation();
    Animated.timing(viewOpacity, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      setView(newView);
      Animated.timing(viewOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    });
  }

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
    changeView('playlist');
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
      logDebug(`Playing: ${item.name}`);

      if (isNewQueue) {
        const order = shuffledOrder(list.length, index);
        setShuffleOrder(order);
        setShufflePos(0);
      } else if (shuffleOn) {
        const pos = shuffleOrder.indexOf(index);
        if (pos >= 0) setShufflePos(pos);
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Could not play this track';
      setSearchError(msg);
      logDebug(`Playback failed for "${item.name}": ${msg}`);
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

  function updateSetting<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  function cycleAudioQuality() {
    const order: AudioQuality[] = ['best', 'balanced', 'low'];
    const idx = order.indexOf(settings.audioQuality);
    updateSetting('audioQuality', order[(idx + 1) % order.length]);
  }

  function handleResetAllData() {
    Alert.alert(
      'Reset all data',
      'This will delete all playlists, liked songs, and settings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetAllData();
            setLikedSongs([]);
            setPlaylists([]);
            setSettings(DEFAULT_SETTINGS);
            logDebug('All data reset by user');
          },
        },
      ],
    );
  }

  function handleCopyLogs() {
    const text = getDebugLogs();
    Clipboard.setString(text);
    Alert.alert('Copied', 'Debug logs copied to clipboard.');
  }

  function handleClearLogs() {
    clearDebugLogs();
    setDebugLogsText(getDebugLogs());
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
              animationsEnabled={settings.animationsEnabled}
            />
            <TouchableOpacity
              hitSlop={10}
              onPress={() => setAddToPlaylistTarget(item)}
            >
              <MoreVertical size={18} color={TEXT_DIM} />
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  const bottomPad = tabBarHeight + (nowPlaying ? 150 : 10);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />

      <Animated.View style={{ flex: 1, opacity: viewOpacity }}>
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
                    <Heart size={20} color="#FFFFFF" fill="#FFFFFF" />
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
                    <Music size={20} color={ACCENT} />
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
              <TouchableOpacity onPress={() => changeView('library')} hitSlop={10}>
                <ChevronLeft size={24} color="#FFFFFF" />
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

        {view === 'settings' && (
          <>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Settings</Text>
            </View>
            <ScrollView
              contentContainerStyle={[
                styles.settingsScroll,
                { paddingBottom: bottomPad },
              ]}
            >
              <SettingsSection title="Playback">
                <SettingsRow
                  label="Autoplay"
                  description="Continue through the current queue when a track ends"
                  control={
                    <Switch
                      value={settings.autoplay}
                      onValueChange={v => updateSetting('autoplay', v)}
                      trackColor={{ true: ACCENT, false: BORDER }}
                      thumbColor="#FFFFFF"
                    />
                  }
                />
                <SettingsRow
                  label="Audio quality"
                  description="Higher quality uses more bandwidth"
                  control={
                    <TouchableOpacity
                      style={styles.settingsDropdown}
                      onPress={cycleAudioQuality}
                    >
                      <Text style={styles.settingsDropdownText}>
                        {AUDIO_QUALITY_LABELS[settings.audioQuality]}
                      </Text>
                      <ChevronDown size={14} color={TEXT_DIM} />
                    </TouchableOpacity>
                  }
                />
              </SettingsSection>

              <SettingsSection title="Appearance">
                <SettingsRow
                  label="Animations"
                  description="Enable smooth transitions and animations throughout the app"
                  control={
                    <Switch
                      value={settings.animationsEnabled}
                      onValueChange={v => updateSetting('animationsEnabled', v)}
                      trackColor={{ true: ACCENT, false: BORDER }}
                      thumbColor="#FFFFFF"
                    />
                  }
                />
              </SettingsSection>

              <SettingsSection title="Data">
                <SettingsRow
                  label="Reset all data"
                  description="Delete all playlists, liked songs, and settings"
                  control={
                    <TouchableOpacity
                      style={styles.settingsDangerButton}
                      onPress={handleResetAllData}
                    >
                      <Text style={styles.settingsDangerButtonText}>Reset</Text>
                    </TouchableOpacity>
                  }
                />
              </SettingsSection>

              <SettingsSection title="About">
                <SettingsRow label="Version" description="v0.1.0" control={<View />} />
              </SettingsSection>

              <SettingsSection title="Developer">
                <SettingsRow
                  label="Developer Mode"
                  description="Show debug logs"
                  control={
                    <Switch
                      value={settings.developerMode}
                      onValueChange={v => updateSetting('developerMode', v)}
                      trackColor={{ true: ACCENT, false: BORDER }}
                      thumbColor="#FFFFFF"
                    />
                  }
                />
              </SettingsSection>

              {settings.developerMode && (
                <SettingsSection title="Debug Logs">
                  <View style={styles.debugLogsButtonRow}>
                    <TouchableOpacity
                      style={styles.settingsSecondaryButton}
                      onPress={handleCopyLogs}
                    >
                      <Text style={styles.settingsSecondaryButtonText}>
                        Copy Logs
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.settingsSecondaryButton}
                      onPress={handleClearLogs}
                    >
                      <Text style={styles.settingsSecondaryButtonText}>
                        Clear
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.debugLogsBox} nestedScrollEnabled>
                    <Text style={styles.debugLogsText}>{debugLogsText}</Text>
                  </ScrollView>
                </SettingsSection>
              )}
            </ScrollView>
          </>
        )}
      </Animated.View>

      {nowPlaying && (
        <View
          style={[
            styles.miniPlayer,
            { bottom: tabBarHeight },
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
              animationsEnabled={settings.animationsEnabled}
            />
          </View>

          <View style={styles.transportRow}>
            <TouchableOpacity hitSlop={10} onPress={toggleShuffle}>
              <Shuffle size={18} color={shuffleOn ? ACCENT : '#FFFFFF'} />
            </TouchableOpacity>

            <TouchableOpacity hitSlop={10} onPress={goPrevious}>
              <SkipBack size={20} color="#FFFFFF" fill="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
              {playing ? (
                <Pause size={20} color={BG} fill={BG} />
              ) : (
                <Play size={20} color={BG} fill={BG} />
              )}
            </TouchableOpacity>

            <TouchableOpacity hitSlop={10} onPress={goNext}>
              <SkipForward size={20} color="#FFFFFF" fill="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity hitSlop={10} onPress={cycleRepeat}>
              {repeatMode === 'one' ? (
                <Repeat1 size={18} color={ACCENT} />
              ) : (
                <Repeat size={18} color={repeatMode === 'all' ? ACCENT : '#FFFFFF'} />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.volumeRow}>
            <Volume2 size={14} color={TEXT_DIM} />
            <View style={styles.volumeBarWrapper}>
              <DraggableBar value={volume} onChange={setVolume} height={3} />
            </View>
          </View>
        </View>
      )}

      <View
        style={styles.tabBar}
        onLayout={e => setTabBarHeight(e.nativeEvent.layout.height)}
      >
        <View style={[styles.tabBarRow, { paddingBottom: insets.bottom }]}>
          <TouchableOpacity style={styles.tabButton} onPress={() => changeView('search')}>
            <Search size={20} color={view === 'search' ? ACCENT : TEXT_DIM} />
            <Text
              style={[styles.tabLabel, view === 'search' && styles.tabLabelActive]}
            >
              Search
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => changeView('library')}
          >
            <Library
              size={20}
              color={
                view === 'library' || view === 'playlist' ? ACCENT : TEXT_DIM
              }
            />
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
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => changeView('settings')}
          >
            <SettingsIcon
              size={20}
              color={view === 'settings' ? ACCENT : TEXT_DIM}
            />
            <Text
              style={[
                styles.tabLabel,
                view === 'settings' && styles.tabLabelActive,
              ]}
            >
              Settings
            </Text>
          </TouchableOpacity>
        </View>
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
  heartHalfLeft: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  heartHalfRight: { position: 'absolute', top: 0, overflow: 'hidden' },
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
  playlistIcon: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: CARD,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  playlistSubtitle: { color: TEXT_DIM, fontSize: 12, marginTop: 2 },
  playlistDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 12,
  },
  playlistDetailTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', flex: 1 },
  settingsScroll: { paddingHorizontal: 20 },
  settingsSection: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  settingsSectionTitle: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    gap: 12,
  },
  settingsRowText: { flex: 1 },
  settingsRowLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  settingsRowDescription: { color: TEXT_DIM, fontSize: 12, marginTop: 2 },
  settingsDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BG,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
  },
  settingsDropdownText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  settingsDangerButton: {
    borderWidth: 1,
    borderColor: LIKE_RED,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  settingsDangerButtonText: { color: LIKE_RED, fontSize: 13, fontWeight: '700' },
  settingsSecondaryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  settingsSecondaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  debugLogsButtonRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  debugLogsBox: {
    maxHeight: 200,
    backgroundColor: BG,
    borderRadius: 8,
    padding: 10,
  },
  debugLogsText: { color: TEXT_DIM, fontSize: 11, fontFamily: 'monospace' },
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
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 4,
    gap: 8,
    marginHorizontal: 28,
  },
  volumeBarWrapper: { flex: 1 },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: CARD,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  tabBarRow: {
    flexDirection: 'row',
    paddingTop: 8,
  },
  tabButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
  },
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
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
  ChevronUp,
  Shuffle,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Repeat,
  Repeat1,
  Volume2,
  Settings as SettingsIcon,
  Download,
} from 'lucide-react-native';
import { searchVideos, getStreamUrl, extractPalette } from './NewPipeBridge';
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
import { STRINGS, LANGUAGE_LABELS, AppLanguage } from './Translations';
import { logDebug, getDebugLogs, clearDebugLogs } from './DebugLog';
import {
  DownloadedTrack,
  loadDownloads,
  saveDownloads,
} from './DownloadStore';
import { downloadTrackAudio, deleteDownloadedFile } from './DownloadManager';

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
// Minimum acceptable perceived brightness (0-255, ITU-R BT.601 formula) for
// a dynamic-theme background/player color. The app's text is white/light
// gray throughout, so a color extracted from very light album art would be
// unreadable - in that case the affected tier just falls back to its
// normal fixed color instead.
const MAX_BG_BRIGHTNESS = 140;

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

function toPlayableUrl(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function isColorDarkEnough(hex: string): boolean {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < MAX_BG_BRIGHTNESS;
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
  fillColor,
}: {
  value: number;
  onChange: (v: number) => void;
  height?: number;
  commitOnRelease?: boolean;
  fillColor?: string | null;
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
          style={[
            styles.barFill,
            { width: `${displayed * 100}%`, height },
            fillColor ? { backgroundColor: fillColor } : null,
          ]}
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
        onLikeToggle();
        setCracking(false);
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
  titleColor,
  children,
}: {
  title: string;
  titleColor?: string | null;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.settingsSection}>
      <Text style={[styles.settingsSectionTitle, titleColor ? { color: titleColor } : null]}>
        {title}
      </Text>
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
  const [playerExpanded, setPlayerExpanded] = useState(true);

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

  const [downloads, setDownloads] = useState<DownloadedTrack[]>([]);
  const [downloadsLoaded, setDownloadsLoaded] = useState(false);
  const [downloadingUrls, setDownloadingUrls] = useState<Set<string>>(
    new Set(),
  );

  const [palette, setPalette] = useState<string[] | null>(null);

  const t = STRINGS[settings.language];

  const playing = useIsPlaying();
  const progress = useProgress(0.5);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledEndRef = useRef(false);

  useEffect(() => {
    logDebug('App started');
    setupPlayer()
      .then(() => logDebug('Player initialized'))
      .catch(error => {
        const msg = error?.message ?? 'Audio player failed to initialize';
        setSearchError(msg);
        logDebug(`Player init failed: ${msg}`);
      });
  }, []);

  useEffect(() => {
    (async () => {
      const [liked, pls, loadedSettings, loadedDownloads] = await Promise.all([
        loadLikedSongs(),
        loadPlaylists(),
        loadSettings(),
        loadDownloads(),
      ]);
      setLikedSongs(liked);
      setPlaylists(pls);
      setSettings(loadedSettings);
      setDownloads(loadedDownloads);
      setStoreLoaded(true);
      setSettingsLoaded(true);
      setDownloadsLoaded(true);
      logDebug(
        `Loaded data: ${liked.length} liked, ${pls.length} playlists, ${loadedDownloads.length} downloads`,
      );
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
    if (!downloadsLoaded) return;
    saveDownloads(downloads);
  }, [downloads, downloadsLoaded]);

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

  // Re-extracts the dynamic theme's 3 colors whenever the playing track
  // changes (or the setting is toggled). Clears the palette entirely when
  // the setting is off or there's no usable thumbnail, so every consumer
  // of `palette` below naturally falls back to the fixed theme.
  useEffect(() => {
    if (!settings.dynamicTheme || !nowPlaying?.thumbnailUrl) {
      setPalette(null);
      return;
    }
    let cancelled = false;
    extractPalette(nowPlaying.thumbnailUrl)
      .then(colors => {
        if (cancelled) return;
        if (colors.length > 0) {
          setPalette(colors);
          logDebug(`Palette extracted: ${colors.join(', ')}`);
        } else {
          setPalette(null);
          logDebug('Palette extraction returned no colors');
        }
      })
      .catch(e => {
        if (cancelled) return;
        setPalette(null);
        logDebug(`Palette extraction failed: ${e?.message ?? e}`);
      });
    return () => {
      cancelled = true;
    };
  }, [nowPlaying?.url, settings.dynamicTheme]);

  const dynamicBg =
    palette && palette[0] && isColorDarkEnough(palette[0]) ? palette[0] : null;
  const dynamicPlayer =
    palette && palette[1] && isColorDarkEnough(palette[1]) ? palette[1] : null;
  const dynamicAccent = palette && palette[2] ? palette[2] : null;

  const goNextRef = useRef<() => void>(() => {});

  // Diagnostic only: @rntp/player has not been observed to emit
  // PlaybackQueueEnded in testing, so this no longer drives
  // autoplay/repeat-all - see the progress-based detector below instead.
  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
      logDebug('(diagnostic) PlaybackQueueEnded fired');
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackError, (error: any) => {
      logDebug(`Playback error: ${error?.message ?? JSON.stringify(error)}`);
    });
    return () => sub.remove();
  }, []);

  // Diagnostic only, same reasoning as PlaybackQueueEnded above.
  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackState, (data: any) => {
      logDebug(`(diagnostic) PlaybackState fired: ${data?.state ?? JSON.stringify(data)}`);
    });
    return () => sub.remove();
  }, []);

  // Real autoplay/repeat-all detection, based on the progress hook instead
  // of native queue-ended events (which don't fire in this player fork).
  useEffect(() => {
    if (!nowPlaying || progress.duration <= 0) return;

    const remaining = progress.duration - progress.position;

    if (remaining > 1.5) {
      handledEndRef.current = false;
      return;
    }

    if (handledEndRef.current) return;
    handledEndRef.current = true;

    if (repeatMode === 'one') {
      // Native RepeatMode.One already handles looping this track.
      return;
    }

    const willAdvance = repeatMode === 'all' || settings.autoplay;
    logDebug(
      `Track end reached (remaining=${remaining.toFixed(2)}s, repeat=${repeatMode}, autoplay=${settings.autoplay}) -> ${
        willAdvance ? 'advancing' : 'stopping'
      }`,
    );
    if (willAdvance) {
      goNextRef.current();
    }
  }, [progress.position, progress.duration, nowPlaying, repeatMode, settings.autoplay]);

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
      logDebug(`Searching: "${query}"`);
      try {
        const found = await searchVideos(query);
        setResults(found);
        logDebug(`Search results: ${found.length} for "${query}"`);
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
    logDebug(`View: ${view} -> ${newView}`);

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
    return likedSongs.some(t2 => t2.url === url);
  }

  function toggleLike(item: Track) {
    const wasLiked = isLiked(item.url);
    logDebug(`${wasLiked ? 'Unliked' : 'Liked'}: ${item.name}`);
    setLikedSongs(prev =>
      prev.some(t2 => t2.url === item.url)
        ? prev.filter(t2 => t2.url !== item.url)
        : [...prev, item],
    );
  }

  function isDownloaded(url: string): boolean {
    return downloads.some(d => d.url === url);
  }

  function getDownloadedTrack(url: string): DownloadedTrack | undefined {
    return downloads.find(d => d.url === url);
  }

  async function handleDownloadTrack(item: Track) {
    if (isDownloaded(item.url) || downloadingUrls.has(item.url)) return;

    logDebug(`Download started: ${item.name}`);
    setDownloadingUrls(prev => {
      const next = new Set(prev);
      next.add(item.url);
      return next;
    });

    try {
      const stream = await getStreamUrl(item.url, settings.audioQuality);
      const localPath = await downloadTrackAudio(
        stream.streamUrl,
        item.url,
        stream.format || 'm4a',
      );

      const entry: DownloadedTrack = {
        url: item.url,
        name: stream.title || item.name,
        thumbnailUrl: stream.thumbnailUrl || item.thumbnailUrl,
        localPath,
      };

      setDownloads(prev => [...prev.filter(d => d.url !== item.url), entry]);
      logDebug(`Downloaded (${settings.audioQuality}, .${stream.format}): ${item.name}`);
    } catch (e: any) {
      const msg = e?.message ?? 'Download failed';
      setSearchError(msg);
      logDebug(`Download failed for "${item.name}": ${msg}`);
    } finally {
      setDownloadingUrls(prev => {
        const next = new Set(prev);
        next.delete(item.url);
        return next;
      });
    }
  }

  async function handleRemoveDownload(url: string) {
    const entry = getDownloadedTrack(url);
    if (entry) {
      await deleteDownloadedFile(entry.localPath);
    }
    setDownloads(prev => prev.filter(d => d.url !== url));
    logDebug(`Removed download: ${url}`);
  }

  function addTrackToPlaylist(playlistId: string, track: Track) {
    const playlistName = playlists.find(p => p.id === playlistId)?.name ?? playlistId;
    logDebug(`Added "${track.name}" to playlist "${playlistName}"`);
    setPlaylists(prev =>
      prev.map(p =>
        p.id === playlistId
          ? {
              ...p,
              tracks: p.tracks.some(tr => tr.url === track.url)
                ? p.tracks
                : [...p.tracks, track],
            }
          : p,
      ),
    );
    setAddToPlaylistTarget(null);
  }

  function handleCreatePlaylist() {
    const name = newPlaylistName.trim() || t.myPlaylist;
    const id = makePlaylistId();
    const track = addToPlaylistTarget;
    logDebug(`Created playlist "${name}"${track ? ` with "${track.name}"` : ''}`);
    setPlaylists(prev => [...prev, { id, name, tracks: track ? [track] : [] }]);
    setNewPlaylistModalVisible(false);
    setAddToPlaylistTarget(null);
    setNewPlaylistName('');
  }

  function openPlaylistView(id: 'liked' | 'downloaded' | string) {
    if (id === 'liked') {
      logDebug('Opened playlist: Liked Songs');
      setViewingPlaylist({ id: 'liked', name: t.likedSongs, tracks: likedSongs });
    } else if (id === 'downloaded') {
      logDebug('Opened playlist: Downloaded');
      setViewingPlaylist({
        id: 'downloaded',
        name: t.downloaded,
        tracks: downloads.map(d => ({
          url: d.url,
          name: d.name,
          thumbnailUrl: d.thumbnailUrl,
        })),
      });
    } else {
      const pl = playlists.find(p => p.id === id);
      if (!pl) return;
      logDebug(`Opened playlist: ${pl.name}`);
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

    logDebug(`playAtIndex: "${item.name}" (index ${index}, newQueue=${isNewQueue})`);
    setLoadingTrack(item.url);
    try {
      const downloaded = getDownloadedTrack(item.url);

      let streamUrl: string;
      let title: string;
      let thumbnailUrl: string | undefined;

      if (downloaded) {
        streamUrl = toPlayableUrl(downloaded.localPath);
        title = downloaded.name;
        thumbnailUrl = downloaded.thumbnailUrl;
        logDebug(`Playing offline: ${title}`);
      } else {
        const stream = await getStreamUrl(item.url, settings.audioQuality);
        streamUrl = stream.streamUrl;
        title = stream.title || item.name;
        thumbnailUrl = stream.thumbnailUrl || item.thumbnailUrl;
      }

      await TrackPlayer.setMediaItems([
        {
          url: streamUrl,
          title,
          artist: 'YouTube',
          artworkUrl: thumbnailUrl,
        },
      ]);
      await TrackPlayer.play();

      setQueue(list);
      setQueueIndex(index);
      setNowPlaying(item);
      if (!downloaded) {
        logDebug(`Playing (${settings.audioQuality}): ${item.name}`);
      }

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
    logDebug('goNext called');
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
    logDebug('goPrevious called');
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
      logDebug(`Shuffle: ${next ? 'on' : 'off'}`);
      if (next && queue.length > 0) {
        const order = shuffledOrder(queue.length, queueIndex);
        setShuffleOrder(order);
        setShufflePos(0);
      }
      return next;
    });
  }

  function cycleRepeat() {
    setRepeatMode(mode => {
      const next = mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
      logDebug(`Repeat mode: ${next}`);
      return next;
    });
  }

  async function togglePlayPause() {
    logDebug(playing ? 'Pause pressed' : 'Play pressed');
    if (playing) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  }

  function togglePlayerExpanded() {
    setPlayerExpanded(v => {
      const next = !v;
      logDebug(`Player panel: ${next ? 'expanded' : 'collapsed'}`);
      return next;
    });
  }

  function updateSetting<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) {
    logDebug(`Setting changed: ${String(key)} = ${JSON.stringify(value)}`);
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  function cycleAudioQuality() {
    const order: AudioQuality[] = ['best', 'balanced', 'low'];
    const idx = order.indexOf(settings.audioQuality);
    updateSetting('audioQuality', order[(idx + 1) % order.length]);
  }

  function cycleLanguage() {
    const order: AppLanguage[] = ['en', 'uk'];
    const idx = order.indexOf(settings.language);
    updateSetting('language', order[(idx + 1) % order.length]);
  }

  function handleSeek(v: number) {
    logDebug(`Seek: ${formatTime(v * progress.duration)}`);
    TrackPlayer.seekTo(v * progress.duration);
  }

  function handleResetAllData() {
    Alert.alert(t.resetAlertTitle, t.resetAlertMessage, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.resetButton,
        style: 'destructive',
        onPress: async () => {
          await Promise.all(
            downloads.map(d => deleteDownloadedFile(d.localPath)),
          );
          await resetAllData();
          setLikedSongs([]);
          setPlaylists([]);
          setDownloads([]);
          setSettings(DEFAULT_SETTINGS);
          logDebug('All data reset by user');
        },
      },
    ]);
  }

  function handleCopyLogs() {
    const text = getDebugLogs();
    Clipboard.setString(text);
    Alert.alert(t.copiedTitle, t.copiedMessage);
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
          <ActivityIndicator color={dynamicAccent ?? ACCENT} size="small" />
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
              <MoreVertical
                size={18}
                color={isDownloaded(item.url) ? (dynamicAccent ?? ACCENT) : TEXT_DIM}
              />
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  const bottomPad =
    tabBarHeight + (nowPlaying ? (playerExpanded ? 150 : 64) : 10);

  return (
    <SafeAreaView
      style={[styles.safeArea, dynamicBg ? { backgroundColor: dynamicBg } : null]}
      edges={['top', 'left', 'right']}
    >
      <StatusBar barStyle="light-content" />

      <Animated.View style={{ flex: 1, opacity: viewOpacity }}>
        {view === 'search' && (
          <>
            <View style={styles.header}>
              <Text style={[styles.headerTitle, dynamicAccent ? { color: dynamicAccent } : null]}>
                {t.appTitle}
              </Text>
            </View>

            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder={t.searchPlaceholder}
                placeholderTextColor={TEXT_DIM}
                value={query}
                onChangeText={setQuery}
              />
            </View>

            {searching && (
              <ActivityIndicator style={styles.loadingIndicator} color={dynamicAccent ?? ACCENT} />
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
                  <Text style={styles.emptyText}>{t.noResults}</Text>
                ) : undefined
              }
            />
          </>
        )}

        {view === 'library' && (
          <>
            <View style={styles.header}>
              <Text style={[styles.headerTitle, dynamicAccent ? { color: dynamicAccent } : null]}>
                {t.yourLibrary}
              </Text>
            </View>
            <View style={styles.libraryHeaderRow}>
              <Text style={styles.libraryHeaderLabel}>{t.playlistsLabel}</Text>
              <TouchableOpacity onPress={() => setNewPlaylistModalVisible(true)}>
                <Text style={[styles.libraryAddButton, dynamicAccent ? { color: dynamicAccent } : null]}>
                  {t.newButton}
                </Text>
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
                <>
                  <TouchableOpacity
                    style={styles.playlistRow}
                    onPress={() => openPlaylistView('liked')}
                  >
                    <View style={styles.likedSongsIcon}>
                      <Heart size={20} color="#FFFFFF" fill="#FFFFFF" />
                    </View>
                    <View style={styles.trackInfo}>
                      <Text style={styles.trackTitle}>{t.likedSongs}</Text>
                      <Text style={styles.playlistSubtitle}>
                        {t.songsCount(likedSongs.length)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.playlistRow}
                    onPress={() => openPlaylistView('downloaded')}
                  >
                    <View
                      style={[
                        styles.downloadedIcon,
                        dynamicAccent ? { backgroundColor: dynamicAccent } : null,
                      ]}
                    >
                      <Download size={20} color="#FFFFFF" />
                    </View>
                    <View style={styles.trackInfo}>
                      <Text style={styles.trackTitle}>{t.downloaded}</Text>
                      <Text style={styles.playlistSubtitle}>
                        {t.songsCount(downloads.length)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.playlistRow}
                  onPress={() => openPlaylistView(item.id)}
                >
                  <View style={styles.playlistIcon}>
                    <Music size={20} color={dynamicAccent ?? ACCENT} />
                  </View>
                  <View style={styles.trackInfo}>
                    <Text style={styles.trackTitle}>{item.name}</Text>
                    <Text style={styles.playlistSubtitle}>
                      {t.songsCount(item.tracks.length)}
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
              keyExtractor={tr => tr.url}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: bottomPad },
              ]}
              renderItem={({ item, index }) =>
                renderTrackRow(item, index, viewingPlaylist.tracks)
              }
              ListEmptyComponent={
                <Text style={styles.emptyText}>{t.noSongsYet}</Text>
              }
            />
          </>
        )}

        {view === 'settings' && (
          <>
            <View style={styles.header}>
              <Text style={[styles.headerTitle, dynamicAccent ? { color: dynamicAccent } : null]}>
                {t.settingsTitle}
              </Text>
            </View>
            <ScrollView
              contentContainerStyle={[
                styles.settingsScroll,
                { paddingBottom: bottomPad },
              ]}
            >
              <SettingsSection title={t.sectionPlayback} titleColor={dynamicAccent}>
                <SettingsRow
                  label={t.autoplay}
                  description={t.autoplayDesc}
                  control={
                    <Switch
                      value={settings.autoplay}
                      onValueChange={v => updateSetting('autoplay', v)}
                      trackColor={{ true: dynamicAccent ?? ACCENT, false: BORDER }}
                      thumbColor="#FFFFFF"
                    />
                  }
                />
                <SettingsRow
                  label={t.audioQuality}
                  description={t.audioQualityDesc}
                  control={
                    <TouchableOpacity
                      style={styles.settingsDropdown}
                      onPress={cycleAudioQuality}
                    >
                      <Text style={styles.settingsDropdownText}>
                        {settings.audioQuality === 'best'
                          ? t.qualityBest
                          : settings.audioQuality === 'balanced'
                          ? t.qualityBalanced
                          : t.qualityLow}
                      </Text>
                      <ChevronDown size={14} color={TEXT_DIM} />
                    </TouchableOpacity>
                  }
                />
              </SettingsSection>

              <SettingsSection title={t.sectionAppearance} titleColor={dynamicAccent}>
                <SettingsRow
                  label={t.animations}
                  description={t.animationsDesc}
                  control={
                    <Switch
                      value={settings.animationsEnabled}
                      onValueChange={v => updateSetting('animationsEnabled', v)}
                      trackColor={{ true: dynamicAccent ?? ACCENT, false: BORDER }}
                      thumbColor="#FFFFFF"
                    />
                  }
                />
                <SettingsRow
                  label={t.languageLabel}
                  description={t.languageDesc}
                  control={
                    <TouchableOpacity
                      style={styles.settingsDropdown}
                      onPress={cycleLanguage}
                    >
                      <Text style={styles.settingsDropdownText}>
                        {LANGUAGE_LABELS[settings.language]}
                      </Text>
                      <ChevronDown size={14} color={TEXT_DIM} />
                    </TouchableOpacity>
                  }
                />
                <SettingsRow
                  label={t.dynamicTheme}
                  description={t.dynamicThemeDesc}
                  control={
                    <Switch
                      value={settings.dynamicTheme}
                      onValueChange={v => updateSetting('dynamicTheme', v)}
                      trackColor={{ true: ACCENT, false: BORDER }}
                      thumbColor="#FFFFFF"
                    />
                  }
                />
              </SettingsSection>

              <SettingsSection title={t.sectionData} titleColor={dynamicAccent}>
                <SettingsRow
                  label={t.resetAllData}
                  description={t.resetAllDataDesc}
                  control={
                    <TouchableOpacity
                      style={styles.settingsDangerButton}
                      onPress={handleResetAllData}
                    >
                      <Text style={styles.settingsDangerButtonText}>{t.resetButton}</Text>
                    </TouchableOpacity>
                  }
                />
              </SettingsSection>

              <SettingsSection title={t.sectionAbout} titleColor={dynamicAccent}>
                <SettingsRow label={t.version} description="v0.1.0" control={<View />} />
              </SettingsSection>

              <SettingsSection title={t.sectionDeveloper} titleColor={dynamicAccent}>
                <SettingsRow
                  label={t.developerMode}
                  description={t.developerModeDesc}
                  control={
                    <Switch
                      value={settings.developerMode}
                      onValueChange={v => updateSetting('developerMode', v)}
                      trackColor={{ true: dynamicAccent ?? ACCENT, false: BORDER }}
                      thumbColor="#FFFFFF"
                    />
                  }
                />
              </SettingsSection>

              {settings.developerMode && (
                <SettingsSection title={t.sectionDebugLogs} titleColor={dynamicAccent}>
                  <View style={styles.debugLogsButtonRow}>
                    <TouchableOpacity
                      style={styles.settingsSecondaryButton}
                      onPress={handleCopyLogs}
                    >
                      <Text style={styles.settingsSecondaryButtonText}>
                        {t.copyLogs}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.settingsSecondaryButton}
                      onPress={handleClearLogs}
                    >
                      <Text style={styles.settingsSecondaryButtonText}>
                        {t.clearLogs}
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
            !playerExpanded && styles.miniPlayerCollapsedPadding,
            dynamicPlayer ? { backgroundColor: dynamicPlayer } : null,
          ]}
        >
          {playerExpanded && (
            <>
              <View style={styles.progressBarWrapper}>
                <DraggableBar
                  value={
                    progress.duration > 0
                      ? progress.position / progress.duration
                      : 0
                  }
                  onChange={handleSeek}
                  height={3}
                  commitOnRelease
                  fillColor={dynamicAccent}
                />
              </View>

              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTime(progress.position)}</Text>
                <Text style={styles.timeText}>{formatTime(progress.duration)}</Text>
              </View>
            </>
          )}

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
            {playerExpanded && (
              <AnimatedHeart
                liked={isLiked(nowPlaying.url)}
                onLikeToggle={() => toggleLike(nowPlaying)}
                animationsEnabled={settings.animationsEnabled}
              />
            )}
            <TouchableOpacity
              hitSlop={10}
              onPress={togglePlayerExpanded}
              style={styles.miniPlayerChevron}
            >
              {playerExpanded ? (
                <ChevronDown size={20} color={TEXT_DIM} />
              ) : (
                <ChevronUp size={20} color={TEXT_DIM} />
              )}
            </TouchableOpacity>
            {!playerExpanded && (
              <TouchableOpacity
                style={styles.collapsedPlayButton}
                onPress={togglePlayPause}
              >
                {playing ? (
                  <Pause size={16} color={BG} fill={BG} />
                ) : (
                  <Play size={16} color={BG} fill={BG} />
                )}
              </TouchableOpacity>
            )}
          </View>

          {playerExpanded && (
            <>
              <View style={styles.transportRow}>
                <TouchableOpacity hitSlop={10} onPress={toggleShuffle}>
                  <Shuffle size={18} color={shuffleOn ? (dynamicAccent ?? ACCENT) : '#FFFFFF'} />
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
                    <Repeat1 size={18} color={dynamicAccent ?? ACCENT} />
                  ) : (
                    <Repeat
                      size={18}
                      color={repeatMode === 'all' ? (dynamicAccent ?? ACCENT) : '#FFFFFF'}
                    />
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.volumeRow}>
                <Volume2 size={14} color={TEXT_DIM} />
                <View style={styles.volumeBarWrapper}>
                  <DraggableBar
                    value={volume}
                    onChange={setVolume}
                    height={3}
                    fillColor={dynamicAccent}
                  />
                </View>
              </View>
            </>
          )}
        </View>
      )}

      <View
        style={[
          styles.tabBar,
          dynamicPlayer ? { backgroundColor: dynamicPlayer } : null,
        ]}
        onLayout={e => setTabBarHeight(e.nativeEvent.layout.height)}
      >
        <View style={[styles.tabBarRow, { paddingBottom: insets.bottom }]}>
          <TouchableOpacity style={styles.tabButton} onPress={() => changeView('search')}>
            <Search size={20} color={view === 'search' ? (dynamicAccent ?? ACCENT) : TEXT_DIM} />
            <Text
              style={[
                styles.tabLabel,
                view === 'search' && styles.tabLabelActive,
                view === 'search' && dynamicAccent ? { color: dynamicAccent } : null,
              ]}
            >
              {t.tabSearch}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => changeView('library')}
          >
            <Library
              size={20}
              color={
                view === 'library' || view === 'playlist'
                  ? (dynamicAccent ?? ACCENT)
                  : TEXT_DIM
              }
            />
            <Text
              style={[
                styles.tabLabel,
                (view === 'library' || view === 'playlist') && styles.tabLabelActive,
                (view === 'library' || view === 'playlist') && dynamicAccent
                  ? { color: dynamicAccent }
                  : null,
              ]}
            >
              {t.tabLibrary}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => changeView('settings')}
          >
            <SettingsIcon
              size={20}
              color={view === 'settings' ? (dynamicAccent ?? ACCENT) : TEXT_DIM}
            />
            <Text
              style={[
                styles.tabLabel,
                view === 'settings' && styles.tabLabelActive,
                view === 'settings' && dynamicAccent ? { color: dynamicAccent } : null,
              ]}
            >
              {t.tabSettings}
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
            <Text style={styles.modalTitle}>{t.trackOptions}</Text>

            <TouchableOpacity
              style={styles.modalActionRow}
              onPress={() => {
                if (!addToPlaylistTarget) return;
                if (isDownloaded(addToPlaylistTarget.url)) {
                  handleRemoveDownload(addToPlaylistTarget.url);
                } else {
                  handleDownloadTrack(addToPlaylistTarget);
                }
              }}
              disabled={
                !!addToPlaylistTarget &&
                downloadingUrls.has(addToPlaylistTarget.url)
              }
            >
              {addToPlaylistTarget &&
              downloadingUrls.has(addToPlaylistTarget.url) ? (
                <ActivityIndicator size="small" color={dynamicAccent ?? ACCENT} />
              ) : (
                <Download
                  size={18}
                  color={
                    addToPlaylistTarget && isDownloaded(addToPlaylistTarget.url)
                      ? (dynamicAccent ?? ACCENT)
                      : '#FFFFFF'
                  }
                />
              )}
              <Text style={styles.modalActionText}>
                {addToPlaylistTarget && downloadingUrls.has(addToPlaylistTarget.url)
                  ? t.downloading
                  : addToPlaylistTarget && isDownloaded(addToPlaylistTarget.url)
                  ? t.removeDownload
                  : t.downloadForOffline}
              </Text>
            </TouchableOpacity>

            <Text style={styles.modalSubheading}>{t.addToPlaylist}</Text>
            <ScrollView style={styles.modalScroll}>
              {playlists.length === 0 && (
                <Text style={styles.modalEmptyText}>{t.noPlaylistsYet}</Text>
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
              <Text style={[styles.modalNewPlaylistText, dynamicAccent ? { color: dynamicAccent } : null]}>
                {t.newPlaylistButton}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setAddToPlaylistTarget(null)}
            >
              <Text style={styles.modalCancelText}>{t.cancel}</Text>
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
            <Text style={styles.modalTitle}>{t.createPlaylistTitle}</Text>
            <TextInput
              style={styles.modalInput}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              placeholder={t.myPlaylist}
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
                <Text style={styles.modalCancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalOkButton, dynamicAccent ? { backgroundColor: dynamicAccent } : null]}
                onPress={handleCreatePlaylist}
              >
                <Text style={styles.modalOkText}>{t.createButton}</Text>
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
  downloadedIcon: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: ACCENT,
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
  miniPlayerCollapsedPadding: { paddingBottom: 8 },
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
  miniPlayerChevron: { marginLeft: 8 },
  collapsedPlayButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
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
  modalActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  modalActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  modalSubheading: {
    color: TEXT_DIM,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 4,
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
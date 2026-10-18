/**
 * Snowify Mobile
 * @format
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
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
  PlayerCommand,
  RepeatMode,
  useIsPlaying,
  useProgress,
} from '@rntp/player';
import type { MediaItem } from '@rntp/player';
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
import { searchVideos, getStreamUrl, extractPalette, PaletteSwatch } from './NewPipeBridge';
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
import {
  loadSession,
  saveSession,
  loadPlaybackPosition,
  savePlaybackPosition,
} from './SessionStore';

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
// Lightness band (HSL, 0-1) the accent color gets clamped into. The accent
// is used as TEXT and ICON color drawn on top of the dark background/player
// tiers, so unlike those two it must never be allowed to go very dark -
// album art that's naturally dark and monochrome can otherwise produce an
// accent nearly identical to the background it sits on.
const ACCENT_MIN_LIGHTNESS = 0.5;
const ACCENT_MAX_LIGHTNESS = 0.78;
const ACCENT_MIN_SATURATION = 0.35;
// How far the raw dominant color is mixed toward black before becoming the
// whole-app background - matches desktop Snowify's Album Art Palette
// plugin. Darkening (rather than rejecting light colors outright) keeps
// bright/neon album art from flooding the app in a solid light wash, while
// mathematically guaranteeing the result is always dark enough for the
// app's white/light-gray text (worst case, pure white mixed 62% toward
// black still lands under perceived-brightness ~97 of 255).
const BG_DARKEN = 0.62;
// How far the medium "panel" color (mini player + tab bar) is mixed toward
// black before it's blended into the background - same idea as BG_DARKEN,
// applied to the 2nd-ranked color.
const PANEL_COLOR_DARKEN = 0.45;
// Resolved stream URLs are reused for this long (YouTube stream URLs stay
// valid for hours; this is deliberately conservative).
const RESOLVE_CACHE_TTL_MS = 15 * 60 * 1000;
const RESOLVE_CACHE_MAX = 10;
// If the native queue is expected to move on by itself but the transition
// event does not arrive in time, fall back to advancing from JS.
const END_WATCHDOG_MS = 4000;
const SKIP_WATCHDOG_MS = 2500;

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);

let playerSetupDone = false;

// In @rntp/player, setupPlayer() is synchronous (returns void). Setup is
// marked done immediately so that a problem in the optional remote-control
// configuration below can never block the volume/repeat-mode effects.
function setupPlayer() {
  if (playerSetupDone) return;
  TrackPlayer.setupPlayer({
    contentType: 'music',
    handleAudioBecomingNoisy: true,
    android: { wakeMode: 'network', taskRemovedBehavior: 'stop' },
  });
  playerSetupDone = true;

  // Lock screen / notification controls. Play/pause and seeking are handled
  // natively. Next/Previous are routed to JS (see the Event.RemoteNext and
  // Event.RemotePrevious listeners in AppContent) because the real queue
  // (shuffle, repeat, lists) lives in React state.
  try {
    TrackPlayer.setCommands({
      capabilities: [
        PlayerCommand.PlayPause,
        PlayerCommand.Next,
        PlayerCommand.Previous,
        PlayerCommand.Seek,
      ],
      handling: 'hybrid',
      perCommandHandling: {
        [PlayerCommand.Next]: 'js',
        [PlayerCommand.Previous]: 'js',
      },
    });
    logDebug('Remote controls configured (hybrid: next/previous handled in JS)');
  } catch (e: any) {
    logDebug(`setCommands failed: ${e?.message ?? e}`);
  }
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

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

// Blends `hex` toward `towardHex` by `amount` (0 = unchanged, 1 = fully
// `towardHex`), in plain RGB space - same technique desktop's palette
// plugin uses to darken colors before using them as backgrounds.
function mixColor(hex: string, towardHex: string, amount: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const [r, g, b] = hexToRgb(hex);
  const [tr, tg, tb] = hexToRgb(towardHex);
  return rgbToHex(r + (tr - r) * amount, g + (tg - g) * amount, b + (tb - b) * amount);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  const toHex = (v: number) => {
    const n = Math.round((v + m) * 255);
    return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// Keeps an accent color's hue (so it still reads as "from this album art")
// but clamps its lightness/saturation into a legible range, since a color
// extracted straight from the image's palette can be nearly as dark as the
// background it's drawn on top of - making accent-colored text and icons
// effectively invisible.
function normalizeAccentColor(hex: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const [h, s, l] = hexToHsl(hex);
  const clampedL = clamp(l, ACCENT_MIN_LIGHTNESS, ACCENT_MAX_LIGHTNESS);
  const clampedS = Math.max(ACCENT_MIN_SATURATION, s);
  return hslToHex(h, clampedS, clampedL);
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

// A copy of the playback-related React state that code running outside a
// render (native event listeners, async prefetches, timers) can read.
type PlaybackSnapshot = {
  queue: Track[];
  queueIndex: number;
  shuffleOn: boolean;
  shuffleOrder: number[];
  shufflePos: number;
  repeatMode: RepeatSetting;
  autoplay: boolean;
  audioQuality: AudioQuality;
  downloads: DownloadedTrack[];
};

type NextTarget = { index: number; shufflePos: number | null };

// Which track would come after the current one, without changing anything.
// Mirrors goNextViaReplace. Returns null when nothing should be pre-queued:
// not enough tracks, autoplay off (and repeat not 'all'), or the wrap-around
// of a shuffled order (which needs a freshly generated order, so it is left
// to the regular JS advance).
function peekNext(s: PlaybackSnapshot): NextTarget | null {
  if (s.queue.length < 2) return null;
  if (!(s.repeatMode === 'all' || s.autoplay)) return null;

  if (s.shuffleOn) {
    const nextPos = s.shufflePos + 1;
    if (nextPos >= s.shuffleOrder.length) return null;
    const index = s.shuffleOrder[nextPos];
    return index === s.queueIndex ? null : { index, shufflePos: nextPos };
  }

  let nextIndex = s.queueIndex + 1;
  if (nextIndex >= s.queue.length) {
    if (s.repeatMode === 'off') return null;
    nextIndex = 0;
  }
  return nextIndex === s.queueIndex ? null : { index: nextIndex, shufflePos: null };
}

// Smoothly fades a style color from whatever it was to `targetColor`
// whenever `targetColor` changes, using core Animated's built-in color
// interpolation (it auto-detects color strings in an interpolate()
// outputRange). This must run with useNativeDriver: false since color
// interpolation is JS-driven, not native-driver-eligible - fine here since
// it only fires on song changes, not continuously. Returns an
// AnimatedInterpolation that can be dropped straight into a style prop on
// Animated.View / Animated.Text (NOT a plain View/Text, and not a
// non-style prop like an icon's `color`).
function useAnimatedColor(targetColor: string, duration = 450) {
  const progress = useRef(new Animated.Value(1)).current;
  const fromColorRef = useRef(targetColor);
  const toColorRef = useRef(targetColor);
  const [, bump] = useState(0);

  useEffect(() => {
    if (targetColor === toColorRef.current) return;
    fromColorRef.current = toColorRef.current;
    toColorRef.current = targetColor;
    bump(n => n + 1);
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration,
      useNativeDriver: false,
    }).start();
  }, [targetColor, duration, progress]);

  return progress.interpolate({
    inputRange: [0, 1],
    outputRange: [fromColorRef.current, toColorRef.current],
  });
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
  fillColor?: string;
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
  titleColor?: string;
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
  const [viewingPlaylistId, setViewingPlaylistId] = useState<string | null>(null);

  const [addToPlaylistTarget, setAddToPlaylistTarget] =
    useState<Track | null>(null);
  const [newPlaylistModalVisible, setNewPlaylistModalVisible] =
    useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [playlistActionsTarget, setPlaylistActionsTarget] = useState<Playlist | null>(null);
  const [renamePlaylistTarget, setRenamePlaylistTarget] = useState<Playlist | null>(null);
  const [renamePlaylistNameInput, setRenamePlaylistNameInput] = useState('');

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [debugLogsText, setDebugLogsText] = useState('');

  const [downloads, setDownloads] = useState<DownloadedTrack[]>([]);
  const [downloadsLoaded, setDownloadsLoaded] = useState(false);
  const [downloadingUrls, setDownloadingUrls] = useState<Set<string>>(
    new Set(),
  );

  const [palette, setPalette] = useState<PaletteSwatch[] | null>(null);

  const t = STRINGS[settings.language];

  const playing = useIsPlaying();
  const progress = useProgress(0.5);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledEndRef = useRef(false);

  // --- Native-queue bookkeeping -------------------------------------------
  // The native player's queue is kept as either [current] or
  // [current, next]. Having a "next" item queued is what makes Android show
  // a Next button on the lock screen, and lets the player move between
  // tracks without a gap.
  const playbackStateRef = useRef<PlaybackSnapshot>({
    queue: [],
    queueIndex: 0,
    shuffleOn: false,
    shuffleOrder: [],
    shufflePos: 0,
    repeatMode: 'off',
    autoplay: true,
    audioQuality: 'best',
    downloads: [],
  });
  playbackStateRef.current = {
    queue,
    queueIndex,
    shuffleOn,
    shuffleOrder,
    shufflePos,
    repeatMode,
    autoplay: settings.autoplay,
    audioQuality: settings.audioQuality,
    downloads,
  };
  // URL (our track key, also used as the native mediaId) of the track the
  // player is currently on, as far as JS knows.
  const expectedUrlRef = useRef<string | null>(null);
  // The track currently sitting in the native queue after the current one.
  const nextQueuedRef = useRef<{
    index: number;
    shufflePos: number | null;
    url: string;
  } | null>(null);
  const prefetchTokenRef = useRef(0);
  const prefetchingUrlRef = useRef<string | null>(null);
  const playRequestRef = useRef(0);
  const resolvedCacheRef = useRef<Map<string, { item: MediaItem; at: number }>>(
    new Map(),
  );
  const endWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Resume on relaunch ---------------------------------------------------
  // Queue/shuffle/repeat are saved (debounced) whenever they change. Position
  // and volume are saved separately every ~10 s while playing, on pause, and
  // when the app leaves the foreground. On startup the last track is loaded
  // PAUSED at the saved position.
  const [sessionReady, setSessionReady] = useState(false);
  const sessionReadyRef = useRef(false);
  sessionReadyRef.current = sessionReady;
  const sessionRestoreStartedRef = useRef(false);
  // A saved position still waiting to be applied once the restored track is
  // ready to play.
  const pendingSeekRef = useRef<{ url: string; position: number } | null>(null);
  const progressRef = useRef({ position: 0, duration: 0 });
  progressRef.current = { position: progress.position, duration: progress.duration };
  const volumeRef = useRef(1);
  volumeRef.current = volume;

  function saveProgressNow() {
    if (!sessionReadyRef.current) return;
    if (playbackStateRef.current.queue.length === 0) return;
    const pending = pendingSeekRef.current;
    const url = pending ? pending.url : expectedUrlRef.current;
    if (!url) return;
    const { position, duration } = progressRef.current;
    let safePosition = pending ? pending.position : Math.max(0, position);
    // Within 5 s of the end: save 0, so a restored session never lands in
    // the end-of-track window (which would trigger an instant advance).
    if (!pending && duration > 0 && position > duration - 5) safePosition = 0;
    void savePlaybackPosition({ url, position: safePosition, volume: volumeRef.current });
  }

  // Restore the last session once settings and downloads are loaded.
  useEffect(() => {
    if (!settingsLoaded || !downloadsLoaded) return;
    if (sessionRestoreStartedRef.current) return;
    sessionRestoreStartedRef.current = true;

    (async () => {
      try {
        if (!playerSetupDone) {
          logDebug('Session restore skipped: player is not set up');
          return;
        }
        const saved = await loadSession();
        if (!saved) {
          logDebug('Session restore: nothing saved');
          return;
        }
        const track = saved.queue[saved.queueIndex];
        const savedPos = await loadPlaybackPosition();
        const startAt = savedPos && savedPos.url === track.url ? savedPos.position : 0;
        const restoredVolume = savedPos ? clamp(savedPos.volume, 0, 1) : 1;

        const orderValid =
          saved.shuffleOrder.length === saved.queue.length &&
          saved.shuffleOrder[saved.shufflePos] === saved.queueIndex;
        const order = orderValid
          ? saved.shuffleOrder
          : shuffledOrder(saved.queue.length, saved.queueIndex);
        const orderPos = orderValid ? saved.shufflePos : 0;

        let item: MediaItem | null = null;
        try {
          item = (await resolveMediaItem(track)).item;
        } catch (e: any) {
          logDebug(
            `Session restore: could not load "${track.name}" (${e?.message ?? e}); showing it unloaded`,
          );
        }

        if (playRequestRef.current !== 0 || expectedUrlRef.current) {
          logDebug('Session restore skipped: playback was already started');
          return;
        }

        if (startAt > 1) pendingSeekRef.current = { url: track.url, position: startAt };
        if (item) {
          expectedUrlRef.current = track.url;
          TrackPlayer.setMediaItems([item]);
          if (startAt > 1) {
            try {
              // no seek before the player is ready: the saved position is applied by the ready listener
            } catch {
              // the PlaybackStateChanged 'ready' listener below seeks again
            }
          }
        }

        setQueue(saved.queue);
        setQueueIndex(saved.queueIndex);
        setShuffleOn(saved.shuffleOn);
        setShuffleOrder(order);
        setShufflePos(orderPos);
        setRepeatMode(saved.repeatMode);
        setVolume(restoredVolume);
        setNowPlaying(track);
        logDebug(
          `Session restored: "${track.name}" at ${formatTime(startAt)} (paused, ${saved.queue.length} in queue, loaded=${!!item})`,
        );
      } catch (e: any) {
        logDebug(`Session restore failed: ${e?.message ?? e}`);
      } finally {
        setSessionReady(true);
      }
    })();
  }, [settingsLoaded, downloadsLoaded]);

  // Save queue/shuffle/repeat state whenever it changes (debounced).
  useEffect(() => {
    if (!sessionReady || queue.length === 0) return;
    const id = setTimeout(() => {
      void saveSession({ queue, queueIndex, shuffleOn, shuffleOrder, shufflePos, repeatMode });
    }, 400);
    return () => clearTimeout(id);
  }, [sessionReady, queue, queueIndex, shuffleOn, shuffleOrder, shufflePos, repeatMode]);

  // Volume drags change `volume` many times a second, so save it debounced.
  useEffect(() => {
    if (!sessionReady) return;
    const id = setTimeout(saveProgressNow, 600);
    return () => clearTimeout(id);
  }, [volume, sessionReady]);

  // Position: on pause, and every 10 s while playing.
  useEffect(() => {
    if (!playing) {
      saveProgressNow();
      return;
    }
    const id = setInterval(saveProgressNow, 10000);
    return () => clearInterval(id);
  }, [playing]);

  // Position: when the app goes to the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') saveProgressNow();
    });
    return () => sub.remove();
  }, []);

  // Applies the saved position once the restored track reports 'ready'.
  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackStateChanged, (data: any) => {
      const pending = pendingSeekRef.current;
      if (!pending || data?.state !== 'ready') return;
      if (expectedUrlRef.current !== pending.url) {
        // The user started a different track: the saved position is obsolete.
        if (expectedUrlRef.current) pendingSeekRef.current = null;
        return;
      }
      pendingSeekRef.current = null;
      try {
        TrackPlayer.seekTo(pending.position);
        logDebug(`Restored position: ${formatTime(pending.position)}`);
        void ensureNextQueued();
      } catch (e: any) {
        logDebug(`Could not restore position: ${e?.message ?? e}`);
        void ensureNextQueued();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    logDebug('App started');
    try {
      setupPlayer();
      logDebug('Player initialized');
    } catch (error: any) {
      const msg = error?.message ?? 'Audio player failed to initialize';
      setSearchError(msg);
      logDebug(`Player init failed: ${msg}`);
    }
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

  // Re-extracts the dynamic theme's palette whenever the playing track
  // changes (or the setting is toggled). Clears it entirely when the
  // setting is off or there's no usable thumbnail, so every consumer of
  // `palette` below naturally falls back to the fixed theme.
  useEffect(() => {
    if (!settings.dynamicTheme || !nowPlaying?.thumbnailUrl) {
      setPalette(null);
      return;
    }
    let cancelled = false;
    extractPalette(nowPlaying.thumbnailUrl)
      .then(swatches => {
        if (cancelled) return;
        if (swatches.length > 0) {
          setPalette(swatches);
          logDebug(
            `Palette extracted: ${swatches
              .map(s => `${s.color}(${(s.share * 100).toFixed(0)}%)`)
              .join(', ')}`,
          );
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

  // Tier 1 - whole-app background: the dominant color, always darkened
  // toward black (never used raw, never rejected) so it's guaranteed
  // legible under white/light-gray text regardless of how light or
  // saturated the original album art was.
  const dynamicBg = palette?.[0]
    ? mixColor(palette[0].color, '#000000', BG_DARKEN)
    : null;

  // Tier 2 - mini player + tab bar: blended FROM the background TOWARD a
  // darkened version of the 2nd color, weighted by how much that color
  // actually covers the art (share). A color that's a tiny sliver only
  // tints the panel faintly; a color that dominates the art pulls the
  // panel strongly toward it.
  const dynamicPlayer = (() => {
    if (!dynamicBg || !palette?.[1]) return null;
    const intensity = clamp(palette[1].share * 2.4, 0.28, 1);
    const panelDark = mixColor(palette[1].color, '#000000', PANEL_COLOR_DARKEN);
    return mixColor(dynamicBg, panelDark, intensity);
  })();

  // Tier 3 - accent text/icons: the 3rd color, clamped to a legible
  // lightness/saturation band regardless of its raw extracted value.
  const dynamicAccent = palette?.[2] ? normalizeAccentColor(palette[2].color) : null;

  const resolvedBg = dynamicBg ?? BG;
  const resolvedPlayer = dynamicPlayer ?? CARD;
  const resolvedAccent = dynamicAccent ?? ACCENT;

  // Smooth cross-fades for the few elements that get full Animated-color
  // treatment (see the file-level note on useAnimatedColor for scope).
  const animatedBg = useAnimatedColor(resolvedBg);
  const animatedPlayerColor = useAnimatedColor(resolvedPlayer);
  const animatedAccentColor = useAnimatedColor(resolvedAccent);

  // Live-derived name/tracks for whichever playlist is currently open, so
  // renaming or removing a track reflects immediately without needing to
  // re-open the screen. 'liked' and 'downloaded' are virtual playlists.
  const viewingPlaylistName =
    viewingPlaylistId === 'liked'
      ? t.likedSongs
      : viewingPlaylistId === 'downloaded'
      ? t.downloaded
      : playlists.find(p => p.id === viewingPlaylistId)?.name ?? '';

  const viewingPlaylistTracks: Track[] =
    viewingPlaylistId === 'liked'
      ? likedSongs
      : viewingPlaylistId === 'downloaded'
      ? downloads.map(d => ({ url: d.url, name: d.name, thumbnailUrl: d.thumbnailUrl }))
      : playlists.find(p => p.id === viewingPlaylistId)?.tracks ?? [];

  // Only real user playlists (not the virtual Liked/Downloaded ones) can
  // have a track removed from them.
  const removablePlaylistId =
    view === 'playlist' &&
    viewingPlaylistId &&
    viewingPlaylistId !== 'liked' &&
    viewingPlaylistId !== 'downloaded'
      ? viewingPlaylistId
      : null;

  const goNextRef = useRef<() => void>(() => {});
  const goPreviousRef = useRef<() => void>(() => {});

  // Lock screen / notification Next and Previous. These only fire because
  // setupPlayer() configures those two commands as 'js' (hybrid handling);
  // everything else on the lock screen is handled natively. The refs always
  // point at the latest goNext/goPrevious, so this only needs registering
  // once.
  useEffect(() => {
    const nextSub = TrackPlayer.addEventListener(Event.RemoteNext, () => {
      logDebug('Remote next pressed (lock screen/notification)');
      goNextRef.current();
    });
    const prevSub = TrackPlayer.addEventListener(Event.RemotePrevious, () => {
      logDebug('Remote previous pressed (lock screen/notification)');
      goPreviousRef.current();
    });
    return () => {
      nextSub.remove();
      prevSub.remove();
    };
  }, []);

  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackError, (error: any) => {
      logDebug(`Playback error: ${error?.message ?? JSON.stringify(error)}`);
    });
    return () => sub.remove();
  }, []);

  // Diagnostic: logs every player state change.
  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.PlaybackStateChanged, (data: any) => {
      logDebug(`Playback state changed: ${JSON.stringify(data)}`);
    });
    return () => sub.remove();
  }, []);

  // The native player moved to another queue item. Transitions we caused
  // ourselves (a new track started via playAtIndex) already match
  // expectedUrlRef and are ignored. Anything else is the player advancing
  // on its own to the prefetched next track (or a native skipToNext), so
  // React state is brought in line with it.
  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.MediaItemTransition, (e: any) => {
      const url: string | undefined = e?.item?.mediaId;
      if (!url) return;
      if (url === expectedUrlRef.current) return;
      if (pendingSeekRef.current) {
        logDebug(`Transition while a restored position was pending: ${JSON.stringify({ index: e?.index, id: e?.item?.mediaId })}`);
      }

      // Guard against a late event for an item that is no longer current.
      try {
        const active = TrackPlayer.getActiveMediaItem();
        if (active?.mediaId && active.mediaId !== url) return;
      } catch {
        // ignore - fall through and trust the event
      }

      const s = playbackStateRef.current;
      const queued = nextQueuedRef.current;
      const idx =
        queued && queued.url === url
          ? queued.index
          : s.queue.findIndex(tr => tr.url === url);
      if (idx < 0 || !s.queue[idx]) {
        logDebug(`Native transition to an unknown item (${url}); ignoring`);
        return;
      }

      logDebug(`Native advance to "${s.queue[idx].name}" (index ${idx})`);
      if (endWatchdogRef.current) {
        clearTimeout(endWatchdogRef.current);
        endWatchdogRef.current = null;
      }
      if (skipWatchdogRef.current) {
        clearTimeout(skipWatchdogRef.current);
        skipWatchdogRef.current = null;
      }
      expectedUrlRef.current = url;
      nextQueuedRef.current = null;
      prefetchTokenRef.current++;
      prefetchingUrlRef.current = null;

      setQueueIndex(idx);
      setNowPlaying(s.queue[idx]);
      if (s.shuffleOn) {
        const pos =
          queued && queued.url === url && queued.shufflePos !== null
            ? queued.shufflePos
            : s.shuffleOrder.indexOf(idx);
        if (pos >= 0) setShufflePos(pos);
      }

      // The finished item is no longer needed in the native queue.
      try {
        if (typeof e.index === 'number' && e.index > 0) {
          TrackPlayer.removeMediaItems(0, e.index);
        }
      } catch (err: any) {
        logDebug(`Could not remove finished item: ${err?.message ?? err}`);
      }
    });
    return () => sub.remove();
  }, []);

  // Whenever the playback context changes (new track, shuffle/repeat/
  // autoplay toggled, ...), make sure the native queue holds exactly the
  // right "next" item. ensureNextQueued is idempotent.
  useEffect(() => {
    void ensureNextQueued();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nowPlaying?.url,
    queue,
    queueIndex,
    shuffleOn,
    shuffleOrder,
    shufflePos,
    repeatMode,
    settings.autoplay,
  ]);

  // Autoplay / repeat-all detection, based on the progress hook. If the
  // next track is already queued natively, the player advances by itself
  // (and the MediaItemTransition listener syncs state); a watchdog falls
  // back to a JS advance if that never happens. If nothing is queued, the
  // end of a track (position within ~1.5s of the duration) triggers the JS
  // advance directly.
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
    if (!willAdvance) {
      logDebug(
        `Track end reached (remaining=${remaining.toFixed(2)}s, repeat=${repeatMode}, autoplay=${settings.autoplay}) -> stopping`,
      );
      return;
    }

    if (nextQueuedRef.current) {
      const urlAtEnd = expectedUrlRef.current;
      logDebug(
        `Track end reached (remaining=${remaining.toFixed(2)}s) -> native queue will advance (watchdog armed)`,
      );
      if (endWatchdogRef.current) clearTimeout(endWatchdogRef.current);
      endWatchdogRef.current = setTimeout(() => {
        endWatchdogRef.current = null;
        if (expectedUrlRef.current === urlAtEnd) {
          logDebug('Native advance did not happen in time -> falling back to JS advance');
          nextQueuedRef.current = null;
          goNextRef.current();
        }
      }, END_WATCHDOG_MS);
      return;
    }

    logDebug(
      `Track end reached (remaining=${remaining.toFixed(2)}s, repeat=${repeatMode}, autoplay=${settings.autoplay}) -> advancing`,
    );
    goNextRef.current();
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

  function handleRemoveFromPlaylist(playlistId: string, trackUrl: string) {
    const pl = playlists.find(p => p.id === playlistId);
    logDebug(`Removed track from playlist "${pl?.name ?? playlistId}"`);
    setPlaylists(prev =>
      prev.map(p =>
        p.id === playlistId
          ? { ...p, tracks: p.tracks.filter(tr => tr.url !== trackUrl) }
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

  function handleRenamePlaylist() {
    if (!renamePlaylistTarget) return;
    const name = renamePlaylistNameInput.trim() || renamePlaylistTarget.name;
    logDebug(`Renamed playlist "${renamePlaylistTarget.name}" -> "${name}"`);
    setPlaylists(prev =>
      prev.map(p => (p.id === renamePlaylistTarget.id ? { ...p, name } : p)),
    );
    setRenamePlaylistTarget(null);
    setRenamePlaylistNameInput('');
  }

  function handleDeletePlaylist(playlist: Playlist) {
    Alert.alert(t.deletePlaylistTitle, t.deletePlaylistMessage(playlist.name), [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.deleteButton,
        style: 'destructive',
        onPress: () => {
          logDebug(`Deleted playlist "${playlist.name}"`);
          setPlaylists(prev => prev.filter(p => p.id !== playlist.id));
          if (viewingPlaylistId === playlist.id) {
            setViewingPlaylistId(null);
            changeView('library');
          }
          setPlaylistActionsTarget(null);
        },
      },
    ]);
  }

  function openPlaylistView(id: 'liked' | 'downloaded' | string) {
    const name =
      id === 'liked'
        ? t.likedSongs
        : id === 'downloaded'
        ? t.downloaded
        : playlists.find(p => p.id === id)?.name ?? id;
    logDebug(`Opened playlist: ${name}`);
    setViewingPlaylistId(id);
    changeView('playlist');
  }

  // Turns one of our tracks into something the native player can play:
  // the downloaded file if there is one, otherwise a freshly resolved (or
  // recently cached) stream URL. The track's YouTube URL is used as the
  // native mediaId so queue events can be mapped back to our tracks.
  async function resolveMediaItem(
    track: Track,
  ): Promise<{ item: MediaItem; offline: boolean }> {
    const s = playbackStateRef.current;

    const downloaded = s.downloads.find(d => d.url === track.url);
    if (downloaded) {
      return {
        offline: true,
        item: {
          mediaId: track.url,
          url: toPlayableUrl(downloaded.localPath),
          title: downloaded.name,
          artist: 'YouTube',
          artworkUrl: downloaded.thumbnailUrl,
        },
      };
    }

    const cacheKey = `${track.url}|${s.audioQuality}`;
    const cached = resolvedCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.at < RESOLVE_CACHE_TTL_MS) {
      return { offline: false, item: cached.item };
    }

    const stream = await getStreamUrl(track.url, s.audioQuality);
    const item: MediaItem = {
      mediaId: track.url,
      url: stream.streamUrl,
      title: stream.title || track.name,
      artist: 'YouTube',
      artworkUrl: stream.thumbnailUrl || track.thumbnailUrl,
    };
    const cache = resolvedCacheRef.current;
    cache.set(cacheKey, { item, at: Date.now() });
    if (cache.size > RESOLVE_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return { offline: false, item };
  }

  // Removes everything after the current item from the native queue. The
  // invariant is that the current item is always at native index 0.
  function removeQueuedNext() {
    try {
      const q = TrackPlayer.getQueue();
      if (q.length > 1) TrackPlayer.removeMediaItems(1, q.length);
    } catch (e: any) {
      logDebug(`Could not clear queued next item: ${e?.message ?? e}`);
    }
    nextQueuedRef.current = null;
  }

  // Makes the native queue [current] + (the correct next track, if any).
  async function ensureNextQueued() {
    if (!playerSetupDone) return;
    const currentUrl = expectedUrlRef.current;
    if (!currentUrl) return;
    // The restored session's saved position is not applied yet: do not queue a next track before it is.
    if (pendingSeekRef.current?.url === currentUrl) return;

    const s = playbackStateRef.current;
    const target = peekNext(s);
    const queued = nextQueuedRef.current;

    if (!target) {
      if (queued) {
        logDebug('Next track no longer wanted in native queue; removing it');
        removeQueuedNext();
      }
      return;
    }

    const targetTrack = s.queue[target.index];
    if (!targetTrack) return;

    if (queued && queued.url === targetTrack.url) {
      nextQueuedRef.current = {
        index: target.index,
        shufflePos: target.shufflePos,
        url: targetTrack.url,
      };
      return;
    }

    if (queued) removeQueuedNext();
    if (prefetchingUrlRef.current === targetTrack.url) return;

    const token = ++prefetchTokenRef.current;
    prefetchingUrlRef.current = targetTrack.url;
    try {
      const { item } = await resolveMediaItem(targetTrack);
      if (token !== prefetchTokenRef.current || expectedUrlRef.current !== currentUrl) {
        logDebug(`Dropped stale prefetch for "${targetTrack.name}"`);
        return;
      }
      const q = TrackPlayer.getQueue();
      if (q.length > 1) TrackPlayer.removeMediaItems(1, q.length);
      TrackPlayer.addMediaItem(item);
      nextQueuedRef.current = {
        index: target.index,
        shufflePos: target.shufflePos,
        url: targetTrack.url,
      };
      logDebug(`Queued next track natively: "${targetTrack.name}"`);
    } catch (e: any) {
      logDebug(`Prefetch failed for "${targetTrack.name}": ${e?.message ?? e}`);
    } finally {
      if (prefetchingUrlRef.current === targetTrack.url) {
        prefetchingUrlRef.current = null;
      }
    }
  }

  async function playAtIndex(
    list: SearchResult[],
    index: number,
    isNewQueue: boolean,
  ) {
    const item = list[index];
    if (!item) return;

    logDebug(`playAtIndex: "${item.name}" (index ${index}, newQueue=${isNewQueue})`);
    const myRequest = ++playRequestRef.current;
    setLoadingTrack(item.url);
    try {
      const { item: mediaItem, offline } = await resolveMediaItem(item);

      // A newer playAtIndex call started while this one was resolving.
      if (myRequest !== playRequestRef.current) {
        logDebug(`playAtIndex for "${item.name}" superseded`);
        return;
      }

      // From here on, this call replaces the whole native queue.
      if (endWatchdogRef.current) {
        clearTimeout(endWatchdogRef.current);
        endWatchdogRef.current = null;
      }
      if (skipWatchdogRef.current) {
        clearTimeout(skipWatchdogRef.current);
        skipWatchdogRef.current = null;
      }
      prefetchTokenRef.current++;
      prefetchingUrlRef.current = null;
      nextQueuedRef.current = null;
      expectedUrlRef.current = item.url;

      TrackPlayer.setMediaItems([mediaItem]);
      TrackPlayer.play();

      setQueue(list);
      setQueueIndex(index);
      setNowPlaying(item);
      logDebug(
        offline
          ? `Playing offline: ${item.name}`
          : `Playing (${settings.audioQuality}): ${item.name}`,
      );

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
      if (myRequest === playRequestRef.current) {
        setLoadingTrack(null);
      }
    }
  }

  // The original "replace the queue and play the next track" advance. Used
  // whenever the next track is not already waiting in the native queue.
  function goNextViaReplace() {
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

  function goNext() {
    logDebug('goNext called');
    if (queue.length === 0) return;

    // Fast path: the next track is already queued natively, so let the
    // player skip to it (instant and gapless). The MediaItemTransition
    // listener updates React state. A watchdog falls back to the regular
    // advance if that never happens.
    const queued = nextQueuedRef.current;
    if (queued) {
      logDebug(`goNext: skipping natively to "${queue[queued.index]?.name}"`);
      nextQueuedRef.current = null;
      try {
        TrackPlayer.skipToNext();
      } catch (e: any) {
        logDebug(`skipToNext failed (${e?.message ?? e}); using regular advance`);
        goNextViaReplace();
        return;
      }
      if (skipWatchdogRef.current) clearTimeout(skipWatchdogRef.current);
      skipWatchdogRef.current = setTimeout(() => {
        skipWatchdogRef.current = null;
        if (expectedUrlRef.current !== queued.url) {
          logDebug('Native skip did not complete -> falling back to regular advance');
          goNextViaReplace();
        }
      }, SKIP_WATCHDOG_MS);
      return;
    }

    goNextViaReplace();
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
  goPreviousRef.current = goPrevious;

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
      if (!expectedUrlRef.current && nowPlaying && queue.length > 0) {
        logDebug('Play pressed with nothing loaded natively -> loading current track');
        playAtIndex(queue, queueIndex, false);
        return;
      }
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
          setSessionReady(false);
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
          <ActivityIndicator color={resolvedAccent} size="small" />
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
                color={isDownloaded(item.url) ? resolvedAccent : TEXT_DIM}
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
    <AnimatedSafeAreaView
      style={[styles.safeArea, { backgroundColor: animatedBg }]}
      edges={['top', 'left', 'right']}
    >
      <StatusBar barStyle="light-content" />

      <Animated.View style={{ flex: 1, opacity: viewOpacity }}>
        {view === 'search' && (
          <>
            <View style={styles.header}>
              <Animated.Text style={[styles.headerTitle, { color: animatedAccentColor }]}>
                {t.appTitle}
              </Animated.Text>
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
              <ActivityIndicator style={styles.loadingIndicator} color={resolvedAccent} />
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
              <Animated.Text style={[styles.headerTitle, { color: animatedAccentColor }]}>
                {t.yourLibrary}
              </Animated.Text>
            </View>
            <View style={styles.libraryHeaderRow}>
              <Text style={styles.libraryHeaderLabel}>{t.playlistsLabel}</Text>
              <TouchableOpacity onPress={() => setNewPlaylistModalVisible(true)}>
                <Text style={[styles.libraryAddButton, { color: resolvedAccent }]}>
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
                    <View style={[styles.downloadedIcon, { backgroundColor: resolvedAccent }]}>
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
                <View style={styles.playlistRow}>
                  <TouchableOpacity
                    style={styles.playlistRowMain}
                    onPress={() => openPlaylistView(item.id)}
                  >
                    <View style={styles.playlistIcon}>
                      <Music size={20} color={resolvedAccent} />
                    </View>
                    <View style={styles.trackInfo}>
                      <Text style={styles.trackTitle}>{item.name}</Text>
                      <Text style={styles.playlistSubtitle}>
                        {t.songsCount(item.tracks.length)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    hitSlop={10}
                    onPress={() => setPlaylistActionsTarget(item)}
                  >
                    <MoreVertical size={18} color={TEXT_DIM} />
                  </TouchableOpacity>
                </View>
              )}
            />
          </>
        )}

        {view === 'playlist' && viewingPlaylistId && (
          <>
            <View style={styles.playlistDetailHeader}>
              <TouchableOpacity onPress={() => changeView('library')} hitSlop={10}>
                <ChevronLeft size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.playlistDetailTitle} numberOfLines={1}>
                {viewingPlaylistName}
              </Text>
            </View>
            <FlatList
              data={viewingPlaylistTracks}
              keyExtractor={tr => tr.url}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: bottomPad },
              ]}
              renderItem={({ item, index }) =>
                renderTrackRow(item, index, viewingPlaylistTracks)
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
              <Animated.Text style={[styles.headerTitle, { color: animatedAccentColor }]}>
                {t.settingsTitle}
              </Animated.Text>
            </View>
            <ScrollView
              contentContainerStyle={[
                styles.settingsScroll,
                { paddingBottom: bottomPad },
              ]}
            >
              <SettingsSection title={t.sectionPlayback} titleColor={resolvedAccent}>
                <SettingsRow
                  label={t.autoplay}
                  description={t.autoplayDesc}
                  control={
                    <Switch
                      value={settings.autoplay}
                      onValueChange={v => updateSetting('autoplay', v)}
                      trackColor={{ true: resolvedAccent, false: BORDER }}
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

              <SettingsSection title={t.sectionAppearance} titleColor={resolvedAccent}>
                <SettingsRow
                  label={t.animations}
                  description={t.animationsDesc}
                  control={
                    <Switch
                      value={settings.animationsEnabled}
                      onValueChange={v => updateSetting('animationsEnabled', v)}
                      trackColor={{ true: resolvedAccent, false: BORDER }}
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

              <SettingsSection title={t.sectionData} titleColor={resolvedAccent}>
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

              <SettingsSection title={t.sectionAbout} titleColor={resolvedAccent}>
                <SettingsRow label={t.version} description="v0.1.0" control={<View />} />
              </SettingsSection>

              <SettingsSection title={t.sectionDeveloper} titleColor={resolvedAccent}>
                <SettingsRow
                  label={t.developerMode}
                  description={t.developerModeDesc}
                  control={
                    <Switch
                      value={settings.developerMode}
                      onValueChange={v => updateSetting('developerMode', v)}
                      trackColor={{ true: resolvedAccent, false: BORDER }}
                      thumbColor="#FFFFFF"
                    />
                  }
                />
              </SettingsSection>

              {settings.developerMode && (
                <SettingsSection title={t.sectionDebugLogs} titleColor={resolvedAccent}>
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
        <Animated.View
          style={[
            styles.miniPlayer,
            { bottom: tabBarHeight },
            !playerExpanded && styles.miniPlayerCollapsedPadding,
            { backgroundColor: animatedPlayerColor },
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
                  fillColor={resolvedAccent}
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
              <Animated.Text
                style={[styles.miniPlayerTitle, { color: animatedAccentColor }]}
                numberOfLines={1}
              >
                {nowPlaying.name}
              </Animated.Text>
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
                  <Shuffle size={18} color={shuffleOn ? resolvedAccent : '#FFFFFF'} />
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
                    <Repeat1 size={18} color={resolvedAccent} />
                  ) : (
                    <Repeat
                      size={18}
                      color={repeatMode === 'all' ? resolvedAccent : '#FFFFFF'}
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
                    fillColor={resolvedAccent}
                  />
                </View>
              </View>
            </>
          )}
        </Animated.View>
      )}

      <Animated.View
        style={[styles.tabBar, { backgroundColor: animatedPlayerColor }]}
        onLayout={e => setTabBarHeight(e.nativeEvent.layout.height)}
      >
        <View style={[styles.tabBarRow, { paddingBottom: insets.bottom }]}>
          <TouchableOpacity style={styles.tabButton} onPress={() => changeView('search')}>
            <Search size={20} color={view === 'search' ? resolvedAccent : TEXT_DIM} />
            <Animated.Text
              style={[
                styles.tabLabel,
                view === 'search' && styles.tabLabelActive,
                view === 'search' ? { color: animatedAccentColor } : null,
              ]}
            >
              {t.tabSearch}
            </Animated.Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => changeView('library')}
          >
            <Library
              size={20}
              color={view === 'library' || view === 'playlist' ? resolvedAccent : TEXT_DIM}
            />
            <Animated.Text
              style={[
                styles.tabLabel,
                (view === 'library' || view === 'playlist') && styles.tabLabelActive,
                view === 'library' || view === 'playlist'
                  ? { color: animatedAccentColor }
                  : null,
              ]}
            >
              {t.tabLibrary}
            </Animated.Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => changeView('settings')}
          >
            <SettingsIcon
              size={20}
              color={view === 'settings' ? resolvedAccent : TEXT_DIM}
            />
            <Animated.Text
              style={[
                styles.tabLabel,
                view === 'settings' && styles.tabLabelActive,
                view === 'settings' ? { color: animatedAccentColor } : null,
              ]}
            >
              {t.tabSettings}
            </Animated.Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

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
                <ActivityIndicator size="small" color={resolvedAccent} />
              ) : (
                <Download
                  size={18}
                  color={
                    addToPlaylistTarget && isDownloaded(addToPlaylistTarget.url)
                      ? resolvedAccent
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

            {removablePlaylistId && addToPlaylistTarget && (
              <TouchableOpacity
                style={styles.modalActionRow}
                onPress={() =>
                  handleRemoveFromPlaylist(removablePlaylistId, addToPlaylistTarget.url)
                }
              >
                <Text style={[styles.modalActionText, { color: LIKE_RED }]}>
                  {t.removeFromPlaylist}
                </Text>
              </TouchableOpacity>
            )}

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
              <Text style={[styles.modalNewPlaylistText, { color: resolvedAccent }]}>
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
                style={[styles.modalOkButton, { backgroundColor: resolvedAccent }]}
                onPress={handleCreatePlaylist}
              >
                <Text style={styles.modalOkText}>{t.createButton}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!playlistActionsTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setPlaylistActionsTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t.playlistActionsTitle}</Text>
            <TouchableOpacity
              style={styles.modalActionRow}
              onPress={() => {
                if (!playlistActionsTarget) return;
                setRenamePlaylistTarget(playlistActionsTarget);
                setRenamePlaylistNameInput(playlistActionsTarget.name);
                setPlaylistActionsTarget(null);
              }}
            >
              <Text style={styles.modalActionText}>{t.renamePlaylistTitle}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalActionRow}
              onPress={() => playlistActionsTarget && handleDeletePlaylist(playlistActionsTarget)}
            >
              <Text style={[styles.modalActionText, { color: LIKE_RED }]}>
                {t.deleteButton}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setPlaylistActionsTarget(null)}
            >
              <Text style={styles.modalCancelText}>{t.cancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!renamePlaylistTarget}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setRenamePlaylistTarget(null);
          setRenamePlaylistNameInput('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t.renamePlaylistTitle}</Text>
            <TextInput
              style={styles.modalInput}
              value={renamePlaylistNameInput}
              onChangeText={setRenamePlaylistNameInput}
              placeholder={t.myPlaylist}
              placeholderTextColor={TEXT_DIM}
              autoFocus
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                onPress={() => {
                  setRenamePlaylistTarget(null);
                  setRenamePlaylistNameInput('');
                }}
              >
                <Text style={styles.modalCancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalOkButton, { backgroundColor: resolvedAccent }]}
                onPress={handleRenamePlaylist}
              >
                <Text style={styles.modalOkText}>{t.renameButton}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </AnimatedSafeAreaView>
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
  playlistRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
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
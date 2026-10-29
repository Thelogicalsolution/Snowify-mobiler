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
  BackHandler,
  FlatList,
  Image,
  Modal,
  PanResponder,
  ScrollView,
  Share,
  StatusBar,
  ToastAndroid,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
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
  Moon,
  Share2,
  Clock,
  List,
  X,
  Menu as GripIcon,
  Mic,
  Video as VideoIcon,
  Headphones,
  Users,
  Check,
  Download,
} from 'lucide-react-native';
import {
  searchVideos,
  getStreamUrl,
  getRelatedStreams,
  isOnWifi,
  extractPalette,
  searchPlaylists,
  getPlaylistTracks,
  getTrackMeta,
  playVideo,
  searchVideoOnly,
  getChannel,
  getChannelTab,
  ChannelHeader,
  VideoSearchResult,
  PaletteSwatch,
  PlaylistResult,
} from './NewPipeBridge';
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
  clearSession,
} from './SessionStore';
import { loadHistory, saveHistory } from './HistoryStore';
import { FollowedChannel, loadFollowing, saveFollowing } from './FollowStore';
import { LyricsResult, loadCachedLyrics, saveCachedLyrics, fetchLyrics } from './LyricsStore';

type SearchResult = Track;
type RepeatSetting = 'off' | 'all' | 'one';
type ViewName =
  | 'search'
  | 'video'
  | 'library'
  | 'playlist'
  | 'settings'
  | 'channel'
  | 'following';

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
// How many songs the Recently played list keeps.
const HISTORY_MAX = 50;
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

const QUEUE_ROW_H = 56;

function QueueHandle({
  k,
  onStart,
  onMove,
  onEnd,
}: {
  k: number;
  onStart: (k: number) => void;
  onMove: (dy: number) => void;
  onEnd: (dy: number) => void;
}) {
  const latest = useRef({ k, onStart, onMove, onEnd });
  latest.current = { k, onStart, onMove, onEnd };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => latest.current.onStart(latest.current.k),
      onPanResponderMove: (_e, g) => latest.current.onMove(g.dy),
      onPanResponderRelease: (_e, g) => latest.current.onEnd(g.dy),
      onPanResponderTerminate: (_e, g) => latest.current.onEnd(g.dy),
    }),
  ).current;
  return (
    <View {...pan.panHandlers} style={styles.queueHandle}>
      <GripIcon size={18} color={TEXT_DIM} />
    </View>
  );
}

function QueueList({
  items,
  emptyText,
  onPlay,
  onRemove,
  onReorder,
}: {
  items: { track: Track; index: number }[];
  emptyText: string;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [targetIdx, setTargetIdx] = useState(0);
  const dyAnim = useRef(new Animated.Value(0)).current;
  const fromRef = useRef<number | null>(null);
  const targetRef = useRef(0);
  const countRef = useRef(items.length);
  countRef.current = items.length;
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;

  function handleStart(k: number) {
    fromRef.current = k;
    targetRef.current = k;
    dyAnim.setValue(0);
    setTargetIdx(k);
    setDragFrom(k);
  }

  function handleMove(dy: number) {
    const from = fromRef.current;
    if (from === null) return;
    dyAnim.setValue(dy);
    const t = Math.max(0, Math.min(countRef.current - 1, from + Math.round(dy / QUEUE_ROW_H)));
    if (t !== targetRef.current) {
      targetRef.current = t;
      setTargetIdx(t);
    }
  }

  function handleEnd(_dy: number) {
    const from = fromRef.current;
    const to = targetRef.current;
    fromRef.current = null;
    dyAnim.setValue(0);
    setDragFrom(null);
    if (from !== null && from !== to) reorderRef.current(from, to);
  }

  return (
    <ScrollView style={styles.queueScroll} scrollEnabled={dragFrom === null}>
      {items.length === 0 && <Text style={styles.modalEmptyText}>{emptyText}</Text>}
      {items.map((item, k) => {
        let shift = 0;
        if (dragFrom !== null && k !== dragFrom) {
          if (dragFrom < targetIdx && k > dragFrom && k <= targetIdx) shift = -QUEUE_ROW_H;
          else if (dragFrom > targetIdx && k >= targetIdx && k < dragFrom) shift = QUEUE_ROW_H;
        }
        const dragging = dragFrom === k;
        return (
          <Animated.View
            key={`${item.index}-${item.track.url}`}
            style={[
              styles.queueRow,
              { height: QUEUE_ROW_H },
              dragging
                ? { transform: [{ translateY: dyAnim }], zIndex: 10, elevation: 6, backgroundColor: CARD }
                : { transform: [{ translateY: shift }] },
            ]}
          >
            <QueueHandle k={k} onStart={handleStart} onMove={handleMove} onEnd={handleEnd} />
            <TouchableOpacity style={styles.queueRowMain} onPress={() => onPlay(item.index)}>
              {item.track.thumbnailUrl ? (
                <Image source={{ uri: item.track.thumbnailUrl }} style={styles.queueArt} />
              ) : (
                <View style={styles.queueArt} />
              )}
              <Text style={styles.queueTitle} numberOfLines={2}>
                {item.track.name}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={10} onPress={() => onRemove(item.index)}>
              <X size={18} color={TEXT_DIM} />
            </TouchableOpacity>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

function NowPlayingBars({ color, active }: { color: string; active: boolean }) {
  const bars = useRef([new Animated.Value(0.45), new Animated.Value(0.9), new Animated.Value(0.6)]).current;
  useEffect(() => {
    if (!active) {
      bars.forEach(b => b.stopAnimation());
      return;
    }
    const loops = bars.map((b, i) => {
      const dur = 380 + i * 130;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(b, { toValue: 1, duration: dur, useNativeDriver: true }),
          Animated.timing(b, { toValue: 0.25 + i * 0.05, duration: dur, useNativeDriver: true }),
        ]),
      );
    });
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [active]);
  return (
    <View style={styles.eqWrap}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[styles.eqBar, { backgroundColor: color, transform: [{ scaleY: b }] }]}
        />
      ))}
    </View>
  );
}

// Fades and lifts a list row in when it first appears (only the first rows, so scrolling stays calm).
function FadeInRow({
  index,
  enabled,
  children,
}: {
  index: number;
  enabled: boolean;
  children: React.ReactNode;
}) {
  const animate = enabled && index < 12;
  const anim = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.timing(anim, {
      toValue: 1,
      duration: 260,
      delay: index * 28,
      useNativeDriver: true,
    }).start();
  }, []);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

// Cover art that fades in once it has loaded.
function FadeImage({
  uri,
  style,
  enabled = true,
}: {
  uri: string;
  style: any;
  enabled?: boolean;
}) {
  const opacity = useRef(new Animated.Value(enabled ? 0 : 1)).current;
  useEffect(() => {
    opacity.setValue(enabled ? 0 : 1);
  }, [uri, enabled]);
  return (
    <Animated.Image
      source={{ uri }}
      style={[style, { opacity }]}
      onLoad={() => {
        if (!enabled) return;
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      }}
    />
  );
}

// Candidate image URLs for the big Now Playing cover, best first. List covers are tiny
// thumbnails, so ask for larger versions of the same image.
function artCandidates(url: string): string[] {
  const out: string[] = [];
  if (!url) return out;
  if (/(googleusercontent|ggpht)\.com\//.test(url)) {
    if (/=w\d+-h\d+/.test(url)) out.push(url.replace(/=w\d+-h\d+/, '=w1000-h1000'));
    else if (/=s\d+/.test(url)) out.push(url.replace(/=s\d+/, '=s1000'));
  }
  const m = /ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\//.exec(url);
  if (m) {
    for (const q of ['maxresdefault', 'sddefault', 'hqdefault']) {
      out.push(`https://i.ytimg.com/vi/${m[1]}/${q}.jpg`);
    }
  }
  out.push(url);
  return out;
}

const ART_MIN_WIDTH = 480;

function NowPlayingArt({ uri, size, enabled }: { uri: string; size: number; enabled: boolean }) {
  const candidates = artCandidates(uri);
  const [idx, setIdx] = useState(0);
  const opacity = useRef(new Animated.Value(enabled ? 0 : 1)).current;
  useEffect(() => {
    setIdx(0);
    opacity.setValue(enabled ? 0 : 1);
  }, [uri, enabled]);
  if (candidates.length === 0) {
    return (
      <View style={[styles.npArt, { width: size, height: size }]}>
        <Music size={size / 3} color={TEXT_DIM} />
      </View>
    );
  }
  const at = Math.min(idx, candidates.length - 1);
  const src = candidates[at];
  const isLast = at >= candidates.length - 1;
  return (
    <Animated.Image
      key={src}
      source={{ uri: src }}
      resizeMethod="scale"
      resizeMode="cover"
      style={[styles.npArt, { width: size, height: size, opacity }]}
      onError={() => {
        logDebug(`Cover failed (${at + 1}/${candidates.length}): ${src}`);
        if (!isLast) setIdx(at + 1);
      }}
      onLoad={(e: any) => {
        const w = e?.nativeEvent?.source?.width ?? 0;
        logDebug(`Cover loaded ${w}px (${at + 1}/${candidates.length}): ${src}`);
        if (!isLast && w > 0 && w < ART_MIN_WIDTH) {
          setIdx(at + 1);
          return;
        }
        if (enabled) {
          Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }).start();
        } else {
          opacity.setValue(1);
        }
      }}
    />
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

  const [sleepEndAt, setSleepEndAt] = useState<number | null>(null);
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState(0);
  const [sleepModalVisible, setSleepModalVisible] = useState(false);

  const [queueModalVisible, setQueueModalVisible] = useState(false);
  const [sortMode, setSortMode] = useState<'default' | 'reverse' | 'az' | 'za'>('default');
  const [filterText, setFilterText] = useState('');
  const [selected, setSelected] = useState<Track[]>([]);
  const [bulkPlaylistVisible, setBulkPlaylistVisible] = useState(false);
  const [bulkNewName, setBulkNewName] = useState('');
  const [history, setHistory] = useState<Track[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyText =
    settings.language === 'uk'
      ? {
          title: 'Нещодавно прослухані',
          clear: 'Очистити історію',
          clearDesc: 'Очищає список нещодавно прослуханих',
          button: 'Очистити',
        }
      : {
          title: 'Recently played',
          clear: 'Clear play history',
          clearDesc: 'Empties the Recently played list',
          button: 'Clear',
        };

  const backupText =
    settings.language === 'uk'
      ? {
          exportLabel: 'Експорт резервної копії',
          exportDesc: 'Копіює улюблені, плейлисти та історію як текст і відкриває меню «Поділитися»',
          exportButton: 'Експорт',
          importLabel: 'Імпорт резервної копії',
          importDesc: 'Спочатку скопіюйте текст копії, потім натисніть «Імпорт»',
          importButton: 'Імпорт',
          noneTitle: 'Нічого імпортувати',
          noneMessage: 'У буфері обміну немає резервної копії Snowify.',
          confirmTitle: 'Імпорт резервної копії',
          confirm: (l: number, p: number, h: number) =>
            `Знайдено: улюблені — ${l}, плейлисти — ${p}, історія — ${h}. Додати до бібліотеки?`,
          doneTitle: 'Готово',
          done: (l: number, p: number, tr: number, h: number) =>
            `Додано: улюблені — ${l}, нові плейлисти — ${p}, треки в плейлистах — ${tr}, історія — ${h}.`,
        }
      : {
          exportLabel: 'Export backup',
          exportDesc: 'Copies your liked songs, playlists and play history as text and opens the share sheet',
          exportButton: 'Export',
          importLabel: 'Import backup',
          importDesc: 'Copy a backup text first, then press Import',
          importButton: 'Import',
          noneTitle: 'Nothing to import',
          noneMessage: 'The clipboard does not contain a Snowify backup.',
          confirmTitle: 'Import backup',
          confirm: (l: number, p: number, h: number) =>
            `Found ${l} liked songs, ${p} playlists and ${h} history entries. Add them to your library?`,
          doneTitle: 'Done',
          done: (l: number, p: number, tr: number, h: number) =>
            `Added ${l} liked songs, ${p} new playlists, ${tr} playlist tracks and ${h} history entries.`,
        };

  function cleanTrack(x: any): Track | null {
    if (!x || typeof x.url !== 'string' || typeof x.name !== 'string' || !x.url || !x.name) {
      return null;
    }
    return {
      url: x.url,
      name: x.name,
      thumbnailUrl: typeof x.thumbnailUrl === 'string' ? x.thumbnailUrl : '',
    };
  }

  function cleanTracks(list: any): Track[] {
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: Track[] = [];
    for (const raw of list) {
      const tr = cleanTrack(raw);
      if (tr && !seen.has(tr.url)) {
        seen.add(tr.url);
        out.push(tr);
      }
    }
    return out;
  }

  async function handleExportBackup() {
    const backup = {
      app: 'snowify',
      version: 1,
      exportedAt: new Date().toISOString(),
      liked: likedSongs,
      playlists: playlists.map(p => ({ name: p.name, tracks: p.tracks })),
      history,
    };
    const text = JSON.stringify(backup);
    logDebug(
      `Backup export: ${likedSongs.length} liked, ${playlists.length} playlists, ${history.length} history, ${text.length} characters`,
    );
    Clipboard.setString(text);
    try {
      await Share.share({ message: text });
    } catch (e: any) {
      logDebug(`Backup share failed: ${e?.message ?? e}`);
    }
  }

  async function handleImportBackup() {
    let text = '';
    try {
      text = await Clipboard.getString();
    } catch (e: any) {
      logDebug(`Backup import: could not read the clipboard: ${e?.message ?? e}`);
    }
    let parsed: any = null;
    try {
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first >= 0 && last > first) parsed = JSON.parse(text.slice(first, last + 1));
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.app !== 'snowify') {
      logDebug('Backup import: clipboard has no Snowify backup');
      Alert.alert(backupText.noneTitle, backupText.noneMessage);
      return;
    }

    const importedLiked = cleanTracks(parsed.liked);
    const importedHistory = cleanTracks(parsed.history);
    const importedPlaylists = (Array.isArray(parsed.playlists) ? parsed.playlists : []).map(
      (p: any) => ({
        name: typeof p?.name === 'string' && p.name ? p.name : t.myPlaylist,
        tracks: cleanTracks(p?.tracks),
      }),
    );
    logDebug(
      `Backup import: found ${importedLiked.length} liked, ${importedPlaylists.length} playlists, ${importedHistory.length} history`,
    );

    Alert.alert(
      backupText.confirmTitle,
      backupText.confirm(importedLiked.length, importedPlaylists.length, importedHistory.length),
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: backupText.importButton,
          onPress: () => applyBackup(importedLiked, importedPlaylists, importedHistory),
        },
      ],
    );
  }

  function applyBackup(
    liked: Track[],
    importedPlaylists: { name: string; tracks: Track[] }[],
    importedHistory: Track[],
  ) {
    const knownLiked = new Set(likedSongs.map(x => x.url));
    const freshLiked = liked.filter(x => !knownLiked.has(x.url));
    setLikedSongs(prev => [...prev, ...freshLiked.filter(x => !prev.some(p => p.url === x.url))]);

    let newPlaylists = 0;
    let addedPlaylistTracks = 0;
    const nextPlaylists = playlists.map(p => ({ ...p, tracks: [...p.tracks] }));
    for (const bp of importedPlaylists) {
      const existing = nextPlaylists.find(p => p.name.toLowerCase() === bp.name.toLowerCase());
      if (existing) {
        for (const tr of bp.tracks) {
          if (!existing.tracks.some(x => x.url === tr.url)) {
            existing.tracks.push(tr);
            addedPlaylistTracks++;
          }
        }
      } else {
        nextPlaylists.push({ id: makePlaylistId(), name: bp.name, tracks: bp.tracks });
        newPlaylists++;
        addedPlaylistTracks += bp.tracks.length;
      }
    }
    setPlaylists(nextPlaylists);

    const knownHistory = new Set(history.map(x => x.url));
    const freshHistory = importedHistory.filter(x => !knownHistory.has(x.url));
    setHistory(prev =>
      [...prev, ...freshHistory.filter(x => !prev.some(p => p.url === x.url))].slice(0, HISTORY_MAX),
    );

    logDebug(
      `Backup imported: ${freshLiked.length} liked, ${newPlaylists} new playlists, ${addedPlaylistTracks} playlist tracks, ${freshHistory.length} history`,
    );
    Alert.alert(
      backupText.doneTitle,
      backupText.done(freshLiked.length, newPlaylists, addedPlaylistTracks, freshHistory.length),
    );
  }

  const queueText =
    settings.language === 'uk'
      ? {
          title: 'Далі у черзі',
          nowPlaying: 'Зараз грає',
          empty: 'Далі нічого немає',
          close: 'Закрити',
          playNext: 'Грати наступним',
          addToQueue: 'Додати до черги',
          addedNext: 'Зіграє наступною',
          addedEnd: 'Додано до черги',
          alreadyTitle: 'Вже в черзі',
          alreadyMessage: 'Ця пісня вже є в черзі.',
        }
      : {
          title: 'Up next',
          nowPlaying: 'Now playing',
          empty: 'Nothing queued after this song',
          close: 'Close',
          playNext: 'Play next',
          addToQueue: 'Add to queue',
          addedNext: 'Will play next',
          addedEnd: 'Added to the queue',
          alreadyTitle: 'Already in the queue',
          alreadyMessage: 'This song is already in the queue.',
        };

  // Songs that will play after the current one, in play order.
  const upcoming: { track: Track; index: number }[] = shuffleOn
    ? shuffleOrder
        .slice(shufflePos + 1)
        .map(i => ({ track: queue[i], index: i }))
        .filter(x => !!x.track)
    : queue.slice(queueIndex + 1).map((track, k) => ({ track, index: queueIndex + 1 + k }));

  function addToQueue(track: Track, mode: 'next' | 'end') {
    if (queue.length === 0) {
      logDebug(`Queue: nothing playing, starting "${track.name}"`);
      playAtIndex([track], 0, true);
      return;
    }
    if (queue.some(q => q.url === track.url)) {
      logDebug(`Queue: "${track.name}" is already in the queue`);
      Alert.alert(queueText.alreadyTitle, queueText.alreadyMessage);
      return;
    }
    const pos = mode === 'next' ? queueIndex + 1 : queue.length;
    const newQueue = [...queue.slice(0, pos), track, ...queue.slice(pos)];
    const shifted = shuffleOrder.map(i => (i >= pos ? i + 1 : i));
    const orderPos = mode === 'next' ? Math.min(shufflePos + 1, shifted.length) : shifted.length;
    const newOrder = [...shifted.slice(0, orderPos), pos, ...shifted.slice(orderPos)];
    logDebug(`Queue: added "${track.name}" (${mode}) at index ${pos}`);
    setQueue(newQueue);
    setShuffleOrder(newOrder);
    ToastAndroid.show(mode === 'next' ? queueText.addedNext : queueText.addedEnd, ToastAndroid.SHORT);
  }

  function reorderUpcoming(from: number, to: number) {
    if (from === to) return;
    if (shuffleOn) {
      const head = shuffleOrder.slice(0, shufflePos + 1);
      const tail = shuffleOrder.slice(shufflePos + 1);
      if (from < 0 || from >= tail.length) return;
      const [moved] = tail.splice(from, 1);
      tail.splice(to, 0, moved);
      logDebug(`Queue: moved "${queue[moved]?.name}" from ${from + 1} to ${to + 1} (shuffle order)`);
      setShuffleOrder([...head, ...tail]);
    } else {
      const head = queue.slice(0, queueIndex + 1);
      const tail = queue.slice(queueIndex + 1);
      if (from < 0 || from >= tail.length) return;
      const [moved] = tail.splice(from, 1);
      tail.splice(to, 0, moved);
      logDebug(`Queue: moved "${moved.name}" from ${from + 1} to ${to + 1}`);
      setQueue([...head, ...tail]);
    }
  }

  function removeFromQueue(removeIdx: number) {
    if (removeIdx === queueIndex || removeIdx < 0 || removeIdx >= queue.length) return;
    logDebug(`Queue: removed "${queue[removeIdx].name}" (index ${removeIdx})`);
    let newPos = shufflePos;
    const newOrder: number[] = [];
    shuffleOrder.forEach((qi, pos) => {
      if (qi === removeIdx) {
        if (pos < shufflePos) newPos--;
        return;
      }
      newOrder.push(qi > removeIdx ? qi - 1 : qi);
    });
    setQueue(queue.filter((_, i) => i !== removeIdx));
    setQueueIndex(removeIdx < queueIndex ? queueIndex - 1 : queueIndex);
    setShuffleOrder(newOrder);
    setShufflePos(Math.max(0, newPos));
  }

  const selectText =
    settings.language === 'uk'
      ? {
          count: (n: number) => `Вибрано: ${n}`,
          all: 'Усі',
          addedToPlaylist: (n: number, name: string) => `Додано ${n} до «${name}»`,
          downloading: (n: number) => `Завантаження: ${n}…`,
          downloadsDone: 'Завантаження завершено',
          allDownloaded: 'Усе вже завантажено',
          queued: (n: number) => `Додано до черги: ${n}`,
        }
      : {
          count: (n: number) => `${n} selected`,
          all: 'All',
          addedToPlaylist: (n: number, name: string) => `Added ${n} to "${name}"`,
          downloading: (n: number) => `Downloading ${n} songs…`,
          downloadsDone: 'Downloads finished',
          allDownloaded: 'Already downloaded',
          queued: (n: number) => `Added ${n} to the queue`,
        };

  function isSelected(url: string): boolean {
    return selected.some(s => s.url === url);
  }

  function toggleSelect(track: Track) {
    setSelected(prev =>
      prev.some(s => s.url === track.url)
        ? prev.filter(s => s.url !== track.url)
        : [...prev, track],
    );
  }

  function toggleSelectAll() {
    const list = view === 'search' ? results : shownTracks;
    setSelected(prev => (prev.length >= list.length ? [] : [...list]));
  }

  function bulkAddToPlaylist(playlistId: string) {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const fresh = selected.filter(s => !pl.tracks.some(x => x.url === s.url));
    setPlaylists(prev =>
      prev.map(p =>
        p.id === playlistId
          ? { ...p, tracks: [...p.tracks, ...fresh.filter(f => !p.tracks.some(x => x.url === f.url))] }
          : p,
      ),
    );
    logDebug(`Selection: added ${fresh.length} of ${selected.length} to playlist "${pl.name}"`);
    ToastAndroid.show(selectText.addedToPlaylist(fresh.length, pl.name), ToastAndroid.SHORT);
    setBulkPlaylistVisible(false);
    setSelected([]);
  }

  function bulkCreatePlaylist() {
    const name = bulkNewName.trim() || t.myPlaylist;
    const id = makePlaylistId();
    setPlaylists(prev => [...prev, { id, name, tracks: [...selected] }]);
    logDebug(`Selection: created playlist "${name}" with ${selected.length} songs`);
    ToastAndroid.show(selectText.addedToPlaylist(selected.length, name), ToastAndroid.SHORT);
    setBulkPlaylistVisible(false);
    setBulkNewName('');
    setSelected([]);
  }

  async function bulkDownload() {
    const tracks = selected.filter(s => !downloads.some(d => d.url === s.url));
    if (tracks.length > 0 && !(await downloadsAllowed())) return;
    setSelected([]);
    if (tracks.length === 0) {
      ToastAndroid.show(selectText.allDownloaded, ToastAndroid.SHORT);
      return;
    }
    logDebug(`Selection: downloading ${tracks.length} songs`);
    ToastAndroid.show(selectText.downloading(tracks.length), ToastAndroid.LONG);
    for (const tr of tracks) {
      await handleDownloadTrack(tr);
    }
    logDebug('Selection: downloads finished');
    ToastAndroid.show(selectText.downloadsDone, ToastAndroid.SHORT);
  }

  function bulkAddToQueue() {
    if (queue.length === 0) {
      logDebug(`Selection: nothing playing, starting ${selected.length} songs`);
      playAtIndex(selected, 0, true);
      setSelected([]);
      return;
    }
    const fresh = selected.filter(s => !queue.some(q => q.url === s.url));
    if (fresh.length === 0) {
      Alert.alert(queueText.alreadyTitle, queueText.alreadyMessage);
      return;
    }
    const base = queue.length;
    setQueue([...queue, ...fresh]);
    setShuffleOrder([...shuffleOrder, ...fresh.map((_, k) => base + k)]);
    logDebug(`Selection: added ${fresh.length} songs to the queue`);
    ToastAndroid.show(selectText.queued(fresh.length), ToastAndroid.SHORT);
    setSelected([]);
  }

  // Android back button leaves selection mode.
  useEffect(() => {
    if (selected.length === 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected([]);
      return true;
    });
    return () => sub.remove();
  }, [selected.length]);

  const relatedText =
    settings.language === 'uk'
      ? { label: 'Схожі пісні', desc: 'Коли черга закінчується, продовжувати схожими піснями' }
      : { label: 'Suggested songs', desc: 'When the queue ends, keep going with similar songs' };

  // When the last song of the queue starts, fetch related songs and append them,
  // so playback goes on (and the next track gets pre-queued) instead of stopping.
  const relatedFetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settings.relatedSongs || !settings.autoplay || repeatMode !== 'off') return;
    if (!nowPlaying || queue.length === 0) return;
    const atEnd = shuffleOn
      ? shufflePos >= shuffleOrder.length - 1
      : queueIndex >= queue.length - 1;
    if (!atEnd) return;
    const url = nowPlaying.url;
    if (relatedFetchedForRef.current === url) return;
    relatedFetchedForRef.current = url;
    logDebug(`Related: queue ends on "${nowPlaying.name}", fetching suggestions`);
    getRelatedStreams(url)
      .then(found => {
        const s = playbackStateRef.current;
        const current = s.queue[s.queueIndex];
        if (!current || current.url !== url) return;
        const fresh = found.filter(f => !s.queue.some(q => q.url === f.url)).slice(0, 10);
        if (fresh.length === 0) {
          logDebug(`Related: nothing new to add (YouTube returned ${found.length})`);
          return;
        }
        const base = s.queue.length;
        setQueue([...s.queue, ...fresh]);
        setShuffleOrder([...s.shuffleOrder, ...fresh.map((_, k) => base + k)]);
        logDebug(`Related: added ${fresh.length} suggested songs`);
      })
      .catch((e: any) => logDebug(`Related: fetch failed: ${e?.message ?? e}`));
  }, [
    nowPlaying?.url,
    queue.length,
    queueIndex,
    shuffleOn,
    shufflePos,
    shuffleOrder.length,
    repeatMode,
    settings.autoplay,
    settings.relatedSongs,
  ]);

  const remoteText =
    settings.language === 'uk'
      ? {
          songs: 'Пісні',
          playlists: 'Плейлисти',
          playAll: 'Відтворити все',
          shuffle: 'Перемішати',
          save: 'Зберегти',
          saved: 'Збережено у ваші плейлисти',
          failed: 'Не вдалося завантажити плейлист (можливо, він приватний або видалений)',
          loading: 'Завантаження…',
        }
      : {
          songs: 'Songs',
          playlists: 'Playlists',
          playAll: 'Play all',
          shuffle: 'Shuffle',
          save: 'Save',
          saved: 'Saved to your playlists',
          failed: 'Could not load this playlist (it may be private or removed)',
          loading: 'Loading…',
        };

  const [searchMode, setSearchMode] = useState<'songs' | 'playlists'>('songs');
  const [playlistResults, setPlaylistResults] = useState<PlaylistResult[]>([]);
  const [remote, setRemote] = useState<{
    url: string;
    name: string;
    uploader: string;
    tracks: Track[];
  }>({ url: '', name: '', uploader: '', tracks: [] });
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const remoteTokenRef = useRef(0);

  function openRemotePlaylist(p: { url: string; name?: string; uploader?: string; backTo?: ViewName }) {
    setRemoteBackTo(p.backTo ?? (view === 'channel' ? 'channel' : 'search'));
    const token = ++remoteTokenRef.current;
    logDebug(`Opening YouTube playlist: ${p.name ?? p.url}`);
    setRemote({ url: p.url, name: p.name ?? '', uploader: p.uploader ?? '', tracks: [] });
    setRemoteLoading(true);
    setRemoteError(null);
    setViewingPlaylistId('remote');
    setSortMode('default');
    setFilterText('');
    changeView('playlist');
    getPlaylistTracks(p.url, 300)
      .then(res => {
        if (token !== remoteTokenRef.current) return;
        setRemote({
          url: p.url,
          name: res.name || p.name || '',
          uploader: res.uploader || p.uploader || '',
          tracks: res.tracks,
        });
        setRemoteLoading(false);
        logDebug(`YouTube playlist loaded: ${res.tracks.length} songs`);
      })
      .catch((e: any) => {
        if (token !== remoteTokenRef.current) return;
        setRemoteLoading(false);
        setRemoteError(remoteText.failed);
        logDebug(`YouTube playlist failed: ${e?.message ?? e}`);
      });
  }

  function playAllShown() {
    if (shownTracks.length === 0) return;
    logDebug(`Play all: ${shownTracks.length} songs`);
    playAtIndex(shownTracks, 0, true);
  }

  function shuffleShown() {
    if (shownTracks.length === 0) return;
    logDebug(`Shuffle play: ${shownTracks.length} songs`);
    setShuffleOn(true);
    playAtIndex(shownTracks, Math.floor(Math.random() * shownTracks.length), true);
  }

  function saveRemotePlaylist() {
    if (remote.tracks.length === 0) return;
    const name = remote.name || t.myPlaylist;
    setPlaylists(prev => [...prev, { id: makePlaylistId(), name, tracks: remote.tracks }]);
    logDebug(`Saved YouTube playlist "${name}" (${remote.tracks.length} songs)`);
    ToastAndroid.show(remoteText.saved, ToastAndroid.SHORT);
  }

  const lyricsText =
    settings.language === 'uk'
      ? {
          none: 'Текст не знайдено',
          error: 'Не вдалося завантажити текст (перевірте інтернет)',
          retry: 'Спробувати знову',
          instrumental: 'Інструментальна композиція',
          credit: 'Тексти: LRCLIB',
        }
      : {
          none: 'No lyrics found',
          error: 'Could not load lyrics (check your connection)',
          retry: 'Try again',
          instrumental: 'Instrumental',
          credit: 'Lyrics: LRCLIB',
        };

  const [lyricsVisible, setLyricsVisible] = useState(false);
  const [lyricsState, setLyricsState] = useState<'idle' | 'loading' | 'ready' | 'none' | 'error'>('idle');
  const [lyricsData, setLyricsData] = useState<LyricsResult | null>(null);
  const [lyricsUrl, setLyricsUrl] = useState<string | null>(null);
  const [lyricsRetry, setLyricsRetry] = useState(0);
  const lyricsTokenRef = useRef(0);
  const lyricsForRef = useRef<string | null>(null);
  const lyricsScrollRef = useRef<ScrollView>(null);
  const lyricsLineY = useRef<{ [i: number]: number }>({});
  const lyricsViewH = useRef(0);

  // Loads the lyrics of the playing song whenever the lyrics screen is open.
  useEffect(() => {
    if (!lyricsVisible || !nowPlaying) return;
    const track = nowPlaying;
    if (lyricsForRef.current === track.url) return;
    const token = ++lyricsTokenRef.current;
    setLyricsState('loading');
    setLyricsData(null);
    lyricsLineY.current = {};
    (async () => {
      try {
        let result = await loadCachedLyrics(track.url);
        if (result) {
          logDebug(`Lyrics: loaded from cache for "${track.name}"`);
        } else {
          const meta = await getTrackMeta(track.url);
          result = await fetchLyrics(meta.title || track.name, meta.uploader || '', Number(meta.duration) || 0);
          if (result) await saveCachedLyrics(track.url, result);
        }
        if (token !== lyricsTokenRef.current) return;
        lyricsForRef.current = track.url;
        setLyricsUrl(track.url);
        if (result) {
          setLyricsData(result);
          setLyricsState('ready');
          logDebug(
            `Lyrics: found for "${track.name}" (${result.synced ? 'synced' : result.plain ? 'plain' : 'instrumental'})`,
          );
        } else {
          setLyricsState('none');
          logDebug(`Lyrics: none found for "${track.name}"`);
        }
      } catch (e: any) {
        if (token !== lyricsTokenRef.current) return;
        lyricsForRef.current = null;
        setLyricsState('error');
        logDebug(`Lyrics failed: ${e?.message ?? e}`);
      }
    })();
  }, [lyricsVisible, nowPlaying?.url, lyricsRetry]);

  // The mini player slides up when the first song starts. It uses the JS driver on purpose:
  // this view also has a JS-driven background colour, and the two drivers cannot be mixed.
  const miniEnter = useRef(new Animated.Value(1)).current;
  const hadPlayerRef = useRef(false);
  useEffect(() => {
    const has = !!nowPlaying;
    if (has && !hadPlayerRef.current && settings.animationsEnabled) {
      miniEnter.setValue(0);
      Animated.timing(miniEnter, { toValue: 1, duration: 280, useNativeDriver: false }).start();
    }
    hadPlayerRef.current = has;
  }, [!!nowPlaying]);

  // --- Now Playing screen (opened from the mini player's cover) ---
  const { width: winW, height: winH } = useWindowDimensions();
  const npArtSize = Math.max(180, Math.min(winW - 64, winH * 0.4, 380));
  const [npVisible, setNpVisible] = useState(false);
  const [npMounted, setNpMounted] = useState(false);
  const npAnim = useRef(new Animated.Value(0)).current;
  const [npArtist, setNpArtist] = useState('');
  const npArtistCache = useRef<{ [url: string]: string }>({});

  useEffect(() => {
    if (npVisible) {
      setNpMounted(true);
    } else if (npMounted) {
      Animated.timing(npAnim, {
        toValue: 0,
        duration: settings.animationsEnabled ? 240 : 0,
        useNativeDriver: true,
      }).start(() => setNpMounted(false));
    }
  }, [npVisible]);

  useEffect(() => {
    if (npMounted && npVisible) {
      Animated.timing(npAnim, {
        toValue: 1,
        duration: settings.animationsEnabled ? 300 : 0,
        useNativeDriver: true,
      }).start();
    }
  }, [npMounted]);

  useEffect(() => {
    if (!nowPlaying) setNpVisible(false);
  }, [nowPlaying]);

  useEffect(() => {
    if (!npVisible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setNpVisible(false);
      return true;
    });
    return () => sub.remove();
  }, [npVisible]);

  useEffect(() => {
    if (!npVisible || !nowPlaying) return;
    const url = nowPlaying.url;
    const cached = npArtistCache.current[url];
    if (cached !== undefined) {
      setNpArtist(cached);
      setNpChannelUrl(npChannelCache.current[url] || '');
      return;
    }
    setNpArtist('');
    setNpChannelUrl('');
    let cancelled = false;
    getTrackMeta(url)
      .then(meta => {
        const name = (meta.uploader || '').replace(/\s*-\s*Topic$/i, '').trim();
        npArtistCache.current[url] = name;
        npChannelCache.current[url] = meta.uploaderUrl || '';
        if (!cancelled) setNpChannelUrl(meta.uploaderUrl || '');
        if (!cancelled) setNpArtist(name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [npVisible, nowPlaying?.url]);

  const videoText =
    settings.language === 'uk'
      ? { watch: 'Дивитися відео', opening: 'Відкриваю відео…', failed: 'Не вдалося відтворити відео' }
      : { watch: 'Watch video', opening: 'Opening video…', failed: 'Could not play the video' };
  const videoBusyRef = useRef(false);

  // Pauses the audio, plays the video full screen, then hands the position back to the audio.
  async function watchVideo(track: Track) {
    if (videoBusyRef.current) return;
    videoBusyRef.current = true;
    const sameTrack = nowPlaying?.url === track.url;
    const wasPlaying = playing;
    let startSec = 0;
    if (sameTrack) {
      try {
        startSec = TrackPlayer.getProgress().position || 0;
      } catch {
        startSec = progress.position || 0;
      }
    }
    logDebug(`Video: opening "${track.name}" at ${formatTime(startSec)}`);
    ToastAndroid.show(videoText.opening, ToastAndroid.SHORT);
    try {
      TrackPlayer.pause();
    } catch {
      // ignore
    }
    try {
      const res = await playVideo(track.url, startSec, 1080);
      const stoppedAt = (res?.positionMs ?? 0) / 1000;
      logDebug(
        `Video: closed at ${formatTime(stoppedAt)}${res?.ended ? ' (ended)' : ''} [${res?.label ?? ''}]${
          res?.error ? ` error: ${res.error}` : ''
        }`,
      );
      if (res?.error) ToastAndroid.show(videoText.failed, ToastAndroid.LONG);
      if (sameTrack && expectedUrlRef.current === track.url) {
        if (res?.ended) {
          if (settings.autoplay) goNextRef.current();
        } else if (!res?.error) {
          TrackPlayer.seekTo(stoppedAt);
          TrackPlayer.play();
        } else if (wasPlaying) {
          TrackPlayer.play();
        }
      } else if (wasPlaying) {
        TrackPlayer.play();
      }
    } catch (e: any) {
      logDebug(`Video failed: ${e?.message ?? e}`);
      ToastAndroid.show(videoText.failed, ToastAndroid.LONG);
      if (wasPlaying) {
        try {
          TrackPlayer.play();
        } catch {
          // ignore
        }
      }
    } finally {
      videoBusyRef.current = false;
    }
  }

  const videoTabText =
    settings.language === 'uk'
      ? {
          tab: 'Відео',
          placeholder: 'Знайти відео',
          watchShort: 'Дивитись',
          empty: 'Нічого не знайдено',
          searchFailed: 'Помилка пошуку відео',
        }
      : {
          tab: 'Video',
          placeholder: 'Search for videos',
          watchShort: 'Watch',
          empty: 'No videos found',
          searchFailed: 'Video search failed',
        };

  const [videoQuery, setVideoQuery] = useState('');
  const [videoResults, setVideoResults] = useState<VideoSearchResult[]>([]);
  const [videoSearching, setVideoSearching] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    const q = videoQuery.trim();
    if (!q) {
      setVideoResults([]);
      setVideoError(null);
      return;
    }
    const id = setTimeout(async () => {
      setVideoSearching(true);
      setVideoError(null);
      logDebug(`Video search: "${q}"`);
      try {
        if (/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com\/watch|youtu\.be\/)/i.test(q)) {
          const meta = await getTrackMeta(q);
          setVideoResults([
            {
              url: q,
              name: meta.title || q,
              thumbnailUrl: '',
              uploader: meta.uploader || '',
              duration: Number(meta.duration) || 0,
            },
          ]);
          logDebug(`Video link resolved: ${meta.title}`);
        } else {
          const found = await searchVideoOnly(q);
          setVideoResults(found);
          logDebug(`Video results: ${found.length} for "${q}"`);
        }
      } catch (e: any) {
        setVideoError(e?.message ?? videoTabText.searchFailed);
        setVideoResults([]);
        logDebug(`Video search failed: ${e?.message ?? e}`);
      } finally {
        setVideoSearching(false);
      }
    }, 600);
    return () => clearTimeout(id);
  }, [videoQuery]);

  function formatLong(seconds: number): string {
    if (!isFinite(seconds) || seconds <= 0) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  function renderVideoRow(v: VideoSearchResult, linkChannel: boolean = true) {
    const isCurrentVideo = nowPlaying?.url === v.url;
    const asTrack: Track = { url: v.url, name: v.name, thumbnailUrl: v.thumbnailUrl };
    const canOpenChannel = linkChannel && !!v.uploaderUrl;
    return (
      <TouchableOpacity key={v.url} style={styles.videoRow} onPress={() => watchVideo(asTrack)}>
        <View style={styles.videoThumbWrap}>
          {v.thumbnailUrl ? (
            <FadeImage uri={v.thumbnailUrl} style={styles.videoThumb} enabled={settings.animationsEnabled} />
          ) : (
            <View style={styles.videoThumb} />
          )}
          {v.duration > 0 && (
            <View style={styles.videoDuration}>
              <Text style={styles.videoDurationText}>{formatLong(v.duration)}</Text>
            </View>
          )}
        </View>
        <View style={styles.videoInfo}>
          <Text
            style={[styles.trackTitle, isCurrentVideo && { color: resolvedAccent }]}
            numberOfLines={2}
          >
            {v.name}
          </Text>
          {v.uploader ? (
            <Text
              style={[styles.playlistSubtitle, canOpenChannel && { color: resolvedAccent }]}
              numberOfLines={1}
              onPress={
                canOpenChannel
                  ? () => openChannel({ url: v.uploaderUrl as string, name: v.uploader }, view)
                  : undefined
              }
            >
              {v.uploader}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity hitSlop={10} onPress={() => playAtIndex([asTrack], 0, true)}>
          <Headphones size={18} color={TEXT_DIM} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  const channelText =
    settings.language === 'uk'
      ? {
          follow: 'Стежити',
          following: 'Ви стежите',
          followingTitle: 'Підписки',
          noFollowing: 'Ви ще ні за ким не стежите. Відкрийте канал і натисніть «Стежити».',
          videos: 'Відео',
          playlists: 'Плейлисти',
          subscribers: 'підписників',
          empty: 'Тут поки нічого немає',
          failed: 'Не вдалося завантажити канал',
          loading: 'Завантаження…',
          followedToast: 'Ви стежите за каналом',
          unfollowedToast: 'Ви більше не стежите за каналом',
        }
      : {
          follow: 'Follow',
          following: 'Following',
          followingTitle: 'Following',
          noFollowing: 'You are not following any channels yet. Open a channel and press Follow.',
          videos: 'Videos',
          playlists: 'Playlists',
          subscribers: 'subscribers',
          empty: 'Nothing here yet',
          failed: 'Could not load this channel',
          loading: 'Loading…',
          followedToast: 'Following this channel',
          unfollowedToast: 'Unfollowed this channel',
        };

  const [channelFrom, setChannelFrom] = useState<ViewName>('video');
  const [channel, setChannel] = useState<ChannelHeader | null>(null);
  const [channelTab, setChannelTab] = useState<'videos' | 'playlists'>('videos');
  const [channelVideos, setChannelVideos] = useState<VideoSearchResult[]>([]);
  const [channelPlaylists, setChannelPlaylists] = useState<PlaylistResult[]>([]);
  const [channelNext, setChannelNext] = useState<{ videos: string | null; playlists: string | null }>({
    videos: '',
    playlists: '',
  });
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const channelTokenRef = useRef(0);
  const [remoteBackTo, setRemoteBackTo] = useState<ViewName>('search');
  const [following, setFollowing] = useState<FollowedChannel[]>([]);
  const [followingLoaded, setFollowingLoaded] = useState(false);
  const [npChannelUrl, setNpChannelUrl] = useState('');
  const npChannelCache = useRef<{ [url: string]: string }>({});

  useEffect(() => {
    loadFollowing().then(f => {
      setFollowing(prev => [...prev, ...f.filter(x => !prev.some(p => p.url === x.url))]);
      setFollowingLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!followingLoaded) return;
    saveFollowing(following);
  }, [following, followingLoaded]);

  function formatCount(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K`;
    return String(n);
  }

  function openChannel(c: { url: string; name?: string; avatarUrl?: string }, from: ViewName = view) {
    if (!c.url) return;
    const token = ++channelTokenRef.current;
    logDebug(`Opening channel: ${c.name || c.url}`);
    setChannelFrom(from);
    setChannel({
      url: c.url,
      name: c.name ?? '',
      avatarUrl: c.avatarUrl ?? '',
      subscribers: -1,
      hasVideos: true,
      hasPlaylists: false,
    });
    setChannelTab('videos');
    setChannelVideos([]);
    setChannelPlaylists([]);
    setChannelNext({ videos: '', playlists: '' });
    setChannelLoading(true);
    setChannelError(null);
    changeView('channel');
    (async () => {
      try {
        const header = await getChannel(c.url);
        if (token !== channelTokenRef.current) return;
        setChannel(header);
        const page = await getChannelTab(header.url, 'videos', '');
        if (token !== channelTokenRef.current) return;
        setChannelVideos(page.items as VideoSearchResult[]);
        setChannelNext(prev => ({ ...prev, videos: page.next || null }));
        logDebug(
          `Channel loaded: ${header.name} (${page.items.length} videos${header.hasPlaylists ? ', has playlists' : ''})`,
        );
      } catch (e: any) {
        if (token !== channelTokenRef.current) return;
        setChannelError(channelText.failed);
        logDebug(`Channel failed: ${e?.message ?? e}`);
      } finally {
        if (token === channelTokenRef.current) setChannelLoading(false);
      }
    })();
  }

  async function loadChannelTab(tab: 'videos' | 'playlists') {
    if (!channel || channelLoading) return;
    const state = channelNext[tab];
    if (state === null) return;
    if (tab === 'videos' && state === '') return;
    const token = channelTokenRef.current;
    setChannelLoading(true);
    try {
      const page = await getChannelTab(channel.url, tab, state);
      if (token !== channelTokenRef.current) return;
      if (tab === 'videos') {
        const more = page.items as VideoSearchResult[];
        setChannelVideos(prev => [...prev, ...more.filter(i => !prev.some(p => p.url === i.url))]);
      } else {
        const more = page.items as PlaylistResult[];
        setChannelPlaylists(prev => [...prev, ...more.filter(i => !prev.some(p => p.url === i.url))]);
      }
      setChannelNext(prev => ({ ...prev, [tab]: page.next || null }));
      logDebug(`Channel ${tab}: ${page.items.length} more`);
    } catch (e: any) {
      if (token !== channelTokenRef.current) return;
      setChannelError(channelText.failed);
      logDebug(`Channel ${tab} failed: ${e?.message ?? e}`);
    } finally {
      if (token === channelTokenRef.current) setChannelLoading(false);
    }
  }

  function selectChannelTab(tab: 'videos' | 'playlists') {
    setChannelTab(tab);
    if (tab === 'playlists' && channelNext.playlists === '' && channelPlaylists.length === 0) {
      loadChannelTab('playlists');
    }
  }

  function toggleFollow() {
    if (!channel) return;
    const url = channel.url;
    const isOn = following.some(f => f.url === url);
    setFollowing(prev =>
      isOn
        ? prev.filter(f => f.url !== url)
        : [{ url, name: channel.name, avatarUrl: channel.avatarUrl }, ...prev],
    );
    logDebug(`${isOn ? 'Unfollowed' : 'Followed'} channel: ${channel.name}`);
    ToastAndroid.show(isOn ? channelText.unfollowedToast : channelText.followedToast, ToastAndroid.SHORT);
  }

  function recordHistory(track: Track) {
    setHistory(prev => [track, ...prev.filter(h => h.url !== track.url)].slice(0, HISTORY_MAX));
  }

  function handleClearHistory() {
    logDebug('Play history cleared');
    setHistory([]);
  }

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

  function saveProgressNow(verbose = true) {
    if (!sessionReadyRef.current) return;
    if (playbackStateRef.current.queue.length === 0) return;
    const pending = pendingSeekRef.current;
    const url = pending ? pending.url : expectedUrlRef.current;
    if (!url) return;
    let { position, duration } = progressRef.current;
    try {
      // The progress hook runs on JS timers, which stop with the screen off: ask the native player.
      const nativeProgress = TrackPlayer.getProgress();
      if (nativeProgress && nativeProgress.duration > 0) {
        position = nativeProgress.position;
        duration = nativeProgress.duration;
      }
    } catch {
      // keep the hook values
    }
    let safePosition = pending ? pending.position : Math.max(0, position);
    // Within 5 s of the end: save 0, so a restored session never lands in
    // the end-of-track window (which would trigger an instant advance).
    if (!pending && duration > 0 && position > duration - 5) safePosition = 0;
    if (verbose) {
      logDebug(`Position saved: ${formatTime(safePosition)}, volume ${Math.round(volumeRef.current * 100)}%`);
    }
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

        if (startAt > 1) {
          pendingSeekRef.current = { url: track.url, position: startAt };
          logDebug(`Saved position pending: ${formatTime(startAt)} (applied once the player is ready)`);
        }
        if (item) {
          expectedUrlRef.current = track.url;
          let attempts = 0;
          let loadedNatively = false;
          while (attempts < 12 && !loadedNatively) {
            if (expectedUrlRef.current !== track.url || playRequestRef.current !== 0) break;
            attempts++;
            try {
              TrackPlayer.setMediaItems([item]);
              await new Promise<void>(resolve => setTimeout(() => resolve(), 250));
              const nativeQueueLength = TrackPlayer.getQueue().length;
              loadedNatively = nativeQueueLength > 0;
              logDebug(`Restore load attempt ${attempts}: native queue length=${nativeQueueLength}, progress=${JSON.stringify(TrackPlayer.getProgress())}`);
            } catch (loadErr: any) {
              logDebug(`Restore load attempt ${attempts} failed: ${loadErr?.message ?? loadErr}`);
            }
          }
          logDebug(`Restore load: attempts=${attempts}, loaded=${loadedNatively}`);
          if (playRequestRef.current !== 0) {
            logDebug('Session restore aborted: playback was started meanwhile');
            return;
          }
          if (!loadedNatively) expectedUrlRef.current = null;
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

  // JS timers are paused while the app is in the background, so the debounced save below may never run: save right away instead.
  useEffect(() => {
    if (!sessionReady || queue.length === 0) return;
    if (AppState.currentState === 'active') return;
    void saveSession({ queue, queueIndex, shuffleOn, shuffleOrder, shufflePos, repeatMode });
    saveProgressNow();
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
    const id = setInterval(() => saveProgressNow(false), 10000);
    return () => clearInterval(id);
  }, [playing]);

  // Position: when the app goes to the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      logDebug(`App state: ${state}`);
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
        if (expectedUrlRef.current) {
          pendingSeekRef.current = null;
          logDebug('Saved position dropped: a different track is loaded now');
        }
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
    logDebug('Build: restore-debug v2');
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
    loadHistory().then(h => {
      setHistory(prev =>
        [...prev, ...h.filter(x => !prev.some(p => p.url === x.url))].slice(0, HISTORY_MAX),
      );
      setHistoryLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    saveHistory(history);
  }, [history, historyLoaded]);

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
      : viewingPlaylistId === 'history'
      ? historyText.title
      : playlists.find(p => p.id === viewingPlaylistId)?.name ?? '';

  const viewingPlaylistTracks: Track[] =
    viewingPlaylistId === 'liked'
      ? likedSongs
      : viewingPlaylistId === 'downloaded'
      ? downloads.map(d => ({ url: d.url, name: d.name, thumbnailUrl: d.thumbnailUrl }))
      : viewingPlaylistId === 'history'
      ? history
      : playlists.find(p => p.id === viewingPlaylistId)?.tracks ?? [];

  const sortText =
    settings.language === 'uk'
      ? {
          filter: 'Фільтр пісень',
          modes:
            viewingPlaylistId === 'history'
              ? { default: 'Нещодавні', reverse: 'Старіші', az: 'А–Я', za: 'Я–А' }
              : { default: 'Як додано', reverse: 'Спочатку нові', az: 'А–Я', za: 'Я–А' },
        }
      : {
          filter: 'Filter songs',
          modes:
            viewingPlaylistId === 'history'
              ? { default: 'Most recent', reverse: 'Oldest', az: 'A–Z', za: 'Z–A' }
              : { default: 'Added order', reverse: 'Newest added', az: 'A–Z', za: 'Z–A' },
        };

  // The list actually shown on the playlist screen: filtered, then sorted.
  let shownTracks: Track[] = viewingPlaylistId === 'remote' ? remote.tracks : viewingPlaylistTracks;
  const filterNeedle = filterText.trim().toLowerCase();
  if (filterNeedle) {
    shownTracks = shownTracks.filter(tr => tr.name.toLowerCase().includes(filterNeedle));
  }
  if (sortMode === 'reverse') {
    shownTracks = [...shownTracks].reverse();
  } else if (sortMode === 'az') {
    shownTracks = [...shownTracks].sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortMode === 'za') {
    shownTracks = [...shownTracks].sort((a, b) => b.name.localeCompare(a.name));
  }
  const sortLabel = sortText.modes[sortMode];

  // Lyrics: which synced line is current, and scrolling it into view.
  const showLyrics = lyricsUrl === (nowPlaying?.url ?? null);
  let activeLyric = -1;
  if (lyricsVisible && showLyrics && lyricsData && lyricsData.synced) {
    const lyricPos = progress.position + 0.3;
    for (let i = 0; i < lyricsData.synced.length; i++) {
      if (lyricsData.synced[i].time <= lyricPos) activeLyric = i;
      else break;
    }
  }
  useEffect(() => {
    if (!lyricsVisible || activeLyric < 0) return;
    const y = lyricsLineY.current[activeLyric];
    if (y === undefined) return;
    lyricsScrollRef.current?.scrollTo({
      y: Math.max(0, y - lyricsViewH.current / 3),
      animated: true,
    });
  }, [activeLyric, lyricsVisible]);
  const libraryTabActive =
    view === 'library' ||
    view === 'following' ||
    (view === 'playlist' && viewingPlaylistId !== 'remote') ||
    (view === 'channel' && (channelFrom === 'library' || channelFrom === 'playlist' || channelFrom === 'following'));
  const videoTabActive = view === 'video' || (view === 'channel' && channelFrom === 'video');
  const searchTabActive =
    view === 'search' ||
    (view === 'playlist' && viewingPlaylistId === 'remote') ||
    (view === 'channel' && channelFrom === 'search');

  function cycleSort() {
    setSortMode(m => (m === 'default' ? 'reverse' : m === 'reverse' ? 'az' : m === 'az' ? 'za' : 'default'));
  }

  // Only real user playlists (not the virtual Liked/Downloaded ones) can
  // have a track removed from them.
  const removablePlaylistId =
    view === 'playlist' &&
    viewingPlaylistId &&
    viewingPlaylistId !== 'liked' &&
    viewingPlaylistId !== 'downloaded' &&
    viewingPlaylistId !== 'history' &&
    viewingPlaylistId !== 'remote'
      ? viewingPlaylistId
      : null;

  // --- Sleep timer: runs natively (survives a dark screen); JS only shows the countdown ---
  useEffect(() => {
    if (sleepEndAt === null) {
      setSleepMinutesLeft(0);
      return;
    }
    const tick = () => {
      try {
        const timer = TrackPlayer.getSleepTimer();
        if (!timer || timer.type !== 'time') {
          logDebug('Sleep timer is no longer active natively -> clearing');
          setSleepEndAt(null);
          return;
        }
        setSleepMinutesLeft(Math.max(1, Math.ceil(timer.remainingSeconds / 60)));
      } catch (e: any) {
        logDebug(`Sleep timer read failed: ${e?.message ?? e}`);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleepEndAt]);

  useEffect(() => {
    const sub = TrackPlayer.addEventListener(Event.SleepTimerTriggered, (e: any) => {
      logDebug(`Sleep timer triggered natively (${e?.type ?? 'time'}) -> playback paused`);
      setSleepEndAt(null);
    });
    return () => sub.remove();
  }, []);

  function startSleepTimer(minutes: number) {
    try {
      if (minutes <= 0) {
        TrackPlayer.cancelSleepTimer();
        logDebug('Sleep timer cancelled');
        setSleepEndAt(null);
      } else {
        TrackPlayer.sleepAfterTime(minutes * 60);
        logDebug(`Sleep timer set natively: ${minutes} min`);
        setSleepEndAt(Date.now() + minutes * 60000);
      }
    } catch (e: any) {
      logDebug(`Sleep timer failed: ${e?.message ?? e}`);
    }
    setSleepModalVisible(false);
  }

  const sleepText =
    settings.language === 'uk'
      ? { title: 'Таймер сну', minutes: 'хв', off: 'Вимкнути таймер' }
      : { title: 'Sleep timer', minutes: 'min', off: 'Turn timer off' };
  const sleepOptions = settings.developerMode ? [1, 15, 30, 45, 60] : [15, 30, 45, 60];

  const shareLabel = settings.language === 'uk' ? 'Поділитися' : 'Share';

  async function handleShareTrack(item: Track) {
    logDebug(`Share: ${item.name}`);
    setAddToPlaylistTarget(null);
    try {
      await Share.share({ message: `${item.name}\n${item.url}` });
    } catch (e: any) {
      logDebug(`Share failed: ${e?.message ?? e}`);
    }
  }

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
      recordHistory(s.queue[idx]);
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
      const typed = query.trim();
      if (
        /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(typed) &&
        /[?&]list=[\w-]+/i.test(typed)
      ) {
        logDebug(`Playlist link pasted: ${typed}`);
        openRemotePlaylist({ url: typed });
        return;
      }
      setSearching(true);
      setSearchError(null);
      logDebug(`Searching: "${query}"`);
      try {
        if (searchMode === 'playlists') {
          const foundPlaylists = await searchPlaylists(query);
          setPlaylistResults(foundPlaylists);
          logDebug(`Playlist results: ${foundPlaylists.length} for "${query}"`);
          return;
        }
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
  }, [query, searchMode]);

  const fadeInAfterCommitRef = useRef(false);
  useEffect(() => {
    if (!fadeInAfterCommitRef.current) return;
    fadeInAfterCommitRef.current = false;
    // one more frame, so the new screen is on screen at opacity 0 before it fades in
    const id = requestAnimationFrame(() => {
      Animated.timing(viewOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    });
    return () => cancelAnimationFrame(id);
  }, [view]);

  function changeView(newView: ViewName) {
    if (newView === view) return;
    logDebug(`View: ${view} -> ${newView}`);
    setSelected([]);

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
      fadeInAfterCommitRef.current = true;
      setView(newView);
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

  const wifiText =
    settings.language === 'uk'
      ? {
          label: 'Завантаження лише через Wi-Fi',
          desc: 'Не завантажувати пісні через мобільні дані',
          blocked: 'Підключіться до Wi-Fi, щоб завантажувати',
        }
      : {
          label: 'Wi-Fi only downloads',
          desc: 'Do not download songs on mobile data',
          blocked: 'Connect to Wi-Fi to download (Wi-Fi only is on)',
        };

  // True when downloads may start: the setting is off, or the phone is on Wi-Fi.
  async function downloadsAllowed(): Promise<boolean> {
    if (!settings.wifiOnlyDownloads) return true;
    let onWifi = true;
    try {
      onWifi = await isOnWifi();
    } catch (e: any) {
      logDebug(`Wi-Fi check failed (${e?.message ?? e}); allowing the download`);
    }
    if (!onWifi) {
      logDebug('Download blocked: Wi-Fi only is on and the phone is not on Wi-Fi');
      ToastAndroid.show(wifiText.blocked, ToastAndroid.LONG);
    }
    return onWifi;
  }

  async function handleDownloadTrack(item: Track) {
    if (isDownloaded(item.url) || downloadingUrls.has(item.url)) return;
    if (!(await downloadsAllowed())) return;

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
    setSortMode('default');
    setFilterText('');
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
    if (pendingSeekRef.current?.url === currentUrl) {
      logDebug('Next-track queueing held back until the saved position is applied');
      return;
    }

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
      recordHistory(item);
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
      let nativeEmpty = false;
      try {
        nativeEmpty = TrackPlayer.getQueue().length === 0 || progressRef.current.duration <= 0;
      } catch {
        nativeEmpty = true;
      }
      if ((!expectedUrlRef.current || nativeEmpty) && nowPlaying && queue.length > 0) {
        logDebug(`Play pressed but nothing is playable natively (expectedUrl=${!!expectedUrlRef.current}, nativeEmpty=${nativeEmpty}, duration=${progressRef.current.duration}) -> loading current track`);
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
          const resetResult = await resetAllData();
          logDebug(`Reset: ${resetResult}`);
          setSessionReady(false);
          setQueue([]);
          setQueueIndex(0);
          setShuffleOrder([]);
          setShufflePos(0);
          setNowPlaying(null);
          expectedUrlRef.current = null;
          nextQueuedRef.current = null;
          pendingSeekRef.current = null;
          try {
            TrackPlayer.clear();
          } catch (clearErr: any) {
            logDebug(`Reset: could not clear the native queue: ${clearErr?.message ?? clearErr}`);
          }
          logDebug(`Reset: session keys -> ${await clearSession()}`);
          setLikedSongs([]);
          setPlaylists([]);
          setDownloads([]);
          setFollowing([]);
          setHistory([]);
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

  function renderPlaylistRow(p: PlaylistResult) {
    const subtitle =
      p.count > 0
        ? `${p.uploader ? p.uploader + ' · ' : ''}${t.songsCount(p.count)}`
        : p.uploader;
    return (
      <TouchableOpacity key={p.url} style={styles.trackRow} onPress={() => openRemotePlaylist(p)}>
        {p.thumbnailUrl ? (
          <Image source={{ uri: p.thumbnailUrl }} style={styles.trackArt} />
        ) : (
          <View style={styles.trackArt} />
        )}
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={2}>
            {p.name}
          </Text>
          {subtitle ? (
            <Text style={styles.playlistSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }

  function renderTrackRow(item: SearchResult, index: number, list: SearchResult[]) {
    const isCurrentRow = nowPlaying?.url === item.url;
    return (
      <TouchableOpacity
        key={item.url}
        style={[styles.trackRow, isCurrentRow && { backgroundColor: resolvedAccent + '22' }]}
        onPress={() =>
          selected.length > 0 ? toggleSelect(item) : playAtIndex(list, index, true)
        }
        onLongPress={() => toggleSelect(item)}
        disabled={loadingTrack === item.url}
      >
        {selected.length > 0 ? (
          <View
            style={[
              styles.selectBox,
              isSelected(item.url) && { backgroundColor: resolvedAccent, borderColor: resolvedAccent },
            ]}
          >
            {isSelected(item.url) && <Check size={12} color="#FFFFFF" />}
          </View>
        ) : (
          isCurrentRow ? (
            <NowPlayingBars color={resolvedAccent} active={playing && settings.animationsEnabled} />
          ) : (
            <Text style={styles.trackIndex}>{index + 1}</Text>
          )
        )}
        {item.thumbnailUrl ? (
          <FadeImage uri={item.thumbnailUrl} style={styles.trackArt} enabled={settings.animationsEnabled} />
        ) : (
          <View style={styles.trackArt} />
        )}
        <View style={styles.trackInfo}>
          <Text style={[styles.trackTitle, isCurrentRow && { color: resolvedAccent }]} numberOfLines={2}>
            {item.name}
          </Text>
        </View>
        {selected.length > 0 ? null : loadingTrack === item.url ? (
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

      <Animated.View
        style={{
          flex: 1,
          opacity: viewOpacity,
          transform: [{ translateY: viewOpacity.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        }}
      >
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

            <View style={styles.searchModeRow}>
              <TouchableOpacity
                style={[
                  styles.searchModePill,
                  searchMode === 'songs' && { backgroundColor: resolvedAccent, borderColor: resolvedAccent },
                ]}
                onPress={() => setSearchMode('songs')}
              >
                <Text style={styles.searchModePillText}>{remoteText.songs}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.searchModePill,
                  searchMode === 'playlists' && { backgroundColor: resolvedAccent, borderColor: resolvedAccent },
                ]}
                onPress={() => setSearchMode('playlists')}
              >
                <Text style={styles.searchModePillText}>{remoteText.playlists}</Text>
              </TouchableOpacity>
            </View>

            {searching && (
              <ActivityIndicator style={styles.loadingIndicator} color={resolvedAccent} />
            )}

            {searchError && <Text style={styles.errorText}>{searchError}</Text>}

            <FlatList
              data={(searchMode === 'songs' ? results : playlistResults) as any[]}
              keyExtractor={item => item.url}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: bottomPad },
              ]}
              renderItem={({ item, index }) =>
                <FadeInRow index={index} enabled={settings.animationsEnabled}>
                  {searchMode === 'songs' ? renderTrackRow(item, index, results) : renderPlaylistRow(item as any)}
                </FadeInRow>
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
                    onPress={() => openPlaylistView('history')}
                  >
                    <View style={styles.playlistIcon}>
                      <Clock size={20} color={resolvedAccent} />
                    </View>
                    <View style={styles.trackInfo}>
                      <Text style={styles.trackTitle}>{historyText.title}</Text>
                      <Text style={styles.playlistSubtitle}>
                        {t.songsCount(history.length)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.playlistRow} onPress={() => changeView('following')}>
                    <View style={styles.playlistIcon}>
                      <Users size={20} color={resolvedAccent} />
                    </View>
                    <View style={styles.trackInfo}>
                      <Text style={styles.trackTitle}>{channelText.followingTitle}</Text>
                      <Text style={styles.playlistSubtitle}>{following.length}</Text>
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
              <TouchableOpacity onPress={() => changeView(viewingPlaylistId === 'remote' ? remoteBackTo : 'library')} hitSlop={10}>
                <ChevronLeft size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.playlistDetailTitle} numberOfLines={1}>
                {viewingPlaylistId === 'remote' ? remote.name || remoteText.loading : viewingPlaylistName}
              </Text>
            </View>
            {shownTracks.length > 0 && (
              <View style={styles.listActionsRow}>
                <TouchableOpacity
                  style={[styles.actionPill, { backgroundColor: resolvedAccent, borderColor: resolvedAccent }]}
                  onPress={playAllShown}
                >
                  <Play size={14} color="#FFFFFF" fill="#FFFFFF" />
                  <Text style={styles.actionPillText}>{remoteText.playAll}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionPill} onPress={shuffleShown}>
                  <Shuffle size={14} color="#FFFFFF" />
                  <Text style={styles.actionPillText}>{remoteText.shuffle}</Text>
                </TouchableOpacity>
                {viewingPlaylistId === 'remote' && (
                  <TouchableOpacity style={styles.actionPill} onPress={saveRemotePlaylist}>
                    <Library size={14} color="#FFFFFF" />
                    <Text style={styles.actionPillText}>{remoteText.save}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {viewingPlaylistId === 'remote' && remoteLoading && (
              <ActivityIndicator style={styles.loadingIndicator} color={resolvedAccent} />
            )}
            {viewingPlaylistId === 'remote' && remoteError && (
              <Text style={styles.errorText}>{remoteError}</Text>
            )}
            <View style={styles.listToolsRow}>
              <TextInput
                style={styles.filterInput}
                value={filterText}
                onChangeText={setFilterText}
                placeholder={sortText.filter}
                placeholderTextColor={TEXT_DIM}
              />
              <TouchableOpacity style={styles.sortPill} onPress={cycleSort}>
                <Text style={styles.sortPillText}>{sortLabel}</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={shownTracks}
              keyExtractor={tr => tr.url}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: bottomPad },
              ]}
              renderItem={({ item, index }) =>
                <FadeInRow index={index} enabled={settings.animationsEnabled}>
                  {renderTrackRow(item, index, shownTracks)}
                </FadeInRow>
              }
              ListEmptyComponent={
                <Text style={styles.emptyText}>{t.noSongsYet}</Text>
              }
            />
          </>
        )}

        {view === 'video' && (
          <>
            <View style={styles.header}>
              <Animated.Text style={[styles.headerTitle, { color: animatedAccentColor }]}>
                {videoTabText.tab}
              </Animated.Text>
            </View>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder={videoTabText.placeholder}
                placeholderTextColor={TEXT_DIM}
                value={videoQuery}
                onChangeText={setVideoQuery}
              />
            </View>
            {videoSearching && (
              <ActivityIndicator style={styles.loadingIndicator} color={resolvedAccent} />
            )}
            {videoError && <Text style={styles.errorText}>{videoError}</Text>}
            <FlatList
              data={videoResults}
              keyExtractor={item => item.url}
              contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad }]}
              renderItem={({ item, index }) => (
                <FadeInRow index={index} enabled={settings.animationsEnabled}>
                  {renderVideoRow(item)}
                </FadeInRow>
              )}
              ListEmptyComponent={
                !videoSearching && videoQuery.trim() ? (
                  <Text style={styles.emptyText}>{videoTabText.empty}</Text>
                ) : undefined
              }
            />
          </>
        )}

        {view === 'channel' && channel && (
          <>
            <View style={styles.playlistDetailHeader}>
              <TouchableOpacity onPress={() => changeView(channelFrom)} hitSlop={10}>
                <ChevronLeft size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.playlistDetailTitle} numberOfLines={1}>
                {channel.name || channelText.loading}
              </Text>
            </View>
            <View style={styles.channelHeader}>
              {channel.avatarUrl ? (
                <FadeImage uri={channel.avatarUrl} style={styles.channelAvatar} enabled={settings.animationsEnabled} />
              ) : (
                <View style={styles.channelAvatar} />
              )}
              <View style={styles.channelHeaderInfo}>
                <Text style={styles.trackTitle} numberOfLines={2}>
                  {channel.name}
                </Text>
                {channel.subscribers >= 0 ? (
                  <Text style={styles.playlistSubtitle}>
                    {formatCount(channel.subscribers)} {channelText.subscribers}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={[
                  styles.actionPill,
                  !following.some(f => f.url === channel.url) && {
                    backgroundColor: resolvedAccent,
                    borderColor: resolvedAccent,
                  },
                ]}
                onPress={toggleFollow}
              >
                <Text style={styles.actionPillText}>
                  {following.some(f => f.url === channel.url) ? channelText.following : channelText.follow}
                </Text>
              </TouchableOpacity>
            </View>
            {channel.hasPlaylists && (
              <View style={styles.searchModeRow}>
                <TouchableOpacity
                  style={[
                    styles.searchModePill,
                    channelTab === 'videos' && { backgroundColor: resolvedAccent, borderColor: resolvedAccent },
                  ]}
                  onPress={() => selectChannelTab('videos')}
                >
                  <Text style={styles.searchModePillText}>{channelText.videos}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.searchModePill,
                    channelTab === 'playlists' && { backgroundColor: resolvedAccent, borderColor: resolvedAccent },
                  ]}
                  onPress={() => selectChannelTab('playlists')}
                >
                  <Text style={styles.searchModePillText}>{channelText.playlists}</Text>
                </TouchableOpacity>
              </View>
            )}
            {channelError && <Text style={styles.errorText}>{channelError}</Text>}
            <FlatList
              data={(channelTab === 'videos' ? channelVideos : channelPlaylists) as any[]}
              keyExtractor={item => item.url}
              contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad }]}
              renderItem={({ item, index }) => (
                <FadeInRow index={index} enabled={settings.animationsEnabled}>
                  {channelTab === 'videos' ? renderVideoRow(item, false) : renderPlaylistRow(item)}
                </FadeInRow>
              )}
              onEndReached={() => loadChannelTab(channelTab)}
              onEndReachedThreshold={0.6}
              ListFooterComponent={
                channelLoading ? (
                  <ActivityIndicator style={styles.loadingIndicator} color={resolvedAccent} />
                ) : null
              }
              ListEmptyComponent={
                !channelLoading && !channelError ? (
                  <Text style={styles.emptyText}>{channelText.empty}</Text>
                ) : undefined
              }
            />
          </>
        )}

        {view === 'following' && (
          <>
            <View style={styles.playlistDetailHeader}>
              <TouchableOpacity onPress={() => changeView('library')} hitSlop={10}>
                <ChevronLeft size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.playlistDetailTitle} numberOfLines={1}>
                {channelText.followingTitle}
              </Text>
            </View>
            <FlatList
              data={following}
              keyExtractor={f => f.url}
              contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad }]}
              renderItem={({ item, index }) => (
                <FadeInRow index={index} enabled={settings.animationsEnabled}>
                  <TouchableOpacity
                    style={styles.trackRow}
                    onPress={() => openChannel(item, 'following')}
                  >
                    {item.avatarUrl ? (
                      <FadeImage uri={item.avatarUrl} style={styles.followAvatar} enabled={settings.animationsEnabled} />
                    ) : (
                      <View style={styles.followAvatar} />
                    )}
                    <View style={styles.trackInfo}>
                      <Text style={styles.trackTitle} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>
                    <TouchableOpacity
                      hitSlop={10}
                      onPress={() => setFollowing(prev => prev.filter(f => f.url !== item.url))}
                    >
                      <X size={18} color={TEXT_DIM} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                </FadeInRow>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>{channelText.noFollowing}</Text>}
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
                  label={relatedText.label}
                  description={relatedText.desc}
                  control={
                    <Switch
                      value={settings.relatedSongs}
                      onValueChange={v => updateSetting('relatedSongs', v)}
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
                  label={wifiText.label}
                  description={wifiText.desc}
                  control={
                    <Switch
                      value={settings.wifiOnlyDownloads}
                      onValueChange={v => updateSetting('wifiOnlyDownloads', v)}
                      trackColor={{ true: resolvedAccent, false: BORDER }}
                      thumbColor="#FFFFFF"
                    />
                  }
                />
                <SettingsRow
                  label={backupText.exportLabel}
                  description={backupText.exportDesc}
                  control={
                    <TouchableOpacity
                      style={styles.settingsSecondaryButton}
                      onPress={handleExportBackup}
                    >
                      <Text style={styles.settingsSecondaryButtonText}>{backupText.exportButton}</Text>
                    </TouchableOpacity>
                  }
                />
                <SettingsRow
                  label={backupText.importLabel}
                  description={backupText.importDesc}
                  control={
                    <TouchableOpacity
                      style={styles.settingsSecondaryButton}
                      onPress={handleImportBackup}
                    >
                      <Text style={styles.settingsSecondaryButtonText}>{backupText.importButton}</Text>
                    </TouchableOpacity>
                  }
                />
                <SettingsRow
                  label={historyText.clear}
                  description={historyText.clearDesc}
                  control={
                    <TouchableOpacity
                      style={styles.settingsDangerButton}
                      onPress={handleClearHistory}
                    >
                      <Text style={styles.settingsDangerButtonText}>{historyText.button}</Text>
                    </TouchableOpacity>
                  }
                />
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
            {
              opacity: miniEnter,
              transform: [{ translateY: miniEnter.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }],
            },
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
            <TouchableOpacity onPress={() => setNpVisible(true)} activeOpacity={0.8} hitSlop={6}>
            {nowPlaying.thumbnailUrl ? (
              <FadeImage
                uri={nowPlaying.thumbnailUrl}
                enabled={settings.animationsEnabled}
                style={styles.miniPlayerArt}
              />
            ) : (
              <View style={styles.miniPlayerArt} />
            )}
          </TouchableOpacity>
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
              hitSlop={8}
              onPress={() => watchVideo(nowPlaying)}
              style={[styles.watchPill, { borderColor: resolvedAccent }]}
            >
              <VideoIcon size={14} color={resolvedAccent} />
              <Text style={[styles.watchPillText, { color: resolvedAccent }]}>
                {videoTabText.watchShort}
              </Text>
            </TouchableOpacity>
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
                <TouchableOpacity
                  hitSlop={10}
                  onPress={() => setSleepModalVisible(true)}
                  style={styles.sleepButton}
                >
                  <Moon size={14} color={sleepEndAt !== null ? resolvedAccent : TEXT_DIM} />
                  {sleepEndAt !== null && (
                    <Text style={[styles.sleepButtonText, { color: resolvedAccent }]}>
                      {sleepMinutesLeft}m
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  hitSlop={10}
                  onPress={() => setQueueModalVisible(true)}
                  style={styles.sleepButton}
                >
                  <List size={14} color={upcoming.length > 0 ? resolvedAccent : TEXT_DIM} />
                </TouchableOpacity>
                <TouchableOpacity
                  hitSlop={10}
                  onPress={() => setLyricsVisible(true)}
                  style={styles.sleepButton}
                >
                  <Mic size={14} color={TEXT_DIM} />
                </TouchableOpacity>
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
            <Search size={20} color={searchTabActive ? resolvedAccent : TEXT_DIM} />
            <Animated.Text
              style={[
                styles.tabLabel,
                searchTabActive && styles.tabLabelActive,
                searchTabActive ? { color: animatedAccentColor } : null,
              ]}
            >
              {t.tabSearch}
            </Animated.Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabButton} onPress={() => changeView('video')}>
            <VideoIcon size={20} color={videoTabActive ? resolvedAccent : TEXT_DIM} />
            <Animated.Text
              style={[
                styles.tabLabel,
                videoTabActive && styles.tabLabelActive,
                videoTabActive ? { color: animatedAccentColor } : null,
              ]}
            >
              {videoTabText.tab}
            </Animated.Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => changeView('library')}
          >
            <Library
              size={20}
              color={libraryTabActive ? resolvedAccent : TEXT_DIM}
            />
            <Animated.Text
              style={[
                styles.tabLabel,
                (libraryTabActive) && styles.tabLabelActive,
                libraryTabActive
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

            <TouchableOpacity
              style={styles.modalActionRow}
              onPress={() => {
                if (!addToPlaylistTarget) return;
                const picked = addToPlaylistTarget;
                setAddToPlaylistTarget(null);
                watchVideo(picked);
              }}
            >
              <VideoIcon size={18} color="#FFFFFF" />
              <Text style={styles.modalActionText}>{videoText.watch}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalActionRow}
              onPress={() => {
                if (addToPlaylistTarget) handleShareTrack(addToPlaylistTarget);
              }}
            >
              <Share2 size={18} color="#FFFFFF" />
              <Text style={styles.modalActionText}>{shareLabel}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalActionRow}
              onPress={() => {
                if (!addToPlaylistTarget) return;
                addToQueue(addToPlaylistTarget, 'next');
                setAddToPlaylistTarget(null);
              }}
            >
              <SkipForward size={18} color="#FFFFFF" />
              <Text style={styles.modalActionText}>{queueText.playNext}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalActionRow}
              onPress={() => {
                if (!addToPlaylistTarget) return;
                addToQueue(addToPlaylistTarget, 'end');
                setAddToPlaylistTarget(null);
              }}
            >
              <List size={18} color="#FFFFFF" />
              <Text style={styles.modalActionText}>{queueText.addToQueue}</Text>
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
    <Modal
        visible={sleepModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSleepModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{sleepText.title}</Text>
            {sleepOptions.map(m => (
              <TouchableOpacity
                key={m}
                style={styles.modalActionRow}
                onPress={() => startSleepTimer(m)}
              >
                <Text style={styles.modalActionText}>
                  {m} {sleepText.minutes}
                </Text>
              </TouchableOpacity>
            ))}
            {sleepEndAt !== null && (
              <TouchableOpacity
                style={styles.modalActionRow}
                onPress={() => startSleepTimer(0)}
              >
                <Text style={[styles.modalActionText, { color: LIKE_RED }]}>
                  {sleepText.off}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setSleepModalVisible(false)}
            >
              <Text style={styles.modalCancelText}>{t.cancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    <Modal
        visible={queueModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setQueueModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{queueText.title}</Text>
            {nowPlaying && (
              <Text style={styles.queueNowPlaying} numberOfLines={1}>
                {queueText.nowPlaying}: {nowPlaying.name}
              </Text>
            )}
            <QueueList
              items={upcoming}
              emptyText={queueText.empty}
              onPlay={index => {
                setQueueModalVisible(false);
                playAtIndex(queue, index, false);
              }}
              onRemove={removeFromQueue}
              onReorder={reorderUpcoming}
            />
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setQueueModalVisible(false)}
            >
              <Text style={styles.modalCancelText}>{queueText.close}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    {selected.length > 0 && (
        <View style={styles.selectionBar}>
          <TouchableOpacity hitSlop={10} onPress={() => setSelected([])}>
            <X size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.selectionCount}>{selectText.count(selected.length)}</Text>
          <TouchableOpacity hitSlop={10} onPress={toggleSelectAll}>
            <Text style={styles.selectionAll}>{selectText.all}</Text>
          </TouchableOpacity>
          <TouchableOpacity hitSlop={10} onPress={() => setBulkPlaylistVisible(true)}>
            <Music size={20} color={resolvedAccent} />
          </TouchableOpacity>
          <TouchableOpacity hitSlop={10} onPress={bulkDownload}>
            <Download size={20} color={resolvedAccent} />
          </TouchableOpacity>
          <TouchableOpacity hitSlop={10} onPress={bulkAddToQueue}>
            <List size={20} color={resolvedAccent} />
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={bulkPlaylistVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBulkPlaylistVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t.addToPlaylist}</Text>
            <ScrollView style={styles.modalScroll}>
              {playlists.length === 0 && (
                <Text style={styles.modalEmptyText}>{t.noPlaylistsYet}</Text>
              )}
              {playlists.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.modalRow}
                  onPress={() => bulkAddToPlaylist(p.id)}
                >
                  <Text style={styles.modalRowText}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput
              style={styles.modalInput}
              value={bulkNewName}
              onChangeText={setBulkNewName}
              placeholder={t.myPlaylist}
              placeholderTextColor={TEXT_DIM}
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity onPress={() => setBulkPlaylistVisible(false)}>
                <Text style={styles.modalCancelText}>{t.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalOkButton, { backgroundColor: resolvedAccent }]}
                onPress={bulkCreatePlaylist}
              >
                <Text style={styles.modalOkText}>{t.createButton}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    {npMounted && nowPlaying && (
        <Animated.View
          style={[
            styles.npScreen,
            {
              opacity: npAnim,
              transform: [
                { translateY: npAnim.interpolate({ inputRange: [0, 1], outputRange: [winH * 0.35, 0] }) },
              ],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.npInner,
              {
                backgroundColor: animatedBg,
                paddingTop: insets.top + 8,
                paddingBottom: Math.max(insets.bottom, 0) + 20,
              },
            ]}
          >
            <View style={styles.npHeader}>
              <TouchableOpacity hitSlop={12} onPress={() => setNpVisible(false)}>
                <ChevronDown size={28} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.npArtWrap}>
              <NowPlayingArt
                uri={nowPlaying.thumbnailUrl}
                size={npArtSize}
                enabled={settings.animationsEnabled}
              />
            </View>

            <View style={styles.npInfo}>
              <Text style={styles.npTitle} numberOfLines={2}>
                {nowPlaying.name}
              </Text>
              <Text
                style={[styles.npArtist, npChannelUrl ? { color: resolvedAccent } : null]}
                numberOfLines={1}
                onPress={() => {
                  if (npChannelUrl) {
                    setNpVisible(false);
                    openChannel({ url: npChannelUrl, name: npArtist }, view);
                  }
                }}
              >
                {npArtist || 'YouTube'}
              </Text>
              <TouchableOpacity
                style={[styles.npWatchPill, { borderColor: resolvedAccent }]}
                onPress={() => watchVideo(nowPlaying)}
              >
                <VideoIcon size={18} color={resolvedAccent} />
                <Text style={[styles.npWatchPillText, { color: resolvedAccent }]}>{videoText.watch}</Text>
              </TouchableOpacity>
            </View>

            <View>
              <DraggableBar
                value={progress.duration > 0 ? progress.position / progress.duration : 0}
                onChange={handleSeek}
                height={4}
                commitOnRelease
                fillColor={resolvedAccent}
              />
              <View style={styles.npTimes}>
                <Text style={styles.npTime}>{formatTime(progress.position)}</Text>
                <Text style={styles.npTime}>{formatTime(progress.duration)}</Text>
              </View>
            </View>

            <View style={styles.npTransport}>
              <TouchableOpacity hitSlop={10} onPress={toggleShuffle}>
                <Shuffle size={22} color={shuffleOn ? resolvedAccent : '#FFFFFF'} />
              </TouchableOpacity>
              <TouchableOpacity hitSlop={10} onPress={goPrevious}>
                <SkipBack size={28} color="#FFFFFF" fill="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.npPlay} onPress={togglePlayPause}>
                {playing ? (
                  <Pause size={28} color={BG} fill={BG} />
                ) : (
                  <Play size={28} color={BG} fill={BG} />
                )}
              </TouchableOpacity>
              <TouchableOpacity hitSlop={10} onPress={goNext}>
                <SkipForward size={28} color="#FFFFFF" fill="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity hitSlop={10} onPress={cycleRepeat}>
                {repeatMode === 'one' ? (
                  <Repeat1 size={22} color={resolvedAccent} />
                ) : (
                  <Repeat size={22} color={repeatMode === 'all' ? resolvedAccent : '#FFFFFF'} />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.npActions}>
              <AnimatedHeart
                liked={isLiked(nowPlaying.url)}
                onLikeToggle={() => toggleLike(nowPlaying)}
                size={26}
                animationsEnabled={settings.animationsEnabled}
              />
              <TouchableOpacity hitSlop={10} onPress={() => setLyricsVisible(true)}>
                <Mic size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity hitSlop={10} onPress={() => setQueueModalVisible(true)}>
                <List size={24} color={upcoming.length > 0 ? resolvedAccent : '#FFFFFF'} />
              </TouchableOpacity>
              <TouchableOpacity hitSlop={10} onPress={() => watchVideo(nowPlaying)}>
                <VideoIcon size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity
                hitSlop={10}
                style={styles.sleepButton}
                onPress={() => setSleepModalVisible(true)}
              >
                <Moon size={24} color={sleepEndAt !== null ? resolvedAccent : '#FFFFFF'} />
                {sleepEndAt !== null && (
                  <Text style={[styles.sleepButtonText, { color: resolvedAccent }]}>
                    {sleepMinutesLeft}m
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.npVolume}>
              <Volume2 size={18} color={TEXT_DIM} />
              <View style={{ flex: 1 }}>
                <DraggableBar value={volume} onChange={setVolume} height={4} fillColor={resolvedAccent} />
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      )}

      <Modal
        visible={lyricsVisible}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setLyricsVisible(false)}
      >
        <View style={[styles.lyricsScreen, { backgroundColor: resolvedBg, paddingTop: insets.top + 8 }]}>
          <View style={styles.lyricsHeader}>
            <TouchableOpacity hitSlop={10} onPress={() => setLyricsVisible(false)}>
              <ChevronDown size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.lyricsTitle} numberOfLines={1}>
              {nowPlaying ? nowPlaying.name : ''}
            </Text>
          </View>

          {lyricsState === 'idle' ||
          lyricsState === 'loading' ||
          (lyricsState === 'ready' && !showLyrics) ? (
            <View style={styles.lyricsCenter}>
              <ActivityIndicator color={resolvedAccent} />
            </View>
          ) : lyricsState === 'ready' && lyricsData ? (
            lyricsData.synced ? (
              <ScrollView
                ref={lyricsScrollRef}
                style={styles.lyricsScroll}
                contentContainerStyle={styles.lyricsContent}
                onLayout={e => {
                  lyricsViewH.current = e.nativeEvent.layout.height;
                }}
              >
                {lyricsData.synced.map((ln, i) => (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.7}
                    onLayout={e => {
                      lyricsLineY.current[i] = e.nativeEvent.layout.y;
                    }}
                    onPress={() => TrackPlayer.seekTo(ln.time)}
                  >
                    <Text style={[styles.lyricsLine, i === activeLyric && { color: resolvedAccent }]}>
                      {ln.text || '♪'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : lyricsData.plain ? (
              <ScrollView style={styles.lyricsScroll} contentContainerStyle={styles.lyricsContent}>
                <Text style={styles.lyricsPlain}>{lyricsData.plain}</Text>
              </ScrollView>
            ) : (
              <View style={styles.lyricsCenter}>
                <Text style={styles.lyricsMessage}>{lyricsText.instrumental}</Text>
              </View>
            )
          ) : (
            <View style={styles.lyricsCenter}>
              <Text style={styles.lyricsMessage}>
                {lyricsState === 'error' ? lyricsText.error : lyricsText.none}
              </Text>
              <TouchableOpacity
                style={styles.actionPill}
                onPress={() => {
                  lyricsForRef.current = null;
                  setLyricsRetry(n => n + 1);
                }}
              >
                <Text style={styles.actionPillText}>{lyricsText.retry}</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.lyricsCredit}>{lyricsText.credit}</Text>
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
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 14,
  },
  channelAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: BORDER },
  channelHeaderInfo: { flex: 1 },
  followAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: BORDER, marginRight: 12 },
  videoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  videoThumbWrap: { width: 128, height: 72 },
  videoThumb: { width: 128, height: 72, borderRadius: 8, backgroundColor: BORDER },
  videoDuration: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  videoDurationText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  videoInfo: { flex: 1 },
  watchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 8,
  },
  watchPillText: { fontSize: 12, fontWeight: '700' },
  npWatchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginTop: 8,
  },
  npWatchPillText: { fontSize: 14, fontWeight: '700' },
  npScreen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 30, elevation: 12 },
  npInner: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between' },
  npHeader: { flexDirection: 'row', alignItems: 'center', height: 40 },
  npArtWrap: { alignItems: 'center' },
  npArt: {
    borderRadius: 14,
    backgroundColor: BORDER,
    justifyContent: 'center',
    alignItems: 'center',
  },
  npInfo: { alignItems: 'center', gap: 4 },
  npTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  npArtist: { color: TEXT_DIM, fontSize: 15, textAlign: 'center' },
  npTimes: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  npTime: { color: TEXT_DIM, fontSize: 12 },
  npTransport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  npPlay: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  npActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 36 },
  npVolume: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eqWrap: {
    width: 22,
    height: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  eqBar: { width: 3, height: 14, borderRadius: 1.5 },
  lyricsScreen: { flex: 1 },
  lyricsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  lyricsTitle: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  lyricsScroll: { flex: 1 },
  lyricsContent: { paddingHorizontal: 24, paddingVertical: 24, paddingBottom: 140 },
  lyricsLine: {
    color: '#8A8A9A',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
    paddingVertical: 8,
  },
  lyricsPlain: { color: '#FFFFFF', fontSize: 16, lineHeight: 26 },
  lyricsCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  lyricsMessage: { color: '#8A8A9A', fontSize: 15, textAlign: 'center' },
  lyricsCredit: { color: '#8A8A9A', fontSize: 11, textAlign: 'center', paddingVertical: 10 },
  searchModeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
  searchModePill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: CARD,
  },
  searchModePillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  listActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: CARD,
  },
  actionPillText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  listToolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 10,
  },
  filterInput: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 13,
  },
  sortPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CARD,
  },
  sortPillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  selectBox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: TEXT_DIM,
    marginRight: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 18,
    zIndex: 20,
    elevation: 8,
    backgroundColor: CARD,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  selectionCount: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  selectionAll: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  queueNowPlaying: { color: TEXT_DIM, fontSize: 12, marginBottom: 8 },
  queueHandle: { paddingHorizontal: 10, paddingVertical: 14 },
  queueScroll: { maxHeight: 380 },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  queueRowMain: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  queueArt: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: BORDER,
    marginRight: 12,
  },
  queueTitle: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '600', marginRight: 8 },
  sleepButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sleepButtonText: { fontSize: 11, fontWeight: '700' },
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
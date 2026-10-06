export type AppLanguage = 'en' | 'uk';

export interface Strings {
  appTitle: string;
  searchPlaceholder: string;
  noResults: string;
  yourLibrary: string;
  playlistsLabel: string;
  newButton: string;
  likedSongs: string;
  downloaded: string;
  noSongsYet: string;
  settingsTitle: string;
  sectionPlayback: string;
  sectionAppearance: string;
  sectionData: string;
  sectionAbout: string;
  sectionDeveloper: string;
  sectionDebugLogs: string;
  autoplay: string;
  autoplayDesc: string;
  audioQuality: string;
  audioQualityDesc: string;
  qualityBest: string;
  qualityBalanced: string;
  qualityLow: string;
  animations: string;
  animationsDesc: string;
  languageLabel: string;
  languageDesc: string;
  dynamicTheme: string;
  dynamicThemeDesc: string;
  resetAllData: string;
  resetAllDataDesc: string;
  resetButton: string;
  version: string;
  developerMode: string;
  developerModeDesc: string;
  copyLogs: string;
  clearLogs: string;
  trackOptions: string;
  downloadForOffline: string;
  removeDownload: string;
  downloading: string;
  addToPlaylist: string;
  noPlaylistsYet: string;
  newPlaylistButton: string;
  cancel: string;
  createPlaylistTitle: string;
  myPlaylist: string;
  createButton: string;
  tabSearch: string;
  tabLibrary: string;
  tabSettings: string;
  resetAlertTitle: string;
  resetAlertMessage: string;
  copiedTitle: string;
  copiedMessage: string;
  songsCount: (n: number) => string;
  playlistActionsTitle: string;
  renamePlaylistTitle: string;
  renameButton: string;
  deletePlaylistTitle: string;
  deletePlaylistMessage: (name: string) => string;
  deleteButton: string;
  removeFromPlaylist: string;
}

const en: Strings = {
  appTitle: 'Snowify',
  searchPlaceholder: 'What do you want to listen to?',
  noResults: 'No results',
  yourLibrary: 'Your Library',
  playlistsLabel: 'Playlists',
  newButton: '+ New',
  likedSongs: 'Liked Songs',
  downloaded: 'Downloaded',
  noSongsYet: 'No songs yet',
  settingsTitle: 'Settings',
  sectionPlayback: 'Playback',
  sectionAppearance: 'Appearance',
  sectionData: 'Data',
  sectionAbout: 'About',
  sectionDeveloper: 'Developer',
  sectionDebugLogs: 'Debug Logs',
  autoplay: 'Autoplay',
  autoplayDesc: 'Continue through the current queue when a track ends',
  audioQuality: 'Audio quality',
  audioQualityDesc:
    'Higher quality uses more bandwidth. Downloads keep the quality they were saved at.',
  qualityBest: 'Best',
  qualityBalanced: 'Balanced',
  qualityLow: 'Low',
  animations: 'Animations',
  animationsDesc: 'Enable smooth transitions and animations throughout the app',
  languageLabel: 'Language',
  languageDesc: 'App display language',
  dynamicTheme: 'Dynamic theme',
  dynamicThemeDesc: 'Color the app using the current song\'s album art',
  resetAllData: 'Reset all data',
  resetAllDataDesc: 'Delete all playlists, liked songs, downloads, and settings',
  resetButton: 'Reset',
  version: 'Version',
  developerMode: 'Developer Mode',
  developerModeDesc: 'Show debug logs',
  copyLogs: 'Copy Logs',
  clearLogs: 'Clear',
  trackOptions: 'Track options',
  downloadForOffline: 'Download for offline',
  removeDownload: 'Remove download',
  downloading: 'Downloading...',
  addToPlaylist: 'Add to playlist',
  noPlaylistsYet: 'No playlists yet',
  newPlaylistButton: '+ New Playlist',
  cancel: 'Cancel',
  createPlaylistTitle: 'Create playlist',
  myPlaylist: 'My Playlist',
  createButton: 'Create',
  tabSearch: 'Search',
  tabLibrary: 'Library',
  tabSettings: 'Settings',
  resetAlertTitle: 'Reset all data',
  resetAlertMessage:
    'This will delete all playlists, liked songs, downloads, and settings. This cannot be undone.',
  copiedTitle: 'Copied',
  copiedMessage: 'Debug logs copied to clipboard.',
  songsCount: n => `${n} ${n === 1 ? 'song' : 'songs'}`,
  playlistActionsTitle: 'Playlist options',
  renamePlaylistTitle: 'Rename playlist',
  renameButton: 'Rename',
  deletePlaylistTitle: 'Delete playlist?',
  deletePlaylistMessage: name => `This will permanently delete "${name}".`,
  deleteButton: 'Delete',
  removeFromPlaylist: 'Remove from this playlist',
};

function ukrainianSongsCount(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word: string;
  if (mod10 === 1 && mod100 !== 11) {
    word = 'пісня';
  } else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    word = 'пісні';
  } else {
    word = 'пісень';
  }
  return `${n} ${word}`;
}

const uk: Strings = {
  appTitle: 'Snowify',
  searchPlaceholder: 'Що ви хочете послухати?',
  noResults: 'Немає результатів',
  yourLibrary: 'Ваша бібліотека',
  playlistsLabel: 'Плейлисти',
  newButton: '+ Новий',
  likedSongs: 'Улюблені пісні',
  downloaded: 'Завантажені',
  noSongsYet: 'Поки немає пісень',
  settingsTitle: 'Налаштування',
  sectionPlayback: 'Відтворення',
  sectionAppearance: 'Зовнішній вигляд',
  sectionData: 'Дані',
  sectionAbout: 'Про додаток',
  sectionDeveloper: 'Розробник',
  sectionDebugLogs: 'Журнал налагодження',
  autoplay: 'Автовідтворення',
  autoplayDesc: 'Продовжувати чергу після завершення треку',
  audioQuality: 'Якість звуку',
  audioQualityDesc:
    'Вища якість використовує більше трафіку. Завантаження зберігають ту якість, з якою їх було збережено.',
  qualityBest: 'Найкраща',
  qualityBalanced: 'Збалансована',
  qualityLow: 'Низька',
  animations: 'Анімації',
  animationsDesc: 'Увімкнути плавні переходи та анімації в усьому додатку',
  languageLabel: 'Мова',
  languageDesc: 'Мова інтерфейсу додатку',
  dynamicTheme: 'Динамічна тема',
  dynamicThemeDesc: 'Фарбувати додаток кольорами обкладинки поточної пісні',
  resetAllData: 'Скинути всі дані',
  resetAllDataDesc: 'Видалити всі плейлисти, улюблені пісні, завантаження та налаштування',
  resetButton: 'Скинути',
  version: 'Версія',
  developerMode: 'Режим розробника',
  developerModeDesc: 'Показати журнал налагодження',
  copyLogs: 'Копіювати логи',
  clearLogs: 'Очистити',
  trackOptions: 'Опції треку',
  downloadForOffline: 'Завантажити для офлайн',
  removeDownload: 'Видалити завантаження',
  downloading: 'Завантаження...',
  addToPlaylist: 'Додати до плейлиста',
  noPlaylistsYet: 'Поки немає плейлистів',
  newPlaylistButton: '+ Новий плейлист',
  cancel: 'Скасувати',
  createPlaylistTitle: 'Створити плейлист',
  myPlaylist: 'Мій плейлист',
  createButton: 'Створити',
  tabSearch: 'Пошук',
  tabLibrary: 'Бібліотека',
  tabSettings: 'Налаштування',
  resetAlertTitle: 'Скинути всі дані',
  resetAlertMessage:
    'Це видалить усі плейлисти, улюблені пісні, завантаження та налаштування. Цю дію не можна скасувати.',
  copiedTitle: 'Скопійовано',
  copiedMessage: 'Журнал налагодження скопійовано в буфер обміну.',
  songsCount: ukrainianSongsCount,
  playlistActionsTitle: 'Опції плейлиста',
  renamePlaylistTitle: 'Перейменувати плейлист',
  renameButton: 'Перейменувати',
  deletePlaylistTitle: 'Видалити плейлист?',
  deletePlaylistMessage: name => `Це назавжди видалить "${name}".`,
  deleteButton: 'Видалити',
  removeFromPlaylist: 'Видалити з цього плейлиста',
};

export const STRINGS: Record<AppLanguage, Strings> = { en, uk };

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: 'English',
  uk: 'Українська',
};
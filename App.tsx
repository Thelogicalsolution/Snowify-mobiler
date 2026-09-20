/**
 * Snowify Mobile
 * @format
 */

import React, { useState } from 'react';
import {
  FlatList,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';

type Track = {
  id: string;
  title: string;
  artist: string;
  duration: string;
};

const MOCK_TRACKS: Track[] = [
  { id: '1', title: 'Starlight Drive', artist: 'Neon Fields', duration: '3:42' },
  { id: '2', title: 'Midnight Frequency', artist: 'Lumen', duration: '4:01' },
  { id: '3', title: 'Glass Horizon', artist: 'Echo Valley', duration: '2:58' },
  { id: '4', title: 'Paper Moon', artist: 'Waverunner', duration: '3:15' },
  { id: '5', title: 'Static Bloom', artist: 'Kindred', duration: '3:33' },
];

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [query, setQuery] = useState('');
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);

  const filteredTracks = MOCK_TRACKS.filter(track =>
    track.title.toLowerCase().includes(query.toLowerCase()) ||
    track.artist.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D12" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Snowify</Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search songs or artists..."
          placeholderTextColor="#8A8A9A"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <FlatList
        data={filteredTracks}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.trackRow}
            onPress={() => setNowPlaying(item)}
          >
            <View style={styles.trackArt} />
            <View style={styles.trackInfo}>
              <Text style={styles.trackTitle}>{item.title}</Text>
              <Text style={styles.trackArtist}>{item.artist}</Text>
            </View>
            <Text style={styles.trackDuration}>{item.duration}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No matches found</Text>
        }
      />

      {nowPlaying && (
        <View style={styles.miniPlayer}>
          <View style={styles.miniPlayerArt} />
          <View style={styles.miniPlayerInfo}>
            <Text style={styles.miniPlayerTitle} numberOfLines={1}>
              {nowPlaying.title}
            </Text>
            <Text style={styles.miniPlayerArtist} numberOfLines={1}>
              {nowPlaying.artist}
            </Text>
          </View>
          <TouchableOpacity style={styles.playButton}>
            <Text style={styles.playButtonText}>▶</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0D0D12',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    color: '#00E5FF',
    fontSize: 28,
    fontWeight: '700',
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  searchInput: {
    backgroundColor: '#1A1A22',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 15,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
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
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  trackArtist: {
    color: '#8A8A9A',
    fontSize: 13,
    marginTop: 2,
  },
  trackDuration: {
    color: '#8A8A9A',
    fontSize: 13,
  },
  emptyText: {
    color: '#8A8A9A',
    textAlign: 'center',
    marginTop: 40,
  },
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
  miniPlayerInfo: {
    flex: 1,
  },
  miniPlayerTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  miniPlayerArtist: {
    color: '#8A8A9A',
    fontSize: 12,
    marginTop: 2,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00E5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonText: {
    color: '#0D0D12',
    fontSize: 16,
  },
});

export default App;
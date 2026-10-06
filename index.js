/**
 * @format
 */

import { AppRegistry } from 'react-native';
import TrackPlayer from '@rntp/player';
import App from './App';
import { name as appName } from './app.json';
import PlaybackService from './service';

AppRegistry.registerComponent(appName, () => App);
TrackPlayer.registerPlaybackService(() => PlaybackService);
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-track-player',
  'android',
  'src',
  'main',
  'java',
  'com',
  'doublesymmetry',
  'trackplayer',
  'module',
  'MusicModule.kt'
);

if (!fs.existsSync(filePath)) {
  console.log('MusicModule.kt not found, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
  'callback.resolve(Arguments.fromBundle(musicService.tracks[index].originalItem))',
  'callback.resolve(musicService.tracks[index].originalItem?.let { Arguments.fromBundle(it) })'
);

content = content.replace(
  /else Arguments\.fromBundle\(\s*musicService\.tracks\[musicService\.getCurrentTrackIndex\(\)\]\.originalItem\s*\)/,
  'else musicService.tracks[musicService.getCurrentTrackIndex()].originalItem?.let { Arguments.fromBundle(it) }'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Patched MusicModule.kt Bundle null-safety issue');
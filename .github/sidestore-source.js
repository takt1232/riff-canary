// Writes sidestore.json (AltStore/SideStore source format) next to Canary.ipa in CI.
// The version must match the built app (MARKETING_VERSION = <major>.<minor>.<run number>) so
// SideStore can tell when an update is available.
const fs = require('fs');

const { RUN, REPO, SHA } = process.env;
const base = require('../package.json').version.split('.').slice(0, 2).join('.');
const version = `${base}.${RUN}`;
const ipa = `https://github.com/${REPO}/releases/download/ios-latest/Canary.ipa`;
const icon = `https://raw.githubusercontent.com/${REPO}/${SHA}/assets/icon-ios.png`;
const now = new Date().toISOString();
const size = fs.statSync('Canary.ipa').size;

const app = {
  name: 'Canary',
  bundleIdentifier: 'io.github.takt1232.canary',
  developerName: 'takt1232',
  subtitle: 'Free music player',
  iconURL: icon,
  tintColor: '7C4DFF',
  localizedDescription: 'Free, ad-free music player. Stream from YouTube, YouTube Music and SoundCloud, synced lyrics, offline songs, playlists and recommendations. Based on Riff by rootscripts (MIT). Independent and non-commercial, not affiliated with YouTube, SoundCloud or Spotify.',
  screenshotURLs: ['home', 'player', 'search'].map((n) => `https://raw.githubusercontent.com/${REPO}/${SHA}/site/shots/${n}.jpg`),
  versions: [{ version, buildVersion: String(RUN), date: now, size, downloadURL: ipa, minOSVersion: '15.0' }],
  version, versionDate: now, size, downloadURL: ipa,
  appPermissions: {},
};

fs.writeFileSync('sidestore.json', JSON.stringify({
  name: 'Canary',
  identifier: 'io.github.takt1232.canary.source',
  iconURL: icon,
  website: `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}/`,
  tintColor: '7C4DFF',
  apps: [app],
  news: [],
}, null, 2));
console.log(`sidestore.json: Canary ${version}, ${size} bytes`);

# Changelog

Notable changes to Canary. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased — renamed to Canary

### Changed

- The app is now Canary. The package and bundle IDs moved to `io.github.takt1232.canary`,
  and the custom URL scheme is `canary://`.
- Canary starts fresh: settings, profiles, history and other local data from Muriel are not
  imported. On phones this is a separate app and needs a fresh install.

## 1.3.16 — 2026-11-03

### Added

- Settings → Playback has a new "Keep playing when headphones disconnect" switch. Canary now
  pauses when the active Bluetooth or wired headphones or speakers disconnect (the default);
  with the switch on, the song keeps playing on the speakers instead.

## 1.3.15 — 2026-11-03

### Added

- Songs saved in the Downloads folder now show a small Downloaded badge in track
  lists, the playbar, the now-playing panel and the download dialog. The badge
  ignores Canary's internal offline cache, which is separate from downloaded files.

### Changed

- The download dialog has an opaque surface, live progress bars with speed and
  batch percentage, and a background-download mode with a close confirmation.

## 1.3.13 — 2026-11-03

### Changed

- The download dialog now uses an opaque surface, so it stays readable in dark mode
  regardless of the UI transparency setting.
- Downloads show a live progress bar with speed, phase and a total percentage for
  batches, plus a small bar for each song downloading at the same time.
- Closing the download dialog while a song is still downloading now asks what to do.
  The download can continue in the background, where a compact status card keeps
  showing its progress, or it can be cancelled from the dialog.

## 1.3.12 — 2026-11-03

### Added

- Playlists in the Playlists drawer now have a play button, so a playlist can
  start right from the list without opening it first. The button is always
  visible on phones.

## 1.3.11 — 2026-11-03

### Fixed

- Android: the phone is no longer kept awake for the whole listening session.
  The partial wake lock and the high-performance Wi-Fi lock are now held only
  while the next song is being loaded — released 2 seconds after playback
  starts or pauses, and expiring after 3 minutes instead of 30 if the page
  stops reporting. This removes the long wake-lock time that made the phone's
  battery screen report Canary as an app that keeps the system awake.

## Earlier versions

Release notes for 1.3.10 and older are on the
[releases page](https://github.com/takt1232/riff-muriel/releases).

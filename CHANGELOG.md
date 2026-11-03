# Changelog

Notable changes to Canary. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased — renamed to Canary

### Changed

- The app is now Canary. The package and bundle IDs moved to `io.github.takt1232.canary`,
  and the custom URL scheme is `canary://`.
- Canary starts fresh: settings, profiles, history and other local data from Muriel are not
  imported. On phones this is a separate app and needs a fresh install.

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

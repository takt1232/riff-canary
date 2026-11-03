# Changelog

Notable changes to Muriel. Versions follow [Semantic Versioning](https://semver.org/).

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
  battery screen report Muriel as an app that keeps the system awake.

## Earlier versions

Release notes for 1.3.10 and older are on the
[releases page](https://github.com/cloverscripts/riff-muriel/releases).

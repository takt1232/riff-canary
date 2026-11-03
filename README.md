# Canary

A lightweight desktop music player for Windows, Linux and macOS. Stream from YouTube, YouTube Music and SoundCloud, download for offline listening, and keep a local library — no account, no subscription.

Canary is a fork of [Muriel](https://github.com/cloverscripts/riff-muriel), which is based on
[Riff](https://github.com/rootscripts/riff) by rootscripts (MIT).

> Canary is an independent, non-commercial open-source project and is not affiliated with YouTube, Google,
> SoundCloud, Spotify or Apple. It hosts no music. Use it for private listening and only download music you
> have the right to. See [LEGAL.md](LEGAL.md) (also for rights holders).

## Features

- **Streaming & downloads** — YouTube, YouTube Music and SoundCloud via yt-dlp and ffmpeg (installed automatically on first run)
- **Local library** — reads tags and album art, folders and playlists, original files stay untouched
- **Lyrics** — online synced lyrics, LRC files, manual timing, fullscreen karaoke
- **Audio** — EQ, presets, real-time speed, reverb, and a small editor for trimming and exporting clips
- **Compact layout** — slim navigation rail, slide-over drawer for now playing, lyrics and the queue
- **Custom background** — image, GIF or video, with optional glass blur on the interface; pauses while Canary is hidden
- **Performance settings** — lightweight thumbnails, blur on/off, visualizer frame-rate cap, memory trimming in the background, hardware acceleration toggle

## Getting started

Requires Node.js 18 or newer.

```bash
git clone https://github.com/takt1232/riff-muriel.git
cd riff-muriel
npm install
npm start
```

## Building

```bash
npm run dist
```

Installers land in `dist/`. Builds are unsigned: on macOS, right-click Canary in Applications and choose Open; if macOS says the app is damaged, run `xattr -cr /Applications/Canary.app`.

## Tools

The scripts in `tools/` are optional PowerShell helpers for Windows. The normal `npm` and Gradle commands still work.

### `tools/build.ps1`

Builds the desktop installer and/or the Android APK.

```powershell
.\tools\build.ps1                    # both desktop and Android
.\tools\build.ps1 -Target desktop    # desktop installer only
.\tools\build.ps1 -Target android    # Android debug APK only
```

Build the APK and install it on a connected phone:

```powershell
.\tools\build.ps1 -Target android -Install
```

Options:

- `-Device <serial>` — pick a device when more than one is connected (`adb devices`).
- `-VersionCode <n>` — override the Android version code. By default a timestamp is used, so the APK installs over the previous build.

Outputs:

- Desktop: `dist\canary-<version>-win-x64.exe` (the same as `npm run dist`)
- Android: `android\app\build\outputs\apk\debug\app-debug.apk`

Android builds need JDK 21, but you don't have to install it yourself: `android/settings.gradle` and `android/gradle/gradle-daemon-jvm.properties` let Gradle download and use the right JDK automatically on the first build (cached in `%USERPROFILE%\.gradle\jdks`). iOS builds are not part of this script.

### `tools/bump-version.ps1`

Bumps the version in `package.json`, `package-lock.json` and `VERSION`.

```powershell
.\tools\bump-version.ps1 -Part patch   # 1.3.11 -> 1.3.12
.\tools\bump-version.ps1 -Part minor   # 1.3.11 -> 1.4.0
.\tools\bump-version.ps1 -Part major   # 1.3.11 -> 2.0.0
```

`-Part fix` is an alias for `patch`.

- `-Changelog` also prepends a dated entry to `CHANGELOG.md`.
- `-DryRun` shows the next version without changing any files.

It only edits files: it does not commit, tag or push. The same bump is available through `npm run release` (patch), `npm run release:minor` and `npm run release:major`.

## Data

- Windows: `%LOCALAPPDATA%\Canary`
- macOS: `~/Library/Application Support/Canary`
- Linux: `~/.cache/canary` (settings in `~/.config/canary`)

Canary starts fresh: settings, profiles, history and other local data from Muriel are not imported. The
repository keeps the name `riff-muriel` for now.

## Legal

Canary is a player: it doesn't host, upload or sell music, has no ads, accounts or tracking, and nobody earns
money from it. You're responsible for using it in line with copyright and the terms of the services you use.
Rights holders can reach us through a [rights holder request](https://github.com/takt1232/riff-muriel/issues/new?template=rights-holder-request.yml).
Details, also in German: [LEGAL.md](LEGAL.md).

## License

MIT. See [LICENSE](LICENSE). Original Riff code © rootscripts.

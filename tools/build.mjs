#!/usr/bin/env node
// Builds Canary for the desktop and/or Android on Windows, Linux and macOS.
//
// Usage: node tools/build.mjs [--target all|desktop|android] [--install]
//                             [--device <serial>] [--version-code <n>]
//
//   Desktop : runs electron-builder and leaves the installer in dist/.
//   Android : rebuilds the mobile web bundle in www/, syncs it into the Android
//             project, then builds a debug APK. --install copies the APK to the
//             connected phone with adb.
//
// Android needs JDK 21. android/settings.gradle asks Gradle to download one into
// ~/.gradle/jdks (or %USERPROFILE%\.gradle\jdks) when the machine only has an
// older JDK, so JAVA_HOME does not have to change.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === 'win32';
const TARGETS = new Set(['all', 'desktop', 'android']);

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const cyan = paint(36);
const green = paint(32);
const yellow = paint(33);
const red = paint(31);

class ScriptError extends Error {}

function usage() {
  console.log(`Usage: node tools/build.mjs [options]

Options:
  -t, --target <all|desktop|android>  What to build (default: all)
  -i, --install                       Android only: install the APK on the device
  -d, --device <serial>               Android only: adb serial when several are connected
  -v, --version-code <n>              Android only: versionCode for the APK
                                       (default: a timestamp, so it installs as an update)
  -h, --help                          Show this help

Examples:
  node tools/build.mjs
  node tools/build.mjs --target desktop
  node tools/build.mjs --target android --install`);
}

function optionValue(argv, index, inline, name) {
  if (inline !== undefined) return { value: inline, index };
  if (index + 1 >= argv.length) throw new ScriptError(`${name} needs a value.`);
  return { value: argv[index + 1], index: index + 1 };
}

function parseArgs(argv) {
  const options = { target: 'all', install: false, device: '', versionCode: 0, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inline] = arg.split('=');
    const lower = name.toLowerCase();

    if (lower === '-h' || lower === '--help') {
      options.help = true;
    } else if (lower === '-i' || lower === '--install') {
      options.install = true;
    } else if (lower === '-t' || lower === '--target') {
      const parsed = optionValue(argv, index, inline, name);
      index = parsed.index;
      options.target = parsed.value.toLowerCase();
    } else if (lower === '-d' || lower === '--device') {
      const parsed = optionValue(argv, index, inline, name);
      index = parsed.index;
      options.device = parsed.value;
    } else if (lower === '-v' || lower === '--version-code') {
      const parsed = optionValue(argv, index, inline, name);
      index = parsed.index;
      const value = Number(parsed.value);
      if (!Number.isInteger(value) || value < 0) {
        throw new ScriptError(`--version-code must be a whole number of 0 or more (got '${parsed.value}').`);
      }
      options.versionCode = value;
    } else {
      throw new ScriptError(`Unknown argument '${arg}'. Run with --help to see the options.`);
    }
  }

  if (!options.help && !TARGETS.has(options.target)) {
    throw new ScriptError(`Unknown target '${options.target}'. Use all, desktop or android.`);
  }
  return options;
}

function step(text) {
  console.log('');
  console.log(cyan(`==> ${text}`));
}

// Look the command up in PATH ourselves so this does not depend on `which` (absent
// from some minimal Linux/Nix setups) or `where` on Windows.
function commandPath(name) {
  const extensions = isWindows
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => ext.toLowerCase())
    : [''];
  const names = /\.(exe|cmd|bat|com)$/i.test(name) || !isWindows
    ? [name]
    : extensions.map((ext) => name + ext);

  for (const dir of (process.env.PATH || '').split(isWindows ? ';' : ':').filter(Boolean)) {
    for (const candidate of names) {
      const full = join(dir, candidate);
      try {
        if (!statSync(full).isFile()) continue;
        if (isWindows || (statSync(full).mode & 0o111)) return full;
      } catch {
        // Not in this directory; keep looking.
      }
    }
  }
  return '';
}

function requireCommand(name) {
  if (!commandPath(name)) throw new ScriptError(`Required command '${name}' was not found on PATH.`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
  if (result.error) throw new ScriptError(`Could not run ${command}: ${result.error.message}`);
  if (result.signal) throw new ScriptError(`${command} was stopped by ${result.signal}.`);
  if (result.status !== 0) throw new ScriptError(`${command} failed (exit code ${result.status ?? 'unknown'}).`);
}

function packageVersion() {
  const path = join(root, 'package.json');
  if (!existsSync(path)) throw new ScriptError(`package.json was not found in ${root}.`);
  try {
    const version = String(JSON.parse(readFileSync(path, 'utf8')).version ?? '');
    if (!version) throw new Error('version is missing');
    return version;
  } catch (error) {
    throw new ScriptError(`Could not read the version from package.json: ${error.message}`);
  }
}

function electronBinary() {
  const dist = join(root, 'node_modules', 'electron', 'dist');
  if (process.platform === 'win32') return join(dist, 'electron.exe');
  if (process.platform === 'darwin') return join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  return join(dist, 'electron');
}

function newestArtifact() {
  const dir = join(root, 'dist');
  if (!existsSync(dir)) return '';
  const files = readdirSync(dir)
    .map((name) => ({ name, path: join(dir, name) }))
    .filter((file) => /\.(exe|AppImage|dmg|zip|deb|rpm|snap)$/i.test(file.name))
    .filter((file) => statSync(file.path).isFile())
    .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs);
  return files[0]?.path ?? '';
}

function buildDesktop() {
  step('Desktop: checking dependencies');
  requireCommand('npm');
  if (!existsSync(join(root, 'node_modules'))) {
    throw new ScriptError(`node_modules is missing. Run 'npm install' in ${root} first.`);
  }

  // The electron npm package can be present without its downloaded runtime (for
  // example after a failed postinstall), and electron-builder then fails with a
  // much less useful message.
  const electron = electronBinary();
  if (!existsSync(electron)) {
    const installer = join(root, 'node_modules', 'electron', 'install.js');
    if (!existsSync(installer)) {
      throw new ScriptError('The Electron runtime is missing and node_modules/electron/install.js was not found. Run npm install.');
    }
    console.log('Electron binary is missing; downloading it now...');
    run(process.execPath, [installer]);
  }

  step('Desktop: building the installer (electron-builder)');
  run('npm', ['run', 'dist'], { shell: isWindows });

  const artifact = newestArtifact();
  if (artifact) {
    console.log(green(`Desktop build: ${artifact}`));
  } else {
    console.log(yellow('Desktop build finished; see the dist folder for the output.'));
  }
}

function findAdb() {
  const onPath = commandPath('adb');
  if (onPath) return onPath;

  const exe = isWindows ? 'adb.exe' : 'adb';
  for (const sdk of [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME]) {
    if (!sdk) continue;
    const candidate = join(sdk, 'platform-tools', exe);
    if (existsSync(candidate)) return candidate;
  }
  return '';
}

function installApk(apk, options) {
  const adb = findAdb();
  if (!adb) throw new ScriptError('adb was not found. Install Android platform-tools or add it to PATH.');

  let serial = options.device;
  if (!serial) {
    const result = spawnSync(adb, ['devices'], { encoding: 'utf8' });
    if (result.error) throw new ScriptError(`Could not run adb: ${result.error.message}`);
    if (result.status !== 0) throw new ScriptError(`adb devices failed (exit code ${result.status ?? 'unknown'}).`);

    // `adb devices` prints a header, then one line per device. The serial itself
    // can contain spaces: wireless debugging advertises mDNS names such as
    // "adb-XXXX-YYYY (2)._adb-tls-connect._tcp". So split the state off from the
    // right instead of assuming the first token is the whole serial: drop any
    // "key:value" columns added by `adb devices -l`, then the remaining last token
    // is the state. Keep devices that are not ready so the error can say why.
    const devices = [];
    const unavailable = [];
    for (const raw of String(result.stdout ?? '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('*') || /^List of devices attached/i.test(line)) continue;

      let deviceSerial;
      let state;
      const noPermissions = /^(.*?)\s+no permissions$/i.exec(line);
      if (noPermissions) {
        deviceSerial = noPermissions[1];
        state = 'no permissions';
      } else {
        const tokens = line.split(/\s+/);
        while (tokens.length > 1 && /^[^:\s]+:\S+$/.test(tokens[tokens.length - 1])) tokens.pop();
        state = tokens.pop();
        deviceSerial = tokens.join(' ');
      }
      if (!deviceSerial || !state) continue;

      if (state === 'device') {
        devices.push(deviceSerial);
      } else {
        unavailable.push(`${deviceSerial} (${state})`);
      }
    }
    if (devices.length === 0) {
      if (unavailable.length > 0) {
        throw new ScriptError(
          `Android device found but not ready: ${unavailable.join(', ')}. ` +
            'Make sure USB or wireless debugging is enabled and that the phone authorized this computer, then try again.',
        );
      }
      throw new ScriptError('No Android device is connected. Connect the phone (USB or wireless ADB) and try again.');
    }
    serial = devices[0];
    if (devices.length > 1) {
      console.log(yellow(`More than one device is connected; using ${serial}. Pass --device <serial> to pick another.`));
    }
  }

  step(`Android: installing on ${serial}`);
  run(adb, ['-s', serial, 'install', '-r', apk]);
}

function buildAndroid(options) {
  step('Android: checking dependencies');
  requireCommand('npx');
  const androidDir = join(root, 'android');
  if (!existsSync(join(androidDir, 'gradlew')) && !existsSync(join(androidDir, 'gradlew.bat'))) {
    throw new ScriptError(`The Android project is missing (${androidDir}).`);
  }
  if (!existsSync(join(root, 'node_modules'))) {
    throw new ScriptError(`node_modules is missing. Run 'npm install' in ${root} first.`);
  }

  const appVersion = packageVersion();
  let versionCode = options.versionCode;
  if (versionCode <= 0) {
    // Android only installs an APK whose versionCode is higher than the one on the
    // phone. Unix seconds are monotonic and still fit in Android's 32-bit versionCode.
    versionCode = Math.floor(Date.now() / 1000) % 2000000000;
  }

  step('Android: rebuilding the mobile web bundle');
  run(process.execPath, ['mobile/build.mjs']);

  step('Android: syncing www into the Android project');
  run('npx', ['cap', 'sync', 'android'], { shell: isWindows });

  step(`Android: building the debug APK (version ${appVersion}, code ${versionCode})`);
  // The environment is passed to the Gradle child only, so Canary's own shell is untouched.
  const env = { ...process.env, CANARY_VERSION_NAME: appVersion, CANARY_VERSION_CODE: String(versionCode) };
  if (isWindows) {
    run('gradlew.bat', ['assembleDebug'], { cwd: androidDir, env, shell: true });
  } else {
    // Run the wrapper through sh so a checkout without the executable bit still works.
    run('sh', ['gradlew', 'assembleDebug'], { cwd: androidDir, env });
  }

  const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!existsSync(apk)) throw new ScriptError(`The APK was not created at ${apk}`);
  console.log(green(`Android build: ${apk}`));

  if (options.install) installApk(apk, options);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
  } else {
    if (options.install && options.target === 'desktop') {
      throw new ScriptError('--install is for Android builds; use --target android (or omit --target).');
    }

    if (options.target === 'desktop' || options.target === 'all') buildDesktop();
    if (options.target === 'android' || options.target === 'all') buildAndroid(options);

    console.log('');
    console.log(green('Build complete.'));
  }
} catch (error) {
  if (!(error instanceof ScriptError)) throw error;
  console.error(red(`Error: ${error.message}`));
  process.exitCode = 1;
}

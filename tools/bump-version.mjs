#!/usr/bin/env node
// Bumps Canary's version in package.json, package-lock.json and VERSION.
//
// Usage: node tools/bump-version.mjs <major|minor|patch|fix> [--changelog] [--dry-run]
//
//   major -> 1.3.11 becomes 2.0.0
//   minor -> 1.3.11 becomes 1.4.0
//   patch -> 1.3.11 becomes 1.3.12   ("fix" is another name for patch)
//
// This only edits the version files. It does not commit, tag or push. Android and
// iOS read the version from package.json, so nothing else needs changing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PARTS = new Set(['major', 'minor', 'patch', 'fix']);

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const cyan = paint(36);
const green = paint(32);
const yellow = paint(33);
const red = paint(31);

class ScriptError extends Error {}

function usage() {
  console.log(`Usage: node tools/bump-version.mjs <major|minor|patch|fix> [options]

Options:
  -c, --changelog   Also prepend a dated entry to CHANGELOG.md
  -n, --dry-run     Show the next version without changing any files
  -h, --help        Show this help

Examples:
  node tools/bump-version.mjs patch
  node tools/bump-version.mjs minor --changelog
  node tools/bump-version.mjs major --dry-run`);
}

function parseArgs(argv) {
  const options = { part: '', changelog: false, dryRun: false, help: false };
  for (const arg of argv) {
    const value = arg.toLowerCase();
    if (value === '-c' || value === '--changelog') options.changelog = true;
    else if (value === '-n' || value === '--dry-run') options.dryRun = true;
    else if (value === '-h' || value === '--help') options.help = true;
    else if (PARTS.has(value)) {
      if (options.part) throw new ScriptError(`Only one part can be given (got '${options.part}' and '${value}').`);
      options.part = value;
    } else {
      throw new ScriptError(`Unknown argument '${arg}'. Run with --help to see the options.`);
    }
  }
  if (!options.help && !options.part) {
    throw new ScriptError('A part is required: major, minor, patch or fix. Run with --help to see the options.');
  }
  return options;
}

function readUtf8(path) {
  return readFileSync(path, 'utf8');
}

// Node's writeFileSync never adds a BOM, which matches the PowerShell helper.
function writeUtf8(path, text) {
  writeFileSync(path, text, 'utf8');
}

function indentOf(text) {
  const match = /^\{\r?\n([ \t]+)"/.exec(text);
  return match ? match[1] : 2;
}

function endingOf(text) {
  if (text.endsWith('\r\n')) return '\r\n';
  if (text.endsWith('\n')) return '\n';
  return '';
}

function writeJson(path, original, value) {
  writeUtf8(path, JSON.stringify(value, null, indentOf(original)) + endingOf(original));
}

function localDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function addChangelogEntry(version, kind) {
  const path = join(root, 'CHANGELOG.md');
  if (!existsSync(path)) {
    console.warn(yellow('Warning: CHANGELOG.md was not found; skipping the changelog entry.'));
    return false;
  }

  let text = readUtf8(path);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const section = kind === 'major' ? 'Changed' : kind === 'minor' ? 'Added' : 'Fixed';
  const entry = `## ${version} \u2014 ${localDate()}${nl}${nl}### ${section}${nl}${nl}- ${nl}${nl}`;

  const firstEntry = /^## /m.exec(text);
  if (firstEntry) {
    text = text.slice(0, firstEntry.index) + entry + text.slice(firstEntry.index);
  } else {
    text = text.trimEnd() + nl + nl + entry;
  }
  writeUtf8(path, text);
  return true;
}

function bumpVersion(part, dryRun, changelog) {
  const packagePath = join(root, 'package.json');
  if (!existsSync(packagePath)) throw new ScriptError(`package.json was not found in ${root}.`);

  const packageText = readUtf8(packagePath);
  let pkg;
  try {
    pkg = JSON.parse(packageText);
  } catch (error) {
    throw new ScriptError(`package.json is not valid JSON: ${error.message}`);
  }

  const current = String(pkg.version ?? '');
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) {
    throw new ScriptError(`package.json version '${current}' is not in MAJOR.MINOR.PATCH form.`);
  }

  const kind = part === 'fix' ? 'patch' : part;
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (kind === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  const next = `${major}.${minor}.${patch}`;

  const versionPath = join(root, 'VERSION');
  if (existsSync(versionPath)) {
    const onDisk = readUtf8(versionPath).trim();
    if (onDisk && onDisk !== current) {
      console.warn(yellow(`Warning: VERSION (${onDisk}) did not match package.json (${current}); both will be set to ${next}.`));
    }
  }

  console.log('');
  console.log(cyan(`Canary ${current} -> ${next} (${kind})`));

  if (dryRun) {
    console.log(yellow('Dry run: no files were changed.'));
    return;
  }

  pkg.version = next;
  writeJson(packagePath, packageText, pkg);

  const lockPath = join(root, 'package-lock.json');
  if (existsSync(lockPath)) {
    const lockText = readUtf8(lockPath);
    let lock;
    try {
      lock = JSON.parse(lockText);
    } catch (error) {
      throw new ScriptError(`package-lock.json is not valid JSON: ${error.message}`);
    }
    lock.version = next;
    if (lock.packages && lock.packages['']) lock.packages[''].version = next;
    writeJson(lockPath, lockText, lock);
  }

  // Keep VERSION in step with package.json, preserving its line-ending style.
  const oldVersionText = existsSync(versionPath) ? readUtf8(versionPath) : '';
  const versionNl = oldVersionText.includes('\r\n') ? '\r\n' : '\n';
  writeUtf8(versionPath, next + versionNl);

  const changelogUpdated = changelog ? addChangelogEntry(next, kind) : false;

  console.log('');
  console.log(green('Updated:'));
  console.log('  package.json');
  console.log('  package-lock.json');
  console.log('  VERSION');
  if (changelogUpdated) console.log('  CHANGELOG.md');
  console.log('');
  console.log(yellow('No commit, tag or push was made.'));
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
  } else {
    bumpVersion(options.part, options.dryRun, options.changelog);
  }
} catch (error) {
  if (!(error instanceof ScriptError)) throw error;
  console.error(red(`Error: ${error.message}`));
  process.exitCode = 1;
}

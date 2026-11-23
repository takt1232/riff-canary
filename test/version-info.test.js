'use strict';

// version-info.js: what Settings > About and the settings footer say about the installed build.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../version-info');

test('format: a stamped build shows version, build number and short commit', () => {
  const info = V.format({ version: '1.3.19', run: 245, sha: 'b3bb199aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  assert.equal(info.about, 'Version 1.3.19 \u00b7 build 245 \u00b7 b3bb199');
  assert.equal(info.detail, 'build 245 \u00b7 b3bb199');
  assert.equal(info.tag, 'v1.3.19');
});

test('format: a local build (sha dev) shows the version only', () => {
  const info = V.format({ version: '1.3.19', run: 245, sha: 'dev' });
  assert.equal(info.about, 'Version 1.3.19');
  assert.equal(info.detail, '');
  assert.equal(info.tag, 'v1.3.19');
});

test('format: a version without build metadata is still complete', () => {
  assert.equal(V.format({ version: '1.3.19' }).about, 'Version 1.3.19');
  assert.equal(V.format({ version: '1.3.19' }).tag, 'v1.3.19');
});

test('format: nothing stamped means a development build, never a made-up version', () => {
  assert.equal(V.format().about, 'Development build');
  assert.equal(V.format().tag, 'dev');
  assert.equal(V.format({ version: '', run: 0, sha: 'dev' }).about, 'Development build');
});

test('format: build metadata without a version is labelled as a development build', () => {
  const info = V.format({ run: 245, sha: 'b3bb199' });
  assert.equal(info.about, 'Development build \u00b7 build 245 \u00b7 b3bb199');
  assert.equal(info.tag, 'dev');
});

test('shortSha: trims, ignores dev, and keeps the first seven characters', () => {
  assert.equal(V.shortSha('  abcdef123456  '), 'abcdef1');
  assert.equal(V.shortSha('dev'), '');
  assert.equal(V.shortSha(''), '');
  assert.equal(V.shortSha(null), '');
});

test('version-info.js loads after build-info.js and before the scripts that read it', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const at = (f) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at('build-info.js') >= 0 && at('build-info.js') < at('version-info.js'));
  assert.ok(at('version-info.js') < at('app.js') && at('version-info.js') < at('update-notifier.js'));
  // phones build their own bundle, so the file has to be copied there too
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'mobile', 'build.mjs'), 'utf8'), /'version-info\.js'/);
  // no made-up version is shown before the real one loads
  assert.doesNotMatch(html, />Version 1\.0\.0</);
  assert.doesNotMatch(html, />v1\.0\.0</);
});

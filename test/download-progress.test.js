const test = require('node:test');
const assert = require('node:assert');
const { PREFIX, PROGRESS_ARGS, parseProgressLine } = require('../download-progress');

test('parses a yt-dlp progress line', () => {
  const parsed = parseProgressLine(`${PREFIX}downloading| 42.5%|1536000.0|12|1300000|3050000`);
  assert.deepStrictEqual(parsed, {
    status: 'downloading',
    percent: 42.5,
    speed: 1536000,
    eta: 12,
    downloadedBytes: 1300000,
    totalBytes: 3050000,
  });
});

test('keeps missing progress values null instead of NaN', () => {
  const parsed = parseProgressLine(`${PREFIX}downloading|NA|NA|NA|NA|NA`);
  assert.strictEqual(parsed.percent, null);
  assert.strictEqual(parsed.speed, null);
  assert.strictEqual(parsed.eta, null);
});

test('ignores ordinary yt-dlp output', () => {
  assert.strictEqual(parseProgressLine('[download] 42% of 3.00MiB'), null);
  assert.strictEqual(parseProgressLine(''), null);
});

test('asks yt-dlp for newline progress with the marker prefix', () => {
  assert.ok(PROGRESS_ARGS.includes('--newline'));
  const at = PROGRESS_ARGS.indexOf('--progress-template');
  assert.ok(at >= 0);
  assert.ok(PROGRESS_ARGS[at + 1].startsWith(PREFIX));
  assert.ok(PROGRESS_ARGS[at + 1].includes('%(progress._percent_str)s'));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  radioHistoryKey, trimRadioHistory, addRadioHistory, radioHistoryExclude,
} = require('../recommend-core');

const seed = (artist, title, platform = 'youtube') => ({ artist, title, platform });

test('radioHistoryKey is stable regardless of the order the seeds were picked', () => {
  const a = seed('Radiohead', 'No Surprises');
  const b = seed('Portishead', 'Roads');
  assert.strictEqual(radioHistoryKey([a, b]), radioHistoryKey([b, a]));
  assert.notStrictEqual(radioHistoryKey([a, b]), radioHistoryKey([a]));
  assert.notStrictEqual(
    radioHistoryKey([a], (t) => `${t.artist}::${t.title}`),
    radioHistoryKey([b], (t) => `${t.artist}::${t.title}`),
  );
});

test('trimRadioHistory drops missing, malformed and expired entries', () => {
  assert.strictEqual(trimRadioHistory(null), null);
  assert.strictEqual(trimRadioHistory({ tracks: 'nope' }), null);

  const entry = addRadioHistory(null, [{ id: 'a', artist: 'A', title: 'one' }], { now: 1000, ttl: 100 });
  assert.ok(trimRadioHistory(entry, { now: 1050, ttl: 100 }));
  assert.strictEqual(trimRadioHistory(entry, { now: 1200, ttl: 100 }), null);
});

test('addRadioHistory de-duplicates by id and key, refreshes at, and keeps the newest max', () => {
  const now = 5000;
  const opts = { now, ttl: 10000, max: 3 };
  const first = addRadioHistory(null, [
    { id: 'a', artist: 'A', title: 'one' },
    { id: 'b', artist: 'B', title: 'two' },
  ], opts);
  assert.deepStrictEqual(first.tracks, [
    { id: 'a', key: 'a::one' },
    { id: 'b', key: 'b::two' },
  ]);

  const second = addRadioHistory(first, [
    { id: 'a', artist: 'A', title: 'one' },     // same id
    { id: 'x', artist: 'B', title: 'two' },     // same key, another id
    { id: 'c', artist: 'C', title: 'three' },
  ], { ...opts, now: now + 10 });
  assert.deepStrictEqual(second.tracks.map((t) => t.id), ['a', 'b', 'c']);
  assert.strictEqual(second.at, now + 10);

  const third = addRadioHistory(second, [
    { id: 'd', artist: 'D', title: 'four' },
    { id: 'e', artist: 'E', title: 'five' },
  ], { ...opts, now: now + 20 });
  assert.deepStrictEqual(third.tracks.map((t) => t.id), ['c', 'd', 'e']);
});

test('radioHistoryExclude returns the ids and keys the server should leave out', () => {
  const entry = addRadioHistory(null, [
    { id: 'a', artist: 'A', title: 'one' },
    { id: '', artist: 'B', title: 'two' },
  ], { now: 1000, ttl: 100 });
  assert.deepStrictEqual(radioHistoryExclude(entry, { now: 1050, ttl: 100 }), {
    ids: ['a'],
    keys: ['a::one', 'b::two'],
  });
  assert.deepStrictEqual(radioHistoryExclude(entry, { now: 2000, ttl: 100 }), { ids: [], keys: [] });
  assert.deepStrictEqual(radioHistoryExclude(null), { ids: [], keys: [] });
});

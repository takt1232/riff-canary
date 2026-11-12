const test = require('node:test');
const assert = require('node:assert');
const P = require('../mix-prep');

const V = P.DEFAULT_VERSION;
const analyze = (bpm = 120, key = 'A minor') => ({
  v: V, bpm, bpmConfidence: 0.7, key, mode: 'minor', camelot: '8A', duration: 200
});
const cache = (rows) => {
  const map = new Map(rows);
  return (track) => map.get(P.analysisKey(track)) || null;
};

const a = { id: 'aaa', platform: 'youtube', title: 'A', duration: 200 };
const b = { id: 'bbb', platform: 'youtube', title: 'B', duration: 190 };
const c = { id: 'ccc', platform: 'soundcloud', title: 'C', duration: 180 };

test('analysis keys follow the platform id, not the playlist row', () => {
  assert.strictEqual(P.analysisKey({ id: 'abc-123' }), 'abc-123');
  assert.strictEqual(P.analysisKey({ id: 'a/b c' }), 'a_b_c');
  assert.strictEqual(P.analysisKey({ title: 'Song', artist: 'Artist', duration: 12, platform: 'local' }), 'local_song_artist_12');
});

test('strict readiness: every unique track must be ready or a terminal fallback', () => {
  const tracks = [a, b, a];
  let state = P.readiness(tracks, cache([]), V);
  assert.strictEqual(state.total, 2);
  assert.strictEqual(state.unprocessed, 2);
  assert.strictEqual(state.mixReady, false);

  state = P.readiness(tracks, cache([[P.analysisKey(a), analyze()]]), V);
  assert.strictEqual(state.ready, 1);
  assert.strictEqual(state.unprocessed, 1);
  assert.strictEqual(state.mixReady, false);

  state = P.readiness(tracks, cache([
    [P.analysisKey(a), analyze()],
    [P.analysisKey(b), P.fallbackEntry('unavailable', 190)]
  ]), V);
  assert.strictEqual(state.ready, 1);
  assert.strictEqual(state.fallback, 1);
  assert.strictEqual(state.unprocessed, 0);
  assert.strictEqual(state.progress, 1);
  assert.strictEqual(state.mixReady, true);
});

test('a version mismatch is unprocessed, a duplicate row is not counted twice', () => {
  const old = { ...analyze(), v: V - 1 };
  const state = P.readiness([a, a], cache([[P.analysisKey(a), old]]), V);
  assert.strictEqual(state.total, 1);
  assert.strictEqual(state.unprocessed, 1);
  assert.strictEqual(state.rows.length, 1);
});

test('the preparation queue keeps playlist order and skips done tracks', () => {
  const tracks = [a, b, c, a];
  const queue = P.buildQueue(tracks, cache([
    [P.analysisKey(b), P.fallbackEntry('too-short', 190)]
  ]), V);
  assert.deepStrictEqual(queue.map((t) => t.id), ['aaa', 'ccc']);
});

test('readiness rows expose quality for the editor', () => {
  const state = P.readiness([a, b], cache([
    [P.analysisKey(a), analyze()],
    [P.analysisKey(b), { ...analyze(), bpm: 0, key: '', bpmConfidence: 0 }]
  ]), V);
  assert.strictEqual(state.rows[0].quality, 'full');
  assert.strictEqual(state.rows[1].quality, 'basic');
});

test('the readiness fingerprint ignores reorder but notices additions, length and version changes', () => {
  const base = P.fingerprint([a, b], V);
  assert.strictEqual(P.fingerprint([b, a], V), base);
  assert.notStrictEqual(P.fingerprint([a, b, c], V), base);
  assert.notStrictEqual(P.fingerprint([a, { ...b, duration: 191 }], V), base);
  assert.notStrictEqual(P.fingerprint([a, b], V + 1), base);
});

test('fallback reasons have a short user-facing label', () => {
  assert.strictEqual(P.fallbackLabel('offline'), 'Needs internet');
  assert.strictEqual(P.fallbackLabel('too-short'), 'Too short');
  assert.strictEqual(P.fallbackLabel('something-else'), 'Standard fade');
  assert.strictEqual(P.isTerminal('ready'), true);
  assert.strictEqual(P.isTerminal('unprocessed'), false);
});

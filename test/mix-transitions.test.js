const test = require('node:test');
const assert = require('node:assert');
const T = require('../mix-transitions');

const song = (id, platform = 'youtube') => ({ id, platform, title: id, artist: 'Artist', duration: 200 });
const playlist = (tracks = [song('a'), song('b'), song('c')]) => ({
  id: 'pl_1',
  tracks,
  mix: { enabled: true, analysisVersion: 1, preparedAt: 1, transitions: {} }
});

test('edge keys identify the exact adjacent pair', () => {
  assert.strictEqual(T.edgeKey(song('a'), song('b')), 'youtube:a>youtube:b');
  assert.strictEqual(T.edgeKey(song('a'), song('b')), T.edgeKey(song('a'), song('b')));
  assert.notStrictEqual(T.edgeKey(song('a'), song('b')), T.edgeKey(song('b'), song('a')));
  assert.strictEqual(T.edgeKey(null, song('b')), '');
});

test('a default transition is explicit and safe', () => {
  const d = T.makeDefault();
  assert.strictEqual(d.enabled, true);
  assert.strictEqual(d.preset, 'auto');
  assert.strictEqual(d.bars, 8);
  assert.strictEqual(d.curve, 'equal');
  assert.strictEqual(d.bpmMatch, true);
  assert.strictEqual(d.filter, 0);
  assert.deepStrictEqual(d.eq, { outLow: 0, outMid: 0, outHigh: 0, inLow: 0, inMid: 0, inHigh: 0 });
  assert.strictEqual(d.entry, null);
  assert.strictEqual(d.exit, null);
});

test('materialize creates one config per adjacent pair and keeps existing pairs', () => {
  const pl = playlist();
  assert.strictEqual(T.materialize(pl), true);
  assert.deepStrictEqual(Object.keys(pl.mix.transitions).sort(), ['youtube:a>youtube:b', 'youtube:b>youtube:c']);
  pl.mix.transitions['youtube:a>youtube:b'] = { ...T.makeDefault(), preset: 'blend', bars: 16 };
  assert.strictEqual(T.materialize(pl), false);
  assert.strictEqual(pl.mix.transitions['youtube:a>youtube:b'].preset, 'blend');
  assert.strictEqual(pl.mix.transitions['youtube:a>youtube:b'].bars, 16);
});

test('a new adjacency gets defaults after reorder, while an existing pair keeps its config', () => {
  const a = song('a');
  const b = song('b');
  const c = song('c');
  const pl = playlist([a, b, c]);
  T.materialize(pl);
  T.updateTransition(pl, a, b, { preset: 'rise', bars: 4 });
  pl.tracks = [a, c, b];
  T.materialize(pl);
  assert.strictEqual(T.transitionFor(pl, a, b).preset, 'rise');
  assert.strictEqual(T.transitionFor(pl, a, c).preset, 'auto');
  assert.strictEqual(T.transitionFor(pl, c, b).preset, 'auto');
});

test('lookup is by pair, not by the outgoing song alone', () => {
  const a = song('a');
  const b = song('b');
  const c = song('c');
  const pl = playlist([a, b, c]);
  T.materialize(pl);
  T.updateTransition(pl, a, b, { preset: 'blend', bars: 16 });
  T.updateTransition(pl, b, c, { preset: 'fade', bars: 2 });
  assert.strictEqual(T.transitionFor(pl, a, b).bars, 16);
  assert.strictEqual(T.transitionFor(pl, b, c).bars, 2);
  assert.strictEqual(T.transitionFor(pl, a, c), null);
});

test('a transition can opt out and still keep its other settings', () => {
  const pl = playlist();
  T.materialize(pl);
  const cfg = T.updateTransition(pl, song('a'), song('b'), { enabled: false, preset: 'rise' });
  assert.strictEqual(cfg.enabled, false);
  assert.strictEqual(cfg.preset, 'rise');
  assert.strictEqual(T.describe(cfg), 'No mix');
  assert.strictEqual(T.describe(T.makeDefault({ preset: 'blend', bars: 16 })), 'Blend · 16 bars');
});

test('values are clamped and partial EQ edits keep the other bands', () => {
  const pl = playlist();
  T.materialize(pl);
  const cfg = T.updateTransition(pl, song('a'), song('b'), {
    bars: 99,
    filter: 500,
    eq: { outLow: 99, inHigh: 4 }
  });
  assert.strictEqual(cfg.bars, 32);
  assert.strictEqual(cfg.filter, 100);
  assert.strictEqual(cfg.eq.outLow, 18);
  assert.strictEqual(cfg.eq.inHigh, 4);
  assert.strictEqual(cfg.eq.outMid, 0);
});

test('migration turns the old playlist-wide settings and mixOut into per-pair configs', () => {
  const a = { ...song('a'), mixOut: { preset: 'rise', bars: 4, eq: { outLow: 9 } } };
  const b = song('b');
  const c = song('c');
  const pl = {
    id: 'pl_old',
    tracks: [a, b, c],
    mix: {
      enabled: true,
      analysisVersion: 1,
      preparedAt: 123,
      preset: 'blend',
      bars: 16,
      filter: 25
    }
  };
  assert.strictEqual(T.migrate(pl), true);
  assert.strictEqual(pl.mix.preset, undefined);
  assert.strictEqual(pl.mix.bars, undefined);
  assert.strictEqual(pl.mix.filter, undefined);
  assert.strictEqual(a.mixOut, undefined);
  assert.strictEqual(T.transitionFor(pl, a, b).preset, 'rise');
  assert.strictEqual(T.transitionFor(pl, a, b).bars, 4);
  assert.strictEqual(T.transitionFor(pl, a, b).eq.outLow, 9);
  assert.strictEqual(T.transitionFor(pl, b, c).preset, 'blend');
  assert.strictEqual(T.transitionFor(pl, b, c).bars, 16);
  assert.strictEqual(T.transitionFor(pl, b, c).filter, 25);
});

test('a playlist without Mix state is left untouched', () => {
  const pl = { id: 'plain', tracks: [song('a'), song('b')] };
  assert.strictEqual(T.migrate(pl), false);
  assert.strictEqual(pl.mix, undefined);
});

test('duplicate occurrences of the same pair share one config', () => {
  const a = song('a');
  const b = song('b');
  const pl = playlist([a, b, a, b]);
  T.materialize(pl);
  T.updateTransition(pl, a, b, { preset: 'blend' });
  assert.strictEqual(Object.keys(pl.mix.transitions).length, 2); // a>b (twice) and b>a
  assert.strictEqual(T.transitionFor(pl, a, b).preset, 'blend');
  assert.strictEqual(T.transitionFor(pl, b, a).preset, 'auto');
});

const test = require('node:test');
const assert = require('node:assert');
const C = require('../mix-core');

const analysis = (bpm, camelot = '8A', extra = {}) => ({
  v: 1, bpm, bpmConfidence: 0.8, camelot, key: 'A minor', beatOffset: 0.25,
  beats: Array.from({ length: 300 }, (_, i) => 0.25 + (i * 60) / bpm),
  introEnd: 8, outroStart: 180, ...extra
});

test('preset and bar settings are normalized', () => {
  const rise = C.normalizeSettings({ preset: 'rise', bars: 0, bpmMatch: false });
  assert.strictEqual(rise.preset, 'rise');
  assert.strictEqual(rise.bars, 1);
  assert.strictEqual(rise.bpmMatch, false);
  const fallback = C.normalizeSettings({ preset: 'nope', bars: 100 });
  assert.strictEqual(fallback.preset, 'auto');
  assert.strictEqual(fallback.bars, 32);
  assert.strictEqual(fallback.bpmMatch, true);
  assert.strictEqual(fallback.curve, 'equal');
  assert.strictEqual(C.normalizeSettings({ curve: 'smooth' }).curve, 'smooth');
  assert.strictEqual(C.normalizeSettings({ curve: 'nope' }).curve, 'equal');
  assert.strictEqual(C.normalizeSettings(null).bars, 8);
  const custom = C.normalizeSettings({ eq: { outLow: 99, inHigh: 3 }, filter: 150 });
  assert.strictEqual(custom.eq.outLow, 18);
  assert.strictEqual(custom.eq.inHigh, 3);
  assert.strictEqual(custom.filter, 100);
  const cues = C.normalizeSettings({ entry: 8.25, exit: 190.5 });
  assert.strictEqual(cues.entry, 8.25);
  assert.strictEqual(cues.exit, 190.5);
});

test('a manual outgoing cue overrides the bar-based exit', () => {
  const a = analysis(128);
  const plan = C.planTransition({
    fromAnalysis: a,
    toAnalysis: analysis(126, '8A'),
    settings: { bars: 8, exit: 190 },
    end: 200
  });
  assert.ok(plan);
  assert.strictEqual(plan.point, 190);
  assert.strictEqual(plan.duration, 10);
  assert.strictEqual(plan.exit, 190);
  const late = C.planTransition({ fromAnalysis: a, end: 200, settings: { exit: 199 } });
  assert.strictEqual(late.point, 198.5);
  assert.strictEqual(late.duration, 1.5);
});

test('Camelot neighbours are compatible, opposite-side keys are not', () => {
  assert.ok(C.keyCompatible('8A', '8A'));
  assert.ok(C.keyCompatible('8A', '8B'));
  assert.ok(C.keyCompatible('8A', '9A'));
  assert.ok(C.keyCompatible('8A', '7A'));
  assert.ok(!C.keyCompatible('8A', '9B'));
  assert.ok(!C.keyCompatible('', '8A'));
});

test('equal-power fades and EQ/filter curves have sane endpoints', () => {
  assert.strictEqual(C.volumeCurve(0, 'out'), 1);
  assert.ok(Math.abs(C.volumeCurve(1, 'out')) < 1e-9);
  assert.strictEqual(C.volumeCurve(0, 'in'), 0);
  assert.strictEqual(C.volumeCurve(1, 'in'), 1);
  assert.strictEqual(C.eqAt([0, -12], 0.5), -6);
  assert.strictEqual(C.filterAt([20000, 380], 0), 20000);
  assert.strictEqual(C.filterAt([20000, 380], 1), 380);
});

test('presets differ in EQ/filter shape but all crossfade the volume', () => {
  const fade = C.curvesForPreset('fade');
  const rise = C.curvesForPreset('rise');
  const blend = C.curvesForPreset('blend');
  assert.deepStrictEqual(fade.out.volume, [1, 0]);
  assert.deepStrictEqual(fade.out.lp, [20000, 20000]);
  assert.deepStrictEqual(rise.out.lp, [20000, 380]);
  assert.deepStrictEqual(rise.in.hp, [2400, 20]);
  assert.deepStrictEqual(blend.out.low, [0, -12]);
  assert.deepStrictEqual(blend.in.low, [-12, 0]);
});

test('custom EQ and filter adjustments reshape a preset', () => {
  const fade = C.curvesForPreset('fade', { eq: { outLow: 9, inHigh: 4 }, filter: 100 });
  assert.deepStrictEqual(fade.out.low, [0, -9]);
  assert.deepStrictEqual(fade.in.high, [-4, 0]);
  assert.strictEqual(fade.out.lp[0], 20000);
  assert.ok(fade.out.lp[1] >= 380 && fade.out.lp[1] <= 420);
  assert.ok(fade.in.hp[0] >= 1900 && fade.in.hp[0] <= 2100);
  // zero means "use the preset shape", not "flatten the preset"
  const clean = C.curvesForPreset('rise', { filter: 0 });
  assert.deepStrictEqual(clean.out.lp, [20000, 380]);
  assert.deepStrictEqual(clean.in.hp, [2400, 20]);
  const blend = C.curvesForPreset('blend', { eq: { outLow: 0, outMid: 0, outHigh: 0, inLow: 0, inMid: 0, inHigh: 0 } });
  assert.deepStrictEqual(blend.out.low, [0, -12]);
  assert.deepStrictEqual(blend.in.low, [-12, 0]);
});

test('auto chooses Blend for compatible keys and Rise when the tempo jumps', () => {
  assert.strictEqual(C.choosePreset(analysis(128, '8A'), analysis(126, '9A')), 'blend');
  assert.strictEqual(C.choosePreset(analysis(128, '8A'), analysis(128, '9B')), 'rise');
  assert.strictEqual(C.choosePreset(null, analysis(128)), 'fade');
});

test('bar duration follows the outgoing tempo', () => {
  assert.strictEqual(C.transitionDuration(analysis(120), 8), 16);
  assert.strictEqual(C.transitionDuration(analysis(128), 8), 15);
  assert.strictEqual(C.transitionDuration(null, 8), 16);
  assert.strictEqual(C.transitionDuration(analysis(128), 1), 2);
});

test('the hand-off lands on a beat before the end', () => {
  const a = analysis(128);
  const end = 200;
  const plan = C.planTransition({ fromAnalysis: a, toAnalysis: analysis(126, '8A'), settings: { bars: 8, preset: 'auto' }, end });
  assert.ok(plan);
  assert.ok(['fade', 'rise', 'blend'].includes(plan.preset)); // chosen by auto
  assert.ok(plan.point < end - 14 && plan.point > end - 16.1);
  const period = 60 / 128;
  const beatIndex = Math.round((plan.point - 0.25) / period);
  assert.ok(Math.abs(plan.point - (0.25 + beatIndex * period)) < 0.002, `point ${plan.point} is not on the grid`);
  assert.ok(Math.abs(plan.duration - (end - plan.point)) < 0.002);
  assert.ok(Math.abs(plan.wallDuration - plan.duration) < 0.002);
  assert.strictEqual(plan.curve, 'equal');
  assert.ok(plan.curves.out && plan.curves.in);
  const fast = C.planTransition({ fromAnalysis: a, toAnalysis: analysis(126, '8A'), settings: { bars: 8 }, end, playbackRate: 2 });
  assert.ok(Math.abs(fast.wallDuration - fast.duration / 2) < 0.002);
});

test('a song too short for the overlap has no plan', () => {
  assert.strictEqual(C.planTransition({ fromAnalysis: analysis(120), end: 2 }), null);
  assert.strictEqual(C.planTransition({ fromAnalysis: analysis(120), end: 5, settings: { bars: 8 } }), null);
});

test('entry points and tempo matching stay inside safe limits', () => {
  const a = analysis(128);
  const entry = C.entryPoint(a);
  assert.ok(entry >= 8);
  assert.ok(entry < 8 + 60 / 128 + 0.01);
  assert.strictEqual(C.matchedRate({ bpm: 120 }, { bpm: 128 }, 1), 0.9375);
  assert.strictEqual(C.matchedRate({ bpm: 128 }, { bpm: 120 }, 1), 1.0667);
  assert.strictEqual(C.matchedRate({ bpm: 0 }, { bpm: 120 }, 1.1), 1.1);
});

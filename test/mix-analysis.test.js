const test = require('node:test');
const assert = require('node:assert');
const A = require('../mix-analysis');
const P = require('../mix-prep');

const RATE = 11025;

function clickTrack(bpm, seconds) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  const period = 60 / bpm;
  const clickLength = Math.round(0.035 * RATE);
  for (let beat = 0; beat * period < seconds; beat++) {
    const start = Math.round(beat * period * RATE);
    for (let i = 0; i < clickLength && start + i < samples.length; i++) {
      const decay = Math.exp(-i / (0.007 * RATE));
      const tone = Math.sin((2 * Math.PI * 1200 * i) / RATE) * 0.8
        + Math.sin((2 * Math.PI * 2400 * i) / RATE) * 0.35;
      samples[start + i] += tone * decay;
    }
  }
  return samples;
}

function chordTrack(seconds) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  const notes = [110, 220, 261.63, 329.63, 415.3]; // A minor (harmonic): A C E G#
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const swell = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.15 * t);
    let value = 0;
    notes.forEach((freq, index) => {
      value += Math.sin(2 * Math.PI * freq * t) * (index === 0 ? 0.4 : 0.18);
    });
    samples[i] = value * swell * 0.7;
  }
  return samples;
}

test('Camelot mapping matches the wheel', () => {
  assert.strictEqual(A.camelotFor(0, 'major'), '8B'); // C major
  assert.strictEqual(A.camelotFor(7, 'major'), '9B'); // G major
  assert.strictEqual(A.camelotFor(9, 'minor'), '8A'); // A minor
  assert.strictEqual(A.camelotFor(4, 'minor'), '9A'); // E minor
  assert.strictEqual(A.camelotFor(11, 'minor'), '10A'); // B minor
  assert.strictEqual(A.camelotFor(6, 'minor'), '11A'); // F# minor
  assert.strictEqual(A.camelotFor(1, 'minor'), '12A'); // C# minor
  assert.strictEqual(A.camelotFor(8, 'minor'), '1A'); // G# minor
});

test('a steady 128 BPM click track is detected with a usable beat grid', () => {
  const samples = clickTrack(128, 30);
  const result = A.analyzeSamples(samples, RATE, { bars: 64 });
  assert.ok(Math.abs(result.bpm - 128) < 1.5, `expected ~128 BPM, got ${result.bpm}`);
  assert.ok(result.bpmConfidence > 0.25, `confidence ${result.bpmConfidence}`);
  assert.ok(result.beatOffset >= 0 && result.beatOffset < 60 / 128 + 0.02, `offset ${result.beatOffset}`);
  assert.ok(result.beats.length > 40, `beats ${result.beats.length}`);
  for (let i = 1; i < result.beats.length; i++) assert.ok(result.beats[i] > result.beats[i - 1]);
  assert.strictEqual(result.peaks.length, 64);
  assert.ok(result.peaks.every((v) => v >= 0.12 && v <= 1));
  assert.ok(result.introEnd >= 0 && result.outroStart >= result.introEnd);
});

test('an A minor chord is placed on the Camelot wheel', () => {
  const samples = chordTrack(12);
  const result = A.analyzeSamples(samples, RATE, { bars: 32 });
  assert.strictEqual(result.mode, 'minor', `key was ${result.key}`);
  assert.strictEqual(result.root, 9, `root ${result.root} (${result.key})`);
  assert.strictEqual(result.camelot, '8A');
  assert.ok(result.keyConfidence > 0);
});

test('silence and very short clips do not throw', () => {
  const silence = new Float32Array(RATE * 10);
  const quiet = A.analyzeSamples(silence, RATE);
  assert.ok(quiet.bpm === 0 || Number.isFinite(quiet.bpm));
  assert.ok(Array.isArray(quiet.peaks));

  const tiny = A.analyzeSamples(new Float32Array(100), RATE);
  assert.strictEqual(tiny.fallback, true);
  assert.strictEqual(tiny.reason, 'too-short');
});

test('the analyzer and the preparation gate use the same cache version', () => {
  assert.strictEqual(P.DEFAULT_VERSION, A.VERSION);
});

test('fallback entries carry the analysis version', () => {
  const entry = A.fallback('network', 12.5);
  assert.strictEqual(entry.v, A.VERSION);
  assert.strictEqual(entry.fallback, true);
  assert.strictEqual(entry.reason, 'network');
  assert.strictEqual(entry.duration, 12.5);
});

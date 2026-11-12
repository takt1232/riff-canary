const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('the playlist carries a strict Mix preparation gate and a progress panel', () => {
  const html = read('index.html');
  assert.match(html, /id="btn-mix-playlist"/);
  assert.match(html, /id="mix-prep-panel"/);
  assert.match(html, /id="mix-prep-bar"/);
  assert.doesNotMatch(html, /id="mix-preset-select"/);
  assert.doesNotMatch(html, /id="mix-curve-select"/);
  assert.match(html, /id="btn-mix-settings"/);
  assert.match(html, /id="mix-cache-audio"/);
  assert.match(html, /id="mix-cache-progress"/);
  assert.match(html, /id="mix-prep-cache"/);
  assert.match(html, /id="mix-transition-modal"/);
  assert.match(html, /id="mix-transition-preset"/);
  assert.match(html, /id="mix-transition-enabled"/);
  assert.match(html, /id="mix-transition-curve"/);
  assert.match(html, /id="mix-tr-out-low"/);
  assert.ok(html.indexOf('mix-analysis.js') < html.indexOf('app.js'));
  assert.ok(html.indexOf('mix-prep.js') < html.indexOf('app.js'));
  assert.ok(html.indexOf('mix-core.js') < html.indexOf('app.js'));
  assert.ok(html.indexOf('mix-transitions.js') < html.indexOf('app.js'));
});

test('the renderer enforces strict gating and processes only unprocessed unique tracks', () => {
  const app = read('app.js');
  assert.match(app, /function runMixPreparation/);
  assert.match(app, /function mixReadiness/);
  assert.match(app, /mix\.enabled && !readiness\.mixReady/);
  assert.match(app, /CanaryMixPrep\.buildQueue/);
  assert.match(app, /canary_audio_analysis_/);
  assert.match(app, /function updateMixRowStatuses/);
  assert.match(app, /function openMixTransitionEditor/);
  assert.match(app, /CanaryMixTransitions/);
  assert.match(app, /function mixStripsEnabled/);
  assert.match(app, /data-mix-edge-strip/);
  assert.match(app, /cacheMixTrack/);
  assert.match(app, /cacheOnly/);
  assert.match(app, /resetTransitionForSeek/);
  assert.match(app, /prepareCrossfade\(cur, end, mixPlan, true\)/);
  assert.match(app, /xfade\.entrySeek/);
  assert.match(app, /mixTransitionWaveState/);
  assert.match(app, /delete compact\.beats/);
});

test('playback asks the audio engine for a per-deck Mix transition', () => {
  const app = read('app.js');
  const engine = read('audio-engine.js');
  assert.match(app, /function currentMixPlan/);
  assert.match(app, /transitionFor\(pl, state\.currentTrack, nextTrack\)/);
  assert.match(app, /state\.isShuffle/);
  assert.match(app, /startMixTransition/);
  assert.match(app, /function playFromMixEntry/);
  assert.match(app, /ensureTailDeck/);
  assert.match(engine, /ensureTailDeck\(element\)/);
  assert.match(engine, /startMixTransition\(plan\)/);
  assert.match(engine, /this\.mixLow\.connect\(this\.mixMid\)/);
  assert.match(engine, /this\.tailLp\.connect\(this\.tailGain\)/);
});

test('the server exposes the one-time analysis endpoint and caches its result', () => {
  const server = read('server.js');
  assert.match(server, /pathname === '\/api\/analyze-track'/);
  assert.match(server, /analyzeTrackForMix/);
  assert.match(server, /cachedMixAnalysis/);
  assert.match(server, /mixAnalysis\.analyzeSamples/);
  assert.match(server, /saveTrackAnalysis\(cleanId, analysis\)/);
  assert.match(server, /compactMixAnalysis/);
  assert.match(server, /pathname === '\/api\/cache-track'/);
  assert.match(server, /cacheTrackForMix/);
  assert.match(server, /prepareOnly/);
});

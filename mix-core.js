// Canary Mix transition planning: presets, bar-based durations, beat-aligned exit points and the
// volume/EQ/filter curves the audio engine schedules. No DOM and no Web Audio here: app.js/audio-engine.js
// use it, test/mix-core.test.js runs it in Node.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CanaryMixCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const PRESETS = ['auto', 'fade', 'rise', 'blend'];
  const NEUTRAL = { volume: [1, 1], low: [0, 0], mid: [0, 0], high: [0, 0], hp: [20, 20], lp: [20000, 20000] };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v, places = 2) => {
    const m = Math.pow(10, places);
    return Math.round((Number(v) || 0) * m) / m;
  };
  const finite = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  function presetName(value) {
    return PRESETS.includes(value) ? value : 'auto';
  }

  function normalizeSettings(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const eq = s.eq && typeof s.eq === 'object' ? s.eq : {};
    const cleanDb = (v) => (v == null ? null : round(clamp(finite(v), 0, 18), 1));
    const cleanTime = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) >= 0 ? round(Number(v), 3) : null));
    return {
      preset: presetName(s.preset),
      bars: clamp(Math.round(finite(s.bars, 8)), 1, 32),
      bpmMatch: s.bpmMatch !== false,
      curve: ['equal', 'linear', 'smooth'].includes(s.curve) ? s.curve : 'equal',
      eq: {
        outLow: cleanDb(eq.outLow),
        outMid: cleanDb(eq.outMid),
        outHigh: cleanDb(eq.outHigh),
        inLow: cleanDb(eq.inLow),
        inMid: cleanDb(eq.inMid),
        inHigh: cleanDb(eq.inHigh)
      },
      filter: s.filter == null ? null : round(clamp(finite(s.filter), 0, 100), 0),
      entry: cleanTime(s.entry),
      exit: cleanTime(s.exit)
    };
  }

  function camelotParts(value) {
    const match = /^(\d{1,2})([AB])$/i.exec(String(value || '').trim());
    if (!match) return null;
    const number = Number(match[1]);
    if (!(number >= 1 && number <= 12)) return null;
    return { number, letter: match[2].toUpperCase() };
  }

  // Harmonically compatible: the same number (relative major/minor) or a neighbour on the same side.
  function keyCompatible(a, b) {
    const x = camelotParts(a);
    const y = camelotParts(b);
    if (!x || !y) return false;
    if (x.number === y.number) return true;
    if (x.letter !== y.letter) return false;
    const distance = Math.abs(x.number - y.number);
    return distance === 1 || distance === 11;
  }

  function volumeCurve(p, kind = 'out') {
    const x = clamp(Number(p) || 0, 0, 1);
    return kind === 'in' ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2);
  }

  function eqAt(range, p) {
    return round(finite(range && range[0]) + (finite(range && range[1]) - finite(range && range[0])) * clamp(Number(p) || 0, 0, 1), 2);
  }

  // Filter sweeps sound linear in octaves, not in Hz.
  function filterAt(range, p) {
    const from = clamp(finite(range && range[0], 20), 20, 20000);
    const to = clamp(finite(range && range[1], 20000), 20, 20000);
    const x = clamp(Number(p) || 0, 0, 1);
    return round(from * Math.pow(to / from, x), 1);
  }

  function curvesForPreset(preset, adjustments) {
    const name = presetName(preset);
    let curves;
    if (name === 'rise') {
      curves = {
        out: { ...NEUTRAL, volume: [1, 0], lp: [20000, 380] },
        in: { ...NEUTRAL, volume: [0, 1], hp: [2400, 20] }
      };
    } else if (name === 'blend') {
      curves = {
        out: { ...NEUTRAL, volume: [1, 0], low: [0, -12], mid: [0, -2] },
        in: { ...NEUTRAL, volume: [0, 1], low: [-12, 0], mid: [-2, 0] }
      };
    } else {
      curves = {
        out: { ...NEUTRAL, volume: [1, 0] },
        in: { ...NEUTRAL, volume: [0, 1] }
      };
    }
    const a = adjustments && typeof adjustments === 'object' ? adjustments : {};
    const eq = a.eq && typeof a.eq === 'object' ? a.eq : {};
    const cut = (v) => -clamp(finite(v), 0, 18);
    // All-zero EQ/filter means "use the preset's own shape", not "flatten it". A custom value applies
    // the whole band set, so a user can still deliberately zero a band while cutting another.
    const hasEq = ['outLow', 'outMid', 'outHigh', 'inLow', 'inMid', 'inHigh']
      .some((key) => eq[key] != null && Number(eq[key]) > 0);
    if (hasEq) {
      curves.out.low = [0, cut(eq.outLow)];
      curves.out.mid = [0, cut(eq.outMid)];
      curves.out.high = [0, cut(eq.outHigh)];
      curves.in.low = [cut(eq.inLow), 0];
      curves.in.mid = [cut(eq.inMid), 0];
      curves.in.high = [cut(eq.inHigh), 0];
    }
    if (a.filter != null && Number(a.filter) > 0) {
      const amount = clamp(finite(a.filter), 0, 100) / 100;
      const lpEnd = 20000 * Math.pow(0.02, amount); // 20 kHz -> 400 Hz
      const hpStart = 20 * Math.pow(100, amount);   // 20 Hz -> 2 kHz
      curves.out.lp = [20000, round(lpEnd, 1)];
      curves.in.hp = [round(hpStart, 1), 20];
    }
    return curves;
  }

  function choosePreset(fromAnalysis, toAnalysis) {
    if (!fromAnalysis || !toAnalysis || fromAnalysis.fallback || toAnalysis.fallback) return 'fade';
    const a = fromAnalysis.camelot;
    const b = toAnalysis.camelot;
    if (a && b) return keyCompatible(a, b) ? 'blend' : 'rise';
    const fromBpm = finite(fromAnalysis.bpm);
    const toBpm = finite(toAnalysis.bpm);
    if (fromBpm > 0 && toBpm > 0) {
      const ratio = toBpm / fromBpm;
      if (ratio < 0.94 || ratio > 1.06) return 'rise';
    }
    return 'blend';
  }

  function beatGrid(analysis) {
    if (!analysis || analysis.fallback) return null;
    const bpm = finite(analysis.bpm);
    if (!(bpm > 0)) return null;
    const period = 60 / bpm;
    const offset = finite(analysis.beatOffset);
    if (Array.isArray(analysis.beats) && analysis.beats.length > 1) {
      return { bpm, period, offset, beats: analysis.beats };
    }
    return { bpm, period, offset, beats: null };
  }

  function nearestBeat(time, analysis, direction = 'nearest') {
    const grid = beatGrid(analysis);
    const t = finite(time);
    if (!grid) return round(t, 3);
    const period = grid.period;
    if (Array.isArray(grid.beats) && grid.beats.length) {
      const first = grid.beats[0];
      const last = grid.beats[grid.beats.length - 1];
      // A stored grid only covers the analyzed window; outside it, use the constant-tempo grid.
      if (t >= first - period * 0.5 && t <= last + period * 0.5) {
        let best = direction === 'before' ? first : direction === 'after' ? last : first;
        for (const beat of grid.beats) {
          if (direction === 'before' && beat > t + 0.001) break;
          if (direction === 'after' && beat < t - 0.001) continue;
          if (Math.abs(beat - t) < Math.abs(best - t)) best = beat;
        }
        return round(best, 3);
      }
    }
    const n = Math.round((t - grid.offset) / period);
    let beat = grid.offset + n * period;
    if (direction === 'before' && beat > t) beat -= period;
    if (direction === 'after' && beat < t) beat += period;
    return round(beat, 3);
  }

  function transitionDuration(fromAnalysis, bars = 8, playbackRate = 1, fallbackBpm = 120) {
    const bpm = finite(fromAnalysis && fromAnalysis.bpm, fallbackBpm) * (finite(playbackRate, 1) || 1);
    const safeBpm = bpm > 0 ? bpm : fallbackBpm;
    return round(clamp((60 / safeBpm) * 4 * clamp(Math.round(bars), 1, 32), 2, 30), 2);
  }

  // end: the outgoing song's real/trim end in seconds. point: where its tail starts.
  function planTransition({ fromAnalysis, toAnalysis, settings, end, playbackRate = 1 } = {}) {
    const opts = normalizeSettings(settings);
    const durationWanted = transitionDuration(fromAnalysis, opts.bars, playbackRate);
    const endTime = finite(end);
    if (!(endTime > 2)) return null;
    let point;
    if (opts.exit != null && Number.isFinite(Number(opts.exit))) {
      // A manually dragged outgoing cue wins over the bar calculation. Keep a little tail to crossfade.
      point = round(clamp(Number(opts.exit), 0.25, endTime - 1.5), 3);
    } else {
      point = round(endTime - durationWanted, 3);
      if (point <= 0.25) return null;
      // Put the hand-off on a beat when the outgoing grid is known; the incoming deck is started from
      // its own first beat (or its natural start) and the overlap length follows that beat.
      if (fromAnalysis && !fromAnalysis.fallback && finite(fromAnalysis.bpm) > 0) {
        point = nearestBeat(point, fromAnalysis, 'before');
      }
    }
    const duration = round(endTime - point, 3);
    if (!(duration >= 1.5)) return null;
    const preset = opts.preset === 'auto' ? choosePreset(fromAnalysis, toAnalysis) : opts.preset;
    return {
      v: VERSION,
      preset,
      bars: opts.bars,
      bpmMatch: opts.bpmMatch,
      curve: opts.curve,
      entry: opts.entry,
      exit: opts.exit,
      duration,
      // song seconds -> wall-clock seconds while the outgoing deck runs at playbackRate
      wallDuration: round(duration / Math.max(0.25, finite(playbackRate, 1) || 1), 3),
      point,
      end: endTime,
      curves: curvesForPreset(preset, { eq: opts.eq, filter: opts.filter }),
      from: fromAnalysis || null,
      to: toAnalysis || null
    };
  }

  // The incoming song starts at its first usable beat, not in the middle of an intro hit.
  function entryPoint(analysis, fallback = 0) {
    if (!analysis || analysis.fallback) return round(fallback, 3);
    const grid = beatGrid(analysis);
    if (!grid) return round(fallback, 3);
    const introEnd = finite(analysis.introEnd);
    const candidate = introEnd > 0.5 ? introEnd : grid.offset;
    return nearestBeat(candidate, analysis, 'after');
  }

  // A safe playback rate for the incoming deck when it should meet the outgoing tempo.
  function matchedRate(fromAnalysis, toAnalysis, baseRate = 1) {
    const fromBpm = finite(fromAnalysis && fromAnalysis.bpm);
    const toBpm = finite(toAnalysis && toAnalysis.bpm);
    const base = finite(baseRate, 1) || 1;
    if (!(fromBpm > 0) || !(toBpm > 0)) return base;
    const rate = base * (fromBpm / toBpm);
    // Never stretch a song so far that it turns into a different record.
    return round(clamp(rate, base * 0.92, base * 1.08), 4);
  }

  function describePreset(value) {
    switch (presetName(value)) {
      case 'rise': return 'Rise';
      case 'blend': return 'Blend';
      case 'fade': return 'Fade';
      default: return 'Auto';
    }
  }

  return {
    VERSION,
    PRESETS,
    NEUTRAL,
    normalizeSettings,
    presetName,
    presetList: () => PRESETS.slice(),
    describePreset,
    camelotParts,
    keyCompatible,
    volumeCurve,
    eqAt,
    filterAt,
    curvesForPreset,
    choosePreset,
    beatGrid,
    nearestBeat,
    transitionDuration,
    planTransition,
    entryPoint,
    matchedRate
  };
});

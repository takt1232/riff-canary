// Canary Mix transitions are per adjacent pair, not per playlist. This module owns the edge keys,
// default/materialized configs, legacy migration and lookup. The playlist keeps only the master Mix
// switch and the analysis preparation state. No DOM: app.js draws the strips, test/mix-transitions.test.js
// runs this in Node.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CanaryMixTransitions = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BARS = 8;
  const PRESETS = ['auto', 'fade', 'rise', 'blend'];
  const CURVES = ['equal', 'linear', 'smooth'];
  const LEGACY_KEYS = ['preset', 'bars', 'curve', 'bpmMatch', 'eq', 'filter'];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v, places = 2) => {
    const m = Math.pow(10, places);
    return Math.round((Number(v) || 0) * m) / m;
  };

  function cleanId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function trackKey(track) {
    if (!track) return '';
    const platform = track.platform || 'yt';
    if (track.id) return `${platform}:${track.id}`;
    if (track.url || track.videoId) return `${platform}:${track.url || track.videoId}`;
    return `${platform}:${String(track.title || '').trim().toLowerCase()}|${String(track.artist || '').trim().toLowerCase()}|${Math.round(Number(track.duration) || 0)}`;
  }

  function edgeKey(from, to) {
    const a = trackKey(from);
    const b = trackKey(to);
    return a && b ? `${a}>${b}` : '';
  }

  function cleanEq(eq) {
    const e = eq && typeof eq === 'object' ? eq : {};
    const val = (v) => round(clamp(Number(v) || 0, 0, 18), 1);
    return {
      outLow: val(e.outLow),
      outMid: val(e.outMid),
      outHigh: val(e.outHigh),
      inLow: val(e.inLow),
      inMid: val(e.inMid),
      inHigh: val(e.inHigh)
    };
  }

  function cleanTime(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? round(n, 3) : null;
  }

  function normalizeTransition(value) {
    const s = value && typeof value === 'object' ? value : {};
    return {
      enabled: s.enabled !== false,
      preset: PRESETS.includes(s.preset) ? s.preset : 'auto',
      bars: clamp(Math.round(Number(s.bars) || DEFAULT_BARS), 1, 32),
      curve: CURVES.includes(s.curve) ? s.curve : 'equal',
      bpmMatch: s.bpmMatch !== false,
      eq: cleanEq(s.eq),
      filter: round(clamp(Number(s.filter) || 0, 0, 100), 0),
      entry: cleanTime(s.entry),
      exit: cleanTime(s.exit)
    };
  }

  function makeDefault(overrides) {
    return normalizeTransition({
      enabled: true,
      preset: 'auto',
      bars: DEFAULT_BARS,
      curve: 'equal',
      bpmMatch: true,
      eq: {},
      filter: 0,
      entry: null,
      exit: null,
      ...(overrides && typeof overrides === 'object' ? overrides : {})
    });
  }

  function ensureMix(playlist) {
    if (!playlist || typeof playlist !== 'object') return null;
    if (!playlist.mix || typeof playlist.mix !== 'object' || Array.isArray(playlist.mix)) {
      playlist.mix = { enabled: false, transitions: {} };
    }
    if (!playlist.mix.transitions || typeof playlist.mix.transitions !== 'object' || Array.isArray(playlist.mix.transitions)) {
      playlist.mix.transitions = {};
    }
    return playlist.mix;
  }

  function pairs(playlist) {
    const tracks = Array.isArray(playlist && playlist.tracks) ? playlist.tracks : [];
    const out = [];
    for (let i = 0; i + 1 < tracks.length; i++) {
      out.push({ from: tracks[i], to: tracks[i + 1], key: edgeKey(tracks[i], tracks[i + 1]) });
    }
    return out.filter((row) => row.key);
  }

  function legacyDefaults(mix) {
    if (!mix) return null;
    const present = LEGACY_KEYS.some((key) => mix[key] !== undefined);
    if (!present) return null;
    return normalizeTransition({
      enabled: true,
      preset: mix.preset,
      bars: mix.bars,
      curve: mix.curve,
      bpmMatch: mix.bpmMatch,
      eq: mix.eq,
      filter: mix.filter
    });
  }

  // Add explicit configs for every adjacent pair. Existing pair configs are kept; new pairs start from
  // `defaults` (or Auto/8 bars). A playlist with no mix state is left alone.
  function materialize(playlist, defaults) {
    if (!playlist || !playlist.mix) return false;
    const mix = ensureMix(playlist);
    const base = defaults ? normalizeTransition(defaults) : makeDefault();
    let changed = false;
    for (const row of pairs(playlist)) {
      if (!mix.transitions[row.key]) {
        mix.transitions[row.key] = makeDefault(base);
        changed = true;
        continue;
      }
      const normalized = normalizeTransition(mix.transitions[row.key]);
      if (JSON.stringify(normalized) !== JSON.stringify(mix.transitions[row.key])) {
        mix.transitions[row.key] = normalized;
        changed = true;
      }
    }
    return changed;
  }

  // One-time conversion from the old playlist-wide settings + track.mixOut overrides.
  function migrate(playlist) {
    if (!playlist || !playlist.mix) return false;
    const mix = ensureMix(playlist);
    let changed = false;
    const legacy = legacyDefaults(mix);
    if (materialize(playlist, legacy || undefined)) changed = true;

    const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    for (let i = 0; i + 1 < tracks.length; i++) {
      const old = tracks[i] && tracks[i].mixOut;
      if (!old || typeof old !== 'object') continue;
      const key = edgeKey(tracks[i], tracks[i + 1]);
      if (!key) continue;
      mix.transitions[key] = normalizeTransition({
        ...(mix.transitions[key] || makeDefault()),
        ...old,
        enabled: old.enabled !== false
      });
      changed = true;
    }
    for (const track of tracks) {
      if (track && Object.prototype.hasOwnProperty.call(track, 'mixOut')) {
        delete track.mixOut;
        changed = true;
      }
    }
    for (const key of LEGACY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(mix, key)) {
        delete mix[key];
        changed = true;
      }
    }
    return changed;
  }

  function transitionFor(playlist, from, to) {
    const mix = playlist && playlist.mix;
    if (!mix || !mix.transitions) return null;
    const key = edgeKey(from, to);
    return key && mix.transitions[key] ? mix.transitions[key] : null;
  }

  function updateTransition(playlist, from, to, patch) {
    const mix = ensureMix(playlist);
    const key = edgeKey(from, to);
    if (!mix || !key) return null;
    const current = normalizeTransition(mix.transitions[key] || makeDefault());
    const p = patch && typeof patch === 'object' ? patch : {};
    const next = normalizeTransition({
      ...current,
      ...p,
      eq: p.eq ? { ...current.eq, ...p.eq } : current.eq
    });
    mix.transitions[key] = next;
    return next;
  }

  function resetTransition(playlist, from, to) {
    return updateTransition(playlist, from, to, makeDefault());
  }

  function edges(playlist) {
    const mix = playlist && playlist.mix;
    return pairs(playlist).map((row) => ({ ...row, config: mix && mix.transitions ? mix.transitions[row.key] || null : null }));
  }

  function hasLegacy(playlist) {
    if (!playlist || !playlist.mix) return false;
    if (LEGACY_KEYS.some((key) => playlist.mix[key] !== undefined)) return true;
    return (Array.isArray(playlist.tracks) ? playlist.tracks : []).some((track) => track && track.mixOut);
  }

  function describe(config) {
    if (!config || config.enabled === false) return 'No mix';
    const preset = config.preset && config.preset !== 'auto'
      ? config.preset.charAt(0).toUpperCase() + config.preset.slice(1)
      : 'Auto';
    return `${preset} · ${config.bars || DEFAULT_BARS} bars`;
  }

  return {
    DEFAULT_BARS,
    PRESETS,
    CURVES,
    trackKey,
    edgeKey,
    cleanEq,
    normalizeTransition,
    makeDefault,
    ensureMix,
    pairs,
    materialize,
    migrate,
    transitionFor,
    updateTransition,
    resetTransition,
    edges,
    hasLegacy,
    describe
  };
});

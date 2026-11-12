// Canary Mix preparation state: which unique songs in a playlist still need analysis, whether the
// playlist is ready for Mix, and how far a preparation run has got. Strict gating: Mix may only be
// enabled when every unique song is either ready or has a terminal fallback. No DOM: app.js draws the
// progress panel, test/mix-prep.test.js runs this in Node.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CanaryMixPrep = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_VERSION = 1;
  const TERMINAL = new Set(['ready', 'fallback']);

  function cleanId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  // Stable identity of a playlist row. Duplicates collapse to one analysis job.
  function trackKey(track) {
    if (!track) return '';
    const platform = track.platform || 'yt';
    if (track.id) return `${platform}:${track.id}`;
    if (track.url || track.videoId) return `${platform}:${track.url || track.videoId}`;
    return `${platform}:${String(track.title || '').trim().toLowerCase()}|${String(track.artist || '').trim().toLowerCase()}|${Math.round(Number(track.duration) || 0)}`;
  }

  // The key the analysis cache uses. It is deliberately based on the platform track id alone, so the
  // same YouTube video shares one analysis across playlists and duplicated rows.
  function analysisKey(track) {
    if (!track) return '';
    if (track.id) return cleanId(track.id);
    return cleanId(trackKey(track));
  }

  function uniqueTracks(tracks) {
    const out = [];
    const seen = new Set();
    for (const track of Array.isArray(tracks) ? tracks : []) {
      const key = trackKey(track);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(track);
    }
    return out;
  }

  function entryVersion(entry, version) {
    return Number(entry && entry.v) === Number(version);
  }

  function statusOf(track, getAnalysis, version = DEFAULT_VERSION) {
    const entry = typeof getAnalysis === 'function' ? getAnalysis(track) : null;
    if (!entry || !entryVersion(entry, version)) return 'unprocessed';
    if (entry.fallback) return 'fallback';
    return 'ready';
  }

  // A ready analysis can still be only "basic" (tempo or key missing/low confidence): Mix may use it,
  // but the transition editor should default to a simple fade.
  function qualityOf(entry) {
    if (!entry || entry.fallback) return 'fallback';
    const bpm = Number(entry.bpm);
    const key = String(entry.key || '');
    const bpmConfidence = Number(entry.bpmConfidence) || 0;
    if (bpm > 0 && key && bpmConfidence >= 0.25) return 'full';
    return 'basic';
  }

  function isTerminal(status) {
    return TERMINAL.has(status);
  }

  // counts/progress over unique songs, in playlist order
  function readiness(tracks, getAnalysis, version = DEFAULT_VERSION) {
    const unique = uniqueTracks(tracks);
    let ready = 0;
    let fallback = 0;
    let unprocessed = 0;
    const rows = unique.map((track) => {
      const status = statusOf(track, getAnalysis, version);
      if (status === 'ready') ready++;
      else if (status === 'fallback') fallback++;
      else unprocessed++;
      return { track, key: trackKey(track), status, quality: status === 'ready' ? qualityOf(getAnalysis(track)) : 'fallback' };
    });
    const total = unique.length;
    const done = ready + fallback;
    return {
      total,
      ready,
      fallback,
      unprocessed,
      done,
      progress: total ? done / total : 1,
      mixReady: unprocessed === 0,
      needsPreparation: unprocessed > 0,
      rows
    };
  }

  // The unique songs that still need an analysis run, in playlist order.
  function buildQueue(tracks, getAnalysis, version = DEFAULT_VERSION) {
    return uniqueTracks(tracks).filter((track) => statusOf(track, getAnalysis, version) === 'unprocessed');
  }

  // FNV-1a over the sorted unique songs and their durations. Reordering a playlist keeps this stable;
  // adding, replacing or changing the length of a song changes it.
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function fingerprint(tracks, version = DEFAULT_VERSION) {
    const rows = uniqueTracks(tracks)
      .map((track) => `${trackKey(track)}:${Math.round(Number(track.duration) || 0)}`)
      .sort();
    return hash(`${rows.join('|')}|v${Number(version)}`);
  }

  function fallbackEntry(reason, duration = 0, version = DEFAULT_VERSION) {
    return {
      v: version,
      fallback: true,
      reason: String(reason || 'unavailable'),
      duration: Math.round((Number(duration) || 0) * 100) / 100,
      analyzedAt: Date.now()
    };
  }

  // A short label for the preparation panel / transition row.
  function fallbackLabel(reason) {
    switch (String(reason || '')) {
      case 'offline': return 'Needs internet';
      case 'unavailable': return 'Unavailable';
      case 'hls': return 'Live stream';
      case 'too-short': return 'Too short';
      case 'no-audio': return 'No audio';
      case 'decode': return 'Could not decode';
      case 'timeout': return 'Timed out';
      case 'low-confidence': return 'Basic mix only';
      default: return 'Standard fade';
    }
  }

  return {
    DEFAULT_VERSION,
    trackKey,
    analysisKey,
    uniqueTracks,
    statusOf,
    qualityOf,
    isTerminal,
    readiness,
    buildQueue,
    fingerprint,
    fallbackEntry,
    fallbackLabel
  };
});

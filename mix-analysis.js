// Audio analysis for Canary Mix: tempo, beat grid, musical key / Camelot and waveform peaks.
// No DOM and no native modules: the server decodes a mono 11 kHz window with ffmpeg and runs this,
// test/mix-analysis.test.js runs it in Node on synthetic audio. Results are cached per track.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CanaryMixAnalysis = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const DEFAULT_BARS = 160;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Krumhansl-Kessler key profiles
  const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v, places = 2) => {
    const m = Math.pow(10, places);
    return Math.round((Number(v) || 0) * m) / m;
  };

  class FFT {
    constructor(size) {
      this.n = size;
      this.levels = Math.round(Math.log2(size));
      this.rev = new Uint32Array(size);
      for (let i = 0; i < size; i++) {
        let value = i;
        let reversed = 0;
        for (let bit = 0; bit < this.levels; bit++) {
          reversed = (reversed << 1) | (value & 1);
          value >>= 1;
        }
        this.rev[i] = reversed;
      }
      this.cos = new Float32Array(size / 2);
      this.sin = new Float32Array(size / 2);
      for (let i = 0; i < size / 2; i++) {
        const angle = (2 * Math.PI * i) / size;
        this.cos[i] = Math.cos(angle);
        this.sin[i] = Math.sin(angle);
      }
    }

    transform(re, im) {
      const n = this.n;
      const rev = this.rev;
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let start = 0; start < n; start += size) {
          for (let j = 0; j < half; j++) {
            const k = j * step;
            const c = this.cos[k];
            const s = -this.sin[k];
            const a = start + j;
            const b = a + half;
            const tr = re[b] * c - im[b] * s;
            const ti = re[b] * s + im[b] * c;
            re[b] = re[a] - tr;
            im[b] = im[a] - ti;
            re[a] += tr;
            im[a] += ti;
          }
        }
      }
    }
  }

  function hann(size) {
    const win = new Float32Array(size);
    for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    return win;
  }

  function camelotFor(root, mode) {
    const pc = ((Math.round(root) % 12) + 12) % 12;
    // major: C=8B, G=9B, ...; minor: A=8A, E=9A, ...
    const number = mode === 'minor'
      ? ((7 * pc + 4) % 12) + 1
      : ((7 * pc + 7) % 12) + 1;
    return `${number}${mode === 'minor' ? 'A' : 'B'}`;
  }

  function keyName(root, mode) {
    return `${NOTE_NAMES[((root % 12) + 12) % 12]} ${mode}`;
  }

  // ---- onset envelope / tempo ----

  function onsetEnvelope(samples, sampleRate) {
    const frameSize = 1024;
    const hop = 256;
    const frameRate = sampleRate / hop;
    const frames = Math.max(0, Math.floor((samples.length - frameSize) / hop) + 1);
    if (frames < 8) return { env: new Float32Array(0), frameRate };

    const fft = new FFT(frameSize);
    const win = hann(frameSize);
    const re = new Float32Array(frameSize);
    const im = new Float32Array(frameSize);
    const prev = new Float32Array(frameSize / 2);
    const env = new Float32Array(frames);

    for (let f = 0; f < frames; f++) {
      const start = f * hop;
      for (let i = 0; i < frameSize; i++) {
        re[i] = (samples[start + i] || 0) * win[i];
        im[i] = 0;
      }
      fft.transform(re, im);
      let flux = 0;
      for (let bin = 1; bin < frameSize / 2; bin++) {
        const mag = Math.log1p(Math.hypot(re[bin], im[bin]));
        const diff = mag - prev[bin];
        if (diff > 0) flux += diff;
        prev[bin] = mag;
      }
      env[f] = flux;
    }

    // Remove the slow loudness envelope and keep transients. A moving average over ~0.6 s
    // follows builds/drops without eating the beat-to-beat changes we need.
    const avgWindow = Math.max(2, Math.round(frameRate * 0.6));
    const raw = new Float32Array(env);
    let sum = 0;
    let max = 0;
    for (let i = 0; i < frames; i++) {
      sum += raw[i];
      if (i >= avgWindow) sum -= raw[i - avgWindow];
      const mean = sum / Math.min(i + 1, avgWindow);
      env[i] = Math.max(0, raw[i] - mean);
      if (env[i] > max) max = env[i];
    }
    if (max > 0) for (let i = 0; i < frames; i++) env[i] /= max;
    return { env, frameRate };
  }

  function autocorrelation(env, minLag, maxLag) {
    const out = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let dot = 0;
      let a = 0;
      let b = 0;
      for (let i = 0; i + lag < env.length; i++) {
        const x = env[i];
        const y = env[i + lag];
        dot += x * y;
        a += x * x;
        b += y * y;
      }
      out[lag] = dot / (Math.sqrt(a * b) + 1e-9);
    }
    return out;
  }

  function tempoPrior(bpm) {
    // Prefer the usual 90-150 BPM range without making a genuine 75 or 170 impossible.
    const x = Math.log2(Math.max(40, bpm) / 120) / 0.75;
    return Math.exp(-0.5 * x * x);
  }

  function phaseScore(env, frameRate, bpm, bins = 48) {
    if (!(bpm > 0) || !env.length) return { score: 0, offset: 0 };
    const period = (60 / bpm) * frameRate;
    if (!(period > 2)) return { score: 0, offset: 0 };
    const hist = new Float32Array(bins);
    const max = Math.max(...env) || 1;
    for (let i = 0; i < env.length; i++) {
      const value = env[i];
      if (value < max * 0.04) continue;
      const phase = (i % period) / period;
      const bin = Math.min(bins - 1, Math.floor(phase * bins));
      hist[bin] += value;
    }
    let bestBin = 0;
    let best = 0;
    let total = 0;
    for (let i = 0; i < bins; i++) {
      total += hist[i];
      if (hist[i] > best) { best = hist[i]; bestBin = i; }
    }
    return { score: total ? best / total : 0, offset: ((bestBin + 0.5) / bins) * period };
  }

  function detectTempo(samples, sampleRate) {
    const { env, frameRate } = onsetEnvelope(samples, sampleRate);
    if (env.length < frameRate * 4) {
      return { bpm: 0, confidence: 0, beatOffset: 0, beats: [], env, frameRate };
    }

    const minLag = Math.max(4, Math.floor(frameRate * 60 / 200));
    const maxLag = Math.min(env.length - 2, Math.ceil(frameRate * 60 / 60));
    if (maxLag <= minLag) return { bpm: 0, confidence: 0, beatOffset: 0, beats: [], env, frameRate };

    const ac = autocorrelation(env, minLag, maxLag);
    let bestLag = minLag;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = (60 * frameRate) / lag;
      const score = ac[lag] * tempoPrior(bpm);
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }

    // Parabolic interpolation around the integer-lag peak.
    const left = ac[bestLag - 1] || 0;
    const right = ac[bestLag + 1] || 0;
    const denom = left - 2 * ac[bestLag] + right;
    const delta = Math.abs(denom) > 1e-6 ? clamp(0.5 * (left - right) / denom, -0.5, 0.5) : 0;
    let bpm = (60 * frameRate) / (bestLag + delta);

    // Normalize the common half/double-tempo ambiguities into 70-180 BPM.
    while (bpm > 0 && bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    if (!(bpm > 0) || !Number.isFinite(bpm)) return { bpm: 0, confidence: 0, beatOffset: 0, beats: [], env, frameRate };

    // Refine around the candidate: the autocorrelation lag is quantized by the onset frame.
    let refined = { bpm, score: -Infinity, offset: 0 };
    const candidates = [];
    for (let d = -2; d <= 2.0001; d += 0.1) {
      const candidate = bpm + d;
      if (candidate < 60 || candidate > 200) continue;
      candidates.push(candidate);
    }
    // Also compare the half tempo when the normalized result is fast; 180 vs 90 is otherwise a coin flip.
    if (bpm > 160) candidates.push(bpm / 2);
    if (bpm < 80) candidates.push(bpm * 2);
    for (const candidate of candidates) {
      const phase = phaseScore(env, frameRate, candidate);
      // A small prior keeps the refinement from wandering to a harmonically related tempo.
      const score = phase.score * tempoPrior(candidate);
      if (score > refined.score) refined = { bpm: candidate, score, offset: phase.offset };
    }
    bpm = refined.bpm;

    const maxEnv = Math.max(...env) || 1;
    const beatTimes = [];
    const periodSec = 60 / bpm;
    let t = refined.offset / frameRate;
    while (t - periodSec >= 0) t -= periodSec;
    while (t < 0) t += periodSec;
    const snap = Math.max(1, Math.round(periodSec * frameRate * 0.12));
    const duration = samples.length / sampleRate;
    let last = -Infinity;
    for (; t < duration; t += periodSec) {
      const center = Math.round(t * frameRate);
      let bestIdx = center;
      let bestVal = -Infinity;
      for (let i = Math.max(0, center - snap); i <= Math.min(env.length - 1, center + snap); i++) {
        if (env[i] > bestVal) { bestVal = env[i]; bestIdx = i; }
      }
      let beat = bestVal > maxEnv * 0.08 ? bestIdx / frameRate : t;
      if (beat <= last + periodSec * 0.4) beat = last + periodSec;
      if (beat >= duration) break;
      beatTimes.push(round(beat, 3));
      last = beat;
      if (beatTimes.length > 4096) break;
    }

    const confidence = clamp(0.65 * ac[bestLag] + 0.35 * refined.score, 0, 1);
    return {
      bpm: round(bpm, 1),
      confidence: round(confidence, 2),
      beatOffset: round(beatTimes[0] || 0, 3),
      beats: beatTimes,
      env,
      frameRate
    };
  }

  // ---- chroma / key ----

  function pearson(a, b) {
    const n = a.length;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma;
      const y = b[i] - mb;
      num += x * y;
      da += x * x;
      db += y * y;
    }
    return num / (Math.sqrt(da * db) + 1e-9);
  }

  function detectKey(samples, sampleRate) {
    const frameSize = 4096;
    const hop = 2048;
    if (samples.length < frameSize) return { key: '', mode: '', root: -1, camelot: '', confidence: 0 };

    const fft = new FFT(frameSize);
    const win = hann(frameSize);
    const re = new Float32Array(frameSize);
    const im = new Float32Array(frameSize);
    const chroma = new Float32Array(12);
    let totalEnergy = 0;
    let frames = 0;

    for (let start = 0; start + frameSize <= samples.length; start += hop) {
      let energy = 0;
      for (let i = 0; i < frameSize; i++) {
        const value = samples[start + i] || 0;
        energy += value * value;
        re[i] = value * win[i];
        im[i] = 0;
      }
      if (energy < 1e-6) continue;
      fft.transform(re, im);
      const frameChroma = new Float32Array(12);
      let frameEnergy = 0;
      for (let bin = 2; bin < frameSize / 2; bin++) {
        const freq = (bin * sampleRate) / frameSize;
        if (freq < 65 || freq > 2200) continue;
        const mag = Math.hypot(re[bin], im[bin]);
        if (mag < 1e-4) continue;
        const midi = 69 + 12 * Math.log2(freq / 440);
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        frameChroma[pc] += Math.log1p(mag);
        frameEnergy += mag;
      }
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += frameChroma[i];
      if (sum <= 0) continue;
      const weight = Math.sqrt(frameEnergy);
      for (let i = 0; i < 12; i++) chroma[i] += (frameChroma[i] / sum) * weight;
      totalEnergy += weight;
      frames++;
    }
    if (!frames || totalEnergy <= 0) return { key: '', mode: '', root: -1, camelot: '', confidence: 0 };

    let chromaSum = 0;
    for (let i = 0; i < 12; i++) chromaSum += chroma[i];
    if (chromaSum <= 0) return { key: '', mode: '', root: -1, camelot: '', confidence: 0 };
    for (let i = 0; i < 12; i++) chroma[i] /= chromaSum;

    const results = [];
    for (let root = 0; root < 12; root++) {
      for (const mode of ['major', 'minor']) {
        const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
        const rotated = new Array(12);
        for (let pc = 0; pc < 12; pc++) rotated[pc] = profile[(pc - root + 12) % 12];
        results.push({ root, mode, score: pearson(chroma, rotated) });
      }
    }
    results.sort((a, b) => b.score - a.score);
    const best = results[0];
    const second = results[1] || { score: 0 };
    const confidence = clamp((best.score - second.score) * 4 + Math.max(0, best.score - 0.25) * 0.8, 0, 1);
    return {
      key: keyName(best.root, best.mode),
      mode: best.mode,
      root: best.root,
      camelot: camelotFor(best.root, best.mode),
      confidence: round(confidence, 2)
    };
  }

  // ---- waveform and section energy ----

  function waveformPeaks(samples, bars = DEFAULT_BARS) {
    const out = new Array(Math.max(1, bars | 0)).fill(0.12);
    if (!samples || !samples.length) return out;
    const block = Math.max(1, Math.floor(samples.length / out.length));
    const step = Math.max(1, Math.floor(block / 512));
    let max = 1e-6;
    for (let b = 0; b < out.length; b++) {
      let peak = 0;
      const from = b * block;
      const to = Math.min(samples.length, from + block);
      for (let i = from; i < to; i += step) {
        const v = Math.abs(samples[i]);
        if (v > peak) peak = v;
      }
      out[b] = peak;
      if (peak > max) max = peak;
    }
    for (let b = 0; b < out.length; b++) out[b] = round(Math.max(0.12, Math.min(1, out[b] / max)), 3);
    return out;
  }

  function sectionEnergy(samples, sampleRate) {
    const windowSec = 0.5;
    const windowSize = Math.max(1, Math.round(sampleRate * windowSec));
    const count = Math.max(1, Math.floor(samples.length / windowSize));
    const rms = new Float32Array(count);
    let max = 0;
    for (let w = 0; w < count; w++) {
      const from = w * windowSize;
      const to = Math.min(samples.length, from + windowSize);
      let sum = 0;
      for (let i = from; i < to; i++) sum += samples[i] * samples[i];
      rms[w] = Math.sqrt(sum / Math.max(1, to - from));
      if (rms[w] > max) max = rms[w];
    }
    const threshold = max * 0.28;
    let first = 0;
    for (let w = 0; w < count; w++) {
      if (rms[w] >= threshold) { first = w; break; }
    }
    let last = count - 1;
    for (let w = count - 1; w >= 0; w--) {
      if (rms[w] >= threshold) { last = w; break; }
    }
    return {
      introEnd: round(first * windowSec, 1),
      outroStart: round(Math.max(first * windowSec, (last - 1) * windowSec), 1)
    };
  }

  function fallback(reason, duration = 0) {
    return {
      v: VERSION,
      fallback: true,
      reason: String(reason || 'unavailable'),
      duration: round(duration, 2),
      analyzedAt: Date.now()
    };
  }

  function analyzeSamples(samples, sampleRate, options = {}) {
    if (!samples || !samples.length || !(sampleRate > 0)) {
      return fallback('no-audio', 0);
    }
    const duration = samples.length / sampleRate;
    if (duration < 8) {
      return {
        ...fallback('too-short', duration),
        peaks: waveformPeaks(samples, options.bars || DEFAULT_BARS)
      };
    }

    const tempo = detectTempo(samples, sampleRate);
    const key = detectKey(samples, sampleRate);
    const sections = sectionEnergy(samples, sampleRate);
    return {
      v: VERSION,
      duration: round(duration, 2),
      bpm: tempo.bpm,
      bpmConfidence: tempo.confidence,
      beatOffset: tempo.beatOffset,
      beats: tempo.beats,
      key: key.key,
      mode: key.mode,
      root: key.root,
      camelot: key.camelot,
      keyConfidence: key.confidence,
      peaks: waveformPeaks(samples, options.bars || DEFAULT_BARS),
      introEnd: sections.introEnd,
      outroStart: sections.outroStart,
      analyzedAt: Date.now()
    };
  }

  return {
    VERSION,
    analyzeSamples,
    fallback,
    waveformPeaks,
    detectTempo,
    detectKey,
    camelotFor,
    keyName,
    NOTE_NAMES
  };
});

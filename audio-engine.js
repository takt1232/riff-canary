
(function (global) {
  'use strict';

  class CanaryAudioEngine {
    constructor() {
      this.ctx = null;
      this.mediaSource = null;
      this.graphInitialized = false;

      this.stdInput = null;
      this.dryGain = null;
      this.distortionNode = null;
      this.distortionGain = null;
      this.delayNode = null;
      this.delayFeedback = null;
      this.delayGain = null;
      this.convolverNode = null;
      this.reverbGain = null;

      this.hqInput = null;
      this.hqCompressor = null;
      this.hqBass = null;
      this.hqVocal = null;
      this.hqAir = null;
      this.hqSaturation = null;
      this.hqLimiter = null;

      this.eqLow = null;
      this.eqMid = null;
      this.eqHigh = null;
      this.eqBands = [];

      this.masterGain = null;
      this.analyserNode = null;
      this.normGain = null;
      this.normLimiter = null;
      this.levelAnalyser = null;
      this.levelBuf = null;
      this.fadeGain = null;
      this.bus = null;
      // Canary Mix: the incoming deck's transition EQ/filter sits before the master, and the outgoing
      // tail gets its own identical chain so the two songs can be shaped independently.
      this.mixIn = null;
      this.mixLow = null;
      this.mixMid = null;
      this.mixHigh = null;
      this.mixHp = null;
      this.mixLp = null;
      this.mixOut = null;
      this.tailElement = null;
      this.tailSource = null;
      this.tailLow = null;
      this.tailMid = null;
      this.tailHigh = null;
      this.tailHp = null;
      this.tailLp = null;
      this.tailGain = null;
      this._mixTimer = null;
      this._analyserConnected = false;
      this._suspendTimer = null;
      this._attachedElement = null;
      this._routingState = null;

      this.hqEnabled = false;
      this.hqSettings = {
        engine: 'hqmusic-3',
        preset: 'studio',
        vocal: 0,
        air: 0,
        bass: 0
      };
      this.audioSettings = {
        speed: 1.0,
        speedPitch: 1.0,
        pitch: 0,
        reverb: 0,
        distortion: 0,
        volume: 1.0,
        echo: 0,
        eq: { low: 0, mid: 0, high: 0 },
        eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      };
      this.isMuted = false;
      this.volume = 0.85;
    }


    _createReverbImpulse(ctx) {
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * 0.6);
      const impulse = ctx.createBuffer(2, len, rate);
      const left = impulse.getChannelData(0);
      const right = impulse.getChannelData(1);
      for (let i = 0; i < len; i++) {
        const decay = Math.exp(-i / (rate * 0.15));
        left[i] = (Math.random() * 2 - 1) * decay;
        right[i] = (Math.random() * 2 - 1) * decay;
      }
      return impulse;
    }

    _makeDistortionCurve(amount = 0) {
      const n = 256;
      const curve = new Float32Array(n);
      const k = amount * 2.5;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        if (k <= 0) {
          curve[i] = x;
        } else {
          curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
        }
      }
      return curve;
    }

    _makeHarmonicCurve(amount = 0) {
      const n = 256;
      const curve = new Float32Array(n);
      const k = amount * 0.02;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = x - k * Math.pow(x, 3);
      }
      return curve;
    }


    init(audioElement) {
      if (!audioElement) return;

      if (this.ctx) {
        if (!audioElement.paused && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
      } else {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'playback' });
      }

      if (this._attachedElement !== audioElement) {
        this._attachedElement = audioElement;
        audioElement.addEventListener('play', () => this.resumeAudioContext());
        audioElement.addEventListener('pause', () => this.suspendAudioContextDebounced(5000));
        audioElement.addEventListener('ended', () => this.suspendAudioContextDebounced(5000));
      }

      if (!this.graphInitialized) {
        try {
          this.mediaSource = this.ctx.createMediaElementSource(audioElement);

          this.stdInput = this.ctx.createGain();
          this.hqInput = this.ctx.createGain();

          this.hqCompressor = this.ctx.createDynamicsCompressor();

          this.hqBass = this.ctx.createBiquadFilter();
          this.hqBass.type = 'lowshelf';
          this.hqBass.frequency.value = 80;

          this.hqVocal = this.ctx.createBiquadFilter();
          this.hqVocal.type = 'peaking';
          this.hqVocal.frequency.value = 2500;
          this.hqVocal.Q.value = 1.2;

          this.hqAir = this.ctx.createBiquadFilter();
          this.hqAir.type = 'highshelf';
          this.hqAir.frequency.value = 9000;

          this.hqSaturation = this.ctx.createWaveShaper();
          this.hqSaturation.oversample = '2x'; // 4x cost noticeably more CPU for no audible difference (Riff 43)

          this.hqLimiter = this.ctx.createDynamicsCompressor();
          this.hqLimiter.threshold.value = -1;
          this.hqLimiter.knee.value = 0;
          this.hqLimiter.ratio.value = 20;
          this.hqLimiter.attack.value = 0.005;
          this.hqLimiter.release.value = 0.05;

          this.hqInput.connect(this.hqCompressor);
          this.hqCompressor.connect(this.hqBass);
          this.hqBass.connect(this.hqVocal);
          this.hqVocal.connect(this.hqAir);
          this.hqAir.connect(this.hqSaturation);
          this.hqSaturation.connect(this.hqLimiter);

          this.dryGain = this.ctx.createGain();
          this.dryGain.gain.value = 1.0;

          this.distortionNode = this.ctx.createWaveShaper();
          this.distortionNode.oversample = 'none';
          this.distortionNode.curve = this._makeDistortionCurve(0);
          this.distortionGain = this.ctx.createGain();
          this.distortionGain.gain.value = 0.0;

          this.delayNode = this.ctx.createDelay(1.0);
          this.delayNode.delayTime.value = 0.3;
          this.delayFeedback = this.ctx.createGain();
          this.delayFeedback.gain.value = 0.35;
          this.delayGain = this.ctx.createGain();
          this.delayGain.gain.value = 0.0;
          this.delayNode.connect(this.delayFeedback);
          this.delayFeedback.connect(this.delayNode);
          this.delayNode.connect(this.delayGain);

          this.convolverNode = this.ctx.createConvolver();
          this.convolverNode.buffer = this._createReverbImpulse(this.ctx);
          this.reverbGain = this.ctx.createGain();
          this.reverbGain.gain.value = 0.0;

          this.masterGain = this.ctx.createGain();
          this.analyserNode = this.ctx.createAnalyser();
          this.analyserNode.fftSize = 128;
          this.analyserNode.smoothingTimeConstant = 0.8;

          this.normGain = this.ctx.createGain();
          this.normLimiter = this.ctx.createDynamicsCompressor();
          this.normLimiter.threshold.value = -2;
          this.normLimiter.knee.value = 0;
          this.normLimiter.ratio.value = 20;
          this.normLimiter.attack.value = 0.003;
          this.normLimiter.release.value = 0.1;
          this.levelAnalyser = this.ctx.createAnalyser();
          this.levelAnalyser.fftSize = 2048;
          this.levelBuf = new Float32Array(this.levelAnalyser.fftSize);

          this.eqLow = this.ctx.createBiquadFilter();
          this.eqLow.type = 'lowshelf';
          this.eqLow.frequency.value = 200;
          this.eqMid = this.ctx.createBiquadFilter();
          this.eqMid.type = 'peaking';
          this.eqMid.frequency.value = 1000;
          this.eqMid.Q.value = 0.9;
          this.eqHigh = this.ctx.createBiquadFilter();
          this.eqHigh.type = 'highshelf';
          this.eqHigh.frequency.value = 4000;
          this.eqLow.connect(this.eqMid);
          this.eqMid.connect(this.eqHigh);

          const EQ_BAND_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
          this.eqBands = EQ_BAND_FREQS.map(f => {
            const node = this.ctx.createBiquadFilter();
            node.type = 'peaking';
            node.frequency.value = f;
            node.Q.value = 1.1;
            node.gain.value = 0;
            return node;
          });
          this.eqHigh.connect(this.eqBands[0]);
          for (let i = 0; i < this.eqBands.length - 1; i++) {
            this.eqBands[i].connect(this.eqBands[i + 1]);
          }

          this.bus = this.ctx.createGain();
          // Main (incoming) deck transition chain. Neutral by default, so the existing sound is untouched.
          this.mixIn = this.ctx.createGain();
          this.mixLow = this.ctx.createBiquadFilter();
          this.mixLow.type = 'lowshelf';
          this.mixLow.frequency.value = 120;
          this.mixMid = this.ctx.createBiquadFilter();
          this.mixMid.type = 'peaking';
          this.mixMid.frequency.value = 1000;
          this.mixMid.Q.value = 0.9;
          this.mixHigh = this.ctx.createBiquadFilter();
          this.mixHigh.type = 'highshelf';
          this.mixHigh.frequency.value = 6000;
          this.mixHp = this.ctx.createBiquadFilter();
          this.mixHp.type = 'highpass';
          this.mixHp.frequency.value = 20;
          this.mixHp.Q.value = 0.7;
          this.mixLp = this.ctx.createBiquadFilter();
          this.mixLp.type = 'lowpass';
          this.mixLp.frequency.value = 20000;
          this.mixLp.Q.value = 0.7;
          this.mixOut = this.ctx.createGain();
          this.mixIn.connect(this.mixLow);
          this.mixLow.connect(this.mixMid);
          this.mixMid.connect(this.mixHigh);
          this.mixHigh.connect(this.mixHp);
          this.mixHp.connect(this.mixLp);
          this.mixLp.connect(this.mixOut);

          this.fadeGain = this.ctx.createGain();
          this.fadeGain.gain.value = 1.0;
          this.masterGain.connect(this.normGain);
          this.normGain.connect(this.normLimiter);
          this.normLimiter.connect(this.analyserNode);
          this.analyserNode.connect(this.fadeGain);
          this.fadeGain.connect(this.ctx.destination);

          this.graphInitialized = true;
          this._updateRouting();
        } catch (e) {
          console.warn('[AudioEngine] Graph initialization notice:', e);
        }
      }

      this.applySettings();
      if (audioElement.paused) this.suspendAudioContextDebounced(5000);
    }


    _isEqActive() {
      const s = this.audioSettings;
      if (s.eq && (s.eq.low !== 0 || s.eq.mid !== 0 || s.eq.high !== 0)) return true;
      if (Array.isArray(s.eqBands) && s.eqBands.some(v => v !== 0)) return true;
      return false;
    }

    _updateRouting() {
      if (!this.graphInitialized || !this.mediaSource) return;

      const s = this.audioSettings;
      const isEqOn = this._isEqActive();
      const isReverbOn = (s.reverb || 0) > 0;
      const isEchoOn = (s.echo || 0) > 0;
      const isDistortionOn = (s.distortion || 0) > 0;
      const isHqOn = !!this.hqEnabled;

      const stateKey = `${isHqOn}_${isEqOn}_${isReverbOn}_${isEchoOn}_${isDistortionOn}`;
      if (this._routingState === stateKey) {
        this._applyHqParams();
        return;
      }
      this._routingState = stateKey;

      try {
        this.mediaSource.disconnect();
        this.stdInput.disconnect();
        this.hqLimiter.disconnect();
        this.bus.disconnect();
        this.mixOut.disconnect();
        this.dryGain.disconnect();
        if (this.eqBands && this.eqBands.length) {
          this.eqBands[this.eqBands.length - 1].disconnect();
        }
        this.distortionNode.disconnect();
        this.distortionGain.disconnect();
        this.delayGain.disconnect();
        this.convolverNode.disconnect();
        this.reverbGain.disconnect();
      } catch (e) {}

      const inputNode = isHqOn ? this.hqLimiter : this.stdInput;
      if (isHqOn) {
        this.mediaSource.connect(this.hqInput);
      } else {
        this.mediaSource.connect(this.stdInput);
      }

      if (isEqOn) {
        inputNode.connect(this.eqLow);
        this.eqBands[this.eqBands.length - 1].connect(this.bus);
      } else {
        inputNode.connect(this.bus);
      }

      // All dry audio and effect sends pass through the main deck's transition chain. The outgoing tail
      // has its own chain straight into masterGain, so Mix can EQ/filter the two decks independently.
      this.bus.connect(this.mixIn);
      this.mixOut.connect(this.dryGain);
      this.dryGain.connect(this.masterGain);
      // the level meter for "Normalize volume" listens on the bus: tapped off the EQ chain it heard nothing
      // while the EQ was flat (the default), so normalizing never kicked in
      if (this.levelAnalyser) this.bus.connect(this.levelAnalyser);

      if (isDistortionOn) {
        this.mixOut.connect(this.distortionNode);
        this.distortionNode.connect(this.distortionGain);
        this.distortionGain.connect(this.masterGain);
      }

      if (isEchoOn) {
        this.mixOut.connect(this.delayNode);
        this.delayGain.connect(this.masterGain);
      }

      if (isReverbOn) {
        this.mixOut.connect(this.convolverNode);
        this.convolverNode.connect(this.reverbGain);
        this.reverbGain.connect(this.masterGain);
      }

      this._applyHqParams();
    }

    flushEffects() {
      if (!this.graphInitialized || !this.ctx) return;
      try {
        if (this.delayNode) {
          const dt = this.delayNode.delayTime.value;
          const fb = this.delayFeedback ? this.delayFeedback.gain.value : 0.35;
          try {
            this.delayNode.disconnect();
            if (this.delayFeedback) this.delayFeedback.disconnect();
          } catch (e) {}
          this.delayNode = this.ctx.createDelay(1.0);
          this.delayNode.delayTime.value = dt;
          this.delayFeedback = this.ctx.createGain();
          this.delayFeedback.gain.value = fb;
          this.delayNode.connect(this.delayFeedback);
          this.delayFeedback.connect(this.delayNode);
          if (this.delayGain) this.delayNode.connect(this.delayGain);
        }
        if (this.convolverNode) {
          try {
            this.convolverNode.disconnect();
          } catch (e) {}
          this.convolverNode = this.ctx.createConvolver();
          this.convolverNode.buffer = this._createReverbImpulse(this.ctx);
          if (this.reverbGain) this.convolverNode.connect(this.reverbGain);
        }
        this._routingState = null;
        this._updateRouting();
      } catch (e) {}
    }


    setHqEnabled(enabled) {
      this.hqEnabled = enabled;
      if (this.graphInitialized) {
        this._updateRouting();
        this._applyHqParams();
      }
    }

    setHqSettings(settings) {
      Object.assign(this.hqSettings, settings);
      if (this.graphInitialized) this._applyHqParams();
    }

    _applyHqParams() {
      if (!this.hqCompressor) return;

      if (!this.hqEnabled) {
        const ctx = this.ctx;
        if (ctx) {
          if (this.hqBass) this.hqBass.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
          if (this.hqVocal) this.hqVocal.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
          if (this.hqAir) this.hqAir.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        }
        return;
      }

      let baseBass = 0, baseVocal = 0, baseAir = 0;
      let satAmount = 0;

      this.hqCompressor.threshold.value = -12;
      this.hqCompressor.knee.value = 10;
      this.hqCompressor.ratio.value = 1.5;
      this.hqCompressor.attack.value = 0.01;
      this.hqCompressor.release.value = 0.1;

      switch (this.hqSettings.engine) {
        case 'hqmusic-3':
          satAmount = 0.5;
          break;
        case 'glyphs-7B':
          satAmount = 0.2;
          baseAir = 2.5;
          this.hqAir.frequency.value = 9000;
          break;
        case 'fyro1.1':
          satAmount = 0.2;
          baseBass = 3.0;
          this.hqBass.frequency.value = 80;
          this.hqCompressor.ratio.value = 2.0;
          break;
      }

      this.hqSaturation.curve = this._makeHarmonicCurve(satAmount);

      this.hqBass.gain.value = Math.max(-4, Math.min(4, baseBass + (this.hqSettings.bass * 0.08)));
      this.hqVocal.gain.value = Math.max(-4, Math.min(4, baseVocal + (this.hqSettings.vocal * 0.08)));
      this.hqAir.gain.value = Math.max(-4, Math.min(4, baseAir + (this.hqSettings.air * 0.08)));
    }


    setAudioSettings(settings) {
      Object.assign(this.audioSettings, settings);
      this.applySettings();
    }

    setEq(eq) {
      if (!eq) return;
      if (!this.audioSettings.eq) this.audioSettings.eq = { low: 0, mid: 0, high: 0 };
      const clamp = v => Math.max(-12, Math.min(12, typeof v === 'number' ? v : 0));
      if (eq.low !== undefined) this.audioSettings.eq.low = clamp(eq.low);
      if (eq.mid !== undefined) this.audioSettings.eq.mid = clamp(eq.mid);
      if (eq.high !== undefined) this.audioSettings.eq.high = clamp(eq.high);
      if (this.eqLow) this.eqLow.gain.value = this.audioSettings.eq.low;
      if (this.eqMid) this.eqMid.gain.value = this.audioSettings.eq.mid;
      if (this.eqHigh) this.eqHigh.gain.value = this.audioSettings.eq.high;
      if (this.graphInitialized) this._updateRouting();
    }

    setEqBands(gains) {
      if (!Array.isArray(gains)) return;
      if (!Array.isArray(this.audioSettings.eqBands)) {
        this.audioSettings.eqBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      }
      const clamp = v => Math.max(-12, Math.min(12, typeof v === 'number' ? v : 0));
      for (let i = 0; i < 10; i++) {
        const val = clamp(gains[i]);
        this.audioSettings.eqBands[i] = val;
        if (this.eqBands && this.eqBands[i]) {
          if (this.ctx && this.eqBands[i].gain.setTargetAtTime) {
            this.eqBands[i].gain.setTargetAtTime(val, this.ctx.currentTime, 0.02);
          } else {
            this.eqBands[i].gain.value = val;
          }
        }
      }
      if (this.graphInitialized) this._updateRouting();
    }

    setVolume(volume, isMuted) {
      this.volume = volume;
      this.isMuted = isMuted;
      this._applyMasterVolume();
    }

    // the element's rate for the current speed / pitch settings
    playbackFor() {
      const s = this.audioSettings;
      if (s.speedPitch !== 1.0 || s.pitch !== 0) return { rate: s.speedPitch * Math.pow(2, s.pitch / 12), preservePitch: false };
      return { rate: s.speed, preservePitch: true };
    }

    applySettings(audioElement) {
      const s = this.audioSettings;

      if (audioElement) {
        const { rate, preservePitch } = this.playbackFor();
        audioElement.preservesPitch = preservePitch;
        audioElement.webkitPreservesPitch = preservePitch;
        audioElement.mozPreservesPitch = preservePitch;
        // loading a new song resets playbackRate to defaultPlaybackRate (WebKit only does it once the song
        // has loaded, after this ran): with both set, speed and pitch carry over to the next song
        audioElement.defaultPlaybackRate = rate;
        audioElement.playbackRate = rate;
      }

      if (s.eq) this.setEq(s.eq);
      if (s.eqBands) this.setEqBands(s.eqBands);

      if (this.reverbGain) this.reverbGain.gain.value = s.reverb / 100;

      if (this.delayGain) this.delayGain.gain.value = s.echo / 100;

      if (this.distortionNode && this.distortionGain) {
        if (s.distortion > 0) {
          this.distortionNode.curve = this._makeDistortionCurve(s.distortion);
          this.distortionGain.gain.value = (s.distortion / 100) * 0.75;
          if (this.dryGain) this.dryGain.gain.value = 1.0 - (s.distortion / 100) * 0.4;
        } else {
          this.distortionGain.gain.value = 0.0;
          if (this.dryGain) this.dryGain.gain.value = 1.0;
        }
      }

      if (this.graphInitialized) this._updateRouting();
      this._applyMasterVolume();
    }

    _applyMasterVolume() {
      const vol = this.isMuted ? 0 : this.volume;
      if (this.masterGain) {
        this.masterGain.gain.value = vol * this.audioSettings.volume;
      }
    }

    isModified() {
      const s = this.audioSettings;
      const eqMod = s.eq ? (s.eq.low !== 0 || s.eq.mid !== 0 || s.eq.high !== 0) : false;
      const eqBandsMod = Array.isArray(s.eqBands) ? s.eqBands.some(v => v !== 0) : false;
      return s.speed !== 1.0 || s.speedPitch !== 1.0 || s.pitch !== 0 ||
        s.reverb !== 0 || s.distortion !== 0 || s.volume !== 1.0 || s.echo !== 0 || eqMod || eqBandsMod;
    }


    fadeOut(durationSec = 0.25) {
      if (this.masterGain && this.ctx) {
        const current = this.masterGain.gain.value;
        this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.masterGain.gain.setValueAtTime(Math.max(0.001, current), this.ctx.currentTime);
        this.masterGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + durationSec);
      }
    }

    fadeIn(durationSec = 0.35) {
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.masterGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
        const targetVol = (this.isMuted ? 0 : this.volume) * this.audioSettings.volume;
        this.masterGain.gain.exponentialRampToValueAtTime(
          Math.max(0.001, targetVol), this.ctx.currentTime + durationSec
        );
      }
    }


    _deck(kind) {
      if (kind === 'tail') {
        return { gain: this.tailGain, low: this.tailLow, mid: this.tailMid, high: this.tailHigh, hp: this.tailHp, lp: this.tailLp };
      }
      return { gain: this.mixOut, low: this.mixLow, mid: this.mixMid, high: this.mixHigh, hp: this.mixHp, lp: this.mixLp };
    }

    _setDeckValues(deck, values, when, duration, curve = 'equal') {
      if (!deck || !deck.gain || !this.ctx || !values) return;
      const end = when + Math.max(0.05, duration);
      const set = (param, from, to, exponential = false) => {
        if (!param) return;
        try {
          param.cancelScheduledValues(when);
          param.setValueAtTime(exponential ? Math.max(0.001, from) : from, when);
          if (exponential) param.exponentialRampToValueAtTime(Math.max(0.001, to), end);
          else param.linearRampToValueAtTime(to, end);
        } catch (e) {}
      };
      const volume = values.volume || [1, 1];
      const from = Math.max(0.0001, Number(volume[0]) || 0);
      const to = Math.max(0.0001, Number(volume[1]) || 0);
      const fullFade = (from === 1 && to <= 0.0001) || (from <= 0.0001 && to === 1);
      if (fullFade && duration >= 0.1 && curve !== 'linear') {
        try {
          const points = 64;
          const samples = new Float32Array(points);
          for (let i = 0; i < points; i++) {
            const p = i / (points - 1);
            let v;
            if (curve === 'smooth') v = 1 - (p * p * (3 - 2 * p));
            else v = Math.cos((p * Math.PI) / 2);
            // the incoming deck uses the mirrored curve
            if (from <= 0.0001 && to === 1) v = 1 - v;
            samples[i] = Math.max(0.0001, v);
          }
          const param = deck.gain.gain;
          param.cancelScheduledValues(when);
          param.setValueAtTime(samples[0], when);
          param.setValueCurveAtTime(samples, when, Math.max(0.1, duration));
        } catch (e) {
          set(deck.gain.gain, from, to);
        }
      } else {
        set(deck.gain.gain, from, to);
      }
      const low = values.low || [0, 0];
      const mid = values.mid || [0, 0];
      const high = values.high || [0, 0];
      set(deck.low && deck.low.gain, low[0], low[1]);
      set(deck.mid && deck.mid.gain, mid[0], mid[1]);
      set(deck.high && deck.high.gain, high[0], high[1]);
      const hp = values.hp || [20, 20];
      const lp = values.lp || [20000, 20000];
      set(deck.hp && deck.hp.frequency, hp[0], hp[1], true);
      set(deck.lp && deck.lp.frequency, lp[0], lp[1], true);
    }

    // The outgoing song's second player gets its own chain, created once for the element the app reuses.
    ensureTailDeck(element) {
      if (!this.ctx || !this.graphInitialized || !element) return null;
      if (this.tailElement === element && this.tailGain) return this._deck('tail');
      try { if (this.tailSource) this.tailSource.disconnect(); } catch (e) {}
      let source;
      try {
        source = this.ctx.createMediaElementSource(element);
      } catch (e) {
        return null;
      }
      this.tailElement = element;
      this.tailSource = source;
      this.tailLow = this.ctx.createBiquadFilter();
      this.tailLow.type = 'lowshelf';
      this.tailLow.frequency.value = 120;
      this.tailMid = this.ctx.createBiquadFilter();
      this.tailMid.type = 'peaking';
      this.tailMid.frequency.value = 1000;
      this.tailMid.Q.value = 0.9;
      this.tailHigh = this.ctx.createBiquadFilter();
      this.tailHigh.type = 'highshelf';
      this.tailHigh.frequency.value = 6000;
      this.tailHp = this.ctx.createBiquadFilter();
      this.tailHp.type = 'highpass';
      this.tailHp.frequency.value = 20;
      this.tailHp.Q.value = 0.7;
      this.tailLp = this.ctx.createBiquadFilter();
      this.tailLp.type = 'lowpass';
      this.tailLp.frequency.value = 20000;
      this.tailLp.Q.value = 0.7;
      this.tailGain = this.ctx.createGain();
      this.tailGain.gain.value = 0;
      source.connect(this.tailLow);
      this.tailLow.connect(this.tailMid);
      this.tailMid.connect(this.tailHigh);
      this.tailHigh.connect(this.tailHp);
      this.tailHp.connect(this.tailLp);
      this.tailLp.connect(this.tailGain);
      this.tailGain.connect(this.masterGain);
      return this._deck('tail');
    }

    resetMixChain() {
      if (this._mixTimer) { clearTimeout(this._mixTimer); this._mixTimer = null; }
      const main = this._deck('main');
      if (main) {
        this._setDeckValues(main, { volume: [1, 1], low: [0, 0], mid: [0, 0], high: [0, 0], hp: [20, 20], lp: [20000, 20000] }, this.ctx ? this.ctx.currentTime : 0, 0.05);
      }
      if (this.tailGain) {
        try {
          const now = this.ctx.currentTime;
          this.tailGain.gain.cancelScheduledValues(now);
          this.tailGain.gain.setValueAtTime(0, now);
        } catch (e) {}
      }
    }

    // Schedule both decks from the moment the incoming song actually starts. The tail must already be
    // playing; the app keeps it at neutral until this runs.
    startMixTransition(plan) {
      if (!this.ctx || !this.graphInitialized || !plan || !plan.curves) return false;
      if (!this.tailGain) return false;
      const now = this.ctx.currentTime;
      const duration = Math.max(0.5, Number(plan.wallDuration || plan.duration) || 0);
      // The main deck starts silent while the tail is audible; do not reset it to 1 first.
      this._setDeckValues(this._deck('main'), plan.curves.in, now, duration, plan.curve);
      this._setDeckValues(this._deck('tail'), plan.curves.out, now, duration, plan.curve);
      if (this._mixTimer) clearTimeout(this._mixTimer);
      this._mixTimer = setTimeout(() => {
        this._mixTimer = null;
        this.resetMixChain();
      }, (duration + 0.08) * 1000);
      return true;
    }

    cancelMixTransition() {
      this.resetMixChain();
    }

    mixReady() {
      // The tail deck is created on demand by ensureTailDeck(); the graph only has to be able to host it.
      return !!(this.ctx && this.graphInitialized && this.mixOut);
    }

    getAnalyserNode() {
      return this.analyserNode;
    }

    setAnalyserEnabled(enabled) {
      this._analyserConnected = !!enabled;
    }

    suspendAudioContextDebounced(delayMs = 5000) {
      if (this._suspendTimer) clearTimeout(this._suspendTimer);
      this._suspendTimer = setTimeout(() => {
        this._suspendTimer = null;
        // the phone app in the background: a suspended context may not start again until the app is opened (#24)
        if (this.keepRunning && this.keepRunning()) return;
        if (this.ctx && this.ctx.state === 'running') {
          this.ctx.suspend().catch(() => {});
        }
      }, delayMs);
    }

    resumeAudioContext() {
      if (this._suspendTimer) {
        clearTimeout(this._suspendTimer);
        this._suspendTimer = null;
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        return this.ctx.resume().catch(() => {});
      }
    }

    setHidden(hidden) {
      if (this.analyserNode) {
        this.analyserNode.fftSize = hidden ? 32 : 128;
      }
      if (hidden) this.setAnalyserEnabled(false);
    }

    getFrequencyData(buffer) {
      if (!this._analyserConnected) this.setAnalyserEnabled(true);
      if (this.analyserNode) this.analyserNode.getByteFrequencyData(buffer);
    }

    getTimeDomainData(buffer) {
      if (!this._analyserConnected) this.setAnalyserEnabled(true);
      if (this.analyserNode) this.analyserNode.getByteTimeDomainData(buffer);
    }

    getLevelDb() {
      if (!this.levelAnalyser) return -120;
      this.levelAnalyser.getFloatTimeDomainData(this.levelBuf);
      let sum = 0;
      for (let i = 0; i < this.levelBuf.length; i++) sum += this.levelBuf[i] * this.levelBuf[i];
      const rms = Math.sqrt(sum / this.levelBuf.length);
      return rms > 0 ? 20 * Math.log10(rms) : -120;
    }

    setNormalizeGainDb(db) {
      if (!this.normGain || !this.ctx) return;
      this.normGain.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.8);
    }


    isLiveStream(audioElement) {
      if (!audioElement) return false;
      const dur = audioElement.duration;
      return !isFinite(dur) || isNaN(dur);
    }


    async renderOffline(sourceBuffer, settingsOverride, hqOverride) {
      const s = settingsOverride || { ...this.audioSettings };
      const hq = hqOverride || { ...this.hqSettings };
      const useHq = this.hqEnabled;

      const speedFactor = (s.speedPitch !== 1.0 || s.pitch !== 0)
        ? s.speedPitch * Math.pow(2, s.pitch / 12)
        : s.speed;
      const outputLength = Math.ceil(sourceBuffer.length / Math.max(0.1, speedFactor));

      const offline = new OfflineAudioContext(
        sourceBuffer.numberOfChannels,
        outputLength,
        sourceBuffer.sampleRate
      );

      const src = offline.createBufferSource();
      src.buffer = sourceBuffer;
      src.playbackRate.value = speedFactor;

      const eqL = offline.createBiquadFilter(); eqL.type = 'lowshelf'; eqL.frequency.value = 200; eqL.gain.value = Math.max(-12, Math.min(12, s.eq?.low || 0));
      const eqM = offline.createBiquadFilter(); eqM.type = 'peaking'; eqM.frequency.value = 1000; eqM.Q.value = 0.9; eqM.gain.value = Math.max(-12, Math.min(12, s.eq?.mid || 0));
      const eqH = offline.createBiquadFilter(); eqH.type = 'highshelf'; eqH.frequency.value = 4000; eqH.gain.value = Math.max(-12, Math.min(12, s.eq?.high || 0));
      eqL.connect(eqM); eqM.connect(eqH);

      let offlineEqTail = eqH;
      if (Array.isArray(s.eqBands)) {
        const freqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        const bands = freqs.map((f, i) => {
          const filter = offline.createBiquadFilter();
          filter.type = 'peaking';
          filter.frequency.value = f;
          filter.Q.value = 1.1;
          filter.gain.value = Math.max(-12, Math.min(12, s.eqBands[i] || 0));
          return filter;
        });
        offlineEqTail.connect(bands[0]);
        for (let i = 0; i < bands.length - 1; i++) {
          bands[i].connect(bands[i + 1]);
        }
        offlineEqTail = bands[bands.length - 1];
      }

      if (useHq) {
        const comp = offline.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 10;
        comp.ratio.value = hq.engine === 'fyro1.1' ? 2.0 : 1.5;
        comp.attack.value = 0.01;
        comp.release.value = 0.1;

        const bass = offline.createBiquadFilter();
        bass.type = 'lowshelf';
        bass.frequency.value = 80;
        const baseBass = hq.engine === 'fyro1.1' ? 3.0 : 0;
        bass.gain.value = Math.max(-4, Math.min(4, baseBass + (hq.bass * 0.08)));

        const vocal = offline.createBiquadFilter();
        vocal.type = 'peaking';
        vocal.frequency.value = 2500;
        vocal.Q.value = 1.2;
        vocal.gain.value = Math.max(-4, Math.min(4, hq.vocal * 0.08));

        const air = offline.createBiquadFilter();
        air.type = 'highshelf';
        air.frequency.value = 9000;
        const baseAir = hq.engine === 'glyphs-7B' ? 2.5 : 0;
        air.gain.value = Math.max(-4, Math.min(4, baseAir + (hq.air * 0.08)));

        const sat = offline.createWaveShaper();
        sat.oversample = '4x';
        const satAmount = hq.engine === 'hqmusic-3' ? 0.5 : 0.2;
        sat.curve = this._makeHarmonicCurve(satAmount);

        const limiter = offline.createDynamicsCompressor();
        limiter.threshold.value = -1;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.005;
        limiter.release.value = 0.05;

        const master = offline.createGain();
        master.gain.value = s.volume;

        src.connect(comp);
        comp.connect(bass);
        bass.connect(vocal);
        vocal.connect(air);
        air.connect(sat);
        sat.connect(limiter);
        limiter.connect(eqL);
        offlineEqTail.connect(master);
        master.connect(offline.destination);

      } else {
        const dry = offline.createGain();
        const distNode = offline.createWaveShaper();
        distNode.oversample = 'none';
        const distGain = offline.createGain();
        const delay = offline.createDelay(1.0);
        delay.delayTime.value = 0.3;
        const feedback = offline.createGain();
        feedback.gain.value = 0.35;
        const echoGain = offline.createGain();
        const conv = offline.createConvolver();
        conv.buffer = this._createReverbImpulse(offline);
        const revGain = offline.createGain();
        const master = offline.createGain();

        revGain.gain.value = s.reverb / 100;
        echoGain.gain.value = s.echo / 100;

        if (s.distortion > 0) {
          distNode.curve = this._makeDistortionCurve(s.distortion);
          distGain.gain.value = (s.distortion / 100) * 0.75;
          dry.gain.value = 1.0 - (s.distortion / 100) * 0.4;
        } else {
          distNode.curve = this._makeDistortionCurve(0);
          distGain.gain.value = 0.0;
          dry.gain.value = 1.0;
        }

        master.gain.value = s.volume;

        src.connect(eqL);

        delay.connect(feedback);
        feedback.connect(delay);

        offlineEqTail.connect(dry);
        dry.connect(master);

        offlineEqTail.connect(distNode);
        distNode.connect(distGain);
        distGain.connect(master);

        offlineEqTail.connect(delay);
        delay.connect(echoGain);
        echoGain.connect(master);

        offlineEqTail.connect(conv);
        conv.connect(revGain);
        revGain.connect(master);

        master.connect(offline.destination);
      }

      src.start(0);
      return offline.startRendering();
    }

    audioBufferToWav(buffer) {
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const bitDepth = 16;

      const channels = [];
      for (let i = 0; i < numChannels; i++) {
        channels.push(buffer.getChannelData(i));
      }

      const length = channels[0].length;
      const bytesPerSample = bitDepth / 8;
      const blockAlign = numChannels * bytesPerSample;
      const dataSize = length * blockAlign;
      const headerSize = 44;
      const totalSize = headerSize + dataSize;

      const arrayBuffer = new ArrayBuffer(totalSize);
      const view = new DataView(arrayBuffer);

      const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      };

      writeString(0, 'RIFF');
      view.setUint32(4, totalSize - 8, true);
      writeString(8, 'WAVE');

      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * blockAlign, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitDepth, true);

      writeString(36, 'data');
      view.setUint32(40, dataSize, true);

      let offset = 44;
      for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          const sample = Math.max(-1, Math.min(1, channels[ch][i]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
          offset += 2;
        }
      }

      return new Blob([arrayBuffer], { type: 'audio/wav' });
    }
  }

  global.CanaryAudioEngine = CanaryAudioEngine;

})(typeof window !== 'undefined' ? window : globalThis);

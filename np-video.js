// The portrait "Canvas" background in Now playing loops a short piece of the song's video. 8 s from
// roughly a quarter in skips most intros; a video shorter than that loops whole. The loop is ambient and
// independent of the song position. The fullscreen video mode uses driftPlan to keep a muted video in
// step with the audio that is actually playing. No DOM here; test/np-video.test.js runs it.
(function () {
  const SEEK_AT = 0.55;   // seconds of drift before the video is seeked instead of nudged
  const NUDGE_AT = 0.18;  // below this the video is left alone (a constant tiny correction looks like stutter)
  const MAX_RATE = 0.04;  // never speed the video up/down by more than 4%

  // diff = videoTime - audioTime. Positive means the video is ahead of the sound.
  function driftPlan(videoTime, audioTime, opts) {
    const o = opts || {};
    const seekAt = Number.isFinite(o.seekAt) ? o.seekAt : SEEK_AT;
    const nudgeAt = Number.isFinite(o.nudgeAt) ? o.nudgeAt : NUDGE_AT;
    const maxRate = Number.isFinite(o.maxRate) ? o.maxRate : MAX_RATE;
    if (!Number.isFinite(videoTime) || !Number.isFinite(audioTime)) {
      return { seek: false, rateScale: 1 };
    }
    const diff = videoTime - audioTime;
    if (Math.abs(diff) > seekAt) return { seek: true, rateScale: 1 };
    if (Math.abs(diff) <= nudgeAt) return { seek: false, rateScale: 1 };
    // ahead -> slower, behind -> faster; proportional but capped so the motion stays natural
    const scale = 1 - Math.max(-maxRate, Math.min(maxRate, diff * 0.15));
    return { seek: false, rateScale: scale };
  }

  function loopWindow(duration, seconds, startRatio) {
    const d = Number(duration);
    const wanted = Number(seconds) > 0 ? Number(seconds) : 8;
    if (!(d > 0)) return { start: 0, end: wanted };
    const len = Math.min(wanted, d);
    const ratio = Number.isFinite(startRatio) ? startRatio : 0.25;
    const start = Math.max(0, Math.min(d * ratio, Math.max(0, d - len)));
    return { start, end: start + len };
  }

  const api = { driftPlan, loopWindow, SEEK_AT, NUDGE_AT, MAX_RATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.CanaryNpVideo = api;
})();

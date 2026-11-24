// The portrait "Canvas" background in Now playing loops a short piece of the song's video. 8 s from
// roughly a quarter in skips most intros; a video shorter than that loops whole. The loop is ambient and
// independent of the song position. No DOM here; test/np-video.test.js runs it.
(function () {
  function loopWindow(duration, seconds, startRatio) {
    const d = Number(duration);
    const wanted = Number(seconds) > 0 ? Number(seconds) : 8;
    if (!(d > 0)) return { start: 0, end: wanted };
    const len = Math.min(wanted, d);
    const ratio = Number.isFinite(startRatio) ? startRatio : 0.25;
    const start = Math.max(0, Math.min(d * ratio, Math.max(0, d - len)));
    return { start, end: start + len };
  }

  const api = { loopWindow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.CanaryNpVideo = api;
})();

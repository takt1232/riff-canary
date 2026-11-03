// iPhone: play again once another app's sound is over (#26). A call, Siri or a video in another app pauses
// Canary; iOS then says when it's done and whether to start again, but by then Canary sits paused in the
// background and WebKit didn't start the song again. The app (CanaryAudioSessionPlugin in
// ios/App/App/AppDelegate.swift) passes on the start and end of each interruption, and this plays the song
// again when it was playing and nobody paused it meanwhile.
const { Capacitor, registerPlugin } = require('@capacitor/core');
const { wasPlayingAtInterruption, resumeAfterInterruption } = require('../now-playing');

module.exports = function audioInterruption() {
  if (Capacitor.getPlatform() !== 'ios') return;
  const plugin = registerPlugin('CanaryAudioSession');
  const core = () => window.CanaryCore;
  // Settings → Playback: off (the default) pauses when the headphones / Bluetooth device go away
  const KEEP_PLAYING_DISCONNECT_KEY = 'canary_keep_playing_on_disconnect';
  const keepPlayingOnDisconnect = () => { try { return localStorage.getItem(KEEP_PLAYING_DISCONNECT_KEY) === '1'; } catch (e) { return false; } };
  let lastPlayingAt = 0;
  let wasPlaying = false;

  function hook() {
    const c = core();
    if (!c || !c.audio) return;
    const a = c.audio;
    const heard = () => { if (!a.paused) lastPlayingAt = Date.now(); };
    ['playing', 'timeupdate'].forEach((ev) => a.addEventListener(ev, heard));
    plugin.addListener('interruption', ({ type, shouldResume } = {}) => {
      if (type === 'began') {
        wasPlaying = wasPlayingAtInterruption({ paused: a.paused, ended: a.ended, pausedByUser: !!c.state.pausedByUser, lastPlayingAt, now: Date.now() });
        return;
      }
      if (type !== 'ended') return;
      const resume = resumeAfterInterruption({ wasPlaying, shouldResume: !!shouldResume, pausedByUser: !!c.state.pausedByUser, paused: a.paused, ended: a.ended, hasTrack: !!c.state.currentTrack });
      wasPlaying = false;
      if (!resume) return;
      // the 'pause' iOS caused left state.isPlaying false, so this is a play, not a pause
      if (c.state.isPlaying) a.play().catch(() => {});
      else c.togglePlay();
    });
    // iOS says the old output (headphones or Bluetooth) is gone. It usually pauses the song itself
    // just before this; the setting decides whether that stands or the song goes on on the speakers.
    plugin.addListener('routeChange', ({ reason } = {}) => {
      if (reason !== 'oldDeviceUnavailable') return;
      const wasPlayingBefore = c.state.isPlaying || wasPlayingAtInterruption({
        paused: a.paused, ended: a.ended, pausedByUser: !!c.state.pausedByUser, lastPlayingAt, now: Date.now(),
      });
      if (!wasPlayingBefore) return;
      if (keepPlayingOnDisconnect()) {
        if (a.paused) a.play().catch(() => {});
        return;
      }
      if (typeof window.pauseSmooth === 'function') window.pauseSmooth();
      else if (c.state.isPlaying) c.togglePlay();
      if (c.toast) c.toast((window.CanaryI18n || { Tm: (s) => s }).Tm('Paused: the output device was disconnected'), 'info');
    });
  }
  if (window.CanaryCore) hook(); else window.addEventListener('canary:ready', hook, { once: true });
};

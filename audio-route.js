// Audio output disconnects: which device the song is playing on, and whether a disconnect should
// pause it. No DOM here: app.js and the phone modules use it, test/audio-route.test.js runs it in Node.
// A device that disappears from enumerateDevices() was unplugged or went away (Bluetooth off, a
// headset pulled out); the setting can keep the song on the speakers instead.
(function (root) {
  // device-wide (profiles-core.js DEVICE): this belongs to the computer / phone, like the chosen output
  const KEEP_PLAYING_KEY = 'canary_keep_playing_on_disconnect';

  // the virtual entries Chromium adds for the system default and the call device
  const isPhysical = (d) => !!d && !!d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'
    && (!d.kind || d.kind === 'audiooutput');
  const physical = (devices) => (Array.isArray(devices) ? devices.filter(isPhysical) : []);
  const label = (d) => String((d && d.label) || '').replace(/^Default\s*[-–—:]\s*/i, '').trim();

  // audiooutput devices that were there before and are gone now
  function lostOutputs(before, after) {
    const now = new Set(physical(after).map((d) => d.deviceId));
    return physical(before).filter((d) => !now.has(d.deviceId));
  }

  // The device the song is really going to. A chosen sink wins; otherwise the "default" entry's
  // groupId (Chromium gives it the physical device's group) or label says which one that is.
  function activeOutput(devices, sinkId) {
    const all = Array.isArray(devices) ? devices : [];
    const outputs = physical(all);
    if (sinkId) {
      const chosen = outputs.find((d) => d.deviceId === sinkId);
      if (chosen) return chosen;
    }
    const def = all.find((d) => d && d.deviceId === 'default' && (!d.kind || d.kind === 'audiooutput'));
    if (def) {
      if (def.groupId) {
        const same = outputs.find((d) => d.groupId && d.groupId === def.groupId);
        if (same) return same;
      }
      const defLabel = label(def).toLowerCase();
      if (defLabel && defLabel !== 'default') {
        const same = outputs.find((d) => label(d).toLowerCase() === defLabel);
        if (same) return same;
      }
    }
    // a single output can only be the one in use
    return outputs.length === 1 ? outputs[0] : null;
  }

  // Should a device-change event pause the song? Only when the active (or explicitly chosen) output
  // went away and the setting does not ask to keep playing.
  function shouldPauseOnOutputChange({ playing, keepPlaying, before, after, chosenId, sinkId } = {}) {
    const no = { pause: false, device: null };
    if (!playing || keepPlaying) return no;
    const lost = lostOutputs(before, after);
    if (!lost.length) return no;
    const active = activeOutput(before, chosenId || sinkId || '');
    if (active) {
      const gone = lost.find((d) => d.deviceId === active.deviceId);
      if (gone) return { pause: true, device: gone };
    }
    // the chosen device is not listed among the outputs any more: its disappearance still counts
    if (chosenId) {
      const gone = lost.find((d) => d.deviceId === chosenId);
      if (gone) return { pause: true, device: gone };
    }
    return no;
  }

  const api = { KEEP_PLAYING_KEY, lostOutputs, activeOutput, shouldPauseOnOutputChange };
  if (typeof module !== 'undefined') module.exports = api;
  else root.CanaryAudioRoute = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

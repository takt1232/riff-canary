'use strict';

// audio-route.js: which output the song is on, and whether losing it should pause the song.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../audio-route');

const out = (deviceId, groupId, label = '') => ({ kind: 'audiooutput', deviceId, groupId, label });
const speakers = out('speakers', 'g-speakers', 'Speakers');
const bluetooth = out('bt', 'g-bt', 'WH-1000XM4');
const virtualDefault = (groupId) => out('default', groupId, 'Default');

test('lostOutputs: devices that disappeared, without the virtual entries', () => {
  const before = [virtualDefault('g-bt'), bluetooth, speakers];
  const after = [virtualDefault('g-speakers'), speakers];
  assert.deepEqual(R.lostOutputs(before, after).map((d) => d.deviceId), ['bt']);
  assert.deepEqual(R.lostOutputs([virtualDefault('g-bt'), bluetooth], [virtualDefault('g-speakers')]).map((d) => d.deviceId), ['bt']);
  assert.deepEqual(R.lostOutputs([virtualDefault('g-bt')], []), []);
});

test('activeOutput: a chosen sink wins', () => {
  assert.equal(R.activeOutput([virtualDefault('g-bt'), bluetooth, speakers], 'speakers').deviceId, 'speakers');
});

test('activeOutput: the default entry group or label finds the physical device', () => {
  assert.equal(R.activeOutput([virtualDefault('g-bt'), bluetooth, speakers], '').deviceId, 'bt');
  assert.equal(R.activeOutput([out('default', '', 'Default - Speakers'), bluetooth, speakers], '').deviceId, 'speakers');
});

test('activeOutput: one physical output must be the one in use; several are ambiguous', () => {
  assert.equal(R.activeOutput([out('default', ''), bluetooth], '').deviceId, 'bt');
  assert.equal(R.activeOutput([out('default', 'g-none'), bluetooth, speakers], ''), null);
});

test('shouldPauseOnOutputChange: the active device going away pauses by default', () => {
  assert.equal(R.shouldPauseOnOutputChange({
    playing: true,
    keepPlaying: false,
    before: [virtualDefault('g-bt'), bluetooth, speakers],
    after: [virtualDefault('g-speakers'), speakers],
  }).pause, true);
});

test('shouldPauseOnOutputChange: a device that was not in use does not pause', () => {
  assert.equal(R.shouldPauseOnOutputChange({
    playing: true,
    keepPlaying: false,
    before: [virtualDefault('g-speakers'), bluetooth, speakers],
    after: [virtualDefault('g-speakers'), speakers],
  }).pause, false);
});

test('shouldPauseOnOutputChange: the setting keeps the song playing', () => {
  assert.equal(R.shouldPauseOnOutputChange({
    playing: true,
    keepPlaying: true,
    before: [virtualDefault('g-bt'), bluetooth, speakers],
    after: [virtualDefault('g-speakers'), speakers],
  }).pause, false);
});

test('shouldPauseOnOutputChange: nothing playing, or nothing lost', () => {
  assert.equal(R.shouldPauseOnOutputChange({
    playing: false,
    keepPlaying: false,
    before: [virtualDefault('g-bt'), bluetooth],
    after: [],
  }).pause, false);
  assert.equal(R.shouldPauseOnOutputChange({
    playing: true,
    keepPlaying: false,
    before: [virtualDefault('g-bt'), bluetooth],
    after: [virtualDefault('g-bt'), bluetooth],
  }).pause, false);
});

test('shouldPauseOnOutputChange: a chosen device still counts when the default cannot be matched', () => {
  const result = R.shouldPauseOnOutputChange({
    playing: true,
    keepPlaying: false,
    chosenId: 'bt',
    before: [out('default', 'g-other'), bluetooth, speakers],
    after: [out('default', 'g-other'), speakers],
  });
  assert.equal(result.pause, true);
  assert.equal(result.device.deviceId, 'bt');
});

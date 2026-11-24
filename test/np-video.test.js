const test = require('node:test');
const assert = require('node:assert/strict');
const np = require('../np-video');

test('a video within the nudge window is left alone', () => {
  assert.deepEqual(np.driftPlan(10.1, 10.0), { seek: false, rateScale: 1 });
  assert.deepEqual(np.driftPlan(9.9, 10.0), { seek: false, rateScale: 1 });
  assert.deepEqual(np.driftPlan(NaN, 10), { seek: false, rateScale: 1 });
});

test('a drifting video is nudged in the right direction', () => {
  const ahead = np.driftPlan(10.4, 10.0);
  assert.equal(ahead.seek, false);
  assert.ok(ahead.rateScale < 1, 'a video ahead of the sound slows down');

  const behind = np.driftPlan(9.6, 10.0);
  assert.equal(behind.seek, false);
  assert.ok(behind.rateScale > 1, 'a video behind the sound speeds up');

  assert.ok(Math.abs(ahead.rateScale - 1) <= np.MAX_RATE + 1e-9);
  assert.ok(Math.abs(behind.rateScale - 1) <= np.MAX_RATE + 1e-9);
});

test('a video far out of step is seeked instead', () => {
  assert.equal(np.driftPlan(12, 10).seek, true);
  assert.equal(np.driftPlan(8, 10).seek, true);
});

test('the portrait background loops 8 seconds from a quarter into a long video', () => {
  assert.deepEqual(np.loopWindow(180), { start: 45, end: 53 });
  assert.deepEqual(np.loopWindow(180, 6, 0.5), { start: 90, end: 96 });
  // shorter videos loop whole rather than run past the end
  assert.deepEqual(np.loopWindow(5), { start: 0, end: 5 });
  assert.deepEqual(np.loopWindow(0), { start: 0, end: 8 });
});

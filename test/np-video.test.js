const test = require('node:test');
const assert = require('node:assert/strict');
const np = require('../np-video');

test('the portrait background loops 8 seconds from a quarter into a long video', () => {
  assert.deepEqual(np.loopWindow(180), { start: 45, end: 53 });
  assert.deepEqual(np.loopWindow(180, 6, 0.5), { start: 90, end: 96 });
  // shorter videos loop whole rather than run past the end
  assert.deepEqual(np.loopWindow(5), { start: 0, end: 5 });
  assert.deepEqual(np.loopWindow(0), { start: 0, end: 8 });
});

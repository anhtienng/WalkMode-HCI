import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTap, classifyTap, offsetFromRect } from '../js/taps.js';

const cfg = { maxMovePx: 15, maxDurationMs: 800 };

test('short, still presses are taps; drags and long presses are not', () => {
  assert.equal(isTap({ x: 0, y: 0, t: 0 }, { x: 3, y: 4, t: 120 }, cfg), true);
  assert.equal(isTap({ x: 0, y: 0, t: 0 }, { x: 0, y: 30, t: 120 }, cfg), false);
  assert.equal(isTap({ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: 1200 }, cfg), false);
});

test('classification', () => {
  assert.equal(classifyTap({ hitId: 'cam', intendedId: 'cam' }), 'hit');
  assert.equal(classifyTap({ hitId: 'mail', intendedId: 'cam' }), 'selection_error');
  assert.equal(classifyTap({ hitId: null, intendedId: 'cam' }), 'miss');
  assert.equal(classifyTap({ hitId: 'cam', intendedId: 'cam', chrome: true }), 'chrome');
});

test('offsets and edge distance', () => {
  const rect = { left: 100, top: 100, width: 40, height: 40 };
  assert.deepEqual(offsetFromRect(120, 120, rect), { dx: 0, dy: 0, edgeDist: 0 });
  assert.deepEqual(offsetFromRect(150, 120, rect), { dx: 30, dy: 0, edgeDist: 10 });
  const o = offsetFromRect(143, 144, rect);
  assert.equal(o.edgeDist, 5);
  assert.deepEqual(offsetFromRect(0, 0, null), { dx: null, dy: null, edgeDist: null });
});

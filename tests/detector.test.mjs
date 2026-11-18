import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WalkDetector, computeFeatures, calibrateThresholds, median } from '../js/detector.js';
import { createSignal } from '../js/signals.js';
import { mulberry32 } from '../js/rng.js';

const RATE = 60;

/** Run a scripted sequence of [state, seconds] segments; returns transitions + features trace. */
function run(segments, { seed = 1, signal = {}, params = {} } = {}) {
  const det = new WalkDetector(params);
  const next = createSignal(mulberry32(seed), signal);
  const dt = 1 / RATE;
  const events = [];
  const trace = [];
  let t = 0;
  for (const [state, secs] of segments) {
    const end = t + secs;
    for (; t < end - 1e-9; t += dt) {
      const [ax, ay, az] = next(t, state, dt);
      const ev = det.push(t, ax, ay, az);
      if (ev) events.push(ev);
      trace.push({ t, truth: state, state: det.state, sigma: det.features.sigma });
    }
  }
  return { det, events, trace };
}

test('standing still never triggers walking', () => {
  for (const seed of [1, 2, 3]) {
    const { events } = run([['still', 30]], { seed });
    assert.equal(events.length, 0, `seed ${seed}`);
  }
});

test('irregular tap jolts while standing do not trigger walking', () => {
  for (const seed of [4, 5, 6]) {
    const { events } = run([['still', 30]], { seed, signal: { tapSpikeProb: 0.03, tapAmp: 1.5 } });
    assert.equal(events.length, 0, `seed ${seed}`);
  }
});

test('walking at 1.8 Hz is detected within 3 s', () => {
  for (const seed of [7, 8, 9]) {
    const { events } = run([['still', 5], ['walking', 10]], { seed });
    assert.ok(events.length >= 1, 'should detect walking');
    assert.equal(events[0].state, 'walking');
    const latency = events[0].t - 5;
    assert.ok(latency > 0 && latency < 3.0, `latency ${latency.toFixed(2)} s (seed ${seed})`);
  }
});

test('gentle walking (phone held steady while reading) is still detected', () => {
  const { events } = run([['still', 3], ['walking', 12]], { seed: 10, signal: { walkAmp: 1.0, walkFreqHz: 1.6 } });
  assert.ok(events.some((e) => e.state === 'walking'));
});

test('a brief 1.5 s pause does not flip back to stationary', () => {
  const { events } = run([['walking', 10], ['still', 1.5], ['walking', 10]], { seed: 11 });
  assert.deepEqual(events.map((e) => e.state), ['walking']);
});

test('stopping returns to stationary within 6 s', () => {
  const { events } = run([['walking', 10], ['still', 12]], { seed: 12 });
  assert.deepEqual(events.map((e) => e.state), ['walking', 'stationary']);
  const latency = events[1].t - 10;
  assert.ok(latency < 6, `exit latency ${latency.toFixed(2)} s`);
});

test('sensor gap resets filters without throwing', () => {
  const det = new WalkDetector();
  det.push(0, 0, 9.8, 0);
  det.push(0.02, 0, 9.8, 0);
  assert.equal(det.push(5, 0, 9.8, 0), null);
  assert.equal(det.push(5.02, NaN, 9.8, 0), null);
  assert.equal(det.state, 'stationary');
});

test('computeFeatures reports cadence of a clean sinusoid', () => {
  const p = { peakK: 0.6, minPeakGapSec: 0.3, windowSec: 2.5 };
  const buf = [];
  for (let t = 0; t < 2.5; t += 1 / 60) buf.push({ t, d: Math.sin(2 * Math.PI * 2 * t) });
  const f = computeFeatures(buf, p);
  assert.ok(Math.abs(f.cadence - 2) < 0.1, `cadence ${f.cadence}`);
  assert.ok(f.cv < 0.1);
  assert.ok(Math.abs(f.sigma - Math.SQRT1_2) < 0.05);
});

test('calibration places thresholds between standing and walking σ', () => {
  const c = calibrateThresholds(0.15, 1.4);
  assert.equal(c.ok, true);
  assert.ok(c.exitSigma > 0.15 && c.exitSigma < c.enterSigma && c.enterSigma < 1.4);
  const bad = calibrateThresholds(0.5, 0.6);
  assert.equal(bad.ok, false);
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

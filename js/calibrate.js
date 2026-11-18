// Per-participant calibration: 10 s standing (while tapping dots) + 12 s walking → detector thresholds.

import { CONFIG } from './config.js';
import { calibrateThresholds, median } from './detector.js';
import { h, clear, sleep } from './util.js';

function waitClick(btn) {
  return new Promise((r) => btn.addEventListener('click', r, { once: true }));
}

async function collect(motion, seconds, onProgress, isCancelled) {
  const sig = [];
  const cad = [];
  const start = performance.now();
  const warm = CONFIG.calibration.warmupSec * 1000;
  while (performance.now() - start < seconds * 1000) {
    if (isCancelled()) return null;
    await sleep(250);
    const el = performance.now() - start;
    onProgress(Math.min(1, el / (seconds * 1000)));
    const f = motion.features;
    if (el > warm && f.ready) {
      sig.push(f.sigma);
      cad.push(f.cadence);
    }
  }
  return { sigma: median(sig), cadence: median(cad), n: sig.length };
}

/** Resolves with a calibration record, or null if cancelled/skipped. */
export async function runCalibration(view, motion, isCancelled = () => false) {
  const C = CONFIG.calibration;
  const sim = motion.source === 'sim';

  // ---- Stage 1: standing + tapping ----
  clear(view);
  const start1 = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Start (10 s)');
  const skip = h('button', { class: 'btn btn-block', type: 'button' }, 'Skip calibration');
  let skipped = false;
  skip.addEventListener('click', () => { skipped = true; });
  view.append(h('div', { class: 'page' },
    h('h1', {}, 'Calibration 1 of 2: standing'),
    h('p', { class: 'lead' }, 'Stand still and hold the phone the way you normally would. Tap the blue dots as they appear.'),
    start1, h('div', { style: { height: '8px' } }), skip));
  await Promise.race([waitClick(start1), waitClick(skip)]);
  if (skipped || isCancelled()) return null;
  if (sim) motion.setSimWalking(false);

  clear(view);
  const bar = h('div');
  const area = h('div', { class: 'calib-area' });
  const dot = h('button', { class: 'calib-dot', type: 'button', 'aria-label': 'dot' });
  area.append(dot);
  const moveDot = () => {
    dot.style.left = `${10 + Math.random() * 80}%`;
    dot.style.top = `${12 + Math.random() * 76}%`;
  };
  moveDot();
  dot.addEventListener('pointerdown', moveDot);
  const dotTimer = setInterval(moveDot, 1400);
  view.append(h('div', { class: 'page' },
    h('h1', {}, 'Stand still · tap the dots'),
    h('div', { class: 'progress' }, bar), h('div', { style: { height: '12px' } }), area));
  const still = await collect(motion, C.stillSec, (p) => { bar.style.width = `${p * 100}%`; }, isCancelled);
  clearInterval(dotTimer);
  if (!still) return null;

  // ---- Stage 2: walking ----
  clear(view);
  const start2 = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, "I'm walking — start");
  view.append(h('div', { class: 'page' },
    h('h1', {}, 'Calibration 2 of 2: walking'),
    h('p', { class: 'lead' }, 'Start walking along the route at your normal pace, holding the phone as if reading. Once you are walking, tap the button and keep walking until it says done.'),
    sim ? h('div', { class: 'banner banner-warn' }, 'Simulated sensor: walking will be simulated automatically.') : null,
    start2));
  await waitClick(start2);
  if (isCancelled()) return null;
  if (sim) motion.setSimWalking(true);

  clear(view);
  const bar2 = h('div');
  view.append(h('div', { class: 'center-screen' },
    h('h1', {}, 'Keep walking…'),
    h('p', { class: 'lead' }, 'Look at the screen as you normally would.'),
    h('div', { class: 'progress', style: { width: '80%' } }, bar2)));
  const walk = await collect(motion, C.walkSec, (p) => { bar2.style.width = `${p * 100}%`; }, isCancelled);
  if (sim) motion.setSimWalking(false);
  if (!walk) return null;

  const th = calibrateThresholds(still.sigma, walk.sigma);
  return {
    at: Date.now(),
    source: motion.source,
    stillSigma: round(still.sigma),
    walkSigma: round(walk.sigma),
    stillCadence: round(still.cadence),
    walkCadence: round(walk.cadence),
    nStill: still.n,
    nWalk: walk.n,
    ok: th.ok,
    reason: th.reason || null,
    enterSigma: th.enterSigma,
    exitSigma: th.exitSigma,
  };
}

function round(v) {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
}

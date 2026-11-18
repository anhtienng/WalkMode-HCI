// Sensor monitor: live plot of the dynamic acceleration, σ and thresholds, plus tuning controls.

import { CONFIG } from './config.js';
import { h, clear } from './util.js';

const SPAN_S = 10;

export function renderMonitor(view, { motion }) {
  clear(view);
  const canvas = h('canvas', { class: 'monitor-canvas' });
  const state = h('div', { class: 'big-state' });
  const kv = h('dl', { class: 'kv' });
  const pts = []; // {t, d, sigma, walking}

  const enter = slider('Enter σ', 0.1, 3, 0.05, motion.thresholds.enterSigma, (v) => motion.setThresholds({ enterSigma: v }));
  const exit = slider('Exit σ', 0.05, 2, 0.05, motion.thresholds.exitSigma, (v) => motion.setThresholds({ exitSigma: v }));
  const saved = h('span', { class: 'small' });

  const simRow = h('div', { class: 'row' });
  const drawSim = () => {
    clear(simRow).append(
      motion.needsPermission() && motion.permission !== 'granted'
        ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => motion.requestPermission() }, 'Enable motion sensors') : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { motion.enableSim(!motion.sim.enabled); drawSim(); } },
        motion.sim.enabled ? 'Stop simulation' : 'Simulate'),
      motion.sim.enabled ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { motion.toggleSimWalking(); drawSim(); } },
        motion.sim.walking ? 'Sim: walking (W)' : 'Sim: still (W)') : null);
  };
  drawSim();

  view.append(h('div', { class: 'page' },
    h('h1', {}, 'Sensor monitor'),
    h('p', { class: 'lead' }, 'Walk and stand with the phone to see how the detector responds. Shaded = detected walking.'),
    state, canvas,
    h('div', { class: 'card' }, kv),
    h('div', { class: 'card stack' },
      h('strong', {}, 'Thresholds'),
      enter.el, exit.el,
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { motion.setThresholds(motion.thresholds, true); saved.textContent = 'Saved on this device.'; } }, 'Save on this device'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { motion.resetThresholds(); enter.set(motion.thresholds.enterSigma); exit.set(motion.thresholds.exitSigma); saved.textContent = 'Reset to defaults.'; } }, 'Reset'),
        saved),
      h('p', { class: 'small' }, `Defaults: enter ${CONFIG.detector.enterSigma}, exit ${CONFIG.detector.exitSigma}. Hold times: ${CONFIG.detector.enterHoldSec} s to switch on, ${CONFIG.detector.exitHoldSec} s to switch off. A study session's calibration overrides these for that participant.`)),
    h('div', { class: 'card stack' }, h('strong', {}, 'Source'), simRow)));

  const offSample = motion.on('sample', (s) => {
    pts.push({ t: s.t, d: s.d, sigma: s.f.sigma, walking: s.state === 'walking' });
    const cut = s.t - SPAN_S;
    while (pts.length && pts[0].t < cut) pts.shift();
  });
  const offStatus = motion.on('status', drawSim);

  let raf;
  let lastKv = 0;
  const draw = (ts) => {
    raf = requestAnimationFrame(draw);
    const f = motion.features;
    state.textContent = motion.state === 'walking' ? 'Walking' : 'Stationary';
    state.className = `big-state ${motion.state === 'walking' ? 'walking' : ''}`;
    if (ts - lastKv > 250) {
      lastKv = ts;
      const st = motion.status();
      clear(kv).append(
        h('dt', {}, 'Source'), h('dd', {}, `${st.source} · ${st.rateHz} Hz`),
        h('dt', {}, 'σ (window)'), h('dd', {}, `${f.sigma.toFixed(3)} m/s²`),
        h('dt', {}, 'Cadence'), h('dd', {}, f.cadence ? `${f.cadence.toFixed(2)} Hz · ${Math.round(f.cadence * 60)} steps/min` : '–'),
        h('dt', {}, 'Rhythm CV'), h('dd', {}, f.cv === null ? '–' : f.cv.toFixed(2)),
        h('dt', {}, 'Peaks'), h('dd', {}, String(f.peaks)));
    }
    plot(canvas, pts, motion.thresholds);
  };
  raf = requestAnimationFrame(draw);

  return () => { cancelAnimationFrame(raf); offSample(); offStatus(); };
}

function slider(label, min, max, step, value, onChange) {
  const out = h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, Number(value).toFixed(2));
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => { const v = Number(e.target.value); out.textContent = v.toFixed(2); onChange(v); },
  });
  return {
    el: h('label', { class: 'slider-row' }, h('span', {}, label), input, out),
    set: (v) => { input.value = v; out.textContent = Number(v).toFixed(2); },
  };
}

function plot(canvas, pts, th) {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const hgt = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  if (pts.length < 2) return;
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  const t1 = pts[pts.length - 1].t;
  const t0 = t1 - SPAN_S;
  const x = (t) => ((t - t0) / SPAN_S) * w;
  const range = 4; // ± m/s² for the dynamic signal
  const mid = hgt * 0.45;
  const yD = (d) => mid - (d / range) * (hgt * 0.4);
  const ySig = (s) => hgt - 6 - (s / 2) * (hgt * 0.35);

  // walking shading
  ctx.fillStyle = col('--walk-soft');
  let startT = null;
  for (const p of pts) {
    if (p.walking && startT === null) startT = p.t;
    if (!p.walking && startT !== null) { ctx.fillRect(x(startT), 0, x(p.t) - x(startT), hgt); startT = null; }
  }
  if (startT !== null) ctx.fillRect(x(startT), 0, w - x(startT), hgt);

  // zero line
  ctx.strokeStyle = col('--line');
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

  // dynamic acceleration
  ctx.strokeStyle = col('--muted');
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(p.t), yD(p.d)) : ctx.moveTo(x(p.t), yD(p.d))));
  ctx.stroke();

  // thresholds
  ctx.setLineDash([4, 4]);
  for (const [v, c] of [[th.enterSigma, '--walk'], [th.exitSigma, '--warn']]) {
    ctx.strokeStyle = col(c);
    ctx.beginPath(); ctx.moveTo(0, ySig(v)); ctx.lineTo(w, ySig(v)); ctx.stroke();
  }
  ctx.setLineDash([]);

  // σ
  ctx.strokeStyle = col('--accent');
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(p.t), ySig(p.sigma)) : ctx.moveTo(x(p.t), ySig(p.sigma))));
  ctx.stroke();

  ctx.fillStyle = col('--muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('dynamic |a| (±4 m/s²)', 6, 14);
  ctx.fillStyle = col('--accent');
  ctx.fillText('σ  · dashed: enter / exit', 6, ySig(2) - 4);
}

// Walking detector — pure, DOM-free, unit-tested in tests/detector.test.mjs.
//
// Pipeline per sample:
//   |a| = magnitude of accelerationIncludingGravity (orientation-invariant)
//   g   = EMA(|a|, τ = gravityTauSec)          → slowly tracks gravity
//   d   = EMA(|a| − g, τ = smoothTauSec)        → dynamic (body) acceleration, lightly smoothed
// Every evalEverySec, over the last windowSec of d:
//   σ        = standard deviation of d
//   peaks    = local maxima above mean + peakK·σ, merged if closer than minPeakGapSec
//   cadence  = 1 / mean(peak interval)  (Hz ≈ steps per second)
//   cv       = sd(interval) / mean(interval) — walking is rhythmic, taps/fidgeting are not
// State machine with hysteresis:
//   stationary → walking  when the window is walking-like for enterHoldSec
//   walking → stationary  when the window is still-like for exitHoldSec

import { CONFIG } from './config.js';

export const DEFAULT_DETECTOR = { ...CONFIG.detector };

export function computeFeatures(buf, p) {
  const n = buf.length;
  const empty = { ready: false, sigma: 0, cadence: 0, cv: null, peaks: 0, n };
  if (n < 10) return empty;
  const span = buf[n - 1].t - buf[0].t;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i].d;
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (buf[i].d - mean) ** 2;
  const sigma = Math.sqrt(ss / n);

  const thr = mean + p.peakK * sigma;
  const peakT = [];
  const peakV = [];
  for (let i = 1; i < n - 1; i++) {
    const v = buf[i].d;
    if (v > thr && v >= buf[i - 1].d && v > buf[i + 1].d) {
      const k = peakT.length - 1;
      if (k >= 0 && buf[i].t - peakT[k] < p.minPeakGapSec) {
        if (v > peakV[k]) { peakT[k] = buf[i].t; peakV[k] = v; }
      } else {
        peakT.push(buf[i].t);
        peakV.push(v);
      }
    }
  }

  let cadence = 0;
  let cv = null;
  if (peakT.length >= 2) {
    const iv = [];
    for (let i = 1; i < peakT.length; i++) iv.push(peakT[i] - peakT[i - 1]);
    const m = iv.reduce((a, b) => a + b, 0) / iv.length;
    cadence = m > 0 ? 1 / m : 0;
    if (iv.length >= 2) {
      const sd = Math.sqrt(iv.reduce((a, b) => a + (b - m) ** 2, 0) / iv.length);
      cv = m > 0 ? sd / m : null;
    }
  }

  return { ready: span >= p.windowSec * 0.8, sigma, cadence, cv, peaks: peakT.length, n };
}

export function isWalkLike(f, p) {
  return (
    f.ready &&
    f.sigma >= p.enterSigma &&
    f.peaks >= 3 &&
    f.cadence >= p.minCadenceHz &&
    f.cadence <= p.maxCadenceHz &&
    f.cv !== null &&
    f.cv <= p.maxIntervalCV
  );
}

export function isStillLike(f, p) {
  if (!f.ready) return false;
  if (f.sigma < p.exitSigma) return true;
  const rhythmic =
    f.peaks >= 2 &&
    f.cadence >= p.minCadenceHz * 0.8 &&
    f.cadence <= p.maxCadenceHz * 1.2 &&
    (f.cv === null || f.cv <= p.maxIntervalCV * 1.5);
  return !rhythmic;
}

export class WalkDetector {
  constructor(params = {}) {
    this.p = { ...DEFAULT_DETECTOR, ...params };
    this.reset();
  }

  reset() {
    this.buf = [];
    this.g = null;
    this.s = 0;
    this.lastT = null;
    this.lastEval = -Infinity;
    this.state = 'stationary';
    this.candidateSince = null;
    this.features = { ready: false, sigma: 0, cadence: 0, cv: null, peaks: 0, n: 0 };
  }

  setParams(partial) {
    Object.assign(this.p, partial);
  }

  /** Feed one sample. t in seconds. Returns a transition event or null. */
  push(t, ax, ay, az) {
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) || !Number.isFinite(t)) return null;
    const p = this.p;
    const m = Math.hypot(ax, ay, az);

    if (this.lastT === null || t - this.lastT > 0.5 || t < this.lastT) {
      // first sample, or a gap (tab hidden, sensor stall): restart filters but keep the state
      this.g = m;
      this.s = 0;
      this.buf = [];
      this.lastT = t;
      this.candidateSince = null;
    }
    const dt = t - this.lastT;
    this.lastT = t;

    this.g += (1 - Math.exp(-dt / p.gravityTauSec)) * (m - this.g);
    const d = m - this.g;
    const as = p.smoothTauSec > 0 ? 1 - Math.exp(-dt / p.smoothTauSec) : 1;
    this.s += as * (d - this.s);

    this.buf.push({ t, d: this.s });
    const cutoff = t - p.windowSec;
    let drop = 0;
    while (drop < this.buf.length && this.buf[drop].t < cutoff) drop++;
    if (drop) this.buf.splice(0, drop);

    if (t - this.lastEval >= p.evalEverySec) {
      this.lastEval = t;
      return this.evaluate(t);
    }
    return null;
  }

  evaluate(t) {
    const p = this.p;
    const f = computeFeatures(this.buf, p);
    this.features = f;
    const candidate = this.state === 'stationary' ? isWalkLike(f, p) : isStillLike(f, p);
    if (!candidate) {
      this.candidateSince = null;
      return null;
    }
    if (this.candidateSince === null) this.candidateSince = t;
    const hold = this.state === 'stationary' ? p.enterHoldSec : p.exitHoldSec;
    if (t - this.candidateSince >= hold) {
      this.state = this.state === 'stationary' ? 'walking' : 'stationary';
      this.candidateSince = null;
      return { type: 'state', state: this.state, t, features: { ...f } };
    }
    return null;
  }
}

/**
 * Per-participant thresholds from calibration.
 * stillSigma / walkSigma are typical (median) σ values measured while standing-and-tapping and while walking.
 */
export function calibrateThresholds(stillSigma, walkSigma, defaults = DEFAULT_DETECTOR) {
  const ok = Number.isFinite(stillSigma) && Number.isFinite(walkSigma) &&
    walkSigma > stillSigma * 1.8 && walkSigma - stillSigma > 0.2;
  if (!ok) {
    return {
      ok: false,
      reason: 'Walking and standing motion were too similar; keeping default thresholds.',
      enterSigma: defaults.enterSigma,
      exitSigma: defaults.exitSigma,
    };
  }
  const span = walkSigma - stillSigma;
  const r = (x) => Math.round(x * 1000) / 1000;
  return {
    ok: true,
    enterSigma: r(stillSigma + 0.4 * span),
    exitSigma: r(stillSigma + 0.2 * span),
  };
}

export function median(xs) {
  const a = xs.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

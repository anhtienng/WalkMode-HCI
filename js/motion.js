// Motion source: real DeviceMotion events or a desktop simulation, feeding the WalkDetector.

import { CONFIG } from './config.js';
import { WalkDetector } from './detector.js';
import { createSignal } from './signals.js';
import { mulberry32 } from './rng.js';
import { Emitter, store, now } from './util.js';

const THRESH_KEY = 'walkmode:thresholds';

class Motion extends Emitter {
  constructor() {
    super();
    this.detector = new WalkDetector(store.get(THRESH_KEY, {}) || {});
    this.source = 'none'; // 'device' | 'sim' | 'none'
    this.permission = this.needsPermission() ? 'unknown' : 'not-required';
    this.listening = false;
    this.deviceSamples = 0;
    this.sim = { enabled: false, walking: false, timer: null, next: null, lastT: 0 };
    this._rateCount = 0;
    this._rateSince = now();
    this.rateHz = 0;
    this._onMotion = this._onMotion.bind(this);
  }

  get supported() { return typeof window !== 'undefined' && 'DeviceMotionEvent' in window; }
  get state() { return this.detector.state; }
  get features() { return this.detector.features; }
  get thresholds() { return { enterSigma: this.detector.p.enterSigma, exitSigma: this.detector.p.exitSigma }; }

  needsPermission() {
    return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  }

  /** iOS 13+: must be called from a user gesture (tap). */
  async requestPermission() {
    if (!this.needsPermission()) {
      this.permission = 'not-required';
      this.startDevice();
      return 'granted';
    }
    try {
      const r = await DeviceMotionEvent.requestPermission();
      this.permission = r;
      if (r === 'granted') this.startDevice();
      this.emit('status', this.status());
      return r;
    } catch (e) {
      this.permission = 'error';
      this.emit('status', this.status());
      return 'error';
    }
  }

  startDevice() {
    if (this.listening || !this.supported) return;
    window.addEventListener('devicemotion', this._onMotion);
    this.listening = true;
  }

  _onMotion(e) {
    if (this.sim.enabled) return;
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    this.deviceSamples++;
    if (this.source !== 'device') {
      this.source = 'device';
      this.emit('status', this.status());
    }
    this._ingest(now() / 1000, a.x, a.y, a.z);
  }

  _ingest(t, x, y, z) {
    const ev = this.detector.push(t, x, y, z);
    this._rateCount++;
    const el = now() - this._rateSince;
    if (el >= 1000) {
      this.rateHz = Math.round((this._rateCount * 1000) / el);
      this._rateCount = 0;
      this._rateSince = now();
    }
    this.emit('sample', { t, x, y, z, d: this.detector.s, f: this.detector.features, state: this.detector.state });
    if (ev) this.emit('state', ev);
  }

  /** Resolve true if real sensor samples arrive within `ms`. */
  waitForDeviceSamples(ms = 1500) {
    const start = this.deviceSamples;
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.deviceSamples > start), ms);
    });
  }

  enableSim(on = true) {
    if (on === this.sim.enabled) return;
    this.sim.enabled = on;
    clearInterval(this.sim.timer);
    if (on) {
      this.sim.next = createSignal(mulberry32(Date.now() & 0xffff), CONFIG.sim);
      this.sim.lastT = now() / 1000;
      const step = 1000 / CONFIG.sim.rateHz;
      this.sim.timer = setInterval(() => {
        // generate all samples owed since the last tick (timers are throttled in background tabs)
        const tNow = now() / 1000;
        let t = this.sim.lastT;
        const dt = 1 / CONFIG.sim.rateHz;
        let guard = 0;
        while (t + dt <= tNow && guard++ < 120) {
          t += dt;
          const [x, y, z] = this.sim.next(t, this.sim.walking ? 'walking' : 'still', dt);
          this._ingest(t, x, y, z);
        }
        this.sim.lastT = guard >= 120 ? tNow : t;
      }, step);
      this.source = 'sim';
    } else {
      this.source = this.deviceSamples > 0 ? 'device' : 'none';
      this.sim.walking = false;
    }
    this.emit('status', this.status());
  }

  setSimWalking(walking) {
    this.sim.walking = !!walking;
    this.emit('status', this.status());
  }

  toggleSimWalking() {
    if (!this.sim.enabled) this.enableSim(true);
    this.setSimWalking(!this.sim.walking);
  }

  /** Change detector thresholds; persist=true remembers them on this device. */
  setThresholds({ enterSigma, exitSigma }, persist = false) {
    const t = {};
    if (Number.isFinite(enterSigma)) t.enterSigma = enterSigma;
    if (Number.isFinite(exitSigma)) t.exitSigma = exitSigma;
    this.detector.setParams(t);
    if (persist) store.set(THRESH_KEY, this.thresholds);
    this.emit('status', this.status());
  }

  /** Back to this device's saved thresholds (from the monitor page), or the defaults. */
  restoreDeviceThresholds() {
    const saved = store.get(THRESH_KEY, {}) || {};
    this.detector.setParams({
      enterSigma: saved.enterSigma ?? CONFIG.detector.enterSigma,
      exitSigma: saved.exitSigma ?? CONFIG.detector.exitSigma,
    });
    this.emit('status', this.status());
  }

  resetThresholds() {
    store.remove(THRESH_KEY);
    this.detector.setParams({ enterSigma: CONFIG.detector.enterSigma, exitSigma: CONFIG.detector.exitSigma });
    this.emit('status', this.status());
  }

  status() {
    return {
      source: this.source,
      permission: this.permission,
      supported: this.supported,
      listening: this.listening,
      simWalking: this.sim.walking,
      rateHz: this.rateHz,
      state: this.state,
      thresholds: this.thresholds,
    };
  }
}

export const motion = new Motion();

// ---- Screen wake lock (keep the screen on during sessions) ----
let wakeLock = null;
let wantWake = false;

export async function keepAwake(on = true) {
  wantWake = on;
  if (!('wakeLock' in navigator)) return false;
  try {
    if (on && !wakeLock) {
      const lock = await navigator.wakeLock.request('screen');
      if (!wantWake) { await lock.release(); return true; } // turned off while the request was pending
      wakeLock = lock;
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
    return true;
  } catch {
    return false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (wantWake && document.visibilityState === 'visible') keepAwake(true);
});

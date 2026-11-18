// Session model, per-block logs, tap tracking, and localStorage persistence.

import { CONFIG } from './config.js';
import { isTap } from './taps.js';
import { store, now, uid } from './util.js';

const INDEX_KEY = 'walkmode:sessions';
const SESSION_KEY = (id) => `walkmode:session:${id}`;
const CURRENT_KEY = 'walkmode:current';

// ---------------- Session store ----------------

export function deviceInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform || '',
    screenW: screen.width,
    screenH: screen.height,
    viewportW: innerWidth,
    viewportH: innerHeight,
    dpr: devicePixelRatio,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    standalone: matchMedia('(display-mode: standalone)').matches,
  };
}

export function createSession({ participantId, order, orderRow, posture, demographics, sensor, thresholds }) {
  const t = Date.now();
  return {
    schema: CONFIG.schema,
    appVersion: CONFIG.appVersion,
    sessionId: uid('s_'),
    participantId,
    createdAt: t,
    updatedAt: t,
    status: 'in-progress',
    stage: 'setup',
    order,
    orderRow,
    posture,
    demographics,
    device: deviceInfo(),
    sensor,
    thresholds,
    calibration: null,
    config: JSON.parse(JSON.stringify(CONFIG)),
    practice: null,
    blocks: [],
    abortedBlocks: [],
    currentBlock: null,
    preference: null,
    notes: '',
  };
}

export function saveSession(s) {
  s.updatedAt = Date.now();
  const ok = store.set(SESSION_KEY(s.sessionId), s);
  const idx = store.get(INDEX_KEY, []) || [];
  const entry = {
    sessionId: s.sessionId,
    participantId: s.participantId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    status: s.status,
    blocksDone: s.blocks.length,
    synthetic: !!s.synthetic,
  };
  const i = idx.findIndex((e) => e.sessionId === s.sessionId);
  if (i >= 0) idx[i] = entry; else idx.push(entry);
  store.set(INDEX_KEY, idx);
  return ok;
}

export const loadSession = (id) => store.get(SESSION_KEY(id));
export const listSessions = () => (store.get(INDEX_KEY, []) || []).slice().sort((a, b) => b.updatedAt - a.updatedAt);

export function deleteSession(id) {
  store.remove(SESSION_KEY(id));
  store.set(INDEX_KEY, (store.get(INDEX_KEY, []) || []).filter((e) => e.sessionId !== id));
  if (store.get(CURRENT_KEY) === id) store.remove(CURRENT_KEY);
}

export const getCurrentSessionId = () => store.get(CURRENT_KEY);
export const setCurrentSessionId = (id) => (id ? store.set(CURRENT_KEY, id) : store.remove(CURRENT_KEY));

// ---------------- Block log ----------------

/** Collects trials, taps, mode/detector timelines and a 1 Hz motion summary for one block. */
export class BlockLog {
  constructor({ index, condition, practice = false, motion, adapter }) {
    this.t0 = now();
    this.data = {
      index,
      practice,
      condition, // {code, iface, mobility} or null for practice
      startedAt: Date.now(),
      endedAt: null,
      thresholds: motion ? { ...motion.thresholds } : null,
      sensorSource: motion?.source || 'none',
      trials: [],
      taps: [],
      modeTimeline: [],
      detectorTimeline: [],
      motion: [],
    };
    this._offs = [];
    if (motion) {
      this.data.detectorTimeline.push({ t: 0, state: motion.state, initial: true });
      this._offs.push(motion.on('state', (ev) => this.data.detectorTimeline.push({ t: this.rel(), state: ev.state })));
      this._timer = setInterval(() => {
        const f = motion.features;
        this.data.motion.push({
          t: this.rel(),
          sigma: round(f.sigma, 3),
          cadence: round(f.cadence, 2),
          cv: f.cv === null ? null : round(f.cv, 2),
          state: motion.state,
          mode: adapter ? adapter.mode : null,
          source: motion.source,
        });
      }, 1000);
    }
    if (adapter) {
      this.data.modeTimeline.push({ t: 0, mode: adapter.mode, enabled: adapter.enabled, initial: true });
      this._offs.push(adapter.on('change', (ev) => this.data.modeTimeline.push({
        t: this.rel(ev.t), from: ev.from, to: ev.to, reason: ev.reason, deferredMs: ev.deferredMs, detector: ev.detector,
      })));
    }
  }

  rel(t = now()) { return Math.round(t - this.t0); }
  addTrial(rec) { this.data.trials.push(rec); }
  addTap(rec) { this.data.taps.push(rec); }

  finish() {
    clearInterval(this._timer);
    this._offs.forEach((off) => off());
    this._offs = [];
    this.data.endedAt = Date.now();
    this.data.durationMs = this.rel();
    return this.data;
  }

  /** Snapshot for autosave without stopping the log. */
  snapshot() {
    return { ...this.data, durationMs: this.rel() };
  }
}

function round(v, d) {
  if (!Number.isFinite(v)) return null;
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

// ---------------- Tap tracking ----------------

/**
 * Tracks taps (every pointer, so overlapping two-thumb taps both count) anywhere in the document.
 *   onDown(downInfo) → snapshot (e.g. the intended target's rect at touch-down time)
 *   onTap(tap, snapshot)
 * The hit target is resolved at touch-down (where the finger landed), like native buttons.
 * Scrolls (pointercancel), drags and long-presses are not taps.
 */
export function trackTaps({ onDown, onTap, cfg = CONFIG.tap }) {
  const downs = new Map(); // pointerId → down info (overlapping two-thumb taps are each tracked)
  const pd = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    const down = {
      x: e.clientX, y: e.clientY, t: now(),
      pointerType: e.pointerType,
      targetEl: target?.closest('[data-target]') || null,
      chrome: !!target?.closest('[data-chrome]'),
    };
    down.snapshot = onDown ? onDown(down) : null;
    downs.set(e.pointerId, down);
  };
  const pu = (e) => {
    const d = downs.get(e.pointerId);
    if (!d) return;
    downs.delete(e.pointerId);
    const up = { x: e.clientX, y: e.clientY, t: now() };
    if (!isTap(d, up, cfg)) return;
    onTap({
      x: d.x, y: d.y, upX: up.x, upY: up.y,
      tDown: d.t, tUp: up.t, durMs: Math.round(up.t - d.t),
      moved: Math.round(Math.hypot(up.x - d.x, up.y - d.y)),
      pointerType: d.pointerType,
      el: d.targetEl,
      hitId: d.targetEl?.dataset.target ?? null,
      chrome: d.chrome,
    }, d.snapshot);
  };
  const pc = (e) => { downs.delete(e.pointerId); };
  const cm = (e) => { if (e.target instanceof Element && e.target.closest('.task-screen')) e.preventDefault(); };
  document.addEventListener('pointerdown', pd, true);
  document.addEventListener('pointerup', pu, true);
  document.addEventListener('pointercancel', pc, true);
  document.addEventListener('contextmenu', cm, true);
  return () => {
    document.removeEventListener('pointerdown', pd, true);
    document.removeEventListener('pointerup', pu, true);
    document.removeEventListener('pointercancel', pc, true);
    document.removeEventListener('contextmenu', cm, true);
  };
}

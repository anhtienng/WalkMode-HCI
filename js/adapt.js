// Adaptation controller: detector state → UI mode, with a switch policy that avoids
// moving targets under the user's finger.

import { CONFIG } from './config.js';
import { Emitter, now } from './util.js';

const VAR_NAMES = {
  target: '--target', gap: '--gap', font: '--font', promptFont: '--prompt-font', labelFont: '--label-font',
  gridCols: '--cols', rowH: '--row-h', backBtn: '--back', toggleW: '--tgl-w', toggleH: '--tgl-h', pad: '--pad',
};

/** Generate the per-mode CSS custom properties from CONFIG.sizes (single source of truth). */
// (--anim, the transition time, is set in css/app.css so prefers-reduced-motion can zero it.)
export function installSizeStyles(sizes = CONFIG.sizes) {
  const css = Object.entries(sizes).map(([mode, s]) => {
    const decl = Object.entries(s)
      .map(([k, v]) => `${VAR_NAMES[k]}: ${k === 'gridCols' ? v : v + 'px'};`)
      .join(' ');
    return `:root[data-mode="${mode}"] { ${decl} }`;
  }).join('\n');
  let el = document.getElementById('walkmode-size-vars');
  if (!el) {
    el = document.createElement('style');
    el.id = 'walkmode-size-vars';
    document.head.append(el);
  }
  el.textContent = css;
}

export class Adapter extends Emitter {
  constructor(motion, opts = {}) {
    super();
    this.motion = motion;
    this.policy = opts.policy || CONFIG.adaptation.switchPolicy;
    this.idleMs = opts.touchIdleMs ?? CONFIG.adaptation.touchIdleMs;
    this.enabled = false;      // WalkMode interface on?
    this.override = null;      // demo: 'standard' | 'walking' | null
    this.mode = 'standard';    // applied UI mode
    this.pending = null;
    this.pointersDown = 0;
    this.lastPointerUp = -Infinity;
    this._timer = null;
    this.pill = document.getElementById('mode-pill');

    motion.on('state', () => this._recompute('detector'));

    // Track touches globally (capture phase so task handlers can't hide them).
    this._down = new Set();
    addEventListener('pointerdown', (e) => { this._down.add(e.pointerId); this.pointersDown = this._down.size; }, true);
    const up = (e) => {
      this._down.delete(e.pointerId);
      this.pointersDown = this._down.size;
      this.lastPointerUp = now();
      if (this.pending) this._schedule();
    };
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);

    this._render();
  }

  desiredMode() {
    if (this.override) return this.override;
    if (!this.enabled) return 'standard';
    return this.motion.state === 'walking' ? 'walking' : 'standard';
  }

  /** Turn WalkMode adaptation on/off (Standard condition = off). Applied immediately. */
  setEnabled(on, reason = 'condition') {
    this.enabled = !!on;
    this._recompute(reason, true);
  }

  setOverride(mode, reason = 'override') {
    this.override = mode;
    this._recompute(reason, true);
  }

  setPolicy(policy) {
    this.policy = policy;
  }

  /** Call between trials: applies any change held by the trial-boundary policy. */
  commitBoundary() {
    if (this.pending) this._apply(this.pending.mode, this.pending.reason + '+boundary');
  }

  _recompute(reason, force = false) {
    const want = this.desiredMode();
    if (want === this.mode) {
      this.pending = null;
      clearTimeout(this._timer);
      this._render();
      return;
    }
    if (force || this.policy === 'immediate') return this._apply(want, reason);
    this.pending = { mode: want, reason, since: now() };
    this.emit('pending', this.pending);
    if (this.policy === 'touch-idle') this._schedule();
    this._render();
  }

  _schedule() {
    clearTimeout(this._timer);
    if (!this.pending || this.policy !== 'touch-idle') return;
    if (this.pointersDown) return; // pointerup will reschedule
    const wait = Math.max(0, this.lastPointerUp + this.idleMs - now());
    this._timer = setTimeout(() => {
      if (this.pointersDown) return;
      if (now() - this.lastPointerUp < this.idleMs) return this._schedule();
      if (this.pending) this._apply(this.pending.mode, this.pending.reason);
    }, wait);
  }

  _apply(mode, reason) {
    clearTimeout(this._timer);
    const deferredMs = this.pending ? Math.round(now() - this.pending.since) : 0;
    this.pending = null;
    if (mode === this.mode) return;
    const from = this.mode;
    this.emit('beforechange', { from, to: mode });
    this.mode = mode;
    document.documentElement.dataset.mode = mode;
    this._render();
    this.emit('change', { t: now(), from, to: mode, reason, deferredMs, detector: this.motion.state });
  }

  _render() {
    if (!this.pill) return;
    const show = this.enabled || this.override !== null;
    this.pill.hidden = !show;
    const walking = this.mode === 'walking';
    this.pill.classList.toggle('is-walking', walking);
    this.pill.querySelector('span').textContent = walking ? 'Walking mode' : 'Standard';
  }
}

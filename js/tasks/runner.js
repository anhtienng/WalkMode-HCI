// Runs N trials of one task: timing, tap classification, feedback, logging, mode-change hooks.

import { CONFIG } from '../config.js';
import { classifyTap, offsetFromRect } from '../taps.js';
import { trackTaps } from '../logger.js';
import { h, clear, now, sleep, nextFrame } from '../util.js';

/** Build the task screen skeleton: prompt bar, task area, footer. */
export function buildTaskScreen(view, { footerLabel = '', onSkip = null, extraFooter = null } = {}) {
  clear(view);
  const promptText = h('div', { class: 'prompt-text' });
  const progress = h('div', { class: 'prompt-progress' });
  const area = h('div', { class: 'task-area' });
  const footer = h('div', { class: 'task-footer', 'data-chrome': true },
    h('span', {}, footerLabel),
    h('span', { class: 'row' },
      extraFooter,
      onSkip ? h('button', { type: 'button', onclick: onSkip, 'data-chrome': true }, 'Skip trial') : null));
  const screen = h('div', { class: 'task-screen' },
    h('div', { class: 'prompt-bar' }, promptText, progress), area, footer);
  view.append(screen);
  return { screen, promptText, progress, area, footer };
}

function ripple(x, y) {
  const r = h('div', { class: 'tap-ripple', style: { left: `${x}px`, top: `${y}px` } });
  document.body.append(r);
  setTimeout(() => r.remove(), 400);
}

function flash(el, cls) {
  if (!el) return;
  el.classList.remove('flash-ok', 'flash-err');
  void el.offsetWidth; // restart animation
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 320);
}

function toast(host, text, ms = 700) {
  const t = h('div', { class: 'toast' }, text);
  host.append(t);
  setTimeout(() => t.remove(), ms);
}

/**
 * runSegment({ ui, task, count, rng, log, adapter, motion, practice, seqStart, timeoutSec, control, onTrial })
 *   control: { skip(): void, abort(): void } is filled in so outside UI can skip/abort.
 *   count = Infinity runs until control.abort() (demo).
 * Resolves { aborted, trials }.
 */
export async function runSegment(opts) {
  const {
    ui, task, count, rng, log, adapter, motion,
    practice = false, seqStart = 0, timeoutSec = CONFIG.timeoutSec[task.id] || 20,
    control = {}, onTrial = null, blockIndex = null,
  } = opts;

  task.mount(ui.area);
  const trials = [];
  let current = null;     // the running trial record
  let finishTrial = null; // resolves the current trial's promise
  let aborted = false;

  control.skip = () => finishTrial?.('skipped');
  control.abort = () => { aborted = true; finishTrial?.('aborted'); };

  const offBefore = adapter.on('beforechange', () => task.beforeModeChange?.());
  const offChange = adapter.on('change', (ev) => {
    task.afterModeChange?.(); // synchronous: reading layout here happens before the next paint
    if (current) {
      current.modeSwitches++;
      current.modeEvents.push({ t: log.rel(ev.t), to: ev.to });
    }
  });

  const stopTaps = trackTaps({
    onDown: () => {
      if (!current) return null;
      const el = task.intendedEl();
      const r = el?.getBoundingClientRect();
      return {
        seq: current.seq,
        intendedId: task.intendedId(),
        rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
      };
    },
    onTap: (tap, snap) => {
      if (!current || !snap || snap.seq !== current.seq) return; // touch began in an earlier trial
      if (tap.chrome) {
        log.addTap(baseTap(tap, snap, 'chrome'));
        return;
      }
      if (task.ignoreTap?.(tap)) {
        log.addTap(baseTap(tap, snap, 'ignored'));
        return;
      }
      ripple(tap.x, tap.y);
      const cls = classifyTap({ hitId: tap.hitId, intendedId: snap.intendedId });
      const rec = baseTap(tap, snap, cls);
      log.addTap(rec);
      current.taps++;
      if (current.firstTapMs === null) current.firstTapMs = Math.round(tap.tDown - current._t0);
      if (cls === 'selection_error') {
        current.selectionErrors++;
        flash(tap.el, 'flash-err');
        try { navigator.vibrate?.(30); } catch { /* not supported */ }
      } else if (cls === 'miss') {
        current.misses++;
      }
      const res = cls === 'miss' ? { complete: false } : task.handleTap(tap.hitId, tap.el, cls);
      if (res.complete) {
        flash(tap.el, 'flash-ok');
        finishTrial?.('success', tap.tUp);
      }
    },
  });

  function baseTap(tap, snap, cls) {
    const off = offsetFromRect(tap.x, tap.y, snap.rect);
    return {
      t: log.rel(tap.tDown),
      block: blockIndex,
      seq: current.seq,
      task: task.id,
      practice,
      cls,
      x: Math.round(tap.x), y: Math.round(tap.y),
      upX: Math.round(tap.upX), upY: Math.round(tap.upY),
      durMs: tap.durMs, moved: tap.moved,
      hitId: tap.hitId, intendedId: snap.intendedId,
      dx: off.dx, dy: off.dy, edgeDist: off.edgeDist,
      intendedW: snap.rect ? Math.round(snap.rect.width) : null,
      intendedH: snap.rect ? Math.round(snap.rect.height) : null,
      mode: adapter.mode,
      detector: motion.state,
      pointerType: tap.pointerType,
    };
  }

  try {
    for (let i = 0; i < count && !aborted; i++) {
      const spec = task.newTrial(rng, i);
      clear(ui.promptText).append(...[].concat(spec.prompt));
      ui.progress.textContent = Number.isFinite(count) ? `${i + 1} / ${count}` : `${i + 1}`;
      await nextFrame();
      if (aborted) break;

      const t0 = now();
      current = {
        block: blockIndex,
        seq: seqStart + i,
        trial: i,
        task: task.id,
        practice,
        target: spec.label,
        meta: spec.meta || {},
        tStart: log.rel(t0),
        tEnd: null,
        durationMs: null,
        outcome: null,
        success: false,
        timeout: false,
        taps: 0,
        selectionErrors: 0,
        misses: 0,
        firstTapMs: null,
        modeAtStart: adapter.mode,
        modeAtEnd: null,
        modeSwitches: 0,
        modeEvents: [],
        detectorAtStart: motion.state,
        detectorAtEnd: null,
        adaptationEnabled: adapter.enabled,
        layout: layoutSnapshot(),
        _t0: t0,
      };

      const outcome = await new Promise((resolve) => {
        if (aborted) return resolve({ outcome: 'aborted', t: now() });
        const timer = setTimeout(() => resolve({ outcome: 'timeout', t: now() }), timeoutSec * 1000);
        finishTrial = (o, t = now()) => { clearTimeout(timer); resolve({ outcome: o, t }); };
      });
      finishTrial = null;

      const rec = current;
      current = null;
      rec.tEnd = log.rel(outcome.t);
      rec.durationMs = Math.round(outcome.t - rec._t0);
      rec.outcome = outcome.outcome;
      rec.success = outcome.outcome === 'success';
      rec.timeout = outcome.outcome === 'timeout';
      rec.modeAtEnd = adapter.mode;
      rec.detectorAtEnd = motion.state;
      Object.assign(rec, { extra: task.extra?.() || {} });
      delete rec._t0;
      if (outcome.outcome !== 'aborted') {
        log.addTrial(rec);
        trials.push(rec);
        onTrial?.(rec);
      }
      if (outcome.outcome === 'aborted') break;
      if (rec.timeout) toast(ui.screen, "Time's up");
      if (outcome.outcome === 'skipped') toast(ui.screen, 'Skipped');
      await sleep(rec.success ? CONFIG.interTrialMs : 700);
      adapter.commitBoundary();
    }
  } finally {
    stopTaps();
    offBefore();
    offChange();
    task.unmount();
    control.skip = control.abort = () => {};
  }
  return { aborted, trials };
}

function layoutSnapshot() {
  const cs = getComputedStyle(document.documentElement);
  const px = (v) => parseFloat(cs.getPropertyValue(v)) || null;
  return { target: px('--target'), gap: px('--gap'), rowH: px('--row-h'), cols: px('--cols') };
}

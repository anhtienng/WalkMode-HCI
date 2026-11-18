// Study flow: setup → sensor check (+ calibration) → practice → 4 counterbalanced blocks
// (intro, countdown, grid/list/nav tasks, NASA-TLX) → preference survey → export.

import { CONFIG, CONDITIONS, IFACE_LABEL, MOBILITY_LABEL } from './config.js';
import { rowForParticipant, orderForRow, participantNumber } from './latin.js';
import { makeRng } from './rng.js';
import { h, clear, sleep } from './util.js';
import { keepAwake } from './motion.js';
import { createSession, saveSession, loadSession, listSessions, setCurrentSessionId, BlockLog } from './logger.js';
import { buildTaskScreen, runSegment } from './tasks/runner.js';
import { createGridTask } from './tasks/grid.js';
import { createListTask } from './tasks/list.js';
import { createNavTask } from './tasks/nav.js';
import { tlxForm, demographicsForm, preferenceForm, segmented } from './questionnaires.js';
import { runCalibration } from './calibrate.js';
import { exportPanel } from './sessions.js';

export const TASKS = { grid: createGridTask, list: createListTask, nav: createNavTask };
export const TASK_ORDER = ['grid', 'list', 'nav'];
const TASK_INFO = {
  grid: { name: 'App launcher', how: 'Tap the app named at the top of the screen.' },
  list: { name: 'Contacts', how: 'Scroll the list and tap the contact named at the top.' },
  nav: { name: 'Settings', how: 'Open the named settings page, then switch the named setting ON or OFF. Use the back button if you enter the wrong page.' },
};

const condLabel = (c) => `${IFACE_LABEL[c.iface]} · ${MOBILITY_LABEL[c.mobility]}`;

export function renderStudy(view, ctx, params = {}) {
  const { motion, adapter } = ctx;
  let cancelled = false;
  let control = {};
  const disposers = new Set(); // cleanup for screens that hold timers/listeners
  let saveWarned = false;
  const save = (session) => {
    const ok = saveSession(session);
    if (!ok && !saveWarned) {
      saveWarned = true;
      document.body.append(h('div', {
        class: 'banner banner-err', 'data-chrome': true,
        style: { position: 'fixed', left: '8px', right: '8px', bottom: '8px', zIndex: 100 },
      }, 'Could not save to this phone (storage full?). Export now from Sessions, then delete old sessions.'));
    }
    return ok;
  };
  const isCancelled = () => cancelled;
  const guard = (e) => { e.preventDefault(); e.returnValue = ''; };

  document.body.classList.add('in-study');
  keepAwake(true);
  addEventListener('beforeunload', guard);

  // ---------- small screen helpers ----------
  const waitClick = (btn) => new Promise((r) => btn.addEventListener('click', () => r(), { once: true }));

  async function infoScreen({ title, body = [], button = 'Continue', extra = null }) {
    clear(view);
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, button);
    view.append(h('div', { class: 'page' }, h('h1', {}, title), [].concat(body).map((p) => (typeof p === 'string' ? h('p', { class: 'lead' }, p) : p)), extra, h('div', { style: { height: '12px' } }), btn));
    view.scrollTop = 0;
    await waitClick(btn);
  }

  async function choiceScreen({ title, body = '', choices }) {
    clear(view);
    return new Promise((resolve) => {
      view.append(h('div', { class: 'page' }, h('h1', {}, title), body ? h('p', { class: 'lead' }, body) : null,
        h('div', { class: 'stack' }, choices.map(([v, label, primary]) =>
          h('button', { class: `btn btn-block ${primary ? 'btn-primary' : ''}`, type: 'button', onclick: () => resolve(v) }, label)))));
    });
  }

  async function countdown(n) {
    clear(view);
    const num = h('div', { class: 'countdown' }, String(n));
    view.append(h('div', { class: 'center-screen' }, h('p', { class: 'lead' }, 'Get ready…'), num));
    for (let k = n; k > 0; k--) {
      num.textContent = String(k);
      await sleep(1000);
      if (cancelled) return;
    }
  }

  async function segmentIntro(taskId, k, total, sub = '') {
    clear(view);
    const btn = h('button', { class: 'btn btn-primary', type: 'button', style: { minWidth: '200px', minHeight: '56px' } }, 'Start');
    view.append(h('div', { class: 'center-screen' },
      h('p', { class: 'small' }, `Task ${k + 1} of ${total}${sub ? ' · ' + sub : ''}`),
      h('h1', {}, TASK_INFO[taskId].name),
      h('p', { class: 'lead', style: { maxWidth: '320px' } }, TASK_INFO[taskId].how),
      btn));
    await waitClick(btn);
  }

  function restartButton(onConfirm) {
    let armed = false;
    let t;
    const b = h('button', { type: 'button', 'data-chrome': true }, 'Restart block');
    b.addEventListener('click', () => {
      if (armed) { clearTimeout(t); onConfirm(); return; }
      armed = true;
      b.textContent = 'Tap again to restart';
      t = setTimeout(() => { armed = false; b.textContent = 'Restart block'; }, 3000);
    });
    return b;
  }

  function runSeg(taskId, count, rng, log, opts = {}) {
    const task = TASKS[taskId]();
    const ctl = {};
    control = ctl;
    const ui = buildTaskScreen(view, {
      footerLabel: opts.footer || '',
      onSkip: () => ctl.skip?.(),
      extraFooter: opts.allowRestart ? restartButton(() => ctl.abort?.()) : null,
    });
    return runSegment({
      ui, task, count, rng, log, adapter, motion,
      practice: !!opts.practice,
      seqStart: opts.seqStart || 0,
      blockIndex: opts.blockIndex ?? -1,
      control: ctl,
      onTrial: opts.onTrial,
    });
  }

  // ---------- stages ----------

  function suggestId() {
    const nums = listSessions().map((s) => participantNumber(s.participantId)).filter(Number.isFinite);
    const n = nums.length ? Math.max(...nums) + 1 : 1;
    return `P${String(n).padStart(2, '0')}`;
  }

  function setupScreen() {
    return new Promise((resolve) => {
      clear(view);
      let pid = suggestId();
      let row = rowForParticipant(pid);
      let rowManual = false;
      const posture = { hand: 'right', grip: 'one-thumb' };
      let notes = '';

      const orderBox = h('div', { class: 'stack' });
      const dupWarn = h('div', { class: 'banner banner-warn', hidden: true });
      const renderOrder = () => {
        clear(orderBox).append(
          segmented([[0, 'Row 1'], [1, 'Row 2'], [2, 'Row 3'], [3, 'Row 4']], (v) => { row = v; rowManual = true; renderOrder(); }, row),
          h('ol', { style: { margin: '6px 0 0', paddingLeft: '20px' } },
            orderForRow(row).map((code) => h('li', {}, condLabel(CONDITIONS.find((c) => c.code === code))))));
        const dup = listSessions().some((s) => s.participantId === pid);
        dupWarn.hidden = !dup;
        dupWarn.textContent = dup ? `A session for ${pid} already exists on this device.` : '';
      };
      const idInput = h('input', {
        class: 'input', type: 'text', value: pid, autocapitalize: 'characters', autocomplete: 'off',
        oninput: (e) => {
          pid = e.target.value.trim();
          if (!rowManual) row = rowForParticipant(pid || 'P1');
          renderOrder();
        },
      });
      const demoBox = h('div');
      const demographics = demographicsForm(demoBox);
      const err = h('div', { class: 'banner banner-err', hidden: true });
      const go = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Continue');
      go.addEventListener('click', () => {
        if (!pid) { err.hidden = false; err.textContent = 'Enter a participant ID.'; return; }
        const s = createSession({
          participantId: pid, order: orderForRow(row), orderRow: row, posture, demographics,
          sensor: motion.status(), thresholds: motion.thresholds,
        });
        s.notes = notes;
        s.stage = 'sensor';
        save(s);
        resolve(s);
      });
      renderOrder();
      view.append(h('div', { class: 'page' },
        h('h1', {}, 'New session'),
        h('p', { class: 'lead' }, 'Experimenter fills in the first card; the participant can fill in the rest.'),
        h('div', { class: 'card' },
          h('label', { class: 'field' }, h('span', {}, 'Participant ID'), idInput),
          dupWarn,
          h('div', { class: 'field' }, h('span', { class: 'small', style: { fontWeight: 600 } }, 'Condition order (balanced Latin square)'), orderBox),
          h('div', { class: 'field' }, h('span', {}, 'Hand holding the phone'),
            segmented([['right', 'Right'], ['left', 'Left']], (v) => { posture.hand = v; }, posture.hand)),
          h('div', { class: 'field' }, h('span', {}, 'Grip'),
            segmented([['one-thumb', 'One hand, thumb'], ['two-thumbs', 'Two thumbs'], ['hold-index', 'Hold + index finger']], (v) => { posture.grip = v; }, posture.grip)),
          h('label', { class: 'field' }, h('span', {}, 'Experimenter notes (route, conditions…)'),
            h('textarea', { class: 'input', oninput: (e) => { notes = e.target.value; } }))),
        h('div', { class: 'card' }, h('h2', { style: { marginTop: 0 } }, 'About you'), demoBox),
        err, go));
    });
  }

  async function calibrationResult(cal) {
    const body = h('dl', { class: 'kv' },
      h('dt', {}, 'Standing σ'), h('dd', {}, `${cal.stillSigma ?? '–'} m/s²`),
      h('dt', {}, 'Walking σ'), h('dd', {}, `${cal.walkSigma ?? '–'} m/s²`),
      h('dt', {}, 'Walking cadence'), h('dd', {}, cal.walkCadence ? `${Math.round(cal.walkCadence * 60)} steps/min` : '–'),
      h('dt', {}, 'Enter threshold'), h('dd', {}, String(cal.enterSigma)),
      h('dt', {}, 'Exit threshold'), h('dd', {}, String(cal.exitSigma)));
    clear(view);
    return new Promise((resolve) => {
      view.append(h('div', { class: 'page' },
        h('h1', {}, 'Calibration result'),
        cal.ok ? h('div', { class: 'banner banner-ok' }, 'Walking and standing were clearly different.')
          : h('div', { class: 'banner banner-warn' }, cal.reason || 'Calibration was not conclusive.'),
        h('div', { class: 'card' }, body),
        h('div', { class: 'stack' },
          cal.ok ? h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => resolve('use') }, 'Use these thresholds') : null,
          h('button', { class: 'btn btn-block', type: 'button', onclick: () => resolve('redo') }, 'Redo calibration'),
          h('button', { class: 'btn btn-block', type: 'button', onclick: () => resolve('keep') }, 'Keep current thresholds'))));
    });
  }

  async function sensorScreen(session) {
    for (;;) {
      if (cancelled) return false;
      const choice = await new Promise((resolve) => {
        clear(view);
        const kv = h('dl', { class: 'kv' });
        const warn = h('div', { class: 'banner banner-warn', hidden: true });
        const cont = h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => done('continue') }, 'Continue to practice');
        const update = () => {
          const st = motion.status();
          clear(kv).append(
            h('dt', {}, 'Source'), h('dd', {}, st.source === 'device' ? 'Phone sensors' : st.source === 'sim' ? 'SIMULATED (desktop testing)' : 'No data yet'),
            h('dt', {}, 'Rate'), h('dd', {}, `${st.rateHz} Hz`),
            h('dt', {}, 'Detector'), h('dd', {}, st.state),
            h('dt', {}, 'σ now'), h('dd', {}, motion.features.sigma.toFixed(2)),
            h('dt', {}, 'Thresholds'), h('dd', {}, `enter ${st.thresholds.enterSigma} · exit ${st.thresholds.exitSigma}`),
            h('dt', {}, 'Calibrated'), h('dd', {}, session.calibration ? 'yes' : 'no'));
          cont.disabled = st.source === 'none';
          warn.hidden = st.source !== 'sim';
          warn.textContent = 'Simulated sensor is active. Use this only for testing; real sessions need phone sensors.';
        };
        const off = motion.on('status', update);
        const iv = setInterval(update, 500);
        const dispose = () => { off(); clearInterval(iv); disposers.delete(dispose); };
        disposers.add(dispose);
        const done = (v) => { dispose(); resolve(v); };
        const needPerm = motion.needsPermission() && motion.permission !== 'granted';
        view.append(h('div', { class: 'page' },
          h('h1', {}, 'Motion sensors'),
          h('p', { class: 'lead' }, 'WalkMode uses the phone’s accelerometer to tell when you are walking. Nothing leaves this phone.'),
          needPerm ? h('button', {
            class: 'btn btn-primary btn-block', type: 'button',
            onclick: async () => { await motion.requestPermission(); await motion.waitForDeviceSamples(1200); done('refresh'); },
          }, 'Enable motion sensors') : null,
          motion.permission === 'denied' ? h('div', { class: 'banner banner-err' }, 'Motion access was denied. On iPhone: close the tab, reopen the page, and tap Allow.') : null,
          h('div', { class: 'card' }, kv),
          warn,
          h('div', { class: 'stack' },
            h('button', { class: 'btn btn-block', type: 'button', onclick: () => done('calibrate') }, session.calibration ? 'Calibrate again' : 'Calibrate (recommended, ~30 s)'),
            cont,
            motion.source !== 'device' ? h('button', { class: 'btn btn-block btn-sm', type: 'button', onclick: () => { motion.enableSim(true); update(); } }, 'Use simulated sensor (desktop testing)') : null)));
        update();
      });
      if (choice === 'refresh') continue;
      if (choice === 'calibrate') {
        const cal = await runCalibration(view, motion, isCancelled);
        if (cancelled) return false;
        if (cal) {
          const r = await calibrationResult(cal);
          if (r === 'use') {
            motion.setThresholds(cal);
            session.calibration = cal;
          } else if (r === 'redo') {
            session.calibrationAttempts = (session.calibrationAttempts || 0) + 1;
            continue;
          }
        }
        session.thresholds = motion.thresholds;
        save(session);
        continue;
      }
      session.thresholds = motion.thresholds;
      session.sensor = motion.status();
      save(session);
      return true;
    }
  }

  async function practice(session) {
    for (;;) {
      const log = new BlockLog({ index: -1, practice: true, condition: null, motion, adapter });
      const stop = () => { log.finish(); disposers.delete(stop); };
      disposers.add(stop);
      const layouts = [
        ['standard', 'Standard layout', 'This is the normal layout. Try each task once or twice. Accuracy matters more than speed, but work at a natural pace.'],
        ['walking', 'WalkMode layout', 'When WalkMode detects walking, buttons get bigger with more space between them. In the study this happens automatically; here it is shown on purpose so you know what to expect.'],
      ];
      let seq = 0;
      for (const [layout, title, text] of layouts) {
        await infoScreen({ title: `Practice: ${title}`, body: [text], button: 'Start practice' });
        if (cancelled) return;
        adapter.setOverride(layout, 'practice');
        for (const [k, taskId] of TASK_ORDER.entries()) {
          await segmentIntro(taskId, k, TASK_ORDER.length, 'practice');
          if (cancelled) return;
          const res = await runSeg(taskId, CONFIG.practice[taskId], makeRng(session.participantId, 'practice', layout, taskId), log,
            { practice: true, seqStart: seq, footer: `Practice · ${title}` });
          seq += res.trials.length;
          if (cancelled) return;
        }
        adapter.setOverride(null, 'practice-end');
      }
      session.practice = log.finish();
      disposers.delete(stop);
      save(session);
      const c = await choiceScreen({
        title: 'Practice complete',
        body: 'Next come 4 blocks. Each block has the same three tasks, followed by a short questionnaire.',
        choices: [['start', 'Start the study', true], ['again', 'Practice again']],
      });
      if (c === 'start' || cancelled) return;
    }
  }

  async function runBlock(session, i) {
    const cond = CONDITIONS.find((c) => c.code === session.order[i]);
    for (;;) {
      // Intro
      clear(view);
      const start = h('button', { class: 'btn btn-primary', type: 'button', style: { minWidth: '220px', minHeight: '56px' } }, 'Start block');
      const walking = cond.mobility === 'walking';
      view.append(h('div', { class: 'center-screen' },
        h('p', { class: 'small' }, `Block ${i + 1} of ${session.order.length}`),
        h('div', { class: 'cond-badges' },
          h('span', { class: `cond-badge ${cond.iface === 'walkmode' ? 'wm' : ''}` }, IFACE_LABEL[cond.iface]),
          h('span', { class: `cond-badge ${walking ? 'walk' : ''}` }, MOBILITY_LABEL[cond.mobility])),
        h('h1', {}, walking ? 'Walk the route' : 'Stand still'),
        h('p', { class: 'lead', style: { maxWidth: '340px' } }, walking
          ? 'Start walking along the route at your normal pace, then tap Start. Keep walking until the questionnaire appears.'
          : 'Stand at the marked spot, then tap Start. Stay standing for the whole block.'),
        h('p', { class: 'lead', style: { maxWidth: '340px' } }, cond.iface === 'walkmode'
          ? 'WalkMode is ON: the layout enlarges automatically while you walk.'
          : 'Standard interface: the layout stays the same.'),
        motion.source === 'sim' ? h('div', { class: 'banner banner-warn' }, 'SIMULATED SENSOR — press W to toggle walking') : null,
        h('div', { class: 'chips' }, session.order.map((code, k) =>
          h('span', { class: `chip ${k < i ? 'is-done' : k === i ? 'is-current' : ''}` }, `${k + 1}`))),
        start));
      await waitClick(start);
      if (cancelled) return;

      if (motion.source === 'sim') motion.setSimWalking(walking); // desktop testing convenience
      adapter.setEnabled(cond.iface === 'walkmode', 'block-start');
      const log = new BlockLog({ index: i, condition: cond, motion, adapter });
      await countdown(CONFIG.countdownSec);
      if (cancelled) { log.finish(); return; }

      let restart = false;
      let seq = 0;
      for (const [k, taskId] of TASK_ORDER.entries()) {
        await segmentIntro(taskId, k, TASK_ORDER.length);
        if (cancelled) { log.finish(); return; }
        const attempt = session.abortedBlocks.filter((b) => b.index === i).length; // a restart gets new stimuli
        const res = await runSeg(taskId, CONFIG.trials[taskId], makeRng(session.participantId, cond.code, taskId, attempt), log, {
          seqStart: seq, blockIndex: i, allowRestart: true,
          footer: `Block ${i + 1}/${session.order.length} · ${condLabel(cond)}`,
          onTrial: () => { session.currentBlock = log.snapshot(); save(session); },
        });
        seq += res.trials.length;
        if (cancelled) { log.finish(); return; }
        if (res.aborted) { restart = true; break; }
      }
      const data = log.finish();
      adapter.setEnabled(false, 'block-end');
      if (motion.source === 'sim') motion.setSimWalking(false);

      if (restart) {
        session.abortedBlocks.push({ ...data, abortedAt: Date.now(), reason: 'restart' });
        session.currentBlock = null;
        save(session);
        continue;
      }
      // Keep the finished block even if the page is closed during its questionnaire.
      data.tlx = null;
      data.tlxPending = true;
      session.blocks.push(data);
      session.currentBlock = null;
      save(session);
      await askTlx(session, data);
      return;
    }
  }

  async function askTlx(session, block) {
    const walking = block.condition.mobility === 'walking';
    block.tlx = await tlxForm(view, {
      title: `Block ${block.index + 1} of ${session.order.length} done`,
      subtitle: walking ? 'You can stop walking now. Please rate the block you just finished.' : 'Please rate the block you just finished.',
    });
    if (cancelled) return;
    delete block.tlxPending;
    save(session);
  }

  function showDone(session) {
    clear(view);
    removeEventListener('beforeunload', guard);
    view.append(h('div', { class: 'page' },
      h('h1', {}, 'Thank you!'),
      h('p', { class: 'lead' }, 'The session is complete. Export the data before closing this page (it also stays saved on this phone under Sessions).'),
      exportPanel(session),
      h('a', { class: 'btn btn-block', href: '#/' }, 'Back to home')));
  }

  // ---------- main flow ----------
  async function flow() {
    let session;
    if (params.resume) {
      session = loadSession(params.resume);
      if (!session) {
        await infoScreen({ title: 'Session not found', body: ['It may have been deleted.'], button: 'Home' });
        location.hash = '#/';
        return;
      }
      if (session.currentBlock) {
        session.abortedBlocks.push({ ...session.currentBlock, abortedAt: Date.now(), reason: 'resumed' });
        session.currentBlock = null;
        save(session);
      }
      if (session.thresholds) motion.setThresholds(session.thresholds);
    } else {
      motion.restoreDeviceThresholds(); // don't inherit the previous participant's calibration
      session = await setupScreen();
    }
    if (cancelled || !session) return;
    setCurrentSessionId(session.sessionId);
    // A reload (or iOS tab eviction) now resumes this session instead of starting a new one.
    history.replaceState(null, '', `#/study/resume/${encodeURIComponent(session.sessionId)}`);

    if (!(await sensorScreen(session))) return;
    if (session.stage === 'setup' || session.stage === 'sensor') {
      session.stage = 'practice';
      save(session);
    }
    if (session.stage === 'practice') {
      await practice(session);
      if (cancelled) return;
      session.stage = 'blocks';
      save(session);
    }
    if (session.stage === 'blocks') {
      const pending = session.blocks.find((b) => b.tlxPending);
      if (pending) {
        await askTlx(session, pending);
        if (cancelled) return;
      }
      for (let i = session.blocks.length; i < session.order.length; i++) {
        await runBlock(session, i);
        if (cancelled) return;
        if (i < session.order.length - 1) {
          await infoScreen({ title: 'Short break', body: ['Take a breath. Tap Continue when you are ready for the next block.'] });
          if (cancelled) return;
        }
      }
      session.stage = 'survey';
      save(session);
    }
    if (session.stage === 'survey') {
      session.preference = await preferenceForm(view);
      if (cancelled) return;
      session.stage = 'done';
      session.status = 'complete';
      session.completedAt = Date.now();
      save(session);
      setCurrentSessionId(null);
    }
    showDone(session);
  }

  flow().catch((e) => {
    console.error(e);
    if (cancelled) return;
    clear(view);
    view.append(h('div', { class: 'page' }, h('h1', {}, 'Something went wrong'),
      h('pre', { style: { whiteSpace: 'pre-wrap' } }, String(e?.stack || e)),
      h('p', {}, 'Data saved so far is kept. Use Home → Resume to continue.'),
      h('a', { class: 'btn', href: '#/' }, 'Home')));
  });

  return () => {
    cancelled = true;
    control.abort?.();
    for (const d of [...disposers]) d();
    adapter.setOverride(null, 'leave');
    adapter.setEnabled(false, 'leave');
    document.body.classList.remove('in-study');
    removeEventListener('beforeunload', guard);
    keepAwake(false);
  };
}

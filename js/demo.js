// Demo mode: run any task continuously, with Auto / forced layouts. Nothing is saved.

import { h, clear } from './util.js';
import { makeRng } from './rng.js';
import { BlockLog } from './logger.js';
import { buildTaskScreen, runSegment } from './tasks/runner.js';
import { TASKS } from './study.js';
import { segmented } from './questionnaires.js';

export function renderDemo(view, { motion, adapter }) {
  let taskId = 'grid';
  let modeChoice = 'auto';
  let control = {};
  let stopped = false;
  let counts = { hit: 0, selection_error: 0, miss: 0 };

  const applyMode = () => {
    if (modeChoice === 'auto') { adapter.setOverride(null, 'demo'); adapter.setEnabled(true, 'demo'); }
    else adapter.setOverride(modeChoice, 'demo');
  };

  const stats = h('span', {});
  const drawStats = () => { stats.textContent = `✓ ${counts.hit}  ✗ ${counts.selection_error}  miss ${counts.miss}`; };

  const simBtn = h('button', { type: 'button', 'data-chrome': true }, '');
  const drawSim = () => { simBtn.textContent = motion.sim.walking ? 'Sim: walking' : 'Sim: still'; simBtn.hidden = motion.source === 'device'; };
  simBtn.addEventListener('click', () => { motion.toggleSimWalking(); drawSim(); });
  const offStatus = motion.on('status', drawSim);

  async function start() {
    control.abort?.();
    await Promise.resolve();
    if (stopped) return;
    clear(view);
    const bar = h('div', { class: 'demo-bar', 'data-chrome': true },
      segmented([['grid', 'Apps'], ['list', 'Contacts'], ['nav', 'Settings']], (v) => { taskId = v; start(); }, taskId),
      segmented([['auto', 'Auto'], ['standard', 'Standard'], ['walking', 'Walking']], (v) => { modeChoice = v; applyMode(); }, modeChoice));
    const host = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
    view.append(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, bar, host));
    drawSim();
    const ui = buildTaskScreen(host, { footerLabel: '', onSkip: () => control.skip?.(), extraFooter: [stats, simBtn] });
    const log = new BlockLog({ index: 0, practice: true, condition: null, motion: null, adapter: null });
    const origAdd = log.addTap.bind(log);
    log.addTap = (t) => { origAdd(t); if (t.cls in counts) { counts[t.cls]++; drawStats(); } };
    drawStats();
    const ctl = {};
    control = ctl;
    await runSegment({ ui, task: TASKS[taskId](), count: Infinity, rng: makeRng('demo', Date.now()), log, adapter, motion, practice: true, control: ctl });
    log.finish();
  }

  applyMode();
  start();

  return () => {
    stopped = true;
    control.abort?.();
    offStatus();
    adapter.setOverride(null, 'leave');
    adapter.setEnabled(false, 'leave');
  };
}

// Home page.

import { CONFIG } from './config.js';
import { h, clear, isCoarsePointer } from './util.js';
import { getCurrentSessionId, loadSession } from './logger.js';

const chev = () => h('span', { class: 'chev' }, '›');

export function renderHome(view, { motion }) {
  clear(view);
  // Buttons are created once and only shown/hidden, so a tap is never lost to a re-render.
  const title = h('strong');
  const detail = h('div', { class: 'small' });
  const enableBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => { await motion.requestPermission(); drawStatus(); } }, 'Enable');
  const simBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { motion.enableSim(true); drawStatus(); } }, 'Simulate');
  const status = h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, title, detail), enableBtn, simBtn));
  const drawStatus = () => {
    const st = motion.status();
    title.textContent = st.source === 'device' ? 'Motion sensors active' : st.source === 'sim' ? 'Simulated sensor (desktop)' : 'Motion sensors not active';
    detail.textContent = st.source === 'none'
      ? (motion.needsPermission() ? 'Tap Enable to allow motion access.' : (location.protocol !== 'https:' && location.hostname !== 'localhost' ? 'Motion sensors require HTTPS.' : 'Waiting for sensor data…'))
      : `${st.rateHz} Hz · detector: ${st.state}${st.source === 'sim' ? ' · press W to toggle walking' : ''}`;
    enableBtn.hidden = !(motion.needsPermission() && motion.permission !== 'granted');
    simBtn.hidden = !(st.source === 'none' && !isCoarsePointer());
  };
  drawStatus();
  const off = motion.on('status', drawStatus);
  const iv = setInterval(drawStatus, 1000);

  const curId = getCurrentSessionId();
  const cur = curId ? loadSession(curId) : null;
  const resume = cur && cur.status !== 'complete'
    ? h('a', { class: 'menu-item', href: `#/study/resume/${cur.sessionId}` },
      h('div', {}, h('strong', {}, `Resume ${cur.participantId}`), h('span', {}, `${cur.blocks.length}/${cur.order.length} blocks done · the interrupted block restarts`)), chev())
    : null;

  view.append(h('div', { class: 'page' },
    h('h1', {}, 'WalkMode'),
    h('p', { class: 'lead' }, 'A movement-aware interface: when the phone detects walking, touch targets get bigger and further apart. When you stop, the standard layout returns.'),
    status,
    h('div', { class: 'menu-list' },
      resume,
      h('a', { class: 'menu-item', href: '#/study' },
        h('div', {}, h('strong', {}, 'New study session'), h('span', {}, 'Setup → practice → 4 blocks → questionnaires → export')), chev()),
      h('a', { class: 'menu-item', href: '#/demo' },
        h('div', {}, h('strong', {}, 'Demo'), h('span', {}, 'Try the tasks freely; force or auto-switch the layout')), chev()),
      h('a', { class: 'menu-item', href: '#/monitor' },
        h('div', {}, h('strong', {}, 'Sensor monitor'), h('span', {}, 'Live detector signal, thresholds, simulation')), chev()),
      h('a', { class: 'menu-item', href: '#/sessions' },
        h('div', {}, h('strong', {}, 'Sessions & export'), h('span', {}, 'Saved sessions on this device')), chev())),
    h('p', { class: 'small', style: { marginTop: '24px' } }, `v${CONFIG.appVersion} · data stays on this device until you export it.`)));

  return () => { off(); clearInterval(iv); };
}

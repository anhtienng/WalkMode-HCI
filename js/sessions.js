// Sessions page: list saved sessions, quick per-block summary, export, delete.

import { IFACE_LABEL, MOBILITY_LABEL } from './config.js';
import { h, clear, fmtDateTime } from './util.js';
import { listSessions, loadSession, deleteSession, getCurrentSessionId } from './logger.js';
import { exportFiles, download, canShareFiles, shareFiles, copyText, toJSON } from './export.js';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');

export function blockSummary(b) {
  const tr = b.trials || [];
  const ok = tr.filter((t) => t.success);
  const walkFrac = b.motion?.length ? b.motion.filter((m) => m.state === 'walking').length / b.motion.length : NaN;
  const switches = (b.modeTimeline || []).filter((m) => !m.initial).length;
  return {
    label: b.practice ? 'Practice' : `${IFACE_LABEL[b.condition.iface]} · ${MOBILITY_LABEL[b.condition.mobility]}`,
    n: tr.length,
    successPct: tr.length ? (100 * ok.length) / tr.length : NaN,
    timeS: mean(ok.map((t) => t.durationMs / 1000)),
    errPerTrial: mean(tr.map((t) => t.selectionErrors)),
    missPerTrial: mean(tr.map((t) => t.misses)),
    tlx: b.tlx?.raw,
    walkPct: 100 * walkFrac,
    switches,
  };
}

export function summaryTable(s) {
  const rows = [s.practice, ...(s.blocks || [])].filter(Boolean).map(blockSummary);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'simple' },
    h('thead', {}, h('tr', {}, ['Block', 'n', 'OK %', 'Time s', 'Err/tr', 'Miss/tr', 'TLX', 'Walk %', 'Switch'].map((c) => h('th', {}, c)))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('td', {}, r.label), h('td', {}, r.n), h('td', {}, fmt(r.successPct, 0)), h('td', {}, fmt(r.timeS)),
      h('td', {}, fmt(r.errPerTrial)), h('td', {}, fmt(r.missPerTrial)), h('td', {}, fmt(r.tlx, 1)),
      h('td', {}, fmt(r.walkPct, 0)), h('td', {}, r.switches))))));
}

/** Export buttons + summary for one session. */
export function exportPanel(s) {
  const msg = h('div', { class: 'small', 'aria-live': 'polite' });
  const say = (t) => { msg.textContent = t; };
  const files = () => exportFiles(s);
  const btns = h('div', { class: 'stack' },
    canShareFiles() ? h('button', {
      class: 'btn btn-primary btn-block', type: 'button',
      onclick: async () => say((await shareFiles(files())) ? 'Shared.' : 'Share cancelled.'),
    }, 'Share files (AirDrop, email, Drive…)') : null,
    h('button', {
      class: `btn btn-block ${canShareFiles() ? '' : 'btn-primary'}`, type: 'button',
      onclick: () => { const f = files()[0]; download(f.name, f.text, f.type); say(`Downloaded ${f.name}`); },
    }, 'Download JSON (complete data)'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm grow', type: 'button', onclick: () => { const f = files()[1]; download(f.name, f.text, f.type); say(`Downloaded ${f.name}`); } }, 'Trials CSV'),
      h('button', { class: 'btn btn-sm grow', type: 'button', onclick: () => { const f = files()[2]; download(f.name, f.text, f.type); say(`Downloaded ${f.name}`); } }, 'Taps CSV'),
      h('button', { class: 'btn btn-sm grow', type: 'button', onclick: async () => say((await copyText(toJSON(s))) ? 'JSON copied to clipboard.' : 'Copy failed.') }, 'Copy JSON')),
    msg);
  return h('div', { class: 'card' },
    h('h2', { style: { marginTop: 0 } }, `${s.participantId} · ${s.status}`),
    h('p', { class: 'small' }, `${fmtDateTime(s.createdAt)} · ${s.blocks.length}/${s.order.length} blocks · sensor: ${s.sensor?.source ?? '?'}${s.calibration ? ' · calibrated' : ''}`),
    summaryTable(s),
    h('div', { style: { height: '12px' } }),
    btns);
}

export function renderSessions(view) {
  const draw = () => {
    clear(view);
    const list = listSessions();
    const current = getCurrentSessionId();
    const page = h('div', { class: 'page' },
      h('h1', {}, 'Sessions'),
      h('p', { class: 'lead' }, 'Sessions are stored on this device only. Export each one, then copy the JSON files into the data/ folder for analysis.'));
    if (!list.length) page.append(h('div', { class: 'card' }, 'No sessions yet.'));
    for (const e of list) {
      const s = loadSession(e.sessionId);
      if (!s) continue;
      let armed = false;
      const del = h('button', { class: 'btn btn-sm btn-danger', type: 'button' }, 'Delete');
      del.addEventListener('click', () => {
        if (!armed) { armed = true; del.textContent = 'Tap again to delete'; setTimeout(() => { armed = false; del.textContent = 'Delete'; }, 3000); return; }
        deleteSession(e.sessionId);
        draw();
      });
      const panel = exportPanel(s);
      panel.append(h('div', { class: 'row', style: { marginTop: '10px' } },
        s.status !== 'complete' ? h('a', { class: 'btn btn-sm', href: `#/study/resume/${s.sessionId}` }, e.sessionId === current ? 'Resume' : 'Resume (restart current block)') : null,
        h('span', { class: 'grow' }), del));
      page.append(panel);
    }
    view.append(page);
  };
  draw();
}

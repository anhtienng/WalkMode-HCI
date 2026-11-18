// Export a session as JSON (complete) and CSV (trials, taps) via download, share sheet, or clipboard.

import { fileStamp } from './util.js';

export function sessionBaseName(s) {
  const pid = String(s.participantId || 'anon').replace(/[^A-Za-z0-9_-]/g, '');
  return `walkmode_${pid}_${fileStamp(s.createdAt)}`;
}

export const toJSON = (s) => JSON.stringify(s, null, 1);

function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const str = String(v);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCSV(rows, cols) {
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}

function allBlocks(s) {
  const out = [];
  if (s.practice) out.push(s.practice);
  out.push(...(s.blocks || []));
  return out;
}

export function trialsCSV(s) {
  const rows = [];
  for (const b of allBlocks(s)) {
    for (const t of b.trials) {
      rows.push({
        participant: s.participantId, session: s.sessionId,
        block: b.index, practice: b.practice, condition: b.condition?.code ?? 'PRACTICE',
        iface: b.condition?.iface ?? '', mobility: b.condition?.mobility ?? '',
        seq: t.seq, trial: t.trial, task: t.task, target: t.target,
        outcome: t.outcome, success: t.success, timeout: t.timeout, durationMs: t.durationMs, firstTapMs: t.firstTapMs,
        taps: t.taps, selectionErrors: t.selectionErrors, misses: t.misses,
        modeAtStart: t.modeAtStart, modeAtEnd: t.modeAtEnd, modeSwitches: t.modeSwitches,
        detectorAtStart: t.detectorAtStart, adaptationEnabled: t.adaptationEnabled,
        layoutTarget: t.layout?.target, layoutGap: t.layout?.gap,
        meta: t.meta, extra: t.extra,
      });
    }
  }
  const cols = Object.keys(rows[0] || { participant: 0 });
  return toCSV(rows, cols);
}

export function tapsCSV(s) {
  const rows = [];
  for (const b of allBlocks(s)) {
    for (const t of b.taps) {
      rows.push({ participant: s.participantId, condition: b.condition?.code ?? 'PRACTICE', ...t });
    }
  }
  const cols = Object.keys(rows[0] || { participant: 0 });
  return toCSV(rows, cols);
}

export function exportFiles(s) {
  const base = sessionBaseName(s);
  return [
    { name: `${base}.json`, type: 'application/json', text: toJSON(s) },
    { name: `${base}_trials.csv`, type: 'text/csv', text: trialsCSV(s) },
    { name: `${base}_taps.csv`, type: 'text/csv', text: tapsCSV(s) },
  ];
}

export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function canShareFiles() {
  try {
    const f = new File(['x'], 'x.json', { type: 'application/json' });
    return !!navigator.canShare && navigator.canShare({ files: [f] });
  } catch {
    return false;
  }
}

/** Opens the OS share sheet (AirDrop, email, Drive…). Resolves true when shared. */
export async function shareFiles(files) {
  const fs = files.map((f) => new File([f.text], f.name, { type: f.type }));
  try {
    await navigator.share({ files: fs, title: 'WalkMode session data' });
    return true;
  } catch (e) {
    if (e?.name !== 'AbortError') console.warn('share failed', e);
    return false;
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Balanced Latin square (Williams design) for counterbalancing condition order.

import { CONDITIONS } from './config.js';
import { hashString } from './rng.js';

/** Williams balanced Latin square for even n: rows are orders of 0..n-1. */
export function balancedLatinSquare(n) {
  const first = [];
  for (let i = 0, lo = 1, hi = n - 1; i < n; i++) {
    if (i === 0) first.push(0);
    else if (i % 2 === 1) first.push(lo++);
    else first.push(hi--);
  }
  const rows = [];
  for (let r = 0; r < n; r++) rows.push(first.map((c) => (c + r) % n));
  if (n % 2 === 1) {
    // odd n needs the mirrored rows too
    for (let r = 0; r < n; r++) rows.push(rows[r].slice().reverse());
  }
  return rows;
}

export const SQUARE = balancedLatinSquare(CONDITIONS.length);

/** "P07" → 7, "12" → 12; anything without digits is hashed. */
export function participantNumber(id) {
  const m = String(id).match(/\d+/);
  if (m) return parseInt(m[0], 10);
  return (hashString(String(id)) % 1000) + 1;
}

/** Row index (0-based) for a participant: P1→0, P2→1, … */
export function rowForParticipant(id) {
  const k = participantNumber(id);
  return (((k - 1) % SQUARE.length) + SQUARE.length) % SQUARE.length;
}

export function orderForRow(row) {
  return SQUARE[row].map((i) => CONDITIONS[i].code);
}

export function orderForParticipant(id) {
  return orderForRow(rowForParticipant(id));
}

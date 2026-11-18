import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancedLatinSquare, orderForParticipant, rowForParticipant, participantNumber } from '../js/latin.js';

test('4×4 square is Latin and first-order carry-over balanced', () => {
  const sq = balancedLatinSquare(4);
  assert.equal(sq.length, 4);
  for (let pos = 0; pos < 4; pos++) {
    assert.equal(new Set(sq.map((r) => r[pos])).size, 4, `column ${pos}`);
  }
  for (const r of sq) assert.equal(new Set(r).size, 4);
  const pairs = new Set();
  for (const r of sq) for (let i = 0; i < 3; i++) pairs.add(`${r[i]}>${r[i + 1]}`);
  assert.equal(pairs.size, 12, 'every ordered pair appears exactly once');
});

test('odd n doubles the rows', () => {
  assert.equal(balancedLatinSquare(3).length, 6);
});

test('participant ids map onto rows cyclically', () => {
  assert.equal(participantNumber('P07'), 7);
  assert.equal(rowForParticipant('P1'), 0);
  assert.equal(rowForParticipant('P4'), 3);
  assert.equal(rowForParticipant('P5'), 0);
  assert.deepEqual(orderForParticipant('P1'), ['STD-STAND', 'STD-WALK', 'WM-WALK', 'WM-STAND']);
  const r = rowForParticipant('alice');
  assert.ok(r >= 0 && r < 4);
});

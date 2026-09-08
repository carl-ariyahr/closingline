import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketRatio, boxesFor } from '../lib/boxes.mjs';

test('ticket ratio: average crowd bet relative to ours', () => {
  assert.equal(ticketRatio(64, 6), 0.036);   // crowd 64% of tickets, 6% of money: tiny bets
  assert.equal(ticketRatio(60, 45), 0.545);  // barely public
  assert.equal(ticketRatio(50, 50), 1);
  assert.equal(ticketRatio(100, 50), null); assert.equal(ticketRatio(null, 5), null);
});
test('boxes: each read is independent; latest re-check numbers win over the posting read', () => {
  const b = boxesFor({ T: 70, H: 40, liveCheck: { T: 64, H: 6 }, sharpNote: '✓ sharp agrees (Pinnacle +2.1% on our side vs retail, no-vig)', sharpMove: '8.5 → 8 against 42% of tickets', confirmation: 'confirmed' });
  assert.deepEqual(b.got, ['shading', 'rlm', 'ticket', 'action', 'money65']); assert.equal(b.n, 5); assert.equal(b.ratio, 0.036);
  const c = boxesFor({ T: 62, H: 47, sharpNote: '⚠ sharp on the other side (-1.3% vs retail, no-vig)', confirmation: { level: 'caution' } });
  assert.deepEqual(c.got, []); assert.deepEqual(c.miss, ['shading', 'rlm', 'ticket', 'action', 'money65']);
  const d = boxesFor({ T: 75, H: 30, confirmation: { level: 'confirmed' } });
  assert.deepEqual(d.got, ['ticket', 'action', 'money65']);
});

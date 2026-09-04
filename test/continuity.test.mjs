import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continuityDecide, MAX_CARRY } from '../lib/continuity.mjs';

const mk = (spreadA, totalO, mlA, extra = {}) => ({
  gamecode: 'X', away: 'A', home: 'B',
  spread: { away: { bets: spreadA }, home: {} }, total: { over: { bets: totalO }, under: {} }, ml: { away: { bets: mlA }, home: {} }, ...extra,
});

test('small hourly drift is accepted; no previous read is accepted', () => {
  assert.equal(continuityDecide(null, mk(60, 70, 55), 't1').accept, true);
  assert.equal(continuityDecide(mk(60, 70, 55), mk(65, 75, 50), 't1').accept, true);
});

test('a >20 swing is held back once, then accepted when the next read agrees with it', () => {
  const prev = mk(60, 70, 55, { start: '2026-09-04T22:40Z', started: false });
  const d1 = continuityDecide(prev, mk(60, 42, 55), 't1'); // total Over 70 -> 42
  assert.equal(d1.accept, false);
  assert.equal(d1.carry.carried, true); assert.equal(d1.carry.carriedRuns, 1); assert.deepEqual(d1.carry.pendingBets, [60, 42, 55]);
  assert.equal(d1.carry.total.over.bets, 70); // the snapshot keeps the last GOOD numbers
  assert.equal('started' in d1.carry, false);
  const d2 = continuityDecide(d1.carry, mk(61, 45, 54), 't2'); // second read agrees with the pending numbers
  assert.equal(d2.accept, true); assert.match(d2.why, /second read/);
});

test('a swing that does NOT repeat stays excluded but never freezes the game for good', () => {
  let prev = mk(60, 70, 55);
  const d1 = continuityDecide(prev, mk(60, 5, 55), 't1'); assert.equal(d1.accept, false);
  const d2 = continuityDecide(d1.carry, mk(60, 95, 55), 't2'); // a different bad read — still swung vs pending
  assert.equal(d2.accept, false); assert.equal(d2.carry.carriedRuns, 2);
  const d3 = continuityDecide(d2.carry, mk(60, 30, 55), 't3'); // MAX_CARRY reached → accept the live read
  assert.equal(MAX_CARRY, 2); assert.equal(d3.accept, true); assert.match(d3.why, /carried runs/);
});

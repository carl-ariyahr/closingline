import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingAlerts, markPushed } from '../lib/alerts.mjs';

const now = new Date('2026-09-08T02:00:00Z');
const mk = (over = {}) => ({ sharpKey: 'sharp|G1|Total|under', pick: 'Under 47.5', game: 'USF @ Army — 2026-09-12 (CFB)', sport: 'CFB', date: '2026-09-12',
  start: '2026-09-12T16:00:00Z', type: 'Total', alertedFor: '2026-09-07T23:00:00Z',
  sharp: { market: 'Total', from: 48.5, to: 47.5, tix: 45, moves: 1, hoursBefore: 113, lastAt: '2026-09-07T23:00:00Z' }, ...over });
const live = picks => ({ cards: [{ id: 'sharp-moves', picks }] });

test('a stamped early move that was never pushed is pending, with a readable text', () => {
  const a = pendingAlerts(live([mk()]), now);
  assert.equal(a.length, 1);
  assert.match(a[0].text, /Under 47\.5 — USF @ Army.*total 48\.5 → 47\.5 against 45% of tickets, 4\.7 days before kickoff/);
});

test('already pushed, unstamped, started, or graded entries are not pending', () => {
  const picks = [mk({ pushedAt: '2026-09-07T23:00:00Z' }), mk({ sharpKey: 'k2', alertedFor: null }), mk({ sharpKey: 'k3', start: '2026-09-08T01:00:00Z' }), mk({ sharpKey: 'k4', result: 'win' })];
  assert.equal(pendingAlerts(live(picks), now).length, 0);
});

test('markPushed stamps exactly the returned alerts; a NEWER move on the same entry becomes pending again', () => {
  const l = live([mk(), mk({ sharpKey: 'k2', pick: 'Army -3' })]);
  const a = pendingAlerts(l, now);
  assert.equal(markPushed(l, a, now), 2);
  assert.equal(pendingAlerts(l, now).length, 0);
  l.cards[0].picks[0].alertedFor = '2026-09-08T01:30:00Z'; // pipeline saw a second early move
  assert.equal(pendingAlerts(l, now).length, 1);
  assert.equal(markPushed(l, a, now), 0); // stale alert list does not stamp the newer move
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clvFor, clvSummary } from '../lib/clv.mjs';

const H = {
  G1: { Spread: [['2026-09-05T10:00Z', -3, 60], ['2026-09-05T18:00Z', -3.5, 62]], Total: [['2026-09-05T10:00Z', 47.5, 70], ['2026-09-05T15:00Z', 48.5, 70], ['2026-09-05T18:00Z', 48, 71]], Moneyline: [['2026-09-05T10:00Z', 188, 30], ['2026-09-05T18:00Z', 155, 31]] },
};
test('under: we took 47.5 and it closed 48 — later bettors got the better number, so we were WORSE; 48.5 → 48 is a beat', () => {
  const u = clvFor(H, { gamecode: 'G1', type: 'Total', side: 'under' }, '2026-09-05T11:00Z');
  assert.deepEqual([u.open, u.close, u.diff, u.beat, u.unit], [47.5, 48, -0.5, 'worse', 'pts']);
  const u2 = clvFor(H, { gamecode: 'G1', type: 'Total', side: 'under' }, '2026-09-05T16:00Z'); // posted at 48.5, closed 48
  assert.deepEqual([u2.open, u2.close, u2.diff, u2.beat], [48.5, 48, 0.5, 'beat']);
  const o = clvFor(H, { gamecode: 'G1', type: 'Total', side: 'over' }, '2026-09-05T16:00Z'); // over wants a LOW number: 48.5 vs close 48 = worse
  assert.deepEqual([o.diff, o.beat], [-0.5, 'worse']);
});
test('spread: home line falling after we took the home favorite = we laid less = beat; the away dog got worse', () => {
  const home = clvFor(H, { gamecode: 'G1', type: 'Spread', side: 'home' }, '2026-09-05T12:00Z');
  assert.deepEqual([home.open, home.close, home.diff, home.beat], [-3, -3.5, 0.5, 'beat']);
  const away = clvFor(H, { gamecode: 'G1', type: 'Spread', side: 'away' }, '2026-09-05T12:00Z');
  assert.deepEqual([away.diff, away.beat], [-0.5, 'worse']);
});
test('moneyline in cents off the away price: +188 that closed +155 beat by 33¢; the home side is the mirror', () => {
  const a = clvFor(H, { gamecode: 'G1', type: 'Moneyline', side: 'away' }, '2026-09-05T12:00Z');
  assert.deepEqual([a.open, a.close, a.diff, a.beat, a.unit], [188, 155, 33, 'beat', 'cents']);
  const h = clvFor(H, { gamecode: 'G1', type: 'Moneyline', side: 'home' }, '2026-09-05T12:00Z');
  assert.deepEqual([h.diff, h.beat], [-33, 'worse']);
});
test('posted before the first point uses the first point; no history / no side → null', () => {
  const t = clvFor(H, { gamecode: 'G1', type: 'Total', side: 'under' }, '2026-09-04T00:00Z');
  assert.equal(t.open, 47.5);
  assert.equal(clvFor(H, { gamecode: 'NOPE', type: 'Total', side: 'under' }, '2026-09-05T12:00Z'), null);
  assert.equal(clvFor(H, { gamecode: 'G1', type: 'Total' }, '2026-09-05T12:00Z'), null);
});
test('clvSummary counts outcomes and averages per unit', () => {
  const s = clvSummary([
    { result: 'win', clv: { beat: 'beat', diff: 0.5, unit: 'pts' } }, { result: 'loss', clv: { beat: 'worse', diff: -1, unit: 'pts' } },
    { result: 'win', clv: { beat: 'beat', diff: 20, unit: 'cents' } }, { result: 'win' },
  ]);
  assert.deepEqual([s.n, s.beat, s.worse, s.same, s.avgPts, s.avgCents], [3, 2, 1, 0, -0.25, 20]);
  assert.deepEqual(s.byOutcome.beat, { w: 2, l: 0 });
});

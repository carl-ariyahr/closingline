import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { externalNote, confirmationLevel } from '../api/pipeline.mjs';
import { parseActionSplits } from '../lib/actionnetwork.mjs';
import { withinWindow } from '../lib/formula.mjs';

const row = (away, home, market, a, b, extra = {}) => ({ source: 'actionnetwork', league: 'MLB', date: '2026-09-02', away, home, market, a, b, ...extra });
const doc = rows => ({ rows: Object.fromEntries(rows.map((r, i) => [String(i), r])) });

test('Red Sox @ White Sox: shared nickname cannot produce a false confirmation', () => {
  const ext = doc([row('Boston Red Sox', 'Chicago White Sox', 'ML', { name: 'Red Sox', bets: 70 }, { name: 'White Sox', bets: 30 })]);
  const p = { sport: 'MLB', date: '2026-09-02', type: 'Moneyline', away: 'Boston Red Sox', home: 'Chicago White Sox', publicSide: 'Chicago White Sox ML' };
  assert.match(externalNote(ext, p), /^⚠ CAUTION/);
  assert.match(externalNote(ext, { ...p, publicSide: 'Boston Red Sox ML' }), /^✓/);
});

test('swapped home/away in one source still matches the pair', () => {
  const ext = doc([row('Philadelphia Phillies', 'Arizona Diamondbacks', 'ML', { name: 'Phillies', bets: 62 }, { name: 'Diamondbacks', bets: 38 })]);
  const p = { sport: 'MLB', date: '2026-09-02', type: 'Moneyline', away: 'Arizona Diamondbacks', home: 'Philadelphia Phillies', publicSide: 'Philadelphia Phillies ML -118' };
  assert.match(externalNote(ext, p), /^✓/);
});

test('totals: public side must literally be Over/Under; near-even splits are neutral', () => {
  const ext = doc([row('A', 'B', 'Total', { name: 'Over', bets: 80 }, { name: 'Under', bets: 20 })]);
  const p = { sport: 'MLB', date: '2026-09-02', type: 'Total', away: 'A', home: 'B', publicSide: 'Over 8.5' };
  assert.match(externalNote(ext, p), /^✓/);
  assert.match(externalNote(ext, { ...p, publicSide: 'Under 8.5' }), /^⚠/);
  assert.equal(externalNote(ext, { ...p, publicSide: 'Somebody' }), null);
  const even = doc([row('A', 'B', 'Total', { name: 'Over', bets: 52 }, { name: 'Under', bets: 48 })]);
  assert.equal(confirmationLevel(externalNote(even, p)).level, 'unconfirmed');
});

test('doubleheader rows do not collide (dhIndex in the key) and the parser numbers them', () => {
  const html = readFileSync(new URL('./fixtures/action-MLB-2026-09-02.html', import.meta.url), 'utf8');
  const out = parseActionSplits(html, 'MLB');
  assert.equal(out.rows.length, 45);
  const y = out.rows.find(r => r.market === 'ML' && /Yankees/.test(r.away));
  assert.deepEqual([y.a.bets, y.a.money, y.b.bets, y.b.money], [92, 88, 8, 12]);
  for (const r of out.rows) assert.ok(r.dhIndex === 0 || r.dhIndex === 1);
});

test('window: every sport 7 days from game day (Carl 2026-09-04)', () => {
  const now = new Date('2026-09-02T19:00:00Z'); // Sep 2, noon PT
  assert.equal(withinWindow('MLB', '2026-09-06', now), true);   // 3.5 days
  assert.equal(withinWindow('MLB', '2026-09-09', now), true);   // 6.5 days — inside 7 now
  assert.equal(withinWindow('MLB', '2026-09-10', now), false);  // 7.5 days
  assert.equal(withinWindow('NFL', '2026-09-09', now), true);
  assert.equal(withinWindow('NFL', '2026-09-10', now), false);
});

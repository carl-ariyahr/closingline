import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordLines } from '../lib/yoyo.mjs';
import { detectSharpMoves, upsertSharpPicks, stampSharpMoves } from '../lib/sharp.mjs';

const g = (line, awayBets, total, overBets, mlA, mlABets) => ({ gamecode: '20260913NFL00001', sport: 'NFL', date: '2026-09-13', away: 'Green Bay Packers', home: 'San Francisco 49ers', start: '2026-09-13T20:25:00Z',
  spread: { line_home: line, away: { bets: awayBets }, home: { bets: 100 - awayBets } }, total: { line: total, over: { bets: overBets }, under: { bets: 100 - overBets } }, ml: { away_price: mlA, home_price: -mlA - 20, away: { bets: mlABets }, home: { bets: 100 - mlABets } } });

test('reverse line move: line moves toward the side with FEWER tickets', () => {
  const h = {};
  recordLines(h, [g(-3, 35, 47.5, 70, 140, 30)], '2026-09-07T12:00:00Z');   // 65% of tickets on the 49ers (home), 70% on the Over, 70% on the home ML
  recordLines(h, [g(-3, 36, 47.5, 71, 140, 30)], '2026-09-08T12:00:00Z');   // no line change
  recordLines(h, [g(-2.5, 34, 48.5, 72, 120, 28)], '2026-09-09T12:00:00Z'); // spread toward GB (34% tix) = sharp; total toward Over (72% tix) = crowd move; ML toward GB (28% tix) = sharp
  const ev = detectSharpMoves(h['20260913NFL00001']);
  assert.deepEqual(ev.map(e => `${e.market}:${e.side}:${e.from}->${e.to}:${e.tix}`), ['Spread:away:-3->-2.5:36', 'Moneyline:away:140->120:30']);
  const card = { picks: [] };
  const r = upsertSharpPicks(card, h, new Date('2026-09-09T13:00:00Z'), { todayPT: '2026-09-09' });
  assert.equal(r.created, 2);
  const sp = card.picks.find(p => p.type === 'Spread');
  assert.equal(sp.pick, 'Green Bay Packers +2.5'); assert.equal(sp.side, 'away'); assert.equal(sp.line, '+2.5'); assert.equal(sp.status, 'watch'); assert.match(sp.signal, /-3 → -2.5 toward Green Bay Packers while only 36%/);
  assert.equal(upsertSharpPicks(card, h, new Date('2026-09-09T14:00:00Z'), { todayPT: '2026-09-09' }).created, 0); // idempotent
  // a live code pick on GB +2.5 gets the purple note; a pick on the 49ers does not
  const gb = { gamecode: '20260913NFL00001', type: 'Spread', side: 'away' }, sf = { gamecode: '20260913NFL00001', type: 'Spread', side: 'home' };
  assert.equal(stampSharpMoves([gb, sf], h), 1);
  assert.equal(gb.sharpMove, '-3 → -2.5 against 36% of tickets'); assert.equal(sf.sharpMove ?? null, null);
  // after kickoff nothing new is posted
  assert.equal(upsertSharpPicks({ picks: [] }, h, new Date('2026-09-13T21:00:00Z'), {}).created, 0);
});

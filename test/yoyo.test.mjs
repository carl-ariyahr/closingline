import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordLines, detectYoYo, upsertYoYoPicks, crossReference, sameGame, cents } from '../lib/yoyo.mjs';

const g = (line, total, extra = {}) => ({ gamecode: '20260913NFL00001', sport: 'NFL', date: '2026-09-13', away: 'Green Bay Packers', home: 'San Francisco 49ers', spread: { line_home: line }, total: { line: total }, ...extra });

test('recordLines stores change points only; detectYoYo = any move back toward the opener (full or partial)', () => {
  const h = {};
  recordLines(h, [g(-3, 47.5)], 't1'); recordLines(h, [g(-3, 47.5)], 't2'); recordLines(h, [g(-6, 47.5)], 't3'); recordLines(h, [g(-4.5, 48)], 't4'); recordLines(h, [g(-3, 48)], 't5');
  const s = h['20260913NFL00001'];
  assert.deepEqual(s.Spread.map(x => x[1]), [-3, -6, -4.5, -3]);
  assert.deepEqual(s.Total.map(x => x[1]), [47.5, 48]);
  const yy = detectYoYo(s.Spread);
  assert.deepEqual([yy.from, yy.to, yy.back], [-3, -6, -4.5]); assert.deepEqual(yy.path, [-3, -6, -4.5]); // flagged the moment it turned back
  assert.equal(detectYoYo(s.Total), null);
  assert.deepEqual(detectYoYo([['a', -6], ['b', -10], ['c', -9]]).path, [-6, -10, -9]); // Carl's example: partial return counts
  assert.deepEqual(detectYoYo([['a', 48.5], ['b', 49], ['c', 48.5]]).path, [48.5, 49, 48.5]); // half a point counts (any change)
  assert.equal(detectYoYo([['a', -3], ['b', -6], ['c', -7]]), null); // kept moving away — no yo-yo
  assert.equal(detectYoYo([['a', -3], ['b', -1], ['c', 1]]), null);  // moving away through zero is still away
  assert.deepEqual(detectYoYo([['a', -3], ['b', -1], ['c', -2]]).path, [-3, -1, -2]); // back toward -3
  // moneyline prices are tracked in every sport (Carl: "all lines")
  const m = {};
  const ml = (p, extra = {}) => ({ gamecode: '20260905MLB00002', sport: 'MLB', date: '2026-09-05', away: 'Athletics', home: 'Seattle Mariners', spread: { line_home: -1.5 }, total: { line: 7.5 }, ml: { away_price: p, home_price: -p - 30 }, ...extra });
  // 20-cent minimum for moneyline moves (Carl 2026-09-04): 150 → 165 is ignored, 150 → 170 counts, 170 → 150 counts
  recordLines(m, [ml(150)], '2026-09-04T12:00:00Z'); recordLines(m, [ml(165)], '2026-09-04T13:00:00Z'); recordLines(m, [ml(170)], '2026-09-04T15:00:00Z'); recordLines(m, [ml(160)], '2026-09-04T16:00:00Z'); recordLines(m, [ml(150)], '2026-09-04T18:00:00Z');
  assert.deepEqual(m['20260905MLB00002'].Moneyline.map(x => x[1]), [150, 170, 150]);
  const y = detectYoYo(m['20260905MLB00002'].Moneyline, cents); assert.deepEqual(y.path, [150, 170, 150]);
  const card = { picks: [] }; upsertYoYoPicks(card, m, new Date('2026-09-04T20:00:00Z'), { todayPT: '2026-09-04' });
  assert.match(card.picks[0].pick, /Athletics ML \+150 → \+170 → \+150/);
  // crossing the +/-100 boundary is measured in cents: -105 → +105 is 10 cents, not a move
  const c = {}; recordLines(c, [ml(-105)], '2026-09-04T12:00:00Z'); recordLines(c, [ml(105)], '2026-09-04T13:00:00Z'); recordLines(c, [ml(120)], '2026-09-04T14:00:00Z');
  assert.deepEqual(c['20260905MLB00002'].Moneyline.map(x => x[1]), [-105, 120]);
});

test('yo-yo entries land on the Patrick card as flag-only alerts, pre-game only, idempotent', () => {
  const h = { '20260913NFL00001': { sport: 'NFL', date: '2026-09-13', away: 'Green Bay Packers', home: 'San Francisco 49ers', start: '2026-09-13T20:25:00Z', Spread: [['2026-09-10T12:00Z', -3], ['2026-09-11T12:00Z', -6], ['2026-09-12T12:00Z', -3]], Total: [] } };
  const card = { id: 'patrick-variables', picks: [{ kind: 'steam', type: 'Spread', pick: 'SF 49ers -3', game: 'GB Packers @ SF 49ers — Sep 13 (NFL)', status: 'play' }] };
  let r = upsertYoYoPicks(card, h, new Date('2026-09-12T13:00:00Z'), { todayPT: '2026-09-12' });
  assert.equal(r.created, 1);
  const yy = card.picks.find(p => p.kind === 'yoyo');
  assert.equal(yy.status, 'alert'); assert.match(yy.pick, /San Francisco 49ers spread -3 → -6 → -3/); assert.equal(yy.type, 'Spread');
  r = upsertYoYoPicks(card, h, new Date('2026-09-12T14:00:00Z'), { todayPT: '2026-09-12' }); assert.equal(r.created, 0); assert.equal(r.updated, 0);
  // after kickoff nothing new is flagged
  const h2 = { x: { ...h['20260913NFL00001'], Total: [['a', 47], ['b', 48], ['c', 47]] } };
  assert.equal(upsertYoYoPicks({ picks: [] }, h2, new Date('2026-09-13T21:00:00Z'), {}).created, 0);
  // cross-reference: the steam pick on the same game gets the yo-yo flag; a PS pick on the game flags the others
  card.picks.push({ kind: 'ps', psWho: 'phil', type: 'Spread', pick: 'San Francisco 49ers -3', game: 'Green Bay Packers @ San Francisco 49ers — 2026-09-13 (NFL)', away: 'Green Bay Packers', home: 'San Francisco 49ers', date: '2026-09-13' });
  assert.ok(crossReference(card) > 0);
  const steam = card.picks[0];
  assert.equal(steam.yoyoFlag, 'Spread -3 → -6 → -3'); assert.equal(steam.psFlag, 'phil');
  assert.equal(yy.psFlag, 'phil'); assert.equal(card.picks.find(p => p.kind === 'ps').yoyoFlag, 'Spread -3 → -6 → -3');
  assert.equal(card.picks.find(p => p.kind === 'ps').psFlag ?? null, null); // a PS pick doesn't flag itself
});

test('sameGame matches board names against ABBR-nickname labels, either orientation', () => {
  assert.equal(sameGame({ away: 'Green Bay Packers', home: 'San Francisco 49ers', date: '2026-09-13' }, { away: 'SF 49ers', home: 'GB Packers', date: '2026-09-13' }), true);
  assert.equal(sameGame({ away: 'Oklahoma ST Cowboys', home: 'Tulsa Golden Hurricane', date: '2026-09-05' }, { away: 'OKLAHOMA ST', home: 'TULSA', date: '2026-09-05' }), true);
  assert.equal(sameGame({ away: 'A', home: 'B', date: '2026-09-13' }, { away: 'A', home: 'B', date: '2026-09-14' }), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardContext, pendingCommentaryDay, applyCommentary, journalContext, upsertJournal } from '../lib/commentary.mjs';

const NOW = new Date('2026-09-08T04:00:00Z');
const lp = (o = {}) => ({ src: 'code', srcKey: 'g1|Total', type: 'Total', side: 'under', pick: 'Under 8', game: 'A @ B — 2026-09-08 (MLB)', sport: 'MLB', date: '2026-09-08', gamecode: 'g1', T: 70, H: 40, D: 30, status: 'play', signal: 'PUBLIC 70%…', dailyCard: { day: '2026-09-08', rank: 1, builtAt: 't' }, playsShownAt: 't', ...o });
const mk = () => ({ cards: [{ id: 'code-2026-09-07', picks: [lp(), lp({ srcKey: 'g2|Moneyline', gamecode: 'g2', type: 'Moneyline', side: 'away', pick: 'Dog ML +130', dailyCard: { day: '2026-09-08', rank: 2, builtAt: 't' } })] }],
  dailyCards: { '2026-09-08': { day: '2026-09-08', builtAt: 't', cap: 4, candidates: 2, picks: [{ srcKey: 'g1|Total', rank: 1, pick: 'Under 8' }, { srcKey: 'g2|Moneyline', rank: 2, pick: 'Dog ML +130' }] } } });

test('cardContext carries each play with its line path; pending day found until every play has commentary', () => {
  const live = mk(); const hist = { g1: { Total: [['t0', 8.5, 60], ['t1', 8, 61]] } };
  const ctx = cardContext(live, hist, '2026-09-08');
  assert.equal(ctx.plays.length, 2); assert.deepEqual(ctx.plays[0].linePath, [{ ts: 't0', v: 8.5 }, { ts: 't1', v: 8 }]); assert.equal(ctx.hasCommentary, false);
  assert.equal(pendingCommentaryDay(live), '2026-09-08');
  assert.equal(applyCommentary(live, '2026-09-08', { 'g1|Total': '  The total has dropped  half a run since open. ', 'nope|X': 'ignored', __card: 'Quiet Tuesday.' }, NOW), 1);
  assert.equal(live.cards[0].picks[0].commentary.text, 'The total has dropped half a run since open.');
  assert.equal(live.dailyCards['2026-09-08'].note, 'Quiet Tuesday.');
  assert.equal(pendingCommentaryDay(live), '2026-09-08'); // rank 2 still lacks one
  applyCommentary(live, '2026-09-08', { 'g2|Moneyline': 'x'.repeat(700) }, NOW);
  assert.equal(live.cards[0].picks[1].commentary.text.length, 600);
  assert.equal(pendingCommentaryDay(live), null);
  assert.equal(cardContext(live, {}, '2026-09-08').hasCommentary, true);
  assert.equal(cardContext(live, {}, '2026-09-09'), null);
});

test('journalContext: today record, ledger, by-rank, CLV, previous entry', () => {
  const live = mk(); live.cards[0].picks[0].result = 'win'; live.cards[0].picks[0].clv = { beat: 'beat', diff: 0.5, unit: 'pts' }; live.cards[0].picks[1].result = 'loss'; live.cards[0].picks[1].noBet = true;
  const j = { entries: [{ date: '2026-09-07', read: 'yesterday', recommendations: ['a'] }] };
  const c = journalContext(live, j, '2026-09-08');
  assert.deepEqual(c.todayRecord, { w: 1, l: 0, p: 0, units: 0.91 }); assert.equal(c.notCounted, 1);
  assert.deepEqual(c.ledgerRecord, { w: 1, l: 0, p: 0, units: 0.91 }); assert.deepEqual(c.byRank, { 1: { w: 1, l: 0, p: 0, units: 0.91 } });
  assert.equal(c.clv.beat, 1); assert.equal(c.previousEntry.read, 'yesterday'); assert.equal(c.plays.length, 2);
});

test('upsertJournal replaces the same date, sanitizes, keeps order and rev', () => {
  const j = { rev: 3, entries: [{ date: '2026-09-07', read: 'old' }, { date: '2026-09-09', read: 'later' }] };
  const e = upsertJournal(j, { date: '2026-09-08', read: 'r', graded: [{ pick: 'Under 8', game: 'A @ B', result: 'win' }, { pick: 'x', result: 'weird' }], recommendations: ['keep', 42], junk: 1 }, NOW);
  assert.deepEqual(j.entries.map(x => x.date), ['2026-09-07', '2026-09-08', '2026-09-09']); assert.equal(j.rev, 4);
  assert.deepEqual(e.graded[1], { pick: 'x', game: '', result: 'pending' }); assert.deepEqual(e.recommendations, ['keep', '42']); assert.equal(e.junk, undefined);
  upsertJournal(j, { date: '2026-09-08', read: 'r2' }, NOW); assert.equal(j.entries.filter(x => x.date === '2026-09-08').length, 1); assert.equal(j.entries[1].read, 'r2');
  assert.throws(() => upsertJournal(j, { read: 'no date' }), /date/);
});

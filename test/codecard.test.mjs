import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncCodeCard, codeCardId, AI_NOTE_TAG } from '../lib/codecard.mjs';

const sp = (over = {}) => ({ gamecode: '20260905MLB00003', type: 'Total', pick: 'Under 8', line: null, side: 'under', total: 8, dhIndex: 0, tier: 'play', status: 'active',
  postedAt: '2026-09-04T17:20:00.000Z', date: '2026-09-05', sport: 'MLB', away: 'Boston Red Sox', home: 'Baltimore Orioles', game: 'Boston Red Sox @ Baltimore Orioles — 2026-09-05 (MLB)',
  signal: 'PUBLIC 70% of tickets on Over 8 but only 30% of the money — we take Under 8 · 40 pt gap', T: 70, H: 30, D: 40, start: '2026-09-05T23:05:00.000Z', confirmation: { level: 'confirmed' }, ...over });

test('creates a code card + pick from an active shadow pick; label freezes; updates follow the tier', () => {
  const live = { cards: [] }, doc = { days: { '2026-09-04': { picks: [sp()] } } };
  let r = syncCodeCard(live, doc, 't1');
  assert.equal(r.created, 1); assert.equal(live.playsSource, 'code');
  const card = live.cards.find(c => c.id === codeCardId('2026-09-04'));
  const lp = card.picks[0];
  assert.deepEqual([lp.pick, lp.status, lp.side, lp.total, lp.src, lp.kind, lp.confirmation], ['Under 8', 'play', 'under', 8, 'code', 'fade', 'confirmed']);
  doc.days['2026-09-04'].picks[0].tier = 'lean'; doc.days['2026-09-04'].picks[0].D = 20;
  r = syncCodeCard(live, doc, 't2');
  assert.equal(r.created, 0); assert.equal(lp.status, 'lean'); assert.equal(lp.D, 20); assert.equal(card.picks.length, 1);
});

test('a SHOWN play is never downgraded or retired; an unshown pick that fades is retired and restored', () => {
  const live = { cards: [] }, doc = { days: { '2026-09-04': { picks: [sp()] } } };
  syncCodeCard(live, doc, 't1');
  const lp = live.cards[0].picks[0];
  lp.playsShownAt = 't1';
  doc.days['2026-09-04'].picks[0].tier = 'watch';
  syncCodeCard(live, doc, 't2'); assert.equal(lp.status, 'play');
  doc.days['2026-09-04'].picks[0].status = 'faded';
  syncCodeCard(live, doc, 't3'); assert.equal(lp.status, 'play');
  // unshown pick fades → dead with reason; comes back when active again
  const live2 = { cards: [] }, doc2 = { days: { '2026-09-04': { picks: [sp()] } } };
  syncCodeCard(live2, doc2, 't1');
  doc2.days['2026-09-04'].picks[0].status = 'faded'; doc2.days['2026-09-04'].picks[0].fadeReason = 'public flipped to Under 8';
  let r = syncCodeCard(live2, doc2, 't2');
  assert.equal(r.retired, 1); assert.equal(live2.cards[0].picks[0].status, 'dead'); assert.match(live2.cards[0].picks[0].retiredWhy, /public flipped/);
  doc2.days['2026-09-04'].picks[0].status = 'active';
  r = syncCodeCard(live2, doc2, 't3');
  assert.equal(r.restored, 1); assert.equal(live2.cards[0].picks[0].status, 'play'); assert.equal(live2.cards[0].picks[0].retiredWhy, undefined);
});

test('picks posted before the cutover for pre-cutover games are not mirrored; graded shadow picks are never created', () => {
  const live = { cards: [] };
  const doc = { days: { '2026-09-03': { picks: [sp({ postedAt: '2026-09-03T20:20:00.000Z', date: '2026-09-04', game: 'x — 2026-09-04 (MLB)' })] }, '2026-09-04': { picks: [sp({ result: 'win' })] } } };
  const r = syncCodeCard(live, doc, 't1');
  assert.equal(r.created, 0); assert.equal(live.cards.length, 0);
});

test('AI-written play/lean on a slate card is demoted to a note unless it was already shown', () => {
  const live = { cards: [{ id: 'slate-2026-09-04', picks: [
    { kind: 'fade', pick: 'BUF Bills -3', game: 'DET Lions @ BUF Bills — Sep 17 (NFL)', status: 'play', signal: 'public on Lions' },
    { kind: 'fade', pick: 'Tarleton ST +2.5', game: 'Tarleton ST @ Bowling Green Falcons — Sep 5 (CFB)', status: 'play', signal: 'x', playsShownAt: 't0' },
    { kind: 'rlm', pick: 'x', status: 'play', signal: 'y' },
  ] }] };
  const r = syncCodeCard(live, { days: {} }, 't1');
  assert.equal(r.aiDemoted, 1);
  const [bills, tarleton, rlm] = live.cards[0].picks;
  assert.equal(bills.status, 'watch'); assert.ok(bills.signal.endsWith(AI_NOTE_TAG)); assert.equal(bills.aiNote, true);
  assert.equal(tarleton.status, 'play'); assert.equal(rlm.status, 'play');
  syncCodeCard(live, { days: {} }, 't2'); assert.equal((bills.signal.match(/AI note only/g) || []).length, 1);
});

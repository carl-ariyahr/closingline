import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, shouldBuild, buildDailyCard, replaceCard, cardDayPT, nextDayPT, cardText, CAP } from '../lib/dailycard.mjs';
import { pendingCard, markCardPushed } from '../lib/alerts.mjs';

const NOW = new Date('2026-09-08T00:25:00Z'); // Sep 7, 5:25pm PT
const pk = (o = {}) => ({ src: 'code', srcKey: 'g|Total', kind: 'fade', type: 'Total', pick: 'Under 8', game: 'A @ B — 2026-09-08 (MLB)', sport: 'MLB', date: '2026-09-08', status: 'play', D: 30, T: 70, H: 40, start: '2026-09-09T00:10:00Z', postedAt: '2026-09-07T20:00:00Z', liveCheck: { ok: true, tier: 'play', T: 70, H: 40, D: 30 }, ...o });
const live = picks => ({ cards: [{ id: 'code-2026-09-07', picks }] });

test('the card is for today in PT; the window is 7am to the 12:25pm run and closes when the card is full', () => {
  assert.equal(cardDayPT(NOW), '2026-09-07'); assert.equal(nextDayPT(NOW), '2026-09-08');
  assert.equal(shouldBuild({}, '2026-09-08', 6), false);
  assert.equal(shouldBuild({}, '2026-09-08', 7), true);
  assert.equal(shouldBuild({}, '2026-09-08', 12), true);
  assert.equal(shouldBuild({}, '2026-09-08', 13), false);
  assert.equal(shouldBuild({ dailyCards: { '2026-09-08': { picks: [1, 2, 3] } } }, '2026-09-08', 9), true);   // room for one more
  assert.equal(shouldBuild({ dailyCards: { '2026-09-08': { picks: [1, 2, 3, 4] } } }, '2026-09-08', 9), false); // full
});

test('candidates: the latest read must be ok at play tier; today; not started; ranked by gap', () => {
  const picks = [
    pk({ srcKey: 'a', pick: 'Under 7', D: 25 }), pk({ srcKey: 'b', pick: 'Under 9', D: 41 }),
    pk({ srcKey: 'c', pick: 'Dog ML +130', type: 'Moneyline', D: 60, status: 'watch', liveCheck: { ok: true, tier: 'watch' } }), // gated → watch: out
    pk({ srcKey: 'd', pick: 'Under 8.5', D: 50, date: '2026-09-09' }),                             // not today
    pk({ srcKey: 'e', pick: 'Under 6.5', D: 55, liveCheck: { ok: false, why: 'faded' } }),         // faded on the latest read
    pk({ srcKey: 'f', pick: 'Under 10', D: 33, start: '2026-09-07T23:00:00Z' }),                   // already started
    pk({ srcKey: 'g', pick: 'Under 11', D: 28, result: 'win' }),                                   // graded
    pk({ srcKey: 'h', pick: 'Under 12', D: 19, liveCheck: { ok: true, tier: 'lean' } }),           // shown days ago, status still 'play', but the read says lean
    pk({ srcKey: 'i', pick: 'Under 13', D: 40, liveCheck: undefined }),                            // no read yet this run
  ];
  assert.deepEqual(candidates(live(picks), '2026-09-08', NOW).map(p => p.pick), ['Under 9', 'Under 7']);
});

test('buildDailyCard: top CAP by gap, stamps rank + playsShownAt; nothing to add stores nothing', () => {
  const picks = [1, 2, 3, 4, 5, 6].map(i => pk({ srcKey: 's' + i, pick: 'Under ' + i, D: 20 + i * 5 }));
  const l = live(picks);
  const card = buildDailyCard(l, '2026-09-08', NOW);
  assert.equal(card.picks.length, CAP); assert.equal(card.candidates, 6); assert.equal(card.added, 4);
  assert.deepEqual(card.picks.map(p => p.pick), ['Under 6', 'Under 5', 'Under 4', 'Under 3']);
  assert.equal(picks[5].dailyCard.rank, 1); assert.equal(picks[5].playsShownAt, NOW.toISOString());
  assert.equal(picks[1].dailyCard, undefined); assert.equal(picks[1].playsShownAt, undefined); // rank 5 and 6: tracked, not shown
  assert.equal(l.dailyCardSince, NOW.toISOString());
  assert.equal(shouldBuild(l, '2026-09-08', 9), false); // full
  assert.equal(buildDailyCard(l, '2026-09-08', NOW), null); // full: nothing added
  const empty = live([pk({ status: 'watch' })]);
  assert.equal(buildDailyCard(empty, '2026-09-08', NOW), null); assert.equal(empty.dailyCards['2026-09-08'], undefined);
});

test('the card fills across runs: a later clean qualifier is added at the next rank; a play already on the card is not re-added', () => {
  const a = pk({ srcKey: 'a', pick: 'Under 7', D: 30 }); const l = live([a]);
  const c1 = buildDailyCard(l, '2026-09-08', NOW); assert.equal(c1.picks.length, 1); assert.equal(c1.added, 1);
  const later = new Date('2026-09-08T17:25:00Z');
  l.cards[0].picks.push(pk({ srcKey: 'b', pick: 'Dog ML +140', type: 'Moneyline', D: 44 }));
  const c2 = buildDailyCard(l, '2026-09-08', later);
  assert.deepEqual(c2.picks.map(p => p.rank + ' ' + p.pick), ['1 Under 7', '2 Dog ML +140']); assert.equal(c2.added, 1); assert.equal(c2.updatedAt, later.toISOString());
  assert.equal(a.dailyCard.rank, 1); assert.equal(a.dailyCard.builtAt, NOW.toISOString());
  assert.equal(buildDailyCard(l, '2026-09-08', later), null);
});

test('replaceCard retires the card plays (they keep playsShownAt) and lets the day rebuild from the current board', () => {
  const a = pk({ srcKey: 'a', pick: 'Under 7', D: 30, commentary: { text: 'old' } }); const b = pk({ srcKey: 'b', pick: 'Under 9', D: 50 });
  const l = live([a]); buildDailyCard(l, '2026-09-08', NOW); l.dailyCards['2026-09-08'].pushedAt = 'x';
  l.cards[0].picks.push(b); a.liveCheck = { ok: false, why: 'faded' };
  assert.equal(replaceCard(l, '2026-09-08', NOW), 1);
  assert.equal(a.dailyCard.replaced, NOW.toISOString()); assert.equal(a.playsShownAt, NOW.toISOString()); assert.equal(a.commentary, undefined);
  assert.equal(l.dailyCards['2026-09-08'].pushedAt, undefined); assert.equal(shouldBuild(l, '2026-09-08', 8), true);
  const c = buildDailyCard(l, '2026-09-08', NOW);
  assert.deepEqual(c.picks.map(p => p.pick), ['Under 9']); // the faded old play is not a candidate; the clean one is
});

test('a pick shown before the card era keeps its stamp; a later build never re-stamps it', () => {
  const p = pk({ playsShownAt: '2026-09-07T10:00:00Z' });
  buildDailyCard(live([p]), '2026-09-08', NOW);
  assert.equal(p.playsShownAt, '2026-09-07T10:00:00Z'); assert.equal(p.dailyCard.rank, 1);
});

test('push text and one-time push marking through the alerts feed', () => {
  const l = live([pk({ D: 30 }), pk({ srcKey: 'z', pick: 'Dog ML +120', type: 'Moneyline', D: 27, H: 44, T: 71 })]);
  const card = buildDailyCard(l, '2026-09-08', NOW);
  const txt = cardText(card);
  assert.match(txt, /^🃏 Card for Tue, Sep 8 — 2 plays \(top 4 by gap, 2 qualifiers so far, updated 5:25 PM PT\)/);
  assert.match(txt, /\n1\. Under 8 — A @ B \(MLB, 5:10 PM PT\) · crowd 70% \/ money 40% · gap 30\n2\. Dog ML \+120/);
  assert.equal(pendingCard(l).day, '2026-09-08');
  assert.equal(markCardPushed(l, card, NOW), 1); assert.equal(pendingCard(l), null); assert.equal(markCardPushed(l, card, NOW), 0);
});

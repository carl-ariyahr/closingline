import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, shouldBuild, buildDailyCard, nextDayPT, cardText, CAP } from '../lib/dailycard.mjs';
import { pendingCard, markCardPushed } from '../lib/alerts.mjs';

const NOW = new Date('2026-09-08T00:25:00Z'); // Sep 7, 5:25pm PT
const pk = (o = {}) => ({ src: 'code', srcKey: 'g|Total', kind: 'fade', type: 'Total', pick: 'Under 8', game: 'A @ B — 2026-09-08 (MLB)', sport: 'MLB', date: '2026-09-08', status: 'play', D: 30, T: 70, H: 40, start: '2026-09-09T00:10:00Z', postedAt: '2026-09-07T20:00:00Z', ...o });
const live = picks => ({ cards: [{ id: 'code-2026-09-07', picks }] });

test('tomorrow in PT, and the build window is at/after 5pm PT once per day', () => {
  assert.equal(nextDayPT(NOW), '2026-09-08');
  assert.equal(shouldBuild({}, '2026-09-08', 16), false);
  assert.equal(shouldBuild({}, '2026-09-08', 17), true);
  assert.equal(shouldBuild({ dailyCards: { '2026-09-08': {} } }, '2026-09-08', 17), false);
});

test('candidates: play tier, tomorrow, not started, latest read still ok; ranked by gap', () => {
  const picks = [
    pk({ srcKey: 'a', pick: 'Under 7', D: 25 }), pk({ srcKey: 'b', pick: 'Under 9', D: 41 }),
    pk({ srcKey: 'c', pick: 'Dog ML +130', type: 'Moneyline', D: 60, status: 'watch' }),          // gated → watch: out
    pk({ srcKey: 'd', pick: 'Under 8.5', D: 50, date: '2026-09-09' }),                             // not tomorrow
    pk({ srcKey: 'e', pick: 'Under 6.5', D: 55, liveCheck: { ok: false, why: 'faded' } }),         // faded on the latest read
    pk({ srcKey: 'f', pick: 'Under 10', D: 33, start: '2026-09-07T23:00:00Z' }),                   // already started
    pk({ srcKey: 'g', pick: 'Under 11', D: 28, result: 'win' }),                                   // graded
  ];
  assert.deepEqual(candidates(live(picks), '2026-09-08', NOW).map(p => p.pick), ['Under 9', 'Under 7']);
});

test('buildDailyCard: top CAP by gap, stamps rank + playsShownAt, locks the day; empty board locks nothing', () => {
  const picks = [1, 2, 3, 4, 5, 6].map(i => pk({ srcKey: 's' + i, pick: 'Under ' + i, D: 20 + i * 5 }));
  const l = live(picks);
  const card = buildDailyCard(l, '2026-09-08', NOW);
  assert.equal(card.picks.length, CAP); assert.equal(card.candidates, 6);
  assert.deepEqual(card.picks.map(p => p.pick), ['Under 6', 'Under 5', 'Under 4', 'Under 3']);
  assert.equal(picks[5].dailyCard.rank, 1); assert.equal(picks[5].playsShownAt, NOW.toISOString());
  assert.equal(picks[1].dailyCard, undefined); assert.equal(picks[1].playsShownAt, undefined); // rank 5 and 6: tracked, not shown
  assert.equal(l.dailyCardSince, NOW.toISOString());
  assert.equal(shouldBuild(l, '2026-09-08', 20), false); // locked
  const empty = live([pk({ status: 'watch' })]);
  assert.equal(buildDailyCard(empty, '2026-09-08', NOW), null); assert.equal(empty.dailyCards, undefined);
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
  assert.match(txt, /^🃏 Card for Tue, Sep 8 — 2 plays \(top 4 by gap of 2 qualifiers/);
  assert.match(txt, /\n1\. Under 8 — A @ B \(MLB, 5:10 PM PT\) · crowd 70% \/ money 40% · gap 30\n2\. Dog ML \+120/);
  assert.equal(pendingCard(l).day, '2026-09-08');
  assert.equal(markCardPushed(l, card, NOW), 1); assert.equal(pendingCard(l), null); assert.equal(markCardPushed(l, card, NOW), 0);
});

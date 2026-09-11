import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketRead, consensusCandidates, addConsensusPlays, consensusCheck, applyConsensusCheck, CONSENSUS } from '../lib/consensus.mjs';
import { cohortsOf } from '../lib/liveconfirm.mjs';
import { pendingCard } from '../lib/alerts.mjs';
import { cardText } from '../lib/dailycard.mjs';

const NOW = new Date('2026-09-11T20:00:00Z'); // 1pm PT
const game = (o = {}) => ({ gamecode: 'G1', sport: 'MLB', date: '2026-09-11', away: 'Texas Rangers', home: 'Seattle Mariners', start: '2026-09-12T01:40:00Z', started: false,
  spread: { line_home: -1.5, away: { bets: 40, handle: 30 }, home: { bets: 60, handle: 70 } },
  total: { line: 8, over: { bets: 66, handle: 72 }, under: { bets: 34, handle: 28 } },
  ml: { away_price: 120, home_price: -140, away: { bets: 36, handle: 25 }, home: { bets: 64, handle: 75 } }, ...o });
const fade = (o = {}) => ({ gamecode: 'G1', type: 'Total', side: 'under', pick: 'Under 8', line: null, T: 66, H: 20, D: 46, date: '2026-09-11', checks: [{ ok: true }, { ok: false }], ...o });

test('marketRead: the crowd side, its tickets and money, a bettable label', () => {
  const t = marketRead(game(), 'Total'); assert.deepEqual([t.side, t.T, t.H, t.label], ['over', 66, 72, 'Over 8']);
  const m = marketRead(game(), 'Moneyline'); assert.deepEqual([m.side, m.T, m.H, m.label, m.price], ['home', 64, 75, 'Seattle Mariners ML -140', -140]);
  const s = marketRead(game(), 'Spread'); assert.deepEqual([s.side, s.label, s.line], ['home', 'Seattle Mariners -1.5', '-1.5']);
});

test('candidates: only a tracked fade that flipped, with tickets AND money >= 60 on the crowd side, pre-game, no heavy favorites', () => {
  const g = game(); const fb = { G1: g };
  assert.equal(consensusCandidates([fade()], fb, '2026-09-11', NOW).length, 1);                        // Under 8 fade → Over 8 consensus
  assert.equal(consensusCandidates([fade({ checks: [{ ok: false }] })], fb, '2026-09-11', NOW).length, 0); // never a qualifying fade
  assert.equal(consensusCandidates([fade({ date: '2026-09-12' })], fb, '2026-09-11', NOW).length, 0);   // not today
  assert.equal(consensusCandidates([fade({ side: 'over' })], fb, '2026-09-11', NOW).length, 0);          // crowd is on OUR fade side: no flip
  assert.equal(consensusCandidates([fade()], { G1: game({ total: { line: 8, over: { bets: 66, handle: 55 }, under: { bets: 34, handle: 45 } } }) }, '2026-09-11', NOW).length, 0); // money not there yet
  assert.equal(consensusCandidates([fade()], { G1: game({ start: '2026-09-11T20:30:00Z' }) }, '2026-09-11', NOW).length, 0); // inside the last hour
  assert.equal(consensusCandidates([fade({ type: 'Moneyline', side: 'away', pick: 'Texas Rangers ML' })], { G1: game({ ml: { away_price: 200, home_price: -240, away: { bets: 30, handle: 20 }, home: { bets: 70, handle: 80 } } }) }, '2026-09-11', NOW).length, 0); // -240 favorite: skipped
  assert.equal(consensusCandidates([fade({ type: 'Moneyline', side: 'away', pick: 'Texas Rangers ML' })], fb, '2026-09-11', NOW).length, 1); // -140 is fine
});

test('addConsensusPlays: badged picks on the code card, C-ranks, cap 2, no duplicates, card push pending; cohorts do not apply', () => {
  const g = game(); const fb = { G1: g, G2: game({ gamecode: 'G2', away: 'A', home: 'B', ml: { away_price: 130, home_price: -150, away: { bets: 30, handle: 22 }, home: { bets: 70, handle: 78 } } }), G3: game({ gamecode: 'G3', away: 'C', home: 'D' }) };
  const shadow = [fade(), fade({ gamecode: 'G2', type: 'Moneyline', side: 'away', pick: 'A ML' }), fade({ gamecode: 'G3' })];
  const live = { cards: [], dailyCards: { '2026-09-11': { day: '2026-09-11', builtAt: '2026-09-11T14:25:00Z', cap: 3, candidates: 1, picks: [], pushedAt: '2026-09-11T14:35:00Z' } } };
  const cands = consensusCandidates(shadow, fb, '2026-09-11', NOW);
  assert.equal(cands.length, 3); assert.equal(cands[0].pick.gamecode, 'G2'); // most money first (78)
  const added = addConsensusPlays(live, cands, '2026-09-11', NOW);
  assert.equal(added.length, CONSENSUS.cap);
  assert.deepEqual(added.map(p => p.dailyCard.rank + ' ' + p.pick), ['C1 B ML -150', 'C2 Over 8']);
  assert.equal(added[0].kind, 'consensus'); assert.equal(added[0].side, 'home'); assert.equal(added[0].playsShownAt, NOW.toISOString()); assert.match(added[0].signal, /^🔁 CONSENSUS/);
  assert.equal(addConsensusPlays(live, cands, '2026-09-11', NOW).length, 0); // cap reached
  assert.equal(pendingCard(live).day, '2026-09-11'); // gained plays after the last push
  assert.match(cardText(live.dailyCards['2026-09-11']), /🔁 C1\. B ML -150 — A @ B \(MLB, 6:40 PM PT\) · CONSENSUS, follow the money: crowd 70% tickets \/ 78% money · was our fade A ML/);
  assert.deepEqual(cohortsOf(added[0]), []);
});

test('consensusCheck: holds at 60/60, fades below, flips when the crowd changes sides; tags replace each other', () => {
  const lp = { kind: 'consensus', type: 'Total', side: 'over', pick: 'Over 8', signal: '🔁 CONSENSUS (follow the money): x' };
  let c = consensusCheck(lp, game(), NOW); assert.equal(c.ok, true); assert.equal(c.H, 72);
  applyConsensusCheck(lp, c, NOW); assert.match(lp.signal, /✓ consensus holds 1×/);
  c = consensusCheck(lp, game({ total: { line: 8, over: { bets: 64, handle: 52 }, under: { bets: 36, handle: 48 } } }), NOW); assert.equal(c.why, 'faded');
  applyConsensusCheck(lp, c, NOW); assert.match(lp.signal, /⚠ consensus faded/); assert.doesNotMatch(lp.signal, /holds/);
  c = consensusCheck(lp, game({ total: { line: 8, over: { bets: 40, handle: 30 }, under: { bets: 60, handle: 70 } } }), NOW); assert.equal(c.why, 'flipped'); assert.equal(c.crowd, 'Under 8');
});

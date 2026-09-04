// Golden tests for the frozen formula — run with: node --test test/
// Every historical mistake is pinned here so it can never recur silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalMarket, evalGame, withinWindow, keyNumberNote } from '../lib/formula.mjs';

test('qualifies and picks opposite side (basic fade)', () => {
  const r = evalMarket('MLB', {
    a: { name: 'Over 7', bets: 65, handle: 4 },
    b: { name: 'Under 7', bets: 35, handle: 96 },
  });
  assert.equal(r.pick, 'Under 7');
  assert.equal(r.T, 65); assert.equal(r.H, 4); assert.equal(r.D, 61);
  // 96% handle >= artifact threshold? 96 < 98 → no artifact downgrade; D=61 → play
  assert.equal(r.tier, 'play');
});

test('T below 60 never qualifies', () => {
  assert.equal(evalMarket('NFL', { a: { name: 'A', bets: 59, handle: 10 }, b: { name: 'B', bets: 41, handle: 90 } }), null);
});

test('steamroller (money ahead of tickets) never qualifies — the FSU stack bug', () => {
  // tickets 84 / money 95 → D = −11 → NO pick, ever
  assert.equal(evalMarket('CFB', { a: { name: 'SMU -3', bets: 84, handle: 95 }, b: { name: 'FSU +3', bets: 16, handle: 5 } }), null);
});

test('D between 8 and 15 is watch; 15-25 lean; >=25 play', () => {
  const w = evalMarket('NFL', { a: { name: 'A', bets: 62, handle: 52 }, b: { name: 'B', bets: 38, handle: 48 } });
  assert.equal(w.tier, 'watch');
  const l = evalMarket('NFL', { a: { name: 'A', bets: 70, handle: 50 }, b: { name: 'B', bets: 30, handle: 50 } });
  assert.equal(l.tier, 'lean');
  const p = evalMarket('NFL', { a: { name: 'A', bets: 77, handle: 42 }, b: { name: 'B', bets: 23, handle: 58 } });
  assert.equal(p.tier, 'play');
});

test('college is fair game (Carl 2026-09-04): tier from D like every other sport', () => {
  const r = evalMarket('CFB', { a: { name: 'Oklahoma ST Cowboys', bets: 74, handle: 48, line: '-13.5' }, b: { name: 'Tulsa Golden Hurricane', bets: 26, handle: 52, line: '+13.5' }, spreadMagnitude: 13.5 });
  assert.equal(r.tier, 'play');
  assert.ok(!r.downgraded.includes('college'));
});
test('98/2 read keeps its tier but is flagged (Carl 2026-09-02: post it with an asterisk)', () => {
  const r = evalMarket('MLB', {
    a: { name: 'Over 8.5', bets: 65, handle: 2 },
    b: { name: 'Under 8.5', bets: 35, handle: 98 },
  });
  assert.equal(r.pick, 'Under 8.5');
  assert.equal(r.tier, 'play');      // D = 63 — tier is NOT forced down any more
  assert.equal(r.flag98, true);      // …but it carries the asterisk flag
  const clean = evalMarket('MLB', { a: { name: 'A', bets: 70, handle: 40 }, b: { name: 'B', bets: 30, handle: 60 } });
  assert.equal(clean.flag98, false);
});

test('99/1 tickets: flagged, tier from D, not listed as a downgrade', () => {
  const r = evalMarket('NBA', { a: { name: 'A', bets: 99, handle: 60 }, b: { name: 'B', bets: 1, handle: 40 } });
  assert.equal(r.tier, 'play');
  assert.equal(r.flag98, true);
  assert.ok(!r.downgraded.some(d => /98/.test(d)));
});

test('spread >= 20 downgrades to watch', () => {
  const r = evalMarket('NFL', {
    a: { name: 'Fav -21', bets: 75, handle: 40, line: '-21' },
    b: { name: 'Dog +21', bets: 25, handle: 60, line: '+21' },
    spreadMagnitude: -21,
  });
  assert.equal(r.tier, 'watch');
});

test('windows: every sport 7 days from game day (Carl 2026-09-04; was football 7d / others 96h)', () => {
  const now = new Date('2026-09-02T20:00:00Z');
  assert.equal(withinWindow('NFL', '2026-09-08', now), true);   // 6 days out
  assert.equal(withinWindow('NFL', '2026-09-10', now), false);  // 8 days out
  assert.equal(withinWindow('MLB', '2026-09-04', now), true);
  assert.equal(withinWindow('MLB', '2026-09-08', now), true);   // 6 days out — now inside for every sport
  assert.equal(withinWindow('NHL', '2026-09-10', now), false);  // 8 days out
});
test('MLB/NHL use moneyline; DET/MIN Sep-1 replay produces Under 8.5 play', () => {
  // exact live-board numbers from 2026-09-01: Over 65% bets / 14% handle
  const game = {
    gamecode: '20260901MLB00013', sport: 'MLB', date: '2026-09-01',
    away: 'Detroit Tigers', home: 'Minnesota Twins',
    spread: { line_home: 1.5, away: { handle: 84, bets: 39 }, home: { handle: 16, bets: 61 } },
    total: { line: 8.5, over: { handle: 14, bets: 65 }, under: { handle: 86, bets: 35 } },
    ml: { away_price: -107, home_price: -112, away: { handle: 89, bets: 62 }, home: { handle: 11, bets: 38 } },
  };
  const picks = evalGame(game, new Date('2026-09-01T10:00:00-07:00'));
  const totalPick = picks.find(p => p.type === 'Total');
  assert.ok(totalPick, 'total pick exists');
  assert.equal(totalPick.pick, 'Under 8.5');
  assert.equal(totalPick.D, 51);
  assert.equal(totalPick.tier, 'play');
  // and no spread pick for MLB (ML market only)
  assert.equal(picks.find(p => p.type === 'Spread'), undefined);
});

test('NFL key-number note fires only on 2.5/3.5/6.5/7.5', () => {
  assert.ok(keyNumberNote('NFL', 'Spread', '+2.5'));
  assert.ok(keyNumberNote('NFL', 'Spread', '-7.5'));
  assert.equal(keyNumberNote('NFL', 'Spread', '+4.5'), null);
  assert.equal(keyNumberNote('MLB', 'Spread', '+2.5'), null);
});

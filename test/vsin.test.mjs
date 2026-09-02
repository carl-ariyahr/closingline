// VSiN parser contract tests on REAL saved pages (test/fixtures, captured 2026-09-02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSplits, scrubGame, num } from '../lib/vsin.mjs';

const fx = n => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const NOW = new Date('2026-09-02T19:00:00Z');

test('MLB page: two date sections, each game dated by ITS section (not the first header)', () => {
  const games = parseSplits(fx('vsin-MLB-2026-09-02.html'), 'MLB', NOW);
  const dates = [...new Set(games.map(g => g.date))].sort();
  assert.deepEqual(dates, ['2026-09-02', '2026-09-03']);
  for (const g of games) assert.equal(g.gamecode.slice(0, 8), g.date.replace(/-/g, ''), `${g.away} @ ${g.home}`);
  assert.equal(games.filter(g => g.date === '2026-09-03').length, 5);
});

test('NFL page: one table, games spread over Sep 10–14 (never all stamped Sep 9)', () => {
  const games = parseSplits(fx('vsin-NFL-2026-09-02.html'), 'NFL', NOW);
  assert.equal(games.length, 16);
  const dates = new Set(games.map(g => g.date));
  assert.ok(dates.size >= 3, `expected several dates, got ${[...dates]}`);
  assert.ok(!games.every(g => g.date === '2026-09-09'));
});

test('NFL Saints @ Lions row reads Handle-then-Bets exactly as printed (49.5 · 97% · 65%)', () => {
  const games = parseSplits(fx('vsin-NFL-2026-09-02.html'), 'NFL', NOW);
  const g = games.find(x => /Saints/.test(x.away) && /Lions/.test(x.home));
  assert.ok(g, 'Saints @ Lions present');
  assert.equal(g.spread.line_home, -7);
  assert.deepEqual(g.spread.away, { handle: 20, bets: 28 });
  assert.deepEqual(g.spread.home, { handle: 80, bets: 72 });
  assert.equal(g.total.line, 49.5);
  assert.deepEqual(g.total.over, { handle: 97, bets: 65 });
  assert.deepEqual(g.total.under, { handle: 3, bets: 35 });
  assert.equal(g.ml.away_price, 240);
  assert.equal(g.ml.home_price, -298);
});

test('CFB page: gamecode dates agree with section dates for every game; comma prices parse whole', () => {
  const games = parseSplits(fx('vsin-CFB-2026-09-02.html'), 'CFB', NOW);
  assert.ok(games.length > 80);
  for (const g of games) assert.equal(g.gamecode.slice(0, 8), g.date.replace(/-/g, ''));
  const big = games.filter(g => Math.abs(g.ml.away_price) >= 1000 || Math.abs(g.ml.home_price) >= 1000);
  assert.ok(big.length > 0, 'expected some +1000-style prices on a CFB page');
  assert.equal(num('+2,000'), 2000);
  assert.equal(num('-6,500'), -6500);
  assert.equal(num('▲ -3.5'), -3.5);
});

test('scrubGame blanks an absent market but keeps the game', () => {
  const g = {
    spread: { line_home: 1.5, away: { handle: 0, bets: 0 }, home: { handle: 0, bets: 0 } },
    total: { line: 8.5, over: { handle: 60, bets: 55 }, under: { handle: 40, bets: 45 } },
    ml: { away_price: 120, home_price: -140, away: { handle: 18, bets: 75 }, home: { handle: 82, bets: 25 } },
  };
  const r = scrubGame(g);
  assert.ok(r.usable);
  assert.deepEqual(r.absent, ['spread']);
  assert.equal(r.game.spread.away.bets, null);
  assert.equal(r.game.ml.away.bets, 75);
});

test('scrubGame blanks a bad market (sums off) and reports it; drops game only when nothing survives', () => {
  const g = {
    spread: { line_home: -3, away: { handle: 60, bets: 60 }, home: { handle: 60, bets: 60 } },
    total: { line: 44, over: { handle: 0, bets: 0 }, under: { handle: 0, bets: 0 } },
    ml: { away_price: 140, home_price: -160, away: { handle: 0, bets: 0 }, home: { handle: 0, bets: 0 } },
  };
  const r = scrubGame(g);
  assert.equal(r.usable, false);
  assert.deepEqual(r.bad, ['spread']);
});

test('header contract: Bets before Handle throws', () => {
  const html = `<table><thead><tr><th>MLB - Sep 2</th><th>Spread</th><th>Bets</th><th>Handle</th><th>Total</th><th>Bets</th><th>Handle</th><th>Money</th><th>Bets</th><th>Handle</th></tr></thead><tbody></tbody></table>`;
  assert.throws(() => parseSplits(html, 'MLB', NOW), /header contract/);
});

test('odd row count under a date throws (pairing unsafe)', () => {
  const html = `<table><thead><tr><th><a class="sp-sport-link" href="?gamedate=2026-09-02">MLB</a></th><th>Spread</th><th>Handle</th><th>Bets</th><th>Total</th><th>Handle</th><th>Bets</th><th>Money</th><th>Handle</th><th>Bets</th></tr></thead>
  <tbody><tr><td class="sp-cell-team"><a>Only Team</a></td><td class="sp-col-first">-1.5</td><td>50%</td><td>50%</td><td class="sp-col-first">8</td><td>50%</td><td>50%</td><td class="sp-col-first">-110</td><td>50%</td><td>50%</td></tr></tbody></table>`;
  assert.throws(() => parseSplits(html, 'MLB', NOW), /odd team-row count/);
});

test('off-season page (no splits table) returns [] rather than throwing', () => {
  assert.deepEqual(parseSplits('<html><body><p>No games</p></body></html>', 'NBA', NOW), []);
});

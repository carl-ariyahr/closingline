import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveGame, matchLiveGame, liveSide, liveCheck, applyLiveCheck } from '../lib/liveconfirm.mjs';

const NOW = new Date('2026-09-02T20:20:00Z');
const game = (over, under, mlAway, mlHome) => ({
  gamecode: '20260902MLB00021', sport: 'MLB', date: '2026-09-02', dhIndex: 0,
  away: 'ST Louis Cardinals', home: 'Los Angeles Dodgers',
  spread: { line_home: -1.5, away: { handle: null, bets: null }, home: { handle: null, bets: null } },
  total: { line: 8, over, under },
  ml: { away_price: 203, home_price: -240, away: mlAway, home: mlHome },
});
const GAMES = [
  game({ handle: 84, bets: 71 }, { handle: 16, bets: 29 }, { handle: 40, bets: 20 }, { handle: 60, bets: 80 }),
  { gamecode: '20260902MLB00001', sport: 'MLB', date: '2026-09-02', away: 'Athletics', home: 'Texas Rangers',
    spread: { line_home: -1.5, away: {}, home: {} }, total: { line: 8, over: { handle: 27, bets: 77 }, under: { handle: 73, bets: 23 } },
    ml: { away_price: 150, home_price: -175, away: { handle: 46, bets: 20 }, home: { handle: 54, bets: 80 } } },
];

test('parseLiveGame reads "ABBR Nick @ ABBR Nick — Mon D (SPORT)"', () => {
  assert.deepEqual(parseLiveGame('STL Cardinals @ LA Dodgers — Sep 2 (MLB)', NOW), { away: 'STL Cardinals', home: 'LA Dodgers', date: '2026-09-02', sport: 'MLB' });
});

test('matchLiveGame maps abbreviated live names onto VSiN full names, either orientation', () => {
  const lp = { type: 'Moneyline', pick: 'STL Cardinals ML +203', game: 'STL Cardinals @ LA Dodgers — Sep 2 (MLB)' };
  assert.equal(matchLiveGame(GAMES, lp)?.gamecode, '20260902MLB00021');
  const swapped = { ...lp, game: 'LA Dodgers @ STL Cardinals — Sep 2 (MLB)' };
  assert.equal(matchLiveGame(GAMES, swapped)?.gamecode, '20260902MLB00021');
  assert.equal(matchLiveGame(GAMES, { ...lp, game: 'NYM Mets @ TB Rays — Sep 2 (MLB)' }), null);
});

test('college board names: "ST" and shared mascots never match the wrong game', () => {
  const mk = (code, away, home) => ({ gamecode: code, sport: 'CFB', date: '2026-09-05', away, home,
    spread: { line_home: -30, away: {}, home: {} }, total: { line: 55.5, over: { handle: 3, bets: 72 }, under: { handle: 97, bets: 28 } }, ml: { away: {}, home: {} } });
  const cfb = [
    mk('20260905CFB00165', 'Nicholls ST', 'Kansas ST Wildcats'),
    mk('20260905CFB00194', 'S Dakota ST', 'Northwestern Wildcats'),
    mk('20260905CFB00155', 'Tennessee ST', 'Georgia Bulldogs'),
  ];
  assert.equal(matchLiveGame(cfb, { type: 'Total', pick: 'Over 55.5', game: 'Nicholls ST @ Kansas ST Wildcats — Sep 5 (CFB)' })?.gamecode, '20260905CFB00165');
  assert.equal(matchLiveGame(cfb, { type: 'Total', pick: 'Over 46.5', game: 'S Dakota ST @ Northwestern Wildcats — Sep 5 (CFB)' })?.gamecode, '20260905CFB00194');
  assert.equal(matchLiveGame(cfb, { type: 'Total', pick: 'Over 56.5', game: 'Tennessee ST @ Georgia Bulldogs — Sep 5 (CFB)' })?.gamecode, '20260905CFB00155');
  assert.equal(matchLiveGame(cfb, { type: 'Total', pick: 'Over 50', game: 'Murray ST @ Kansas ST Wildcats — Sep 5 (CFB)' }), null);
});

test('liveSide: team picks resolve to away/home, totals to over/under', () => {
  const g = GAMES[0];
  assert.equal(liveSide({ type: 'Moneyline', pick: 'STL Cardinals ML +203' }, g), 'away');
  assert.equal(liveSide({ type: 'Moneyline', pick: 'LA Dodgers ML' }, g), 'home');
  assert.equal(liveSide({ type: 'Total', pick: 'Under 8' }, g), 'under');
});

test('liveCheck: still-qualifying pick re-confirms with fresh numbers', () => {
  const chk = liveCheck({ type: 'Moneyline', pick: 'STL Cardinals ML +203' }, GAMES[0], NOW);
  assert.equal(chk.ok, true); assert.equal(chk.T, 80); assert.equal(chk.H, 60); assert.equal(chk.D, 20); assert.equal(chk.tier, 'lean');
});

test('liveCheck: Under 8 with the public on the Over but money AHEAD of tickets = faded (below the bar)', () => {
  const chk = liveCheck({ type: 'Total', pick: 'Under 8' }, GAMES[0], NOW);
  assert.equal(chk.ok, false); assert.equal(chk.why, 'faded'); assert.equal(chk.T, 71); assert.equal(chk.H, 84);
});

test('liveCheck: public now on OUR side = flipped', () => {
  const chk = liveCheck({ type: 'Total', pick: 'Over 8' }, GAMES[1], NOW); // public is 77% on the Over = our side
  assert.equal(chk.ok, false); assert.equal(chk.why, 'flipped');
});

test('applyLiveCheck replaces the pending tag with ONE counter tag and increments across runs', () => {
  const lp = { type: 'Moneyline', pick: 'STL Cardinals ML +203', signal: 'PUBLIC 68% of tickets on LA Dodgers but only 44% of the money — we take STL Cardinals ML +203 · 24 pt gap · ⏳ posted on first read — confirming next snapshot' };
  applyLiveCheck(lp, liveCheck(lp, GAMES[0], NOW), NOW);
  assert.ok(!/⏳/.test(lp.signal));
  assert.match(lp.signal, /✓ code re-confirmed 1×/);
  applyLiveCheck(lp, liveCheck(lp, GAMES[0], new Date(NOW.getTime() + 3600e3)), new Date(NOW.getTime() + 3600e3));
  assert.match(lp.signal, /✓ code re-confirmed 2×/);
  assert.equal((lp.signal.match(/re-confirmed/g) || []).length, 1); // never stacks duplicate tags
  assert.equal(lp.liveCheck.n, 2);
  // a fade resets the counter and swaps the tag
  applyLiveCheck(lp, { ts: NOW.toISOString(), ok: false, why: 'faded', T: 55, H: 50, D: 5 }, NOW);
  assert.match(lp.signal, /⚠ signal faded/);
  assert.ok(!/re-confirmed/.test(lp.signal));
  assert.equal(lp.liveCheck.n, 0);
});

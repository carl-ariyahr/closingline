import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveGame, matchLiveGame, liveCandidates, applyDHTag, liveSide, liveCheck, applyLiveCheck, applyContention, liveGradePick } from '../lib/liveconfirm.mjs';
import { matchGame, gradeAgainst } from '../lib/grade.mjs';

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

test('"BOS Red Sox" / "CWS White Sox" labels match the right VSiN game (nickname "Sox" is shared)', () => {
  const mk = (code, away, home) => ({ gamecode: code, sport: 'MLB', date: '2026-09-04', away, home,
    spread: { away: {}, home: {} }, total: { line: 8.5, over: { handle: 10, bets: 75 }, under: { handle: 90, bets: 25 } }, ml: { away: { handle: 100, bets: 79 }, home: { handle: 0, bets: 21 } } });
  const g = [mk('20260904MLB00005', 'Boston Red Sox', 'Baltimore Orioles'), mk('20260904MLB00008', 'Minnesota Twins', 'Chicago White Sox')];
  assert.equal(matchLiveGame(g, { type: 'Total', pick: 'Under 8.5', game: 'BOS Red Sox @ BAL Orioles — Sep 4 (MLB)' })?.gamecode, '20260904MLB00005');
  assert.equal(matchLiveGame(g, { type: 'Total', pick: 'Over 9', game: 'MIN Twins @ CWS White Sox — Sep 4 (MLB)' })?.gamecode, '20260904MLB00008');
  assert.equal(liveSide({ type: 'Moneyline', pick: 'Baltimore Orioles ML' }, g[0]), 'home');
  assert.equal(liveSide({ type: 'Moneyline', pick: 'BOS Red Sox ML' }, g[0]), 'away');
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

test('live-card picks grade in code from their own text + ESPN finals (pro ABBR names)', () => {
  const g = { away: 'SF Giants', home: 'PIT Pirates', date: '2026-09-03', sport: 'MLB' };
  const events = [{ completed: true, away: 'San Francisco Giants', awayLoc: 'San Francisco', home: 'Pittsburgh Pirates', homeLoc: 'Pittsburgh', awayScore: 3, homeScore: 4, awayQ: [], homeQ: [], date: '2026-09-03T22:40Z' }];
  const under = liveGradePick({ type: 'Total', pick: 'Under 8', game: 'SF Giants @ PIT Pirates — Sep 3 (MLB)' }, g);
  assert.deepEqual([under.side, under.total], ['under', 8]);
  assert.equal(gradeAgainst(matchGame(events, under), under), 'win');     // 7 runs
  const ml = liveGradePick({ type: 'Moneyline', pick: 'San Francisco Giants ML', game: 'SF Giants @ PIT Pirates — Sep 3 (MLB)' }, g);
  assert.equal(ml.side, 'away');
  assert.equal(gradeAgainst(matchGame(events, ml), ml), 'loss');
  const sp = liveGradePick({ type: 'Spread', pick: 'Murray ST +20.5', game: 'Murray ST @ Middle Tenn ST Blue Raiders — Sep 5 (CFB)' }, { away: 'Murray ST', home: 'Middle Tenn ST Blue Raiders', date: '2026-09-05', sport: 'CFB' });
  assert.deepEqual([sp.side, sp.line], ['away', '+20.5']);
  assert.equal(liveGradePick({ type: 'Moneyline', pick: 'Somebody Else ML', game: 'SF Giants @ PIT Pirates — Sep 3 (MLB)' }, g), null); // never guess a side
});

test('applyContention keeps exactly one contention tag, replaces the AI wording, and clears when gone', () => {
  const lp = { pick: 'Under 9.5', signal: 'PUBLIC 66% of tickets on Over 9.5 but only 44% of the money · ⚾ CONTENTION: KC out of the race — call-ups · ✓ code re-confirmed 3× on the live board (last 7:14am)' };
  const note = '⚾ CONTENTION: Kansas City Royals (playoff odds 0.0%) out of the playoff race — late-season lineups make public signals less reliable';
  assert.equal(applyContention(lp, note), true);
  assert.equal((lp.signal.match(/⚾ CONTENTION/g) || []).length, 1);
  assert.match(lp.signal, /Kansas City Royals \(playoff odds 0\.0%\)/);
  assert.match(lp.signal, /✓ code re-confirmed 3×/); // other tags untouched
  assert.equal(lp.contention, note);
  assert.equal(applyContention(lp, note), false); // idempotent
  applyLiveCheck(lp, { ts: NOW.toISOString(), ok: true, T: 66, H: 44, D: 22, tier: 'play' }, NOW);
  assert.equal((lp.signal.match(/⚾ CONTENTION/g) || []).length, 1); // the confirm pass never duplicates or drops it
  assert.equal(applyContention(lp, null), true);
  assert.ok(!/CONTENTION/.test(lp.signal)); assert.equal(lp.contention, null);
});

test('doubleheader: a Total resolves by its line, a team pick without a game number is left unresolved (never guessed)', () => {
  const mk = (code, dh, line) => ({ gamecode: code, sport: 'MLB', date: '2026-09-04', dhIndex: dh, away: 'Detroit Tigers', home: 'Cleveland Guardians',
    spread: { away: {}, home: {} }, total: { line, over: { handle: 68, bets: 65 }, under: { handle: 32, bets: 35 } }, ml: { away: { handle: 58, bets: 38 }, home: { handle: 42, bets: 62 } } });
  const games = [mk('20260904MLB00007', 0, 8.5), mk('20260904MLB000072', 1, 8)];
  const under8 = { type: 'Total', pick: 'Under 8', game: 'DET Tigers @ CLE Guardians — Sep 4 (MLB)' };
  assert.equal(liveCandidates(games, under8).length, 2);
  assert.equal(matchLiveGame(games, under8)?.dhIndex, 1);
  const ml = { type: 'Moneyline', pick: 'Detroit Tigers ML', game: 'DET Tigers @ CLE Guardians — Sep 4 (MLB)', signal: 'x' };
  assert.equal(matchLiveGame(games, ml), null);
  assert.equal(matchLiveGame(games, { ...ml, dhIndex: 1 })?.gamecode, '20260904MLB000072');
  assert.equal(applyDHTag(ml, true), true); assert.match(ml.signal, /DOUBLEHEADER/);
  assert.equal(applyDHTag(ml, true), false); assert.equal((ml.signal.match(/DOUBLEHEADER/g) || []).length, 1);
  assert.equal(applyDHTag(ml, false), true); assert.equal(ml.signal, 'x');
  assert.equal(liveGradePick(ml, { away: 'DET Tigers', home: 'CLE Guardians', date: '2026-09-04', sport: 'MLB' }).dhIndex, null);
});

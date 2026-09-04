import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeAgainst, matchGame } from '../lib/grade.mjs';
import { evalGame } from '../lib/formula.mjs';

const ev = (away, home, as, hs, extra = {}) => ({ completed: true, away, home, awayScore: as, homeScore: hs, awayQ: [], homeQ: [], date: '2026-09-02T23:00Z', ...extra });

test('spread graded from the line FIELD, never from digits in the team name (49ers)', () => {
  const p = { type: 'Spread', sport: 'NFL', pick: 'San Francisco 49ers', side: 'away', line: '+3.5', away: 'San Francisco 49ers', home: 'Los Angeles Rams' };
  assert.equal(gradeAgainst(ev('San Francisco 49ers', 'Los Angeles Rams', 20, 27), p), 'loss'); // lost by 7, +3.5 doesn't cover
  assert.equal(gradeAgainst(ev('San Francisco 49ers', 'Los Angeles Rams', 24, 27), p), 'win');  // lost by 3, covers
  assert.equal(gradeAgainst(ev('San Francisco 49ers', 'Los Angeles Rams', 24, 27), { ...p, line: null }), null); // no line => no guess
});

test('moneyline uses the explicit side — Yankees @ Mets is not confused by the shared city', () => {
  const p = { type: 'Moneyline', sport: 'MLB', pick: 'New York Yankees ML', side: 'away', away: 'New York Yankees', home: 'New York Mets' };
  assert.equal(gradeAgainst(ev('New York Yankees', 'New York Mets', 2, 5), p), 'loss');
  assert.equal(gradeAgainst(ev('New York Yankees', 'New York Mets', 6, 5), p), 'win');
});

test('White Sox @ Red Sox: side from pickTeam full-name match when side field missing', () => {
  const p = { type: 'Moneyline', sport: 'MLB', pick: 'Chicago White Sox ML', pickTeam: 'Chicago White Sox', away: 'Chicago White Sox', home: 'Boston Red Sox' };
  assert.equal(gradeAgainst(ev('Chicago White Sox', 'Boston Red Sox', 1, 4), p), 'loss');
});

test('totals: push on the number, side from field', () => {
  const p = { type: 'Total', sport: 'MLB', pick: 'Under 8.5', side: 'under', total: 8.5 };
  assert.equal(gradeAgainst(ev('A', 'B', 4, 4), p), 'win');
  assert.equal(gradeAgainst(ev('A', 'B', 5, 4), p), 'loss');
  assert.equal(gradeAgainst(ev('A', 'B', 4, 4), { ...p, total: 8 }), 'push');
});

test('first-half / F5 use the right number of periods per sport', () => {
  const nfl = { type: 'Spread', sport: 'NFL', pick: 'Seattle Seahawks 1H', side: 'home', line: '-1', away: 'A', home: 'Seattle Seahawks' };
  assert.equal(gradeAgainst(ev('A', 'Seattle Seahawks', 30, 20, { awayQ: [7, 7, 10, 6], homeQ: [10, 7, 0, 3] }), nfl), 'win'); // 1H 17-14
  const mlb = { type: 'Moneyline', sport: 'MLB', pick: 'Athletics F5', side: 'away', away: 'Athletics', home: 'Texas Rangers' };
  assert.equal(gradeAgainst(ev('Athletics', 'Texas Rangers', 3, 9, { awayQ: [1, 0, 1, 0, 1, 0, 0, 0, 0], homeQ: [0, 0, 1, 0, 0, 3, 5, 0, 0] }), mlb), 'win'); // F5 3-1
});

test('matchGame: full names, "ST" expands to State, ambiguous => null, doubleheader by dhIndex', () => {
  const events = [
    { away: 'Youngstown State Penguins', awayLoc: 'Youngstown State', home: 'Kentucky Wildcats', homeLoc: 'Kentucky', date: '2026-09-05T20:00Z' },
    { away: 'Nicholls Colonels', awayLoc: 'Nicholls', home: 'Kansas State Wildcats', homeLoc: 'Kansas State', date: '2026-09-05T23:00Z' },
  ];
  assert.equal(matchGame(events, { away: 'Nicholls ST', home: 'Kansas ST' })?.home, 'Kansas State Wildcats');
  assert.equal(matchGame(events, { away: 'Idaho ST', home: 'Utah ST' }), null);
  const dh = [
    { away: 'Chicago Cubs', home: 'Milwaukee Brewers', date: '2026-09-02T17:00Z', awayScore: 1 },
    { away: 'Chicago Cubs', home: 'Milwaukee Brewers', date: '2026-09-02T23:00Z', awayScore: 2 },
  ];
  assert.equal(matchGame(dh, { away: 'Chicago Cubs', home: 'Milwaukee Brewers', dhIndex: 1 }).awayScore, 2);
  assert.equal(matchGame(dh, { away: 'Chicago Cubs', home: 'Milwaukee Brewers', dhIndex: 0 }).awayScore, 1);
});

test('evalGame emits explicit side + pickTeam, and grading round-trips from it', () => {
  const game = {
    gamecode: '20260902MLB00001', sport: 'MLB', date: '2026-09-02', away: 'Athletics', home: 'Texas Rangers',
    spread: { line_home: -1.5, away: { handle: null, bets: null }, home: { handle: null, bets: null } },
    total: { line: 8, over: { handle: 27, bets: 77 }, under: { handle: 73, bets: 23 } },
    ml: { away_price: 150, home_price: -175, away: { handle: 46, bets: 20 }, home: { handle: 54, bets: 80 } },
  };
  const picks = evalGame(game, new Date('2026-09-02T18:00:00Z'));
  const ml = picks.find(p => p.type === 'Moneyline'), tot = picks.find(p => p.type === 'Total');
  assert.equal(ml.side, 'away'); assert.equal(ml.pickTeam, 'Athletics'); assert.equal(ml.tier, 'play');
  assert.equal(tot.side, 'under'); assert.equal(tot.total, 8); assert.equal(tot.tier, 'play');
  assert.equal(gradeAgainst(ev('Athletics', 'Texas Rangers', 5, 2), ml), 'win');
  assert.equal(gradeAgainst(ev('Athletics', 'Texas Rangers', 5, 2), tot), 'win');
});

test('live-card "BOS Red Sox" grades against ESPN Boston Red Sox, never the White Sox', () => {
  const events = [
    { completed: true, away: 'Boston Red Sox', awayLoc: 'Boston', home: 'Baltimore Orioles', homeLoc: 'Baltimore', awayScore: 2, homeScore: 5, awayQ: [], homeQ: [], date: '2026-09-04T23:05Z' },
    { completed: true, away: 'Minnesota Twins', awayLoc: 'Minnesota', home: 'Chicago White Sox', homeLoc: 'Chicago', awayScore: 6, homeScore: 4, awayQ: [], homeQ: [], date: '2026-09-04T23:40Z' },
  ];
  const p = { type: 'Moneyline', pick: 'Baltimore Orioles ML', sport: 'MLB', date: '2026-09-04', away: 'BOS Red Sox', home: 'BAL Orioles', side: 'home' };
  assert.equal(gradeAgainst(matchGame(events, p), p), 'win');
  const t = { type: 'Total', pick: 'Over 9', sport: 'MLB', date: '2026-09-04', away: 'MIN Twins', home: 'CWS White Sox', side: 'over', total: 9 };
  assert.equal(gradeAgainst(matchGame(events, t), t), 'win');
});

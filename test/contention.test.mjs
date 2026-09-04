import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStandings } from '../lib/contention.mjs';

const entry = (name, w, l, gp = w + l) => ({ team: { displayName: name }, stats: [{ name: 'wins', value: w }, { name: 'losses', value: l }, { name: 'gamesPlayed', value: gp }] });
const div = (name, teams) => ({ name, standings: { entries: teams } });
// one league, three divisions, 162-game season with ~21 games left
const NL = { children: [{ name: 'National League', children: [
  div('East', [entry('Phillies', 88, 53), entry('Mets', 78, 63), entry('Braves', 76, 65), entry('Marlins', 71, 70), entry('Nationals', 60, 82)]),
  div('Central', [entry('Cubs', 85, 56), entry('Brewers', 84, 57), entry('Reds', 67, 73), entry('Cardinals', 70, 71), entry('Pirates', 69, 72)]),
  div('West', [entry('Dodgers', 90, 51), entry('Padres', 80, 61), entry('Giants', 66, 75), entry('Diamondbacks', 72, 69), entry('Rockies', 54, 86)]),
] }] };

test('MLB: only a team that cannot catch its division leader OR the 3rd wild card is out', () => {
  const r = Object.fromEntries(evaluateStandings('MLB', NL).map(t => [t.name, t]));
  // wild cards: non-leaders sorted by wins → Brewers 84, Padres 80, Mets 78 → WC3 = 78
  assert.equal(r.Rockies.out, true);      // 54 + 22 = 76 < 90 (div) and < 78 (WC3)
  assert.match(r.Rockies.why, /mathematically eliminated: 54-86 with 22 left/);
  assert.equal(r.Nationals.out, false);   // 60 + 20 = 80 ≥ 78 → still alive for the wild card
  assert.equal(r.Giants.out, false);      // 66 + 21 = 87
  assert.equal(r.Reds.out, false);        // 67 + 22 = 89
  assert.equal(r.Dodgers.out, false);
});

test('WNBA: out when it cannot reach the 8th-best team overall', () => {
  const W = { children: [
    { name: 'East', children: [div('East', [entry('Dream', 28, 12), entry('Liberty', 26, 14), entry('Fever', 22, 18), entry('Mystics', 20, 20), entry('Sun', 8, 32), entry('Sky', 10, 30)])] },
    { name: 'West', children: [div('West', [entry('Lynx', 30, 10), entry('Aces', 27, 13), entry('Storm', 23, 17), entry('Mercury', 21, 19), entry('Valkyries', 19, 21), entry('Sparks', 17, 23), entry('Wings', 9, 31)])] },
  ] };
  const r = Object.fromEntries(evaluateStandings('WNBA', W).map(t => [t.name, t]));
  // 8th best among others: 19 (Valkyries) for most; Sun 8+4=12 < 19 → out; Sparks 17+4=21 ≥ 8th-best-of-others(19... excluding self → Mystics 20) → alive
  assert.equal(r.Sun.out, true); assert.equal(r.Wings.out, true); assert.equal(r.Sky.out, true);
  assert.equal(r.Sparks.out, false); assert.equal(r.Valkyries.out, false);
});

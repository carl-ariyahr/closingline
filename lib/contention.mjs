// Playoff-contention check in code, from ESPN standings.
// A team is OUT when its playoff odds are ~zero (effectively eliminated), or it is not a top-6
// seed AND its wild-card odds are negligible. Only evaluated once the season is far enough along
// (early-season odds are noise). Display only — never changes the formula.
// NFL: ESPN publishes no playoff percentage in standings, so forTeam() returns null (unknown).
import { normName, sameTeam } from './names.mjs';

const STANDINGS = {
  MLB: 'baseball/mlb', NBA: 'basketball/nba', NHL: 'hockey/nhl', WNBA: 'basketball/wnba',
  NFL: 'football/nfl',
};
// minimum games played before we trust elimination odds
const MIN_GP = { MLB: 100, NBA: 50, NHL: 50, WNBA: 25, NFL: 10 };

function stat(entry, name) {
  const s = (entry.stats || []).find(x => x.name === name);
  return s ? Number(s.value) : null;
}

export async function loadContention(sport) {
  const path = STANDINGS[sport];
  if (!path) return null;
  const res = await fetch(`https://site.api.espn.com/apis/v2/sports/${path}/standings`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`standings ${sport}: HTTP ${res.status}`);
  const d = await res.json();
  const teams = []; // [{name, norm, out, why, ...}]
  for (const g of d.children || []) {
    for (const e of (g.standings?.entries || [])) {
      const name = e.team?.displayName;
      const seed = stat(e, 'playoffSeed');
      const playoffPct = stat(e, 'playoffPercent');
      const wcPct = stat(e, 'wildCardPercent');
      const gp = stat(e, 'gamesPlayed');
      let out = false, why = '';
      const lateEnough = gp == null || gp >= (MIN_GP[sport] ?? 0);
      if (lateEnough && playoffPct != null) {
        if (playoffPct < 2) { out = true; why = `playoff odds ${playoffPct.toFixed(1)}%`; }
      } else if (lateEnough && seed != null && wcPct != null) {
        if (seed >= 7 && wcPct < 5) { out = true; why = `seed ${seed}, WC odds ${wcPct.toFixed(1)}%`; }
      }
      teams.push({ name, norm: normName(name), out, why, seed, playoffPct, wcPct, gp });
    }
  }
  return {
    // null (unknown) | {out, why}. Full-name match; ambiguous => null.
    forTeam(name) {
      const c = teams.filter(t => sameTeam(t.name, name));
      if (c.length !== 1) return null;
      return { out: c[0].out, why: c[0].why };
    },
    raw: teams,
  };
}

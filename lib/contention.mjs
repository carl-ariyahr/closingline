// Playoff-contention check in code, from ESPN standings (division level).
// Carl 2026-09-04: "only teams that are 100% not in contention" — a team is OUT only when it is MATHEMATICALLY
// eliminated: even winning every remaining game it cannot reach the current win total of every team that holds a
// playoff spot it could take. Odds-based ("<0.1%") is NOT enough. Display only — never changes the formula.
// NFL: no elimination math here (17-game season, tiebreak-heavy) → forTeam() returns null (unknown).
import { normName, sameTeam } from './names.mjs';

const STANDINGS = { MLB: 'baseball/mlb', NBA: 'basketball/nba', NHL: 'hockey/nhl', WNBA: 'basketball/wnba' };
const SEASON = { MLB: 162, NBA: 82, NHL: 82, WNBA: 44 };

const stat = (e, name) => { const s = (e.stats || []).find(x => x.name === name); return s ? Number(s.value) : null; };
const nthBest = (arr, n) => arr.slice().sort((a, b) => b - a)[n - 1] ?? -Infinity; // n-th highest, -Inf when fewer

// tree: ESPN standings with level=3 → conferences/leagues → divisions → entries. Returns [{name, out, why, ...}].
export function evaluateStandings(sport, tree) {
  const games = SEASON[sport];
  const out = [];
  const confs = (tree.children || []).map(c => ({
    name: c.name,
    divisions: (c.children || []).map(d => ({
      name: d.name,
      teams: (d.standings?.entries || []).map(e => {
        const w = stat(e, 'wins'), l = stat(e, 'losses'), gp = stat(e, 'gamesPlayed') ?? (w != null && l != null ? w + l + (stat(e, 'OTLosses') || 0) + (stat(e, 'ties') || 0) : null);
        const pts = stat(e, 'points');
        return { name: e.team?.displayName, w, l, gp, pts, rem: gp != null && games ? Math.max(0, games - gp) : null };
      }),
    })),
  }));
  // "max reachable" = wins (or points) if the team wins every remaining game
  const reachW = t => t.w + t.rem, reachP = t => (t.pts ?? 0) + 2 * t.rem;
  for (const conf of confs) {
    const confTeams = conf.divisions.flatMap(d => d.teams);
    for (const div of conf.divisions) {
      for (const t of div.teams) {
        let outNow = false, why = '';
        if (t.w == null || t.rem == null) { out.push({ ...t, out: false, why: '' }); continue; }
        const others = div.teams.filter(x => x !== t);
        if (sport === 'MLB') {
          // 3 division winners + 3 wild cards per league
          const divOut = reachW(t) < Math.max(...others.map(x => x.w));
          const leaders = new Set(conf.divisions.map(d => d.teams.reduce((m, x) => (x.w > (m?.w ?? -1) ? x : m), null)));
          const nonLeaders = confTeams.filter(x => !leaders.has(x) && x !== t);
          const wcOut = reachW(t) < nthBest(nonLeaders.map(x => x.w), 3);
          outNow = divOut && wcOut;
        } else if (sport === 'NBA') {
          outNow = reachW(t) < nthBest(confTeams.filter(x => x !== t).map(x => x.w), 10); // play-in: top 10 per conference
        } else if (sport === 'NHL') {
          const divOut = reachP(t) < nthBest(others.map(x => x.pts ?? 0), 3);            // top 3 per division
          const top3 = new Set(conf.divisions.flatMap(d => d.teams.slice().sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0)).slice(0, 3)));
          const wcOut = reachP(t) < nthBest(confTeams.filter(x => !top3.has(x) && x !== t).map(x => x.pts ?? 0), 2); // 2 wild cards
          outNow = divOut && wcOut;
        } else if (sport === 'WNBA') {
          const all = confs.flatMap(c => c.divisions.flatMap(d => d.teams)).filter(x => x !== t);
          outNow = reachW(t) < nthBest(all.map(x => x.w), 8); // top 8 overall
        }
        if (outNow) why = `mathematically eliminated: ${t.w}-${t.l} with ${t.rem} left`;
        out.push({ ...t, out: outNow, why });
      }
    }
  }
  return out;
}

export async function loadContention(sport) {
  const path = STANDINGS[sport];
  if (!path) return null;
  const res = await fetch(`https://site.api.espn.com/apis/v2/sports/${path}/standings?level=3`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`standings ${sport}: HTTP ${res.status}`);
  const teams = evaluateStandings(sport, await res.json()).map(t => ({ ...t, norm: normName(t.name) }));
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

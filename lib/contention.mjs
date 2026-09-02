// Playoff-contention check in code, from ESPN standings.
// A team is OUT when its combined playoff odds are ~zero (effectively eliminated)
// or it is not a top-6 seed AND its wild-card odds are negligible.
// Used to flag MLB (and later NBA/NHL late-season) picks — display only, never changes the formula.

const STANDINGS = {
  MLB: 'baseball/mlb', NBA: 'basketball/nba', NHL: 'hockey/nhl', WNBA: 'basketball/wnba',
};

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
function lastWord(s) { const w = String(s || '').trim().split(/\s+/); return norm(w[w.length - 1]); }
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
  const teams = {}; // normname -> {out:boolean, why:string}
  const groups = d.children || [];
  for (const g of groups) {
    for (const e of (g.standings?.entries || [])) {
      const name = e.team?.displayName;
      const seed = stat(e, 'playoffSeed');
      const playoffPct = stat(e, 'playoffPercent');   // 0-100
      const wcPct = stat(e, 'wildCardPercent');       // 0-100
      let out = false, why = '';
      if (playoffPct != null) {
        if (playoffPct < 2) { out = true; why = `playoff odds ${playoffPct?.toFixed?.(1) ?? playoffPct}%`; }
      } else if (seed != null && wcPct != null) {
        if (seed >= 7 && wcPct < 5) { out = true; why = `seed ${seed}, WC odds ${wcPct.toFixed(1)}%`; }
      }
      teams[lastWord(name)] = { name, out, why, seed, playoffPct, wcPct };
    }
  }
  return {
    // returns null (unknown) | {out, why} for a team name
    forTeam(name) {
      const t = teams[lastWord(name)];
      return t ? { out: t.out, why: t.why } : null;
    },
    raw: teams,
  };
}

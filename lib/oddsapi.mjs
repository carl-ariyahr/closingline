// The Odds API integration (licensed structured feed).
// Purpose in the pipeline, all as CODE:
//   1. SHARP-vs-SOFT read: compare Pinnacle (sharp, EU region) to the retail public books
//      (DraftKings/FanDuel, us region). When they diverge, that gap is sharp money —
//      an independent second signal alongside VSiN tickets/handle.
//   2. Real first-half lines (spreads_h1 / totals_h1) to replace the road/home-dog 1H proxies.
//   3. A second independent source of the game line (cross-check vs VSiN).
// Key lives in env ODDS_API_KEY. Credits are metered (x-requests-remaining); we keep calls minimal.

const BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = {
  NFL: 'americanfootball_nfl', CFB: 'americanfootball_ncaaf', NBA: 'basketball_nba',
  CBB: 'basketball_ncaab', WNBA: 'basketball_wnba', MLB: 'baseball_mlb', NHL: 'icehockey_nhl',
};
const RETAIL = new Set(['draftkings', 'fanduel', 'betmgm', 'espnbet', 'williamhill_us', 'caesars']);
const SHARP = new Set(['pinnacle']);

function median(xs) {
  const a = xs.filter(v => v != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
// American odds -> implied prob (no-vig not needed for a divergence signal)
function impliedProb(american) {
  if (american == null) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

async function getOdds(sportKey, { regions, markets }) {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error('ODDS_API_KEY not set');
  const url = `${BASE}/sports/${sportKey}/odds/?apiKey=${key}&regions=${regions}&markets=${markets}&oddsFormat=american`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const remaining = res.headers.get('x-requests-remaining');
  if (!res.ok) throw new Error(`oddsapi ${sportKey} ${markets}: HTTP ${res.status}`);
  const data = await res.json();
  return { data, remaining: remaining == null ? null : Number(remaining) };
}

// Normalize a team name for fuzzy matching between VSiN and Odds API.
export function normTeam(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '')
    .replace(/^the/, '');
}
function lastWord(name) { const w = String(name || '').trim().split(/\s+/); return normTeam(w[w.length - 1]); }

// Match a VSiN game {away,home} to an Odds API event by nickname overlap.
function matchEvent(events, away, home) {
  const a = lastWord(away), h = lastWord(home);
  return events.find(e => {
    const ea = lastWord(e.away_team), eh = lastWord(e.home_team);
    return (ea === a && eh === h);
  }) || events.find(e => {
    const na = normTeam(e.away_team), nh = normTeam(e.home_team);
    return na.includes(a.slice(0, 5)) && nh.includes(h.slice(0, 5));
  });
}

// For one sport, fetch retail(us,us2)+sharp(eu) moneyline/total and 1H markets,
// return a matcher keyed by our game. Returns { forGame(away,home) -> {sharp, retail, h1}, remaining, note }.
export async function loadSharpBoard(sport) {
  const sportKey = SPORT_KEY[sport];
  if (!sportKey) return { forGame: () => null, remaining: null, note: 'unsupported sport' };
  let remaining = null;
  // Main markets across retail + sharp regions in one call (regions can be comma-joined; costs 1 credit per region per market).
  const main = await getOdds(sportKey, { regions: 'us,eu', markets: 'h2h,totals' });
  remaining = main.remaining;
  // First-half markets are a separate market set; not all sports/books carry them.
  let h1events = [];
  try {
    const h1 = await getOdds(sportKey, { regions: 'us', markets: 'spreads_h1,totals_h1' });
    h1events = h1.data; remaining = h1.remaining ?? remaining;
  } catch { /* many books/sports lack 1H; non-fatal */ }

  return {
    remaining,
    note: `oddsapi ${sport}: ${main.data.length} events`,
    forGame(away, home) {
      const ev = matchEvent(main.data, away, home);
      if (!ev) return null;
      const out = { away_team: ev.away_team, home_team: ev.home_team, sharp: {}, retail: {}, h1: {} };
      const priceProbs = { away: { sharp: [], retail: [] }, home: { sharp: [], retail: [] } };
      const totalPts = { sharp: [], retail: [] };
      for (const bk of ev.bookmakers || []) {
        const tier = SHARP.has(bk.key) ? 'sharp' : RETAIL.has(bk.key) ? 'retail' : null;
        if (!tier) continue;
        for (const mk of bk.markets || []) {
          if (mk.key === 'h2h') {
            for (const o of mk.outcomes) {
              const side = normTeam(o.name) === normTeam(ev.home_team) ? 'home' : 'away';
              priceProbs[side][tier].push(impliedProb(o.price));
            }
          } else if (mk.key === 'totals') {
            const over = mk.outcomes.find(o => /over/i.test(o.name));
            if (over) totalPts[tier].push(over.point);
          }
        }
      }
      out.sharp = {
        away_prob: median(priceProbs.away.sharp), home_prob: median(priceProbs.home.sharp),
        total: median(totalPts.sharp),
      };
      out.retail = {
        away_prob: median(priceProbs.away.retail), home_prob: median(priceProbs.home.retail),
        total: median(totalPts.retail),
      };
      // sharp-vs-soft divergence: positive = sharp gives the side a higher win prob than retail does
      if (out.sharp.home_prob != null && out.retail.home_prob != null) {
        out.homeSharpEdge = +((out.sharp.home_prob - out.retail.home_prob) * 100).toFixed(1);
        out.awaySharpEdge = +((out.sharp.away_prob - out.retail.away_prob) * 100).toFixed(1);
      }
      if (out.sharp.total != null && out.retail.total != null) {
        out.totalSharpDelta = +(out.sharp.total - out.retail.total).toFixed(1); // sharp total minus retail total
      }
      // first half
      const h1ev = matchEvent(h1events, away, home);
      if (h1ev) {
        for (const bk of h1ev.bookmakers || []) {
          for (const mk of bk.markets || []) {
            if (mk.key === 'spreads_h1' && !out.h1.spread_home) {
              const hs = mk.outcomes.find(o => normTeam(o.name) === normTeam(ev.home_team));
              if (hs) out.h1.spread_home = hs.point;
            }
            if (mk.key === 'totals_h1' && !out.h1.total) {
              const ov = mk.outcomes.find(o => /over/i.test(o.name));
              if (ov) out.h1.total = ov.point;
            }
          }
        }
      }
      return out;
    },
  };
}

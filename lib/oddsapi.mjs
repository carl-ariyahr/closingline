// The Odds API integration (licensed structured feed).
// Purpose in the pipeline, all as CODE — ANNOTATION ONLY, never changes a pick:
//   1. SHARP-vs-SOFT read: Pinnacle (sharp, EU region) vs the retail public books (us region),
//      compared on NO-VIG probabilities so the book's margin can't masquerade as a lean.
//   2. A second independent source of the game line.
// First-half markets are NOT on the bulk /odds endpoint (it returns 422) — they need per-event
// calls; left out until the 1H angles graduate from shadow.
// Key lives in env ODDS_API_KEY. Credits are metered; boards are loaded lazily by the pipeline.
import { matchPair } from './names.mjs';

const BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = {
  NFL: 'americanfootball_nfl', CFB: 'americanfootball_ncaaf', NBA: 'basketball_nba',
  CBB: 'basketball_ncaab', WNBA: 'basketball_wnba', MLB: 'baseball_mlb', NHL: 'icehockey_nhl',
};
const RETAIL = new Set(['draftkings', 'fanduel', 'betmgm', 'espnbet', 'williamhill_us', 'caesars']);
const SHARP = new Set(['pinnacle']);

function median(xs) {
  const a = xs.filter(v => v != null && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function impliedProb(american) {
  if (american == null) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}
function ptDate(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
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

// Match our game to ONE event: same Pacific date (series games are otherwise identical), full-name teams.
export function matchEvent(events, away, home, dateISO) {
  const pool = dateISO ? events.filter(e => ptDate(e.commence_time) === dateISO) : events;
  const c = matchPair(pool, away, home, e => e.away_team, e => e.home_team);
  return c.length === 1 ? c[0] : null;
}

// For one sport, fetch retail(us)+sharp(eu) moneyline/total once; return a matcher keyed by our game.
export async function loadSharpBoard(sport) {
  const sportKey = SPORT_KEY[sport];
  if (!sportKey) return { forGame: () => null, remaining: null, note: 'unsupported sport' };
  const main = await getOdds(sportKey, { regions: 'us,eu', markets: 'h2h,totals' });
  return {
    remaining: main.remaining,
    note: `oddsapi ${sport}: ${main.data.length} events`,
    forGame(away, home, dateISO) {
      const ev = matchEvent(main.data, away, home, dateISO);
      if (!ev) return null;
      const out = { away_team: ev.away_team, home_team: ev.home_team, sharp: {}, retail: {}, books: { sharp: 0, retail: 0 } };
      const probs = { away: { sharp: [], retail: [] }, home: { sharp: [], retail: [] } };
      const totalPts = { sharp: [], retail: [] };
      for (const bk of ev.bookmakers || []) {
        const tier = SHARP.has(bk.key) ? 'sharp' : RETAIL.has(bk.key) ? 'retail' : null;
        if (!tier) continue;
        out.books[tier]++;
        for (const mk of bk.markets || []) {
          if (mk.key === 'h2h') {
            const home = mk.outcomes.find(o => o.name === ev.home_team), away = mk.outcomes.find(o => o.name === ev.away_team);
            const ph = impliedProb(home?.price), pa = impliedProb(away?.price);
            if (ph == null || pa == null) continue;
            const vig = ph + pa; // de-vig per book so margin differences (Pinnacle -105 vs DK -110) don't read as a lean
            probs.home[tier].push(ph / vig); probs.away[tier].push(pa / vig);
          } else if (mk.key === 'totals') {
            const over = mk.outcomes.find(o => /over/i.test(o.name));
            if (over) totalPts[tier].push(over.point);
          }
        }
      }
      out.sharp = { away_prob: median(probs.away.sharp), home_prob: median(probs.home.sharp), total: median(totalPts.sharp) };
      out.retail = { away_prob: median(probs.away.retail), home_prob: median(probs.home.retail), total: median(totalPts.retail) };
      if (out.sharp.home_prob != null && out.retail.home_prob != null) {
        out.homeSharpEdge = +((out.sharp.home_prob - out.retail.home_prob) * 100).toFixed(1); // + = Pinnacle likes home more than retail does
        out.awaySharpEdge = +((out.sharp.away_prob - out.retail.away_prob) * 100).toFixed(1);
      }
      if (out.sharp.total != null && out.retail.total != null) {
        out.totalSharpDelta = +(out.sharp.total - out.retail.total).toFixed(1);
      }
      return out;
    },
  };
}

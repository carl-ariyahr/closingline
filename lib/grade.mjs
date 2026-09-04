// Deterministic grading via the ESPN scoreboard API.
// A pick is graded against ITS OWN fields, never against text:
//   side  ('away'|'home'|'over'|'under')  — set by the formula; a pick without a side is not guessed
//   line  (spread number with sign for OUR side)  /  total (the total number)
// Returns 'win' | 'loss' | 'push' | null (not final / unmatched / ambiguous — never guess).
import { normName, sameTeam, fuzzyTeam, teamTail } from './names.mjs';

const ESPN = {
  NFL: 'football/nfl', CFB: 'football/college-football', NBA: 'basketball/nba',
  CBB: 'basketball/mens-college-basketball', WNBA: 'basketball/wnba',
  MLB: 'baseball/mlb', NHL: 'hockey/nhl',
};
// how many linescore periods make a "first half" (1H) / first five (F5) per sport
const FIRST_PART = { NFL: 2, CFB: 2, NBA: 2, WNBA: 2, CBB: 1, MLB: 5, NHL: 1 };

// dateStr YYYYMMDD (ESPN groups games by US/Eastern date)
export async function fetchScoreboard(sport, yyyymmdd) {
  const path = ESPN[sport];
  if (!path) return [];
  // CFB: FBS (80) and FCS (81) are separate groups — we pick FCS games too, so fetch both
  const groups = sport === 'CFB' ? ['80', '81'] : [null];
  const events = [];
  const seenIds = new Set(); // an FBS-vs-FCS game is listed under BOTH groups — keep one copy
  for (const g of groups) {
    const extra = g ? `&groups=${g}&limit=300` : '&limit=200';
    const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${yyyymmdd}${extra}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`espn ${sport} ${yyyymmdd}: HTTP ${res.status}`);
    const data = await res.json();
    for (const e of data.events || []) {
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      const c = e.competitions?.[0];
      if (!c?.competitors) continue; // ESPN occasionally lists a shell event with no competition — skip it, never fail the whole day
      const home = c.competitors.find(x => x.homeAway === 'home');
      const away = c.competitors.find(x => x.homeAway === 'away');
      const q = x => (x?.linescores || []).map(l => Number(l.value) || 0);
      events.push({
        id: e.id, date: e.date, group: g, // CFB: '80' = at least one FBS team in the game, '81' = FCS-vs-FCS
        completed: !!c.status?.type?.completed, state: c.status?.type?.state,
        home: home?.team?.displayName, away: away?.team?.displayName,
        homeLoc: home?.team?.location, awayLoc: away?.team?.location,
        homeScore: Number(home?.score), awayScore: Number(away?.score),
        homeQ: q(home), awayQ: q(away),
      });
    }
  }
  return events;
}

// Find OUR game among the day's events. Full-name matching (shared helper), doubleheaders
// disambiguated by start time + the pick's dhIndex. Ambiguous => null.
// Name ladder shared by matching and grading, strictest tier first:
//   1. full name / location   2. college shorthand (fuzzy tokens)   3. pro "ABBR Nickname" tail
const nickOf = s => String(s || '').trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '');
const bareOf = s => String(s || '').replace(/^[A-Z]{2,4}\s+/, '');
const TIERS = [
  (e, k, name) => sameTeam(e[k], name) || sameTeam(k === 'away' ? e.awayLoc : e.homeLoc, name),
  (e, k, name) => fuzzyTeam(name, k === 'away' ? e.awayLoc : e.homeLoc, e[k]),
  (e, k, name) => teamTail(bareOf(name), e[k]) || sameTeam(e[k], bareOf(name)) || (nickOf(e[k]) === nickOf(bareOf(name)) && nickOf(e[k]) !== 'sox'),
];
// Which side of the event is OUR team on? 'away'|'home'|null. Tier by tier: the first tier that names
// exactly one side wins; a tier that names both sides (Yankees/Mets share "New York") is ambiguous → null.
// Grading uses this, so a pick whose own away/home are written backwards (the Royals were HOME on
// 2026-09-03; the card said "KC Royals @ MIA Marlins") still grades the right team.
export function sideOnEvent(e, name) {
  for (const t of TIERS) {
    const a = t(e, 'away', name), h = t(e, 'home', name);
    if (a && h) return null;
    if (a || h) return a ? 'away' : 'home';
  }
  return null;
}

export function matchGame(events, pick) {
  let cands = [];
  for (const t of TIERS) {
    cands = events.filter(e => t(e, 'away', pick.away) && t(e, 'home', pick.home));
    if (!cands.length) cands = events.filter(e => t(e, 'away', pick.home) && t(e, 'home', pick.away)); // swapped orientation
    if (cands.length) break;
  }
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  if (pick.dhIndex == null) return null; // doubleheader and the pick doesn't say which game — never guess
  cands.sort((x, y) => String(x.date).localeCompare(String(y.date)));
  return cands[pick.dhIndex] || null;
}

export function gradeAgainst(ev, pick) {
  if (!ev || !ev.completed) return null;
  const partial = /\b(1H|F5|1P)\b/i.test(String(pick.pick)) || pick.period === '1H';
  let hs = ev.homeScore, as = ev.awayScore;
  if (partial) {
    const n = FIRST_PART[pick.sport] || 2;
    if (ev.homeQ.length < n || ev.awayQ.length < n) return null;
    hs = ev.homeQ.slice(0, n).reduce((s, v) => s + v, 0);
    as = ev.awayQ.slice(0, n).reduce((s, v) => s + v, 0);
  }
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;

  if (pick.type === 'Total') {
    const line = pick.total != null ? Number(pick.total) : parseFloat((String(pick.pick).match(/\d+(?:\.\d+)?/) || [])[0]);
    if (!Number.isFinite(line)) return null;
    const side = pick.side === 'over' || pick.side === 'under' ? pick.side : (/^\s*under/i.test(pick.pick) ? 'under' : /^\s*over/i.test(pick.pick) ? 'over' : null);
    if (!side) return null;
    const total = hs + as;
    if (total === line) return 'push';
    return ((total > line) === (side === 'over')) ? 'win' : 'loss';
  }

  // team side: explicit field first; else the pick's team name must EQUAL one of the teams
  let side = pick.side === 'home' || pick.side === 'away' ? pick.side : null;
  if (!side && pick.pickTeam) side = sameTeam(pick.pickTeam, pick.home) ? 'home' : sameTeam(pick.pickTeam, pick.away) ? 'away' : null;
  if (!side) return null;
  // orientation guard: locate OUR TEAM BY NAME on the ESPN event (the pick's away/home may be backwards)
  const ourName = side === 'home' ? pick.home : pick.away;
  const evSide = sideOnEvent(ev, ourName);
  if (!evSide) return null; // can't place our team on the event → leave it ungraded, never guess
  side = evSide;
  const ourScore = side === 'home' ? hs : as, oppScore = side === 'home' ? as : hs;

  if (pick.type === 'Moneyline') {
    if (ourScore === oppScore) return 'push';
    return ourScore > oppScore ? 'win' : 'loss';
  }
  if (pick.type === 'Spread') {
    const line = pick.line != null ? parseFloat(pick.line) : NaN;
    if (!Number.isFinite(line)) return null; // never read the number out of the team text
    const margin = ourScore - oppScore + line;
    if (margin === 0) return 'push';
    return margin > 0 ? 'win' : 'loss';
  }
  return null;
}

// Grade a batch of ungraded picks {date 'YYYY-MM-DD', sport, away, home, side, line|total, ...}.
// Returns [{pick, result}] for those we could grade; leaves the rest untouched.
export async function gradePicks(picks) {
  const byKey = {};
  const out = [];
  for (const p of picks) {
    if (p.result) continue;
    const yyyymmdd = String(p.date || '').replace(/-/g, '');
    if (yyyymmdd.length !== 8) continue;
    const key = `${p.sport}|${yyyymmdd}`;
    if (!(key in byKey)) {
      try { byKey[key] = await fetchScoreboard(p.sport, yyyymmdd); }
      catch { byKey[key] = null; }
    }
    const events = byKey[key];
    if (!events) continue;
    const result = gradeAgainst(matchGame(events, p), p);
    if (result) out.push({ pick: p, result });
  }
  return out;
}

export { normName };

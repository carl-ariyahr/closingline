// Deterministic grading via the ESPN scoreboard API.
// Grades a pick against ITS OWN number: spread cover, total over/under (push possible),
// moneyline (team won incl. OT), and first-half variants (contains "1H") using Q1+Q2 linescores.
// Returns 'win' | 'loss' | 'push' | null (not final / unmatched — never guess).

const ESPN = {
  NFL: 'football/nfl', CFB: 'football/college-football', NBA: 'basketball/nba',
  CBB: 'basketball/mens-college-basketball', WNBA: 'basketball/wnba',
  MLB: 'baseball/mlb', NHL: 'hockey/nhl',
};

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
function lastWord(s) { const w = String(s || '').trim().split(/\s+/); return norm(w[w.length - 1]); }

// dateStr YYYYMMDD in ET (ESPN groups games by US date)
export async function fetchScoreboard(sport, yyyymmdd) {
  const path = ESPN[sport];
  if (!path) return [];
  const extra = (sport === 'CFB') ? '&groups=80&limit=300' : '&limit=200';
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${yyyymmdd}${extra}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`espn ${sport} ${yyyymmdd}: HTTP ${res.status}`);
  const data = await res.json();
  return (data.events || []).map(e => {
    const c = e.competitions[0];
    const comp = c.competitors;
    const home = comp.find(x => x.homeAway === 'home');
    const away = comp.find(x => x.homeAway === 'away');
    const q = x => (x.linescores || []).map(l => Number(l.value) || 0);
    return {
      completed: !!c.status?.type?.completed,
      home: home?.team?.displayName, away: away?.team?.displayName,
      homeAbbr: home?.team?.abbreviation, awayAbbr: away?.team?.abbreviation,
      homeScore: Number(home?.score), awayScore: Number(away?.score),
      homeQ: q(home), awayQ: q(away),
    };
  });
}

function matchGame(events, away, home) {
  const a = lastWord(away), h = lastWord(home);
  return events.find(e => lastWord(e.away) === a && lastWord(e.home) === h)
    || events.find(e => norm(e.away).includes(a.slice(0, 5)) && norm(e.home).includes(h.slice(0, 5)));
}

// pick: { pick, type ('Spread'|'Total'|'Moneyline'), line, away, home, sport }
// The pick text encodes the side & number; we re-derive from fields where possible.
export function gradeAgainst(ev, pick) {
  if (!ev || !ev.completed) return null;
  const is1H = /\b1H\b/i.test(pick.pick) || /\bF5\b/i.test(pick.pick);
  let hs = ev.homeScore, as = ev.awayScore;
  if (is1H) {
    if (ev.homeQ.length < 2 || ev.awayQ.length < 2) return null; // no halves available
    hs = ev.homeQ[0] + ev.homeQ[1]; as = ev.awayQ[0] + ev.awayQ[1];
  }
  const pickText = String(pick.pick);
  const numMatch = pickText.match(/[+-]?\d+(?:\.\d+)?/);
  const num = numMatch ? parseFloat(numMatch[0]) : null;

  if (pick.type === 'Total') {
    if (num == null) return null;
    const total = hs + as;
    const isUnder = /under/i.test(pickText);
    if (total === num) return 'push';
    const over = total > num;
    return (over && !isUnder) || (!over && isUnder) ? 'win' : 'loss';
  }

  // side picks: figure out whether our pick is home or away
  const ourHome = norm(pickText).includes(lastWord(pick.home)) || norm(pickText).includes(norm(pick.home).slice(0, 6));
  const ourScore = ourHome ? hs : as, oppScore = ourHome ? as : hs;

  if (pick.type === 'Moneyline') {
    if (ourScore === oppScore) return 'push'; // rare (ties); MLB/NHL won't tie in a final
    return ourScore > oppScore ? 'win' : 'loss';
  }
  if (pick.type === 'Spread') {
    if (num == null) return null;
    const margin = ourScore - oppScore + num; // num carries the sign of our side's spread
    if (margin === 0) return 'push';
    return margin > 0 ? 'win' : 'loss';
  }
  return null;
}

// Grade a batch of ungraded picks. picks each have {date 'YYYY-MM-DD', sport, ...}.
// Returns [{pick, result}] for those we could grade; leaves the rest.
export async function gradePicks(picks) {
  const byKey = {}; // sport|espnDate -> events (cache)
  const out = [];
  for (const p of picks) {
    if (p.result) continue;
    // ESPN groups by ET date; a PT game date maps to the same calendar day for our afternoon/evening slate.
    const yyyymmdd = String(p.date || '').replace(/-/g, '');
    if (yyyymmdd.length !== 8) continue;
    const key = `${p.sport}|${yyyymmdd}`;
    if (!(key in byKey)) {
      try { byKey[key] = await fetchScoreboard(p.sport, yyyymmdd); }
      catch { byKey[key] = null; }
    }
    const events = byKey[key];
    if (!events) continue;
    const ev = matchGame(events, p.away, p.home);
    const result = gradeAgainst(ev, p);
    if (result) out.push({ pick: p, result });
  }
  return out;
}

// Shadow-vs-live comparison report — the cutover gate.
// Compares the LLM routines' live slate for a GAME date with every shadow pick for that same
// game date (shadow picks are bucketed by posting day, so we scan all days and match on p.date).
//   MATCH / CONFLICT (opposite side) / LIVE-ONLY / CODE-ONLY
// Conflicts must be zero for several days before Today's Plays moves to the code pipeline.
import { get } from '@vercel/blob';
import { normName, sameTeam, stripPickSuffix } from '../lib/names.mjs';

async function readBlob(name) {
  try {
    const r = await get(name, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const t = await new Response(r.stream).text();
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}
function ptDate(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d); }
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseGameStr(g) {
  const m = String(g || '').match(/^(.*?)\s+@\s+(.*?)\s+[—-]\s*(.*?)\s*(?:\((\w+)\))?\s*$/);
  if (!m) return null;
  let date = null;
  const iso = m[3].match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) date = iso[1];
  else {
    const md = m[3].match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/i);
    if (md) { const y = new Date().getFullYear(); date = `${y}-${String(MON[md[1].slice(0, 3).toLowerCase()]).padStart(2, '0')}-${String(md[2]).padStart(2, '0')}`; }
  }
  return { away: m[1].trim(), home: m[2].trim(), date, sport: m[4] || null };
}
function marketKey(type) {
  if (/total/i.test(type)) return 'Total';
  if (/money/i.test(type)) return 'ML';
  return 'Spread';
}
// pair key that survives "ABBR Nickname" vs "City Nickname" and swapped orientation: sorted nicknames + sport
function pairKey(away, home) {
  const n = s => String(s || '').trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  return [n(away), n(home)].sort().join('~');
}
function sideOf(p, mk) {
  if (mk === 'Total') return p.side === 'under' || p.side === 'over' ? p.side : (/under/i.test(p.pick) ? 'under' : 'over');
  if (p.side === 'home' || p.side === 'away') return p.side;
  const team = stripPickSuffix(p.pick);
  const g = p.game ? parseGameStr(p.game) : { away: p.away, home: p.home };
  if (!g) return normName(team);
  // live picks are "ABBR Nickname": compare nicknames against the game string's own teams
  const n = s => String(s || '').trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (n(team) === n(g.home) && n(team) !== n(g.away)) return 'home';
  if (n(team) === n(g.away) && n(team) !== n(g.home)) return 'away';
  if (sameTeam(team, g.home)) return 'home';
  if (sameTeam(team, g.away)) return 'away';
  return normName(team);
}

export default async function handler(req, res) {
  const key = req.headers['x-app-key'] || req.query.k;
  if (!process.env.APP_KEY || key !== process.env.APP_KEY) return res.status(401).json({ error: 'bad key' });
  const day = req.query.date || ptDate();

  const live = await readBlob('closing-line-picks.json');
  const shadow = await readBlob('closing-line-shadow-picks.json');

  // live: fade picks on ANY card whose game is on `day`
  const livePicks = [];
  for (const c of live?.cards || []) {
    if (!/^slate-/.test(c.id)) continue;
    for (const p of c.picks || []) {
      if (p.kind && p.kind !== 'fade') continue;
      if (p.status === 'dead') continue;
      const g = parseGameStr(p.game);
      if (g?.date === day) livePicks.push({ ...p, _g: g });
    }
  }
  // shadow: every pick (any posting day) whose game date is `day`, excluding faded ones
  const shadowPicks = [];
  for (const d of Object.values(shadow?.days || {})) for (const p of d.picks || []) if (p.date === day && p.status !== 'faded') shadowPicks.push(p);

  const index = arr => {
    const m = new Map();
    for (const p of arr) {
      const g = p._g || { away: p.away, home: p.home };
      const mk = marketKey(p.type);
      const k = `${pairKey(g.away, g.home)}|${mk}`;
      // a swapped orientation in the live string flips home/away: normalize side to the canonical (sorted) pair
      let side = sideOf(p, mk);
      if (side === 'home' || side === 'away') {
        const team = side === 'home' ? g.home : g.away;
        side = String(team).trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z0-9]/g, '');
      }
      m.set(k, { side, tier: p.status === 'active' ? p.tier : (p.status || p.tier), pick: p.pick, game: p.game || `${p.away} @ ${p.home}` });
    }
    return m;
  };
  const L = index(livePicks), S = index(shadowPicks);

  const report = { date: day, liveCount: livePicks.length, shadowCount: shadowPicks.length, match: [], conflict: [], liveOnly: [], codeOnly: [] };
  for (const [k, lv] of L) {
    if (S.has(k)) {
      const sv = S.get(k);
      if (sv.side === lv.side) report.match.push({ market: k, side: lv.side, liveTier: lv.tier, codeTier: sv.tier, pick: lv.pick });
      else report.conflict.push({ market: k, live: `${lv.side} (${lv.pick})`, code: `${sv.side} (${sv.pick})` });
    } else report.liveOnly.push({ market: k, pick: lv.pick, tier: lv.tier });
  }
  for (const [k, sv] of S) if (!L.has(k)) report.codeOnly.push({ market: k, pick: sv.pick, tier: sv.tier });

  const denom = report.match.length + report.conflict.length + report.liveOnly.length + report.codeOnly.length;
  report.matchPct = denom ? Math.round((report.match.length / denom) * 100) : null;
  report.verdict = report.conflict.length ? 'CONFLICTS PRESENT — not safe to cut over'
    : (report.liveOnly.length + report.codeOnly.length === 0 && denom > 0) ? 'PERFECT MATCH'
    : 'aligned with gaps — investigate liveOnly/codeOnly';
  return res.status(200).json(report);
}

// Shadow-vs-live comparison report.
// Reads the LLM routines' live picks (?doc=picks) and the code pipeline's shadow picks
// (closing-line-shadow-picks) and reports, per today's slate:
//   - MATCH:   same game+market+side in both
//   - LIVE-ONLY: the LLM posted it, code did not (investigate: parse gap? timing?)
//   - CODE-ONLY: code posted it, LLM did not
//   - CONFLICT: same game+market but OPPOSITE side (must be zero before cutover)
// This is the gate: when the report shows near-100% match and zero conflicts for several
// days, the code pipeline is trustworthy enough to become the source of Today's Plays.
import { get } from '@vercel/blob';

async function readBlob(name) {
  try {
    const r = await get(name, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const t = await new Response(r.stream).text();
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}
function ptDate(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d); }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function lastWord(s) { const w = String(s || '').trim().split(/\s+/); return norm(w[w.length - 1]); }

// canonical game key from a "A @ B — date (SPORT)" string or away/home fields
function gameKey(away, home) { return [lastWord(away), lastWord(home)].sort().join('~'); }
function parseGameStr(g) {
  const m = String(g || '').match(/^(.*?)\s+@\s+(.*?)\s+—/);
  return m ? { away: m[1], home: m[2] } : { away: '', home: '' };
}
// which side of the market, normalized: 'over'|'under' for totals, else the team nickname
function sideKey(pick, type) {
  if (type === 'Total') return /under/i.test(pick) ? 'under' : 'over';
  return lastWord(String(pick).replace(/[+-]?\d.*$/, '').replace(/\bML\b|1H|F5/gi, ''));
}
function marketKey(type) {
  if (/total/i.test(type)) return 'Total';
  if (/money/i.test(type)) return 'ML';
  return 'Spread';
}

export default async function handler(req, res) {
  const key = req.headers['x-app-key'] || req.query.k;
  if (!process.env.APP_KEY || key !== process.env.APP_KEY) return res.status(401).json({ error: 'bad key' });
  const day = req.query.date || ptDate();

  const live = await readBlob('closing-line-picks.json');       // LLM routines
  const shadow = await readBlob('closing-line-shadow-picks.json'); // code pipeline

  // live: pull fade picks from the slate card for `day` (that's the code pipeline's scope)
  const liveCard = (live?.cards || []).find(c => c.id === `slate-${day}`);
  const livePicks = (liveCard?.picks || []).filter(p => (p.kind === 'fade') || !p.kind);
  const shadowPicks = (shadow?.days?.[day]?.picks || []);

  const index = arr => {
    const m = new Map();
    for (const p of arr) {
      const g = p.game ? parseGameStr(p.game) : { away: p.away, home: p.home };
      const k = `${gameKey(g.away, g.home)}|${marketKey(p.type)}`;
      m.set(k, { side: sideKey(p.pick, marketKey(p.type)), tier: p.status || p.tier, pick: p.pick, game: p.game || `${p.away} @ ${p.home}` });
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
    } else {
      report.liveOnly.push({ market: k, pick: lv.pick, tier: lv.tier });
    }
  }
  for (const [k, sv] of S) if (!L.has(k)) report.codeOnly.push({ market: k, pick: sv.pick, tier: sv.tier });

  const denom = report.match.length + report.conflict.length + report.liveOnly.length + report.codeOnly.length;
  report.matchPct = denom ? Math.round((report.match.length / denom) * 100) : null;
  report.verdict = report.conflict.length ? 'CONFLICTS PRESENT — not safe to cut over'
    : (report.liveOnly.length + report.codeOnly.length === 0 && denom > 0) ? 'PERFECT MATCH'
    : 'aligned with gaps — investigate liveOnly/codeOnly';
  return res.status(200).json(report);
}

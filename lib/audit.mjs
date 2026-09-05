// Second look at every grade, in code, from ESPN finals (Carl 2026-09-05: run it in the cloud, no laptop needed).
// Re-grades every graded pick whose game is on `date` (live cards: slate-*, code-*, patrick-variables PS plays,
// sharp-moves; plus the code's shadow picks) and reports disagreements; `fix` writes corrected results back.
import { get, put } from '@vercel/blob';
import { fetchScoreboard, matchGame, gradeAgainst } from './grade.mjs';
import { liveGradePick, parseLiveGame } from './liveconfirm.mjs';

async function rb(n) { const r = await get(n, { access: 'private', useCache: false }); if (!r?.stream) throw new Error(`blob ${n} unreadable`); return JSON.parse(await new Response(r.stream).text()); }
const score = m => m ? `${m.away} ${m.awayScore} @ ${m.home} ${m.homeScore}${m.completed ? '' : ' (not final)'}` : 'no ESPN match';
const fieldPick = (lp, g) => (lp.src === 'code' || lp.src === 'phil-steele') && lp.side
  ? { type: lp.type, pick: lp.pick, sport: lp.sport || g.sport, date: lp.date || g.date, away: lp.away || g.away, home: lp.home || g.home, side: lp.side, line: lp.line ?? null, total: lp.total ?? null, dhIndex: lp.dhIndex ?? null }
  : liveGradePick(lp, g);

export async function auditGrades({ date, fix = false, now = new Date() } = {}) {
  const live = await rb('closing-line-picks.json');
  const shadow = await rb('closing-line-shadow-picks.json');
  const cache = {};
  const sb = async (sport, d) => { const k = sport + d; if (!(k in cache)) { try { cache[k] = await fetchScoreboard(sport, d.replace(/-/g, '')); } catch { cache[k] = null; } } return cache[k]; };
  const out = { date, checked: 0, agree: 0, wrong: [], unverifiable: [], pending: [], shadow: { checked: 0, agree: 0, differ: [] }, fixed: 0 };
  const fixes = [];
  for (const c of live.cards || []) {
    if (!/^(slate|code)-/.test(c.id) && c.id !== 'patrick-variables' && c.id !== 'sharp-moves') continue;
    for (const lp of c.picks || []) {
      if (lp.kind && !['fade', 'ps', 'sharp'].includes(lp.kind)) continue;
      if (lp.status === 'dead') continue;
      const g = parseLiveGame(lp.game, now);
      if (!g?.date || !g.sport || (date && g.date !== date)) continue;
      const graded = lp.result && lp.result !== 'pending';
      const shown = !!lp.playsShownAt;
      if (!graded && !(shown || lp.status === 'play')) continue;
      const gp = fieldPick(lp, g);
      const ev = await sb(g.sport, g.date);
      const m = ev && gp ? matchGame(ev, gp) : null;
      const res = m ? gradeAgainst(m, gp) : null;
      const label = `${c.id} | ${lp.status}${shown ? ' SHOWN' : ''} | ${lp.pick} | ${lp.game} | ${score(m)}`;
      if (!graded) { out.pending.push(`${label} | readable: ${gp ? 'yes' : 'NO'} | ESPN: ${m ? 'matched' : 'NOT MATCHED'}`); continue; }
      out.checked++;
      if (!res) { out.unverifiable.push(`${label} | stored ${lp.result} (${lp.gradedBy || 'ai'})`); continue; }
      if (res === lp.result) { out.agree++; continue; }
      out.wrong.push(`${label} | stored ${lp.result} (${lp.gradedBy || 'ai'}) → CODE SAYS ${res.toUpperCase()}`);
      fixes.push({ lp, res, m });
    }
  }
  for (const d of Object.values(shadow.days || {})) for (const p of d.picks || []) {
    if (!p.result || (date && p.date !== date)) continue;
    out.shadow.checked++;
    const ev = await sb(p.sport, p.date); const m = ev ? matchGame(ev, p) : null; const res = m ? gradeAgainst(m, p) : null;
    if (res === p.result) out.shadow.agree++; else out.shadow.differ.push(`${p.date} ${p.pick} ${p.line || ''} | ${p.away} @ ${p.home} | stored ${p.result} → code ${res} | ${score(m)}`);
  }
  if (fix && fixes.length) {
    const ts = now.toISOString();
    for (const { lp, res, m } of fixes) { lp.result = res; lp.gradedAt = ts; lp.gradedBy = 'code'; lp.regraded = `${ts.slice(0, 10)}: audit re-grade from ESPN final ${score(m)}`; if (lp.status === 'play' || lp.stack) lp.featured = true; }
    live.rev = (live.rev || 0) + 1;
    await put('closing-line-picks.json', JSON.stringify(live), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    out.fixed = fixes.length;
  }
  return out;
}

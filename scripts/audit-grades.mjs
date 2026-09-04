// Re-grade every graded live-card pick (and every shadow pick) from ESPN finals with the current code and
// report disagreements. Usage (from the repo root, needs .env.local with BLOB_READ_WRITE_TOKEN):
//   node scripts/audit-grades.mjs                 audit everything already graded
//   node scripts/audit-grades.mjs --date=2026-09-04   only picks whose game is on that date; also lists
//                                                 ungraded plays on that date and whether they can be graded
//   node scripts/audit-grades.mjs --fix           write corrected results back to the live card (code-verified only)
import { get, put } from '@vercel/blob';
import fs from 'node:fs';
import { fetchScoreboard, matchGame, gradeAgainst } from '../lib/grade.mjs';
import { liveGradePick, parseLiveGame } from '../lib/liveconfirm.mjs';

for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const onlyDate = args.date || null;
async function rb(n) { const r = await get(n, { access: 'private', useCache: false }); return JSON.parse(await new Response(r.stream).text()); }
const cache = {};
async function sb(sport, date) { const k = sport + date; if (!(k in cache)) { try { cache[k] = await fetchScoreboard(sport, date.replace(/-/g, '')); } catch { cache[k] = null; } } return cache[k]; }
const score = m => m ? `${m.away} ${m.awayScore} @ ${m.home} ${m.homeScore}${m.completed ? '' : ' (not final)'}` : 'no ESPN match';

const live = await rb('closing-line-picks.json');
const shadow = await rb('closing-line-shadow-picks.json');
const now = new Date();
let n = 0, agree = 0; const diff = [], unverified = [], pending = [];
for (const c of live.cards) {
  if (!/^(slate|code)-/.test(c.id) && c.id !== 'patrick-variables') continue;
  for (const lp of c.picks || []) {
    if (lp.kind && lp.kind !== 'fade' && lp.kind !== 'ps') continue; // Phil Steele PS paper plays are graded by code too
    if (lp.status === 'dead') continue;
    const g = parseLiveGame(lp.game, now);
    if (!g?.date || !g.sport) continue;
    if (onlyDate && g.date !== onlyDate) continue;
    const graded = lp.result && lp.result !== 'pending';
    const shown = !!lp.playsShownAt;
    if (!graded && !(shown || lp.status === 'play')) continue; // ungraded non-plays are not in scope
    const gp = (lp.src === 'code' || lp.src === 'phil-steele') && lp.side
      ? { type: lp.type, pick: lp.pick, sport: lp.sport || g.sport, date: lp.date || g.date, away: lp.away || g.away, home: lp.home || g.home, side: lp.side, line: lp.line ?? null, total: lp.total ?? null, dhIndex: lp.dhIndex ?? null }
      : liveGradePick(lp, g);
    const ev = await sb(g.sport, g.date);
    const m = ev && gp ? matchGame(ev, gp) : null;
    const res = m ? gradeAgainst(m, gp) : null;
    const label = `${lp.status}${shown ? ' SHOWN' : ''} | ${lp.pick} | ${lp.game} | ${score(m)}`;
    if (!graded) { pending.push(`${label} | readable: ${gp ? `${gp.side}${gp.line ? ' ' + gp.line : gp.total ? ' ' + gp.total : ''}` : 'NO — side/number unreadable'} | ESPN: ${m ? 'matched' : 'NOT MATCHED'}`); continue; }
    n++;
    if (!res) { unverified.push(`${label} | stored ${lp.result} (${lp.gradedBy || 'ai'})`); continue; }
    if (res === lp.result) { agree++; continue; }
    diff.push({ lp, res, m, label: `${label} | stored ${lp.result} (${lp.gradedBy || 'ai'}) → CODE SAYS ${res.toUpperCase()}` });
  }
}
console.log(`LIVE CARD${onlyDate ? ' ' + onlyDate : ''}: ${n} graded checked — ${agree} agree, ${diff.length} WRONG, ${unverified.length} unverifiable`);
for (const d of diff) console.log('  WRONG:', d.label);
for (const u of unverified) console.log('  unverifiable:', u);
if (pending.length) { console.log(`UNGRADED plays${onlyDate ? ' on ' + onlyDate : ''}: ${pending.length}`); for (const p of pending) console.log('  ', p); }

let sn = 0, sa = 0; const sd = [];
for (const d of Object.values(shadow.days || {})) for (const p of d.picks || []) {
  if (!p.result || (onlyDate && p.date !== onlyDate)) continue;
  sn++; const ev = await sb(p.sport, p.date); const m = ev ? matchGame(ev, p) : null; const res = m ? gradeAgainst(m, p) : null;
  if (res === p.result) sa++; else sd.push(`${p.date} ${p.pick} ${p.line || ''} | ${p.away} @ ${p.home} | stored ${p.result} → code ${res} | ${score(m)}`);
}
console.log(`SHADOW: ${sn} graded — ${sa} agree, ${sd.length} differ`);
for (const x of sd) console.log('  ', x);

if (args.fix && diff.length) {
  const ts = now.toISOString();
  for (const { lp, res, m } of diff) { lp.result = res; lp.gradedAt = ts; lp.gradedBy = 'code'; lp.regraded = `${ts.slice(0, 10)}: audit re-grade from ESPN final ${score(m)}`; if (lp.status === 'play' || lp.stack) lp.featured = true; }
  live.rev = (live.rev || 0) + 1;
  await put('closing-line-picks.json', JSON.stringify(live), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  console.log(`FIXED ${diff.length} result(s) on the live card (rev ${live.rev})`);
}

// Full results for one game day (Carl 2026-09-08: "show me the full results tomorrow morning").
//   node scripts/day-report.mjs [--date=YYYY-MM-DD]   (default: yesterday, Pacific)
// Every play that was shown for that day: card rank, pick, result, counted or not, last pre-game read, CLV, public reads.
import { get } from '@vercel/blob';
import fs from 'node:fs';
import { boxesFor } from '../lib/boxes.mjs';
import { clvSummary } from '../lib/clv.mjs';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const PT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
const date = (process.argv.find(a => a.startsWith('--date=')) || '').split('=')[1] || PT.format(new Date(Date.now() - 86400e3));
const rb = async n => { const r = await get(n, { access: 'private', useCache: false }); return JSON.parse(await new Response(r.stream).text()); };
const live = await rb('closing-line-picks.json');
const shown = live.cards.flatMap(c => (c.picks || []).map(p => ({ ...p, card: c.id }))).filter(p => p.playsShownAt && (p.date === date || String(p.game).includes(date)));
const rec = a => { const w = a.filter(p => p.result === 'win').length, l = a.filter(p => p.result === 'loss').length, pu = a.filter(p => p.result === 'push').length, pe = a.filter(p => !p.result || p.result === 'pending').length; return `${w}-${l}${pu ? '-' + pu : ''}${w + l ? ` (${Math.round(100 * w / (w + l))}%, ${(w * 0.909 - l).toFixed(1)}u)` : ''}${pe ? ` · ${pe} pending` : ''}`; };
const onCard = p => p.dailyCard && !p.dailyCard.replaced;
const pt = t => t ? new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) : '';
console.log(`RESULTS FOR ${date}: ${shown.length} plays shown`);
const card = live.dailyCards?.[date];
if (card) console.log(`Daily card: ${card.picks.length} play(s)${card.replacedPicks?.length ? ` (+${card.replacedPicks.length} replaced during the day)` : ''}`);
for (const p of shown.sort((a, b) => (onCard(a) ? 0 : 1) - (onCard(b) ? 0 : 1) || (a.noBet ? 1 : 0) - (b.noBet ? 1 : 0))) {
  const L = p.liveCheck; const bx = boxesFor(p);
  console.log(`  ${onCard(p) ? '#' + p.dailyCard.rank : 'older'} ${p.pick.padEnd(30)} ${String(p.game).replace(/\s+—.*$/, '').padEnd(46)} ${(p.result || 'pending').padEnd(7)} ${p.noBet ? 'NOT COUNTED (faded/flipped at first pitch)' : 'counted'}  · last read ${L ? (L.ok ? 'clean' : L.why) : '-'}${L?.T != null ? ` ${L.T}/${L.H}` : ''} ${pt(L?.ts)}${p.clv ? ` · clv ${p.clv.diff > 0 ? '+' : ''}${p.clv.diff}${p.clv.unit === 'cents' ? '¢' : ''}` : ''} · reads ${bx.n}/${bx.total}${p.start ? ` · ${pt(p.start)}` : ''}`);
}
const graded = shown.filter(p => p.result && p.result !== 'pending');
console.log(`\nCounted: ${rec(shown.filter(p => !p.noBet))}   |   Not counted (no-bet at first pitch): ${rec(shown.filter(p => p.noBet))}`);
console.log(`Card plays only: ${rec(shown.filter(onCard))}   |   Card plays counted: ${rec(shown.filter(p => onCard(p) && !p.noBet))}`);
const c = clvSummary(graded.filter(p => !p.noBet)); if (c.n) console.log(`CLV (counted, graded): beat ${c.beat} · worse ${c.worse} · same ${c.same}${c.avgPts != null ? ` · avg ${c.avgPts > 0 ? '+' : ''}${c.avgPts} pts` : ''}${c.avgCents != null ? ` · avg ${c.avgCents > 0 ? '+' : ''}${c.avgCents}¢ (ML)` : ''}`);
const all = live.cards.flatMap(c => c.picks || []).filter(p => p.playsShownAt && p.result && p.result !== 'pending');
console.log(`\nLedger since Sep 2 (counted): ${rec(all.filter(p => !p.noBet))}   |   no-bets: ${rec(all.filter(p => p.noBet))}`);
const clean = all.filter(p => p.liveCheck?.ok), faded = all.filter(p => p.liveCheck && !p.liveCheck.ok && p.liveCheck.why === 'faded'), flipped = all.filter(p => p.liveCheck && !p.liveCheck.ok && p.liveCheck.why === 'flipped');
console.log(`By last read before first pitch: clean ${rec(clean)} · faded ${rec(faded)} · flipped ${rec(flipped)}`);
const j = await rb('closing-line-journal.json').catch(() => null); const e = j?.entries?.find(x => x.date === date);
if (e?.read) console.log(`\nJournal (${e.by || 'routine'}): ${e.read}`);

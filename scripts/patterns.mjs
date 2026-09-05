// Pattern report over every graded pick (Carl 2026-09-05: "track everything ... I will be asking for patterns").
//   node scripts/patterns.mjs [--since=2026-09-02]
// Cuts Carl's plays (the ledger), the code's picks (all tiers), the sharp-move paper card, Phil Steele and yo-yo entries
// by tier, market, sport, gap, crowd size, money split, kickoff state, cohort and day. Read-only.
import { get } from '@vercel/blob';
import fs from 'node:fs';
import { parseLiveGame, cohortsOf } from '../lib/liveconfirm.mjs';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const since = (process.argv.find(a => a.startsWith('--since=')) || '--since=2026-09-02').split('=')[1];
async function rb(n) { const r = await get(n, { access: 'private', useCache: false }); return JSON.parse(await new Response(r.stream).text()); }
const live = await rb('closing-line-picks.json'), shadow = await rb('closing-line-shadow-picks.json');
const rec = rows => { let w = 0, l = 0, p = 0; for (const r of rows) { if (r.result === 'win') w++; else if (r.result === 'loss') l++; else p++; } const n = w + l; return `${w}-${l}${p ? '-' + p : ''}${n ? ` (${Math.round(100 * w / n)}%, ${(w - l * 1.1).toFixed(1)}u)` : ''}`; };
const cut = (rows, keyFn) => { const m = {}; for (const r of rows) { const k = keyFn(r); if (k == null) continue; (m[k] = m[k] || []).push(r); } return Object.entries(m).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `    ${k.padEnd(28)} ${rec(v)}`).join('\n'); };
const mkOf = p => /^under/i.test(p.pick) ? 'Under' : /^over/i.test(p.pick) ? 'Over' : (/money/i.test(p.type || '') || /\bML\b|[+-]\d{3}$/.test(p.pick)) ? 'Moneyline' : 'Spread';
const sportOf = p => p.sport || (String(p.game || '').match(/\((\w+)\)/) || [])[1];
const graded = p => p.result && p.result !== 'pending';

// 1) Carl's plays (ledger)
const led = []; for (const c of live.cards) for (const p of c.picks || []) if (p.playsShownAt && graded(p)) { const g = parseLiveGame(p.game); if (g?.date >= since) led.push({ ...p, _date: g.date }); }
const counted = led.filter(p => !p.noBet);
console.log(`CARL'S PLAYS since ${since}: ${counted.length} counted → ${rec(counted)}   (+${led.length - counted.length} DO NOT BET, not counted: ${rec(led.filter(p => p.noBet))})`);
console.log('  by day\n' + cut(counted, p => p._date));
console.log('  by kickoff state\n' + cut(led, p => p.noBet ? 'DO NOT BET' : p.liveCheck ? (p.liveCheck.ok ? 'still a fade' : p.liveCheck.why) : 'unchecked'));
console.log('  by market\n' + cut(counted, mkOf));
console.log('  by sport\n' + cut(counted, sportOf));
console.log('  by source\n' + cut(counted, p => p.src === 'code' ? 'code' : 'AI card'));
console.log('  by cohort (a play can be in several)\n' + cut(counted.flatMap(p => (cohortsOf(p).length ? cohortsOf(p) : ['none']).map(c => ({ ...p, _c: c }))), p => p._c));
console.log('  by crowd size (kickoff read)\n' + cut(counted, p => { const T = p.liveCheck?.T ?? p.T; return T == null ? null : T >= 80 ? 'crowd 80%+' : T >= 70 ? 'crowd 70-79' : 'crowd 60-69'; }));
console.log('  by money on our side (kickoff read)\n' + cut(counted, p => { const H = p.liveCheck?.H ?? p.H; return H == null ? null : (100 - H) >= 70 ? 'our money 70%+' : (100 - H) >= 55 ? 'our money 55-69' : 'our money <55'; }));
console.log('  by gap (kickoff read)\n' + cut(counted, p => { const D = p.liveCheck?.D ?? p.D; return D == null ? null : D >= 40 ? 'gap 40+' : D >= 25 ? 'gap 25-39' : D >= 15 ? 'gap 15-24' : D >= 8 ? 'gap 8-14' : 'gap <8'; }));
console.log('  by boxes lined up (crowd70 + pro move + strong money [+ dog price for ML])\n' + cut(counted, p => { const co = cohortsOf(p); const ml = mkOf(p) === 'Moneyline'; let n = 0, t = 3 + (ml ? 1 : 0); if (co.includes('crowd70')) n++; if (co.includes('promove')) n++; if (!co.includes('thinmoney')) n++; if (ml && co.includes('dogml')) n++; return `${n} of ${t}`; }));

// 2) code picks, all tiers
const sh = Object.values(shadow.days).flatMap(d => d.picks).filter(p => graded(p) && p.date >= since);
console.log(`\nCODE PICKS (all tiers) since ${since}: ${sh.length} → ${rec(sh)}`);
console.log('  by tier\n' + cut(sh, p => p.tier));
console.log('  by market\n' + cut(sh, p => p.type === 'Total' ? 'Total ' + p.side : p.type));
console.log('  by sport\n' + cut(sh, p => p.sport));
console.log('  by crowd size (posting read)\n' + cut(sh, p => p.T >= 80 ? 'crowd 80+' : p.T >= 70 ? 'crowd 70-79' : 'crowd 60-69'));
console.log('  by money on our side (posting read)\n' + cut(sh, p => (100 - p.H) >= 70 ? 'our money 70%+' : (100 - p.H) >= 55 ? 'our money 55-69' : 'our money <55'));
console.log('  ML fav vs dog\n' + cut(sh.filter(p => p.type === 'Moneyline'), p => { const n = parseFloat(String(p.line || '').replace('+', '')); return isNaN(n) ? null : n > 100 ? 'dog' : 'fav/even'; }));
console.log('  by status at grading\n' + cut(sh, p => p.status));

// 3) paper cards
const card = id => (live.cards.find(c => c.id === id)?.picks || []).filter(graded);
console.log(`\nSHARP MOVES (tail the move, paper): ${rec(card('sharp-moves'))}` + (card('sharp-moves').length ? '\n' + cut(card('sharp-moves'), p => (p.early ? 'early (>96h)' : 'late') + ' · ' + p.type) : ''));
const pv = card('patrick-variables');
console.log(`PHIL STEELE (PS): ${rec(pv.filter(p => p.kind === 'ps'))}` + (pv.some(p => p.kind === 'ps') ? '\n' + cut(pv.filter(p => p.kind === 'ps'), p => p.psWho === 'computer' ? 'computer best bet' : "Phil's best bet") : ''));
console.log(`PATRICK'S VARIABLES (steam/latepub): ${rec(pv.filter(p => ['steam', 'latepub'].includes(p.kind)))}`);

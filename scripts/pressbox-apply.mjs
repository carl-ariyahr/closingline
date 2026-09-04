// Apply a Pressbox import (scripts/pressbox-import.py JSON) to Carl's Patrick's Variables card as "PS" paper plays.
//   node scripts/pressbox-apply.mjs picks.json [--dry]
// Resolves each starred game against the VSiN board (names, start, gamecode) or ESPN, sets the side's line from the
// sheet's Vegas line (fallback: VSiN spread), and merges by psKey so re-running a week is idempotent.
import { get, put } from '@vercel/blob';
import fs from 'node:fs';
import { fuzzyTeam, nick } from '../lib/names.mjs';
import { fetchScoreboard, matchGame } from '../lib/grade.mjs';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const [file, ...flags] = process.argv.slice(2); const dry = flags.includes('--dry');
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
async function rb(n) { const r = await get(n, { access: 'private', useCache: false }); return JSON.parse(await new Response(r.stream).text()); }
const snap = await rb('closing-line-shadow-lines.json'); const live = await rb('closing-line-picks.json');
const latest = {}; for (const s of snap.snapshots) for (const g of s.games) latest[g.gamecode] = { ...g, ts: s.ts };
const board = Object.values(latest).filter(g => g.sport === doc.sport);
const teamIs = (name, g, k) => fuzzyTeam(name, g[k], g[k]) || fuzzyTeam(g[k], name, name);
const espn = {};
const out = [];
for (const p of doc.picks) {
  const date = p.date; if (!date) { out.push({ p, err: 'no date' }); continue; }
  let g = board.find(x => x.date === date && teamIs(p.away, x, 'away') && teamIs(p.home, x, 'home'))
       || board.find(x => x.date === date && teamIs(p.away, x, 'home') && teamIs(p.home, x, 'away'));
  let away, home, gamecode = null, start = null, vsinLineHome = null;
  if (g) { away = g.away; home = g.home; gamecode = g.gamecode; start = g.start || null; vsinLineHome = g.spread?.line_home ?? null; }
  else {
    if (!(date in espn)) { try { espn[date] = await fetchScoreboard(doc.sport, date.replace(/-/g, '')); } catch { espn[date] = []; } }
    const ev = matchGame(espn[date], { sport: doc.sport, date, away: p.away, home: p.home });
    if (!ev) { out.push({ p, err: 'game not found on VSiN or ESPN' }); continue; }
    away = ev.awayLoc || ev.away; home = ev.homeLoc || ev.home; start = ev.date || null;
  }
  const sideKey = fuzzyTeam(p.side, away, away) ? 'away' : fuzzyTeam(p.side, home, home) ? 'home' : null;
  if (!sideKey) { out.push({ p, err: `side "${p.side}" is neither ${away} nor ${home}` }); continue; }
  let line = null, lineSrc = null;
  if (p.vegasLine) {
    const [favTxt, n] = p.vegasLine;
    const favKey = fuzzyTeam(favTxt, away, away) ? 'away' : fuzzyTeam(favTxt, home, home) ? 'home' : null;
    if (favKey) { line = favKey === sideKey ? -n : n; lineSrc = 'sheet'; }
  }
  if (line == null && vsinLineHome != null) { line = sideKey === 'home' ? vsinLineHome : -vsinLineHome; lineSrc = 'vsin'; }
  const sideName = sideKey === 'away' ? away : home;
  const who = p.who === 'phil' ? "Phil's Best Bet" : 'Computer Best Bet';
  const pick = {
    kind: 'ps', src: 'phil-steele', psWho: p.who, week: doc.week, sheet: doc.source,
    psKey: `ps|${doc.week}|${date}|${[nick(away), nick(home)].sort().join('~')}|${nick(sideName)}`,
    type: 'Spread', pick: line == null ? `${sideName} (line TBD)` : `${sideName} ${line > 0 ? '+' : ''}${line}`,
    game: `${away} @ ${home} — ${date} (${doc.sport})`,
    signal: `PS · ${who}, Pressbox Week ${doc.week}` + (p.vegasLine ? ` · sheet line ${p.vegasLine[0]} by ${p.vegasLine[1]}` : '') + (p.vegasTotal ? `, total ${p.vegasTotal}` : '') + (p.bestBet?.score ? ` · projected ${p.bestBet.score}` : '') + (lineSrc === 'vsin' ? ' · line from the VSiN board (sheet had none)' : ''),
    status: line == null ? 'alert' : 'play', side: sideKey, line: line == null ? null : `${line > 0 ? '+' : ''}${line}`,
    away, home, date, sport: doc.sport, gamecode, start, importedAt: new Date().toISOString(),
  };
  out.push({ p, pick });
}
for (const r of out) console.log(r.err ? `SKIP  ${r.p.who} ${r.p.side} (${r.p.away} @ ${r.p.home}): ${r.err}` : `${r.pick.psWho.padEnd(8)} ${r.pick.pick.padEnd(28)} ${r.pick.game.padEnd(52)} ${r.pick.gamecode ? 'VSiN' : 'ESPN'} start ${r.pick.start || '-'}`);
if (dry) process.exit(0);
let card = live.cards.find(c => c.id === 'patrick-variables');
if (!card) { card = { id: 'patrick-variables', title: "Patrick's Variables (experimental, paper-traded only)", picks: [] }; live.cards.push(card); }
let added = 0, updated = 0;
for (const r of out) {
  if (!r.pick) continue;
  const ex = card.picks.find(x => x.psKey === r.pick.psKey);
  if (ex) { if (!ex.result) { Object.assign(ex, { ...r.pick, importedAt: ex.importedAt }); updated++; } }
  else { card.picks.push(r.pick); added++; }
}
live.rev = (live.rev || 0) + 1;
await put('closing-line-picks.json', JSON.stringify(live), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
console.log(`written: ${added} added, ${updated} updated (rev ${live.rev})`);

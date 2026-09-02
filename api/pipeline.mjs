// Deterministic pick pipeline — SHADOW MODE.
// Fetches VSiN splits with code, applies the frozen fade formula in code,
// and writes to shadow blobs only (closing-line-shadow-*). It NEVER touches
// the live picks/lines docs — the LLM routines keep producing Carl's real card
// until shadow output is verified and Carl approves the cutover.
import { put, get } from '@vercel/blob';
import { SPORTS, fetchSplitsHTML, parseSplits, validateGame } from '../lib/vsin.mjs';
import { evalGame, keyNumberNote } from '../lib/formula.mjs';

const SNAP_BLOB = 'closing-line-shadow-lines.json';
const PICKS_BLOB = 'closing-line-shadow-picks.json';
const CONTINUITY_MAX_SWING = 20; // tickets are cumulative; a bigger hourly swing = misread

async function readBlob(name, fallback) {
  try {
    const r = await get(name, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return fallback;
    const text = await new Response(r.stream).text();
    return text ? JSON.parse(text) : fallback;
  } catch { return fallback; }
}
async function writeBlob(name, data) {
  await put(name, JSON.stringify(data), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
  });
}

function ptDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d); // YYYY-MM-DD
}

export default async function handler(req, res) {
  const key = req.headers['x-app-key'] || req.query.k;
  if (!process.env.APP_KEY || key !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'missing or bad key' });
  }
  const startedAt = new Date();
  const report = { ranAt: startedAt.toISOString(), sports: {}, newPicks: [], flags: [], errors: [] };

  const snapDoc = await readBlob(SNAP_BLOB, { rev: 0, snapshots: [] });
  const picksDoc = await readBlob(PICKS_BLOB, { rev: 0, days: {} });

  const prevBySport = {};
  for (const s of snapDoc.snapshots) prevBySport[s.sport] = s; // last one per sport wins

  const freshGames = [];
  for (const sport of SPORTS) {
    try {
      const html = await fetchSplitsHTML(sport);
      const games = parseSplits(html, sport);
      const kept = [];
      for (const g of games) {
        const issues = validateGame(g);
        if (issues.length) { report.flags.push({ gamecode: g.gamecode, game: `${g.away} @ ${g.home}`, issues }); continue; }
        // continuity vs the previous shadow snapshot of the same game
        const prev = prevBySport[sport]?.games?.find(p => p.gamecode && p.gamecode === g.gamecode);
        if (prev) {
          const pairs = [
            [prev.spread?.away?.bets, g.spread.away.bets], [prev.total?.over?.bets, g.total.over.bets],
            [prev.ml?.away?.bets, g.ml.away.bets],
          ];
          const swing = pairs.some(([a, b]) => a != null && b != null && Math.abs(a - b) > CONTINUITY_MAX_SWING);
          if (swing) { report.flags.push({ gamecode: g.gamecode, game: `${g.away} @ ${g.home}`, issues: ['continuity: bets% swing >20 vs previous snapshot'] }); continue; }
        }
        kept.push(g);
      }
      report.sports[sport] = { parsed: games.length, kept: kept.length };
      freshGames.push(...kept);
      if (kept.length) {
        snapDoc.snapshots.push({ ts: startedAt.toISOString(), sport, games: kept });
      }
    } catch (e) {
      report.sports[sport] = { error: String(e.message || e) };
      report.errors.push(`${sport}: ${e.message || e}`);
    }
  }

  // prune shadow snapshots: keep 3 days (the live archive system owns history)
  const cutoff = Date.now() - 3 * 24 * 3600e3;
  snapDoc.snapshots = snapDoc.snapshots.filter(s => new Date(s.ts).getTime() >= cutoff);
  snapDoc.rev = (snapDoc.rev || 0) + 1;
  await writeBlob(SNAP_BLOB, snapDoc);

  // ---- frozen formula, in code ----
  const today = ptDateStr(startedAt);
  const day = picksDoc.days[today] || (picksDoc.days[today] = { picks: [] });
  // cross-day dedupe universe: every ungraded pick from every day, keyed by gamecode+type
  const seen = new Set();
  for (const d of Object.values(picksDoc.days)) for (const p of d.picks) if (!p.result) seen.add(`${p.gamecode}|${p.type}`);

  for (const g of freshGames) {
    for (const p of evalGame(g, startedAt)) {
      const k = `${p.gamecode}|${p.type}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const key = keyNumberNote(p.sport, p.type, p.line);
      const pick = {
        ...p,
        game: `${p.away} @ ${p.home} — ${p.date} (${p.sport})`,
        signal: `PUBLIC ${p.T}% of tickets on ${p.publicSide}${p.publicLine ? ' ' + p.publicLine : ''} but only ${p.H}% of the money — we take ${p.pick}${p.line ? ' ' + p.line : ''} · ${p.D} pt gap`
          + (p.downgraded.length ? ` · downgraded to watch (${p.downgraded.join(', ')})` : '')
          + (key ? ` · ${key}` : ''),
        postedAt: startedAt.toISOString(),
      };
      day.picks.push(pick);
      report.newPicks.push({ tier: pick.tier, type: pick.type, pick: pick.pick, line: pick.line, game: pick.game, D: pick.D });
    }
  }

  // prune pick days older than 14 days
  for (const d of Object.keys(picksDoc.days)) {
    if (new Date(d) < new Date(Date.now() - 14 * 24 * 3600e3)) delete picksDoc.days[d];
  }
  picksDoc.rev = (picksDoc.rev || 0) + 1;
  picksDoc.lastRun = report;
  await writeBlob(PICKS_BLOB, picksDoc);

  report.tookMs = Date.now() - startedAt.getTime();
  return res.status(200).json(report);
}

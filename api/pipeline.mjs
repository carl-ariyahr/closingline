// Deterministic pick pipeline — SHADOW MODE.
// Every run (hourly): VSiN splits → Action Network splits → frozen formula → post NEW picks →
// RE-CONFIRM every open pick against the fresh read → grade finished picks → write shadow blobs.
// It NEVER touches the live picks/lines docs until Carl approves the cutover.
import { put, get } from '@vercel/blob';
import { SPORTS, fetchSplitsHTML, parseSplits, scrubGame } from '../lib/vsin.mjs';
import { evalGame, keyNumberNote } from '../lib/formula.mjs';
import { loadSharpBoard } from '../lib/oddsapi.mjs';
import { gradePicks } from '../lib/grade.mjs';
import { loadContention } from '../lib/contention.mjs';
import { AN_LEAGUE, fetchActionHTML, parseActionSplits } from '../lib/actionnetwork.mjs';
import { sameTeam, matchPair, stripPickSuffix, nick } from '../lib/names.mjs';

const SNAP_BLOB = 'closing-line-shadow-lines.json';
const PICKS_BLOB = 'closing-line-shadow-picks.json';
const EXT_BLOB = 'closing-line-external-splits.json'; // Action Network (code-pulled) + any session-fed rows

const CONTINUITY_MAX_SWING = 20; // tickets are cumulative; a bigger hourly swing = misread
const SPLIT_NEUTRAL_MARGIN = 6;  // Action a/b within this many points => "split", not confirmation either way
const MAX_CHECKS = 48;           // confirmation history kept per pick

// ---- second-source confirmation (annotation only) --------------------------------------------
// Find the Action row for this pick: same league, date, market, and the SAME PAIR of teams
// (full-name match, either orientation). Returns null when none or ambiguous.
export function externalRow(extDoc, p) {
  if (!extDoc?.rows) return null;
  const mk = p.type === 'Moneyline' ? 'ML' : p.type === 'Spread' ? 'Spread' : 'Total';
  const pool = Object.values(extDoc.rows).filter(r => r.league === p.sport && r.date === p.date && r.market === mk);
  const c = matchPair(pool, p.away, p.home, r => r.away, r => r.home);
  return c.length === 1 ? c[0] : null;
}

// Note string or null. Never affects tier/formula. (exported for tests)
export function externalNote(extDoc, p) {
  const row = externalRow(extDoc, p);
  if (!row || row.a?.bets == null || row.b?.bets == null) return null;
  const src = row.source === 'actionnetwork' ? 'Action Network' : row.source;
  if (Math.abs(row.a.bets - row.b.bets) < SPLIT_NEUTRAL_MARGIN) {
    return `◌ ${src} is split (${row.a.name} ${row.a.bets}% / ${row.b.name} ${row.b.bets}% of bets) — no read either way`;
  }
  const pubSide = row.a.bets > row.b.bets ? row.a : row.b;
  const pubName = String(pubSide.name || '');
  let agrees;
  if (p.type === 'Total') {
    const ours = /^over/i.test(p.publicSide) ? 'over' : /^under/i.test(p.publicSide) ? 'under' : null;
    const theirs = /^over/i.test(pubName) ? 'over' : /^under/i.test(pubName) ? 'under' : null;
    if (!ours || !theirs) return null;
    agrees = ours === theirs;
  } else {
    // which of OUR two teams is Action's public on? full-name match against the row's own away/home
    const theirTeam = sameTeam(pubName, row.away) || nick(pubName) === nick(row.away) && !sameTeam(pubName, row.home) ? row.away
      : sameTeam(pubName, row.home) || nick(pubName) === nick(row.home) ? row.home : null;
    if (!theirTeam) return null;
    const ourPublic = stripPickSuffix(p.publicSide);
    const ourTeam = sameTeam(ourPublic, p.away) ? p.away : sameTeam(ourPublic, p.home) ? p.home : null;
    if (!ourTeam) return null;
    agrees = sameTeam(theirTeam, ourTeam);
  }
  const money = pubSide.money != null ? `, ${pubSide.money}% of money` : '';
  return agrees
    ? `✓ ${src} confirms public on ${pubName} (${pubSide.bets}% of bets${money})`
    : `⚠ CAUTION — ${src} shows public on ${pubName} (${pubSide.bets}% of bets${money}), disagrees with DK · less confirmation, VSiN still qualifies the play`;
}

// Carl's rule (2026-09-02): VSiN decides the play; Action Network grades confidence.
export function confirmationLevel(extNote) {
  if (!extNote) return { level: 'unconfirmed', emoji: '◌', label: 'unconfirmed — no second source for this game' };
  if (extNote.startsWith('✓')) return { level: 'confirmed', emoji: '✓', label: 'confirmed by Action Network' };
  if (extNote.startsWith('◌')) return { level: 'unconfirmed', emoji: '◌', label: 'Action Network split — no read either way' };
  return { level: 'caution', emoji: '⚠', label: 'caution — Action Network disagrees' };
}

// ---- blobs -----------------------------------------------------------------------------------
class BlobReadError extends Error {}
// Missing blob => fallback. ANY other failure => throw, so a flaky read can never be written back as an empty doc.
async function readBlob(name, fallback) {
  let r;
  try { r = await get(name, { access: 'private', useCache: false }); }
  catch (e) {
    if (/404|not.?found|does not exist/i.test(String(e?.message || e))) return fallback;
    throw new BlobReadError(`${name}: ${e?.message || e}`);
  }
  if (!r || r.statusCode === 404) return fallback;
  if (r.statusCode !== 200 || !r.stream) throw new BlobReadError(`${name}: status ${r?.statusCode}`);
  const text = await new Response(r.stream).text();
  if (!text) return fallback;
  try { return JSON.parse(text); } catch (e) { throw new BlobReadError(`${name}: corrupt JSON`); }
}
async function writeBlob(name, data) {
  await put(name, JSON.stringify(data), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
}
function ptDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
}

export default async function handler(req, res) {
  const key = req.headers['x-app-key'] || req.query.k;
  if (!process.env.APP_KEY || key !== process.env.APP_KEY) return res.status(401).json({ error: 'missing or bad key' });

  const startedAt = new Date();
  const ts = startedAt.toISOString();
  const report = { ranAt: ts, sports: {}, newPicks: [], reconfirmed: 0, faded: 0, restored: 0, flags: [], errors: [] };

  let snapDoc, picksDoc, extDoc;
  try {
    snapDoc = await readBlob(SNAP_BLOB, { rev: 0, snapshots: [] });
    picksDoc = await readBlob(PICKS_BLOB, { rev: 0, days: {} });
    extDoc = await readBlob(EXT_BLOB, { rev: 0, rows: {} });
  } catch (e) {
    // abort WITHOUT writing anything — the next run will retry
    return res.status(503).json({ error: `blob read failed, run aborted (no writes): ${e.message}` });
  }

  // last GOOD read of every game (any sport, last 3 days) for the continuity guard
  const lastGood = {};
  for (const s of snapDoc.snapshots) for (const g of s.games || []) if (g.gamecode) lastGood[g.gamecode] = g;

  const useOdds = req.query.odds !== '0';
  report.oddsApi = { used: useOdds, remaining: null, sports: {} };

  // ---- 1. VSiN (deciding source) ----
  const freshGames = [];
  const freshByCode = {};
  for (const sport of SPORTS) {
    try {
      const games = parseSplits(await fetchSplitsHTML(sport), sport, startedAt);
      const kept = [];
      let scrubbed = 0;
      for (const raw of games) {
        const { game: g, usable, issues, absent } = scrubGame(raw);
        if (!usable) { report.flags.push({ gamecode: g.gamecode, game: `${g.away} @ ${g.home}`, issues: issues.length ? issues : ['no usable market'] }); continue; }
        if (issues.length) { scrubbed++; g.scrubbed = issues; }
        if (absent.length) g.absent = absent;
        const prev = lastGood[g.gamecode];
        if (prev) {
          const pairs = [
            [prev.spread?.away?.bets, g.spread.away.bets], [prev.total?.over?.bets, g.total.over.bets], [prev.ml?.away?.bets, g.ml.away.bets],
          ];
          if (pairs.some(([a, b]) => a != null && b != null && Math.abs(a - b) > CONTINUITY_MAX_SWING)) {
            report.flags.push({ gamecode: g.gamecode, game: `${g.away} @ ${g.home}`, issues: [`continuity: bets% swing >${CONTINUITY_MAX_SWING} vs last good read — excluded, last good read carried forward`] });
            kept.push({ ...prev, carried: true, carriedAt: ts }); // keep a reference so the guard still has a baseline next run
            continue;
          }
        }
        kept.push(g);
      }
      report.sports[sport] = { parsed: games.length, kept: kept.length, scrubbed };
      for (const g of kept) if (!g.carried) { freshGames.push(g); freshByCode[g.gamecode] = g; }
      if (kept.length) snapDoc.snapshots.push({ ts, sport, games: kept });
    } catch (e) {
      report.sports[sport] = { error: String(e.message || e) };
      report.errors.push(`${sport}: ${e.message || e}`);
    }
  }
  // snapshots: keep 3 days (only the latest per game is ever read)
  const cutoff = Date.now() - 3 * 24 * 3600e3;
  snapDoc.snapshots = snapDoc.snapshots.filter(s => new Date(s.ts).getTime() >= cutoff);
  snapDoc.rev = (snapDoc.rev || 0) + 1;

  // ---- 2. Action Network (second source, code-pulled; only leagues with games on VSiN) ----
  report.action = {};
  {
    let changed = 0;
    const active = new Set(freshGames.map(g => g.sport));
    for (const sport of Object.keys(AN_LEAGUE)) {
      if (!active.has(sport)) { report.action[sport] = { skipped: 'no VSiN games' }; continue; }
      try {
        const parsed = parseActionSplits(await fetchActionHTML(sport), sport);
        for (const r of parsed.rows) {
          const k = ['actionnetwork', sport, r.date, nick(r.away), nick(r.home), r.market, r.dhIndex || 0].join('|');
          const prevRow = extDoc.rows[k];
          const same = prevRow && prevRow.a?.bets === r.a.bets && prevRow.b?.bets === r.b.bets && prevRow.a?.money === r.a.money && prevRow.b?.money === r.b.money;
          if (same) continue;
          extDoc.rows[k] = { source: 'actionnetwork', league: sport, away: r.away, home: r.home, date: r.date, market: r.market, line: r.line, a: r.a, b: r.b, numBets: r.numBets, dhIndex: r.dhIndex || 0, pulledAt: ts };
          changed++;
        }
        report.action[sport] = { games: parsed.games, rows: parsed.rows.length, changed };
      } catch (e) {
        report.action[sport] = { error: String(e.message || e) };
        report.errors.push(`action ${sport}: ${e.message || e}`);
      }
    }
    const cut = new Date(Date.now() - 4 * 24 * 3600e3).toISOString().slice(0, 10);
    for (const k of Object.keys(extDoc.rows)) {
      const r = extDoc.rows[k];
      // drop stale rows, and legacy keys (pre-dhIndex format: 5 pipes) so a game never has two rows
      if (r.date < cut || (r.source === 'actionnetwork' && k.split('|').length === 6)) { delete extDoc.rows[k]; changed++; }
    }
    if (changed) { extDoc.rev = (extDoc.rev || 0) + 1; await writeBlob(EXT_BLOB, extDoc); }
    report.externalRows = Object.keys(extDoc.rows).length;
  }

  // ---- 3. frozen formula: NEW picks ----
  const today = ptDateStr(startedAt);
  const day = picksDoc.days[today] || (picksDoc.days[today] = { picks: [] });
  const allPicks = [];
  for (const d of Object.values(picksDoc.days)) for (const p of d.picks) allPicks.push(p);
  const seen = new Set(allPicks.filter(p => !p.result).map(p => `${p.gamecode}|${p.type}`));

  const sharpBoards = {};
  async function board(sport) {
    if (!useOdds) return null;
    if (!(sport in sharpBoards)) {
      try {
        const b = await loadSharpBoard(sport);
        sharpBoards[sport] = b;
        report.oddsApi.remaining = b.remaining ?? report.oddsApi.remaining;
        report.oddsApi.sports[sport] = b.note;
      } catch (e) { sharpBoards[sport] = null; report.oddsApi.sports[sport] = `error: ${e.message || e}`; }
    }
    return sharpBoards[sport];
  }
  const contention = {};
  async function contentionNote(sport, away, home) {
    if (!(sport in contention)) {
      try { contention[sport] = await loadContention(sport); }
      catch (e) { contention[sport] = null; report.errors.push(`standings ${sport}: ${e.message || e}`); }
    }
    const c = contention[sport];
    if (!c) return null;
    const a = c.forTeam(away), h = c.forTeam(home);
    const outs = [];
    if (a?.out) outs.push(`${away} (${a.why})`);
    if (h?.out) outs.push(`${home} (${h.why})`);
    return outs.length ? `⚾ CONTENTION: ${outs.join(' & ')} out of the playoff race — late-season lineups make public signals less reliable` : null;
  }
  function sharpNoteFor(p, info) {
    if (!info) return '';
    if (p.type === 'Total' && info.totalSharpDelta != null) {
      const weUnder = p.side === 'under';
      const leansUnder = info.totalSharpDelta < -0.25, leansOver = info.totalSharpDelta > 0.25;
      if ((weUnder && leansUnder) || (!weUnder && leansOver)) return `✓ sharp agrees (Pinnacle total ${info.sharp.total} vs retail ${info.retail.total})`;
      if ((weUnder && leansOver) || (!weUnder && leansUnder)) return `⚠ sharp disagrees (Pinnacle total ${info.sharp.total} vs retail ${info.retail.total})`;
      return '';
    }
    if (p.type === 'Moneyline' || p.type === 'Spread') {
      const edge = p.side === 'home' ? info.homeSharpEdge : info.awaySharpEdge;
      if (edge != null && edge >= 1.0) return `✓ sharp agrees (Pinnacle +${edge}% on our side vs retail, no-vig)`;
      if (edge != null && edge <= -1.0) return `⚠ sharp on the other side (${edge}% vs retail, no-vig)`;
    }
    return '';
  }

  for (const g of freshGames) {
    for (const p of evalGame(g, startedAt)) {
      const k = `${p.gamecode}|${p.type}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const keyNote = keyNumberNote(p.sport, p.type, p.line);
      const b = await board(p.sport); // lazy: metered feed is only touched when a NEW pick exists
      const info = b?.forGame ? b.forGame(p.away, p.home, p.date) : null;
      const sharp = info ? { homeSharpEdge: info.homeSharpEdge, awaySharpEdge: info.awaySharpEdge, totalSharpDelta: info.totalSharpDelta, books: info.books } : null;
      const sharpNote = sharpNoteFor(p, info);
      const contNote = await contentionNote(p.sport, p.away, p.home);
      const extNote = externalNote(extDoc, p);
      const pick = {
        ...p,
        status: 'active', firstTier: p.tier, postedAt: ts, lastSeenAt: ts, confirmedRuns: 0,
        checks: [{ ts, T: p.T, H: p.H, D: p.D, tier: p.tier, ok: true }],
        game: `${p.away} @ ${p.home} — ${p.date} (${p.sport})`,
        signal: `PUBLIC ${p.T}% of tickets on ${p.publicSide}${p.publicLine ? ' ' + p.publicLine : ''} but only ${p.H}% of the money — we take ${p.pick}${p.line ? ' ' + p.line : ''} · ${p.D} pt gap`
          + (p.downgraded.length ? ` · downgraded to watch (${p.downgraded.join(', ')})` : '')
          + (keyNote ? ` · ${keyNote}` : '') + (sharpNote ? ` · ${sharpNote}` : '') + (extNote ? ` · ${extNote}` : '') + (contNote ? ` · ${contNote}` : ''),
        sharp, sharpNote: sharpNote || null, contention: contNote || null, external: extNote || null,
        confirmation: confirmationLevel(extNote),
      };
      day.picks.push(pick);
      report.newPicks.push({ tier: pick.tier, type: pick.type, pick: pick.pick, line: pick.line, game: pick.game, D: pick.D, sharp: sharpNote || null, contention: contNote || null, confirmation: pick.confirmation.level });
    }
  }
  report.contentionAlerts = report.newPicks.filter(p => p.contention).map(p => `${p.pick} — ${p.game}`);

  // ---- 4. RE-CONFIRM every open pick against this run's read (Carl 2026-09-02: post early, re-confirm
  //         every run until game time). Tier follows the latest read; a pick that no longer qualifies is
  //         marked 'faded' (kept, flagged) and restored if it qualifies again. Never re-posted as new.
  for (const p of allPicks) {
    if (p.result) continue;
    const g = freshByCode[p.gamecode];
    if (!g) continue; // not on today's page (started / off the board) — leave as is
    const fresh = evalGame(g, startedAt).find(x => x.type === p.type);
    // legacy picks (before 2026-09-02) have no `side` field — compare the pick label instead, then backfill
    const sameSide = fresh ? (p.side ? fresh.side === p.side : fresh.pick === p.pick) : false;
    const now = fresh
      ? { ts, T: fresh.T, H: fresh.H, D: fresh.D, tier: fresh.tier, ok: true, sameSide }
      : { ts, ok: false };
    p.checks = [...(p.checks || []), now].slice(-MAX_CHECKS);
    p.lastSeenAt = ts;
    if (p.date !== g.date) { p.dateWas = p.date; p.date = g.date; p.game = `${g.away} @ ${g.home} — ${g.date} (${g.sport})`; } // legacy first-header date bug — fix even when faded so grading finds the right day
    if (fresh && sameSide) {
      if (!p.side) { p.side = fresh.side; p.pickTeam = fresh.pickTeam ?? null; p.total = fresh.total ?? p.total ?? null; p.dhIndex = g.dhIndex ?? 0; }
      const wasFaded = p.status === 'faded';
      p.status = 'active';
      if (wasFaded) { report.restored++; p.restoredAt = ts; }
      p.confirmedRuns = (p.confirmedRuns || 0) + 1;
      if (fresh.tier !== p.tier) { p.tierHistory = [...(p.tierHistory || []), { ts, from: p.tier, to: fresh.tier }].slice(-20); p.tier = fresh.tier; }
      p.T = fresh.T; p.H = fresh.H; p.D = fresh.D; p.line = fresh.line ?? p.line; p.publicLine = fresh.publicLine ?? p.publicLine;
      const extNote = externalNote(extDoc, p);
      p.external = extNote || null; p.confirmation = confirmationLevel(extNote);
      p.lastConfirmedAt = ts;
      report.reconfirmed++;
    } else if (p.status !== 'faded') {
      p.status = 'faded'; p.fadedAt = ts;
      p.fadeReason = fresh ? `public flipped to ${fresh.publicSide}` : 'no longer qualifies (T<60 or gap<8)';
      report.faded++;
    }
  }

  // ---- 5. GRADE finished picks (ESPN, free) ----
  report.graded = [];
  try {
    const results = await gradePicks(allPicks.filter(p => !p.result));
    for (const { pick, result } of results) {
      pick.result = result; pick.gradedAt = ts;
      report.graded.push({ result, pick: pick.pick, game: pick.game, tier: pick.tier, status: pick.status });
    }
  } catch (e) { report.errors.push(`grading: ${e.message || e}`); }

  // ---- 6. write shadow docs ----
  for (const d of Object.keys(picksDoc.days)) if (new Date(d) < new Date(Date.now() - 14 * 24 * 3600e3)) delete picksDoc.days[d];
  picksDoc.rev = (picksDoc.rev || 0) + 1;
  picksDoc.lastRun = report;
  picksDoc.heartbeat = ts;
  await writeBlob(SNAP_BLOB, snapDoc);
  await writeBlob(PICKS_BLOB, picksDoc);

  report.tookMs = Date.now() - startedAt.getTime();
  return res.status(200).json(report);
}

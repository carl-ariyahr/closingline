// Written commentary (Carl 2026-09-07: "add the written commentary back too"). The original AI card carried a short read
// on each play and a nightly journal entry (graded list, record, read, recommendations). A cloud routine on Carl's account
// writes both; this module supplies its context from the code's own data and stores what it writes. Commentary never
// changes a pick, a tier, or a grade.
import { clvSummary } from './clv.mjs';

const PT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
export const todayPT = (now = new Date()) => PT.format(now);

const codePicks = live => (live?.cards || []).filter(c => /^code-/.test(String(c.id))).flatMap(c => c.picks || []);
const slim = lp => ({
  srcKey: lp.srcKey, rank: lp.dailyCard?.rank ?? null, pick: lp.pick, type: lp.type, side: lp.side, line: lp.line ?? null, total: lp.total ?? null,
  game: lp.game, sport: lp.sport, date: lp.date, start: lp.start || null, away: lp.away, home: lp.home,
  T: lp.T, H: lp.H, D: lp.D, status: lp.status, signal: lp.signal || '', sharpNote: lp.sharpNote || null, external: lp.external || null,
  confirmation: lp.confirmation || null, contention: lp.contention || null, sharpMove: lp.sharpMove || null, flag98: !!lp.flag98,
  liveCheck: lp.liveCheck ? { ok: lp.liveCheck.ok, why: lp.liveCheck.why || null, gate: lp.liveCheck.gate || null, T: lp.liveCheck.T, H: lp.liveCheck.H, D: lp.liveCheck.D, n: lp.liveCheck.n || 0, ts: lp.liveCheck.ts } : null,
  result: lp.result || null, noBet: !!lp.noBet, clv: lp.clv || null, commentary: lp.commentary || null,
});

// Context for writing the card commentary: the card, its plays with everything the code knows, and the line path so far.
export function cardContext(live, history, day, { onlyMissing = false } = {}) {
  const card = live?.dailyCards?.[day]; if (!card) return null;
  const byKey = new Map(codePicks(live).map(lp => [lp.srcKey, lp]));
  const plays = card.picks.map(cp => {
    const lp = byKey.get(cp.srcKey); const s = lp ? slim(lp) : { srcKey: cp.srcKey, pick: cp.pick, game: cp.game, rank: cp.rank };
    const h = lp && history?.[lp.gamecode]; const mk = /total/i.test(lp?.type || '') ? 'Total' : /money/i.test(lp?.type || '') ? 'Moneyline' : 'Spread';
    s.linePath = h?.[mk] ? h[mk].map(([ts, v]) => ({ ts, v })) : [];
    return s;
  });
  return { day, builtAt: card.builtAt, updatedAt: card.updatedAt || card.builtAt, cap: card.cap, candidates: card.candidates, pushedAt: card.pushedAt || null, hasCommentary: plays.every(p => p.commentary), plays: onlyMissing ? plays.filter(p => !p.commentary) : plays };
}
// The latest card (by day) that has a play without commentary, else null.
export function pendingCommentaryDay(live) {
  const byKey = new Map(codePicks(live).map(lp => [lp.srcKey, lp]));
  const days = Object.keys(live?.dailyCards || {}).sort().reverse();
  for (const day of days) { const c = live.dailyCards[day]; if ((c.picks || []).some(cp => !byKey.get(cp.srcKey)?.commentary)) return day; }
  return null;
}
// Store commentary: map srcKey -> text (trimmed, capped). Returns the number of plays stamped.
export function applyCommentary(live, day, map, now = new Date(), maxLen = 600) {
  const card = live?.dailyCards?.[day]; if (!card || !map) return 0;
  const keys = new Set(card.picks.map(p => p.srcKey));
  let n = 0;
  for (const lp of codePicks(live)) {
    if (!keys.has(lp.srcKey) || typeof map[lp.srcKey] !== 'string') continue;
    const text = map[lp.srcKey].replace(/\s+/g, ' ').trim().slice(0, maxLen);
    if (!text) continue;
    lp.commentary = { text, at: now.toISOString(), by: 'routine' }; n++;
  }
  if (n && typeof map.__card === 'string') card.note = map.__card.replace(/\s+/g, ' ').trim().slice(0, maxLen);
  return n;
}

// Context for the nightly journal: today's card plays with results, the plays ledger, CLV, by-rank record, yesterday's entry.
export function journalContext(live, journal, day) {
  const all = codePicks(live);
  const shown = (live?.cards || []).flatMap(c => c.picks || []).filter(p => p.playsShownAt);
  const rec = arr => { const r = { w: 0, l: 0, p: 0 }; for (const x of arr) { if (x.result === 'win') r.w++; else if (x.result === 'loss') r.l++; else if (x.result === 'push') r.p++; } r.units = +(r.w * 0.909 - r.l).toFixed(2); return r; };
  const counted = shown.filter(p => !p.noBet && p.result && p.result !== 'pending');
  const onCard = p => p.dailyCard && !p.dailyCard.replaced; // a play retired from the card (replaceCard) is not a card play
  const today = all.filter(p => p.date === day && onCard(p)).map(slim);
  const byRank = {}; for (const p of counted.filter(onCard)) (byRank[p.dailyCard.rank] = byRank[p.dailyCard.rank] || []).push(p);
  const entries = journal?.entries || [];
  const prev = entries.filter(e => e.date < day).slice(-1)[0] || null;
  return {
    day, card: live?.dailyCards?.[day] || null, plays: today,
    todayRecord: rec(today.filter(p => !p.noBet)), notCounted: today.filter(p => p.noBet).length,
    ledgerSince: '2026-09-02', ledgerRecord: rec(counted), cardEraRecord: rec(counted.filter(onCard)),
    byRank: Object.fromEntries(Object.entries(byRank).map(([k, v]) => [k, rec(v)])),
    clv: clvSummary(counted), previousEntry: prev ? { date: prev.date, read: prev.read, recommendations: prev.recommendations } : null,
  };
}
// Upsert one entry by date (replace), keep entries sorted, cap at 120. Returns the stored entry.
export function upsertJournal(journal, entry, now = new Date()) {
  if (!entry?.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) throw new Error('entry.date required (YYYY-MM-DD)');
  const clean = {
    date: entry.date,
    graded: Array.isArray(entry.graded) ? entry.graded.slice(0, 50).map(g => ({ pick: String(g.pick || '').slice(0, 120), game: String(g.game || '').slice(0, 160), result: ['win', 'loss', 'push'].includes(g.result) ? g.result : 'pending' })) : [],
    record: entry.record && typeof entry.record === 'object' ? entry.record : undefined,
    read: String(entry.read || '').slice(0, 4000),
    clvNotes: entry.clvNotes ? String(entry.clvNotes).slice(0, 1500) : undefined,
    trendNotes: entry.trendNotes ? String(entry.trendNotes).slice(0, 1500) : undefined,
    recommendations: Array.isArray(entry.recommendations) ? entry.recommendations.slice(0, 12).map(r => String(r).slice(0, 500)) : [],
    writtenAt: now.toISOString(), by: 'routine',
  };
  journal.entries = (journal.entries || []).filter(e => e.date !== clean.date);
  journal.entries.push(clean);
  journal.entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (journal.entries.length > 120) journal.entries = journal.entries.slice(-120);
  journal.rev = (journal.rev || 0) + 1; journal.updated = now.toISOString();
  return clean;
}

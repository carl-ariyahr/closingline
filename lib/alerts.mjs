// Sharp-move push alerts, durable (Carl 2026-09-05: push-alert every NEW early sharp move; rebuilt 2026-09-07 after the
// account switch). The pipeline stamps `alertedFor` on a sharp-moves card entry when an early move (>96h out) is new.
// This reads every stamped entry that has not been pushed yet, and `mark` stamps `pushedAt` so a move is pushed once,
// no matter which pipeline run (old account's :20 or the Vercel cron's :25) raised it.
const PT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmt = (mk, v) => (mk === 'Total' ? String(v) : (v > 0 ? '+' : '') + v);

export function pendingAlerts(live, now = new Date()) {
  const card = (live?.cards || []).find(c => c.id === 'sharp-moves');
  const out = [];
  for (const p of card?.picks || []) {
    if (!p.alertedFor || p.pushedAt === p.alertedFor || p.result) continue;
    if (p.start && new Date(p.start) <= now) continue; // game started: too late to tail
    const s = p.sharp || {};
    out.push({
      key: p.sharpKey, pick: p.pick, game: p.game, sport: p.sport, date: p.date, start: p.start || null,
      market: s.market || p.type, from: s.from, to: s.to, tix: s.tix, moves: s.moves, hoursBefore: s.hoursBefore,
      daysBefore: s.hoursBefore != null ? Math.round(s.hoursBefore / 24 * 10) / 10 : null,
      alertedFor: p.alertedFor,
      text: `${p.pick} — ${p.game}: ${String(s.market || p.type).toLowerCase()} ${fmt(s.market, s.from)} → ${fmt(s.market, s.to)} against ${s.tix}% of tickets` +
        (s.hoursBefore != null ? `, ${Math.round(s.hoursBefore / 24 * 10) / 10} days before kickoff` : '') +
        (s.lastAt ? ` (moved ${PT.format(new Date(s.lastAt))} PT)` : ''),
    });
  }
  return out;
}

// Stamp the given alerts as pushed. Returns the number stamped.
export function markPushed(live, alerts, now = new Date()) {
  const card = (live?.cards || []).find(c => c.id === 'sharp-moves');
  const want = new Map(alerts.map(a => [a.key, a.alertedFor]));
  let n = 0;
  for (const p of card?.picks || []) {
    if (want.has(p.sharpKey) && want.get(p.sharpKey) === p.alertedFor && p.pushedAt !== p.alertedFor) { p.pushedAt = p.alertedFor; p.pushedTs = now.toISOString(); n++; }
  }
  return n;
}

// The daily card (lib/dailycard.mjs), pushed once when built. Returns the card or null.
export function pendingCard(live) {
  for (const card of Object.values(live?.dailyCards || {})) if (card && !card.pushedAt) return card;
  return null;
}
export function markCardPushed(live, card, now = new Date()) {
  const c = live?.dailyCards?.[card?.day]; if (!c || c.pushedAt) return 0;
  c.pushedAt = now.toISOString(); return 1;
}

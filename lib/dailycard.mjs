// THE DAILY CARD (Carl 2026-09-07: "rebuild the AI one I first started with as closely as possible").
// The original Aug 26 - Sep 3 cards were generated once a day at 5:00 PM Pacific for the NEXT day's games, featured only
// the 'play' tier (gap >= 25), ranked by gap ("conviction = how far the money lags the public"), 2-5 plays a day, and
// went 25-17. This rebuilds that in code on the pipeline's own picks:
//   • built by the first pipeline run at or after 5pm PT that finds at least one candidate; then LOCKED for that day
//   • candidates: code-card picks for tomorrow (PT) with status 'play' (gates and spread cap already applied), not started
//   • ranked by gap D, capped at CAP (Carl: 4); the card's plays are the ONLY code picks shown on Carl's plays and are
//     counted in the plays ledger the moment they are stamped (playsShownAt). Everything else stays tracked on The card tab.
//   • hourly re-checks still apply: a card play whose signal fades or flips before kickoff is DO NOT BET, not counted.
export const CAP = 4;
export const BUILD_HOUR_PT = 17;

export const nextDayPT = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(now.getTime() + 24 * 3600e3));

export function candidates(live, day, now = new Date()) {
  const out = [];
  for (const c of live.cards || []) {
    if (!/^code-/.test(String(c.id)) || !Array.isArray(c.picks)) continue;
    for (const lp of c.picks) {
      if (lp.src !== 'code' || lp.date !== day || lp.status !== 'play') continue;
      if (lp.result && lp.result !== 'pending') continue;
      if (lp.start && new Date(lp.start) <= now) continue;
      if (lp.liveCheck && !lp.liveCheck.ok) continue; // faded/flipped on the latest read: not a candidate at build time
      out.push(lp);
    }
  }
  // gap first, then earlier posting (a signal that has held longer), then label for determinism
  return out.sort((a, b) => (b.D ?? 0) - (a.D ?? 0) || String(a.postedAt || '').localeCompare(String(b.postedAt || '')) || String(a.pick).localeCompare(String(b.pick)));
}

export function shouldBuild(live, day, hourPT) {
  return hourPT >= BUILD_HOUR_PT && !live.dailyCards?.[day];
}

// Build and lock the card for `day`. Returns null when no candidate exists (nothing is locked; the next run retries),
// else the stored card {day, builtAt, cap, picks:[{srcKey, rank, pick, game, type, D, T, H}]}.
export function buildDailyCard(live, day, now = new Date(), cap = CAP) {
  const cands = candidates(live, day, now);
  if (!cands.length) return null;
  const ts = now.toISOString();
  const chosen = cands.slice(0, cap);
  chosen.forEach((lp, i) => { lp.dailyCard = { day, rank: i + 1, builtAt: ts, D: lp.D ?? null }; if (!lp.playsShownAt) lp.playsShownAt = ts; });
  const card = { day, builtAt: ts, cap, candidates: cands.length, picks: chosen.map(lp => ({ srcKey: lp.srcKey, rank: lp.dailyCard.rank, pick: lp.pick, game: lp.game, type: lp.type, sport: lp.sport, start: lp.start || null, D: lp.D ?? null, T: lp.T ?? null, H: lp.H ?? null })) };
  live.dailyCards = live.dailyCards || {};
  live.dailyCards[day] = card;
  live.dailyCardSince = live.dailyCardSince || ts; // dashboard: code picks shown before this moment keep showing until graded
  for (const k of Object.keys(live.dailyCards)) if (k < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(now.getTime() - 21 * 86400e3))) delete live.dailyCards[k];
  return card;
}

const PT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' });
const PTT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
// Push text for the alert routine
export function cardText(card) {
  const head = `🃏 Card for ${PT.format(new Date(card.day + 'T12:00:00-07:00'))} — ${card.picks.length} play${card.picks.length === 1 ? '' : 's'} (top ${card.cap} by gap of ${card.candidates} qualifiers, built ${PTT.format(new Date(card.builtAt))} PT)`;
  const lines = card.picks.map(p => `${p.rank}. ${p.pick} — ${String(p.game).replace(/\s+—.*$/, '')} (${p.sport}${p.start ? ', ' + PTT.format(new Date(p.start)) + ' PT' : ''}) · crowd ${p.T}% / money ${p.H}% · gap ${p.D}`);
  return [head, ...lines].join('\n');
}

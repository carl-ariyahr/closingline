// THE DAILY CARD (Carl 2026-09-07: "rebuild the AI one I first started with as closely as possible"; 2026-09-08: "start build
// at 7am PST same day"). The original Aug 26 - Sep 3 cards featured only the 'play' tier (gap >= 25), ranked by gap
// ("conviction = how far the money lags the public"), 2-5 plays a day, and went 25-17. The first rebuild built at 5pm the
// day before; on its first morning all four plays had faded overnight (next-day money is thin at 5pm), so Carl moved it:
//   • the card for TODAY (PT) opens at BUILD_HOUR_PT and fills from that run on: every run inside the build window adds the
//     clean play-tier candidates by gap until CAP is reached; after CLOSE_HOUR_PT nothing is added. A play is locked the
//     moment it is added (shown = counted, Carl 2026-09-02)
//   • candidates: code-card picks for today whose CURRENT read is ok at play tier (gates applied), not started, and that
//     carry at least MIN_BOXES independent public reads (lib/boxes.mjs); CAP 3 (Carl 2026-09-08: "1-3 good picks a day")
//   • the card's plays are the ONLY code picks shown on Carl's plays; everything else stays tracked on The card tab
//   • hourly re-checks still apply: a card play whose signal fades or flips before kickoff is DO NOT BET, not counted
import { boxesFor } from './boxes.mjs';
export const CAP = 3;              // Carl 2026-09-08: 1-3 good picks a day
export const MIN_BOXES = 2;        // independent public reads that must agree, on top of play tier (lib/boxes.mjs)
export const BUILD_HOUR_PT = 7;   // Carl 2026-09-08
export const CLOSE_HOUR_PT = 13;   // last additions on the 12:25pm PT run

const PTD = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
export const cardDayPT = (now = new Date()) => PTD.format(now);           // the card is for TODAY (Carl 2026-09-08)
export const nextDayPT = (now = new Date()) => PTD.format(new Date(now.getTime() + 24 * 3600e3));

export function candidates(live, day, now = new Date()) {
  const out = [];
  for (const c of live.cards || []) {
    if (!/^code-/.test(String(c.id)) || !Array.isArray(c.picks)) continue;
    for (const lp of c.picks) {
      if (lp.src !== 'code' || lp.date !== day) continue;
      if (lp.dailyCard && !lp.dailyCard.replaced) continue; // already on the card
      if (lp.result && lp.result !== 'pending') continue;
      if (lp.start && new Date(lp.start) <= now) continue;
      // the CURRENT read decides, not the card status (a play shown days ago keeps status 'play' by Carl's never-downgrade
      // rule even after its gap shrinks): the latest re-check must be ok AND at play tier (gap >= 25, every gate passed)
      if (!lp.liveCheck?.ok || lp.liveCheck.tier !== 'play') continue;
      const bx = boxesFor(lp); if (bx.n < MIN_BOXES) continue; // strict bar (Carl 2026-09-08)
      lp._boxes = bx; out.push(lp);
    }
  }
  // most boxes first, then gap, then earlier posting (a signal that has held longer), then label for determinism
  return out.sort((a, b) => b._boxes.n - a._boxes.n || (b.D ?? 0) - (a.D ?? 0) || String(a.postedAt || '').localeCompare(String(b.postedAt || '')) || String(a.pick).localeCompare(String(b.pick)));
}

const onCard = card => (card?.picks || []).length;
export function shouldBuild(live, day, hourPT, cap = CAP) {
  return hourPT >= BUILD_HOUR_PT && hourPT < CLOSE_HOUR_PT && onCard(live.dailyCards?.[day]) < cap;
}

// Add to (or start) the card for `day`: the clean play-tier candidates by gap, up to CAP in total. Returns null when
// nothing was added (the next run inside the window retries), else the stored card
// {day, builtAt, updatedAt, cap, picks:[{srcKey, rank, pick, game, type, sport, start, D, T, H, addedAt}]}.
export function buildDailyCard(live, day, now = new Date(), cap = CAP) {
  live.dailyCards = live.dailyCards || {};
  const card = live.dailyCards[day] || { day, builtAt: now.toISOString(), cap, candidates: 0, picks: [] };
  const room = cap - card.picks.length; if (room <= 0) return null;
  const cands = candidates(live, day, now);
  if (!cands.length) return null;
  const ts = now.toISOString();
  const chosen = cands.slice(0, room);
  const base = card.picks.length;
  chosen.forEach((lp, i) => {
    const rank = base + i + 1;
    const bx = lp._boxes || boxesFor(lp); delete lp._boxes;
    lp.dailyCard = { day, rank, builtAt: ts, D: lp.D ?? null, boxes: { n: bx.n, got: bx.got, miss: bx.miss, ratio: bx.ratio } }; if (!lp.playsShownAt) lp.playsShownAt = ts;
    card.picks.push({ srcKey: lp.srcKey, rank, pick: lp.pick, game: lp.game, type: lp.type, sport: lp.sport, start: lp.start || null, D: lp.D ?? null, T: lp.T ?? null, H: lp.H ?? null, boxes: bx.got, addedAt: ts });
  });
  card.candidates = Math.max(card.candidates || 0, card.picks.length - chosen.length + cands.length);
  card.updatedAt = ts; card.added = chosen.length;
  live.dailyCards[day] = card;
  live.dailyCardSince = live.dailyCardSince || ts; // dashboard: code picks shown before this moment keep showing until graded
  for (const k of Object.keys(live.dailyCards)) if (k < PTD.format(new Date(now.getTime() - 21 * 86400e3))) delete live.dailyCards[k];
  return card;
}
// Retire a card's picks from it (they keep playsShownAt: shown = counted) so the card can be rebuilt. Returns picks retired.
export function replaceCard(live, day, now = new Date()) {
  const card = live.dailyCards?.[day]; if (!card) return 0;
  const keys = new Set(card.picks.map(p => p.srcKey)); let n = 0;
  for (const c of live.cards || []) for (const lp of c.picks || []) if (lp.dailyCard && keys.has(lp.srcKey) && !lp.dailyCard.replaced) { lp.dailyCard.replaced = now.toISOString(); delete lp.commentary; n++; }
  card.replacedAt = now.toISOString(); card.replacedPicks = card.picks; card.picks = []; card.updatedAt = now.toISOString(); delete card.pushedAt;
  return n;
}

const PT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' });
const PTT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
// Push text for the alert routine
export function cardText(card) {
  const head = `🃏 Card for ${PT.format(new Date(card.day + 'T12:00:00-07:00'))} — ${card.picks.length} play${card.picks.length === 1 ? '' : 's'}${card.added && card.added < card.picks.length ? ` (${card.added} new)` : ''} (top ${card.cap}: play tier + at least 2 public reads agreeing, ranked by reads then gap, updated ${PTT.format(new Date(card.updatedAt || card.builtAt))} PT)`;
  const lines = card.picks.map(p => `${p.rank}. ${p.pick} — ${String(p.game).replace(/\s+—.*$/, '')} (${p.sport}${p.start ? ', ' + PTT.format(new Date(p.start)) + ' PT' : ''}) · crowd ${p.T}% / money ${p.H}% · gap ${p.D}${p.boxes?.length ? ` · ${p.boxes.length} reads agree: ${p.boxes.join(', ')}` : ''}`);
  return [head, ...lines].join('\n');
}

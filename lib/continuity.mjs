// Continuity guard for VSiN reads. Tickets are cumulative, so a bets% jump of more than MAX_SWING between
// hourly reads is USUALLY a misread — but not always: DraftKings resets its splits overnight and a real move
// can be big. The old guard rejected a swung read forever (its baseline never moved), which froze 11 of 15
// MLB games on stale numbers for 17 hours on 2026-09-03/04. Rule now:
//   1st swung read  → excluded, last good read carried forward, the new numbers remembered as "pending"
//   2nd read that agrees with the pending numbers → accepted (two consistent reads = a real move)
//   after MAX_CARRY carried runs → accepted regardless (never freeze a game for good)
export const MAX_SWING = 20;
export const MAX_CARRY = 2;

export const bets3 = g => [g?.spread?.away?.bets, g?.total?.over?.bets, g?.ml?.away?.bets];
export function swung(a3, b3, max = MAX_SWING) {
  return a3.some((a, i) => a != null && b3[i] != null && Math.abs(a - b3[i]) > max);
}

// prev: the last snapshot entry for this game (may itself be a carried entry). g: this run's parse.
// Returns { accept: true, why? } or { accept: false, carry: <entry to snapshot>, why }.
export function continuityDecide(prev, g, ts) {
  if (!prev) return { accept: true };
  const fresh = bets3(g);
  if (!swung(bets3(prev), fresh)) return { accept: true };
  const runs = prev.carriedRuns || 0;
  if (prev.pendingBets && !swung(prev.pendingBets, fresh)) return { accept: true, why: 'continuity: new numbers held on a second read — accepted as a real move' };
  if (runs >= MAX_CARRY) return { accept: true, why: `continuity: accepted after ${runs} carried runs (never freeze a game on stale numbers)` };
  const { pendingBets: _p, carried: _c, carriedAt: _a, carriedRuns: _r, started: _s, excluded: _x, ...base } = prev;
  return {
    accept: false,
    why: `continuity: bets% swing >${MAX_SWING} vs last good read — excluded this run, last good read carried forward (${runs + 1}/${MAX_CARRY})`,
    carry: { ...base, carried: true, carriedAt: ts, carriedRuns: runs + 1, pendingBets: fresh },
  };
}

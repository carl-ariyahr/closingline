// Independent public reads ("boxes", Carl 2026-09-08: "1-3 good picks a day ... I only want winners"). Each box is a
// separate way of seeing that the crowd is on the other side AND the market is not with the crowd. The daily card
// requires MIN_BOXES of them on top of play tier. Thresholds are starting points, NOT validated: on the 62 graded plays
// available on 2026-09-08 no box count separated winners (3+ boxes went 5-5). Every card play is stamped with its boxes
// so the pattern report can test them once there are ~100 plays. The Kalshi box is listed only when a read exists (team picks with a matched market).
export const BOXES = Object.freeze({
  shading: 'sharp price on our side',       // Pinnacle no-vig vs retail: retail is charging the crowd (lib/oddsapi.mjs sharpNote "✓ sharp agrees")
  rlm: 'line moved our way',                // reverse line move toward our side against the ticket majority (lib/sharp.mjs stampSharpMoves)
  ticket: 'small tickets on the crowd',     // average bet on the crowd side < half the average bet on ours
  action: 'Action Network agrees',          // second splits source shows the same public side
  money65: 'money 65%+ ours',               // stronger than the 55% gate
  kalshi: 'Kalshi crowd on the other side', // exchange order flow: more contracts traded on the side we fade (lib/kalshi.mjs); team picks only
});
export const TICKET_RATIO_MAX = 0.5;

// Average bet on the public side relative to ours: (H/T) / ((100-H)/(100-T)). < 1 = the crowd's bets are smaller.
export function ticketRatio(T, H) {
  if (T == null || H == null || T <= 0 || T >= 100) return null;
  const ours = (100 - H) / (100 - T); if (ours <= 0) return null;
  return +((H / T) / ours).toFixed(3);
}
export function boxesFor(lp) {
  const T = lp.liveCheck?.T ?? lp.T, H = lp.liveCheck?.H ?? lp.H;
  const ratio = ticketRatio(T, H);
  const got = [], miss = [];
  (/^✓ sharp agrees/.test(lp.sharpNote || '') ? got : miss).push('shading');
  (lp.sharpMove ? got : miss).push('rlm');
  (ratio != null && ratio < TICKET_RATIO_MAX ? got : miss).push('ticket');
  ((lp.confirmation?.level || lp.confirmation) === 'confirmed' ? got : miss).push('action');
  (H != null && 100 - H >= 65 ? got : miss).push('money65');
  if (lp.kalshi !== undefined && lp.kalshi !== null) (lp.kalshi.agrees && !lp.kalshi.thin ? got : miss).push('kalshi'); // only listed when a read exists
  return { got, miss, n: got.length, ratio, total: got.length + miss.length };
}

// Closing line value (Carl 2026-09-07): did the number we posted beat the number the market closed at?
// Read from the line history (lib/yoyo.mjs recordLines: change points per game/market, pre-game reads only, so the
// last point is the close). Spread history is the HOME line; Moneyline history is the AWAY price (home-side CLV is
// read off the away price, so it is a sign-correct approximation in cents, not the exact home price).
import { cents } from './yoyo.mjs';

const marketOf = p => (/total/i.test(p.type || '') ? 'Total' : /money/i.test(p.type || '') ? 'Moneyline' : 'Spread');
// value in force at `ts` (the last change point at or before it); before the first point, the first point
function valueAt(series, ts) {
  let v = series[0][1];
  const t = new Date(ts).getTime();
  for (const [pts, val] of series) { if (new Date(pts).getTime() <= t) v = val; else break; }
  return v;
}

// Returns null when the game/market has no history, else {market, side, open, close, diff, unit, beat}
//   diff > 0: our number was better than the close (we beat the market); unit 'pts' or 'cents'
export function clvFor(history, p, postedTs) {
  const h = history?.[p.gamecode]; if (!h) return null;
  const market = marketOf(p); const series = h[market];
  if (!Array.isArray(series) || !series.length || !p.side || !postedTs) return null;
  const open = valueAt(series, postedTs), close = series[series.length - 1][1];
  if (open == null || close == null) return null;
  let diff, unit = 'pts';
  if (market === 'Total') diff = p.side === 'under' ? open - close : close - open;           // under wants a high number
  else if (market === 'Spread') diff = p.side === 'home' ? open - close : close - open;     // home line: higher = more points for home
  else { unit = 'cents'; const o = cents(open), c = cents(close); diff = p.side === 'away' ? o - c : c - o; } // away price on the cents scale
  diff = +diff.toFixed(unit === 'pts' ? 1 : 0);
  return { market, side: p.side, open, close, diff, unit, beat: diff > 0 ? 'beat' : diff < 0 ? 'worse' : 'same', closeAt: series[series.length - 1][0] };
}

// Summary over picks that carry .clv: counts, average points (spreads/totals) and cents (moneylines), record by outcome.
export function clvSummary(picks) {
  const out = { n: 0, beat: 0, worse: 0, same: 0, avgPts: null, avgCents: null, byOutcome: { beat: { w: 0, l: 0 }, worse: { w: 0, l: 0 }, same: { w: 0, l: 0 } } };
  let pts = [], cts = [];
  for (const p of picks) {
    const c = p.clv; if (!c) continue;
    out.n++; out[c.beat]++;
    (c.unit === 'pts' ? pts : cts).push(c.diff);
    if (p.result === 'win') out.byOutcome[c.beat].w++; else if (p.result === 'loss') out.byOutcome[c.beat].l++;
  }
  if (pts.length) out.avgPts = +(pts.reduce((a, b) => a + b, 0) / pts.length).toFixed(2);
  if (cts.length) out.avgCents = +(cts.reduce((a, b) => a + b, 0) / cts.length).toFixed(1);
  return out;
}

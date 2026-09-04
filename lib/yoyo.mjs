// Yo-yo line detection (Carl 2026-09-04, Patrick's Variables only): a line that moves away from its opening number and
// then moves BACK TOWARD it — all the way (-3 → -6 → -3) or partly (-6 → -10 → -9). Any size of move counts (Carl's call).
// Markets (Carl 2026-09-04 "all lines"): spread (home line), total, and the moneyline price (away side) in every sport.
// History keeps only CHANGE POINTS per game/market, so a repeated value in the series is a yo-yo by definition.
import { parseLiveGame } from './liveconfirm.mjs';
import { sameTeam, fuzzyTeam } from './names.mjs';

const MARKETS = { Spread: g => g.spread?.line_home ?? null, Total: g => g.total?.line ?? null, Moneyline: g => g.ml?.away_price ?? null };

// Append this run's lines to the history (change points only). Returns the number of new points.
export function recordLines(history, games, ts) {
  let n = 0;
  for (const g of games) {
    if (!g.gamecode || g.carried) continue;
    const h = history[g.gamecode] || (history[g.gamecode] = { sport: g.sport, date: g.date, away: g.away, home: g.home, dhIndex: g.dhIndex || 0, Spread: [], Total: [], Moneyline: [] });
    h.start = g.start || h.start || null;
    for (const [mk, read] of Object.entries(MARKETS)) {
      const v = read(g);
      if (v == null || !Number.isFinite(Number(v))) continue;
      const arr = h[mk] || (h[mk] = []);
      const last = arr.length ? arr[arr.length - 1][1] : null;
      if (last === null || Number(v) !== Number(last)) { arr.push([ts, Number(v)]); n++; }
    }
  }
  return n;
}

export function pruneHistory(history, keepFromDate) {
  for (const k of Object.keys(history)) if ((history[k].date || '') < keepFromDate) delete history[k];
}

// series: [[ts, value], ...] change points. Carl 2026-09-04: a yo-yo is any move BACK TOWARD the original (opening)
// line after the line had moved away from it — it does not have to get all the way back (-6 → -10 → -9 counts).
// Returns null or {from (opener), to (furthest point away), back (first value on the way back), path, ts}.
export function detectYoYo(series) {
  if (!series || series.length < 3) return null;
  const v0 = series[0][1];
  let far = 0; // index of the furthest excursion so far
  for (let k = 1; k < series.length; k++) {
    const dPrev = Math.abs(series[k - 1][1] - v0), dNow = Math.abs(series[k][1] - v0);
    if (dNow < dPrev && dPrev > 0) {
      return { from: v0, to: series[far][1], back: series[k][1], path: series.slice(0, k + 1).map(x => x[1]), ts: [series[0][0], series[far][0], series[k][0]] };
    }
    if (dNow > Math.abs(series[far][1] - v0)) far = k;
  }
  return null;
}

const fmt = v => (v > 0 ? '+' : '') + v;
const PT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });
// Build/refresh the Patrick's Variables entries for every yo-yo on the board. Returns {created, updated}.
export function upsertYoYoPicks(card, history, now, opts = {}) {
  const r = { created: 0, updated: 0 };
  const todayPT = opts.todayPT;
  for (const [gamecode, h] of Object.entries(history)) {
    if (todayPT && h.date < todayPT) continue;
    if (h.start && new Date(h.start) <= now) continue; // pre-game only
    for (const mk of ['Spread', 'Total', 'Moneyline']) {
      const yy = detectYoYo(h[mk]);
      if (!yy) continue;
      const path = yy.path.map(fmt).join(' → ');
      const label = mk === 'Spread' ? `${h.home} spread ${path}` : mk === 'Total' ? `Total ${yy.path.join(' → ')}` : `${h.away} ML ${path}`;
      const key = `yoyo|${gamecode}|${mk}`;
      let lp = card.picks.find(x => x.yoyoKey === key);
      const f = mk === 'Total' ? String : fmt;
      const signal = `Yo-yo line (VSiN/DK ${mk.toLowerCase()}): ${yy.path.map(f).join(' → ')} — opened ${f(yy.from)}, out to ${f(yy.to)} ${PT.format(new Date(yy.ts[1]))}, back toward it at ${f(yy.back)} ${PT.format(new Date(yy.ts[2]))} PT · flag only, not a bet`;
      if (!lp) {
        lp = { kind: 'yoyo', src: 'code', yoyoKey: key, type: mk, pick: label, game: `${h.away} @ ${h.home} — ${h.date} (${h.sport})`, signal, status: 'alert',
          yoyo: { market: mk, path: yy.path, from: yy.from, to: yy.to, back: yy.back, ts: yy.ts }, away: h.away, home: h.home, date: h.date, sport: h.sport, gamecode, start: h.start || null, createdAt: now.toISOString() };
        card.picks.push(lp); r.created++;
      } else if (lp.pick !== label || lp.signal !== signal) { lp.pick = label; lp.signal = signal; lp.yoyo = { market: mk, path: yy.path, from: yy.from, to: yy.to, back: yy.back, ts: yy.ts }; lp.start = h.start || lp.start || null; r.updated++; }
    }
  }
  return r;
}

// Same game? (date + both teams, either orientation; board names vs "ABBR Nickname" labels)
export function sameGame(a, b) {
  if (!a?.date || a.date !== b?.date) return false;
  const last = s => String(s || '').trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z0-9]/g, ''); // keeps "49ers"
  const t = (x, y) => sameTeam(x, y) || fuzzyTeam(x, y, y) || fuzzyTeam(y, x, x) || (last(x).length >= 4 && last(x) === last(y));
  return (t(a.away, b.away) && t(a.home, b.home)) || (t(a.away, b.home) && t(a.home, b.away));
}
// Cross-reference inside the Patrick's Variables card: any pick on a PS game gets psFlag, any pick on a yo-yo game gets yoyoFlag.
export function crossReference(card) {
  const meta = p => { const g = parseLiveGame(p.game); return g ? { away: p.away || g.away, home: p.home || g.home, date: p.date || g.date } : null; };
  const ps = card.picks.filter(p => p.kind === 'ps').map(p => ({ m: meta(p), who: p.psWho }));
  const yy = card.picks.filter(p => p.kind === 'yoyo').map(p => ({ m: meta(p), path: p.yoyo?.path?.map(fmt).join(' → '), market: p.yoyo?.market }));
  let changed = 0;
  for (const p of card.picks) {
    const m = meta(p); if (!m) continue;
    const psHit = p.kind !== 'ps' ? ps.find(x => x.m && sameGame(m, x.m)) : null;
    const yyHit = p.kind !== 'yoyo' ? yy.find(x => x.m && sameGame(m, x.m)) : null;
    const psFlag = psHit ? psHit.who : null, yoyoFlag = yyHit ? `${yyHit.market} ${yyHit.path}` : null;
    if ((p.psFlag || null) !== psFlag) { p.psFlag = psFlag; changed++; }
    if ((p.yoyoFlag || null) !== yoyoFlag) { p.yoyoFlag = yoyoFlag; changed++; }
  }
  return changed;
}

// Sharp-money moves, in code (Carl 2026-09-05: "track those sharp moves so we can tail the pros").
// A REVERSE LINE MOVE: the book moves the line TOWARD the side holding FEWER tickets. The crowd is on one side,
// yet the price gets worse for the other — that only happens when big money came in on the unpopular side.
// Read from the line history's change points, which carry the tickets split as it stood BEFORE each move.
import { cents } from './yoyo.mjs';

const fmt = v => (v > 0 ? '+' : '') + v;
// events: [{market, side:'away'|'home'|'over'|'under', from, to, ts, tix (tickets on the move side before the move)}]
export function detectSharpMoves(h) {
  const out = [];
  for (const mk of ['Spread', 'Total', 'Moneyline']) {
    const arr = h[mk] || [];
    for (let k = 1; k < arr.length; k++) {
      const [ts, v, pre] = arr[k]; const v0 = arr[k - 1][1];
      if (pre == null || v === v0) continue; // no tickets read → can't tell who the crowd was
      let side = null, tixMove = null;
      if (mk === 'Spread') { // line_home falls → home more favored → move toward HOME; pre = away tickets
        const towardHome = v < v0; side = towardHome ? 'home' : 'away'; tixMove = towardHome ? 100 - pre : pre;
      } else if (mk === 'Total') { // pre = over tickets
        const towardOver = v > v0; side = towardOver ? 'over' : 'under'; tixMove = towardOver ? pre : 100 - pre;
      } else { // away price on the cents scale: lower → away more favored → toward AWAY; pre = away tickets
        const towardAway = cents(v) < cents(v0); side = towardAway ? 'away' : 'home'; tixMove = towardAway ? pre : 100 - pre;
      }
      if (tixMove < 50) out.push({ market: mk, side, from: v0, to: v, ts, tix: tixMove });
    }
  }
  return out;
}

const PT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });
// One paper entry per game+market+side on the sharp-moves card; repeats update the note. Pre-game only.
export function upsertSharpPicks(card, history, now, opts = {}) {
  const r = { created: 0, updated: 0 };
  for (const [gamecode, h] of Object.entries(history)) {
    if (opts.todayPT && h.date < opts.todayPT) continue;
    if (h.excluded) continue; // FCS-vs-FCS: out of scope
    if (h.start && new Date(h.start) <= now) continue;
    const evs = detectSharpMoves(h);
    const bySide = {};
    for (const e of evs) { const k = `${e.market}|${e.side}`; (bySide[k] = bySide[k] || []).push(e); }
    for (const [k, list] of Object.entries(bySide)) {
      const e = list[list.length - 1]; const first = list[0];
      const key = `sharp|${gamecode}|${k}`;
      const team = e.side === 'away' ? h.away : e.side === 'home' ? h.home : null;
      const lineNow = e.market === 'Spread' ? (e.side === 'home' ? e.to : -e.to) : null;
      const label = e.market === 'Spread' ? `${team} ${fmt(lineNow)}` : e.market === 'Total' ? `${e.side === 'over' ? 'Over' : 'Under'} ${e.to}` : `${team} ML${e.side === 'away' ? ' ' + fmt(e.to) : ''}`;
      const hrs = h.start ? Math.max(0, Math.round((new Date(h.start) - new Date(e.ts)) / 3600e3)) : null;
      const f = e.market === 'Total' ? String : fmt;
      const path = list.map(x => f(x.from)).concat(f(e.to)).join(' → ');
      const signal = `SHARP MOVE (reverse line move): the ${e.market.toLowerCase()} went ${path} toward ${team || e.side.toUpperCase()} while only ${e.tix}% of tickets were on that side — big money on the unpopular side · ${list.length} move${list.length > 1 ? 's' : ''}, last ${PT.format(new Date(e.ts))} PT${hrs != null ? `, ${hrs}h before kickoff` : ''} · paper: tail the move`;
      let lp = card.picks.find(x => x.sharpKey === key);
      if (!lp) {
        lp = { kind: 'sharp', src: 'code', sharpKey: key, type: e.market === 'Moneyline' ? 'Moneyline' : e.market, pick: label, game: `${h.away} @ ${h.home} — ${h.date} (${h.sport})`, signal, status: 'watch',
          side: e.side, line: e.market === 'Spread' ? fmt(lineNow) : null, total: e.market === 'Total' ? e.to : null, dhIndex: h.dhIndex || 0,
          sharp: { market: e.market, side: e.side, from: first.from, to: e.to, moves: list.length, firstAt: first.ts, lastAt: e.ts, tix: e.tix, hoursBefore: hrs },
          away: h.away, home: h.home, date: h.date, sport: h.sport, gamecode, start: h.start || null, createdAt: now.toISOString() };
        card.picks.push(lp); r.created++;
      } else if (!lp.result && (lp.signal !== signal || lp.pick !== label)) {
        lp.signal = signal; lp.pick = label; lp.line = e.market === 'Spread' ? fmt(lineNow) : lp.line; lp.total = e.market === 'Total' ? e.to : lp.total;
        lp.sharp = { ...lp.sharp, to: e.to, moves: list.length, lastAt: e.ts, tix: e.tix, hoursBefore: hrs }; lp.start = h.start || lp.start || null; r.updated++;
      }
    }
  }
  return r;
}

// Stamp live picks whose game had a sharp move TOWARD our side: lp.sharpMove = "from → to against N% tickets" (purple on the card)
export function stampSharpMoves(picks, history) {
  let changed = 0;
  for (const lp of picks) {
    if (!lp.gamecode || !lp.side) continue;
    const h = history[lp.gamecode]; if (!h) { continue; }
    const mk = /total/i.test(lp.type) ? 'Total' : /money/i.test(lp.type) ? 'Moneyline' : 'Spread';
    const hit = detectSharpMoves(h).filter(e => e.market === mk && e.side === lp.side);
    const f = mk === 'Total' ? String : fmt;
    const note = hit.length ? `${f(hit[0].from)} → ${f(hit[hit.length - 1].to)} against ${hit[hit.length - 1].tix}% of tickets` : null;
    if ((lp.sharpMove || null) !== note) { lp.sharpMove = note; changed++; }
  }
  return changed;
}

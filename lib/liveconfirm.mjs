// Hourly re-confirmation of the LIVE card (Today's Picks) against a fresh VSiN read — CODE, not AI.
// Carl 2026-09-02: "every game on today's picks keeps getting confirmed every hour until it starts."
// This touches ONLY confirmation fields/tags on live fade picks. It never adds, removes, or re-tiers a pick.
//
// Live picks look like: { kind:'fade', type:'Moneyline'|'Spread'|'Total', pick:'STL Cardinals ML +203',
//   game:'STL Cardinals @ LA Dodgers — Sep 2 (MLB)', signal:'PUBLIC 68% of tickets on ... but only ...', status }
import { evalGame } from './formula.mjs';
import { nick, sameTeam, stripPickSuffix } from './names.mjs';

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parseLiveGame(game, now = new Date()) {
  const m = String(game || '').match(/^(.*?)\s+@\s+(.*?)\s+[—-]\s*(.*?)\s*(?:\((\w+)\))?\s*$/);
  if (!m) return null;
  let date = null;
  const iso = m[3].match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) date = iso[1];
  else {
    const md = m[3].match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/i);
    if (md) {
      const mo = MON[md[1].slice(0, 3).toLowerCase()];
      let y = now.getFullYear();
      const nowMo = now.getMonth() + 1;
      if (mo < nowMo - 6) y += 1; else if (mo > nowMo + 6) y -= 1;
      date = `${y}-${String(mo).padStart(2, '0')}-${String(md[2]).padStart(2, '0')}`;
    }
  }
  return { away: m[1].trim(), home: m[2].trim(), date, sport: (m[4] || '').toUpperCase() || null };
}

// "ABBR Nickname" (live) vs "City Nickname" (VSiN): nickname must match and be unambiguous within the pair.
function teamIs(label, vsinName, otherVsinName) {
  const l = String(label || '').replace(/^[A-Z]{2,4}\s+/, ''); // drop the ABBR prefix
  if (sameTeam(l, vsinName)) return true;
  const n = nick(label);
  return !!n && n === nick(vsinName) && n !== nick(otherVsinName);
}

// Find the VSiN game for a live pick. Either orientation (live strings have been swapped before). null if ambiguous.
export function matchLiveGame(games, lp) {
  const g = parseLiveGame(lp.game);
  if (!g || !g.date) return null;
  const pool = games.filter(x => x.date === g.date && (!g.sport || x.sport === g.sport));
  const straight = pool.filter(x => teamIs(g.away, x.away, x.home) && teamIs(g.home, x.home, x.away));
  const c = straight.length ? straight : pool.filter(x => teamIs(g.away, x.home, x.away) && teamIs(g.home, x.away, x.home));
  return c.length === 1 ? c[0] : null;
}

// Which side does the live pick take, in VSiN terms: 'away'|'home'|'over'|'under'|null
export function liveSide(lp, game) {
  const mk = /total/i.test(lp.type) ? 'Total' : /money/i.test(lp.type) ? 'Moneyline' : 'Spread';
  if (mk === 'Total') return /^\s*under/i.test(lp.pick) ? 'under' : /^\s*over/i.test(lp.pick) ? 'over' : null;
  const t = stripPickSuffix(lp.pick);
  if (teamIs(t, game.away, game.home)) return 'away';
  if (teamIs(t, game.home, game.away)) return 'home';
  return null;
}

// Re-evaluate one live pick against the fresh VSiN game. Returns a liveCheck record (never mutates the pick).
//   ok:true        pick still qualifies on the same side (T/H/D/tier from the fresh read)
//   ok:false, why:'faded'     same public side but below thresholds now
//   ok:false, why:'flipped'   the public is now on the OTHER side — the formula would pick against us
//   ok:false, why:'unmatched' could not read the market/side
export function liveCheck(lp, game, now = new Date()) {
  const ts = now.toISOString();
  const type = /total/i.test(lp.type) ? 'Total' : /money/i.test(lp.type) ? 'Moneyline' : 'Spread';
  const side = liveSide(lp, game);
  if (!side) return { ts, ok: false, why: 'unmatched' };
  const fresh = evalGame(game, now).find(p => p.type === type);
  if (fresh) {
    if (fresh.side === side) return { ts, ok: true, T: fresh.T, H: fresh.H, D: fresh.D, tier: fresh.tier, flag98: !!fresh.flag98 };
    return { ts, ok: false, why: 'flipped', T: fresh.T, H: fresh.H, D: fresh.D, publicSide: fresh.publicSide };
  }
  // no qualifying pick on this market now — report the raw numbers on our public side for the tag
  const m = type === 'Total' ? game.total : type === 'Moneyline' ? game.ml : game.spread;
  const ours = type === 'Total' ? (side === 'over' ? m.over : m.under) : (side === 'away' ? m.away : m.home);
  const theirs = type === 'Total' ? (side === 'over' ? m.under : m.over) : (side === 'away' ? m.home : m.away);
  if (theirs?.bets == null || theirs?.handle == null) return { ts, ok: false, why: 'unmatched' };
  const T = theirs.bets, H = theirs.handle; // the side we fade = the public side
  return { ts, ok: false, why: T < ours.bets ? 'flipped' : 'faded', T, H, D: +(T - H).toFixed(1) };
}

const PT_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

// Apply a check to a live pick IN PLACE: structured field + one replaceable tag in the signal. Returns true if changed.
export function applyLiveCheck(lp, check, now = new Date()) {
  const prev = lp.liveCheck || {};
  const n = check.ok ? (prev.ok ? (prev.n || 0) + 1 : 1) : 0;
  const stamp = PT_TIME.format(now).toLowerCase().replace(' ', '');
  const tag = check.ok
    ? `✓ code re-confirmed ${n}× on the live board (last ${stamp}: ${check.T}% tickets / ${check.H}% money, gap ${check.D})`
    : check.why === 'flipped'
      ? `⛔ PUBLIC FLIPPED on the ${stamp} read — the crowd is now on OUR side (${check.T}% tickets / ${check.H}% money); the formula would no longer take this. Do not bet.`
      : check.why === 'faded'
        ? `⚠ signal faded on the ${stamp} read (${check.T}% tickets / ${check.H}% money, gap ${check.D} — below the 60/8 bar). Extra caution.`
        : `⏱ could not re-read this market at ${stamp}`;
  const cleaned = String(lp.signal || '')
    .replace(/\s*·\s*(✓ code re-confirmed[^·]*|⛔ PUBLIC FLIPPED[^·]*|⚠ signal faded on the[^·]*|⏱ could not re-read[^·]*|⏳ posted on first read[^·]*|✓ confirmed[^·]*)/g, '')
    .trim();
  const next = `${cleaned} · ${tag}`;
  const changed = next !== lp.signal || JSON.stringify({ ...prev, ts: 0 }) !== JSON.stringify({ ...check, n, ts: 0 });
  lp.signal = next;
  lp.liveCheck = { ...check, n };
  return changed;
}

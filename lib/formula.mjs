// THE FROZEN FADE-THE-PUBLIC FORMULA — Carl's rules, verbatim, as code.
// PUBLIC = side with more BETS (tickets). T = public bets%, H = public handle%, D = T − H.
// Qualifies ONLY if T >= 60 AND D >= 8. Pick = the OPPOSITE side.
// Tier: play D>=25, lean D>=15, watch D>=8.
// Mandatory downgrade to watch: college game; |spread| >= 20; any side's bets or handle >= 98 or <= 2.
// Windows: football (NFL/CFB) game within 7 days; all other sports within 72 hours.
// MLB and NHL: the MONEYLINE is the market (run/puck line pinned); other sports: SPREAD. Totals: all sports.
// DO NOT EDIT THRESHOLDS WITHOUT CARL'S EXPLICIT APPROVAL.

export const THRESHOLDS = Object.freeze({
  qualifyT: 60, qualifyD: 8, playD: 25, leanD: 15,
  bigSpread: 20, artifactHi: 98, artifactLo: 2,
  footballWindowDays: 7, otherWindowHours: 72,
});

const COLLEGE = new Set(['CFB', 'CBB']);
const ML_SPORTS = new Set(['MLB', 'NHL']);
const FOOTBALL = new Set(['NFL', 'CFB']);

export function withinWindow(sport, gameDateISO, now = new Date()) {
  if (!gameDateISO) return false;
  const game = new Date(gameDateISO + 'T23:59:59-07:00'); // end of game day PT (conservative include)
  const start = new Date(gameDateISO + 'T00:00:00-07:00');
  if (game < now && start < new Date(now.getTime() - 36 * 3600e3)) return false; // clearly past
  const horizon = FOOTBALL.has(sport)
    ? THRESHOLDS.footballWindowDays * 24 * 3600e3
    : THRESHOLDS.otherWindowHours * 3600e3;
  return start.getTime() - now.getTime() <= horizon;
}

// Evaluate one two-sided market. sides = {a:{name,bets,handle,line}, b:{name,bets,handle,line}}
// Returns null (no pick) or {pick, line, publicSide, T, H, D, tier, downgraded:[...]}
export function evalMarket(sport, sides) {
  const { a, b } = sides;
  if ([a.bets, b.bets, a.handle, b.handle].some(v => v == null)) return null;
  if (a.bets === 0 && b.bets === 0) return null;
  const pub = a.bets >= b.bets ? a : b;
  const opp = pub === a ? b : a;
  const T = pub.bets, H = pub.handle, D = +(T - H).toFixed(1);
  if (!(T >= THRESHOLDS.qualifyT && D >= THRESHOLDS.qualifyD)) return null;
  let tier = D >= THRESHOLDS.playD ? 'play' : D >= THRESHOLDS.leanD ? 'lean' : 'watch';
  const downgraded = [];
  if (COLLEGE.has(sport)) downgraded.push('college');
  if (sides.spreadMagnitude != null && Math.abs(sides.spreadMagnitude) >= THRESHOLDS.bigSpread) downgraded.push('spread>=20');
  for (const v of [a.bets, b.bets, a.handle, b.handle]) {
    if (v >= THRESHOLDS.artifactHi || v <= THRESHOLDS.artifactLo) { downgraded.push('98/2 artifact'); break; }
  }
  if (downgraded.length && tier !== 'watch') tier = 'watch';
  return { pick: opp.name, line: opp.line ?? null, publicSide: pub.name, publicLine: pub.line ?? null, T, H, D, tier, downgraded };
}

// Run the frozen formula over one parsed game -> array of pick objects.
export function evalGame(game, now = new Date()) {
  const picks = [];
  if (!withinWindow(game.sport, game.date, now)) return picks;
  const fmtLine = v => (v == null ? '' : (v > 0 ? `+${v}` : `${v}`));

  if (ML_SPORTS.has(game.sport)) {
    const r = evalMarket(game.sport, {
      a: { name: `${game.away} ML`, bets: game.ml.away.bets, handle: game.ml.away.handle, line: fmtLine(game.ml.away_price) },
      b: { name: `${game.home} ML`, bets: game.ml.home.bets, handle: game.ml.home.handle, line: fmtLine(game.ml.home_price) },
    });
    if (r) picks.push({ ...r, type: 'Moneyline' });
  } else {
    const lh = game.spread.line_home;
    const r = evalMarket(game.sport, {
      a: { name: game.away, bets: game.spread.away.bets, handle: game.spread.away.handle, line: lh == null ? null : fmtLine(-lh) },
      b: { name: game.home, bets: game.spread.home.bets, handle: game.spread.home.handle, line: lh == null ? null : fmtLine(lh) },
      spreadMagnitude: lh,
    });
    if (r) picks.push({ ...r, type: 'Spread' });
  }
  const t = evalMarket(game.sport, {
    a: { name: `Over ${game.total.line ?? ''}`.trim(), bets: game.total.over.bets, handle: game.total.over.handle, line: null },
    b: { name: `Under ${game.total.line ?? ''}`.trim(), bets: game.total.under.bets, handle: game.total.under.handle, line: null },
  });
  if (t) picks.push({ ...t, type: 'Total' });

  return picks.map(p => ({ ...p, gamecode: game.gamecode, sport: game.sport, date: game.date, away: game.away, home: game.home }));
}

// NFL key-number display note (Carl-approved, display only).
export function keyNumberNote(sport, type, pickLine) {
  if (sport !== 'NFL' || type !== 'Spread' || pickLine == null) return null;
  const v = parseFloat(pickLine);
  const map = { 2.5: '+3', [-3.5]: '-3', 6.5: '+7', [-7.5]: '-7' };
  return map[v] ? `🔑 near key number ${Math.abs(Math.round(v))} — consider buying the half point to ${map[v]} (worth up to about −125)` : null;
}

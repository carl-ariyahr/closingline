// THE FROZEN FADE-THE-PUBLIC FORMULA — Carl's rules, verbatim, as code.
// PUBLIC = side with more BETS (tickets). T = public bets%, H = public handle%, D = T − H.
// Qualifies ONLY if T >= 60 AND D >= 8. Pick = the OPPOSITE side.
// Tier: play D>=25, lean D>=15, watch D>=8.
// Mandatory downgrade to watch: |spread| >= 20.
// College is NOT a downgrade (Carl 2026-09-04: "college football is fair game") — CFB/CBB tier from D like every sport.
// 98/2 read: any side's bets OR handle >= 98 or <= 2 (Carl: "both") is NOT a downgrade any more —
//   the pick keeps its tier and carries flag98 (shown with an asterisk on the card; Carl 2026-09-02).
// Windows: EVERY sport within 7 days of game day (Carl 2026-09-04: "start tracking all sports and all lines 7 days
//   from game day"; was football 7 days / others 96h, and 72h before 2026-09-02). Re-confirmed every run until kickoff.
//   Windows are measured to the START of the game's day in Pacific time (VSiN gives dates, not tip times),
//   so a game can enter the window up to one day earlier than the exact hour count.
// MLB and NHL: the MONEYLINE is the market (run/puck lines are NEVER picked — Carl 2026-09-02);
//   other sports: SPREAD. Totals: all sports.
// DO NOT EDIT THRESHOLDS WITHOUT CARL'S EXPLICIT APPROVAL.

export const THRESHOLDS = Object.freeze({
  qualifyT: 60, qualifyD: 8, playD: 25, leanD: 15,
  bigSpread: 20, artifactHi: 98, artifactLo: 2,
  footballWindowDays: 7, otherWindowHours: 168, // 7 days for every sport (Carl 2026-09-04)
});

const ML_SPORTS = new Set(['MLB', 'NHL']);
const FOOTBALL = new Set(['NFL', 'CFB']);

export function withinWindow(sport, gameDateISO, now = new Date()) {
  if (!gameDateISO) return false;
  const start = new Date(gameDateISO + 'T00:00:00-07:00');
  const end = new Date(gameDateISO + 'T23:59:59-07:00');
  if (end < now && start < new Date(now.getTime() - 36 * 3600e3)) return false; // clearly past
  const horizon = FOOTBALL.has(sport)
    ? THRESHOLDS.footballWindowDays * 24 * 3600e3
    : THRESHOLDS.otherWindowHours * 3600e3;
  return start.getTime() - now.getTime() <= horizon;
}

// Evaluate one two-sided market. sides = {a:{name,bets,handle,line}, b:{...}, spreadMagnitude?}
// Returns null (no pick) or {pick, line, side:'a'|'b', publicSide, publicLine, T, H, D, tier, downgraded:[...]}
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
  if (sides.spreadMagnitude != null && Math.abs(sides.spreadMagnitude) >= THRESHOLDS.bigSpread) downgraded.push('spread>=20');
  if (downgraded.length && tier !== 'watch') tier = 'watch';
  // 98/2 read (tickets OR handle at >=98 / <=2): Carl 2026-09-02 — KEEP the tier and post it with an
  // asterisk ("tiny or lopsided sample, treat with care") instead of forcing it down to watch.
  const flag98 = [a.bets, b.bets, a.handle, b.handle].some(v => v >= THRESHOLDS.artifactHi || v <= THRESHOLDS.artifactLo);
  return {
    pick: opp.name, line: opp.line ?? null, side: opp === a ? 'a' : 'b',
    publicSide: pub.name, publicLine: pub.line ?? null, T, H, D, tier, downgraded, flag98,
  };
}

// Run the frozen formula over one parsed game -> array of pick objects.
// Every pick carries an EXPLICIT side ('away'|'home'|'over'|'under') and pickTeam (plain team name)
// so grading/annotation never has to guess the side from text.
export function evalGame(game, now = new Date()) {
  const picks = [];
  if (!withinWindow(game.sport, game.date, now)) return picks;
  const fmtLine = v => (v == null ? '' : (v > 0 ? `+${v}` : `${v}`));

  if (ML_SPORTS.has(game.sport)) {
    const r = evalMarket(game.sport, {
      a: { name: `${game.away} ML`, bets: game.ml.away.bets, handle: game.ml.away.handle, line: fmtLine(game.ml.away_price) },
      b: { name: `${game.home} ML`, bets: game.ml.home.bets, handle: game.ml.home.handle, line: fmtLine(game.ml.home_price) },
    });
    if (r) picks.push({ ...r, type: 'Moneyline', side: r.side === 'a' ? 'away' : 'home', pickTeam: r.side === 'a' ? game.away : game.home });
  } else {
    const lh = game.spread.line_home;
    const r = evalMarket(game.sport, {
      a: { name: game.away, bets: game.spread.away.bets, handle: game.spread.away.handle, line: lh == null ? null : fmtLine(-lh) },
      b: { name: game.home, bets: game.spread.home.bets, handle: game.spread.home.handle, line: lh == null ? null : fmtLine(lh) },
      spreadMagnitude: lh,
    });
    if (r) picks.push({ ...r, type: 'Spread', side: r.side === 'a' ? 'away' : 'home', pickTeam: r.side === 'a' ? game.away : game.home });
  }
  const t = evalMarket(game.sport, {
    a: { name: `Over ${game.total.line ?? ''}`.trim(), bets: game.total.over.bets, handle: game.total.over.handle, line: null },
    b: { name: `Under ${game.total.line ?? ''}`.trim(), bets: game.total.under.bets, handle: game.total.under.handle, line: null },
  });
  if (t) picks.push({ ...t, type: 'Total', side: t.side === 'a' ? 'over' : 'under', total: game.total.line ?? null, pickTeam: null });

  return picks.map(p => ({ ...p, gamecode: game.gamecode, sport: game.sport, date: game.date, dhIndex: game.dhIndex ?? 0, away: game.away, home: game.home }));
}

// NFL key-number display note (Carl-approved, display only).
export function keyNumberNote(sport, type, pickLine) {
  if (sport !== 'NFL' || type !== 'Spread' || pickLine == null) return null;
  const v = parseFloat(pickLine);
  const map = { 2.5: '+3', [-3.5]: '-3', 6.5: '+7', [-7.5]: '-7' };
  return map[v] ? `🔑 near key number ${Math.abs(Math.round(v))} — consider buying the half point to ${map[v]} (worth up to about −125)` : null;
}

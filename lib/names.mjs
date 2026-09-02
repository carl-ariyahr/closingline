// ONE team-name helper for the whole system (replaces six divergent lastWord() copies).
// Rules:
//   normName: lowercase, "St"/"ST"/"St." -> "state" (so VSiN "Kansas ST" == ESPN "Kansas State"),
//             strip everything but letters.
//   sameTeam(a, b): exact normalized match, or one is a prefix of the other with >= 5 letters
//             (VSiN "Kansas State" vs ESPN "Kansas State Wildcats"). Never last-word only —
//             last-word matching confused Red Sox/White Sox, Tigers/Tigers, Michigan State/Ohio State.
//   nick(s): the last word, used ONLY as a display/dedupe hint where both cities are also present.

export function normName(s) {
  return String(s || '')
    .replace(/\bSt\.?(?=\s|$)/gi, 'State')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z]/g, '');
}

export function nick(s) {
  const w = String(s || '').trim().split(/\s+/);
  return String(w[w.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
}

// strip betting suffixes ("ML", "1H", "F5") and a trailing line ("+1.5", "-110") from a pick label
export function stripPickSuffix(s) {
  return String(s || '').replace(/\b(ML|1H|F5)\b/gi, '').replace(/[+-]?\d[\d.]*\s*$/, '').trim();
}

export function sameTeam(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const short = x.length <= y.length ? x : y, long = x.length <= y.length ? y : x;
  return short.length >= 5 && long.startsWith(short);
}

// Find the ONE event whose away/home match ours. Returns null when zero or ambiguous.
// Also tries the swapped orientation (sources sometimes list home/away backwards) but only
// when the straight orientation finds nothing.
export function matchPair(events, away, home, getAway, getHome) {
  const straight = events.filter(e => sameTeam(getAway(e), away) && sameTeam(getHome(e), home));
  if (straight.length) return straight;
  return events.filter(e => sameTeam(getAway(e), home) && sameTeam(getHome(e), away));
}

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

// "Red Sox" names "Boston Red Sox" (and never "Chicago White Sox"): the label is the tail of the full name.
// Used where a live/pro label has had its city abbreviation stripped ("BOS Red Sox" → "Red Sox").
export function teamTail(label, full) {
  const l = normName(label), f = normName(full);
  return l.length >= 4 && f.length > l.length && f.endsWith(l);
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

// ---- College shorthand matcher (VSiN board names vs ESPN location/display names) ----
// VSiN prints "N Illinois Huskies", "W Georgia", "LIU-Post", "Miss Valley ST", "Iowa Hawkies" (sic);
// ESPN prints "Northern Illinois Huskies", "West Georgia Wolves", "Long Island University Sharks", …
// Each VSiN token may expand to several candidates (N → north|northern); a match needs the FIRST
// token (the identity word) plus at least 60% of all tokens to line up (equal, or a ≥4-letter prefix
// of each other, which also absorbs typos like Hawkies/Hawkeyes).
const TOKEN_ALIASES = {
  n: ['north', 'northern'], s: ['south', 'southern'], e: ['east', 'eastern'], w: ['west', 'western'], c: ['central'],
  st: ['state'], se: ['southeast', 'southeastern'], sw: ['southwest', 'southwestern'], ne: ['northeast', 'northeastern'],
  ark: ['arkansas'], fl: ['florida'], la: ['louisiana', 'ul', 'la'], louisiana: ['louisiana', 'ul'], ul: ['ul', 'louisiana'], intl: ['international', 'intl'], tenn: ['tennessee'], miss: ['mississippi'], conn: ['connecticut', 'uconn'],
  connecticut: ['connecticut', 'uconn'], albany: ['albany', 'ualbany'], appalachian: ['appalachian', 'app'], app: ['app', 'appalachian'],
  liu: ['long', 'island', 'university'], cal: ['california', 'cal'], ga: ['georgia'], nc: ['north', 'carolina'], sc: ['south', 'carolina'],
  utsa: ['utsa'], utep: ['utep'], utrgv: ['ut', 'rio', 'grande', 'valley'],
  mtsu: ['middle', 'tennessee'], fiu: ['florida', 'international'], fau: ['florida', 'atlantic'], ucf: ['ucf', 'central', 'florida'],
  umass: ['umass', 'massachusetts'], ole: ['ole'], byu: ['byu'], lsu: ['lsu'], smu: ['smu'], tcu: ['tcu'], usc: ['usc'], ucla: ['ucla'],
};
// multi-word board names that ESPN abbreviates — collapsed before tokenizing
const PHRASE_ALIASES = [[/texas[- ]san antonio/, 'utsa'], [/texas[- ]el paso/, 'utep'], [/texas[- ]rio grande valley/, 'utrgv'], [/middle tenn(essee)? st(ate)?/, 'middle tennessee'], [/appalachian st(ate)?/, 'app state']];
export function teamTokens(s) {
  let str = String(s || '').toLowerCase();
  for (const [re, to] of PHRASE_ALIASES) str = str.replace(re, to);
  const raw = str.replace(/&/g, ' and ').replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of raw) {
    const a = TOKEN_ALIASES[w];
    if (a && a.length > 1 && !['n', 's', 'e', 'w', 'se', 'sw', 'ne', 'connecticut', 'albany', 'appalachian', 'app', 'conn'].includes(w)) { out.push(...a.map(x => [x])); continue; } // multi-word expansion (liu → long island university)
    out.push(a ? a : [w]);
  }
  return out; // array of alternatives per token position
}
function tokEq(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  // typo tolerance for long tokens ("hawkies" vs "hawkeyes"): both >= 6 letters sharing a >= 4-letter prefix
  if (a.length >= 6 && b.length >= 6) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i >= 4; }
  return false;
}
export function fuzzyTeam(vsinName, espnLocation, espnDisplayName) {
  const v = teamTokens(vsinName);
  if (!v.length) return false;
  const e = [...new Set([...teamTokens(espnLocation).flat(), ...teamTokens(espnDisplayName).flat()])];
  const hits = v.map(alts => alts.some(a => e.some(t => tokEq(a, t))));
  if (!hits[0]) return false;
  const n = hits.filter(Boolean).length;
  return n >= Math.max(1, Math.ceil(v.length * 0.6));
}

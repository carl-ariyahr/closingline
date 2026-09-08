// Kalshi order flow as a public read (Carl 2026-09-08, "go build the kalshi one"). Public API, no key:
//   GET https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXMLBGAME&status=open&mve_filter=exclude
// Each game is an EVENT with one binary market per team ("Texas wins" / "Seattle wins"). Retail users overwhelmingly buy
// YES on the team they like, so the market with the larger traded volume is where the Kalshi crowd went. The read
// AGREES with a pick when that crowd side is the side we fade. Totals (KXMLBTOTAL) are one market per line, so volume
// carries no side information there: the read applies to moneyline and spread picks only.
// Event ticker: KXMLBGAME-26SEP082140TEXSEA = 2026 Sep 08, 21:40 Eastern, away code + home code (codes vary in length,
// so teams are matched on the market labels "Texas" / "New York Y" / "Chicago WS" / "A's", never on the codes).
export const BASE = 'https://external-api.kalshi.com/trade-api/v2';
export const SERIES = { MLB: 'KXMLBGAME', NFL: 'KXNFLGAME', NBA: 'KXNBAGAME', NHL: 'KXNHLGAME', CFB: 'KXNCAAFGAME', CBB: 'KXNCAABGAME', WNBA: 'KXWNBAGAME' };
export const MIN_VOLUME = 2000; // contracts across both sides; below this the read is 'thin' and does not count as a box
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const ALIAS = { "a's": 'athletics', 'as': 'athletics' };

export async function fetchGameMarkets(sport, fetchImpl = fetch) {
  const series = SERIES[sport]; if (!series) return [];
  const out = []; let cursor = null;
  for (let page = 0; page < 5; page++) {
    const u = `${BASE}/markets?series_ticker=${series}&status=open&mve_filter=exclude&limit=1000${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
    const r = await fetchImpl(u, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`kalshi ${sport}: HTTP ${r.status}`);
    const j = await r.json();
    out.push(...(j.markets || []));
    cursor = j.cursor || null; if (!cursor) break;
  }
  return out;
}

// "KXMLBGAME-26SEP082140TEXSEA" -> { date:'2026-09-08', timeET:'2140', startISO }
export function parseEventTicker(t) {
  const m = String(t || '').match(/-(\d{2})([A-Z]{3})(\d{2})(\d{4})?[A-Z0-9]*$/);
  if (!m || !MON[m[2]]) return null;
  const y = 2000 + Number(m[1]), mo = MON[m[2]], d = Number(m[3]);
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const timeET = m[4] || null;
  return { date, timeET, startISO: timeET ? etToISO(y, mo, d, Number(timeET.slice(0, 2)), Number(timeET.slice(2))) : null };
}
function etToISO(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const g = k => Number(et.find(p => p.type === k).value);
  const asET = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return new Date(guess - (asET - guess)).toISOString();
}

// markets -> events [{event, date, timeET, startISO, sides:[{label, ticker, bid, ask, last, vol, oi}]}]
export function groupEvents(markets) {
  const by = {};
  for (const m of markets) {
    const p = parseEventTicker(m.event_ticker); if (!p) continue;
    const e = by[m.event_ticker] || (by[m.event_ticker] = { event: m.event_ticker, ...p, sides: [] });
    e.sides.push({ label: m.yes_sub_title || String(m.title || '').replace(/\s+wins$/i, ''), ticker: m.ticker, bid: num(m.yes_bid_dollars), ask: num(m.yes_ask_dollars), last: num(m.last_price_dollars), vol: num(m.volume_fp) ?? 0, oi: num(m.open_interest_fp) ?? 0 });
  }
  return Object.values(by).filter(e => e.sides.length === 2);
}
const num = v => (v == null || v === '' ? null : Number(v));
const norm = s => String(s || '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

// Does a Kalshi side label name this team? "New York Y" -> New York Yankees, "Chicago WS" -> Chicago White Sox,
// "St. Louis" -> ST Louis Cardinals, "A's" -> Athletics, "UCLA" -> UCLA Bruins. A trailing 1-2 capital letters is a
// nickname disambiguator: the city must match exactly and the nickname's initials must start with those letters.
export function labelMatches(label, fullName) {
  let l = norm(label); const f = norm(fullName);
  if (!l || !f) return false;
  if (ALIAS[l]) l = ALIAS[l];
  if (ALIAS[f]) return l === ALIAS[f];
  const raw = String(label || '').trim();
  const dis = raw.match(/\s([A-Z]{1,2})$/);
  if (dis) {
    const city = norm(raw.slice(0, -dis[1].length));
    if (!f.startsWith(city + ' ')) return false;
    const nick = f.slice(city.length).trim().split(' ');
    const initials = nick.map(w => w[0]).join('');
    return initials.startsWith(dis[1].toLowerCase());
  }
  return f === l || f.startsWith(l + ' ');
}

// One event for our game, or null (never guess a doubleheader: pick by start time, else skip)
export function matchEvent(events, { away, home, date, start }) {
  let c = events.filter(e => e.date === date && e.sides.some(s => labelMatches(s.label, away)) && e.sides.some(s => labelMatches(s.label, home)));
  if (!c.length) return null;
  if (c.length > 1 && start) c = c.filter(e => e.startISO && Math.abs(new Date(e.startISO) - new Date(start)) <= 90 * 60e3);
  return c.length === 1 ? c[0] : null;
}

// The read for a team pick (lp.side = OUR side, 'away'|'home'). Returns null for totals or when a side can't be placed.
export function kalshiRead(event, lp, now = new Date()) {
  if (!event || !lp || !['away', 'home'].includes(lp.side)) return null;
  const A = event.sides.find(s => labelMatches(s.label, lp.away)), H = event.sides.find(s => labelMatches(s.label, lp.home));
  if (!A || !H || A === H) return null;
  const total = (A.vol || 0) + (H.vol || 0);
  const crowd = A.vol === H.vol ? null : A.vol > H.vol ? 'away' : 'home';
  const fade = lp.side === 'away' ? 'home' : 'away';
  return {
    event: event.event, at: now.toISOString(), crowd, agrees: crowd != null && crowd === fade, thin: total < MIN_VOLUME, totalVol: Math.round(total),
    awayVol: Math.round(A.vol || 0), homeVol: Math.round(H.vol || 0), awayPrice: A.ask ?? A.last ?? null, homePrice: H.ask ?? H.last ?? null,
    crowdShare: total ? +(((crowd === 'away' ? A.vol : H.vol) / total) * 100).toFixed(0) : null,
  };
}

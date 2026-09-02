// Action Network public-betting splits — pulled by CODE (no login, no API token).
// actionnetwork.com/<league>/public-betting is server-rendered (Next.js) and embeds the full
// scoreboard JSON — including Consensus (book 15) bet_info tickets%/money% — in <script id="__NEXT_DATA__">.
// Used ONLY as a second-source confirmation annotation. VSiN/DK remains the deciding source.
// Fail-loud contract: if the page shape changes we throw rather than emit wrong numbers.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
export const AN_LEAGUE = { NFL: 'nfl', CFB: 'ncaaf', NBA: 'nba', CBB: 'ncaab', WNBA: 'wnba', MLB: 'mlb', NHL: 'nhl' };
const CONSENSUS_BOOK = '15';

export async function fetchActionHTML(sport) {
  const league = AN_LEAGUE[sport];
  if (!league) throw new Error(`no Action Network league for ${sport}`);
  const r = await fetch(`https://www.actionnetwork.com/${league}/public-betting`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (!r.ok) throw new Error(`actionnetwork ${sport} HTTP ${r.status}`);
  return r.text();
}

// game date in Pacific time (matches how the dashboard/VSiN date games)
function ptDate(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}
const pct = o => Number(o?.bet_info?.tickets?.percent || 0);
const mny = o => Number(o?.bet_info?.money?.percent || 0);

// Each market array holds the main line (with bet_info) plus alt lines (bet_info zeros).
// Keep the entries that actually carry split data.
function withSplits(list) {
  return (list || []).filter(o => !o.is_alt_market && (pct(o) > 0 || mny(o) > 0));
}
function pair(list, pickA, pickB) {
  const a = withSplits(list).find(pickA), b = withSplits(list).find(pickB);
  if (!a || !b) return null;
  const sum = pct(a) + pct(b);
  if (sum < 95 || sum > 105) return null; // not a clean two-sided split — skip rather than guess
  return { a, b };
}

export function parseActionSplits(html, sport) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!m) throw new Error(`actionnetwork ${sport}: __NEXT_DATA__ missing (page shape changed?)`);
  const data = JSON.parse(m[1]);
  const sr = data?.props?.pageProps?.scoreboardResponse;
  if (!sr || !Array.isArray(sr.games)) throw new Error(`actionnetwork ${sport}: scoreboardResponse missing (page shape changed?)`);

  const rows = [];
  const dh = {}; // doubleheaders: same matchup twice on one date -> dhIndex 0,1 in start-time order
  const games = [...sr.games].sort((x, y) => String(x.start_time).localeCompare(String(y.start_time)));
  for (const g of games) {
    if (!g.teams || g.teams.length < 2 || !g.markets) continue;
    const away = g.teams.find(t => t.id === g.away_team_id), home = g.teams.find(t => t.id === g.home_team_id);
    if (!away || !home) continue;
    const ev = g.markets[CONSENSUS_BOOK]?.event;
    if (!ev) continue;
    const date = ptDate(g.start_time);
    const dhKey = `${date}|${away.id}|${home.id}`;
    const dhIndex = (dh[dhKey] = (dh[dhKey] || 0) + 1) - 1;
    const base = {
      away: away.full_name, home: home.full_name,
      awayShort: away.display_name, homeShort: home.display_name,
      date, dhIndex, start: g.start_time, status: g.status, numBets: g.num_bets ?? null,
    };
    const ml = pair(ev.moneyline, o => o.team_id === away.id, o => o.team_id === home.id);
    if (ml) rows.push({ ...base, market: 'ML', line: null,
      a: { name: away.display_name, bets: pct(ml.a), money: mny(ml.a), odds: ml.a.odds },
      b: { name: home.display_name, bets: pct(ml.b), money: mny(ml.b), odds: ml.b.odds } });
    const sp = pair(ev.spread, o => o.team_id === away.id, o => o.team_id === home.id);
    if (sp) rows.push({ ...base, market: 'Spread', line: sp.b.value,
      a: { name: away.display_name, bets: pct(sp.a), money: mny(sp.a), line: sp.a.value },
      b: { name: home.display_name, bets: pct(sp.b), money: mny(sp.b), line: sp.b.value } });
    const tot = pair(ev.total, o => o.side === 'over', o => o.side === 'under');
    if (tot) rows.push({ ...base, market: 'Total', line: tot.a.value,
      a: { name: 'Over', bets: pct(tot.a), money: mny(tot.a) },
      b: { name: 'Under', bets: pct(tot.b), money: mny(tot.b) } });
  }
  return { league: sport, games: sr.games.length, rows };
}

// Deterministic VSiN/DK betting-splits fetcher + parser.
// Source pages: https://data.vsin.com/betting-splits/?source=DK&sport=<SPORT>
// Layout contract (fail loud if violated):
//   - one <table> per game date; thead: [Sport - Date | Spread|Handle|Bets | Total|Handle|Bets | Money|Handle|Bets]
//   - two <tr class="sp-row"> per game: first = ROAD team, second = HOME team
//   - totals: road row carries OVER percentages, home row carries UNDER
//   - per market the cell order is line, HANDLE%, BETS%  (handle first, bets second)
//   - stable game id in img[data-gamecode], e.g. 20260902MLB00019
import { parse } from 'node-html-parser';

export const SPORTS = ['NFL', 'CFB', 'NBA', 'CBB', 'WNBA', 'MLB', 'NHL'];
const SPORT_PARAM = { NFL: 'NFL', CFB: 'CFB', NBA: 'NBA', CBB: 'CBB', WNBA: 'WNBA', MLB: 'MLB', NHL: 'NHL' };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export async function fetchSplitsHTML(sport) {
  const url = `https://data.vsin.com/betting-splits/?source=DK&sport=${SPORT_PARAM[sport]}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`vsin ${sport}: HTTP ${res.status}`);
  const html = await res.text();
  if (html.length < 5000) throw new Error(`vsin ${sport}: suspiciously small page (${html.length}b)`);
  return html;
}

function num(txt) {
  if (txt == null) return null;
  const m = String(txt).replace(/[△▲▽▼↺]/g, '').match(/[+-]?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function pct(txt) {
  const m = String(txt ?? '').match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

// Parse one sport page -> [{gamecode, sport, date:'YYYY-MM-DD', away, home,
//   spread:{line_home, away:{handle,bets}, home:{handle,bets}},
//   total:{line, over:{handle,bets}, under:{handle,bets}},
//   ml:{away_price, home_price, away:{handle,bets}, home:{handle,bets}}}]
export function parseSplits(html, sport) {
  const root = parse(html);
  const games = [];
  for (const table of root.querySelectorAll('table')) {
    const head = table.querySelector('thead');
    if (!head) continue;
    const headText = head.text.replace(/\s+/g, ' ');
    if (!/Handle/.test(headText) || !/Bets/.test(headText)) continue;
    // layout contract: Handle must appear before Bets in the header
    if (headText.indexOf('Handle') > headText.indexOf('Bets')) {
      throw new Error(`vsin ${sport}: header order changed (Bets before Handle) — layout contract violated`);
    }
    const dateLink = head.querySelector('a.sp-sport-link');
    const dm = dateLink?.getAttribute('href')?.match(/gamedate=(\d{4}-\d{2}-\d{2})/);
    const gamedate = dm ? dm[1] : null;

    const rows = table.querySelectorAll('tbody tr.sp-row, tbody tr');
    const teamRows = rows.filter(r => r.querySelector('.sp-cell-team'));
    for (let i = 0; i + 1 < teamRows.length; i += 2) {
      const road = teamRows[i], home = teamRows[i + 1];
      const gc = (road.querySelector('img[data-gamecode]') || home.querySelector('img[data-gamecode]'))?.getAttribute('data-gamecode') || null;
      const cellsOf = r => r.querySelectorAll('td').filter(td => !td.querySelector('.sp-cell-team') && !td.querySelector('button'));
      const teamOf = r => r.querySelector('.sp-cell-team a')?.text.trim() || r.querySelector('.sp-cell-team')?.text.trim();
      // market cells appear as groups of 3: [line, handle, bets] x [spread, total, ml]
      const grab = r => {
        const tds = r.querySelectorAll('td');
        // find indexes of the three "sp-col-first" cells (start of each market group)
        const starts = [];
        tds.forEach((td, idx) => { if ((td.getAttribute('class') || '').includes('sp-col-first')) starts.push(idx); });
        if (starts.length < 3) return null;
        const g = s => ({ line: tds[s]?.text, handle: pct(tds[s + 1]?.text), bets: pct(tds[s + 2]?.text) });
        return { spread: g(starts[0]), total: g(starts[1]), ml: g(starts[2]) };
      };
      const rM = grab(road), hM = grab(home);
      if (!rM || !hM) continue;
      const game = {
        gamecode: gc, sport, date: gamedate,
        away: teamOf(road), home: teamOf(home),
        spread: {
          line_home: num(hM.spread.line),
          away: { handle: rM.spread.handle, bets: rM.spread.bets },
          home: { handle: hM.spread.handle, bets: hM.spread.bets },
        },
        total: {
          line: num(rM.total.line) ?? num(hM.total.line),
          over: { handle: rM.total.handle, bets: rM.total.bets },   // road row = OVER
          under: { handle: hM.total.handle, bets: hM.total.bets },  // home row = UNDER
        },
        ml: {
          away_price: num(rM.ml.line), home_price: num(hM.ml.line),
          away: { handle: rM.ml.handle, bets: rM.ml.bets },
          home: { handle: hM.ml.handle, bets: hM.ml.bets },
        },
      };
      games.push(game);
    }
  }
  return games;
}

// Data sanity: each market's two bets% (and handle%) should sum ~100 when both present.
export function validateGame(g) {
  const issues = [];
  const sumOk = (a, b) => a == null || b == null || Math.abs(a + b - 100) <= 3;
  if (!sumOk(g.spread.away.bets, g.spread.home.bets)) issues.push('spread bets% do not sum to 100');
  if (!sumOk(g.total.over.bets, g.total.under.bets)) issues.push('total bets% do not sum to 100');
  if (!sumOk(g.ml.away.bets, g.ml.home.bets)) issues.push('ml bets% do not sum to 100');
  if (!sumOk(g.spread.away.handle, g.spread.home.handle)) issues.push('spread handle% do not sum to 100');
  if (!sumOk(g.total.over.handle, g.total.under.handle)) issues.push('total handle% do not sum to 100');
  if (!sumOk(g.ml.away.handle, g.ml.home.handle)) issues.push('ml handle% do not sum to 100');
  return issues;
}

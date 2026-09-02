// Deterministic VSiN/DK betting-splits fetcher + parser.
// Source pages: https://data.vsin.com/betting-splits/?source=DK&sport=<SPORT>  (free page — no VSiN subscription needed)
// Layout contract (fail loud if violated):
//   - ONE <table> whose children alternate <thead> (one per game DATE) and <tbody> (that date's games).
//     A single table spans many dates, so the date must be tracked per thead, not per table.
//   - thead: [Sport - Date | Spread|Handle|Bets | Total|Handle|Bets | Money|Handle|Bets] — market group
//     order is read from the header (not assumed); within each group HANDLE precedes BETS.
//   - two team rows per game: first = ROAD team, second = HOME team (odd row count under a date => throw)
//   - totals: road row carries OVER percentages, home row carries UNDER (VSiN convention; no label in markup)
//   - stable game id in img[data-gamecode], e.g. 20260902MLB00019 — its first 8 digits must equal the section date
import { parse } from 'node-html-parser';

export const SPORTS = ['NFL', 'CFB', 'NBA', 'CBB', 'WNBA', 'MLB', 'NHL'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export async function fetchSplitsHTML(sport) {
  const url = `https://data.vsin.com/betting-splits/?source=DK&sport=${sport}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`vsin ${sport}: HTTP ${res.status}`);
  const html = await res.text();
  if (html.length < 5000) throw new Error(`vsin ${sport}: suspiciously small page (${html.length}b)`);
  return html;
}

// "+2,000" -> 2000 ; "-6,500" -> -6500 ; "49.5" -> 49.5 ; glyphs stripped
export function num(txt) {
  if (txt == null) return null;
  const m = String(txt).replace(/[△▲▽▼↺,]/g, '').match(/[+-]?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function pct(txt) {
  const m = String(txt ?? '').match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

function dateFromHead(head, now = new Date()) {
  const link = head.querySelector('a.sp-sport-link');
  const dm = link?.getAttribute('href')?.match(/gamedate=(\d{4}-\d{2}-\d{2})/);
  if (dm) return dm[1];
  const t = head.text.replace(/\s+/g, ' ');
  const m = t.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if (!m) return null;
  const mo = MONTHS[m[1].slice(0, 3).toLowerCase()], d = parseInt(m[2], 10);
  let y = now.getFullYear();
  const nowMo = now.getMonth() + 1;
  if (mo < nowMo - 6) y += 1;        // page shows next January while it is still autumn
  else if (mo > nowMo + 6) y -= 1;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Parse one sport page -> [{gamecode, sport, date:'YYYY-MM-DD', dhIndex, away, home,
//   spread:{line_home, away:{handle,bets}, home:{handle,bets}},
//   total:{line, over:{handle,bets}, under:{handle,bets}},
//   ml:{away_price, home_price, away:{handle,bets}, home:{handle,bets}}}]
// Returns [] for an off-season page (no splits table). Throws on any layout-contract violation.
export function parseSplits(html, sport, now = new Date()) {
  const root = parse(html);
  const games = [];
  for (const table of root.querySelectorAll('table')) {
    let date = null, order = null;
    const dh = {};
    for (const child of table.childNodes) {
      const tag = (child.rawTagName || '').toLowerCase();
      if (tag === 'thead') {
        // join header CELLS with a separator — node-html-parser's .text concatenates cells with no whitespace
        // each header cell holds a full label + a short label ("Spread"+"SPR"); take the full one when present
        const cells = child.querySelectorAll('th, td').map(c => (c.querySelector('.sp-full') || c).text.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const headText = (cells.length ? cells.join(' | ') : child.text).replace(/\s+/g, ' ');
        if (!/Handle/i.test(headText) || !/Bets?/i.test(headText)) { order = null; continue; }
        // contract 1: three Handle/Bets pairs, Handle first in each
        const seq = headText.match(/Handle|Bets?\b/gi) || [];
        if (seq.length !== 6 || seq.some((w, i) => (i % 2 === 0 ? !/handle/i.test(w) : !/bets?/i.test(w)))) {
          throw new Error(`vsin ${sport}: header contract violated (${seq.join(',')}) — refusing to parse`);
        }
        // contract 2: market group order is read from the header
        const groups = [];
        for (const m of headText.matchAll(/\b(Spread|Total|Money|ML)\b/gi)) {
          const k = /spread/i.test(m[1]) ? 'spread' : /total/i.test(m[1]) ? 'total' : 'ml';
          if (!groups.includes(k)) groups.push(k);
        }
        if (groups.length !== 3) throw new Error(`vsin ${sport}: expected Spread/Total/Money groups in header, got [${groups.join(',')}]`);
        order = groups;
        date = dateFromHead(child, now);
        if (!date) throw new Error(`vsin ${sport}: could not read the game date from a section header`);
      } else if (tag === 'tbody' && order) {
        const teamRows = child.querySelectorAll('tr').filter(r => r.querySelector('.sp-cell-team'));
        if (teamRows.length % 2 !== 0) throw new Error(`vsin ${sport}: odd team-row count (${teamRows.length}) under ${date} — road/home pairing unsafe`);
        for (let i = 0; i + 1 < teamRows.length; i += 2) {
          const road = teamRows[i], home = teamRows[i + 1];
          const gc = (road.querySelector('img[data-gamecode]') || home.querySelector('img[data-gamecode]'))?.getAttribute('data-gamecode') || null;
          const teamOf = r => (r.querySelector('.sp-cell-team a')?.text || r.querySelector('.sp-cell-team')?.text || '').trim();
          const grab = r => {
            const tds = r.querySelectorAll('td');
            const starts = [];
            tds.forEach((td, idx) => { if ((td.getAttribute('class') || '').includes('sp-col-first')) starts.push(idx); });
            if (starts.length < 3) return null;
            const g = s => ({ line: tds[s]?.text, handle: pct(tds[s + 1]?.text), bets: pct(tds[s + 2]?.text) });
            const out = {};
            order.forEach((k, j) => { out[k] = g(starts[j]); });
            return out;
          };
          const rM = grab(road), hM = grab(home);
          if (!rM || !hM) continue;
          const away = teamOf(road), homeName = teamOf(home);
          if (gc && date && gc.slice(0, 8) !== date.replace(/-/g, '')) {
            throw new Error(`vsin ${sport}: gamecode ${gc} does not match section date ${date} — date tracking broken`);
          }
          const dhKey = `${date}|${away}|${homeName}`;
          const dhIndex = (dh[dhKey] = (dh[dhKey] || 0) + 1) - 1;
          games.push({
            gamecode: gc, sport, date, dhIndex,
            away, home: homeName,
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
          });
        }
      }
    }
  }
  return games;
}

const MARKETS = { spread: ['away', 'home'], total: ['over', 'under'], ml: ['away', 'home'] };

// Per-market sanity. A market whose two sides are both missing/0 is ABSENT (not offered or no
// bets yet) — it is blanked so the formula skips it, and the game is kept. A market whose sides
// don't sum to ~100 is BAD — blanked and reported. The game is dropped only when no market survives.
// Returns { game, absent:[], bad:[], issues:[] }
export function scrubGame(g) {
  const absent = [], bad = [], issues = [];
  for (const [mk, [s1, s2]] of Object.entries(MARKETS)) {
    const a = g[mk][s1], b = g[mk][s2];
    const blank = () => { a.bets = a.handle = b.bets = b.handle = null; };
    const empty = (a.bets == null && b.bets == null) || (a.bets === 0 && b.bets === 0 && !(a.handle > 0 || b.handle > 0));
    if (empty) { absent.push(mk); blank(); continue; }
    const sumOk = (x, y) => x != null && y != null && Math.abs(x + y - 100) <= 3;
    if (!sumOk(a.bets, b.bets)) { bad.push(mk); issues.push(`${mk} bets% do not sum to 100 (${a.bets}/${b.bets})`); blank(); continue; }
    if (!sumOk(a.handle, b.handle)) { bad.push(mk); issues.push(`${mk} handle% do not sum to 100 (${a.handle}/${b.handle})`); blank(); }
  }
  return { game: g, absent, bad, issues, usable: absent.length + bad.length < 3 };
}

// kept for callers/tests that only want the issue list
export function validateGame(g) {
  return scrubGame(JSON.parse(JSON.stringify(g))).issues;
}

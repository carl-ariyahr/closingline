import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEventTicker, groupEvents, labelMatches, matchEvent, kalshiRead, MIN_VOLUME } from '../lib/kalshi.mjs';
import { boxesFor } from '../lib/boxes.mjs';

const mk = (event, label, vol, bid, ask) => ({ ticker: event + '-' + label.slice(0, 3).toUpperCase(), event_ticker: event, title: label + ' wins', yes_sub_title: label, yes_bid_dollars: String(bid), yes_ask_dollars: String(ask), last_price_dollars: String(ask), volume_fp: String(vol), open_interest_fp: String(vol) });
const MARKETS = [
  mk('KXMLBGAME-26SEP082140TEXSEA', 'Texas', 11315.11, 0.44, 0.45), mk('KXMLBGAME-26SEP082140TEXSEA', 'Seattle', 12522.01, 0.55, 0.56),
  mk('KXMLBGAME-26SEP081905COLNYY', 'New York Y', 90806.3, 0.75, 0.76), mk('KXMLBGAME-26SEP081905COLNYY', 'Colorado', 9351.62, 0.24, 0.25),
  mk('KXMLBGAME-26SEP082140TORATH', 'Toronto', 70022.56, 0.62, 0.63), mk('KXMLBGAME-26SEP082140TORATH', "A's", 85640.86, 0.37, 0.38),
  mk('KXMLBGAME-26SEP081940PITCWS', 'Pittsburgh', 6433.89, 0.43, 0.44), mk('KXMLBGAME-26SEP081940PITCWS', 'Chicago WS', 20457.62, 0.56, 0.57),
  mk('KXMLBGAME-26SEP101940PITCWS', 'Pittsburgh', 11, 0.48, 0.52), mk('KXMLBGAME-26SEP101940PITCWS', 'Chicago WS', 12.77, 0.47, 0.52),
  mk('KXMLBGAME-26SEP081305BOSNYY', 'Boston', 100, 0.5, 0.5), mk('KXMLBGAME-26SEP081305BOSNYY', 'New York Y', 100, 0.5, 0.5),
  mk('KXMLBGAME-26SEP081905BOSNYY', 'Boston', 100, 0.5, 0.5), mk('KXMLBGAME-26SEP081905BOSNYY', 'New York Y', 100, 0.5, 0.5),
  mk('KXNFLGAME-26SEP21NYGLAR', 'New York G', 3244, 0.21, 0.23), mk('KXNFLGAME-26SEP21NYGLAR', 'Los Angeles R', 2007, 0.76, 0.79),
];

test('event tickers parse to a Pacific-safe date and an Eastern start time', () => {
  const p = parseEventTicker('KXMLBGAME-26SEP082140TEXSEA');
  assert.equal(p.date, '2026-09-08'); assert.equal(p.timeET, '2140'); assert.equal(p.startISO, '2026-09-09T01:40:00.000Z'); // 9:40pm EDT
  const n = parseEventTicker('KXNFLGAME-26SEP21NYGLAR'); assert.equal(n.date, '2026-09-21'); assert.equal(n.timeET, null); assert.equal(n.startISO, null);
  assert.equal(parseEventTicker('garbage'), null);
});

test('labels: city plus nickname initials, aliases, no false matches', () => {
  assert.equal(labelMatches('New York Y', 'New York Yankees'), true);
  assert.equal(labelMatches('New York Y', 'New York Mets'), false);
  assert.equal(labelMatches('New York M', 'New York Mets'), true);
  assert.equal(labelMatches('Chicago WS', 'Chicago White Sox'), true);
  assert.equal(labelMatches('Chicago C', 'Chicago Cubs'), true);
  assert.equal(labelMatches('Chicago C', 'Chicago White Sox'), false);
  assert.equal(labelMatches('Los Angeles D', 'Los Angeles Dodgers'), true);
  assert.equal(labelMatches('Los Angeles A', 'Los Angeles Dodgers'), false);
  assert.equal(labelMatches('St. Louis', 'ST Louis Cardinals'), true);
  assert.equal(labelMatches("A's", 'Athletics'), true);
  assert.equal(labelMatches('Texas', 'Texas Rangers'), true);
  assert.equal(labelMatches('Texas', 'Texas Tech Red Raiders'), true); // prefix match: the event's OTHER team and date settle it
  assert.equal(labelMatches('Tampa Bay', 'Tampa Bay Rays'), true);
  assert.equal(labelMatches('Los Angeles R', 'Los Angeles Rams'), true);
  assert.equal(labelMatches('UCLA', 'UCLA Bruins'), true);
  assert.equal(labelMatches('Miami', 'Miami FL Hurricanes'), true);
});

test('matchEvent: both teams and the date; a doubleheader resolves by start time or not at all', () => {
  const ev = groupEvents(MARKETS);
  assert.equal(matchEvent(ev, { away: 'Texas Rangers', home: 'Seattle Mariners', date: '2026-09-08' }).event, 'KXMLBGAME-26SEP082140TEXSEA');
  assert.equal(matchEvent(ev, { away: 'Seattle Mariners', home: 'Texas Rangers', date: '2026-09-08' }).event, 'KXMLBGAME-26SEP082140TEXSEA'); // orientation-insensitive
  assert.equal(matchEvent(ev, { away: 'Pittsburgh Pirates', home: 'Chicago White Sox', date: '2026-09-08' }).event, 'KXMLBGAME-26SEP081940PITCWS'); // not the Sep 10 game
  assert.equal(matchEvent(ev, { away: 'Boston Red Sox', home: 'New York Yankees', date: '2026-09-08' }), null); // doubleheader, no start time: never guess
  assert.equal(matchEvent(ev, { away: 'Boston Red Sox', home: 'New York Yankees', date: '2026-09-08', start: '2026-09-08T17:05:00Z' }).event, 'KXMLBGAME-26SEP081305BOSNYY');
  assert.equal(matchEvent(ev, { away: 'Texas Rangers', home: 'Seattle Mariners', date: '2026-09-09' }), null);
});

test('kalshiRead: crowd = the side with more contracts; agrees when that is the side we fade; thin markets do not count', () => {
  const ev = groupEvents(MARKETS);
  const tex = kalshiRead(matchEvent(ev, { away: 'Texas Rangers', home: 'Seattle Mariners', date: '2026-09-08' }), { away: 'Texas Rangers', home: 'Seattle Mariners', side: 'away' });
  assert.equal(tex.crowd, 'home'); assert.equal(tex.agrees, true); assert.equal(tex.thin, false); assert.equal(tex.totalVol, 23837); assert.equal(tex.crowdShare, 53); assert.equal(tex.homePrice, 0.56);
  const ath = kalshiRead(matchEvent(ev, { away: 'Toronto Blue Jays', home: 'Athletics', date: '2026-09-08' }), { away: 'Toronto Blue Jays', home: 'Athletics', side: 'home' });
  assert.equal(ath.crowd, 'home'); assert.equal(ath.agrees, false); // Kalshi crowd is on the A's, our side: no box
  const thin = kalshiRead(matchEvent(ev, { away: 'Pittsburgh Pirates', home: 'Chicago White Sox', date: '2026-09-10' }), { away: 'Pittsburgh Pirates', home: 'Chicago White Sox', side: 'away' });
  assert.equal(thin.thin, true); assert.ok(thin.totalVol < MIN_VOLUME);
  assert.equal(kalshiRead(ev[0], { side: 'under' }), null);
  const b = boxesFor({ T: 64, H: 6, confirmation: 'confirmed', kalshi: tex }); assert.deepEqual(b.got, ['ticket', 'action', 'money65', 'kalshi']); assert.equal(b.total, 6);
  const b2 = boxesFor({ T: 64, H: 6, confirmation: 'confirmed', kalshi: thin }); assert.ok(b2.miss.includes('kalshi'));
  const b3 = boxesFor({ T: 64, H: 6, confirmation: 'confirmed' }); assert.equal(b3.total, 5); // no read: box not listed
});

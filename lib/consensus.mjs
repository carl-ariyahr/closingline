// CONSENSUS plays — follow the money (Carl 2026-09-11: "track it and put into Carl's daily plays when it hits that criteria").
// Finding (Sep 2-10): fades whose money CAUGHT UP to the tickets by first pitch went 10-23; the crowd side of those same
// games went 23-10. So when a fade we were tracking flips because the money joined the crowd, the crowd side becomes a
// play of its own kind, badged CONSENSUS, counted in the ledger and tracked separately. Criteria on the CURRENT read:
//   • the game had a qualifying fade earlier today (a shadow pick that was ok on at least one read)
//   • the crowd side of that market now holds T >= 60% of tickets AND H >= 60% of the money (tickets and money agree)
//   • the play is the crowd side; moneyline favorites heavier than MAX_FAV_PRICE are skipped (flat units)
//   • not started, at least MIN_HOURS before first pitch; at most CAP a day, most money first
// Hourly re-check: holds while the crowd side still has T >= 60 and H >= 60; else faded (DO NOT BET at kickoff like any play).
export const CONSENSUS = Object.freeze({ T: 60, H: 60, cap: 2, maxFavPrice: -150, minHours: 1 });
const fmt = v => (v == null ? '' : (v > 0 ? `+${v}` : `${v}`));
const opp = s => ({ away: 'home', home: 'away', over: 'under', under: 'over' })[s] || null;

// The crowd side of one market on a fresh VSiN game: {side, T, H, label, line, total, price}
export function marketRead(game, type) {
  if (!game) return null;
  if (type === 'Total') {
    const o = game.total?.over, u = game.total?.under; if (o?.bets == null || u?.bets == null || o.handle == null || u.handle == null) return null;
    const side = o.bets >= u.bets ? 'over' : 'under'; const c = side === 'over' ? o : u;
    return { side, T: c.bets, H: c.handle, label: `${side === 'over' ? 'Over' : 'Under'} ${game.total.line ?? ''}`.trim(), line: null, total: game.total.line ?? null, price: null };
  }
  if (type === 'Moneyline') {
    const a = game.ml?.away, h = game.ml?.home; if (a?.bets == null || h?.bets == null || a.handle == null || h.handle == null) return null;
    const side = a.bets >= h.bets ? 'away' : 'home'; const c = side === 'away' ? a : h; const price = side === 'away' ? game.ml.away_price : game.ml.home_price;
    return { side, T: c.bets, H: c.handle, label: `${side === 'away' ? game.away : game.home} ML${price != null ? ' ' + fmt(price) : ''}`, line: price != null ? fmt(price) : null, total: null, price: price ?? null };
  }
  const a = game.spread?.away, h = game.spread?.home; if (a?.bets == null || h?.bets == null || a.handle == null || h.handle == null) return null;
  const side = a.bets >= h.bets ? 'away' : 'home'; const c = side === 'away' ? a : h; const lh = game.spread.line_home;
  const line = lh == null ? null : side === 'home' ? lh : -lh;
  return { side, T: c.bets, H: c.handle, label: `${side === 'away' ? game.away : game.home}${line != null ? ' ' + fmt(line) : ''}`, line: line != null ? fmt(line) : null, total: null, price: null };
}

// Candidates from today's shadow picks against the fresh board. Returns [{pick (shadow), game, read}] sorted by money share.
export function consensusCandidates(shadowPicks, freshByCode, day, now = new Date(), C = CONSENSUS) {
  const out = [];
  for (const p of shadowPicks) {
    if (p.date !== day || p.result || !p.side) continue;
    const wasFade = (p.checks || []).some(c => c.ok);
    if (!wasFade) continue;
    const g = freshByCode[p.gamecode]; if (!g || g.started) continue;
    if (!g.start || (new Date(g.start) - now) < C.minHours * 3600e3) continue;
    const r = marketRead(g, p.type); if (!r) continue;
    if (r.side !== opp(p.side)) continue;                  // the crowd must still be on the side we were fading
    if (r.T < C.T || r.H < C.H) continue;                  // tickets AND money agree
    if (p.type === 'Moneyline' && r.price != null && r.price < C.maxFavPrice) continue; // no heavy favorites at flat units
    out.push({ pick: p, game: g, read: r });
  }
  return out.sort((a, b) => b.read.H - a.read.H || b.read.T - a.read.T || String(a.pick.gamecode).localeCompare(String(b.pick.gamecode)));
}

export const consensusKey = (gamecode, type) => `${gamecode}|${type}|consensus`;
export function buildConsensusPick(cand, ts) {
  const { pick: p, game: g, read: r } = cand;
  return {
    src: 'code', kind: 'consensus', srcKey: consensusKey(p.gamecode, p.type), type: p.type, pick: r.label,
    game: `${g.away} @ ${g.home} — ${g.date} (${g.sport})`, status: 'play', side: r.side, line: r.line, total: r.total, dhIndex: g.dhIndex ?? 0, start: g.start || null,
    T: r.T, H: r.H, D: +(r.T - r.H).toFixed(1), gamecode: p.gamecode, sport: g.sport, date: g.date, away: g.away, home: g.home,
    fromFade: `${p.pick}${p.line ? ' ' + p.line : ''}`, postedAt: ts, playsShownAt: ts,
    signal: `🔁 CONSENSUS (follow the money): our fade of ${r.label} flipped — the crowd holds ${r.T}% of tickets AND ${r.H}% of the money on it now, so we take the crowd side · was ${p.pick}${p.line ? ' ' + p.line : ''} at posting (${p.T}% tickets / ${p.H}% money)`,
  };
}

// Add up to the daily cap onto the code card for `day`; stamps dailyCard {day, rank:'C1'.., kind}, playsShownAt. Returns the picks added.
export function addConsensusPlays(live, cands, day, now = new Date(), C = CONSENSUS) {
  const ts = now.toISOString();
  live.cards = live.cards || [];
  let card = live.cards.find(c => c.id === `code-${day}`);
  const existing = live.cards.filter(c => /^code-/.test(String(c.id))).flatMap(c => c.picks || []).filter(p => p.kind === 'consensus' && p.date === day);
  const have = new Set(existing.map(p => p.srcKey));
  const room = C.cap - existing.length; if (room <= 0) return [];
  const added = [];
  for (const cand of cands) {
    if (added.length >= room) break;
    const key = consensusKey(cand.pick.gamecode, cand.pick.type); if (have.has(key)) continue;
    if (!card) { card = { id: `code-${day}`, title: `Code card — ${day}`, source: 'code', createdAt: ts, picks: [] }; live.cards.push(card); }
    const lp = buildConsensusPick(cand, now.toISOString());
    lp.dailyCard = { day, rank: `C${existing.length + added.length + 1}`, kind: 'consensus', builtAt: ts, fromFade: lp.fromFade };
    card.picks.push(lp); added.push(lp); have.add(key);
  }
  if (added.length) {
    live.dailyCards = live.dailyCards || {};
    const dc = live.dailyCards[day] || (live.dailyCards[day] = { day, builtAt: ts, cap: 3, candidates: 0, picks: [] });
    dc.consensus = [...(dc.consensus || []), ...added.map(lp => ({ srcKey: lp.srcKey, rank: lp.dailyCard.rank, pick: lp.pick, game: lp.game, type: lp.type, sport: lp.sport, start: lp.start, T: lp.T, H: lp.H, fromFade: lp.fromFade, addedAt: ts }))];
    dc.updatedAt = ts; dc.added = (dc.added || 0) + added.length;
    live.dailyCardSince = live.dailyCardSince || ts;
  }
  return added;
}

// Hourly re-check of a consensus pick against the fresh game
export function consensusCheck(lp, game, now = new Date(), C = CONSENSUS) {
  const ts = now.toISOString();
  const r = marketRead(game, lp.type); if (!r) return { ts, ok: false, why: 'unmatched' };
  if (r.side !== lp.side) return { ts, ok: false, why: 'flipped', T: r.T, H: r.H, D: +(r.T - r.H).toFixed(1), crowd: r.label };
  if (r.T >= C.T && r.H >= C.H) return { ts, ok: true, T: r.T, H: r.H, D: +(r.T - r.H).toFixed(1) };
  return { ts, ok: false, why: 'faded', T: r.T, H: r.H, D: +(r.T - r.H).toFixed(1) };
}
const PT_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
export function applyConsensusCheck(lp, check, now = new Date()) {
  const prev = lp.liveCheck || {};
  const n = check.ok ? (prev.ok ? (prev.n || 0) + 1 : 1) : 0;
  const stamp = PT_TIME.format(now).toLowerCase().replace(' ', '');
  const tag = check.ok ? `✓ consensus holds ${n}× (last ${stamp}: crowd ${check.T}% tickets / ${check.H}% money on our side)`
    : check.why === 'flipped' ? `⛔ CONSENSUS FLIPPED on the ${stamp} read — the crowd is now on ${check.crowd}. Do not bet.`
    : check.why === 'faded' ? `⚠ consensus faded on the ${stamp} read (crowd ${check.T}% tickets / ${check.H}% money — below the 60/60 bar). Not a bet unless it comes back before kickoff.`
    : `⏱ could not re-read this market at ${stamp}`;
  const cleaned = String(lp.signal || '').replace(/\s*·\s*(✓ consensus holds[^·]*|⛔ CONSENSUS FLIPPED[^·]*|⚠ consensus faded[^·]*|⏱ could not re-read[^·]*)/g, '').trim();
  const next = `${cleaned} · ${tag}`;
  const changed = next !== lp.signal || JSON.stringify({ ...prev, ts: 0 }) !== JSON.stringify({ ...check, n, ts: 0 });
  lp.signal = next; lp.liveCheck = { ...check, n };
  return changed;
}

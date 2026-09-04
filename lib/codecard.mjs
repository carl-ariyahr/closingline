// Today's Plays come from the CODE pipeline (Carl 2026-09-04: "okay cut it over to code").
// Every run, the shadow picks are mirrored onto Carl's live card as picks on a per-posting-day "code-YYYY-MM-DD"
// card. The live copy is what the dashboard shows, the ledger stamps, the hourly re-confirm tags, and the
// grader grades. Rules:
//   • a pick is created only while its shadow pick is active; its label/line are frozen at creation (the bet as shown)
//   • status follows the shadow tier — except a pick already SHOWN on Today's Plays is never downgraded
//     (Carl 2026-09-02: "if you show it to me, it needs to be counted"); the hourly tag says what changed
//   • a shadow pick that fades/retires before it was ever shown is retired on the card (status dead) and comes
//     back if the signal returns
//   • AI-written fade picks on the old slate cards never become plays again: play/lean → watch, marked as a note
export const CODE_PLAYS_SINCE = '2026-09-04T16:00:00.000Z'; // 9am PT — cutover moment
export const CODE_FIRST_GAME_DATE = '2026-09-05';            // today's (Sep 4) card stays as the AI wrote it
export const AI_NOTE_TAG = 'ℹ AI note only — Today’s Plays are chosen by the code pipeline since Sep 4; this is commentary, not a play';

export const codeCardId = day => `code-${day}`;
export const mirrorable = p => (p.postedAt || '') >= CODE_PLAYS_SINCE || (p.date || '') >= CODE_FIRST_GAME_DATE;
export const labelOf = p => `${p.pick}${p.line ? ' ' + p.line : ''}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const title = day => { const [y, m, d] = day.split('-').map(Number); return `Code card — ${MON[m - 1]} ${d}`; };

function fromShadow(p, ts) {
  return {
    src: 'code', srcKey: `${p.gamecode}|${p.type}`, kind: 'fade', type: p.type,
    pick: labelOf(p), game: p.game, signal: p.signal || '', status: p.tier,
    side: p.side, line: p.line ?? null, total: p.total ?? null, dhIndex: p.dhIndex ?? 0, start: p.start || null,
    flag98: !!p.flag98, contention: p.contention || null, sharpNote: p.sharpNote || null, external: p.external || null,
    confirmation: p.confirmation?.level || null, T: p.T, H: p.H, D: p.D,
    gamecode: p.gamecode, sport: p.sport, date: p.date, away: p.away, home: p.home,
    postedAt: p.postedAt, mirroredAt: ts,
  };
}

export function syncCodeCard(live, picksDoc, ts) {
  const r = { created: 0, updated: 0, retired: 0, restored: 0, aiDemoted: 0 };
  live.cards = live.cards || [];
  for (const [day, d] of Object.entries(picksDoc.days || {})) {
    for (const p of d.picks || []) {
      if (!mirrorable(p) || !p.gamecode) continue;
      let card = live.cards.find(c => c.id === codeCardId(day));
      let lp = card?.picks.find(x => x.srcKey === `${p.gamecode}|${p.type}`);
      if (!lp) {
        if (p.status !== 'active' || p.result) continue;
        if (!card) { card = { id: codeCardId(day), title: title(day), source: 'code', createdAt: ts, picks: [] }; live.cards.push(card); }
        card.picks.push(fromShadow(p, ts)); r.created++; continue;
      }
      if (lp.result && lp.result !== 'pending') continue;
      const shown = !!lp.playsShownAt;
      let changed = false;
      const set = (k, v) => { if (JSON.stringify(lp[k] ?? null) !== JSON.stringify(v ?? null)) { lp[k] = v; changed = true; } };
      if (p.status === 'active') {
        if (lp.status === 'dead' && lp.retiredWhy) { delete lp.retiredWhy; r.restored++; changed = true; }
        const want = shown && lp.status === 'play' ? 'play' : p.tier;
        set('status', want);
        set('T', p.T); set('H', p.H); set('D', p.D); set('flag98', !!p.flag98);
        set('sharpNote', p.sharpNote || null); set('external', p.external || null); set('confirmation', p.confirmation?.level || null);
        if (p.start) set('start', p.start);
        if (p.dhIndex != null) set('dhIndex', p.dhIndex);
      } else if (!shown && lp.status !== 'dead') {
        lp.status = 'dead';
        lp.retiredWhy = p.status === 'retired' ? (p.retiredReason || 'retired') : `faded before it was ever shown (${p.fadeReason || 'no longer qualifies'})`;
        r.retired++; changed = true;
      }
      if (changed) r.updated++;
    }
  }
  // AI-written fade picks on the old slate cards: never a play/lean again unless already shown
  for (const c of live.cards) {
    if (!/^slate-/.test(String(c.id)) || !Array.isArray(c.picks)) continue;
    for (const lp of c.picks) {
      if (lp.src === 'code' || (lp.kind && lp.kind !== 'fade')) continue;
      if (lp.playsShownAt || (lp.result && lp.result !== 'pending')) continue;
      if (lp.status !== 'play' && lp.status !== 'lean' && !lp.stack) continue;
      lp.status = 'watch'; delete lp.stack; lp.aiNote = true;
      if (!String(lp.signal || '').includes(AI_NOTE_TAG)) lp.signal = `${String(lp.signal || '').trim()} · ${AI_NOTE_TAG}`;
      r.aiDemoted++;
    }
  }
  live.playsSource = 'code'; live.playsSourceSince = CODE_PLAYS_SINCE;
  return r;
}

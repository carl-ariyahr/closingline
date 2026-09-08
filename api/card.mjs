// Daily card commentary (Carl 2026-09-07).
//   GET  /api/card[?day=YYYY-MM-DD | ?pending=1]  → the card with every play's context (pending=1: latest card lacking commentary, or null)
//   POST /api/card  {day, commentary:{<srcKey>: text, __card?: text}}  → stores the read on each play; never touches picks/grades
import { get, put } from '@vercel/blob';
import { authorized } from '../lib/auth.mjs';
import { cardContext, pendingCommentaryDay, applyCommentary } from '../lib/commentary.mjs';

const PICKS = 'closing-line-picks.json', LINES = 'closing-line-line-history.json';
const rb = async n => { const r = await get(n, { access: 'private', useCache: false }); if (!r?.stream) throw new Error(`${n} unreadable`); return JSON.parse(await new Response(r.stream).text()); };
export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'bad key' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const live = await rb(PICKS);
    if (req.method === 'GET') {
      const hist = await rb(LINES).catch(() => ({ games: {} }));
      const day = req.query.pending === '1' ? pendingCommentaryDay(live) : (req.query.day || Object.keys(live.dailyCards || {}).sort().pop());
      return res.status(200).json({ at: new Date().toISOString(), day: day || null, card: day ? cardContext(live, hist.games || {}, day, { onlyMissing: req.query.pending === '1' }) : null });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!body.day || !body.commentary || typeof body.commentary !== 'object') return res.status(400).json({ error: 'need day and commentary{srcKey: text}' });
    const n = applyCommentary(live, body.day, body.commentary);
    if (n) { live.rev = (live.rev || 0) + 1; await put(PICKS, JSON.stringify(live), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' }); }
    return res.status(200).json({ ok: true, day: body.day, stamped: n });
  } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
}

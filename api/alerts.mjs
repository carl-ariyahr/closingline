// GET /api/alerts[?mark=1]  (x-app-key or ?k=) — early sharp moves not yet pushed to Carl.
// The hourly alert routine calls this with mark=1: it gets the new alerts and they are stamped pushed in the same call,
// so a routine that runs twice, or two routines, never push the same move twice.
import { get, put } from '@vercel/blob';
import { authorized } from '../lib/auth.mjs';
import { pendingAlerts, markPushed, pendingCard, markCardPushed } from '../lib/alerts.mjs';
import { cardText } from '../lib/dailycard.mjs';

const BLOB = 'closing-line-picks.json';
export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'bad key' });
  const r = await get(BLOB, { access: 'private', useCache: false });
  if (!r?.stream) return res.status(503).json({ error: 'live card unreadable' });
  const live = JSON.parse(await new Response(r.stream).text());
  const now = new Date();
  const alerts = pendingAlerts(live, now);
  const card = pendingCard(live); // tomorrow's daily card, once (Carl 2026-09-07)
  let marked = 0, cardMarked = 0;
  if (req.query.mark === '1' && (alerts.length || card)) {
    marked = markPushed(live, alerts, now);
    if (card) cardMarked = markCardPushed(live, card, now);
    live.rev = (live.rev || 0) + 1;
    await put(BLOB, JSON.stringify(live), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ at: now.toISOString(), count: alerts.length, marked, alerts, card: card ? { ...card, text: cardText(card), marked: cardMarked } : null });
}

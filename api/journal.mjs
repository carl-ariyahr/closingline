// Nightly journal (Carl 2026-09-07): the routine reads today's context and writes one entry the dashboard shows.
//   GET  /api/journal[?date=YYYY-MM-DD]  → context: today's card plays with results and CLV, ledger records, audit summary, yesterday's entry
//   POST /api/journal  {date, read, graded?, record?, recommendations?, clvNotes?, trendNotes?}  → upsert the entry for that date
import { get, put } from '@vercel/blob';
import { authorized } from '../lib/auth.mjs';
import { journalContext, upsertJournal, todayPT } from '../lib/commentary.mjs';
import { auditGrades } from '../lib/audit.mjs';

const PICKS = 'closing-line-picks.json', JOURNAL = 'closing-line-journal.json';
const rb = async (n, fb) => { try { const r = await get(n, { access: 'private', useCache: false }); if (!r?.stream) return fb; return JSON.parse(await new Response(r.stream).text()); } catch { return fb; } };
export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'bad key' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const journal = await rb(JOURNAL, { rev: 0, entries: [] });
    if (req.method === 'GET') {
      const live = await rb(PICKS, { cards: [] });
      const date = req.query.date || todayPT();
      const ctx = journalContext(live, journal, date);
      let audit = null; try { const a = await auditGrades({ date, fix: false }); audit = { summary: a.summary || `${a.checked} checked, ${a.agree} agree, ${a.wrong.length} wrong, ${a.pending.length} ungraded`, wrong: a.wrong, pending: a.pending }; } catch (e) { audit = { error: String(e.message || e) }; }
      return res.status(200).json({ at: new Date().toISOString(), ...ctx, audit, existingEntry: (journal.entries || []).find(e => e.date === date) || null });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const entry = upsertJournal(journal, body);
    await put(JOURNAL, JSON.stringify(journal), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    return res.status(200).json({ ok: true, date: entry.date, rev: journal.rev });
  } catch (e) { return res.status(400).json({ error: String(e.message || e) }); }
}

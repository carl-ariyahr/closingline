// Nightly second look at the grades, in the cloud: GET /api/audit?date=YYYY-MM-DD[&fix=1]  (x-app-key)
import { auditGrades } from '../lib/audit.mjs';
import { authorized, isCron } from '../lib/auth.mjs';
const ptDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d || new Date());
export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'bad key' });
  const date = req.query.date || ptDate();
  const fix = req.query.fix === '1' || isCron(req); // the nightly Vercel Cron always writes corrected grades back
  try {
    const r = await auditGrades({ date, fix });
    r.summary = `${date}: ${r.checked} graded checked, ${r.agree} agree, ${r.wrong.length} wrong${fix ? ` (${r.fixed} fixed)` : ''}, ${r.unverifiable.length} unverifiable, ${r.pending.length} ungraded plays; shadow ${r.shadow.checked} checked, ${r.shadow.differ.length} differ`;
    return res.status(200).json(r);
  } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
}

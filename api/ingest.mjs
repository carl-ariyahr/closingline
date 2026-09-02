// External public-splits ingest (key-gated).
// Sources with no licensed API (Action Network bets%/money%, DonBest board reads) are pulled
// during interactive sessions and POSTed here. The pipeline uses them ONLY as cross-confirmation
// annotations ("✓ Action Network confirms public on X") — never to make or change a pick.
//
// POST body: { source: 'actionnetwork'|'donbest', league: 'MLB', date: 'YYYY-MM-DD', pulledAt?: ISO,
//   rows: [{ away, home, market: 'ML'|'Spread'|'Total',
//            a: { name, bets, money }, b: { name, bets, money }, numBets? }] }
// Upserts by source|league|date|away|home|market. GET returns the doc.
import { put, get } from '@vercel/blob';

const BLOB = 'closing-line-external-splits.json';

async function readBlob() {
  try {
    const r = await get(BLOB, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return { rev: 0, rows: {} };
    const t = await new Response(r.stream).text();
    return t ? JSON.parse(t) : { rev: 0, rows: {} };
  } catch { return { rev: 0, rows: {} }; }
}
const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const lastWord = s => norm(String(s || '').trim().split(/\s+/).pop());

export default async function handler(req, res) {
  const key = req.headers['x-app-key'] || req.query.k;
  if (!process.env.APP_KEY || key !== process.env.APP_KEY) return res.status(401).json({ error: 'bad key' });

  const doc = await readBlob();
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.query.meta === '1') return res.status(200).json({ rev: doc.rev || 0, rows: Object.keys(doc.rows || {}).length });
    return res.status(200).json(doc);
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { source, league, date, rows, pulledAt } = body || {};
  if (!source || !league || !date || !Array.isArray(rows)) return res.status(400).json({ error: 'need source, league, date, rows[]' });
  const ts = pulledAt || new Date().toISOString();
  let n = 0;
  for (const r of rows) {
    if (!r.away || !r.home || !r.market || !r.a || !r.b) continue;
    const k = [source, league, date, lastWord(r.away), lastWord(r.home), r.market].join('|');
    doc.rows[k] = { source, league, date, away: r.away, home: r.home, market: r.market, a: r.a, b: r.b, numBets: r.numBets ?? null, pulledAt: ts };
    n++;
  }
  // prune anything older than 10 days
  const cutoff = new Date(Date.now() - 10 * 24 * 3600e3).toISOString().slice(0, 10);
  for (const k of Object.keys(doc.rows)) if (doc.rows[k].date < cutoff) delete doc.rows[k];
  doc.rev = (doc.rev || 0) + 1;
  await put(BLOB, JSON.stringify(doc), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  return res.status(200).json({ ok: true, upserted: n, rev: doc.rev, totalRows: Object.keys(doc.rows).length });
}

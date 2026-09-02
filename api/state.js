import { put, get } from '@vercel/blob';

const DOCS = {
  state: 'closing-line-state.json',   // dashboard bets/bankroll
  lines: 'closing-line-lines.json',   // line & splits snapshot history
  picks: 'closing-line-picks.json',   // Claude's suggested picks (fade cards)
  journal: 'closing-line-journal.json', // daily grading, system record, strategy recommendations
  sentiment: 'closing-line-sentiment.json' // NFL public/expert straight-up sentiment per game
};

export default async function handler(req, res) {
  const key = req.headers['x-app-key'] || req.query.k;
  if (!process.env.APP_KEY || key !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'missing or bad key' });
  }
  const doc = req.query.doc || 'state';
  // archive-YYYY-MM: cold storage for line history of finished games (one doc per month)
  const BLOB_NAME = DOCS[doc] ||
    (/^archive-\d{4}-\d{2}$/.test(doc) ? `closing-line-${doc}.json` : null);
  if (!BLOB_NAME) return res.status(400).json({ error: 'unknown doc' });

  if (req.method === 'GET') {
    // useCache:false — reads must reflect the latest overwrite of this pathname
    const result = await get(BLOB_NAME, { access: 'private', useCache: false });
    res.setHeader('Cache-Control', 'private, no-store');
    if (!result || result.statusCode !== 200 || !result.stream) {
      return res.status(200).json(null);
    }
    const text = await new Response(result.stream).text();
    return res.status(200).json(text ? JSON.parse(text) : null);
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!body || body.length > 4 * 1024 * 1024) {
      return res.status(400).json({ error: 'bad payload' });
    }
    try { JSON.parse(body); } catch { return res.status(400).json({ error: 'not JSON' }); }
    await put(BLOB_NAME, body, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json'
    });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).end();
}

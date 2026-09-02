import { put, get } from '@vercel/blob';

const DOCS = {
  state: 'closing-line-state.json',   // dashboard bets/bankroll
  lines: 'closing-line-lines.json',   // line & splits snapshot history (LLM routines) — pruned server-side, see below
  picks: 'closing-line-picks.json',   // Claude's suggested picks (fade cards)
  journal: 'closing-line-journal.json', // daily grading, system record, strategy recommendations
  sentiment: 'closing-line-sentiment.json', // NFL public/expert straight-up sentiment per game
  // shadow docs are written ONLY by api/pipeline.mjs (the code pipeline) — read-only here
  shadowpicks: 'closing-line-shadow-picks.json',
  shadowlines: 'closing-line-shadow-lines.json'
};
const READ_ONLY_DOCS = new Set(['shadowpicks', 'shadowlines']);
const LINES_KEEP_DAYS = 4;      // Carl 2026-09-02: keep 4 days live, archive the rest by month
const MAX_BODY = 4 * 1024 * 1024;

async function readJSON(name) {
  const r = await get(name, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  const t = await new Response(r.stream).text();
  return t ? JSON.parse(t) : null;
}
async function writeJSON(name, obj) {
  await put(name, JSON.stringify(obj), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
}

// Move snapshots older than LINES_KEEP_DAYS out of the live lines doc into archive-YYYY-MM docs
// (grouped by snapshot month). Deterministic, runs on every write, so the live doc can never
// grow past a few days no matter which routine writes it. Returns {doc, archived}.
async function pruneLines(doc) {
  if (!doc || !Array.isArray(doc.snapshots)) return { doc, archived: 0 };
  const cutoff = Date.now() - LINES_KEEP_DAYS * 24 * 3600e3;
  const keep = [], old = {};
  for (const s of doc.snapshots) {
    const t = new Date(s.ts).getTime();
    if (!Number.isFinite(t) || t >= cutoff) { keep.push(s); continue; }
    const ym = new Date(t).toISOString().slice(0, 7);
    (old[ym] = old[ym] || []).push(s);
  }
  let archived = 0;
  for (const [ym, snaps] of Object.entries(old)) {
    const name = `closing-line-archive-${ym}.json`;
    let arch = null;
    try { arch = await readJSON(name); } catch { arch = null; }
    if (!arch || !Array.isArray(arch.snapshots)) arch = { rev: 0, month: ym, snapshots: [] };
    const have = new Set(arch.snapshots.map(s => `${s.ts}|${s.sport || ''}`));
    for (const s of snaps) if (!have.has(`${s.ts}|${s.sport || ''}`)) { arch.snapshots.push(s); archived++; }
    arch.rev = (arch.rev || 0) + 1;
    arch.updated = new Date().toISOString();
    await writeJSON(name, arch);
  }
  return { doc: { ...doc, snapshots: keep, pruned: { keepDays: LINES_KEEP_DAYS, at: new Date().toISOString(), archived } }, archived };
}

export default async function handler(req, res) {
  const key = req.headers['x-app-key'] || req.query.k;
  if (!process.env.APP_KEY || key !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'missing or bad key' });
  }
  const doc = req.query.doc || 'state';
  const BLOB_NAME = DOCS[doc] ||
    (/^archive-\d{4}-\d{2}$/.test(doc) ? `closing-line-${doc}.json` : null);
  if (!BLOB_NAME) return res.status(400).json({ error: 'unknown doc' });

  if (req.method === 'HEAD' || (req.method === 'GET' && req.query.meta === '1')) {
    // cheap freshness probe for the dashboard: {rev, bytes} without the body
    let text = '';
    try { const r = await get(BLOB_NAME, { access: 'private', useCache: false }); if (r && r.statusCode === 200 && r.stream) text = await new Response(r.stream).text(); } catch {}
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'HEAD') { res.setHeader('x-doc-bytes', String(text.length)); return res.status(200).end(); }
    let rev = null; try { rev = text ? JSON.parse(text).rev ?? null : null; } catch {}
    return res.status(200).json({ rev, bytes: text.length });
  }

  if (req.method === 'GET') {
    const result = await get(BLOB_NAME, { access: 'private', useCache: false });
    res.setHeader('Cache-Control', 'private, no-store');
    if (!result || result.statusCode !== 200 || !result.stream) return res.status(200).json(null);
    const text = await new Response(result.stream).text();
    return res.status(200).json(text ? JSON.parse(text) : null);
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    if (READ_ONLY_DOCS.has(doc)) return res.status(405).json({ error: 'read-only doc' });
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!body || body.length > MAX_BODY) return res.status(400).json({ error: `bad payload (${body ? body.length : 0} bytes; max ${MAX_BODY})` });
    let parsed;
    try { parsed = JSON.parse(body); } catch { return res.status(400).json({ error: 'not JSON' }); }
    if (doc === 'lines') {
      const { doc: pruned, archived } = await pruneLines(parsed);
      await writeJSON(BLOB_NAME, pruned);
      return res.status(200).json({ ok: true, snapshots: pruned.snapshots.length, archived });
    }
    await put(BLOB_NAME, body, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, HEAD, PUT, POST');
  return res.status(405).end();
}

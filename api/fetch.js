// Key-gated fetch proxy for the cloud routines — their sandbox can only reach
// this app, so sentiment sources (ESPN, NFL Pickwatch, Covers) route through here.
const ALLOWED = [/(^|\.)nflpickwatch\.com$/i, /(^|\.)espn\.com$/i, /(^|\.)covers\.com$/i];

export default async function handler(req, res) {
  const key = req.headers['x-app-key'] || req.query.k;
  if (!process.env.APP_KEY || key !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'missing or bad key' });
  }
  let target;
  try { target = new URL(req.query.url); } catch { return res.status(400).json({ error: 'bad url' }); }
  if (target.protocol !== 'https:' || !ALLOWED.some(r => r.test(target.hostname))) {
    return res.status(400).json({ error: 'domain not allowed' });
  }
  const r = await fetch(target.href, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8'
    }
  });
  const text = await r.text();
  res.setHeader('Cache-Control', 'private, max-age=900');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send(text.slice(0, 2000000));
}

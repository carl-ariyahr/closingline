// Weather proxy — cloud routines can't reach api.open-meteo.com directly
// (egress allowlist), but they can reach this API, and Vercel functions have
// open outbound network. Free service, no key required.
export default async function handler(req, res) {
  const key = req.headers['x-app-key'] || req.query.k;
  if (!process.env.APP_KEY || key !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'missing or bad key' });
  }
  const { lat, lon, date } = req.query;
  if (!lat || !lon || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ error: 'need lat, lon, date=YYYY-MM-DD' });
  }
  // forecast endpoint serves both future (+16d) and recent past (−92d) dates
  const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + Number(lat)
    + '&longitude=' + Number(lon)
    + '&hourly=wind_speed_10m,wind_gusts_10m&wind_speed_unit=mph&timezone=auto'
    + '&start_date=' + date + '&end_date=' + date;
  const r = await fetch(u);
  if (!r.ok) return res.status(502).json({ error: 'weather fetch failed' });
  const d = await r.json();
  res.setHeader('Cache-Control', 'private, max-age=1800');
  return res.status(200).json({
    tz: d.timezone,
    hours: d.hourly && d.hourly.time,
    wind_mph: d.hourly && d.hourly.wind_speed_10m,
    gusts_mph: d.hourly && d.hourly.wind_gusts_10m
  });
}

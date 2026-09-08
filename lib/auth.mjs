// Request authorization for the API routes.
//   • Carl's dashboard and manual calls: x-app-key header or ?k= query equal to APP_KEY.
//   • Vercel Cron (vercel.json "crons"): Vercel sends `Authorization: Bearer <CRON_SECRET>` on every
//     scheduled invocation. The crons replaced the hourly/nightly Claude routines on 2026-09-07 so the
//     pipeline keeps running no matter which Claude account is logged in.
export function isCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = req.headers?.authorization || '';
  return h === `Bearer ${secret}`;
}
export function authorized(req) {
  const key = req.headers?.['x-app-key'] || req.query?.k;
  if (process.env.APP_KEY && key === process.env.APP_KEY) return true;
  return isCron(req);
}

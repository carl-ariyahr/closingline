// CLI wrapper around lib/audit.mjs (the cloud runs the same code nightly via /api/audit).
//   node scripts/audit-grades.mjs [--date=YYYY-MM-DD] [--fix]
import fs from 'node:fs';
import { auditGrades } from '../lib/audit.mjs';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const r = await auditGrades({ date: args.date || null, fix: !!args.fix });
console.log(`LIVE CARD${r.date ? ' ' + r.date : ''}: ${r.checked} graded checked — ${r.agree} agree, ${r.wrong.length} WRONG, ${r.unverifiable.length} unverifiable`);
for (const w of r.wrong) console.log('  WRONG:', w);
for (const u of r.unverifiable) console.log('  unverifiable:', u);
if (r.pending.length) { console.log(`UNGRADED plays: ${r.pending.length}`); for (const p of r.pending) console.log('  ', p); }
console.log(`SHADOW: ${r.shadow.checked} graded — ${r.shadow.agree} agree, ${r.shadow.differ.length} differ`);
for (const x of r.shadow.differ) console.log('  ', x);
if (r.fixed) console.log(`FIXED ${r.fixed} result(s) on the live card`);

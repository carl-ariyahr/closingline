import test from 'node:test';
import assert from 'node:assert/strict';
import { authorized, isCron } from '../lib/auth.mjs';

test('APP_KEY via header or query authorizes; wrong key does not', () => {
  process.env.APP_KEY = 'abc'; delete process.env.CRON_SECRET;
  assert.equal(authorized({ headers: { 'x-app-key': 'abc' }, query: {} }), true);
  assert.equal(authorized({ headers: {}, query: { k: 'abc' } }), true);
  assert.equal(authorized({ headers: { 'x-app-key': 'nope' }, query: {} }), false);
  assert.equal(authorized({ headers: {}, query: {} }), false);
});

test('Vercel Cron bearer authorizes only when CRON_SECRET is set and matches', () => {
  process.env.APP_KEY = 'abc';
  delete process.env.CRON_SECRET;
  assert.equal(isCron({ headers: { authorization: 'Bearer s3cret' } }), false);
  process.env.CRON_SECRET = 's3cret';
  assert.equal(isCron({ headers: { authorization: 'Bearer s3cret' } }), true);
  assert.equal(authorized({ headers: { authorization: 'Bearer s3cret' }, query: {} }), true);
  assert.equal(authorized({ headers: { authorization: 'Bearer wrong' }, query: {} }), false);
});

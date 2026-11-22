import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { drawRing, ringOrder, themeFor, PACKS, isUnkind, dayIndex } from '../../worker/game.js';
import { SCHEMA } from '../../worker/schema.js';

test('ring: everyone has exactly one mortal, never themselves, one single cycle', () => {
  for (let n = 3; n <= 80; n++) {
    for (let rep = 0; rep < 20; rep++) {
      const ids = Array.from({ length: n }, (_, i) => 'm' + i);
      const ring = drawRing(ids);
      assert.equal(ring.size, n);
      const mortals = new Set(ring.values());
      assert.equal(mortals.size, n, 'each person is someone\'s mortal once');
      for (const [a, m] of ring) assert.notEqual(a, m);
      const order = ringOrder(Object.fromEntries(ring), ids[0]);
      assert.equal(order.length, n, 'one cycle through everybody');
    }
  }
});

test('ring: fewer than 3 people cannot draw', () => {
  assert.equal(drawRing([]), null);
  assert.equal(drawRing(['a', 'b']), null);
});

test('ring: roughly uniform (each person draws each other person sometimes)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const seen = {};
  for (let i = 0; i < 4000; i++) {
    const r = drawRing(ids);
    const k = 'a>' + r.get('a');
    seen[k] = (seen[k] || 0) + 1;
  }
  for (const m of ['b', 'c', 'd', 'e']) assert.ok(seen['a>' + m] > 800 && seen['a>' + m] < 1200, JSON.stringify(seen));
});

test('themes: daily changes every day, weekly every 7 days, none is null, clamps at the end', () => {
  const t0 = Date.UTC(2026, 11, 1, 10) / 1000;
  assert.equal(themeFor('daily', t0, t0).n, 1);
  assert.equal(themeFor('daily', t0, t0 + 86400).n, 2);
  assert.equal(themeFor('weekly', t0, t0 + 6 * 86400).n, 1);
  assert.equal(themeFor('weekly', t0, t0 + 7 * 86400 + 100).n, 2);
  assert.equal(themeFor('none', t0, t0), null);
  assert.equal(themeFor('daily', t0, t0 + 400 * 86400).n, PACKS.daily.items.length);
  assert.equal(themeFor('bogus', t0, t0).n, 1, 'unknown pack falls back to daily');
  assert.equal(dayIndex(t0, t0 - 100), 0);
});

test('kindness filter: blocks obvious abuse, allows normal notes', () => {
  for (const bad of ['you are a bitch', 'KYS', 'f*** off you twat', 'putangina mo']) assert.ok(isUnkind(bad), bad);
  for (const ok of ['Have a lovely day!', 'I left something sweet on your desk', 'Scunthorpe is lovely', 'Can you guess who I am?', 'mabuhay!']) assert.ok(!isUnkind(ok), ok);
});

test('worker schema matches schema.sql', () => {
  assert.equal(SCHEMA.trim(), fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').trim());
});

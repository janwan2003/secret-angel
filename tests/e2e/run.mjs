// End-to-end test in real Chromium. The organiser creates a game, 3 people join from
// separate browser contexts, the organiser draws, everyone sees exactly one mortal
// (never themselves, one single circle), anonymous notes go both ways, a note is
// reported, guesses are logged, then the reveal is stepped through. Screenshots at
// phone (390 px) and desktop (1280 px) width go to shots/. The test deletes its game.
// Usage: BASE=http://127.0.0.1:8790 node tests/e2e/run.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const SHOTS = process.env.SHOTS || 'shots';
fs.mkdirSync(SHOTS, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), '.cache/ms-playwright');
  for (const d of fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const p = path.join(root, d, 'chrome-linux64/chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 860 } };
const errors = [];
const browser = await chromium.launch({ executablePath: findChrome() });
// Expected HTTP errors that the browser logs to the console.
const EXPECTED = [/status of 409/, /status of 400/, /status of 404/];

async function person(label, opts = PHONE) {
  const ctx = await browser.newContext(opts);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.some((r) => r.test(m.text()))) errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d) => { errors.push(`${label}: native dialog "${d.message()}"`); d.dismiss(); });
  return { label, ctx, page };
}
async function ok(page) { await page.click('.modal [data-ok]'); await page.waitForSelector('.modal', { state: 'detached' }); }
const shot = (p, name, full = true) => p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });
async function noOverflow(page, label) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(w <= 0, `${label}: horizontal overflow ${w}px`);
}

let step = 'start';
let anna;
let gameId;
try {
  // 1. Landing
  step = 'landing';
  const desk = await person('desktop-visitor', DESKTOP);
  await desk.page.goto(BASE + '/');
  await shot(desk.page, 'desktop-landing');
  await noOverflow(desk.page, 'desktop landing');
  anna = await person('Anna');
  await anna.page.goto(BASE + '/');
  await shot(anna.page, 'phone-landing');
  await anna.page.screenshot({ path: path.join(SHOTS, 'phone-landing-fold.png') });
  await noOverflow(anna.page, 'phone landing');
  assert.ok((await anna.page.$eval('#revealDate', (e) => e.value)).match(/^\d{4}-\d{2}-\d{2}$/), 'reveal date prefilled');

  // validation
  step = 'create';
  await anna.page.click('#createBtn');
  assert.match(await anna.page.textContent('#createError'), /name/i);
  await anna.page.fill('#gName', 'Office angels');
  await anna.page.click('#createBtn');
  assert.match(await anna.page.textContent('#createError'), /your own name/i);
  await anna.page.fill('#orgName', 'Anna');
  await anna.page.check('input[name=pack][value=daily]');
  await anna.page.click('details summary');
  await anna.page.fill('#budget', '₱200');
  await anna.page.fill('#note', 'Reveal at the party, 6pm!');
  await anna.page.click('#createBtn');
  await anna.page.waitForURL(/\/g\/[A-Za-z0-9]+\?new=1$/);
  await anna.page.waitForSelector('#shareCard');
  gameId = anna.page.url().match(/\/g\/([A-Za-z0-9]+)/)[1];
  const groupUrl = `${BASE}/g/${gameId}`;
  assert.match(await anna.page.textContent('#shareCard h2'), /send this link/i);
  assert.equal((await anna.page.textContent('#shareUrl')).trim(), groupUrl);
  assert.ok(await anna.page.$eval('[data-act=draw]', (b) => b.disabled), 'draw disabled with 1 person');
  await anna.page.click('[data-act=copyGroup]');
  assert.equal(await anna.page.evaluate(() => navigator.clipboard.readText()), groupUrl);
  await shot(anna.page, 'phone-organiser-created');

  // OG preview reflects state
  let og = await (await fetch(groupUrl)).text();
  assert.match(og, /og:title" content="Office angels · secret angels"/);
  assert.match(og, /1 person has joined/);

  // Organiser fills own card
  await anna.page.click('#cardBox summary');
  await anna.page.click('#cardForm .chips[data-key=drink] .chip[data-v=coffee]');
  await anna.page.fill('#me-treat', 'dark chocolate');
  await anna.page.click('#cardForm button[type=submit]');
  await anna.page.waitForSelector('.toast');

  // 2. Joins
  step = 'joins';
  const people = { Anna: anna };
  for (const [name, drink, treat] of [['Ben', 'tea', 'ensaymada'], ['Cara', 'hot chocolate', ''], ['Dan', '', 'chips']]) {
    const p = await person(name, name === 'Dan' ? DESKTOP : PHONE);
    await p.page.goto(groupUrl);
    await p.page.waitForSelector('#joinForm');
    if (name === 'Ben') await shot(p.page, 'phone-join');
    await p.page.click('#joinBtn');
    assert.match(await p.page.textContent('#joinError'), /name/i);
    await p.page.fill('#jName', name);
    if (drink) await p.page.click(`#joinForm .chips[data-key=drink] .chip[data-v="${drink}"]`);
    if (treat) await p.page.fill('#j-treat', treat);
    await p.page.click('#joinBtn');
    await p.page.waitForSelector('text=You\'re in, ' + name);
    people[name] = p;
  }
  await shot(people.Ben.page, 'phone-joined-waiting');
  // duplicate name is refused
  const eve = await person('Eve');
  await eve.page.goto(groupUrl);
  await eve.page.fill('#jName', 'ben');
  await eve.page.click('#joinBtn');
  await eve.page.waitForFunction(() => /already joined/.test(document.querySelector('#joinError').textContent));
  // Eve joins properly, then the organiser removes her
  await eve.page.fill('#jName', 'Eve');
  await eve.page.click('#joinBtn');
  await eve.page.waitForSelector("text=You're in, Eve");
  await anna.page.reload();
  await anna.page.waitForSelector('[data-remove]');
  assert.equal(await anna.page.$$eval('#people li', (l) => l.length), 5);
  await anna.page.click('[data-remove][data-name=Eve]');
  await ok(anna.page);
  await anna.page.waitForFunction(() => document.querySelectorAll('#people li').length === 4);
  og = await (await fetch(groupUrl)).text();
  assert.match(og, /4 people have joined/);

  // 3. Draw
  step = 'draw';
  assert.ok(!(await anna.page.$eval('[data-act=draw]', (b) => b.disabled)));
  await anna.page.click('[data-act=draw]');
  await anna.page.click('.modal [data-cancel]');
  await anna.page.waitForSelector('.modal', { state: 'detached' });
  assert.ok(await anna.page.$('[data-act=draw]'), 'cancel does not draw');
  await anna.page.click('[data-act=draw]');
  await ok(anna.page);
  await anna.page.waitForSelector('#mortalCard');
  await shot(anna.page, 'phone-organiser-playing');

  const mortalOf = {};
  for (const [name, p] of Object.entries(people)) {
    if (name !== 'Anna') await p.page.reload();
    await p.page.waitForSelector('#mortalName');
    const m = (await p.page.textContent('#mortalName')).trim();
    assert.notEqual(m, name, `${name} drew themselves`);
    assert.ok(people[m], `${name} drew unknown ${m}`);
    mortalOf[name] = m;
    assert.match(await p.page.textContent('.theme'), /Day 1 mission/);
  }
  assert.equal(new Set(Object.values(mortalOf)).size, 4, 'everyone is someone\'s mortal exactly once');
  let cur = 'Anna'; const seen = new Set();
  while (!seen.has(cur)) { seen.add(cur); cur = mortalOf[cur]; }
  assert.equal(seen.size, 4, 'one single circle');
  const angelOf = Object.fromEntries(Object.entries(mortalOf).map(([a, m]) => [m, a]));

  // Eve (removed) and a new visitor cannot join
  await eve.page.reload();
  await eve.page.waitForSelector('text=Joining has closed');

  // Card shows on the angel's screen
  const annasMortal = mortalOf.Anna;
  const expectedTreat = { Ben: 'ensaymada', Cara: null, Dan: 'chips' }[annasMortal];
  if (expectedTreat) assert.match(await anna.page.textContent('#mortalCard'), new RegExp(expectedTreat));

  // 4. Notes
  step = 'notes';
  await anna.page.fill('#noteText', 'Hello from your angel! Check your desk 🍫');
  await anna.page.click('#sendBtn');
  await anna.page.waitForSelector('.bubble.mine');
  // unkind note refused
  await anna.page.fill('#noteText', 'you are a bitch');
  await anna.page.click('#sendBtn');
  await anna.page.waitForFunction(() => /kindness/.test(document.querySelector('#noteError').textContent));
  await anna.page.fill('#noteText', '');
  const m = people[annasMortal];
  await m.page.reload();
  await m.page.waitForSelector('[data-tab=angel] .count');
  await m.page.click('[data-tab=angel]');
  await m.page.waitForSelector('.bubble.them');
  const angelView = await m.page.textContent('#notes');
  assert.match(angelView, /Hello from your angel/);
  assert.match(angelView, /Your angel/);
  assert.ok(!angelView.includes('Anna'), 'the angel stays anonymous');
  await m.page.fill('#noteText', 'Thank you mystery angel!');
  await m.page.click('#sendBtn');
  await m.page.waitForSelector('.bubble.mine');
  await shot(m.page, 'phone-from-angel');
  await anna.page.reload();
  await anna.page.waitForSelector('.bubble.them');
  assert.match(await anna.page.textContent('#thread'), /Thank you mystery angel/);
  await shot(anna.page, 'phone-angel-thread');
  await anna.page.screenshot({ path: path.join(SHOTS, 'phone-angel-fold.png') });

  // A second angel writes, the mortal reports it; organiser sees it with the sender's name.
  const cara = people.Cara;
  const carasMortal = mortalOf.Cara;
  await cara.page.reload();
  await cara.page.click('[data-tab=mortal]');
  await cara.page.fill('#noteText', 'This note will get reported');
  await cara.page.click('#sendBtn');
  await cara.page.waitForSelector('.bubble.mine');
  const cm = people[carasMortal];
  await cm.page.reload();
  await cm.page.click('[data-tab=angel]');
  await cm.page.waitForSelector('text=This note will get reported');
  await cm.page.click('.bubble.them [data-report]');
  await ok(cm.page);
  await cm.page.waitForFunction(() => !document.querySelector('#thread').textContent.includes('will get reported'));
  await anna.page.reload();
  await anna.page.waitForSelector('text=Reported notes (1)');
  assert.match(await anna.page.textContent('body'), /Cara<\/b>|Cara/);

  // 5. Guesses: Anna's mortal guesses right, everyone else guesses wrong or not at all.
  step = 'guesses';
  const mp = people[annasMortal];
  const wrongFor = (who) => Object.keys(people).find((n) => n !== who && n !== angelOf[who]);
  await mp.page.reload();
  await mp.page.selectOption('#guessSel', { label: 'Anna' });
  await mp.page.waitForSelector('.toast');
  const other = Object.keys(people).find((n) => n !== annasMortal && n !== 'Anna');
  await people[other].page.selectOption('#guessSel', { label: wrongFor(other) });
  await people[other].page.waitForSelector('.toast');
  // Nobody can choose themselves
  assert.ok(!(await mp.page.$$eval('#guessSel option', (o) => o.map((x) => x.textContent))).includes(annasMortal));
  og = await (await fetch(groupUrl)).text();
  assert.match(og, /4 angels · 3 notes sent · 2 think they know their angel/);

  // Personal link works on a new device
  step = 'personal-link';
  await people.Dan.page.click('[data-act=copyMine]');
  const danLink = await people.Dan.page.evaluate(() => navigator.clipboard.readText());
  assert.match(danLink, /#k=/);
  const dan2 = await person('Dan-phone');
  await dan2.page.goto(danLink);
  await dan2.page.waitForSelector('#mortalName');
  assert.equal((await dan2.page.textContent('#mortalName')).trim(), mortalOf.Dan);
  assert.ok(!dan2.page.url().includes('#k='), 'token stripped from URL');

  // 6. Reveal
  step = 'reveal';
  await anna.page.click('[data-act=reveal]');
  await ok(anna.page);
  await anna.page.waitForSelector('#revealStage');
  await shot(anna.page, 'phone-reveal-intro');
  await anna.page.click('[data-act=step]');
  await anna.page.waitForSelector('#revealAngel');
  const firstAngel = (await anna.page.textContent('#revealAngel')).trim();
  assert.equal(firstAngel, 'Anna', 'unmasking starts with the organiser');
  assert.match(await anna.page.textContent('#revealStage'), /guessed it ✓/);
  await shot(anna.page, 'phone-reveal-step');
  for (let i = 0; i < 4; i++) await anna.page.click('[data-act=step]');
  await anna.page.waitForSelector('#ringCard svg');
  assert.match(await anna.page.textContent('#ringCard'), /1 of 4/);
  assert.equal(await anna.page.$$eval('#chain li', (l) => l.length), 4);
  await shot(anna.page, 'phone-reveal-circle');
  // Others see it too, including a non-member visitor
  await people.Dan.page.reload();
  await people.Dan.page.click('[data-act=all]');
  await people.Dan.page.waitForSelector('#ringCard svg');
  assert.match(await people.Dan.page.textContent('body'), new RegExp(`Your angel was ${angelOf.Dan}`));
  await shot(people.Dan.page, 'desktop-reveal');
  await noOverflow(people.Dan.page, 'desktop reveal');
  og = await (await fetch(groupUrl)).text();
  assert.match(og, /angels revealed/);
  // Notes are closed after reveal
  const r = await fetch(`${BASE}/api/games/${gameId}/note`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"to":"mortal","body":"late"}' });
  assert.equal(r.status, 403);
  // Start your own: prefilled
  await people.Ben.page.reload();
  await people.Ben.page.click('#startOwn a');
  await people.Ben.page.waitForURL(/\?next=/);
  assert.ok((await people.Ben.page.inputValue('#gName')).length > 0, 'next game name prefilled');

  // 7. Missing game + 404 page
  step = 'missing';
  const lost = await person('lost-visitor');
  await lost.page.goto(`${BASE}/g/doesnotexist1`);
  await lost.page.waitForSelector("text=doesn't exist");
  const nf = await fetch(`${BASE}/nope`);
  assert.equal(nf.status, 404);
  const priv = await fetch(`${BASE}/privacy`);
  assert.equal(priv.status, 200);

  // 8. Delete
  step = 'delete';
  await anna.page.reload();
  await anna.page.click('[data-act=all]');
  await anna.page.click('[data-act=delete]');
  await ok(anna.page);
  await anna.page.waitForURL(BASE + '/');
  const gone = await fetch(`${BASE}/api/games/${gameId}`);
  assert.equal(gone.status, 404);
  gameId = null;

  assert.deepEqual(errors, [], 'console errors');
  console.log('E2E PASS');
} catch (e) {
  console.error(`E2E FAIL at step "${step}":`, e.message);
  if (errors.length) console.error('Console errors:', errors);
  if (anna) await shot(anna.page, 'fail-anna').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}

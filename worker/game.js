// Pure game logic shared by the API and the unit tests: the ring draw, the theme
// packs and the kindness filter. No I/O here.

function randInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One single ring through everybody: A looks after B, B after C, ... last after A.
// A single cycle (not just any derangement) means the reveal can walk the whole
// group link by link and the ring diagram is one circle.
// Returns a Map angelId -> mortalId, or null when fewer than 3 people.
export function drawRing(ids) {
  if (!Array.isArray(ids) || ids.length < 3) return null;
  const order = shuffle(ids);
  const map = new Map();
  for (let i = 0; i < order.length; i++) map.set(order[i], order[(i + 1) % order.length]);
  return map;
}

// Walk the ring from a starting member. Returns ids in ring order.
export function ringOrder(mortalOf, start) {
  const out = [];
  let cur = start;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = mortalOf[cur];
  }
  return out;
}

export const PACKS = {
  daily: {
    label: 'Daily kindness missions',
    every: 1,
    items: [
      ['Say hello', 'Send your mortal a first anonymous note. Keep it warm and a little mysterious.'],
      ['Compliment', 'Tell them one thing they do that makes the group better.'],
      ['Detective work', 'Find out their favourite song without asking them directly.'],
      ['Little treat', 'Leave a small treat where they will find it today.'],
      ['Good morning', 'Send a note they will read first thing tomorrow.'],
      ['Throwback', 'Remind them of a moment this year they should be proud of.'],
      ['Riddle', 'Send a riddle whose answer is a hint about who you are (or a decoy).'],
      ['Desk drop', 'Leave a handwritten note (disguise your writing).'],
      ['Recommend', 'Recommend a film, book or song you think they would love.'],
      ['Ask', 'Ask them a question about their perfect weekend.'],
      ['Help out', 'Do one small useful thing for them without being seen.'],
      ['Cheer', 'Send an encouraging note for whatever they have on this week.'],
      ['Decoy', 'Drop a false clue that points at someone else.'],
      ['Snack', 'Their favourite snack, delivered anonymously.'],
      ['Poem', 'Write them a four-line poem. Bad poems count.'],
      ['Doodle', 'Leave a little drawing somewhere they will spot it.'],
      ['Thank you', 'Thank them for something specific they did.'],
      ['Wish', 'Tell them one thing you hope next year brings them.'],
      ['Colour', 'Give them something in their favourite colour.'],
      ['Joke', 'Send your best clean joke.'],
      ['Playlist', 'Send three songs that remind you of them.'],
      ['Shout-out', 'Say something nice about them to someone else in the group.'],
      ['Warm drink', 'Make sure they get their favourite drink today.'],
      ['Final hint', 'Send one honest hint about who you are.'],
    ],
  },
  weekly: {
    label: 'Weekly themed gifts',
    every: 7,
    items: [
      ['Something sweet', 'A small sweet treat for your mortal this week.'],
      ['Something soft', 'Socks, a scarf, a cushion cover: anything soft.'],
      ['Something you make', 'A drawing, baking, a craft, a letter. Handmade counts double.'],
      ['Something in their colour', 'Check their card for their favourite colour.'],
      ['Something that smells nice', 'A candle, soap, tea, coffee beans.'],
      ['Something useful', 'Something they will use every day.'],
      ['The big reveal gift', 'Bring your final gift to the reveal.'],
    ],
  },
  none: { label: 'No themes, just notes', every: 0, items: [] },
};

export function packOrDefault(p) {
  return Object.prototype.hasOwnProperty.call(PACKS, p) ? p : 'daily';
}

const DAY = 86400;
export function dayIndex(drawnAt, nowSec) {
  return Math.max(0, Math.floor(nowSec / DAY) - Math.floor(drawnAt / DAY));
}

// The theme in force today (or null), plus the schedule of upcoming ones.
export function themeFor(pack, drawnAt, nowSec) {
  const p = PACKS[packOrDefault(pack)];
  if (!p.every || !drawnAt) return null;
  const d = dayIndex(drawnAt, nowSec);
  const i = Math.floor(d / p.every);
  const n = Math.min(i, p.items.length - 1);
  const [title, text] = p.items[n];
  return { n: n + 1, of: p.items.length, every: p.every, title, text };
}

// A deliberately small filter: the game is about kindness, so obvious slurs and
// abuse are rejected outright. Everything else relies on reporting.
const BAD = [
  'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'slut', 'whore', 'retard', 'faggot', 'fag',
  'nigger', 'nigga', 'kys', 'kill yourself', 'dickhead', 'wanker', 'twat', 'pussy',
  'putang ina', 'putangina', 'gago', 'tanga', 'bobo', 'ulol', 'tangina',
];
export function isUnkind(text) {
  const t = ' ' + String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  return BAD.some((w) => t.includes(' ' + w + ' ') || (w.length > 4 && t.includes(w)));
}

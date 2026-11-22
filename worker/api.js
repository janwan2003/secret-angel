// All game data lives in the AngelDB Durable Object (index.js); env.DB is its D1-style shim.
import { drawRing, ringOrder, themeFor, packOrDefault, PACKS, isUnkind } from './game.js';

const MAX_MEMBERS = 80;
const MAX_NOTES_PER_DAY = 40;
const LIMITS = {
  create: [20, 3600],  // new games per IP per hour
  join: [80, 3600],    // joins per IP per hour
  note: [150, 3600],   // notes per IP per hour
  write: [400, 3600],  // other writes per IP per hour
  read: [3000, 3600],  // state reads per IP per hour (pages poll)
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const err = (status, message) => json({ error: message }, status);
const now = () => Math.floor(Date.now() / 1000);

function randomId(len = 10) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clean(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
const cleanName = (v) => clean(v, 30).replace(/\s+/g, ' ');
const validDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + 'T12:00:00Z')) ? d : '');

const CHOICES = {
  drink: ['coffee', 'tea', 'hot chocolate', 'juice', 'water'],
  taste: ['sweet', 'savoury', 'fruity', 'spicy'],
  colour: ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'black', 'white', 'gold'],
};
function cleanLikes(v) {
  const o = v && typeof v === 'object' ? v : {};
  const out = {};
  for (const k of Object.keys(CHOICES)) if (CHOICES[k].includes(o[k])) out[k] = o[k];
  for (const [k, max] of [['treat', 60], ['hobby', 60], ['avoid', 80]]) {
    const s = clean(o[k], max).replace(/\s+/g, ' ');
    if (s) out[k] = s;
  }
  return out;
}

async function rateLimited(env, request, action) {
  const [max, windowSec] = LIMITS[action];
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO rate (k, n, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(k) DO UPDATE SET
       n = CASE WHEN reset_at < ?3 THEN 1 ELSE n + 1 END,
       reset_at = CASE WHEN reset_at < ?3 THEN ?2 ELSE reset_at END
     RETURNING n`
  ).bind(action + ':' + ip, t + windowSec, t).first();
  return row && row.n > max;
}

// Data is kept only as long as the game needs it: 14 days after the reveal,
// or 120 days after creation for games that never finish.
async function cleanup(env) {
  const t = now();
  const where = '(revealed_at IS NOT NULL AND revealed_at < ?1) OR created_at < ?2';
  const a = t - 14 * 86400;
  const b = t - 120 * 86400;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM notes WHERE game_id IN (SELECT id FROM games WHERE ${where})`).bind(a, b),
    env.DB.prepare(`DELETE FROM members WHERE game_id IN (SELECT id FROM games WHERE ${where})`).bind(a, b),
    env.DB.prepare(`DELETE FROM games WHERE ${where}`).bind(a, b),
    env.DB.prepare('DELETE FROM rate WHERE reset_at < ?1').bind(t),
  ]);
}

async function readBody(request) {
  try {
    const text = await request.text();
    if (text.length > 10000) return null;
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

const loadGame = (env, id) => env.DB.prepare('SELECT * FROM games WHERE id = ?1').bind(id).first();

async function loadMe(env, request, gameId) {
  const token = request.headers.get('x-member-token');
  if (!token || token.length < 20 || token.length > 100) return null;
  return env.DB.prepare('SELECT * FROM members WHERE token_hash = ?1 AND game_id = ?2')
    .bind(await sha256(token), gameId).first();
}

async function newMember(env, gameId, name, likes, organizer = false) {
  const token = randomId(32);
  const id = randomId(12);
  await env.DB.prepare(
    'INSERT INTO members (id, game_id, name, token_hash, is_organizer, likes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
  ).bind(id, gameId, name, await sha256(token), organizer ? 1 : 0, JSON.stringify(likes || {}), now()).run();
  return { id, token };
}

function gameDetails(body, prev = {}) {
  const out = {
    name: body.name !== undefined ? clean(body.name, 60).replace(/\s+/g, ' ') : prev.name,
    reveal_date: body.revealDate !== undefined ? validDate(clean(body.revealDate, 10)) : prev.reveal_date || '',
    pack: body.pack !== undefined ? packOrDefault(body.pack) : prev.pack || 'daily',
    budget: body.budget !== undefined ? clean(body.budget, 30) : prev.budget || '',
    note: body.note !== undefined ? clean(body.note, 400) : prev.note || '',
  };
  return out;
}

async function nameTaken(env, gameId, name, exceptId = '') {
  return !!(await env.DB.prepare('SELECT id FROM members WHERE game_id = ?1 AND lower(name) = lower(?2) AND id != ?3')
    .bind(gameId, name, exceptId).first());
}

const parseLikes = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const noteOut = (n, mine) => ({ id: n.id, mine, body: n.body, at: n.created_at });

async function stateFor(env, g, me) {
  const t = now();
  const { results: members } = await env.DB.prepare(
    'SELECT id, name, is_organizer, mortal_id, guess_id, likes FROM members WHERE game_id = ?1 ORDER BY created_at, rowid'
  ).bind(g.id).all();
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const dayStart = Math.floor(t / 86400) * 86400;
  const c = await env.DB.prepare(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ?2 THEN 1 ELSE 0 END) AS today FROM notes WHERE game_id = ?1'
  ).bind(g.id, dayStart).first();
  const out = {
    id: g.id,
    name: g.name,
    revealDate: g.reveal_date,
    pack: g.pack,
    packLabel: PACKS[packOrDefault(g.pack)].label,
    budget: g.budget,
    note: g.note,
    status: g.status,
    drawnAt: g.drawn_at || null,
    members: members.map((m) => ({ id: m.id, name: m.name, organizer: !!m.is_organizer })),
    counts: {
      notes: (c && c.total) || 0,
      notesToday: (c && c.today) || 0,
      guessed: members.filter((m) => m.guess_id).length,
    },
    theme: g.status === 'playing' ? themeFor(g.pack, g.drawn_at, t) : null,
    me: null,
  };
  if (me) {
    out.me = { id: me.id, name: me.name, organizer: !!me.is_organizer, likes: parseLikes(me.likes), guess: me.guess_id || null };
    if (g.status !== 'open' && me.mortal_id && byId[me.mortal_id]) {
      const m = byId[me.mortal_id];
      out.mortal = { id: m.id, name: m.name, likes: parseLikes(m.likes) };
      const { results: notes } = await env.DB.prepare(
        'SELECT * FROM notes WHERE game_id = ?1 AND (angel_id = ?2 OR mortal_id = ?2) ORDER BY id LIMIT 600'
      ).bind(g.id, me.id).all();
      // Thread with my mortal (I am the anonymous one) and with my angel (they are).
      out.toMortal = notes.filter((n) => n.angel_id === me.id && !(n.reported && !n.from_angel)).map((n) => noteOut(n, !!n.from_angel));
      out.fromAngel = notes.filter((n) => n.mortal_id === me.id && !(n.reported && n.from_angel)).map((n) => noteOut(n, !n.from_angel));
    }
    if (me.is_organizer) {
      const { results: rep } = await env.DB.prepare('SELECT * FROM notes WHERE game_id = ?1 AND reported = 1 ORDER BY id DESC LIMIT 50').bind(g.id).all();
      out.reports = rep.map((n) => {
        const from = n.from_angel ? n.angel_id : n.mortal_id;
        const to = n.from_angel ? n.mortal_id : n.angel_id;
        return { id: n.id, body: n.body, at: n.created_at, from: byId[from]?.name || '?', to: byId[to]?.name || '?' };
      });
    }
  }
  if (g.status === 'revealed') {
    const mortalOf = Object.fromEntries(members.filter((m) => m.mortal_id).map((m) => [m.id, m.mortal_id]));
    const start = (members.find((m) => m.is_organizer && m.mortal_id) || members.find((m) => m.mortal_id) || {}).id;
    const order = start ? ringOrder(mortalOf, start) : [];
    const { results: sent } = await env.DB.prepare(
      'SELECT angel_id, COUNT(*) AS n FROM notes WHERE game_id = ?1 AND from_angel = 1 GROUP BY angel_id'
    ).bind(g.id).all();
    const sentBy = Object.fromEntries(sent.map((r) => [r.angel_id, r.n]));
    out.ring = order.map((id) => {
      const a = byId[id];
      const mortal = byId[a.mortal_id];
      return {
        angel: a.name,
        mortal: mortal ? mortal.name : '?',
        guess: mortal && mortal.guess_id ? byId[mortal.guess_id]?.name || null : null,
        correct: !!(mortal && mortal.guess_id === id),
        notes: sentBy[id] || 0,
      };
    });
  }
  return out;
}

function route(method, parts) {
  // parts: ['games'] | ['games', id] | ['games', id, action]
  if (parts[0] !== 'games') return null;
  if (parts.length === 1 && method === 'POST') return { action: 'create' };
  if (parts.length === 2 && method === 'GET') return { action: 'get', id: parts[1] };
  if (parts.length === 2 && method === 'DELETE') return { action: 'delete', id: parts[1] };
  if (parts.length === 3 && method === 'POST') return { action: parts[2], id: parts[1] };
  return null;
}

export async function handle(request, env) {
  try {
    const parts = new URL(request.url).pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
    const r = route(request.method, parts);
    if (!r) return err(404, 'Not found');
    if (r.id && !/^[A-Za-z0-9]{6,16}$/.test(r.id)) return err(404, 'Game not found');

    if (r.action === 'create') {
      if (await rateLimited(env, request, 'create')) return err(429, 'Too many new games from here. Try again in an hour.');
      const body = await readBody(request);
      if (!body) return err(400, 'Bad request');
      const d = gameDetails(body);
      const orgName = cleanName(body.orgName);
      if (!d.name) return err(400, 'Give your game a name.');
      if (!orgName) return err(400, 'Add your own name.');
      if (!d.reveal_date) return err(400, 'Pick a reveal day.');
      const id = randomId(10);
      await env.DB.prepare(
        'INSERT INTO games (id, name, reveal_date, pack, budget, note, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, \'open\', ?7)'
      ).bind(id, d.name, d.reveal_date, d.pack, d.budget, d.note, now()).run();
      const m = await newMember(env, id, orgName, cleanLikes(body.likes), true);
      if (Math.random() < 0.2) await cleanup(env);
      return json({ id, token: m.token });
    }

    const g = await loadGame(env, r.id);
    if (!g) return err(404, 'Game not found. It may have ended and been deleted.');

    if (r.action === 'get') {
      if (await rateLimited(env, request, 'read')) return err(429, 'Slow down a little.');
      const me = await loadMe(env, request, g.id);
      return json(await stateFor(env, g, me));
    }

    if (r.action === 'join') {
      if (await rateLimited(env, request, 'join')) return err(429, 'Too many joins from here. Try again later.');
      if (g.status !== 'open') return err(409, 'Joining has closed: the names are already drawn. Ask the organiser to start a new game.');
      const body = await readBody(request);
      if (!body) return err(400, 'Bad request');
      const name = cleanName(body.name);
      if (!name) return err(400, 'Type your name.');
      if (isUnkind(name)) return err(400, 'Pick a friendlier name.');
      const c = await env.DB.prepare('SELECT COUNT(*) AS c FROM members WHERE game_id = ?1').bind(g.id).first();
      if (c.c >= MAX_MEMBERS) return err(409, `This game is full (${MAX_MEMBERS} people).`);
      if (await nameTaken(env, g.id, name)) return err(409, `Someone called ${name} has already joined. Add an initial, like "${name} B".`);
      const m = await newMember(env, g.id, name, cleanLikes(body.likes));
      return json({ token: m.token, id: m.id });
    }

    // Everything below needs a member token.
    if (await rateLimited(env, request, r.action === 'note' ? 'note' : 'write')) return err(429, 'Slow down a little and try again soon.');
    const me = await loadMe(env, request, g.id);
    if (!me) return err(403, 'Open your personal link to do that.');
    const body = request.method === 'DELETE' ? {} : await readBody(request);
    if (!body) return err(400, 'Bad request');
    const organizerOnly = ['draw', 'reveal', 'settings', 'remove', 'delete'];
    if (organizerOnly.includes(r.action) && !me.is_organizer) return err(403, 'Only the organiser can do that.');

    switch (r.action) {
      case 'me': {
        const name = body.name !== undefined ? cleanName(body.name) : me.name;
        if (!name) return err(400, 'Type your name.');
        if (name !== me.name) {
          if (g.status !== 'open') return err(409, 'Names are fixed once the draw has happened.');
          if (isUnkind(name)) return err(400, 'Pick a friendlier name.');
          if (await nameTaken(env, g.id, name, me.id)) return err(409, `Someone called ${name} is already in.`);
        }
        const likes = body.likes !== undefined ? cleanLikes(body.likes) : parseLikes(me.likes);
        await env.DB.prepare('UPDATE members SET name = ?1, likes = ?2 WHERE id = ?3').bind(name, JSON.stringify(likes), me.id).run();
        break;
      }
      case 'settings': {
        const d = gameDetails(body, g);
        if (!d.name) return err(400, 'Give your game a name.');
        if (!d.reveal_date) return err(400, 'Pick a reveal day.');
        await env.DB.prepare('UPDATE games SET name = ?1, reveal_date = ?2, pack = ?3, budget = ?4, note = ?5 WHERE id = ?6')
          .bind(d.name, d.reveal_date, d.pack, d.budget, d.note, g.id).run();
        break;
      }
      case 'remove': {
        if (g.status !== 'open') return err(409, 'People cannot be removed after the draw: it would break the ring.');
        const id = clean(body.memberId, 20);
        if (id === me.id) return err(400, 'You cannot remove yourself.');
        await env.DB.prepare('DELETE FROM members WHERE id = ?1 AND game_id = ?2 AND is_organizer = 0').bind(id, g.id).run();
        break;
      }
      case 'draw': {
        if (g.status !== 'open') return err(409, 'The names are already drawn.');
        const { results } = await env.DB.prepare('SELECT id FROM members WHERE game_id = ?1').bind(g.id).all();
        const ring = drawRing(results.map((x) => x.id));
        if (!ring) return err(409, 'You need at least 3 people to draw.');
        const t = now();
        const upd = await env.DB.prepare("UPDATE games SET status = 'playing', drawn_at = ?1 WHERE id = ?2 AND status = 'open'").bind(t, g.id).run();
        if (!upd.meta || !upd.meta.changes) return err(409, 'The names are already drawn.');
        await env.DB.batch([...ring].map(([a, m]) => env.DB.prepare('UPDATE members SET mortal_id = ?1 WHERE id = ?2').bind(m, a)));
        break;
      }
      case 'note': {
        if (g.status !== 'playing') return err(409, g.status === 'open' ? 'Notes open after the draw.' : 'The game is over: notes are closed.');
        const text = clean(body.body, 500);
        if (!text) return err(400, 'Write something first.');
        if (isUnkind(text)) return err(400, 'This game is about kindness. Please rephrase that.');
        const toMortal = body.to === 'mortal';
        let angelId, mortalId;
        if (toMortal) {
          if (!me.mortal_id) return err(409, 'You have no mortal yet.');
          angelId = me.id; mortalId = me.mortal_id;
        } else {
          const angel = await env.DB.prepare('SELECT id FROM members WHERE game_id = ?1 AND mortal_id = ?2').bind(g.id, me.id).first();
          if (!angel) return err(409, 'You have no angel yet.');
          angelId = angel.id; mortalId = me.id;
        }
        const dayStart = Math.floor(now() / 86400) * 86400;
        const mine = await env.DB.prepare(
          'SELECT COUNT(*) AS c FROM notes WHERE game_id = ?1 AND created_at >= ?2 AND ((angel_id = ?3 AND from_angel = 1) OR (mortal_id = ?3 AND from_angel = 0))'
        ).bind(g.id, dayStart, me.id).first();
        if (mine.c >= MAX_NOTES_PER_DAY) return err(429, `That's ${MAX_NOTES_PER_DAY} notes today. Save some for tomorrow!`);
        await env.DB.prepare('INSERT INTO notes (game_id, angel_id, mortal_id, from_angel, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
          .bind(g.id, angelId, mortalId, toMortal ? 1 : 0, text, now()).run();
        break;
      }
      case 'report': {
        const id = Number(body.noteId) || 0;
        // You can only report a note that was sent to you.
        const n = await env.DB.prepare('SELECT * FROM notes WHERE id = ?1 AND game_id = ?2').bind(id, g.id).first();
        const toMe = n && ((n.from_angel && n.mortal_id === me.id) || (!n.from_angel && n.angel_id === me.id));
        if (!toMe) return err(404, 'Note not found.');
        await env.DB.prepare('UPDATE notes SET reported = 1 WHERE id = ?1').bind(id).run();
        break;
      }
      case 'guess': {
        if (g.status !== 'playing') return err(409, 'Guessing is open while the game is running.');
        const id = body.memberId ? clean(body.memberId, 20) : null;
        if (id) {
          if (id === me.id) return err(400, 'You cannot be your own angel.');
          const ok = await env.DB.prepare('SELECT id FROM members WHERE id = ?1 AND game_id = ?2').bind(id, g.id).first();
          if (!ok) return err(404, 'That person is not in this game.');
        }
        await env.DB.prepare('UPDATE members SET guess_id = ?1 WHERE id = ?2').bind(id, me.id).run();
        break;
      }
      case 'reveal': {
        if (g.status !== 'playing') return err(409, g.status === 'open' ? 'Draw the names first.' : 'Already revealed.');
        await env.DB.prepare("UPDATE games SET status = 'revealed', revealed_at = ?1 WHERE id = ?2").bind(now(), g.id).run();
        break;
      }
      case 'delete': {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM notes WHERE game_id = ?1').bind(g.id),
          env.DB.prepare('DELETE FROM members WHERE game_id = ?1').bind(g.id),
          env.DB.prepare('DELETE FROM games WHERE id = ?1').bind(g.id),
        ]);
        return json({ deleted: true });
      }
      default:
        return err(404, 'Not found');
    }
    const fresh = await loadGame(env, g.id);
    const meFresh = await env.DB.prepare('SELECT * FROM members WHERE id = ?1').bind(me.id).first();
    return json(await stateFor(env, fresh, meFresh));
  } catch (e) {
    console.error(e);
    return err(500, 'Something went wrong. Please try again.');
  }
}

// Live numbers for the link preview of /g/<id>.
export async function preview(env, id) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(id)) return null;
  const g = await env.DB.prepare('SELECT name, reveal_date, status FROM games WHERE id = ?1').bind(id).first();
  if (!g) return null;
  const m = await env.DB.prepare('SELECT COUNT(*) AS c, SUM(CASE WHEN guess_id IS NOT NULL THEN 1 ELSE 0 END) AS gs FROM members WHERE game_id = ?1').bind(id).first();
  const n = await env.DB.prepare('SELECT COUNT(*) AS c FROM notes WHERE game_id = ?1').bind(id).first();
  return { name: g.name, revealDate: g.reveal_date, status: g.status, people: (m && m.c) || 0, guessed: (m && m.gs) || 0, notes: (n && n.c) || 0 };
}

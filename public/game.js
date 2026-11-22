import { $, esc, api, tokens, toast, confirmBox, copyText, fmtDate, daysUntil, cardHtml, bindCard, readCard, likesList } from './common.js';

const app = $('#app');
const id = (location.pathname.match(/^\/g\/([A-Za-z0-9]{6,16})/) || [])[1];

// A personal link carries the token in the fragment (#k=...), which never reaches the server logs.
const hash = new URLSearchParams(location.hash.slice(1));
if (id && hash.get('k')) {
  tokens.set(id, hash.get('k'));
  history.replaceState(null, '', location.pathname + location.search);
}
let token = id ? tokens.get(id) : null;
let state = null;
let lastJson = '';
let tab = 'mortal';
const drafts = { mortal: '', angel: '' };
let revealStep = -1; // -1 = intro card, n = links shown, Infinity = full circle
let showSettings = false;
let formDirty = false; // unsaved edits in the card or settings form
const isNew = new URLSearchParams(location.search).get('new') === '1';

const groupUrl = () => `${location.origin}/g/${id}`;
const personalUrl = () => `${groupUrl()}#k=${token}`;
const initial = (n) => esc((n || '?').trim().charAt(0).toUpperCase());
const timeAgo = (t) => {
  const s = Math.floor(Date.now() / 1000) - t;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
function revealText(d) {
  const n = daysUntil(d);
  if (n === null) return '';
  if (n > 1) return `Reveal in ${n} days · ${fmtDate(d)}`;
  if (n === 1) return `Reveal tomorrow · ${fmtDate(d)}`;
  if (n === 0) return 'Reveal day is today';
  return `Reveal day was ${fmtDate(d)}`;
}

async function load(quiet = false) {
  if (!id) return renderMissing();
  try {
    const s = await api('games/' + id, { token });
    const j = JSON.stringify(s);
    if (j === lastJson && quiet) return;
    lastJson = j;
    state = s;
    if (token && !s.me) { tokens.del(id); token = null; }
    render();
  } catch (e) {
    if (e.status === 404) return renderMissing();
    if (!quiet) app.innerHTML = `<div class="card"><h2>Could not load the game</h2><p class="muted">${esc(e.message)}</p><button class="btn" id="retry">Try again</button></div>`;
    $('#retry')?.addEventListener('click', () => load());
  }
}

function renderMissing() {
  document.title = 'Game not found · Featherpost';
  app.innerHTML = `<div class="card center"><h2>This game doesn't exist (any more)</h2>
    <p class="muted">Games are deleted 14 days after their reveal, or the organiser deleted it.</p>
    <a class="btn" href="/">Start a new game</a></div>`;
}

function header() {
  const s = state;
  const org = s.members.find((m) => m.organizer);
  const bits = [`Organised by ${esc(org ? org.name : '?')}`, esc(s.packLabel)];
  if (s.budget) bits.push(`Budget ${esc(s.budget)}`);
  return `<div class="gamehead"><h1>${esc(s.name)}</h1>
    <p class="muted small" style="margin:0">${bits.join(' · ')}</p>
    <p class="small" style="margin:4px 0 0;font-weight:650;color:#8a5a00">${esc(revealText(s.revealDate))}</p>
    ${s.note ? `<div class="card gold" style="margin:12px 0 0;padding:12px 14px"><p class="small" style="margin:0;white-space:pre-wrap">${esc(s.note)}</p></div>` : ''}</div>`;
}

function shareCard(big) {
  const msg = `Join our secret angel game "${state.name}": ${groupUrl()}`;
  return `<section class="card ${big ? 'tint' : ''}" id="shareCard">
    <h2>${big ? 'Send this link to your group' : 'Invite more people'}</h2>
    <p class="muted small">Anyone with the link can join until you draw.</p>
    <div class="sharebox" id="shareUrl">${esc(groupUrl())}</div>
    <div class="btns">
      <button class="btn" data-act="copyGroup">Copy link</button>
      <a class="btn light" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>
      ${navigator.share ? '<button class="btn light" data-act="shareGroup">Share...</button>' : ''}
    </div></section>`;
}

function peopleList(canRemove) {
  return `<ul class="people" id="people">${state.members.map((m) => `<li class="${state.me && m.id === state.me.id ? 'me' : ''}">${esc(m.name)}${m.organizer ? ' <span class="tag">organiser</span>' : ''}${canRemove && !m.organizer ? `<button class="x" data-remove="${m.id}" data-name="${esc(m.name)}" aria-label="Remove ${esc(m.name)}">×</button>` : ''}</li>`).join('')}</ul>`;
}

function myLinkCard() {
  return `<section class="card"><h3>Your personal link</h3>
    <p class="muted small">Your place is saved on this device. Keep this link to open your game on another phone. Don't share it: it shows who you look after.</p>
    <button class="btn light small" data-act="copyMine">Copy my secret link</button></section>`;
}

function cardEditor(title, sub, open) {
  return `<details class="card" id="cardBox" ${open ? 'open' : ''}><summary style="cursor:pointer"><b>${esc(title)}</b> <span class="muted small">${esc(sub)}</span></summary>
    <form id="cardForm">${cardHtml('me', state.me.likes)}<p class="err" id="cardError"></p><button class="btn" type="submit">Save my card</button></form></details>`;
}

function settingsCard() {
  const s = state;
  return `<details class="card" id="settingsBox" ${showSettings ? 'open' : ''}><summary style="cursor:pointer"><b>Game settings</b></summary>
    <form id="settingsForm">
      <label for="sName">Game name</label><input type="text" id="sName" maxlength="60" value="${esc(s.name)}">
      <label for="sDate">Reveal day</label><input type="date" id="sDate" value="${esc(s.revealDate)}">
      <label for="sPack">Missions</label><select id="sPack">
        <option value="daily" ${s.pack === 'daily' ? 'selected' : ''}>Daily kindness missions</option>
        <option value="weekly" ${s.pack === 'weekly' ? 'selected' : ''}>Weekly themed gifts</option>
        <option value="none" ${s.pack === 'none' ? 'selected' : ''}>Just notes</option></select>
      <label for="sBudget">Budget <span class="opt">(optional)</span></label><input type="text" id="sBudget" maxlength="30" value="${esc(s.budget)}">
      <label for="sNote">Message to the group <span class="opt">(optional)</span></label><textarea id="sNote" maxlength="400">${esc(s.note)}</textarea>
      <p class="err" id="settingsError"></p>
      <div class="btns"><button class="btn" type="submit">Save</button><button class="btn danger" type="button" data-act="delete">Delete game</button></div>
    </form></details>`;
}

function render() {
  formDirty = false;
  const s = state;
  document.title = `${s.name} · Featherpost`;
  $('#topRight').textContent = s.me ? `You: ${s.me.name}` : '';
  if (s.status === 'revealed') return renderReveal();
  if (!s.me) return s.status === 'open' ? renderJoin() : renderClosed();
  if (s.status === 'open') return renderLobby();
  return renderPlaying();
}

function renderJoin() {
  const s = state;
  app.innerHTML = `${header()}
    <section class="card tint"><h2>You're invited</h2>
    <p class="small" style="margin:0">Everyone secretly looks after one other person until reveal day: anonymous notes, little missions, and guessing who your own angel is.</p></section>
    <form class="card" id="joinForm" novalidate><h2>Join the game</h2>
      <label for="jName">Your name</label>
      <input type="text" id="jName" maxlength="30" placeholder="How the group knows you" autocomplete="given-name">
      <p class="hint">Your favourite things help your angel spoil you. All optional.</p>
      ${cardHtml('j', {})}
      <p class="err" id="joinError" role="alert"></p>
      <button class="btn block" id="joinBtn" type="submit">Join</button>
      <p class="hint center">No sign-up. Your place is saved on this phone.</p>
    </form>
    <section class="card"><h3>${s.members.length} ${s.members.length === 1 ? 'person has' : 'people have'} joined</h3>${peopleList(false)}</section>`;
  bindCard($('#joinForm'));
  $('#joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#jName').value.trim();
    const errEl = $('#joinError');
    if (!name) { errEl.textContent = 'Type your name.'; $('#jName').focus(); return; }
    const btn = $('#joinBtn'); btn.disabled = true; btn.textContent = 'Joining...';
    try {
      const r = await api(`games/${id}/join`, { method: 'POST', body: { name, likes: readCard($('#joinForm')) } });
      tokens.set(id, r.token); token = r.token;
      await load();
      toast("You're in!");
    } catch (ex) {
      errEl.textContent = ex.message; btn.disabled = false; btn.textContent = 'Join';
      if (ex.status === 409 && /closed/i.test(ex.message)) load();
    }
  });
}

function renderClosed() {
  app.innerHTML = `${header()}<section class="card"><h2>Joining has closed</h2>
    <p class="muted">The names were drawn on ${new Date(state.drawnAt * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}. ${state.members.length} angels are playing.</p>
    <p class="muted small">Already playing? Open your personal link (the organiser can't see it, but you can copy it from the phone where you joined).</p>
    <a class="btn" href="/">Start your own game</a></section>`;
}

function renderLobby() {
  const s = state;
  const me = s.me;
  const n = s.members.length;
  const emptyCard = !Object.keys(me.likes || {}).length;
  let main;
  if (me.organizer) {
    main = `${shareCard(isNew || n < 3)}
      <section class="card"><h2>${n} joined</h2>${peopleList(true)}
      <p class="muted small" style="margin-top:12px">${n < 3 ? `You need at least 3 people. ${3 - n} more to go.` : 'When everyone is in, close joining and draw. Each person gets one secret mortal, all in one circle.'}</p>
      <button class="btn block gold" data-act="draw" ${n < 3 ? 'disabled' : ''}>Close joining and draw</button></section>
      ${cardEditor('Your favourites card', emptyCard ? '· fill it in for your angel' : '· tap to edit', emptyCard && !isNew)}
      ${settingsCard()}`;
  } else {
    main = `<section class="card tint"><h2>You're in, ${esc(me.name)}!</h2>
      <p class="small" style="margin:0">The draw happens when ${esc((s.members.find((m) => m.organizer) || {}).name || 'the organiser')} closes joining. Come back to this link (it's saved on this phone) to see who you look after.</p></section>
      ${cardEditor('Your favourites card', emptyCard ? '· add a few for your angel' : '· tap to edit', emptyCard)}
      <section class="card"><h3>${n} joined so far</h3>${peopleList(false)}</section>
      ${shareCard(false)}`;
  }
  app.innerHTML = header() + main + myLinkCard();
  bindLobby();
}

function bindLobby() {
  const cf = $('#cardForm');
  if (cf) {
    bindCard(cf);
    cf.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { state = await api(`games/${id}/me`, { method: 'POST', token, body: { likes: readCard(cf) } }); lastJson = JSON.stringify(state); toast('Card saved'); render(); }
      catch (ex) { $('#cardError').textContent = ex.message; }
    });
  }
  const sf = $('#settingsForm');
  if (sf) {
    $('#settingsBox').addEventListener('toggle', (e) => { showSettings = e.target.open; });
    sf.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        state = await api(`games/${id}/settings`, { method: 'POST', token, body: { name: $('#sName').value, revealDate: $('#sDate').value, pack: $('#sPack').value, budget: $('#sBudget').value, note: $('#sNote').value } });
        lastJson = JSON.stringify(state); showSettings = false; toast('Saved'); render();
      } catch (ex) { $('#settingsError').textContent = ex.message; }
    });
  }
}

function thread(list, them) {
  if (!list.length) return `<div class="empty">${them === 'mortal' ? `No notes yet. Say hi to ${esc(state.mortal.name)}: they won't know it's you.` : 'Your angel has not written yet. Watch this space.'}</div>`;
  return list.map((n) => `<div class="bubble ${n.mine ? 'mine' : 'them'}">${esc(n.body)}<div class="meta"><span>${n.mine ? 'You' : them === 'mortal' ? esc(state.mortal.name) : 'Your angel'} · ${timeAgo(n.at)}</span>${n.mine ? '' : `<button data-report="${n.id}">Report</button>`}</div></div>`).join('');
}

const THEME_ICON = { daily: '✨', weekly: '🎁' };
function renderPlaying() {
  const s = state;
  const me = s.me;
  const m = s.mortal;
  if (!m) { app.innerHTML = header() + '<div class="card"><p>You are not in this round.</p></div>'; return; }
  const fromCount = s.fromAngel.filter((n) => !n.mine).length;
  const others = s.members.filter((x) => x.id !== me.id);
  const theme = s.theme ? `<section class="card gold theme"><div class="ico" aria-hidden="true">${THEME_ICON[s.pack] || '✨'}</div><div>
      <div class="kicker">${s.pack === 'weekly' ? `Week ${s.theme.n} theme` : `Day ${s.theme.n} mission`}</div>
      <h3 style="margin:2px 0 4px">${esc(s.theme.title)}</h3><p class="small" style="margin:0">${esc(s.theme.text)}</p></div></section>` : '';
  const list = tab === 'mortal' ? s.toMortal : s.fromAngel;
  app.innerHTML = `${header()}
    <section class="card tint" id="mortalCard"><p class="small muted" style="margin:0 0 8px;font-weight:650">You are the secret angel of</p>
      <div class="mortal"><div class="avatar">${initial(m.name)}</div><div><h2 style="margin:0" id="mortalName">${esc(m.name)}</h2><p class="small muted" style="margin:0">Keep it secret until reveal day</p></div></div>
      ${likesList(m.likes)}</section>
    ${theme}
    <section class="card" id="notes">
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="mortal" aria-selected="${tab === 'mortal'}">To ${esc(m.name)}</button>
        <button role="tab" data-tab="angel" aria-selected="${tab === 'angel'}">From my angel${fromCount ? `<span class="count">${fromCount}</span>` : ''}</button>
      </div>
      <p class="small muted" style="margin:0 0 6px">${tab === 'mortal' ? `${esc(m.name)} sees your notes as "Your angel".` : 'Someone in the group looks after you. Reply here: they will see it, but not who you think they are.'}</p>
      <div class="thread" id="thread">${thread(list, tab)}</div>
      <form class="compose" id="compose"><label class="hidden" for="noteText">Note</label>
        <textarea id="noteText" maxlength="500" rows="1" placeholder="${tab === 'mortal' ? 'Write an anonymous note...' : 'Reply to your angel...'}">${esc(drafts[tab])}</textarea>
        <button class="btn" id="sendBtn" type="submit">Send</button></form>
      <p class="err" id="noteError" role="alert"></p>
    </section>
    <section class="card guess"><h3>Who is your angel?</h3>
      <p class="muted small" style="margin:0">Log your guess. You can change it any time before the reveal.</p>
      <select id="guessSel" aria-label="Your guess"><option value="">Not sure yet</option>${others.map((x) => `<option value="${x.id}" ${me.guess === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    </section>
    <section class="stats" aria-label="Group activity">
      <div class="stat"><b>${s.counts.notesToday}</b><span>notes today</span></div>
      <div class="stat"><b>${s.counts.notes}</b><span>notes in total</span></div>
      <div class="stat"><b>${s.counts.guessed}/${s.members.length}</b><span>have a guess</span></div>
    </section>
    ${me.organizer ? organiserPlaying() : ''}
    ${myLinkCard()}`;
  const th = $('#thread'); th.scrollTop = th.scrollHeight;
  const ta = $('#noteText');
  ta.addEventListener('input', () => { drafts[tab] = ta.value; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#compose').requestSubmit(); });
  $('#compose').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body) return;
    const btn = $('#sendBtn'); btn.disabled = true;
    try {
      state = await api(`games/${id}/note`, { method: 'POST', token, body: { to: tab === 'mortal' ? 'mortal' : 'angel', body } });
      lastJson = JSON.stringify(state); drafts[tab] = ''; render(); $('#noteText')?.focus();
    } catch (ex) { $('#noteError').textContent = ex.message; btn.disabled = false; }
  });
  $('#guessSel').addEventListener('change', async (e) => {
    try { state = await api(`games/${id}/guess`, { method: 'POST', token, body: { memberId: e.target.value || null } }); lastJson = JSON.stringify(state); toast(e.target.value ? 'Guess saved. Only you can see it.' : 'Guess cleared'); }
    catch (ex) { toast(ex.message); }
  });
}

function organiserPlaying() {
  const s = state;
  const reps = s.reports || [];
  return `<section class="card"><h3>Organiser</h3>
    <p class="muted small">On reveal day, press reveal (on a TV if you're together) and everyone can unmask the circle.</p>
    <button class="btn gold block" data-act="reveal">Reveal the angels</button>
    ${reps.length ? `<h3 style="margin-top:16px">Reported notes (${reps.length})</h3>${reps.map((r) => `<div class="card" style="box-shadow:none;margin:8px 0;padding:12px"><p class="small" style="margin:0 0 4px"><b>${esc(r.from)}</b> → ${esc(r.to)} · ${timeAgo(r.at)}</p><p class="small" style="margin:0;white-space:pre-wrap">${esc(r.body)}</p></div>`).join('')}<p class="muted small">Reported notes are hidden from the person who reported them. Have a quiet word with the sender.</p>` : '<p class="muted small" style="margin-top:10px">No reported notes.</p>'}
    <details style="margin-top:10px"><summary class="small" style="cursor:pointer">More</summary><div class="btns"><button class="btn danger small" data-act="delete">Delete game</button></div></details>
    </section>`;
}

function ringSvg(ring) {
  const n = ring.length;
  const S = 440, C = S / 2, R = n > 16 ? 150 : 140;
  const fs = n > 40 ? 9 : n > 20 ? 11 : n > 10 ? 14 : 18;
  const pts = ring.map((_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [C + R * Math.cos(a), C + R * Math.sin(a), a]; });
  let arrows = '', nodes = '';
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i]; const [x2, y2] = pts[(i + 1) % n];
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const k = 1.12; // bow the arrow outward slightly
    arrows += `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} Q${(C + (mx - C) * k).toFixed(1)},${(C + (my - C) * k).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="#c9c1f4" stroke-width="2" marker-end="url(#ah)"/>`;
  }
  pts.forEach(([x, y, a], i) => {
    const r = ring[i];
    const lx = C + (R + 26) * Math.cos(a), ly = C + (R + 26) * Math.sin(a);
    const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
    const max = n > 20 ? 10 : 14;
    const label = r.angel.length > max ? r.angel.slice(0, max - 1) + '…' : r.angel;
    nodes += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${n > 30 ? 5 : 8}" fill="${ring[(i - 1 + n) % n].correct ? '#1f8a5b' : '#4b3fb5'}"/>`;
    nodes += `<text x="${lx.toFixed(1)}" y="${(ly + fs / 3).toFixed(1)}" font-size="${fs}" text-anchor="${anchor}" fill="#221f3d" font-family="system-ui, sans-serif" font-weight="600">${esc(label)}</text>`;
  });
  return `<svg viewBox="-40 0 ${S + 80} ${S}" role="img" aria-label="The circle of angels"><defs><marker id="ah" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#9d92e8"/></marker></defs>${arrows}${nodes}</svg>`;
}

function renderReveal() {
  const s = state;
  const ring = s.ring || [];
  const n = ring.length;
  const right = ring.filter((r) => r.correct).length;
  let stage;
  if (revealStep === -1) {
    stage = `<section class="card tint reveal-stage" id="revealStage"><div style="font-size:2.4rem" aria-hidden="true">🪶</div>
      <h2>The angels are revealed</h2><p class="muted">${n} people, one circle. Unmask it one person at a time, or jump to the whole circle.</p>
      <div class="btns" style="justify-content:center"><button class="btn gold" data-act="step">Start the unmasking</button><button class="btn light" data-act="all">Show everything</button></div></section>`;
  } else if (revealStep < n) {
    const r = ring[revealStep];
    const verdict = r.guess ? (r.correct ? `<span class="verdict yes">${esc(r.mortal)} guessed it ✓</span>` : `<span class="verdict no">${esc(r.mortal)} guessed ${esc(r.guess)}</span>`) : `<span class="verdict none">${esc(r.mortal)} didn't guess</span>`;
    stage = `<section class="card reveal-stage" id="revealStage"><div class="progress">${revealStep + 1} of ${n}</div>
      <p class="who">${esc(r.mortal)}'s secret angel was</p><div class="angel" id="revealAngel">${esc(r.angel)}</div>${verdict}
      <p class="muted small" style="margin-top:12px">${r.notes} ${r.notes === 1 ? 'note' : 'notes'} sent</p>
      <div class="btns" style="justify-content:center"><button class="btn gold" data-act="step">${revealStep + 1 < n ? 'Next' : 'See the whole circle'}</button><button class="btn light" data-act="all">Skip to the end</button></div></section>`;
  } else {
    stage = '';
  }
  let summary = '';
  if (revealStep >= n) {
    const top = ring.slice().sort((a, b) => b.notes - a.notes)[0];
    const mine = s.me ? ring.find((r) => r.mortal === s.me.name) : null;
    summary = `<section class="card" id="ringCard"><h2>The circle</h2><p class="muted small">Each arrow points from an angel to the person they looked after. Green dots guessed their angel.</p>
      <div class="ringwrap">${ringSvg(ring)}</div>
      <div class="awards"><div class="award"><b>${right} of ${n}</b><span>guessed their angel</span></div>
      ${top && top.notes ? `<div class="award"><b>${esc(top.angel)}</b><span>most devoted angel · ${top.notes} ${top.notes === 1 ? 'note' : 'notes'}</span></div>` : ''}
      <div class="award"><b>${s.counts.notes}</b><span>notes sent in total</span></div></div></section>
      ${mine ? `<section class="card tint"><h3>Your result</h3><p style="margin:0">Your angel was <b>${esc(mine.angel)}</b>. ${mine.guess ? (mine.correct ? 'You guessed right!' : `You guessed ${esc(mine.guess)}.`) : "You didn't log a guess."}</p></section>` : ''}
      <section class="card"><h3>Who had whom</h3><ul class="chain" id="chain">${ring.map((r) => `<li><span><b>${esc(r.angel)}</b> → ${esc(r.mortal)}</span>${r.correct ? '<span class="ok">guessed ✓</span>' : `<span class="miss">${r.guess ? 'guessed ' + esc(r.guess) : 'no guess'}</span>`}</li>`).join('')}</ul>
      <div class="btns"><button class="btn light small" data-act="copyResult">Copy the results</button><button class="btn light small" data-act="restart">Replay the unmasking</button></div></section>`;
  }
  const next = nextOccasion();
  app.innerHTML = `${header()}${stage}${summary}
    <section class="card gold" id="startOwn"><h2>Run one for another group</h2>
      <p class="small">Family, friends, your class or your team: ${esc(next.text)}</p>
      <a class="btn" href="/?next=${next.key}">Start ${esc(next.name)}</a></section>
    ${s.me && s.me.organizer ? '<section class="card"><p class="muted small" style="margin:0 0 8px">This game and its notes are deleted automatically 14 days after the reveal.</p><button class="btn danger small" data-act="delete">Delete it now</button></section>' : ''}`;
}

function nextOccasion() {
  const m = new Date().getMonth();
  if (m === 10 || m === 11 || m === 0) return { key: 'cupid', name: 'a Secret Cupid', text: 'Secret Cupid week before Valentine\'s Day is the next big one. Dates are filled in for you.' };
  return { key: 'week', name: 'a kindness week', text: 'a one-week kindness game is a great way to welcome new people.' };
}

const markDirty = (e) => { if (e.target.closest('#cardForm, #settingsForm, #joinForm')) formDirty = true; };
app.addEventListener('input', markDirty);
app.addEventListener('click', markDirty, true);
app.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { tab = tabBtn.dataset.tab; render(); return; }
  const rem = e.target.closest('[data-remove]');
  if (rem) {
    if (!(await confirmBox({ title: `Remove ${rem.dataset.name}?`, text: 'They can join again with the link.', ok: 'Remove', danger: true }))) return;
    try { state = await api(`games/${id}/remove`, { method: 'POST', token, body: { memberId: rem.dataset.remove } }); lastJson = JSON.stringify(state); render(); }
    catch (ex) { toast(ex.message); }
    return;
  }
  const rep = e.target.closest('[data-report]');
  if (rep) {
    if (!(await confirmBox({ title: 'Report this note?', text: 'It will be hidden for you, and the organiser will see it with the sender\'s name.', ok: 'Report', danger: true }))) return;
    try { state = await api(`games/${id}/report`, { method: 'POST', token, body: { noteId: Number(rep.dataset.report) } }); lastJson = JSON.stringify(state); render(); toast('Reported. Thanks for keeping it kind.'); }
    catch (ex) { toast(ex.message); }
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'copyGroup') { toast((await copyText(groupUrl())) ? 'Link copied. Paste it in your group chat.' : 'Copy failed. Long-press the link to copy.'); }
  if (act === 'shareGroup') { try { await navigator.share({ title: state.name, text: `Join our secret angel game "${state.name}"`, url: groupUrl() }); } catch {} }
  if (act === 'copyMine') { toast((await copyText(personalUrl())) ? 'Your secret link is copied. Keep it private.' : 'Copy failed.'); }
  if (act === 'draw') {
    if (!(await confirmBox({ title: 'Close joining and draw?', text: `${state.members.length} people will each get one secret mortal. Nobody else can join after this.`, ok: 'Draw names' }))) return;
    try { state = await api(`games/${id}/draw`, { method: 'POST', token, body: {} }); lastJson = JSON.stringify(state); render(); toast('Names drawn! Tell the group to open the link.'); }
    catch (ex) { toast(ex.message); }
  }
  if (act === 'reveal') {
    if (!(await confirmBox({ title: 'Reveal all the angels?', text: 'Everyone will see who had whom. Notes and guesses close. This cannot be undone.', ok: 'Reveal' }))) return;
    try { state = await api(`games/${id}/reveal`, { method: 'POST', token, body: {} }); lastJson = JSON.stringify(state); revealStep = -1; render(); }
    catch (ex) { toast(ex.message); }
  }
  if (act === 'delete') {
    if (!(await confirmBox({ title: 'Delete this game?', text: 'Everything (people, notes, guesses) is deleted for everyone. This cannot be undone.', ok: 'Delete', danger: true }))) return;
    try { await api(`games/${id}`, { method: 'DELETE', token }); tokens.del(id); location.href = '/'; }
    catch (ex) { toast(ex.message); }
  }
  if (act === 'step') { revealStep = revealStep === -1 ? 0 : revealStep + 1; render(); window.scrollTo({ top: 0 }); }
  if (act === 'all') { revealStep = Infinity; render(); }
  if (act === 'restart') { revealStep = 0; render(); window.scrollTo({ top: 0 }); }
  if (act === 'copyResult') {
    const r = state.ring || [];
    const text = `${state.name}: the angels are revealed!\n${r.map((x) => `${x.angel} → ${x.mortal}${x.correct ? ' ✓' : ''}`).join('\n')}\n${r.filter((x) => x.correct).length} of ${r.length} guessed their angel.\nRun your own: ${location.origin}/`;
    toast((await copyText(text)) ? 'Results copied' : 'Copy failed');
  }
});

// Keep the page fresh while it is open, without wiping anything being typed.
setInterval(() => {
  if (document.visibilityState !== 'visible' || !state || state.status === 'revealed') return;
  const typing = document.activeElement && ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName);
  if (typing || formDirty || document.querySelector('.modal')) return;
  load(true);
}, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state && state.status !== 'revealed') load(true); });

load();

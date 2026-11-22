// Shared helpers for every page.
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-member-token'] = token;
  let res;
  try {
    res = await fetch('/api/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('No connection. Check your internet and try again.'), { status: 0 });
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
  return data;
}

// Tokens live on this device only. Key per game.
const KEY = (id) => 'fp:' + id;
export const tokens = {
  get(id) { try { return localStorage.getItem(KEY(id)); } catch { return null; } },
  set(id, t) { try { localStorage.setItem(KEY(id), t); } catch {} },
  del(id) { try { localStorage.removeItem(KEY(id)); } catch {} },
};

let toastTimer;
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

// In-page confirm dialog. Native confirm() is unreliable in chat apps' in-app browsers.
export function confirmBox({ title, text, ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <h2 id="mTitle">${esc(title)}</h2><p>${esc(text)}</p>
      <div class="btns"><button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button><button class="btn light" data-cancel>${esc(cancel)}</button></div></div>`;
    const done = (v) => { document.removeEventListener('keydown', onKey); m.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-cancel]')) done(false); else if (e.target.closest('[data-ok]')) done(true); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(m);
    m.querySelector('[data-ok]').focus();
  });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

export function fmtDate(d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  return isNaN(dt) ? '' : dt.toLocaleDateString(undefined, opts);
}
export function daysUntil(d) {
  if (!d) return null;
  const t = new Date(d + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today) / 86400000);
}
export function isoDate(dt) {
  const z = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${z(dt.getMonth() + 1)}-${z(dt.getDate())}`;
}

// The favourite-things card: same questions on create and join.
export const CARD = {
  drink: { q: 'Favourite drink', opts: ['coffee', 'tea', 'hot chocolate', 'juice', 'water'] },
  taste: { q: 'Treats: sweet or savoury?', opts: ['sweet', 'savoury', 'fruity', 'spicy'] },
  colour: { q: 'Favourite colour', opts: ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'black', 'white', 'gold'] },
};
const SWATCH = { red: '#e0473e', orange: '#f08a24', yellow: '#f5cf3a', green: '#3a9d5d', blue: '#3a6fd8', purple: '#7a4fc9', pink: '#ee7fb0', black: '#222', white: '#fff', gold: '#d6a72f' };
export const TEXTQ = {
  treat: { q: 'A snack or treat you love', ph: 'e.g. dark chocolate, chicharon', max: 60 },
  hobby: { q: "Something you're into", ph: 'e.g. plants, K-drama, running', max: 60 },
  avoid: { q: 'Please avoid', ph: 'e.g. nuts (allergy), candles', max: 80 },
};

export function cardHtml(prefix, likes = {}) {
  let h = '';
  for (const [k, c] of Object.entries(CARD)) {
    h += `<label id="${prefix}-${k}-l">${esc(c.q)} <span class="opt">(tap one)</span></label><div class="chips" role="group" aria-labelledby="${prefix}-${k}-l" data-key="${k}">`;
    for (const o of c.opts) {
      const dot = k === 'colour' ? `<span class="dot" style="background:${SWATCH[o]}"></span>` : '';
      h += `<button type="button" class="chip" data-v="${esc(o)}" aria-pressed="${likes[k] === o}">${dot}${esc(o)}</button>`;
    }
    h += '</div>';
  }
  for (const [k, c] of Object.entries(TEXTQ)) {
    h += `<label for="${prefix}-${k}">${esc(c.q)} <span class="opt">(optional)</span></label><input type="text" id="${prefix}-${k}" data-key="${k}" maxlength="${c.max}" placeholder="${esc(c.ph)}" value="${esc(likes[k] || '')}">`;
  }
  return h;
}
export function bindCard(root) {
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || !root.contains(chip)) return;
    const group = chip.parentElement;
    const was = chip.getAttribute('aria-pressed') === 'true';
    group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', String(!was));
  });
}
export function readCard(root) {
  const out = {};
  root.querySelectorAll('.chips[data-key]').forEach((g) => {
    const on = g.querySelector('.chip[aria-pressed=true]');
    if (on) out[g.dataset.key] = on.dataset.v;
  });
  root.querySelectorAll('input[data-key]').forEach((i) => { if (i.value.trim()) out[i.dataset.key] = i.value.trim(); });
  return out;
}
export function likesList(likes = {}) {
  const rows = [];
  const lab = { drink: 'Drink', taste: 'Treats', colour: 'Colour', treat: 'Loves', hobby: 'Into', avoid: 'Avoid' };
  for (const k of Object.keys(lab)) if (likes[k]) rows.push(`<dt>${lab[k]}</dt><dd>${esc(likes[k])}</dd>`);
  return rows.length ? `<dl class="likes">${rows.join('')}</dl>` : '<p class="muted small" style="margin-top:10px">They left their favourites card empty. Time for detective work.</p>';
}

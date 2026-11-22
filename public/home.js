import { $, api, tokens, isoDate } from './common.js';

const form = $('#createForm');
const date = $('#revealDate');
const today = new Date();
const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
date.min = isoDate(tomorrow);

// Default reveal day: the next 19 December if it is 5-45 days away, else two weeks out.
function defaultDate() {
  const y = today.getMonth() === 11 && today.getDate() > 19 ? today.getFullYear() + 1 : today.getFullYear();
  const xmas = new Date(y, 11, 19);
  const days = (xmas - today) / 86400000;
  if (days >= 5 && days <= 45) return xmas;
  const d = new Date(today); d.setDate(d.getDate() + 14); return d;
}
date.value = isoDate(defaultDate());

// Presets used by "run one for another group" links, e.g. /?next=cupid
const params = new URLSearchParams(location.search);
function nextDate(month, day) {
  const d = new Date(today.getFullYear(), month, day);
  if (d <= today) d.setFullYear(d.getFullYear() + 1);
  return d;
}
const PRESETS = {
  cupid: () => ['Secret Cupid', nextDate(1, 13), 'daily'],
  advent: () => ['Advent angels', nextDate(11, 24), 'daily'],
  week: () => { const d = new Date(today); d.setDate(d.getDate() + 7); return ['Kindness week', d, 'daily']; },
};
if (PRESETS[params.get('next')]) {
  const [name, d, pack] = PRESETS[params.get('next')]();
  $('#gName').value = name;
  if (d > today) date.value = isoDate(d);
  const r = form.querySelector(`input[name=pack][value=${pack}]`); if (r) r.checked = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#createError');
  errEl.textContent = '';
  const body = {
    name: $('#gName').value.trim(),
    orgName: $('#orgName').value.trim(),
    revealDate: date.value,
    pack: (form.querySelector('input[name=pack]:checked') || {}).value || 'daily',
    budget: $('#budget').value.trim(),
    note: $('#note').value.trim(),
  };
  if (!body.name) { errEl.textContent = 'Give your game a name.'; $('#gName').focus(); return; }
  if (!body.orgName) { errEl.textContent = 'Add your own name.'; $('#orgName').focus(); return; }
  if (!body.revealDate) { errEl.textContent = 'Pick a reveal day.'; date.focus(); return; }
  if (body.revealDate < date.min) { errEl.textContent = 'Pick a reveal day in the future.'; date.focus(); return; }
  const btn = $('#createBtn');
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    const r = await api('games', { method: 'POST', body });
    tokens.set(r.id, r.token);
    location.href = '/g/' + r.id + '?new=1';
  } catch (ex) {
    errEl.textContent = ex.message;
    btn.disabled = false; btn.textContent = 'Create the game';
  }
});

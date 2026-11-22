// Serves the game page with a link preview (Open Graph) that shows live state,
// e.g. "Office angels · 12 angels · 41 notes sent · reveal 19 Dec".
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00Z');
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new URL('/g', url.origin));
  let html = await page.text();
  let title = 'Join our secret angel game · Featherpost';
  let desc = 'Tap to join with your name. No sign-up, no app. Everyone secretly looks after someone, and guesses who looks after them.';
  try {
    const id = String(params.id || '');
    if (/^[A-Za-z0-9]{6,16}$/.test(id)) {
      const stub = env.ANGEL.get(env.ANGEL.idFromName('main'));
      const g = await (await stub.fetch(new Request(`https://do/__preview/${id}`))).json();
      if (g) {
        title = `${g.name} · secret angels`;
        const bits = [];
        if (g.status === 'open') bits.push(`${g.people} ${g.people === 1 ? 'person has' : 'people have'} joined`);
        else bits.push(`${g.people} angels`, `${g.notes} ${g.notes === 1 ? 'note' : 'notes'} sent`);
        if (g.status === 'playing' && g.guessed) bits.push(`${g.guessed} think they know their angel`);
        if (g.revealDate && g.status !== 'revealed') bits.push(`reveal ${fmtDate(g.revealDate)}`);
        if (g.status === 'revealed') bits.push('angels revealed');
        const tail = g.status === 'open' ? '. Tap to join, no sign-up.' : g.status === 'playing' ? '. Open to see your notes.' : '. See who had whom.';
        desc = bits.join(' · ') + tail;
      }
    }
  } catch (e) {
    console.error(e);
  }
  const canonical = `${url.origin}${url.pathname}`;
  const meta = `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Featherpost">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${url.origin}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">`;
  html = html.replace(/<!--META-->[\s\S]*?<!--\/META-->/, meta);
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

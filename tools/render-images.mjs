// Renders public/og.png (1200x630), the PNG icons, and the landing-page screenshots
// (public/shot-*.webp, cropped from the e2e run's phone screenshots in shots/).
// Usage: node tests/e2e/run.mjs && node tools/render-images.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import url from 'node:url';
const root = path.join(os.homedir(), '.cache/ms-playwright');
const dir = fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()[0];
const b = await chromium.launch({ executablePath: path.join(root, dir, 'chrome-linux64/chrome'), args: ['--allow-file-access-from-files'] });
const here = path.dirname(url.fileURLToPath(import.meta.url));
const pub = path.join(here, '../public');
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + path.join(here, 'og.html'));
await p.waitForTimeout(300);
await p.screenshot({ path: path.join(pub, 'og.png') });
for (const s of [180, 512]) {
  const q = await b.newPage({ viewport: { width: s, height: s } });
  const svg = fs.readFileSync(path.join(pub, 'icon.svg'), 'utf8').replace('<svg ', `<svg width="${s}" height="${s}" `);
  await q.setContent(`<body style="margin:0">${svg}</body>`);
  await q.screenshot({ path: path.join(pub, `icon-${s}.png`), omitBackground: true });
}
const shots = path.join(here, '../shots');
const crops = { 'shot-join': 'phone-join.png', 'shot-angel': 'phone-angel-fold.png', 'shot-reveal': 'phone-reveal-step.png' };
const c = await b.newPage();
for (const [out, src] of Object.entries(crops)) {
  const f = path.join(shots, src);
  if (!fs.existsSync(f)) { console.warn('missing', f); continue; }
  const data = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const webp = await c.evaluate(async (data) => {
    const img = new Image(); img.src = data; await img.decode();
    const W = 585, H = 1170; const k = W / img.width;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.fillStyle = '#fbf7f0'; g.fillRect(0, 0, W, H);
    g.drawImage(img, 0, 0, img.width, Math.min(img.height, H / k), 0, 0, W, Math.min(img.height * k, H));
    return cv.toDataURL('image/webp', 0.82);
  }, data);
  fs.writeFileSync(path.join(pub, out + '.webp'), Buffer.from(webp.split(',')[1], 'base64'));
}
await b.close();
console.log('rendered');

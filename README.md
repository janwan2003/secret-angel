# Featherpost (secret-angel)

A no-sign-up secret angel game for groups, in one link: **https://pb-secret-angel.pages.dev**.
Also known as Monito Monita, Kris Kindle, Angels & Mortals, Secret Pal or Secret Sister.

- Organiser creates a game (name, reveal day, missions: daily kindness / weekly gift themes / just notes, optional budget and message) and shares the link.
- People join with a name and an optional favourites card (drink, treats, colour, a snack, a hobby, things to avoid).
- The organiser draws one single circle (3–80 people). Each person sees only their own mortal and their card.
- Anonymous notes both ways (angel → mortal, mortal → "my angel"), a daily or weekly theme, guess logging, report button, kindness filter.
- Reveal: step-by-step unmasking, circle diagram, who guessed right, "most devoted angel", copyable results, "run one for another group".
- Link preview shows live state ("4 angels · 3 notes sent · 2 think they know their angel · reveal 19 Dec").
- Personal link (`#k=` token) to use the same identity on another device. Data deleted 14 days after reveal.

## Stack
Cloudflare Pages (static `public/`) + Pages Functions (`functions/`). Data lives in **one SQLite-backed Durable Object**
in the Worker `pb-secret-angel-db` (`worker/`), because the account is at the free plan's 10 D1 databases.
`worker/index.js` wraps the object's SQL storage in a small D1-style shim, so `worker/api.js` is plain SQL. `schema.sql` is the source
for `worker/schema.js` (a unit test checks they match). Rate limits per IP (create 20/h, join 80/h, notes 150/h, writes 400/h, reads 3000/h).

## Develop
```
npx -y pnpm install
(cd worker && npx wrangler dev --port 8791 --ip 127.0.0.1 --persist-to ../.wrangler/state) &
npx wrangler pages dev --port 8790 --ip 127.0.0.1 --persist-to .wrangler/state
npm run test:unit
BASE=http://127.0.0.1:8790 node tests/e2e/run.mjs   # real Chromium, 7 browser contexts, screenshots in shots/
node tools/render-images.mjs                         # og.png, icons, landing screenshots (needs shots/ from the e2e run)
```

## Deploy
```
set -a; . ../../.env; set +a
(cd worker && npx wrangler deploy)          # when worker/ changed
npx wrangler pages deploy --branch main
BASE=https://pb-secret-angel.pages.dev SHOTS=shots-prod node tests/e2e/run.mjs   # deletes its own game
```
Product, support and privacy page: `docs/` on GitHub Pages (https://janwan2003.github.io/secret-angel/).

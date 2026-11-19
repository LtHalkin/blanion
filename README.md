# BLANION — The Blanchardstown Daily Dive

Seven questions. One town. How deep can you go?

A daily Blanchardstown / Dublin 15 trivia game. Everyone gets the same seven questions, 25 seconds each.
Any correct answer scores, but **rare answers score more** (Plankton 10 → One in a BLANION 100, max 700/day).
An original pixel-art angler, **Blinny**, sinks from the sunlit surface to the abyss as your score climbs.

## Deploy on Cloudflare (Workers + Durable Object)

The site is a single **Worker**: static files from `public/` plus `/api/*`, which is handled by **one Durable Object**
(`Blanion`) that owns all game state, so answer counts, rarity tiers and scoring are always consistent. State is persisted
in the Durable Object's SQLite-backed storage (one key per record, only changes are written). No D1/KV needed.

```bash
npm install
npx wrangler login                      # once
npx wrangler secret put ADMIN_PASSWORD  # required — without it /admin is disabled
npm run deploy                          # → https://blanion.<your-subdomain>.workers.dev
```

- **Custom domain:** Workers & Pages → blanion → Settings → Domains & Routes → add your domain (it must be on Cloudflare DNS).
- **Launch date:** Day 001 opens on the first request unless you set `"vars": { "LAUNCH_DATE": "2026-12-01" }` in `wrangler.jsonc`
  (Europe/Dublin date). Days roll over at Dublin midnight; the closing/finalising of a day happens on the first request after midnight.
- **Local dev:** put `ADMIN_PASSWORD=something` in `.dev.vars`, then `npm run dev` (http://localhost:8787). Local state lives in `.wrangler/`.
- **Smoke test any deployment:** `node tests/smoke.js https://your-site ADMIN_PASSWORD` plays a dive and exercises review, rescoring and the audit chain
  (it creates a test player + one test answer, so run it before launch, or clear/ignore it).
- **Scale note:** all `/api` traffic goes through one Durable Object (a few hundred requests/second). Static files are served by Cloudflare's edge and don't count.
  If BLANION outgrows that, shard play endpoints and keep scoring in the DO, or move records to D1.
- **Backups:** Durable Object storage has point-in-time recovery (30 days); for your own copy, add an admin export endpoint.
- Admin sessions are stateless signed tokens (12 h), so they survive Durable Object restarts. Rotating `ADMIN_PASSWORD` invalidates them.

## Run it on plain Node instead

```bash
node server.js                      # Node 18+, no install needed
# optional env: PORT=3000  ADMIN_PASSWORD=…  LAUNCH_DATE=2026-11-19  BLANION_DATA=./data/store.json  TRUST_PROXY=1
npm test                            # engine unit tests
```

- Game: `http://localhost:3000/`   Admin ("Harbour Master"): `http://localhost:3000/admin`
- If `ADMIN_PASSWORD` is unset a random one is printed at start-up. **Set it in production.**
- State is a single JSON file (`data/store.json`, atomic writes) — back it up.
- Both runtimes share the same game code (`lib/core.js`); only the thin adapters differ (`server.js` for Node, `src/index.js` + `src/do-store.js` for Cloudflare).
- Only Day 001 is written; add later days in `DAYS` in `lib/core.js`.

## How answers are judged (never "an AI thinks it sounds right")

1. **Curated database** per question (`lib/day001.js`): canonical name, aliases/spellings/abbreviations, area, location, coordinates, source URL, verification date + status, rarity prior.
2. **Matching** (`lib/engine.js`): normalise (case, accents, punctuation, "Saint"→"St") → exact alias → typo tolerance (edit distance, only if unambiguous) → prefix. All variants resolve to **one** canonical answer, so no double points.
   Names that fit several answers (e.g. "Castleknock" for a club) ask the player "which did you mean?" — the clock keeps running.
3. **Rules**: too-broad answers ("Dublin", "Fingal") and known out-of-boundary places (Phoenix Park, Lucan…) are auto-rejected but appealable.
4. **Unknown answers** are preserved, scored 0 for now, marked *pending* and queued in **ANSWER REVIEW**. Players can appeal with a note/link.
5. **Admin decisions** — approve (needs a source URL + an in-boundary area; coords must fall inside the Dublin 15 box; duplicate of an existing answer is refused → use merge), merge, reject (reason required), flag for research. One decision applies to every player who gave that answer, and scores are **recomputed from decisions** — there is no endpoint to edit a score.
6. **Audit trail**: every decision, coverage change, answer edit, day close and recalculation is appended to a hash-chained log (verify it in the admin AUDIT LOG tab).

## Rarity & fairness

`share = (count + prior·k) / (total + k)` with `k = max(0, 100 − total)` — day-one priors (expected popularity) fade out as real answers arrive and are gone at 100 valid answers per question.
Shares → tier: ≥25% Plankton · ≥12% Too Clever · ≥6% Schooler · ≥3% Rare · ≥1% Deep Cut · below 1% (or sole submitter once ≥10 answers) One in a BLANION.
Scores shown during the day are **provisional**. At midnight (or admin "close day") tiers are frozen from the real counts and everyone is scored identically. Answers approved after close get a tier from the frozen total and keep it (sticky).

## Coverage boundary — decision needed

The brief's boundary list names seven areas (Blanchardstown Village, Blanchardstown, Castleknock, Carpenterstown, Coolmine, Hartstown, Huntstown) but Day 001's answers also use Clonsilla, Mulhuddart, Tyrrelstown, Hansfield, Corduff, etc. The server therefore has **core** (the 7) and **extended** (other Dublin 15 townlands in the Day 001 list). Extended is ON by default; switch it off in *Day & Stats* (audited) to be strict.

## Things the editor must verify (flagged in the admin "Flagged" tab)

The answer list is used as supplied; it has not been independently verified, and coordinates are area centroids, not surveyed points. Entries that look doubtful — Mount Sackville (usually Chapelizod), St Catherine's Park, St Peregrine's GAA, Erin Go Bragh GAA, Lady's Well Park, Hopkins Park, Shackleton Mills/Gardens, ringforts, Verona FC, St Luke's NS, St Brigid's Church — are accepted but flagged until confirmed with a source or suspended.
Duplicates in the brief were merged into one answer each (Millennium Regional/Millennium Park, Tolka Valley Regional/Tolka Valley Park, Castleknock Castle/Motte and Bailey, Castleknock GAA/Hurling & Football Club).

## Not built yet

Accounts/streaks, profanity filter for nicknames, multi-day question scheduling UI, server-side web search for suggested sources, an admin data export, and a scheduled (cron) day-close — a day is currently finalised lazily on the first request after midnight. Part 5+ of the brief (geographic section onward) was cut off after "Huntstown"; anything later in the spec is not implemented.

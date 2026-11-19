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
npx wrangler secret put ADMIN_PASSWORD     # required — without it /admin is disabled
npx wrangler secret put REVIEWER_PASSWORD  # optional — enables the read-only /reviewer panel
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

## Day 002 and the admin day tester

`lib/day001.js` exports `DAY2` (pubs, places of worship, shops, food & drink, fitness, health, roads); it is registered in `DAYS` in `lib/core.js` and opens automatically on launch date + 1 (Europe/Dublin). A question has `n` (position in the day) and `q` (answer-bank category), so a day can use any bank category; Day 001 is unchanged.

In **/admin → DAY & STATS → TEST A DAY** you can load any day's questions (default Day 002), see how many answers and abbreviations each has, and type answers or abbreviations to see exactly how the live game would match and score them (exact / typo / abbreviation, ambiguity, tier). It writes nothing: no plays, submissions or stats.

Growing the bank: `NODE_USE_ENV_PROXY=1 node scripts/harvest.js` does a polite (1 req/s) Nominatim grid harvest into `scripts/osm-raw/nominatim-extra.json` (resumable); then `node scripts/build-bank.js` rebuilds `lib/bank.json`.

## BLANION Racer (`/racer`)

A low-poly 3D time-trial racer in the spirit of PolyTrack (original code and art, nothing copied). **Art direction:** clean flat-shaded low-poly only, no photo textures, one soft sun with a subtle shadow that follows the car, a coordinated palette per circuit, and its own menu/HUD identity (aubergine, cream, tangerine, mint and coral, Chakra Petch type).

- **Cars (`public/racer-cars.js`):** four race cars lofted from cross-sections so they have real silhouettes: *Apex GT* (GT3 coupe, big wing), *Tourer T* (touring saloon), *Sprint LM* (prototype with dorsal fin and double wing) and *Hot Hatch RS*. Each has splitter, diffuser, racing wheels (tyre, five-spoke rim, caliper), mirrors, headlights and tail lights, five liveries and a racing number you choose. Each also has slightly different handling (speed, acceleration, grip).
- **Circuits:** Seaside GP (sunny, long straights, palms), Sunset Dunes (hairpin, cacti and mesas), Midnight Lagoon (twisty, hilly, crystals). All have wide roads of a consistent width, road markings, kerbs, barriers, grandstands with crowds, billboards, start gantry and a painted grid. Start/finish is always on a straight. **Random tracks** come from a numeric code (same code, same circuit).
- **Racing:** 3 laps, WASD (W accelerate, S brake, A/D steer, SPACE drift; arrow keys also work), 120 Hz fixed-step physics, ghost car of your best race, gold/silver/bronze medals, minimap, engine sound, touch controls.
- `public/racer-core.js` – track maths, car physics, lap rules, AI driver (pure functions, tested in Node: `tests/racer.test.js`). Every circuit is validated and must be finished cleanly by the AI driver with every car; the AI's time sets the medal thresholds.
- `public/racer3d.js` – the view (merged vertex-coloured meshes, fast on phones). `public/racer.js` – game flow, garage menu, HUD, ghost, records.
- Best times, ghosts and settings are stored in your browser (`localStorage`); there is no server leaderboard.

## Endless Dive (unlimited mode for the main game)

The daily dive is seven questions once a day. **Endless Dive** (home screen: `∞ ENDLESS DIVE`, also on the results screen) is the unlimited version: as many runs as you like, any time.

- A run keeps asking the same seven kinds of question (waterway, station, park, school, heritage, area, club) in random order, until you lose all **3 lives**. A wrong, unknown or too-slow answer costs a life; **five correct in a row wins one back** (max 5). Every answer in a run must be new (repeating one is rejected, costs nothing).
- **Same rules as the daily game:** the same matching engine (aliases, typos, "which did you mean?"), the same 25 s clock, the same rarity tiers and points. The clock shrinks by 3 s every 8 answers (floor 12 s). The mascot dives with your score, and zones continue past the Abyss.
- **16 categories:** the daily seven plus pubs & bars, places of worship, hotels, shops, food & drink, fitness & leisure, health, business/retail parks & shopping centres, and roads (questions 8–16 are endless-only; the daily game is unchanged). Answers come from OpenStreetMap (© OpenStreetMap contributors, ODbL) filtered to the Blanchardstown boundary.
- **Abbreviations:** every answer carries generated + hand-curated short forms (`CKC`, `Coolmine CS`, `SFX`, `EGB`, `Rd`/`St`, `&`/`and`…) built by `lib/abbrev.js` with collision checks, so `scripts/build-bank.js` can be re-run safely. Existing deployments pick up the new bank automatically (bank v3) without touching admin-edited answers.
- **Rarity in endless mode:** tiers come from the most recent *finalised* real day that saw the answer, otherwise from the answer's expected-popularity prior. Nothing you do in Endless touches daily statistics, rarity counts, leaderboards or player records (the server endpoints `/api/endless/*` are stateless), so it cannot skew the real game.
- **Feeds the answer bank:** an unknown answer shows "I think that's right — suggest it", which sends it to ANSWER REVIEW (and the verification bot), never accepted automatically. Suggestions are de-duplicated and limited to 15 per hour per IP.
- A run ends with a depth, a tier breakdown, your best answers and a copyable result; your best run is saved on your device. No online leaderboard (the run is scored in the browser).

## Answer bank

The bank holds **141 answers** (Q1 waterways 5 · Q2 stations 5 · Q3 parks 16 · Q4 schools 36 · Q5 heritage 21 · Q6 areas 39 · Q7 clubs 19; the admin Answer Database shows live numbers).
It has three layers:

1. **Hand-curated Day 001 seed** (`lib/day001.js`), supplied by the editor.
2. **OpenStreetMap-sourced expansion** (`lib/bank.json`, built by `node scripts/build-bank.js` from `scripts/osm-raw/nominatim.json`).
   Every entry is looked up by name in the harvested OpenStreetMap data, and the build fails if one cannot be found, so each carries a **real coordinate and an openstreetmap.org source link**.
   The same data also upgraded the seed answers' coordinates from area-centres to real points and resolved several flags
   (e.g. St Peregrine's GAA, Verona, Lady's Well Park, St Luke's NS are located inside Dublin 15).
   Entries are marked `verification: osm-sourced` — that means *sourced and located*, **not** *admin-verified*. Review them in the admin Answer Database.
   Judgement calls (which side of the boundary a borderline place is on) are explicit in `scripts/build-bank.js`, and borderline ones carry a flag.
3. **Player-discovered answers**: anything players type that is not in the bank goes to ANSWER REVIEW and, once approved with a source, joins the bank.
   **BULK IMPORT** (admin tab, or `POST /api/admin/answers/import`) adds many verified answers at once with the same rules (source URL, in-boundary area, no duplicates), with a dry-run preview and an audit entry.

**Upgrading an existing deployment:** on start-up, any store seeded by an older bank is topped up automatically (new answers added, untouched seed answers enriched, answers an admin has edited are never overwritten; one `seed.sync` audit entry, idempotent). Players, plays and audit history are untouched.

Known limits: OpenStreetMap is thin for clubs and for archaeology (e.g. no ringfort points), so the heritage and sports lists are the shortest.
New neighbourhood answers are the Dublin 15 **townlands** from OpenStreetMap; they sit in the "extended" boundary ring.
Places OpenStreetMap puts outside Dublin 15 (Lucan, Leixlip, Palmerstown, Chapelizod, Ashtown, Phoenix Park…) were excluded.
The Wikipedia, fingal.ie and mytown.ie pages named in the brief could not be reached from the build environment, so they were not used; bulk import is the way to add data from them.

**Attribution:** place names and coordinates © OpenStreetMap contributors, licensed under the ODbL 1.0 (https://www.openstreetmap.org/copyright). The site footer carries the credit; keep it.

## BLANION STACK (second game, `/stack`)

A block-stacking game you can play before or after the daily dive (linked from the home and results screens): drop **20 blocks of different shapes and sizes** (planks, posts, cubes, triangles, wedges, hexagons, wheels, T, L and plus pieces) onto a ledge and build the tallest tower you can. Blocks that fall off are lost; your score is the height (metres) of what is standing once the tower has settled or collapsed.

- **Drag anything.** Grab any block with the mouse or a finger, even one still falling, to nudge, fix or rescue your tower (a soft spring ties it to the pointer, so it still collides with everything; released blocks are speed-capped so you cannot fling them). The block waiting at the top can be dragged anywhere above the tower; click it (mouse) or press DROP/Space to drop it. Keys: ← → move, Q E / ↑ turn (15° steps), Space/Enter drop, Esc/P pause. Touch: on-screen buttons, drag the block, tap empty water to steer.
- **Daily leaderboard.** Today's blocks are the same for everyone (seeded from the Dublin date; `public/stack-shapes.js` is shared by the browser and the server). Your best height of the day goes on the leaderboard under your diver name (shared with the trivia player profile). RANDOM BLOCKS is practice and is not submitted.
- **How scores are checked (honest limits).** The physics runs in the player's browser, so the server cannot fully verify a score. It checks a signed start token (issued when a daily game begins), a minimum play time (20 s), a physical upper bound on height for that day's actual blocks, and sane block counts, and it keeps only each player's best. A determined cheater could still submit a high-but-possible number, so admins get a **STACK SCORES** tab to review and remove scores (reason required, audited). Real verification would mean replaying recorded inputs on the server.
- **Tuning for fairness/ease:** wider ledge, grippier blocks with a little water drag, the waiting block can be lowered close to the tower, and the daily sequence never repeats a shape back-to-back, has at most 3 awkward shapes (wheel, small triangle, wedge) and at least 7 easy ones.
- **Polish:** impact shake, splash particles, sound effects (mute button; Web Audio, nothing downloaded), height ruler with labels, best-height marker, "+x m" popups, pause (auto-pauses when the tab is hidden), result titles from *Pebble Pile* to *Reaching the Surface*.
- Physics: [Matter.js](https://brm.io/matter-js/) 0.20.0 (MIT), vendored in `public/vendor/` so the page works under the strict Content-Security-Policy with no CDN. Personal bests are also kept in `localStorage`.
- Cross-promo: the home and results screens also link to the Lowfly flight sim.

## BLANION WEIGH-IN (third game, `/weigh`)

"How many eggs does an elephant weigh?" Five odd comparisons per day: a big thing (elephant, blue whale, Boeing 747, Statue of Liberty, hippo, T. rex…) against a small unit (eggs, paperclips, €1 coins, Lego bricks, pints of water, honey bees…). You guess how many of the small thing balance the big thing (type a number, use the ÷10 ÷2 ×2 ×10 buttons, or drag the log-scale slider, 1 to 1 billion).

- **3D balance scale.** Every object is a low-poly 3D model built from primitives (`public/weigh-models.js`, 38 models, no external assets) on a rendered-chunky "pixel-art 3D" scale (`public/weigh3d.js`). The big object drops onto the left pan; when you lock in, a pile of the small thing builds on the right and the beam **tips to your guess with spring physics**, then swings **level with the true answer**, with sparkles for a good guess. Captions count up your guess and the answer. Tap the stage to skip the animation.
- **Polish.** Round pips that colour by result, an animated score, count-ups, staggered result list, confetti, shake on bad input, sound effects (Web Audio, mute button), reduced-motion support (no spinning/tilting, instant reveal), and a **graceful fallback to emoji if WebGL is unavailable**.
- **Scoring:** 100 points for an exact answer, falling by 10 points per tenth of an order of magnitude you are out, so within 10% is about 96, twice or half is about 70, and ten times out (either way) is 0. Five rounds, 500 maximum. After each guess you see how far out you were (e.g. "2.3× too high"), the true answer on a log scale, the two weights used and a fun fact.
- **Daily:** today's five are the same for everyone (seeded from the Dublin date; never the same big object or unit twice, always at least one small answer and one huge one); RANDOM FIVE is practice. Your daily result is kept in `localStorage` and shown again if you revisit; results are copyable as an emoji grid.
- **Data:** `public/weigh-data.js` holds 18 big objects, 25 units and 30 curated pairs, with round, widely quoted average masses (shown as "≈" because real animals and objects vary). Unit tests check every pair has a sensible answer (10 to 1 billion), the scoring maths, the daily selection, and that **every object has a 3D model**. To add content: add the object/pair in `weigh-data.js`, add a model in `weigh-models.js`, run `npm test`.
- **Model gallery:** `/weigh-gallery.html` shows every model in one scene (`?ids=elephant,egg` for a subset), handy when tuning or adding models.
- **3D library:** [Three.js](https://threejs.org/) (MIT), tree-shaken and minified into `public/vendor/three-lite.min.js` (~550 KB, ~140 KB gzipped, loaded only on this page) so it works under the strict Content-Security-Policy with no CDN. Rebuild with `scripts/build-three.sh` after `npm i three` (the bundle's export list is `scripts/three-entry.js`).
- **No leaderboard on purpose:** the answers are computable in the browser, so a leaderboard would be trivially cheatable.

Linked from the home and results screens alongside Stack and Lowfly.

## BLANION MINI GOLF (fourth game, `/golf`)

Three holes of real-time 3D mini golf, playable before or after the daily dive (linked from the home and results screens): **1 Gentle Dogleg** (par 2), **2 Spinner Alley** (par 3: time the spinning arms, mind the sand traps) and **3 Pond Crossing** (par 3: use the bridge, a splash costs a stroke; a slope near the cup pushes the ball). Par for the round is 8.

- **Controls:** drag back from anywhere and let go to putt (slingshot style, any pointer: mouse, touch or pen). A dotted guide shows the first bounces and a power-coloured arrow shows strength. Rotate the camera with ⟲ ⟳ / ← → / right-drag / two-finger twist, zoom with + − / wheel / pinch, toggle an overview camera, Esc or P to pause. Eight strokes maximum per hole ("pick up").
- **Graphics:** Three.js with soft shadow-mapped lighting, ACES tone mapping, procedural mown-grass, wood, sand and water textures, a real cup cut into the green, wooden rails with caps and posts, striped bumpers and spinner arms, a waving flag, pond stones and ripples, animated slope chevrons, low-poly trees/bushes/flowers/rocks/hills and drifting clouds, a sky gradient with fog, particle effects (dust, splashes, sparks, confetti) and a camera fly-over intro per hole. Mobile gets cheaper shadows and a wider camera; `prefers-reduced-motion` removes the fly-over and shake.
- **Physics:** a custom 2D engine (`public/golf-physics.js`, no dependencies, runs in Node): fixed 240 Hz sub-stepping so results are identical at any frame rate, continuous circle-vs-segment collision (no tunnelling), restitution walls, kick bumpers, rotating spinner arms with surface velocity, sand and grass friction, slopes, water hazards and a cup that only captures a ball moving slowly enough.
- **Course fairness is tested.** `scripts/golf-solve.js` brute-forces each hole and `tests/golf.test.js` replays the stored solutions: hole 1 is solvable in 2 (par), hole 2 even in 1 (a timed hole-in-one), hole 3 in 2. The tests also cover rolling distance, wall reflection, no escaping the course from any angle at full power, the cup (gentle drops, fast skips), water and respawn, sand, slopes, spinner collisions, determinism and score names.
- **Scoring:** result names (Hole in one, Birdie, Par, Bogey…), a scorecard with a title from *Keep Practising* to *Mini Golf Legend*, your best round saved in `localStorage`, and a copyable result. There is no server leaderboard (physics runs in the browser, so it would be trivially cheatable).
- **3D library:** the shared tree-shaken Three.js bundle (`public/vendor/three-lite.min.js`, ~600 KB / ~150 KB gzipped, rebuilt with `scripts/build-three.sh`) is loaded only on the 3D game pages. If WebGL is unavailable the page says so and links back.
- **Adding a hole:** add an entry to `HOLES` in `golf-physics.js` (outline, tee, cup, optional bumpers / spinners / sand / water / slopes / blocks), run `node scripts/golf-solve.js` to confirm it is solvable, and add the solution to the test.

## Reviewer panel (view only)

`/reviewer` is a second, read-only panel that shows **only the ANSWER REVIEW list** (pending / flagged / decided / all, with the bot's recommendation and evidence, player appeals and proposed sources). It has no forms or buttons and cannot change anything.
It is switched on by setting a **`REVIEWER_PASSWORD`** secret (separate from `ADMIN_PASSWORD`; unset = the panel is disabled).
Reviewer tokens are signed with the reviewer password under a different role, so they are rejected by every `/api/admin/*` endpoint (and admin tokens are rejected by `/api/reviewer/*`), even if both passwords happen to be the same. The reviewer API exposes no write endpoints and strips internal ids from the list.
Set it locally with `REVIEWER_PASSWORD=… node server.js`, or in `.dev.vars` for `npm run dev`. Rotating the password logs reviewers out.

## Verification bot (auto-approve)

A bot checks answers nobody has seen before. It is **not** an AI model: it gathers evidence from OpenStreetMap (Nominatim) and computes a confidence score, so player text can never "instruct" it.

For each unknown answer, in order:
1. **Near-duplicate?** ≥ 90% similar to an existing answer → merge it in as an alias.
2. **OpenStreetMap lookup** inside the Dublin 15 box. Best hit is scored: `confidence = name similarity × place-type fit for the question × uniqueness` (a second, equally good place elsewhere cuts it by 20%).
   Place-type fit is strict: a school must be tagged as a school, a station as a station, a park/garden/common as green space, and so on (a pub is never a school; a bare pitch is not a club; colleges and woods count for less).
3. **Hard gates the threshold cannot override:** the place must be inside the box *and* mappable to an approved BLANION area, a source URL is required, and places within ~1 km of the box edge (where the true border is uncertain) are only ever recommended to a human.
4. **Outside the boundary?** If the same place exists but OpenStreetMap puts it outside (e.g. labelled Lucan, Dunboyne, Chapelizod) it is auto-rejected with the evidence (the player can still appeal).

**Defaults (admin → BOT tab, every change audited):** enabled · **auto-approve at ≥ 70%** · auto-merge ≥ 90% · auto-reject ≥ 85% · threshold adjustable 50–100.
Anything it will not or cannot act on stays in ANSWER REVIEW with the bot's recommendation, reasons and OpenStreetMap links shown and the approval form pre-filled.
Bot approvals use the same validation code as a human admin, create answers marked `bot-verified` (with the confidence and evidence stored), rescore players like any approval, and are logged with actor `bot`. **UNDO (SUSPEND)** in the BOT tab reverses an approval.

It runs every 10 minutes (Cloudflare cron trigger in `wrangler.jsonc`; a 5-minute timer on Node) and on demand with **RUN BOT NOW**. It handles at most 8 answers per run (1 request/second to OpenStreetMap, per their usage policy) and re-checks "couldn't tell" answers at most 3 times, 24 h apart.
Set a `BOT_USER_AGENT` variable (e.g. `blanion-answer-bot/1.0 (you@example.com)`) so OpenStreetMap can contact you, as their policy asks.

**Know the trade-off:** 70% means roughly three in ten borderline approvals could be wrong, and an approved answer scores for every player who gave it. In a live test it approved "Rabbit Warren" (a woodland OpenStreetMap lists in Blanchardstown) at 75%, which a human might have questioned. Spot-check the BOT tab regularly, or raise the threshold (85–90 makes it approve only near-exact matches).
Clubs and heritage sites are thinly mapped on OpenStreetMap, so most of those will still land with a human.

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

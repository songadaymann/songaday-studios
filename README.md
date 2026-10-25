# Song A Day Studio

Standalone site source for Song A Day Studio (songaday.studio). This project intentionally lives
outside the Fridays at The Park app.

## Files

- `profile.html` — editable page markup
- `profile.css` — editable styles
- `profile.js` — editable page behavior and catalog stats
- `assets/` — icons, video, and other page assets
- `index.html`, `films/index.html`, `everything/index.html`, `now/index.html`, `commission/index.html`,
  `commission/song.html` — generated pages
- `build.mjs` — builds those pages from the editable files, and bakes in a snapshot of the Films
  playlist and of today's song (needs network; without it those link to YouTube until the
  Worker fills them in). `SONGADAY_OFFLINE=1` skips the snapshots, and `--out <folder>` writes
  the pages somewhere else; the tests use both.
- `projects.json`, `projects.mjs`, `validate-projects.mjs` — every place Song A Day lives, one
  row each, served at https://songaday.studio/projects.json; see "Projects" below
- `bar/v1/bar.js` — the universe bar, the strip across the top of the other Song A Day sites; see
  "The universe bar" below
- `everything.html` — songaday.studio/everything: every row of `projects.json`, by status
- `now.html` — songaday.studio/now: what Jonathan is doing now, dated, in his words
- `press.html`, `press-page.js`, `press.mjs`, `press/press.json`, `update-press.mjs` — the press
  page (songaday.studio/press/), which `build.mjs` builds into `press/index.html`; see "Press" below
- `wallet/wallet-detect.js`, `wallet/wallet-gate.js` — the crypto-wallet-gate skill's files,
  unchanged. `build.mjs` inlines them into the home page and /everything, where they show the
  `data-crypto` rows only to browsers with a wallet (`?crypto=1`, `?crypto=0` and
  `?crypto=auto` test both states). On the home page the same check also feeds the crypto
  donation switch (see "Donations").
- `song-day.mjs` — shared daily song-number calculation for the browser and Worker
- `today-song.mjs` — the "Today's song" card under the headline: the newest "Title | Song A Day
  #N" upload on the YouTube channel. It plays in the page's video modal. The Worker re-reads the
  channel feed (cached for ten minutes), so the card changes soon after the day's song goes up.
- `links/index.html` — the bio link page (songaday.studio/links) for Instagram, TikTok and X: one
  phone-sized column of links with a line each, today's song at the top. A standalone static
  page with no script or web fonts. The Worker fills in today's song (as a YouTube link) and its
  number. Its links use the short addresses below, so changing one there changes it here too.
- `data-lab/lab.html`, `data-lab/lab.json` — the data lab (songaday.studio/data): every song next to the
  weather, moon, planets, news and views, and the tested findings. `lab.html` is a self-contained
  page; `build.mjs` wraps it in a document with the bar. `lab.json` comes from the public
  [songaday-data](https://github.com/songadaymann/songaday-data) repo: run its `web/export.py`
  and copy `web/lab.json` into `data-lab/` to refresh it. (The folder isn't called `data/`,
  which `.gitignore` keeps for private data.)
- `calendar.mjs`, `build-calendar.mjs`, `calendar.json` — "This is all of it": every song as
  one picture, an image per year; see "Calendar" below
- `plugins/index.html` — the plugin downloads page (songaday.studio/plugins), a standalone static
  page; its images are in `assets/plugins/`. Downloads come from each project's GitHub releases.
  Its site header is a copy of the one in `profile.html`; `tests/site.test.mjs` checks their section links match.
- `films.html`, `films-page.js`, `films.mjs` — the Films page (songaday.studio/films/): Jonathan's
  "Mini-documentaries" YouTube playlist as thumbnails that turn into players. `build.mjs` bakes in
  a snapshot of the playlist; the Worker re-reads YouTube's feed (cached for an hour), so new
  mini-docs appear without a redeploy. The feed lists up to 15 videos.
- `worker.mjs` — the Cloudflare Worker: redirects, section links, today's song number and card,
  the live Films list, and CORS for the bar and `projects.json`
- `media.mjs` — serves the site videos from R2 with byte ranges, so they can seek and play on iPhones
- `upload-media.mjs` — uploads `assets/video/` to the R2 bucket
- `fumble.mjs`, `fumble-page.mjs`, `fumble-approve.mjs`, `migrations/` — the Fumble page
  (songaday.studio/fumble); see below
- `turnstile.mjs` — the Turnstile check that Fumble and commissions share
- Song commissions (songaday.studio/commission); see "Commissions" below:
  - `commission.html`, `commission.css`, `commission-page.js` — the public page and request
    form, and the browser script for it and the buyer's page. `build.mjs` builds them into
    `commission/index.html` and `commission/song.html` (the shell for each buyer's page).
  - `commission-config.mjs` — prices, payment plans and limits, used by the build and the Worker
  - `commission.mjs` — every route under `/commission`, making a request, the buyer's page, and
    the daily cron step
  - `commission-core.mjs` — what the others share: cleaning text, recognizing audio, the
    request states, the place in line, money formatting
  - `commission-admin.mjs` — Jonathan's admin at `/commission/admin`, behind Cloudflare Access
  - `commission-stripe.mjs` — Stripe Checkout, the webhook, and monthly plans
  - `commission-email.mjs` — the emails and the outbox they go through
  - `commission-page.mjs` — the buyer's page
  - `commission-migrations/` — the schema of the `songaday-commissions` D1 database
  - `tests/fake-cloudflare.mjs` — fake D1, R2, email and rate-limit bindings and fake Stripe,
    Turnstile and Access for the commission tests

## Sections

songaday.studio is the front door for all of Song A Day, so it has a short address for each
part of it. The header links to these. Parts without their own page here yet are sent on by the
Worker with a temporary (302) redirect, so the address can point somewhere else, or become a
real page, later:

| URL | Goes to |
| --- | --- |
| `/all`, `/songs` | https://gallery.songaday.world/, every song on one zoomable wall |
| `/listen` | https://songaday.fan/challenge |
| `/suggest` | https://songaday.fan/suggestions |
| `/jamuary` | https://songaday.fan/jamuary |
| `/today` | `/#today`, today's song on the home page |
| `/year/2014` | `/#year-2014`, that year on the home page calendar (2009 to this year) |
| `/games` | https://mann.cool/ |
| `/wamp` | https://wamp.land/ |
| `/commission` | Song commissions: the page and request form (`commission.mjs`; see "Commissions") |
| `/commissions` | `/commission` |
| `/albums` | https://jonathanmann.bandcamp.com/music |
| `/discord` | https://discord.gg/rGTQH7mFNS |
| `/me` | https://www.jonathanmann.net/ |
| `/motba` | https://motba.art/ |
| `/films/` | `films/index.html`, built from `films.html` |
| `/mini-docs` | `/films/` |
| `/plugins/` | `plugins/index.html` |
| `/links/` | `links/index.html`, the bio link page |
| `/fumble` | The Museum of Fumbled Bags (`fumble.mjs`) |
| `/everything/` | `everything/index.html`, built from `projects.json` |
| `/now/` | `now/index.html`, built from `now.html` |
| `/press/` | `press/index.html`, built from `press/press.json`; see "Press" |
| `/podcasts`, `/interviews`, `/media` | `/press/` |
| `/data` | https://github.com/songadaymann/songaday-data, until the data lab has its page here |
| `/donate` | `/#donate`, the gift form on the home page |

Three dead songaday.world hostnames that are still linked out in the world are custom domains
of this Worker too, and redirect on any path (`HOST_REDIRECTS` in `worker.mjs`):
`market.songaday.world` (the X bio link) goes to `https://songaday.studio/links/`,
`enter.songaday.world` (the Discord link in years of YouTube descriptions) goes to the Discord
invite, and `jamuary.songaday.world` goes to `https://songaday.studio/jamuary`. `enter.` isn't
attached yet: it still has an old DNS-only CNAME to a dead zeet host, which makes Cloudflare
reject the whole domain update. Delete that record in the dashboard (songaday.world > DNS), then
add `enter.songaday.world` back to `routes` in `wrangler.jsonc` and deploy.

Change a destination in `SECTION_REDIRECTS` in `worker.mjs`. When a section gets its own page,
delete its line there and add the page under `dist/` in `build-production.mjs`. The header is
copied in `profile.html`, `films.html`, `plugins/index.html` and `fumble-page.mjs` (/everything,
/now and the commission pages reuse the one in `films.html`, the commission pages without its
Donate button); the tests check they match.

## Projects

`projects.json` lists the places Song A Day lives: sites and sections, not songs (those are in
the song catalog) or games (mann.cool's `games.json`). The universe bar reads it, the home
page's "Where to go next" and /everything are built from it, and any site can fetch it from
https://songaday.studio/projects.json (CORS is open, cached for five minutes).

```json
{ "version": 1, "verbs": ["listen", "see", "play", "build", "make", "get-a-song", "join", "watch", "support", "collect", "other"], "projects": [...] }
```

Each project has:

| Field | |
| --- | --- |
| `id` | lowercase-with-hyphens, unique |
| `title` | its name |
| `verb` | what you do there, one of `verbs` |
| `path` | its songaday.studio short address (`/listen`), or `null`. Links go through it when it's there. |
| `url` | the place itself |
| `tagline` | up to 80 characters of plain words. Archived places say when they were. |
| `status` | `active`, `soon`, `seasonal`, `lab` or `archived` |
| `since` | optional, `YYYY` or `YYYY-MM`; leave it out rather than guess |
| `sourceUrl` | its public GitHub repository, or `null` |
| `crypto` | `true` when its main thing is crypto: then it shows only to visitors with a wallet |
| `inBar` | `true` to put it in the universe bar |
| `barLabel` | its words in the bar, up to 16 characters (only with `inBar`) |
| `season` | for `seasonal` places, the months it runs: `"Dec-Jan"` |

To add a project, add a row (keep rows of the same verb together), then:

```bash
node validate-projects.mjs          # checks every field
node validate-projects.mjs --links  # also loads every url and sourceUrl
node --test tests/*.test.mjs
```

If it has a short address, add that to `SECTION_REDIRECTS` in `worker.mjs` first (the tests
check every `path` answers). Then `node build-production.mjs` and `wrangler deploy`. The bar
picks up the change within five minutes; the home page and /everything with the deploy.

## The universe bar

`bar/v1/bar.js` is a 36px strip that links the Song A Day sites to each other: "Song A Day
#6,503 · by Jonathan Mann" (to songaday.studio), the `inBar` projects (Listen · See all · Play
· Get a song), and a Donate pill to `https://songaday.studio/?from=<this site's hostname>#donate`.
On phones it folds into "#6,503 ☰ Donate" with a small menu. It's for the other Song A Day
sites: songaday.studio's own pages don't show it, since their header already links to
everything the bar does (the data lab, which has no header, links home from its eyebrow).

Any site adds it with one tag; `data-here` is the site's verb from `projects.json`, and marks
its link as the current one:

```html
<script type="module" src="https://songaday.studio/bar/v1/bar.js" data-here="listen" defer></script>
```

It goes at the top of `<body>`. For no layout shift, also put `<songaday-bar></songaday-bar>`
where it should go with `songaday-bar { display: block; height: 36px; background: #000; }` in
the page's CSS; the bar fills that element in.

- It's a custom element with its own shadow DOM, so it can't restyle the host page or be
  restyled by it. It uses the system font and makes no requests other than `projects.json`.
- The song number is worked out in the browser (New York date, #1 is January 1, 2009, the same
  as `song-day.mjs`) and changes at midnight.
- `projects.json` loads after the bar is drawn. If it fails, the bar keeps the list built into
  `bar.js` (`FALLBACK`), so a studio outage leaves a slightly stale bar, not a broken page.
  `tests/bar.test.mjs` checks that list against `projects.json`; update it when the bar's
  projects change.
- "Collect" (and any other `crypto` project) shows only when the browser has a wallet. The bar
  carries its own copy of `wallet-detect.js` (the tests keep it identical), honours `?crypto=1`,
  `?crypto=0` and `?crypto=auto`, and goes with the page's own wallet gate when the page has one.
- The Worker serves `/bar/v1/*` with `Access-Control-Allow-Origin: *` (module scripts from
  another site need it), cached for four hours. `v1` is a promise: a change that could break a
  host page goes in `bar/v2/`, and sites move to it when they're ready.

The studio uses it on the home page, Films, Plugins, Fumble, /everything and /now, above the
studio header. The bio link page (/links) has no bar.

Requires Node.js 22 or newer. Run the tests with:

```bash
node --test tests/*.test.mjs
```

The headline counts calendar days from January 1, 2009 (Song A Day #1), matching
the toolkit's numbering. It uses America/New_York for all visitors, serves current
numbers from the Worker, and refreshes open pages every minute and on return to
the tab. No catalog API or daily deployment is required.

Local media is kept in gitignored `private-assets/site/`; the ignored `assets`
symlink preserves the existing preview and production paths. Public checkouts
automatically use media hosted at `https://songaday.studio/assets/`, so the site
can be previewed without the private media bundle. See `ASSETS.md` for ownership
and exclusions. For a standalone build with your own media, put it in `assets/`.

## Local preview

From this folder:

```bash
node build.mjs
python3 -m http.server 3000
```

Then open <http://localhost:3000/>. The section links need the Worker; to try them,
run `node build-production.mjs` and then `wrangler dev --local-upstream localhost`.
Under `wrangler dev` the videos come from a local copy of the R2 bucket; fill it once with
`node upload-media.mjs --local`.
(Without `--local-upstream`, wrangler dev presents requests as http://songaday.studio and the
https redirect loops. An older wrangler that rejects the compatibility date also needs
`--compatibility-date` set to one it supports.)

After editing `profile.html`, `profile.css`, `profile.js`, `films.html`, `films-page.js`,
`films.mjs`, `commission.html`, `commission.css`, `commission-page.js` or `commission-config.mjs`,
run `node build.mjs` again. The static server will serve the refreshed page.

The page includes external embeds and links, so use the local HTTP server
rather than opening `index.html` directly from Finder.

## Calendar

"This is all of it", under the hero, shows every song so far as one picture: an image per year,
with each day's video still in a 31 × 12 grid (days across, months down). The rest of the
current year shows as empty slots. The page itself has no script for it, just one `<img>` per
year with a 2x version for sharp screens.

`build-calendar.mjs` makes the images from the 480×270 stills that
[songaday-display](https://github.com/songadaymann/songaday-display) builds, one `<number>.webp`
per song. It needs ffmpeg:

```bash
node build-calendar.mjs ~/Library/Caches/songaday-display/publish/stills
```

(or set `STILLS_DIR`). It writes `assets/calendar/<year>.webp` and `<year>-2x.webp` (about
550 KB and 1.2 MB for all years; "-2x", not "@2x", because Cloudflare redirects an "@" in an
asset path to "%40", an extra round trip) and `calendar.json`, which is tracked: each year's song count
and where most of its songs were recorded. The page says "Through #N", so it's honest when it
falls behind. To bring it up to date, run it again, then `node build-production.mjs` and
`wrangler deploy`. Image URLs carry `?v=<last song>`, so browsers fetch the new ones.

## Press

https://songaday.studio/press/ lists Jonathan's press, podcasts, radio and TV, newest first:
the eight newest featured pieces (the rest open under "more featured"), then all of it by year,
with filters for the kind (Press, Podcasts & radio, TV & video), the project and the year. It
replaces the press pages on jonathanmann.net.

It comes from the Google Sheet "jonathan_mann_press_inventory". The sheet's **Public** tab is a
formula over the Press Inventory tab that keeps only the rows to publish, with 12 columns: `id`,
`date`, `outlet`, `title`, `kind`, `format`, `subject`, `project`, `url`, `byline`, `featured`
and `wallet_only`.

- **How it updates.** The build renders `press/press.json`, a committed snapshot of the Public
  tab, into `press/index.html`. Once `PRESS_CSV_URL` is set, the Worker also reads the Public tab
  (keeping a copy for 15 minutes) and shows that instead. Google republishes the tab a few
  minutes after an edit, so a new row is on the site within about 20 minutes, with no deploy.
  If the sheet can't be read, or has fewer than half as many good rows
  as the snapshot (an emptied or broken tab), the page keeps the snapshot, and tries the sheet
  again a minute later. It also keeps the snapshot if the tab has lost a column (all 12 must be
  there, each once), or is over 1 MB or 2,000 rows.
- **Adding a piece.** Add a row to Press Inventory with an ID starting `JM-`, Status
  `Source found`, a Title / Segment, a Date (`YYYY-MM-DD`, or `YYYY-MM` / `YYYY` when that's all
  you know) and the Source URL (or an Archive URL when the original is gone). A row without a
  title doesn't show. Rating A makes it featured; Rating F keeps it off. Tick Wallet only for a
  piece that's about buying the NFTs, like a marketplace's own blog (see below). Format decides
  the filter: one that includes "podcast episode" or "podcast interview", or starts with
  "radio", is Podcasts & radio; one that starts with "TV", "talk" or "interview / video", or
  includes "livestream", is TV & video; everything else is Press. Project decides the project
  filter (see "Project groups" below).
- **One-time setup.** In the sheet, File > Share > Publish to web:
  1. Under Link, choose the Public tab and "Comma-separated values (.csv)".
  2. Open "Published content & settings" and change "Entire document" to just **Public**. Left
     as Entire document, every tab is published to anyone with the link, Press Inventory's notes
     and ratings included, and the link goes in this public repo.
  3. Tick "Automatically republish when changes are made", and publish.
  4. Check it: open the address with `/pub?` changed to `/pubhtml?`, and only the Public tab
     should be there. With `gid=` changed to Press Inventory's number (it's in the sheet's
     address when that tab is open, usually 0), it should give an error, not the inventory.
  5. Paste the address into `PRESS_CSV_URL` in `wrangler.jsonc`, then
     `node build-production.mjs` and `wrangler deploy`.
- **Refreshing the snapshot.** Now and then (and when rows have been removed on purpose), run
  `node update-press.mjs` to rewrite `press/press.json` from the published tab, or
  `node update-press.mjs public.csv` with a CSV downloaded from it. It lists any row it leaves
  out and why, and won't drop below half the old rows (`--allow-shrink`) or show everyone a row
  that was wallet-only (`--allow-wallet-change`) unless you say so. Commit the file, then build
  and deploy.

If the Public tab isn't there yet: Press Inventory needs column R "Archive URL" and column S
"Wallet only" (checkboxes), and column K (Date) formatted as plain text. Add a tab named Public
and paste this into A1. It keeps rows whose ID starts `JM-`, whose Status is `Source found`, that
have a link and aren't rated F, sorted newest first:

```
=ARRAYFORMULA(LET(
  ids,  'Press Inventory'!A5:A,
  stat, 'Press Inventory'!B5:B,
  subj, 'Press Inventory'!C5:C,
  proj, 'Press Inventory'!D5:D,
  outl, 'Press Inventory'!F5:F,
  fmt,  'Press Inventory'!H5:H,
  ttl,  'Press Inventory'!I5:I,
  who,  'Press Inventory'!J5:J,
  rawd, 'Press Inventory'!K5:K,
  grade,'Press Inventory'!L5:L,
  src,  'Press Inventory'!N5:N,
  arc,  'Press Inventory'!R5:R,
  wal,  'Press Inventory'!S5:S,
  when, IF(ISNUMBER(rawd), IF(rawd<10000, TEXT(rawd,"0"), TEXT(rawd,"yyyy-mm-dd")), TRIM(rawd)),
  link, IF(TRIM(arc)<>"", TRIM(arc), TRIM(src)),
  low,  LOWER(fmt),
  kd,   IF(REGEXMATCH(low,"podcast episode|podcast interview|^radio"), "Podcasts & radio",
        IF(REGEXMATCH(low,"^tv|livestream|^talk|^interview / video"), "TV & video", "Press")),
  keep, (LEFT(ids,3)="JM-")*(stat="Source found")*(link<>"")*(grade<>"F"),
  body, FILTER(HSTACK(ids, when, outl, ttl, kd, fmt, subj, proj, link, who, grade="A", UPPER(TO_TEXT(wal))="TRUE"), keep),
  VSTACK({"id","date","outlet","title","kind","format","subject","project","url","byline","featured","wallet_only"},
         SORT(body, 2, FALSE, 1, FALSE))
))
```

What the page checks: each row needs an `id` starting `JM-`, an http or https `url` and a real
`date`, a `title`, and `featured` and `wallet_only` that are TRUE, FALSE or empty; rows that fail
are left out. A `kind` it doesn't know counts as Press, and an empty outlet shows the site's name.
Every value is escaped, so nothing in the sheet can add HTML or a script, and only http and https
links are made.

The filters combine, and each is part of the address: `/press/?kind=podcasts&project=sec&year=2024`.
The kinds are links, and the project and year are menus with a Show button. The Worker answers
the address with the other rows hidden, so the filters work without JavaScript. With it,
`press-page.js` filters in place as you click or pick, hides the Show button and keeps the
address in step. Any filter hides the featured pieces, and shows "Showing N of M" and Clear
filters. Each menu choice shows how many pieces it would show with the other filters as they
are. A year comes from the rows themselves, newest first. An address with a filter the page
doesn't have (`?project=nope`, `?year=2008`) shows the whole list.

**Project groups.** The sheet's Project column is free text, so `PRESS_PROJECTS` in `press.mjs`
maps its values to the groups in the menu, each with a short slug for the address:

| Group | Slug | Project values |
| --- | --- | --- |
| Song A Day | `song-a-day` | Song A Day, Song A Day / Hugh Mann, Career overview, Selling Song A Day NFTs, Crypto Tax Nightmare / Song A Day 6000 |
| The SEC lawsuit | `sec` | Suing the SEC |
| GameJew | `gamejew` | GameJew |
| Coldplay Canoodle | `coldplay` | Coldplay Canoodle |
| The Mario Opera | `mario-opera` | The Mario Opera |
| WAMP | `wamp` | WAMP, WAMP / AI-built projects |
| X-Play: The Musical | `x-play` | X-Play: The Musical |

Case doesn't matter. A value no group lists goes under **Other**, which is in the menu only
while it has rows, and `node update-press.mjs` names each such value. To fix one, add it to a
group's `projects` in `press.mjs`, or add a group: a `slug` (keep it once it's live, since links
use it), a `label`, and its `projects`. Everyone sees the labels, so they can't use crypto words
like NFT. A group with no rows isn't in the menu.

Rows with `wallet_only` (the OpenSea interview) are crypto parts: they're inside `data-crypto` and
show only to browsers with a wallet (see `wallet/`), and only those browsers count them, in the
totals, "Showing N of M" and the menus. Everything else, including the SEC suit and NFT news,
shows to everyone.

## Fumble

https://songaday.studio/fumble is The Museum of Fumbled Bags: visitors post anonymous stories
about the one that got away. Nothing goes up until Jonathan reads it, and each story he
publishes gets a painting made by Codex.

- `fumble.mjs` answers everything under `/fumble`: the page, posting, single stories at
  `/fumble/<number>`, and paintings at `/fumble/images/<key>`. `fumble-page.mjs` is its HTML.
- A post needs a Turnstile check, has a length limit, and can't contain links or wallet
  addresses. It's limited to 3 a minute per visitor, and posting pauses while 300 stories are
  waiting. Stories are stored with only the date they were sent: no IP address, account, or time.
- Stories are in the D1 database `songaday-fumble` (schema in `migrations/`); paintings are in
  the R2 bucket `songaday-fumble`.

To review waiting stories:

```bash
node fumble-approve.mjs
```

For each story: publish, edit (opens `$EDITOR`, for taking out a name), delete, or skip.
Publishing has Codex paint the story with your ChatGPT sign-in (no API key; it uses Codex's
plan limits), opens the painting, and asks to use it, paint again, or publish without one. The
painting style is `STYLE` at the top of `fumble-approve.mjs`. A copy of each painting is kept in
the ignored `output/fumble/`. `node fumble-approve.mjs --paint` paints published stories that
don't have one yet, and `--paint 12` paints Fumble No. 12 again. Add `--local` to work against
`wrangler dev`'s local database and bucket.

The script needs Codex signed in with ChatGPT (`codex login`). Codex CLI builds older than the
ChatGPT app's can't use the current models with a ChatGPT sign-in, so the script uses the copy
inside `/Applications/ChatGPT.app` when it's there; set `CODEX_BIN` to use another.

To try it locally, put Cloudflare's always-pass Turnstile test keys
(https://developers.cloudflare.com/turnstile/troubleshooting/testing/) in `.dev.vars` as
`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (see `.env.example`), then:

```bash
wrangler d1 migrations apply songaday-fumble --local
node build-production.mjs
wrangler dev --local-upstream localhost
```

Setting it up on a new Cloudflare account: `wrangler d1 create songaday-fumble` (put its id in
`wrangler.jsonc`), `wrangler r2 bucket create songaday-fumble`, `wrangler d1 migrations apply
songaday-fumble --remote`, create a Turnstile widget for the domain (`wrangler turnstile widget
create`) and put its site key in `wrangler.jsonc`, then `wrangler secret put TURNSTILE_SECRET_KEY`.

## Commissions

The D1 database and the private R2 bucket (setup steps 1 and 2) were created on 2026-10-23, and
the database id is in `wrangler.jsonc`. On 2026-10-24 email (step 3) passed its end-to-end test,
and the Access application for the admin (step 4) was created. Stripe (step 5) was set up in the
sandbox on 2026-10-25; its live-only settings wait for step 8. Until `COMMISSION_REQUESTS` is
`"open"` (step 8), `/commission` goes on to the Bandcamp commission listings, as it always has,
so deploying other changes in the meantime never leaves people without a way to buy a song.

https://songaday.studio/commission is where people ask Jonathan for a song. It's a purchase
from Jonathan, on his own Stripe account: nothing on these pages or in these emails says donate,
gift, tax-deductible or patron, and nothing links to Patreon. The commission pages leave out the
header's Donate button and the footer's sponsor line for that reason.

### How it works

1. **Asking.** The buyer fills in the form: who the song is for and what they are to them, the
   occasion, names and how to say them (or a voice memo), the story ("the more information the
   better"), anything to leave out, a deadline if there is one, personal or business, whether
   it can be that day's Song A Day, whether they'd like a video, and their name and email.
   There's no style question. The form needs a Turnstile check, is limited to 3 a minute per
   visitor (per /64 for IPv6), and one email address can have at most 5 songs waiting
   (`pat+1@` and `pat+2@` count as `pat@`).
2. **The line.** Requests are written in the order they came in, with no limit. The buyer is
   told their place (#N) right away, by email and on their private page
   (`/commission/s/<token>`, a 128-bit link), and told straight away if that place is after
   their deadline (at `WRITES_PER_DAY`, 10). Each morning a cron emails anyone whose number
   went down since the last email they actually got, at most once a day, so #30 hears "You're
   now #20" the morning after Jonathan finishes 10. They can turn these emails off, and cancel,
   until he starts writing.
   - **A flood.** More than `INTAKE_ALARM_PER_DAY` (30) requests in 24 hours isn't a busy day
     (the busiest months on record had about 25 in the month). Past it, new requests are held,
     not refused: out of line, with an email that repeats nothing anyone typed, and Jonathan
     gets an alarm email (once a day). The admin's Held tab lets them in, each told its place,
     or cancels them all with no email.
3. **Writing.** Jonathan reads the requests in order at `/commission/admin`: every answer in
   full, one card each, with the voice memo playable. The line opens with any deadline due in a
   week or at risk at its place. "Start writing" is optional; it emails the buyer that their
   song is being written, since from then on they can't cancel it from their page (it's
   Jonathan's to cancel). "Find a request" takes a request
   number (every buyer email's subject ends "(request 57)"), or part of an email, name or
   recipient, so a reply can be matched to its request.
4. **Delivering.** On a request's admin page he uploads the song (MP3, M4A or WAV, up to 30 MB),
   pastes the lyrics, adds a video link if there is one, and clicks Deliver. The buyer gets an
   email; their page now plays the song and shows the lyrics. The email also has a second link,
   `/commission/share/<token>`, for passing on: it plays the song and shows the lyrics, with
   nothing they told Jonathan, no amounts and no buttons (the download once paid). Their own
   page's link stays theirs. "Undo delivery" pulls a song sent to the wrong request.
5. **Paying.** Payment is on delivery, pay what you want: personal songs from $200 (suggested
   $300, $500, $1,000 or more), business and theme songs from $1,500. They pay at once, or
   spread it over 3, 6 or 12 monthly payments that stop by themselves (honor system: the
   download unlocks after the first). After paying they can add an extra ("pay what it was
   worth"). Paying unlocks the download. Unpaid songs get one reminder a week after delivery.
   Venmo, PayPal or invoice payments are marked by hand in the admin ("Mark paid").
6. **Jonathan's summary.** The same cron emails him a summary when there's news: new requests
   (marked when they want a video), deadlines in the next week or at risk, held requests,
   payments, plans that ended, emails that didn't go out, and what needs a look (paid while
   cancelled or back in line, paid twice, or a monthly plan with no end set). The cron also
   retries the schedule for any plan that has none.

Every email is written to an outbox table first and sent through Cloudflare Email Service when
it's set up, so nothing is lost; the admin's Emails tab shows each one, with Send now and
Resend. Without email set up they wait there, and so they do while sending itself is broken
(the domain not verified or onboarded, the account paused) or the daily quota is used up: none
of those counts against an email's five tries. Each email is checked against its request as it
goes, so nobody hears about a place in line after cancelling, or gets a reminder after paying.

### Where things live

- Requests, payments, monthly plans and the email outbox: the D1 database
  `songaday-commissions` (bound as `COMMISSIONS_DB`; schema in `commission-migrations/`).
  Buyer data lives only there, never in this repo or in logs.
- Voice memos and delivered songs: the private R2 bucket `songaday-commissions` (bound as
  `COMMISSION_FILES`). No public access; everything goes through the Worker.
- Money: Stripe. Refunds and disputes happen in the Stripe Dashboard.
- How long things are kept (the daily run deletes them; the numbers are in
  `commission-config.mjs`):
  - a voice memo: 30 days after its song is delivered or its request cancelled
    (`MEMO_KEEP_DAYS`);
  - a request cancelled with no payment, with its emails, memo and song: 90 days
    (`CANCELLED_KEEP_DAYS`);
  - an email, sent, failed or never sent: 180 days (`OUTBOX_KEEP_DAYS`), except the ones
    with a place in line for someone still in it;
  - everything else (delivered songs, answers, payments) until Jonathan deletes it.
- **Delete for good**, on a request's admin page (with a confirm box), is for someone who asks
  to be forgotten: it deletes their answers, memo, song and emails, and their links stop
  working. A request with payments stays as a blank money record. It's refused while a monthly
  plan is still billing.

### Changing prices and limits

Everything is in `commission-config.mjs`: the floors and suggestions (`PRICES`), the video
price (`VIDEO_PRICE_CENTS`, `null` until Jonathan sets one; then the page shows it and it's
added to the floor of requests that want a video), the monthly options (`PLAN_MONTHS`), the
5-songs-per-email cap, how many songs a day the page says Jonathan writes (`WRITES_PER_DAY`), the
flood alarm (`INTAKE_ALARM_PER_DAY`), the reminder delay, how long things are kept, and upload
sizes. The page copy is built from the same values, so run `node build-production.mjs` and
`wrangler deploy` after a change. A single
request's floor can be changed in the admin (Edit), for a business invoice or a video price
agreed by email.

### Config and secrets

Public values are `vars` in `wrangler.jsonc` (the ones marked PLACEHOLDER need real values):

| Var | |
| --- | --- |
| `COMMISSION_REQUESTS` | `"open"` takes requests; anything else shows "Requests open soon." |
| `SITE_ORIGIN` | `https://songaday.studio`: links in emails and Stripe's return addresses |
| `COMMISSION_FROM_EMAIL`, `COMMISSION_FROM_NAME` | the sender, on a domain onboarded to Email Sending |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Cloudflare Access for the admin; empty means localhost only, with `COMMISSION_ADMIN_LOCAL` |
| `COMMISSION_ADMIN_LOCAL` | `yes` in `.dev.vars` only, never in `wrangler.jsonc`: lets the admin open on localhost without Access |

Secrets, set with `wrangler secret put <NAME>` (locally, in `.dev.vars`):

| Secret | |
| --- | --- |
| `STRIPE_SECRET_KEY` | a restricted key (`rk_live_...`) with write access to Checkout Sessions, Subscriptions and Subscription Schedules, and to Products and Prices (Checkout's `price_data` makes them inline). In test mode, a refused call names the permission it's missing. |
| `STRIPE_WEBHOOK_SECRET` | the webhook endpoint's `whsec_...` |
| `ADMIN_EMAILS` | the addresses allowed into the admin, comma-separated. A secret only so Jonathan's address stays out of this public repo. |
| `COMMISSION_REPLY_TO` | where buyers' replies go: Jonathan's own inbox. A secret for the same reason. |
| `COMMISSION_NOTIFY_TO` | where the daily summary goes: Jonathan's own inbox. |
| `TURNSTILE_SECRET_KEY` | already set for Fumble |

Missing pieces fail soft: until `COMMISSION_REQUESTS` is `"open"`, `/commission` goes to the
Bandcamp listings; without the database or the Turnstile secret the form is closed; without a
Stripe key the buyer's page says payments aren't set up yet; without the webhook secret the
webhook answers 503; without email, or while sending fails for the domain or the account,
emails wait in the outbox; without Access the admin answers only on localhost with
`COMMISSION_ADMIN_LOCAL=yes`; with Access but no `ADMIN_EMAILS`, nobody gets in.

### Setup (Jonathan, once, in this order)

1. **Database** (done 2026-10-23; these are the steps for a new account).
   `wrangler d1 create songaday-commissions`, paste the `database_id` it prints
   into the `COMMISSIONS_DB` entry in `wrangler.jsonc` (replacing the zeros), then
   `wrangler d1 migrations apply songaday-commissions --remote`.
2. **Bucket** (done 2026-10-23). `wrangler r2 bucket create songaday-commissions`. Leave public access off: no
   r2.dev URL and no custom domain.
3. **Email** (Email Service needs the Workers Paid plan). Sending was turned on for
   songaday.studio on 2026-10-24 (`wrangler email sending enable songaday.studio`).
   - songaday.studio's own mail is iCloud's (its MX and SPF records point there), so **don't
     turn on Email Routing**: it would replace those MX records. Sending only adds records under
     `cf-bounce.` and `_domainkey`, plus a DMARC record; `wrangler email sending dns get
     songaday.studio` lists them. iCloud signs songaday.studio mail with its own DKIM key
     (`sig1._domainkey`), so a strict DMARC policy doesn't affect it.
   - Mail goes out from `songs@songaday.studio`. Replies and the daily summary go to Jonathan's
     own inbox, set as secrets so the address stays out of this repo:
     `wrangler secret put COMMISSION_REPLY_TO` and `wrangler secret put COMMISSION_NOTIFY_TO`.
   - To send from a different address, change `COMMISSION_FROM_EMAIL` and
     `allowed_sender_addresses` on the `COMMISSION_EMAIL` binding in `wrangler.jsonc`
     (`tests/commission-config.test.mjs` checks the sender is allowed).
   - Check it end to end before anything else sends: `wrangler email sending send --from
     songs@songaday.studio --to <his inbox> --subject test --text test`, and see
     it arrive in Jonathan's inbox. An address that bounces is added to Email Service's
     suppression list, and every later email to it fails at once (`E_RECIPIENT_SUPPRESSED`),
     even after routing is fixed. To take one off: list them with `GET
     /accounts/<account_id>/email/sending/suppression` and remove it with `DELETE
     .../suppression/<id>` (Cloudflare API, with an Email Sending token), or in the dashboard.
   - A new account starts with a small daily sending quota that grows with good sending, so
     open requests a few weeks before the Christmas rush (November and December are a third
     of the year's commissions). If it's too low, ask with Cloudflare's Limit Increase Request
     Form. Place-in-line emails wait behind everything else when the quota runs out.
4. **Access** (the admin; done 2026-10-24: the "songaday.studio commission admin" application
   on the `motba` team, and both values are in `wrangler.jsonc`).
   - Cloudflare dashboard > Zero Trust > Access controls > Applications > Create new
     application > Self-hosted and private > Public DNS. Add two public hostnames on
     `songaday.studio`: path `commission/admin` and path `commission/admin/*` (a wildcard path
     doesn't cover its parent).
   - Add a policy: Action Allow, Include > Emails > Jonathan's address. Never "Everyone".
   - Copy the Application Audience (AUD) tag (the application's Additional settings tab) into
     `ACCESS_AUD`, and the team domain (`<team>.cloudflareaccess.com`) into
     `ACCESS_TEAM_DOMAIN` (with or without `https://`). Both are also in the login redirect:
     `curl -sI https://songaday.studio/commission/admin` answers 302 to
     `https://<team>.cloudflareaccess.com/...?kid=<AUD tag>`.
   - `wrangler secret put ADMIN_EMAILS` with the same address.
5. **Stripe** — Jonathan's own account, not the fiscal sponsor's: the **jonathanmann.bandcamp**
   account. Do all of it in test mode (a sandbox) first.
   - **Done in the sandbox (2026-10-25):** Smart Retries, the webhook below, a restricted key
     ("songaday-studio-commissions (sandbox)"), and both secrets on the Worker.
   - **Live-only, still to do (step 8):** Stripe hides these in test mode, so they're set once,
     on the live account:
     - Settings > Business: business name and statement descriptor "SONG A DAY".
     - Settings > Customer emails: turn on receipts for successful payments.
     - Billing > Revenue recovery: failed-payment emails on, and "cancel the subscription" once
       all retries fail.
   - Settings > Billing > Subscriptions and emails > Manage failed payments: Smart Retries for
     cards (Stripe's default, up to 4 tries within a month).
   - Developers (Workbench) > API keys > Create restricted key, with the permissions above
     (subscription schedules come under Billing > Subscriptions). Then
     `wrangler secret put STRIPE_SECRET_KEY`.
   - Developers (Workbench) > Webhooks > Add destination: endpoint
     `https://songaday.studio/commission/stripe`, API version `2026-09-30.endive` (the one the
     code pins, `STRIPE_VERSION`), and these four events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `invoice.paid` and
     `customer.subscription.deleted`. Then `wrangler secret put STRIPE_WEBHOOK_SECRET` with its
     signing secret.
   - Leave Stripe Tax off: there's no sales tax.
6. **Turnstile.** Nothing new: the form uses the site's widget with `data-action="commission"`.
7. **Deploy.** `node build-production.mjs`, then `wrangler deploy`. The daily cron
   (`0 14 * * *`, 9am New York in winter) comes with it, and so does the logging setting:
   `wrangler.jsonc` keeps Workers Logs on for the Worker's own lines (routes, ids and outcomes)
   and invocation logs off, since those record every URL and buyer links carry their token.
8. **Try it live in Stripe test mode.** Set `COMMISSION_REQUESTS` to `"open"` in
   `wrangler.jsonc`, then `node build-production.mjs` and `wrangler deploy`. Requests are now
   open to everyone, so don't deliver a real request while the test keys are in: its buyer could
   pay with a test card and download.
   - Make a request, deliver it from the admin, and pay with `4242 4242 4242 4242`.
   - Pay a 3-month plan, then put its customer on a test clock: `curl
     https://api.stripe.com/v1/test_helpers/test_clocks -u <test key>: -d customer=cus_...
     -d frozen_time=<a minute from now>` (an existing customer can join a clock only if the
     account has no Billing Automations, and never with a time in the past). Advance it one
     month at a time (`.../test_clocks/<id>/advance -d frozen_time=...`). Check that the
     Checkout Session had `invoice` set, that the schedule update went through with the
     subscription's own price, that payments 2 and 3 charge the saved card, and that the
     subscription ends after the third with no credit and no extra invoice.
   - Stop a 6-month plan from the buyer's page after 2 payments, and check nothing was
     prorated or credited, and that the buyer got the "stopped" email.
   - Clean up before switching keys: cancel and archive each test request in the admin (or use
     Delete for good), so the tabs and the summary start from real requests.
   - Switch to live keys:
     1. Set step 5's live-only settings on the live account, and Smart Retries there too.
     2. Create a restricted live key with the same permissions, and `wrangler secret put
        STRIPE_SECRET_KEY`.
     3. Add a live webhook endpoint: the same URL, the same four events, API version
        `2026-09-30.endive`.
     4. `wrangler secret put STRIPE_WEBHOOK_SECRET` with the live endpoint's own signing secret
        (a live endpoint has a different `whsec_`; with the test one, every live event fails
        its signature and monthly payments 2 to N are never recorded).
     5. Disable or delete the test-mode endpoint.
     6. Make one real $200 payment and see it in the admin's Paid tab.
9. **Before opening.** Jonathan adds one line to `commission.html` about usage rights (a
   personal-use license; songs he makes public are Song A Day's, under its Creative Commons
   license) and refunds; then `node build-production.mjs` and `wrangler deploy`. Requests are
   open from step 8.
10. **Outside this repo.** Point jonathanmann.net's /personal, /themes and /business at
    `https://songaday.studio/commission` (Squarespace URL mappings), take down or repoint the
    two Bandcamp commission listings, and update `now.html` on launch day.

### Running it locally

```bash
cp .env.example .dev.vars    # then fill in Turnstile's always-pass test keys; see the comments
wrangler d1 migrations apply songaday-commissions --local
node build-production.mjs
wrangler dev --local-upstream localhost --test-scheduled
```

`.dev.vars` sets `COMMISSION_REQUESTS=open` and `SITE_ORIGIN=http://localhost:8787` (match the
port if you pass `--port`), leaves `ACCESS_TEAM_DOMAIN` empty and sets
`COMMISSION_ADMIN_LOCAL=yes`, so the admin at http://localhost:8787/commission/admin works
without Access. Don't let anyone else reach the dev server while that's set (`--ip 0.0.0.0` to
try it on a phone, or a tunnel): `--local-upstream localhost` makes every request look like
localhost, so they'd be in the admin too. Wrangler simulates the email binding: it prints each
email's From, To and Subject, saves the text and HTML under `.wrangler/tmp/email/`, and marks
them sent; the admin's Emails tab shows them. (An older wrangler that rejects the compatibility
date, like 4.111, needs `--compatibility-date` set to the newest one its error message names,
for example `--compatibility-date 2026-07-17`.)

The local database is kept under `.wrangler/state/`, per database id. After setup step 1 changes
the id, or if `/commission` says "no such table" or "no such column", run `wrangler d1
migrations apply songaday-commissions --local` again; a local database made from an older
schema can be deleted first (`rm -r .wrangler/state/v3/d1`).

To run the daily step now: `curl "http://localhost:8787/cdn-cgi/local/scheduled"` (an older
wrangler uses `wrangler dev --test-scheduled` and `/__scheduled`). Nobody gets a place-in-line
email on the day they asked, since they got their number that day, so to see one, run it as of
tomorrow morning: add `&time=` and a time in milliseconds, for example
`/__scheduled?cron=0+14+*+*+*&time=1792850400000` for 14:00 UTC on October 24, 2026.

To pay locally, put a Stripe test-mode key in `.dev.vars` and forward webhooks with the Stripe
CLI:

```bash
stripe listen --latest --forward-to localhost:8787/commission/stripe   # prints the whsec_ for .dev.vars
```

`--latest` sends events in Stripe's newest API version, which matches the code's pinned
`STRIPE_VERSION` (in `commission-config.mjs`) only until Stripe's next release. Once they
differ, set the test sandbox's default API version to `STRIPE_VERSION` (Workbench > Overview)
and drop `--latest`, or the local payloads won't match the code.

The tests cover all of this with fakes (no network): `SONGADAY_OFFLINE=1 node --test tests/*.test.mjs`.

### Left for later

A monthly plan that earns songs is planned but not built. The seam is in place: the download
and the pay options depend on `paid_at`, not the request's status, so a song paid for ahead of
delivery needs no special case; `payments.kind` has no CHECK, so a new kind needs no table
rebuild; webhooks dispatch on `metadata.plan`; and making a request is one function,
`createRequest(env, answers)`. Also not built: releasing a song as that day's Song A Day
(the admin tags it PUBLIC OK), video files beyond a link, refunds in the admin, song files over
30 MB, recording the voice memo in the browser, invoices for business buyers (Checkout's
`invoice_creation` costs a fee per invoice, so it's Jonathan's call), and a confirm-your-email
step (the flood hold covers a burst of fakes; a confirm step would cost real buyers their place
when the email lands in spam). The player streams the master file, and its download button is
only hidden (`controlslist="nodownload"`), so a determined listener can save it before paying;
a lower-bitrate preview for unpaid songs is the real fix.

## Donations

Zeffy is the default donation form, including when JavaScript or wallet detection
is unavailable. EIP-6963 announcements from recognized installed wallets switch
the donation area to the Endaoment donation deeplink. Unknown providers
must already expose an authorized account through the passive `eth_accounts`
method. Detection never requests wallet access. Wallet visitors can choose
"Donate by card or bank" to return to Zeffy for the rest of the page visit. The wallet gate
(`wallet/`) asks installed wallets to announce themselves once, and this check hears the same
announcements; `?crypto=0` keeps Zeffy too.

The footer says it plainly: gifts are tax-deductible through Fridays at The Park, and
commissions and albums are purchases from Jonathan, not gifts. (The commission pages' footer
says only that song commissions are purchases from Jonathan Mann.)

Zeffy doesn't offer Apple Pay or Google Pay inside embedded forms, and its own page
only shows them below 900px wide in Safari. So phones that can use a wallet see one
link above the form to Zeffy's own page, and nobody else does: on iPhones it carries the
official Apple Pay mark ("Donate with [Apple Pay] on Zeffy's page"); on Android Chrome it
says Google Pay in text.

The funding goals are static in `profile.html`: "First goal: $3,000 a month" above the
form, and the monthly ladder ($3,000 first goal, $20,000 the dream) in the Patronage section.

## Production

The public site is https://songaday.studio. Cloudflare Worker
`songaday-studios` serves the static production build. The `www` hostname
redirects to the main address.

To rebuild and deploy (requires Node.js and authenticated Wrangler; the first deploy after
commissions landed needs setup steps 1 and 2 in "Commissions" first):

```bash
node build-production.mjs
wrangler deploy
```

`build-production.mjs` copies the site into `dist/`, leaving out the videos. Only
`dist/` is uploaded; source and local configuration files are excluded.

The videos (`assets/video/*.mp4`) live in the R2 bucket `songaday-studio-media`, bound to the
Worker as `MEDIA`. Their URLs stay `https://songaday.studio/assets/video/…`: the Worker
answers them from R2 with byte-range (206) responses, which browsers need for seeking
and iOS Safari needs to play video at all. Static assets can't do that; they always
send the whole file. After adding or replacing a video (requires ffmpeg too):

```bash
node upload-media.mjs
```

It re-encodes videos over 25 MiB (the political-satire trailer) to about 1.3 Mbps
first, and keeps that copy in `output/media/`. Browsers cache videos for a day.

## License

Code is MIT, copyright Jonathan Mann. Media and third-party branding are separate
from the code license; see `ASSETS.md`.

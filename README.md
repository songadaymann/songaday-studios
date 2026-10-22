# Song A Day Studio

Standalone site source for Song A Day Studio (songaday.studio). This project intentionally lives
outside the Fridays at The Park app.

## Files

- `profile.html` — editable page markup
- `profile.css` — editable styles
- `profile.js` — editable page behavior and catalog stats
- `assets/` — icons, video, and other page assets
- `index.html`, `films/index.html`, `everything/index.html`, `now/index.html` — generated pages
- `build.mjs` — builds those pages from the editable files, and bakes in a snapshot of the Films
  playlist and of today's song (needs network; without it those link to YouTube until the
  Worker fills them in). `SONGADAY_OFFLINE=1` skips the snapshots, and `--out <folder>` writes
  the pages somewhere else; the tests use both.
- `projects.json`, `projects.mjs`, `validate-projects.mjs` — every place Song A Day lives, one
  row each, served at https://songaday.studio/projects.json; see "Projects" below
- `bar/v1/bar.js` — the universe bar, the strip across the top of every Song A Day site; see
  "The universe bar" below
- `everything.html` — songaday.studio/everything: every row of `projects.json`, by status
- `now.html` — songaday.studio/now: what Jonathan is doing now, dated, in his words
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

## Sections

songaday.studio is the front door for all of Song A Day, so it has a short address for each
part of it. The header links to these. Parts without their own page here yet are sent on by the
Worker with a temporary (302) redirect, so the address can point somewhere else, or become a
real page, later:

| URL | Goes to |
| --- | --- |
| `/all`, `/songs` | https://songaday.fan/explore, until the new gallery replaces gallery.songaday.world (stuck at #5852) |
| `/listen` | https://songaday.fan/challenge |
| `/suggest` | https://songaday.fan/suggestions |
| `/jamuary` | https://songaday.fan/jamuary |
| `/today` | `/#today`, today's song on the home page |
| `/year/2014` | `/#year-2014`, that year on the home page calendar (2009 to this year) |
| `/games` | https://mann.cool/ |
| `/wamp` | https://wamp.land/ |
| `/commission`, `/commissions` | https://jonathanmann.bandcamp.com/merch (the commission listings), until jonathanmann.net has a commissions page |
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
copied in `profile.html`, `films.html`, `plugins/index.html` and `fumble-page.mjs` (/everything
and /now reuse the one in `films.html`); the tests check they match.

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
· Get a song), and a Support pill to `https://songaday.studio/?from=<this site's hostname>#donate`.
On phones it folds into "#6,503 ☰ Support" with a small menu. Any site adds it with one tag;
`data-here` is the site's verb from `projects.json`, and marks its link as the current one:

```html
<script type="module" src="https://songaday.studio/bar/v1/bar.js" data-here="listen" defer></script>
```

It goes at the top of `<body>`. For no layout shift, also put `<songaday-bar></songaday-bar>`
where it should go with `songaday-bar { display: block; height: 36px; background: #000; }` in
the page's CSS, as the studio's own pages do; the bar fills that element in.

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

After editing `profile.html`, `profile.css`, `profile.js`, `films.html`, `films-page.js` or
`films.mjs`, run `node build.mjs` again. The static server will serve the refreshed page.

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
commissions and albums are purchases from Jonathan, not gifts.

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

To rebuild and deploy (requires Node.js and authenticated Wrangler):

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

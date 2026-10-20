# Song A Day Studio

Standalone site source for Song A Day Studio (songaday.studio). This project intentionally lives
outside the Fridays at The Park app.

## Files

- `profile.html` — editable page markup
- `profile.css` — editable styles
- `profile.js` — editable page behavior and catalog stats
- `assets/` — icons, video, and other page assets
- `index.html` — generated standalone page
- `build.mjs` — combines the editable files into `index.html`
- `song-day.mjs` — shared daily song-number calculation for the browser and Worker
- `plugins/index.html` — the plugin downloads page (songaday.studio/plugins), a standalone static
  page; its images are in `assets/plugins/`. Downloads come from each project's GitHub releases.
  Its site header is a copy of the one in `profile.html`; `tests/site.test.mjs` checks their section links match.
- `worker.mjs` — the Cloudflare Worker: redirects, section links, and today's song number
- `fumble.mjs`, `fumble-page.mjs`, `fumble-approve.mjs`, `migrations/` — the Fumble page
  (songaday.studio/fumble); see below

## Sections

The header links to section URLs on songaday.studio. Until a section has its own page, the
Worker sends it on with a temporary (302) redirect, so the URL can become a real page later:

| URL | Goes to |
| --- | --- |
| `/songs` | https://gallery.songaday.world/ |
| `/games` | https://mann.cool/ |
| `/films` | the YouTube channel's videos (mini-docs) |
| `/mini-docs` | `/films` |
| `/plugins/` | `plugins/index.html` |
| `/donate` | `/#donate`, the gift form on the home page |

Change a destination in `SECTION_REDIRECTS` in `worker.mjs`. When a section gets its own page,
delete its line there and add the page under `dist/` in `build-production.mjs`.

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
(Without `--local-upstream`, wrangler dev presents requests as http://songaday.studio and the
https redirect loops. An older wrangler that rejects the compatibility date also needs
`--compatibility-date` set to one it supports.)

After editing `profile.html`, `profile.css`, or `profile.js`, run
`node build.mjs` again. The static server will serve the refreshed page.

The page includes external embeds and links, so use the local HTTP server
rather than opening `index.html` directly from Finder.

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
"Donate by card or bank" to return to Zeffy for the rest of the page visit.

Zeffy doesn't offer Apple Pay or Google Pay inside embedded forms, and its own page
only shows them below 900px wide in Safari. So phones that can use a wallet see one
plain link above the form ("Use Apple Pay on Zeffy's page"), and nobody else does.

The funding figures are static in `profile.html`: the match line above the form,
and the $300,000 annual goal next to C.Y. Lee's $100,000 in the Patronage section. His contribution can
increase to $100,000 in total: after community contributions reach $62,500,
additional contributions are matched dollar for dollar, up to another $37,500.

## Production

The public site is https://songaday.studio. Cloudflare Worker
`songaday-studios` serves the static production build. The `www` hostname
redirects to the main address.

To rebuild and deploy (requires Node.js, ffmpeg, and authenticated Wrangler):

```bash
node build-production.mjs
wrangler deploy
```

`build-production.mjs` copies the site into `dist/` and compresses the large
political-satire trailer for static hosting. Original media stays in `assets/`.
Only `dist/` is uploaded; source and local configuration files are excluded.

## License

Code is MIT, copyright Jonathan Mann. Media and third-party branding are separate
from the code license; see `ASSETS.md`.

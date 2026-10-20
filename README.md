# Song A Day Studio

Standalone site source for Song A Day Studio (songaday.studio). This project intentionally lives
outside the Fridays at The Park app.

## Files

- `profile.html` — editable page markup
- `profile.css` — editable styles
- `profile.js` — editable page behavior and catalog stats
- `assets/` — icons, video, and other page assets
- `index.html`, `films/index.html` — generated pages
- `build.mjs` — builds both pages from the editable files, and bakes in a snapshot of the Films
  playlist (needs network; without it the Films page links to YouTube until the Worker fills it in)
- `song-day.mjs` — shared daily song-number calculation for the browser and Worker
- `plugins/index.html` — the plugin downloads page (songaday.studio/plugins), a standalone static
  page; its images are in `assets/plugins/`. Downloads come from each project's GitHub releases.
  Its site header is a copy of the one in `profile.html`; `tests/site.test.mjs` checks their section links match.
- `films.html`, `films-page.js`, `films.mjs` — the Films page (songaday.studio/films/): Jonathan's
  "Mini-documentaries" YouTube playlist as thumbnails that turn into players. `build.mjs` bakes in
  a snapshot of the playlist; the Worker re-reads YouTube's feed (cached for an hour), so new
  mini-docs appear without a redeploy. The feed lists up to 15 videos.
- `worker.mjs` — the Cloudflare Worker: redirects, section links, today's song number, and the
  live Films list
- `media.mjs` — serves the site videos from R2 with byte ranges, so they can seek and play on iPhones
- `upload-media.mjs` — uploads `assets/video/` to the R2 bucket

## Sections

The header links to section URLs on songaday.studio. Sections without their own page yet are
sent on by the Worker with a temporary (302) redirect, so the URL can become a real page later:

| URL | Goes to |
| --- | --- |
| `/songs` | https://gallery.songaday.world/ |
| `/games` | https://mann.cool/ |
| `/films/` | `films/index.html`, built from `films.html` |
| `/mini-docs` | `/films/` |
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
Under `wrangler dev` the videos come from a local copy of the R2 bucket; fill it once with
`node upload-media.mjs --local`.
(Without `--local-upstream`, wrangler dev presents requests as http://songaday.studio and the
https redirect loops. An older wrangler that rejects the compatibility date also needs
`--compatibility-date` set to one it supports.)

After editing `profile.html`, `profile.css`, `profile.js`, `films.html`, `films-page.js` or
`films.mjs`, run `node build.mjs` again. The static server will serve the refreshed page.

The page includes external embeds and links, so use the local HTTP server
rather than opening `index.html` directly from Finder.

## Donations

Zeffy is the default donation form, including when JavaScript or wallet detection
is unavailable. EIP-6963 announcements from recognized installed wallets switch
the donation area to the Endaoment donation deeplink. Unknown providers
must already expose an authorized account through the passive `eth_accounts`
method. Detection never requests wallet access. Wallet visitors can choose
"Donate by card or bank" to return to Zeffy for the rest of the page visit.

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

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

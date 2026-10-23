import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { songADayNumber } from "./song-day.mjs";
import { FILMS_FALLBACK, FILMS_FEED_URL, FILMS_PLAYLIST_URL, parseFeed, renderFilms } from "./films.mjs";
import { SONGS_FEED_URL, TODAY_SONG_FALLBACK, latestSong, renderTodaySong } from "./today-song.mjs";
import { renderCalendar } from "./calendar.mjs";
import { renderDirectory, renderEverything, validateProjects } from "./projects.mjs";
import { LIMITS, MEMO_MAX_BYTES, PLAN_MONTHS, PRICES, VIDEO_PRICE_CENTS } from "./commission-config.mjs";

const projectRoot = path.resolve(import.meta.dirname);
// `node build.mjs --out <folder>` writes the pages there instead of next to the sources, and
// SONGADAY_OFFLINE=1 skips the YouTube snapshots (the tests use both).
const outFlag = process.argv.indexOf("--out");
const outRoot = outFlag > 0 ? path.resolve(process.argv[outFlag + 1]) : projectRoot;
const offline = process.env.SONGADAY_OFFLINE === "1";
const source = (name) => readFile(path.join(projectRoot, name), "utf8");
const [htmlSource, filmsSource, css, jsSource, filmsJs, calendarJson, projectsJson, nowSource, everythingSource, walletDetect, walletGate,
  commissionSource, commissionCss, commissionJs] = await Promise.all([
  source("profile.html"),
  source("films.html"),
  source("profile.css"),
  source("profile.js"),
  source("films-page.js"),
  source("calendar.json"),
  source("projects.json"),
  source("now.html"),
  source("everything.html"),
  source("wallet/wallet-detect.js"),
  source("wallet/wallet-gate.js"),
  source("commission.html"),
  source("commission.css"),
  source("commission-page.js"),
]);

const projects = JSON.parse(projectsJson);
const problems = validateProjects(projects);
if (problems.length) {
  throw new Error(`projects.json has problems:\n${problems.join("\n")}\nRun node validate-projects.mjs to check it.`);
}

// The crypto-wallet-gate skill's two modules as plain script, each in its own scope.
const scriptOf = (module, name) => `const { ${name} } = (() => {
${module.replace(/^import .*$/m, "").replaceAll(/^export /gm, "")}
return { ${name} };
})();`;
const walletGateScript = `${scriptOf(walletDetect, "detectWallet")}
${scriptOf(walletGate, "applyWalletGate")}`;
const hasLocalAssets = existsSync(path.join(projectRoot, "assets"));

// A snapshot of the newest song on YouTube; the Worker refreshes it from the live feed.
async function todaySongSnapshot() {
  if (offline) return TODAY_SONG_FALLBACK;
  try {
    const response = await fetch(SONGS_FEED_URL, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`feed answered ${response.status}`);
    const song = latestSong(await response.text());
    if (!song) throw new Error("feed had no songs");
    return renderTodaySong(song);
  } catch (error) {
    console.warn(`Today's song snapshot skipped (${error.message}); the page links to YouTube until the Worker fills it in.`);
    return TODAY_SONG_FALLBACK;
  }
}

const number = songADayNumber();
const todaySong = await todaySongSnapshot();
// Function replacements, so a "$" in a song title isn't read as a replacement pattern.
let html = htmlSource.replaceAll("{{SONG_NUMBER}}", String(number))
  .replaceAll("{{NEXT_SONG_NUMBER}}", String(number + 1))
  .replaceAll("{{SONG_COUNT}}", number.toLocaleString("en-US"))
  .replace("{{TODAY_SONG}}", () => todaySong)
  .replace("{{CALENDAR}}", () => renderCalendar(JSON.parse(calendarJson)))
  .replace("{{DIRECTORY}}", () => renderDirectory(projects));
// Public checkouts use hosted media when the private local asset bundle is absent.
if (!hasLocalAssets) {
  html = html.replaceAll(/\b(src|poster|data-video-src)="assets\//g,
    '$1="https://songaday.studio/assets/')
    .replaceAll(/\bsrcset="([^"]*)"/g, (match, list) =>
      `srcset="${list.replaceAll(/(^|,\s*)assets\//g, "$1https://songaday.studio/assets/")}"`);
}
const js = jsSource.replace("/* SONG_DAY_NUMBER_HELPER */",
  `const songADayNumber = ${songADayNumber.toString()};`)
  .replace("/* WALLET_GATE_HELPER */", () => walletGateScript);

// A snapshot of the mini-docs playlist; the Worker refreshes it from the live feed.
async function filmsSnapshot() {
  if (offline) return FILMS_FALLBACK;
  try {
    const response = await fetch(FILMS_FEED_URL, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`feed answered ${response.status}`);
    const films = parseFeed(await response.text());
    if (!films.length) throw new Error("feed had no videos");
    return renderFilms(films);
  } catch (error) {
    console.warn(`Films snapshot skipped (${error.message}); the page links to YouTube until the Worker fills it in.`);
    return FILMS_FALLBACK;
  }
}

const DEFAULT_CSP = "default-src 'none'; img-src https: http: data: blob:; media-src 'self' https: http: data: blob:; style-src 'unsafe-inline' https:; font-src https: http: data:; script-src 'self' 'unsafe-inline' https:; frame-src https:; connect-src 'self' https:;";
// An inline script as it goes into the page, so its CSP hash is of exactly these characters.
const inlineScript = (script) => script.replaceAll("</script", "<\\/script");

function documentHtml({ title, description, ogDescription = description, url, body, script, csp = DEFAULT_CSP, extraCss = "", robots = null }) {
  const og = url ? `
  <meta name="description" content="${description}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:url" content="${url}">` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">${robots ? `
  <meta name="robots" content="${robots}">` : ""}
  <title>${title}</title>${og}
  <style>html,body{margin:0;min-height:100%;}${css}${extraCss}</style>
</head>
<body>
${body}
${script ? `<script>${inlineScript(script)}</script>\n` : ""}</body>
</html>
`;
}

async function writePage(page, html) {
  await mkdir(path.dirname(path.join(outRoot, page)), { recursive: true });
  await writeFile(path.join(outRoot, page), html);
}

await writePage("index.html", documentHtml({
  title: "Song A Day Studio",
  description: "Jonathan Mann has written a song every day since January 1, 2009. Help him write tomorrow's. Songs, games, films and free music software from Song A Day Studio.",
  ogDescription: "Jonathan Mann has written a song every day since January 1, 2009. Help him write tomorrow's.",
  url: "https://songaday.studio/",
  body: html,
  script: js,
}));

// A function replacement, so a "$" in a film title isn't read as a replacement pattern.
const snapshot = await filmsSnapshot();
const filmsBody = filmsSource.replace("{{FILMS}}", () => snapshot)
  .replaceAll("{{FILMS_PLAYLIST_URL}}", FILMS_PLAYLIST_URL);
const hostedMedia = (body) => hasLocalAssets ? body
  : body.replaceAll(/\bsrc="\/assets\//g, 'src="https://songaday.studio/assets/');
await writePage("films/index.html", documentHtml({
  title: "Films · Song A Day Studio",
  description: "Mini-docs by Jonathan Mann about making something every day.",
  url: "https://songaday.studio/films/",
  body: hostedMedia(filmsBody),
  script: filmsJs,
}));

// /everything and /now share the Films page's header and footer.
const header = filmsSource.match(/  <header class="site-header">[\s\S]*?<\/header>/)[0].replace(' aria-current="page"', "");
const footer = filmsSource.match(/  <footer>[\s\S]*?<\/footer>/)[0];
// The commission pages are purchases from Jonathan, so they say nothing about donating: no
// Donate button or footer link, and a purchase line in place of the fiscal sponsor's.
const purchaseHeader = header.replace(/\n\s*<a class="nav-donate"[^>]*>[^<]*<\/a>/, "")
  .replace('<a href="/commission">', '<a href="/commission" aria-current="page">');
const purchaseFooter = footer.replace(/\n\s*<a href="\/#donate">Donate<\/a>/, "")
  .replace(/<p class="sponsor-line">[\s\S]*?<\/p>/, '<p class="sponsor-line">Song commissions are purchases from Jonathan Mann.</p>');
const withChrome = (page, { purchase = false } = {}) => page
  .replace("{{HEADER}}", () => purchase ? purchaseHeader : header)
  .replace("{{FOOTER}}", () => purchase ? purchaseFooter : footer);

await writePage("everything/index.html", documentHtml({
  title: "Everything · Song A Day Studio",
  description: "Every place Song A Day lives: songs, games, plugins, films, and what's coming next.",
  url: "https://songaday.studio/everything/",
  body: hostedMedia(withChrome(everythingSource).replace("{{EVERYTHING}}", () => renderEverything(projects))),
  script: `(() => {\n  "use strict";\n${walletGateScript}\n  applyWalletGate();\n})();`,
}));

await writePage("now/index.html", documentHtml({
  title: "Now · Song A Day Studio",
  description: "What Jonathan Mann is doing now, October 2026.",
  url: "https://songaday.studio/now/",
  body: hostedMedia(withChrome(nowSource).replaceAll("{{SONG_COUNT}}", number.toLocaleString("en-US"))),
}));

// songaday.studio/commission: the page and request form, and the shell the Worker puts each
// buyer's private song page into (commission.mjs). The prices and limits come from
// commission-config.mjs, the same values the Worker checks. The Worker fills the
// <!--commission:...--> slots and the Turnstile site key at request time.
const money = (cents) => "$" + (cents / 100).toLocaleString("en-US");
const listed = (items) => items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items.at(-1)}` : items.join("");
const personal = PRICES.personal.suggested.map(money);
const commissionTokens = {
  PERSONAL_FROM: money(PRICES.personal.floor),
  PERSONAL_SUGGESTED: `${personal.slice(0, -1).join(", ")}, or ${personal.at(-1)} or more`,
  BUSINESS_FROM: money(PRICES.business.floor),
  PLAN_MONTHS: listed(PLAN_MONTHS.map(String)),
  VIDEO_LINE: VIDEO_PRICE_CENTS ? `A music video adds ${money(VIDEO_PRICE_CENTS)}.` : "A music video: tick the box and I’ll be in touch about it.",
  MEMO_MAX_BYTES: String(MEMO_MAX_BYTES),
  MEMO_MB: String(Math.round(MEMO_MAX_BYTES / 1024 / 1024)),
  ...Object.fromEntries(Object.entries(LIMITS).map(([name, value]) => [`LIMIT_${name}`, String(value)])),
};
const commissionBody = withChrome(commissionSource, { purchase: true })
  .replaceAll(/\{\{([A-Za-z_]+)\}\}/g, (match, name) => {
    if (!(name in commissionTokens)) throw new Error(`commission.html has an unknown {{${name}}}.`);
    return commissionTokens[name];
  });
const commissionHash = createHash("sha256").update(inlineScript(commissionJs), "utf8").digest("base64");
// No 'unsafe-inline': the one inline script runs by its hash. form-action lists Stripe because
// Chrome applies it to the redirect after the pay form posts.
const commissionCsp = `default-src 'none'; img-src 'self' https: data:; media-src 'self'; style-src 'unsafe-inline' https:; font-src https: data:; script-src 'sha256-${commissionHash}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; form-action 'self' https://checkout.stripe.com; base-uri 'none'`;
await writePage("commission/index.html", documentHtml({
  title: "Get a song · Song A Day Studio",
  description: "Jonathan Mann has written a song every day since 2009. He’ll write one for you. Pay what you want when it’s done.",
  url: "https://songaday.studio/commission",
  body: hostedMedia(commissionBody),
  script: commissionJs,
  csp: commissionCsp,
  extraCss: commissionCss,
}));
await writePage("commission/song.html", documentHtml({
  title: "Song A Day Studio",
  body: hostedMedia(withChrome(`<div class="labs-page text-page commission-page" id="top">
  <a class="skip-link" href="#main">Skip to content</a>

{{HEADER}}

  <main id="main" tabindex="-1"><!--commission:song--></main>

{{FOOTER}}
</div>`, { purchase: true })),
  script: commissionJs,
  csp: commissionCsp,
  extraCss: commissionCss,
  robots: "noindex",
}));

// The data lab (songaday.studio/data/). data-lab/lab.html is a self-contained page with its own
// title, styles and script, which reads lab.json (data-lab/lab.json, exported by songaday-data's
// web/export.py). The same file is published on its own for review, so here it only gets a
// document around it, with the eyebrow linking back to the studio's home page.
const lab = await readFile(path.join(projectRoot, "data-lab", "lab.html"), "utf8");
const labTitle = lab.match(/<title>([\s\S]*?)<\/title>/)[1];
const labStyle = lab.match(/<style>[\s\S]*?<\/style>/)[0];
const eyebrow = '<p class="eyebrow">Song A Day · Data lab</p>';
if (!lab.includes(eyebrow)) throw new Error("data-lab/lab.html's eyebrow changed; update the link to the studio in build.mjs.");
const labBody = lab.replace(/<title>[\s\S]*?<\/title>\s*/, "")
  .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\s*/, "")
  .replace(labStyle, () => "")
  .replace(eyebrow, '<p class="eyebrow"><a href="/">Song A Day Studio</a> · Data lab</p>');
await writePage("data/index.html", `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline' https:; connect-src 'self' https:;">
  <title>${labTitle}</title>
  <meta name="description" content="Every Song A Day song since 2009 next to the weather, the moon, the planets, the news and its views, and what held up.">
  <meta property="og:title" content="${labTitle}">
  <meta property="og:url" content="https://songaday.studio/data/">
  ${labStyle}
  <style>.eyebrow a{color:inherit;text-decoration:none}.eyebrow a:hover,.eyebrow a:focus-visible{text-decoration:underline}</style>
</head>
<body>
${labBody}
</body>
</html>
`);
console.log(`Built Song A Day Studio index.html, films/, everything/, now/, data/ and commission/${outRoot === projectRoot ? "" : ` in ${outRoot}`}`);

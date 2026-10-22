import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { songADayNumber } from "./song-day.mjs";
import { FILMS_FALLBACK, FILMS_FEED_URL, FILMS_PLAYLIST_URL, parseFeed, renderFilms } from "./films.mjs";
import { SONGS_FEED_URL, TODAY_SONG_FALLBACK, latestSong, renderTodaySong } from "./today-song.mjs";
import { renderCalendar } from "./calendar.mjs";
import { renderDirectory, renderEverything, validateProjects } from "./projects.mjs";

const projectRoot = path.resolve(import.meta.dirname);
// `node build.mjs --out <folder>` writes the pages there instead of next to the sources, and
// SONGADAY_OFFLINE=1 skips the YouTube snapshots (the tests use both).
const outFlag = process.argv.indexOf("--out");
const outRoot = outFlag > 0 ? path.resolve(process.argv[outFlag + 1]) : projectRoot;
const offline = process.env.SONGADAY_OFFLINE === "1";
const source = (name) => readFile(path.join(projectRoot, name), "utf8");
const [htmlSource, filmsSource, css, jsSource, filmsJs, calendarJson, projectsJson, nowSource, everythingSource, walletDetect, walletGate] = await Promise.all([
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

function documentHtml({ title, description, ogDescription = description, url, body, script }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: blob:; media-src 'self' https: http: data: blob:; style-src 'unsafe-inline' https:; font-src https: http: data:; script-src 'self' 'unsafe-inline' https:; frame-src https:; connect-src 'self' https:;">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:url" content="${url}">
  <style>html,body{margin:0;min-height:100%;}${css}</style>
</head>
<body>
${body}
${script ? `<script>${script.replaceAll("</script", "<\\/script")}</script>\n` : ""}</body>
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
const withChrome = (page) => page.replace("{{HEADER}}", () => header).replace("{{FOOTER}}", () => footer);

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

// The data lab (songaday.studio/data/). data/lab.html is a self-contained page with its own
// title, styles and script, which reads data/lab.json (exported by songaday-data's
// web/export.py). The same file is published on its own for review, so here it only gets a
// document around it and the bar on top.
const lab = await readFile(path.join(projectRoot, "data", "lab.html"), "utf8");
const labTitle = lab.match(/<title>([\s\S]*?)<\/title>/)[1];
const labStyle = lab.match(/<style>[\s\S]*?<\/style>/)[0];
const labBody = lab.replace(/<title>[\s\S]*?<\/title>\s*/, "")
  .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\s*/, "")
  .replace(labStyle, () => "");
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
  <style>body{padding-top:0}songaday-bar{display:block;height:36px;margin:0 calc(-1 * max(16px, env(safe-area-inset-right, 0px))) 40px calc(-1 * max(16px, env(safe-area-inset-left, 0px)))}</style>
</head>
<body>
<songaday-bar data-here="see"></songaday-bar>
<script type="module" src="/bar/v1/bar.js" data-here="see"></script>
${labBody}
</body>
</html>
`);
console.log(`Built Song A Day Studio index.html, films/, everything/ and now/${outRoot === projectRoot ? "" : ` in ${outRoot}`}`);

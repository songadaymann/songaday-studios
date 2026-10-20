import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { songADayNumber } from "./song-day.mjs";
import { FILMS_FALLBACK, FILMS_FEED_URL, FILMS_PLAYLIST_URL, parseFeed, renderFilms } from "./films.mjs";

const projectRoot = path.resolve(import.meta.dirname);
const [htmlSource, filmsSource, css, jsSource, filmsJs] = await Promise.all([
  readFile(path.join(projectRoot, "profile.html"), "utf8"),
  readFile(path.join(projectRoot, "films.html"), "utf8"),
  readFile(path.join(projectRoot, "profile.css"), "utf8"),
  readFile(path.join(projectRoot, "profile.js"), "utf8"),
  readFile(path.join(projectRoot, "films-page.js"), "utf8"),
]);

const number = songADayNumber();
let html = htmlSource.replaceAll("{{SONG_NUMBER}}", String(number))
  .replaceAll("{{NEXT_SONG_NUMBER}}", String(number + 1))
  .replaceAll("{{SONG_COUNT}}", number.toLocaleString("en-US"));
// Public checkouts use hosted media when the private local asset bundle is absent.
if (!existsSync(path.join(projectRoot, "assets"))) {
  html = html.replaceAll(/\b(src|poster|data-video-src)="assets\//g,
    '$1="https://songaday.studio/assets/');
}
const js = jsSource.replace("/* SONG_DAY_NUMBER_HELPER */",
  `const songADayNumber = ${songADayNumber.toString()};`);

// A snapshot of the mini-docs playlist; the Worker refreshes it from the live feed.
async function filmsSnapshot() {
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: blob:; media-src 'self' https: http: data: blob:; style-src 'unsafe-inline' https:; font-src https: http: data:; script-src 'unsafe-inline' https:; frame-src https:; connect-src https:;">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:url" content="${url}">
  <style>html,body{margin:0;min-height:100%;}${css}</style>
</head>
<body>
${body}
<script>${script.replaceAll("</script", "<\\/script")}</script>
</body>
</html>
`;
}

await writeFile(path.join(projectRoot, "index.html"), documentHtml({
  title: "Song A Day Studio",
  description: "Jonathan Mann has written a song every day since January 1, 2009. Help him write tomorrow's. Songs, games, films and free music software from Song A Day Studio.",
  ogDescription: "Jonathan Mann has written a song every day since January 1, 2009. Help him write tomorrow's.",
  url: "https://songaday.studio/",
  body: html,
  script: js,
}));

// A function replacement, so a "$" in a film title isn't read as a replacement pattern.
const snapshot = await filmsSnapshot();
let filmsBody = filmsSource.replace("{{FILMS}}", () => snapshot)
  .replaceAll("{{FILMS_PLAYLIST_URL}}", FILMS_PLAYLIST_URL);
if (!existsSync(path.join(projectRoot, "assets"))) {
  filmsBody = filmsBody.replaceAll(/\bsrc="\/assets\//g, 'src="https://songaday.studio/assets/');
}
await mkdir(path.join(projectRoot, "films"), { recursive: true });
await writeFile(path.join(projectRoot, "films", "index.html"), documentHtml({
  title: "Films · Song A Day Studio",
  description: "Mini-docs by Jonathan Mann about making something every day.",
  url: "https://songaday.studio/films/",
  body: filmsBody,
  script: filmsJs,
}));
console.log("Built Song A Day Studio index.html and films/index.html");

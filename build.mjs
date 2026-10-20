import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { songADayNumber } from "./song-day.mjs";

const projectRoot = path.resolve(import.meta.dirname);
const [htmlSource, css, jsSource] = await Promise.all([
  readFile(path.join(projectRoot, "profile.html"), "utf8"),
  readFile(path.join(projectRoot, "profile.css"), "utf8"),
  readFile(path.join(projectRoot, "profile.js"), "utf8"),
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

const documentHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: blob:; media-src 'self' https: http: data: blob:; style-src 'unsafe-inline' https:; font-src https: http: data:; script-src 'unsafe-inline' https:; frame-src https:; connect-src https:;">
  <title>Song A Day Studio</title>
  <meta name="description" content="Jonathan Mann has written a song every day since January 1, 2009. Help him write tomorrow's. Songs, games, films and free music software from Song A Day Studio.">
  <meta property="og:title" content="Song A Day Studio">
  <meta property="og:description" content="Jonathan Mann has written a song every day since January 1, 2009. Help him write tomorrow's.">
  <meta property="og:url" content="https://songaday.studio/">
  <style>html,body{margin:0;min-height:100%;}${css}</style>
</head>
<body>
${html}
<script>${js.replaceAll("</script", "<\\/script")}</script>
</body>
</html>
`;

await mkdir(projectRoot, { recursive: true });
await writeFile(path.join(projectRoot, "index.html"), documentHtml);
console.log("Built Song A Day Studio index.html");

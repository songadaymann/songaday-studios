// Refreshes store/albums.json, the store's Music shelf, from Jonathan's Bandcamp page.
//
//   node update-albums.mjs music.html   # a copy of https://jonathanmann.bandcamp.com/music
//   node update-albums.mjs              # asks Bandcamp for the page itself
//
// Bandcamp often answers scripts with a "checking your browser" page in place of the music
// page. When it does, open the page in a browser, save it (File > Save Page As, "Page Source"
// or "HTML only") and pass that file.
//
// Then node build-production.mjs and wrangler deploy. It refuses to write a list that has
// problems, or one that lost more than half its releases (pass --allow-shrink when releases
// were taken down on purpose).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BANDCAMP_MUSIC_URL, albumProblems, parseBandcampMusic, shelveAlbums } from './store-albums.mjs';

const root = import.meta.dirname;
const snapshotFile = path.join(root, 'store', 'albums.json');
const args = process.argv.slice(2);
const [file] = args.filter((arg) => !arg.startsWith('--'));

async function musicPage() {
  if (file) return readFile(path.resolve(file), 'utf8');
  const response = await fetch(BANDCAMP_MUSIC_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; site-build)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Bandcamp answered ${response.status}.`);
  return response.text();
}

function refuse(message) {
  console.error(`${message} store/albums.json is unchanged.`);
  process.exit(1);
}

const releases = parseBandcampMusic(await musicPage());
if (!releases.length && !file) {
  refuse(`Bandcamp didn't send the music page. Save ${BANDCAMP_MUSIC_URL} from a browser and run: node update-albums.mjs <that file>.`);
}
const problems = albumProblems(releases);
if (problems.length) refuse(problems.join('\n'));

const before = await readFile(snapshotFile, 'utf8').then(JSON.parse, () => []);
if (releases.length * 2 < before.length && !args.includes('--allow-shrink')) {
  refuse(`Bandcamp lists ${releases.length} releases and the snapshot has ${before.length}.`);
}
await writeFile(snapshotFile, JSON.stringify(releases, null, 2) + '\n');
const { years, more } = shelveAlbums(releases);
console.log(`store/albums.json: ${years.length} year albums and ${more.length} other releases.`);

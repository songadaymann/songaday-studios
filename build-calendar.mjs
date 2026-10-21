// Makes the home page's year calendar from the Song A Day stills: assets/calendar/<year>.webp
// and <year>-2x.webp (retina), plus calendar.json (tracked) with each year's song count and home.
// Needs ffmpeg and the 480×270 stills songaday-display builds, one <number>.webp per song:
//
//   node build-calendar.mjs ~/Library/Caches/songaday-display/publish/stills
//
// (or set STILLS_DIR). Then `node build-production.mjs` and `wrangler deploy`. Run it again
// whenever the current year's image should catch up with the latest songs.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CELL, songDate, songNumberFor, yearImageSize } from './calendar.mjs';

const root = import.meta.dirname;
const stillsDir = process.argv[2] || process.env.STILLS_DIR;
if (!stillsDir || !existsSync(stillsDir)) {
  console.error('Usage: node build-calendar.mjs <stills folder>  (or set STILLS_DIR; see .env.example)');
  process.exit(1);
}

// Where most of each year's songs were recorded, by the catalog's Location field. 2020 was the
// move. Years after the table use LATEST_HOME.
const HOMES = {
  2009: 'Berkeley', 2010: 'Berkeley', 2011: 'Berkeley',
  2012: 'Brooklyn', 2013: 'Brooklyn', 2014: 'Brooklyn',
  2015: 'Jersey City', 2016: 'Jersey City', 2017: 'Jersey City', 2018: 'Jersey City', 2019: 'Jersey City',
  2020: 'Jersey City, Hartford'
};
const LATEST_HOME = 'Hartford';
// Days without a still yet (the rest of this year, or a missing file): faint white on the dark page.
const EMPTY = [255, 255, 255, 36];

const numbers = (await readdir(stillsDir))
  .map((name) => /^(\d+)\.webp$/.exec(name)?.[1])
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);
if (!numbers.length) {
  console.error(`No <number>.webp stills in ${stillsDir}`);
  process.exit(1);
}
const through = numbers.at(-1);
const missing = through - numbers.length;
if (missing) console.warn(`${missing} songs up to #${through} have no still; their days stay empty.`);

function run(args, input) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-v', 'error', ...args], { stdio: ['pipe', 'pipe', 'inherit'] });
    const chunks = [];
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited with ${code}`)));
    ffmpeg.stdin.end(input);
  });
}

// One ffmpeg pass shrinks every still to a 2x cell, as raw RGBA frames in song order.
const big = { width: CELL.width * 2, height: CELL.height * 2 };
const frameBytes = big.width * big.height * 4;
const work = await mkdtemp(path.join(tmpdir(), 'songaday-calendar-'));
let frames;
try {
  const list = numbers.map((number) => `file '${path.resolve(stillsDir, `${number}.webp`).replaceAll("'", "'\\''")}'\nduration 1`).join('\n');
  await writeFile(path.join(work, 'stills.txt'), list + '\n');
  frames = await run(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'stills.txt'),
    '-vf', `scale=${big.width}:${big.height}:flags=area`, '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
} finally {
  await rm(work, { recursive: true, force: true });
}
if (frames.length !== numbers.length * frameBytes) {
  throw new Error(`Expected ${numbers.length} frames from ffmpeg, got ${frames.length / frameBytes}`);
}
const frameOf = new Map(numbers.map((number, index) => [number, index]));

function drawYear(year, scale) {
  const { width, height } = yearImageSize(scale);
  const cell = { width: CELL.width * scale, height: CELL.height * scale, gap: CELL.gap * scale };
  const image = Buffer.alloc(width * height * 4);
  let songs = 0;
  for (let month = 0; month < 12; month++) {
    for (let day = 1; day <= 31; day++) {
      const number = songNumberFor(year, month, day);
      if (!number) continue;
      const left = (day - 1) * (cell.width + cell.gap);
      const top = month * (cell.height + cell.gap);
      const frame = frameOf.get(number);
      if (frame !== undefined) songs++;
      for (let y = 0; y < cell.height; y++) {
        for (let x = 0; x < cell.width; x++) {
          const out = ((top + y) * width + left + x) * 4;
          if (frame === undefined) {
            image.set(EMPTY, out);
          } else if (scale === 2) {
            frames.copy(image, out, frame * frameBytes + (y * big.width + x) * 4, frame * frameBytes + (y * big.width + x) * 4 + 4);
          } else {
            // 1x: average the 2 × 2 block of the 2x cell.
            for (let channel = 0; channel < 4; channel++) {
              let sum = 0;
              for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                sum += frames[frame * frameBytes + ((y * 2 + dy) * big.width + x * 2 + dx) * 4 + channel];
              }
              image[out + channel] = Math.round(sum / 4);
            }
          }
        }
      }
    }
  }
  return { image, width, height, songs };
}

const outDir = path.join(root, 'assets', 'calendar');
await mkdir(outDir, { recursive: true });
const lastYear = songDate(through).getUTCFullYear();
const years = [];
for (let year = 2009; year <= lastYear; year++) {
  let songs = 0;
  // The 2x cells are tiny on screen, so they take more compression.
  for (const [scale, suffix, quality] of [[1, '', 80], [2, '-2x', 60]]) {
    const drawn = drawYear(year, scale);
    songs = drawn.songs;
    const webp = await run(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${drawn.width}x${drawn.height}`, '-i', '-',
      '-frames:v', '1', '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', String(quality), '-compression_level', '6',
      '-f', 'webp', '-'], drawn.image);
    await writeFile(path.join(outDir, `${year}${suffix}.webp`), webp);
  }
  years.push({ year, songs, home: HOMES[year] ?? LATEST_HOME });
}

await writeFile(path.join(root, 'calendar.json'), JSON.stringify({ through, years }, null, 2) + '\n');
console.log(`Built the calendar through #${through}: ${years.length} years in ${path.relative(root, outDir)}/ and calendar.json`);

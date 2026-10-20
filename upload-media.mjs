// Uploads the site videos in assets/video/ to the R2 bucket the Worker serves them from.
//   node upload-media.mjs            to Cloudflare (needs authenticated Wrangler)
//   node upload-media.mjs --local    to the local bucket `wrangler dev` uses
//   node upload-media.mjs --dry-run  list what would be uploaded
import { mkdir, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { MEDIA_BUCKET, MEDIA_PATH, mediaContentType } from './media.mjs';

const root = import.meta.dirname;
process.chdir(root);
const local = process.argv.includes('--local');
const dryRun = process.argv.includes('--dry-run');
// Videos larger than this (the political-satire trailer) are re-encoded at about 1.3 Mbps
// so they stream well on phones. The re-encode is kept in output/media/ between runs.
const REENCODE_OVER = 25 * 1024 * 1024;

const mtime = async (file) => (await stat(file).catch(() => null))?.mtimeMs ?? 0;

const names = (await readdir('assets/video')).filter((name) => MEDIA_PATH.test(`/assets/video/${name}`)).sort();
if (!names.length) throw new Error('No videos found in assets/video/');

for (const name of names) {
  let file = path.join('assets/video', name);
  if ((await stat(file)).size > REENCODE_OVER) {
    const encoded = path.join('output/media/video', name);
    if (!dryRun && (await mtime(encoded)) < (await mtime(file))) {
      await mkdir(path.dirname(encoded), { recursive: true });
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '26', '-maxrate', '1300k', '-bufsize', '2600k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', encoded], { stdio: 'inherit' });
    }
    file = encoded;
  }
  const object = `${MEDIA_BUCKET}/video/${name}`;
  console.log(`${dryRun ? 'Would upload' : 'Uploading'} ${file} to ${object}${local ? ' (local)' : ''}`);
  if (dryRun) continue;
  execFileSync('wrangler', ['r2', 'object', 'put', object, '--file', file, '--content-type', mediaContentType(name), local ? '--local' : '--remote'], { stdio: 'inherit' });
}

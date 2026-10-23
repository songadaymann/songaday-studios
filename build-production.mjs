import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { MEDIA_PATH } from './media.mjs';
const root = import.meta.dirname;
process.chdir(root);
execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('index.html', 'dist/index.html');
// Films page (songaday.studio/films/), built by build.mjs from films.html, and /everything and
// /now, built from projects.json and now.html.
await cp('films/index.html', 'dist/films/index.html');
await cp('everything/index.html', 'dist/everything/index.html');
await cp('now/index.html', 'dist/now/index.html');
// songaday.studio/commission: the page, and the shell for each buyer's song page (the Worker
// fills both; commission.mjs).
await cp('commission/index.html', 'dist/commission/index.html');
await cp('commission/song.html', 'dist/commission/song.html');
// The data lab: its built page and the data it reads.
await cp('data/index.html', 'dist/data/index.html');
await cp('data-lab/lab.json', 'dist/data/lab.json');
// The universe bar and the list it reads, for every Song A Day site (the Worker adds CORS).
await cp('bar', 'dist/bar', { recursive: true, filter: (source) => !source.endsWith('.DS_Store') });
await cp('projects.json', 'dist/projects.json');
// Plugin downloads page: a static page of its own (songaday.studio/plugins).
await cp('plugins', 'dist/plugins', { recursive: true, filter: (source) => !source.endsWith('.DS_Store') });
// Bio link page (songaday.studio/links), also static; the Worker fills in today's song.
await cp('links', 'dist/links', { recursive: true, filter: (source) => !source.endsWith('.DS_Store') });
if (existsSync('assets')) {
  // Videos are served from R2 (node upload-media.mjs), so they stay out of dist/.
  const isVideo = (source) => MEDIA_PATH.test('/' + source.split(path.sep).join('/'));
  await cp('assets', 'dist/assets', { recursive: true, dereference: true, filter: (source) => !source.endsWith('.DS_Store') && !source.endsWith('.md') && !isVideo(source) });
}
console.log('Production files ready in dist/');

await writeFile('dist/.assetsignore', '**/.DS_Store\n**/*.md\n');

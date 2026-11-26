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
// Films page (songaday.studio/films/), built by build.mjs from films.html, /everything and
// /now, built from projects.json and now.html, and /story, built from story.html.
await cp('films/index.html', 'dist/films/index.html');
await cp('everything/index.html', 'dist/everything/index.html');
await cp('now/index.html', 'dist/now/index.html');
await cp('story/index.html', 'dist/story/index.html');
// The patrons page, built by build.mjs from patrons.json.
await cp('patrons/index.html', 'dist/patrons/index.html');
// The Conference Troubadour page, built by build.mjs from conference-troubadour.html.
await cp('conference-troubadour/index.html', 'dist/conference-troubadour/index.html');
// The business page, built by build.mjs from business.html.
await cp('business/index.html', 'dist/business/index.html');
await cp('gallery/studio-header.txt', 'dist/gallery/studio-header.txt');
await cp('gallery/studio.css', 'dist/gallery/studio.css');
await cp('store', 'dist/store', { recursive: true });
// songaday.studio/commission: the page, and the shell for each buyer's song page (the Worker
// fills both; commission.mjs).
await cp('commission/index.html', 'dist/commission/index.html');
await cp('commission/song.html', 'dist/commission/song.html');
// The data lab: its built page and the data it reads.
await cp('data/index.html', 'dist/data/index.html');
await cp('data-lab/lab.json', 'dist/data/lab.json');
await cp('data-lab/lab-extra.json', 'dist/data/lab-extra.json');
// One face per month for the beard slider (data-lab/make-faces.py). The page works without them.
if (existsSync('data-lab/faces/index.json')) await cp('data-lab/faces', 'dist/data/faces', { recursive: true });
// The press page, built by build.mjs from press/press.json; the Worker can swap in the live sheet.
await cp('press/index.html', 'dist/press/index.html');
// The universe bar and the list it reads, for every Song A Day site (the Worker adds CORS).
await cp('bar', 'dist/bar', { recursive: true, filter: (source) => !source.endsWith('.DS_Store') });
await cp('projects.json', 'dist/projects.json');
// Plugin downloads page: a static page of its own (songaday.studio/plugins).
await cp('plugins', 'dist/plugins', { recursive: true, filter: (source) => !source.endsWith('.DS_Store') });
// songaday.studio/node: the video for the NODE WHATIF residency application, a standalone page
// that nothing links to. Its font is Press Start 2P (SIL Open Font License; node/README.md).
await cp('node', 'dist/node', { recursive: true, filter: (source) => !source.endsWith('.DS_Store') && !source.endsWith('.md') });
// Bio link page (songaday.studio/links), also static; the Worker fills in today's song.
await cp('links', 'dist/links', { recursive: true, filter: (source) => !source.endsWith('.DS_Store') });
if (existsSync('assets')) {
  // Videos are served from R2 (node upload-media.mjs), so they stay out of dist/.
  const isVideo = (source) => MEDIA_PATH.test('/' + source.split(path.sep).join('/'));
  await cp('assets', 'dist/assets', { recursive: true, dereference: true, filter: (source) => !source.endsWith('.DS_Store') && !source.endsWith('.md') && !isVideo(source) });
} else {
  // A fresh clone has no assets link, and deploying dist/ then takes every /assets/ file offline.
  console.warn('WARNING: no assets/ (ln -s private-assets/site assets), so dist/ has no /assets/ files. Don’t deploy this build.');
}
console.log('Production files ready in dist/');

await writeFile('dist/.assetsignore', '**/.DS_Store\n**/*.md\n');

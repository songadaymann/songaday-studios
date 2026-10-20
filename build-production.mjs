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
// Plugin downloads page: a static page of its own (songaday.studio/plugins).
await cp('plugins', 'dist/plugins', { recursive: true, filter: (source) => !source.endsWith('.DS_Store') });
if (existsSync('assets')) {
  // Videos are served from R2 (node upload-media.mjs), so they stay out of dist/.
  const isVideo = (source) => MEDIA_PATH.test('/' + source.split(path.sep).join('/'));
  await cp('assets', 'dist/assets', { recursive: true, dereference: true, filter: (source) => !source.endsWith('.DS_Store') && !source.endsWith('.md') && !isVideo(source) });
}
console.log('Production files ready in dist/');

await writeFile('dist/.assetsignore', '**/.DS_Store\n**/*.md\n');

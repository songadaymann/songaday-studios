import { cp, mkdir, stat, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const root = import.meta.dirname;
process.chdir(root);
execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('index.html', 'dist/index.html');
if (existsSync('assets')) {
  await cp('assets', 'dist/assets', { recursive: true, dereference: true, filter: (source) => !source.endsWith('.DS_Store') && !source.endsWith('.md') });
  const video = 'dist/assets/video/political-satire-trailer.mp4';
  if ((await stat(video)).size > 25 * 1024 * 1024) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'assets/video/political-satire-trailer.mp4', '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '26', '-maxrate', '1300k', '-bufsize', '2600k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', video], { stdio: 'inherit' });
    if ((await stat(video)).size > 25 * 1024 * 1024) throw new Error('Video exceeds static asset limit');
  }
}
console.log('Production files ready in dist/');

await writeFile('dist/.assetsignore', '**/.DS_Store\n**/*.md\n');

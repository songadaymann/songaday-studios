// Checks projects.json. With --links it also loads every url and sourceUrl (GET, following
// redirects) and lists the ones that don't answer 200:
//
//   node validate-projects.mjs
//   node validate-projects.mjs --links
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateProjects } from './projects.mjs';

const file = path.join(import.meta.dirname, 'projects.json');
const data = JSON.parse(await readFile(file, 'utf8'));
const problems = validateProjects(data);
for (const problem of problems) console.error(`projects.json: ${problem}`);
if (problems.length) process.exit(1);
console.log(`projects.json is valid: ${data.projects.length} projects.`);

async function status(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (songaday.studio link check)' },
      signal: AbortSignal.timeout(20000)
    });
    await response.body?.cancel();
    return response.status;
  } catch (error) {
    return error.name === 'TimeoutError' ? 'timed out' : error.message;
  }
}

if (process.argv.includes('--links')) {
  const urls = [...new Set(data.projects.flatMap((project) => [project.url, project.sourceUrl]).filter(Boolean))];
  const results = await Promise.all(urls.map(async (url) => [url, await status(url)]));
  const dead = results.filter(([, code]) => code !== 200);
  for (const [url, code] of dead) console.error(`${code}  ${url}`);
  console.log(`${urls.length - dead.length} of ${urls.length} addresses answered 200.`);
  if (dead.length) process.exit(1);
}

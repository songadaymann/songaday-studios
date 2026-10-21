import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from '../worker.mjs';
import { projectAddress, renderDirectory, renderEverything, validateProjects } from '../projects.mjs';

const root = new URL('../', import.meta.url);
const projects = JSON.parse(await readFile(new URL('projects.json', root), 'utf8'));
const byId = Object.fromEntries(projects.projects.map((project) => [project.id, project]));

test('projects.json is valid', () => {
  assert.deepEqual(validateProjects(projects), []);
  assert.deepEqual(projects.verbs, ['listen', 'see', 'play', 'build', 'make', 'get-a-song', 'join', 'watch', 'support', 'collect', 'other']);
  assert.ok(projects.projects.length >= 20 && projects.projects.length <= 30, 'places, not items');
});

test('the validator catches what would break the bar or the pages', () => {
  const good = byId['songaday-fan'];
  const check = (changes) => validateProjects({ ...projects, projects: [{ ...good, ...changes }] });
  assert.deepEqual(check({}), []);
  assert.match(check({ tagline: 'x'.repeat(81) }).join(), /tagline must be 1 to 80/);
  assert.match(check({ tagline: 'Songs — all of them' }).join(), /plain words/);
  assert.match(check({ verb: 'buy' }).join(), /verb must be one of/);
  assert.match(check({ status: 'live' }).join(), /status must be one of/);
  assert.match(check({ since: '2026-13' }).join(), /since must be YYYY or YYYY-MM/);
  assert.match(check({ since: '2999' }).join(), /in the future/);
  assert.match(check({ url: 'http://songaday.fan/' }).join(), /url must be an https address/);
  assert.match(check({ path: 'listen' }).join(), /path must be null or/);
  assert.match(check({ sourceUrl: 'https://gitlab.com/x/y' }).join(), /public GitHub/);
  assert.match(check({ barLabel: undefined }).join(), /barLabel must be/);
  assert.match(check({ inBar: false }).join(), /barLabel is only for projects in the bar/);
  assert.match(check({ status: 'archived' }).join(), /only live places can be in the bar/);
  assert.match(check({ status: 'seasonal' }).join(), /need a season/);
  assert.match(check({ season: 'Winter' }).join(), /season must be a month/);
  assert.match(check({ owner: 'x' }).join(), /unknown field "owner"/);
  assert.match(check({ tagline: 'Formerly on Patreon' }).join(), /Patreon/);
  assert.match(validateProjects({ ...projects, projects: [good, good] }).join(), /id is used twice/);
  assert.match(validateProjects({ ...projects, version: 2 }).join(), /version must be 1/);
});

test('the places the front door promises are listed', () => {
  const expect = {
    'songaday-fan': { verb: 'listen', inBar: true },
    gallery: { verb: 'see', url: 'https://gallery.songaday.world/', inBar: true },
    'songaday-world': { verb: 'collect', crypto: true, inBar: true },
    'mann-cool': { verb: 'play', inBar: true },
    'mann-cool-lab': { verb: 'play', url: 'https://mann.cool/lab', status: 'soon' },
    wamp: { verb: 'build' },
    novox: { verb: 'make', status: 'active' },
    'drum-expander': { verb: 'make', status: 'soon', sourceUrl: 'https://github.com/songadaymann/drum-expander' },
    commissions: { verb: 'get-a-song', path: '/commission', inBar: true },
    suggest: { verb: 'join' },
    jamuary: { verb: 'join', status: 'seasonal', season: 'Dec-Jan' },
    fumble: { verb: 'join', path: '/fumble' },
    discord: { verb: 'join' },
    films: { verb: 'watch' },
    donate: { verb: 'support' },
    albums: { verb: 'listen' },
    'data-lab': { verb: 'see', status: 'soon', path: '/data' },
    'song-6000': { status: 'archived', url: 'https://6000.songaday.world/' },
    rmxd: { status: 'archived', crypto: true },
    'every-two-million-blocks': { crypto: true },
    'little-pink-men': { crypto: true },
    'sued-the-sec': { url: 'https://suedthesec.com/' },
    'hugh-mann': { url: 'https://hughmann.agency/' },
    thetoolkit: {},
    'jonathanmann-net': { path: '/me' }
  };
  for (const [id, fields] of Object.entries(expect)) {
    assert.ok(byId[id], id);
    for (const [key, value] of Object.entries(fields)) assert.equal(byId[id][key], value, `${id}.${key}`);
  }
  // The bar reads Listen · See all · Play · Get a song, then Collect for wallets.
  const bar = projects.projects.filter((project) => project.inBar)
    .sort((a, b) => projects.verbs.indexOf(a.verb) - projects.verbs.indexOf(b.verb));
  assert.deepEqual(bar.map((project) => project.barLabel), ['Listen', 'See all', 'Play', 'Get a song', 'Collect']);
  assert.deepEqual(bar.filter((project) => project.crypto).map((project) => project.id), ['songaday-world']);
});

test('every short address in projects.json answers on songaday.studio', async () => {
  const env = { ASSETS: { fetch: async () => new Response('asset', { headers: { 'Content-Type': 'image/png' } }) } };
  for (const project of projects.projects.filter((item) => item.path)) {
    const response = await worker.fetch(new Request('https://songaday.studio' + project.path), env);
    // Without its database (as here) the Fumble page still renders, closed to posts, as a 503.
    const fumbleClosed = project.path === '/fumble' && /The Museum of Fumbled Bags/.test(await response.text());
    assert.ok([200, 302].includes(response.status) || fumbleClosed, `${project.id} ${project.path} answered ${response.status}`);
  }
  // A path that redirects off the studio goes where the project's url says.
  for (const id of ['songaday-fan', 'albums', 'mann-cool', 'wamp', 'commissions', 'suggest', 'jamuary', 'discord', 'motba', 'jonathanmann-net']) {
    const response = await worker.fetch(new Request('https://songaday.studio' + byId[id].path), env);
    assert.equal(new URL(response.headers.get('Location')).hostname, new URL(byId[id].url).hostname, id);
  }
});

test('the home page directory groups live places by verb and hides crypto ones without a wallet', () => {
  const html = renderDirectory(projects);
  const headings = [...html.matchAll(/<h3 id="directory-[^"]+">([^<]+)<\/h3>/g)].map((match) => match[1]);
  assert.deepEqual(headings, ['Listen', 'See', 'Play', 'Build', 'Make', 'Get a song', 'Join', 'Watch', 'Collect']);
  assert.match(html, /<a href="\/listen">songaday\.fan<span class="nav-out" aria-hidden="true">↗<\/span><\/a> <span>Every song/);
  assert.match(html, /<a href="\/fumble">The Museum of Fumbled Bags<\/a>/);
  assert.match(html, /Suggest tomorrow&#39;s song/);
  // Only live places: nothing coming soon, nothing archived, no donate (it's the rest of the page).
  assert.doesNotMatch(html, /Drum Expander|data lab|RMXD|Support Song A Day|jonathanmann\.net/);
  // Every collect row is crypto, so the whole group waits for a wallet.
  assert.match(html, /<section class="directory-group" data-crypto aria-labelledby="directory-collect">/);
  assert.match(html, /<li data-crypto><a href="https:\/\/songaday\.world\/">/);
  assert.doesNotMatch(html, /<li data-crypto><a href="\/listen">/);
});

test('/everything lists every project by status, with crypto rows behind the wallet gate', () => {
  const html = renderEverything(projects);
  const headings = [...html.matchAll(/<h2 id="everything-[^"]+">([^<]+)<\/h2>/g)].map((match) => match[1]);
  assert.deepEqual(headings, ['Active', 'Coming soon', 'Seasonal', 'Archive']);
  assert.equal((html.match(/class="everything-row"/g) ?? []).length, projects.projects.length);
  const crypto = projects.projects.filter((project) => project.crypto).length;
  assert.equal((html.match(/<li data-crypto>/g) ?? []).length, crypto);
  assert.match(html, /<strong>Drum Expander<\/strong> <span>songaday\.studio\/plugins<\/span>/);
  assert.match(html, /status-seasonal">Seasonal · Dec-Jan<\/span> Since 2026/);
  assert.match(html, /<strong>WAMP<\/strong> <span>songaday\.studio\/wamp<span class="nav-out"/);
  assert.match(html, /Since Mar 2026 · <a href="https:\/\/github\.com\/songadaymann\/wamp">Source<\/a>/);
  assert.match(html, /The celebration of song #6,000, June 2025\./);
  assert.equal(projectAddress(byId.youtube), 'youtube.com/channel/UCvj5S3f10rO6CoibatfRGzg');
  assert.equal(projectAddress(byId.films), 'songaday.studio/films');
});

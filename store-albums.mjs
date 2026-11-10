// The store's Music shelf: Jonathan's releases on Bandcamp, from the snapshot in
// store/albums.json (`node update-albums.mjs` refreshes it). Bandcamp only sells on its own
// pages, so each cover is a link there. The year albums ("Song A Day: Year Eighteen") go
// first, newest first; everything else follows in Bandcamp's own order.
export const BANDCAMP_ORIGIN = 'https://jonathanmann.bandcamp.com';
export const BANDCAMP_MUSIC_URL = `${BANDCAMP_ORIGIN}/music`;

const RELEASE_URL = /^https:\/\/jonathanmann\.bandcamp\.com\/(album|track)\/[a-z0-9-]+$/;
const COVER_URL = /^https:\/\/f4\.bcbits\.com\/img\/a\d{10}_2\.jpg$/;
const YEAR_TITLE = /^Song A Day: (Year ([A-Za-z]+)(?:[ -]([A-Za-z]+))?)$/;
const ONES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

const escapeHtml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const decodeHtml = (text) => text.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

// "Song A Day: Year Eighteen" is the eighteenth year, 2026. Null for any other title.
export function albumYear(title) {
  const match = YEAR_TITLE.exec(title);
  if (!match) return null;
  const [first, second] = [match[2].toLowerCase(), match[3]?.toLowerCase()];
  const ones = (word) => ONES.indexOf(word) + 1;
  const count = first in TENS ? TENS[first] + (second ? ones(second) : 0) : second ? 0 : ones(first);
  if (!count || (second && !ones(second))) return null;
  return { count, year: 2008 + count, label: match[1] };
}

const cover = (artId) => `https://f4.bcbits.com/img/a${String(artId).padStart(10, '0')}_2.jpg`;

// Every release on the Bandcamp music page. The first rows are markup; the rest is the JSON
// the page's own lazy loader reads.
export function parseBandcampMusic(html) {
  const releases = [];
  for (const [item, kind] of html.matchAll(/<li[^>]*data-item-id="(album|track)-\d+"[\s\S]*?<\/li>/g)) {
    const href = /<a href="(\/(?:album|track)\/[a-z0-9-]+)"/.exec(item)?.[1];
    const art = /\/img\/a(\d+)_\d+\.jpg/.exec(item)?.[1];
    const title = /<p class="title">\s*([^<]*?)\s*(?:<|$)/.exec(item)?.[1];
    if (href && art && title) releases.push({ kind, title: decodeHtml(title).replace(/\s+/g, ' '), url: BANDCAMP_ORIGIN + href, image: cover(art) });
  }
  const more = /data-client-items="([^"]*)"/.exec(html)?.[1];
  for (const item of more ? JSON.parse(decodeHtml(more)) : []) {
    if (!['album', 'track'].includes(item.type) || !item.art_id || !item.title) continue;
    releases.push({ kind: item.type, title: String(item.title).trim(), url: BANDCAMP_ORIGIN + item.page_url, image: cover(item.art_id) });
  }
  return releases;
}

// What's wrong with a snapshot, as a list of sentences (empty when it's fine).
export function albumProblems(releases) {
  if (!Array.isArray(releases) || !releases.length) return ['store/albums.json has no releases.'];
  const problems = [];
  const seen = new Set();
  for (const [index, release] of releases.entries()) {
    const name = release?.title || `Row ${index + 1}`;
    if (!release?.title) problems.push(`${name} has no title.`);
    if (!['album', 'track'].includes(release?.kind)) problems.push(`${name} is neither an album nor a track.`);
    if (!RELEASE_URL.test(release?.url ?? '')) problems.push(`${name} doesn't link to Jonathan's Bandcamp.`);
    if (!COVER_URL.test(release?.image ?? '')) problems.push(`${name} has no Bandcamp cover.`);
    if (seen.has(release?.url)) problems.push(`${name} is listed twice.`);
    seen.add(release?.url);
  }
  return problems;
}

// The year albums newest first, and the rest as Bandcamp lists them.
export function shelveAlbums(releases) {
  const years = releases.map((release) => ({ ...release, ...albumYear(release.title) })).filter((release) => release.year)
    .sort((a, b) => b.year - a.year);
  return { years, more: releases.filter((release) => !albumYear(release.title)) };
}

const item = (release, name, note) => `<li><a href="${escapeHtml(release.url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(release.image)}" alt="" width="350" height="350" loading="lazy" decoding="async"><span class="store-album-name">${escapeHtml(name)}</span>${note ? `<span class="store-album-note">${escapeHtml(note)}</span>` : ''}<span class="visually-hidden"> on Bandcamp (opens in a new tab)</span></a></li>`;

// The shelf shows albums. Singles stay in the snapshot, and the shelf's "Everything on
// Bandcamp" link reaches them.
export function renderAlbums(releases) {
  const { years, more } = shelveAlbums(releases);
  const others = more.filter((release) => release.kind === 'album');
  return {
    count: years.length + others.length,
    // The four newest years, for the Music picture at the top of the store.
    newestCovers: years.slice(0, 4).map((release) => release.image),
    // The album list itself, for under the heading with this id.
    list: (headingId) => ` <ul class="store-albums" aria-labelledby="${headingId}">
${years.map((release) => item(release, String(release.year), release.label)).join('\n')}
 </ul>
 <h3 id="more-albums-heading">More albums</h3>
 <ul class="store-albums" aria-labelledby="more-albums-heading">
${others.map((release) => item(release, release.title.replace(/ \[EP\]$/i, ''))).join('\n')}
 </ul>
 <a class="store-more" href="/albums" target="_blank" rel="noopener noreferrer">Everything on Bandcamp ↗</a>`,
  };
}

// songaday.studio/patrons/: the people and organizations who support Song A Day, built from
// patrons.json. Adding someone is adding a row; nothing else has to change. They show in the
// order they're listed.
//
// Only people who have said yes to being shown go in the list. This repository is public, so
// someone who gave anonymously stays out of patrons.json entirely unless they have since said
// yes themselves. A name alone is fine: every
// field but `name` is optional, so a patron can be listed before their picture or links are in.
//
// A patron row:
//   name   as they want to be shown
//   bio    a line or two about them; it pops up above their picture
//   image  their picture, square: a file on this site ("/assets/patrons/…") or an https
//          address. Without one, the square shows their initial. Keep a copy on this site for
//          anyone who is published: another site's picture address can change or disappear.
//   links  where to find them, in the order shown: [{ "label": "X", "url": "https://…" }]
//
// The most squares in one row (the page at full width; --patrons-across in patrons.css).
export const PATRONS_PER_ROW = 8;

// Long enough for a couple of sentences in a patron's own words; the pop-up grows to fit.
const BIO_MAX = 240;
const LABEL_MAX = 20;

const escapeHtml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const okImage = (image) => typeof image === 'string' && (/^\/assets\/[^\s"]+$/.test(image) || /^https:\/\/[^\s"]+$/.test(image));
const okUrl = (url) => typeof url === 'string' && /^https:\/\/[^\s"]+$/.test(url);

// What's wrong with the list, as sentences (empty when it's fine).
export function patronProblems(data) {
  const problems = [];
  const patrons = data?.patrons;
  if (!Array.isArray(patrons)) return ['patrons.json needs a "patrons" list.'];
  const seen = new Set();
  patrons.forEach((patron, index) => {
    const who = isText(patron?.name) ? patron.name : `Row ${index + 1}`;
    if (!isText(patron?.name)) problems.push(`${who} has no name.`);
    else if (seen.has(patron.name.toLowerCase())) problems.push(`${who} is listed twice.`);
    else seen.add(patron.name.toLowerCase());
    if ('bio' in patron && !isText(patron.bio)) problems.push(`${who}'s bio is empty; leave it out instead.`);
    else if (isText(patron.bio) && patron.bio.length > BIO_MAX) problems.push(`${who}'s bio is over ${BIO_MAX} characters.`);
    if ('image' in patron && !okImage(patron.image)) problems.push(`${who}'s image must be a /assets/ file or an https address.`);
    if ('links' in patron && !Array.isArray(patron.links)) problems.push(`${who}'s links must be a list.`);
    for (const link of Array.isArray(patron.links) ? patron.links : []) {
      if (!isText(link?.label) || link.label.length > LABEL_MAX) problems.push(`${who} has a link with no short label (X, Instagram, Website…).`);
      if (!okUrl(link?.url)) problems.push(`${who}'s ${isText(link?.label) ? link.label : ''} link must be an https address.`.replace('  ', ' '));
    }
    for (const key of Object.keys(patron ?? {})) {
      if (!['name', 'bio', 'image', 'links'].includes(key)) problems.push(`${who} has an unknown field "${key}".`);
    }
  });
  return problems;
}

// The first letter or digit of a name, for the square of a patron with no picture.
export const initialOf = (name) => (String(name).match(/[\p{L}\p{N}]/u)?.[0] ?? '').toUpperCase();

// The list items, one per patron. The name comes first for anyone listening to the page; the
// styles put the picture above it.
//
// The line about a patron pops up above their picture (patrons.css for a mouse or keyboard,
// patrons-page.js for a finger), so a patron with a bio gets a button for a picture, described
// by that line. One without a bio gets a plain square.
export function renderPatrons(data) {
  return data.patrons.map((patron, index) => {
    // The first row is on screen when the page opens, so its pictures load right away.
    const loading = index < PATRONS_PER_ROW ? '' : ' loading="lazy" decoding="async"';
    const face = patron.image
      ? `<img src="${escapeHtml(patron.image)}" alt="" width="400" height="400"${loading} referrerpolicy="no-referrer">`
      : `<span class="patron-initial" aria-hidden="true">${escapeHtml(initialOf(patron.name))}</span>`;
    const bioId = `patron-bio-${index + 1}`;
    const picture = patron.bio
      ? `<button class="patron-face" type="button" aria-label="${escapeHtml(`About ${patron.name}`)}" aria-describedby="${bioId}">${face}</button>
          <p class="patron-bio" id="${bioId}" role="tooltip">${escapeHtml(patron.bio)}</p>`
      : `<span class="patron-face">${face}</span>`;
    const links = patron.links?.length ? `\n        <p class="patron-links">${patron.links.map((link) =>
      `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${patron.name} on ${link.label}`)}">${escapeHtml(link.label)}</a>`).join(' ')}</p>` : '';
    return `      <li class="patron">
        <h2 class="patron-name">${escapeHtml(patron.name)}</h2>
        <div class="patron-picture">
          ${picture}
        </div>${links}
      </li>`;
  }).join('\n');
}

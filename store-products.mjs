// The store's front page, built from store/products.json: one row per thing on sale.
//
// The page opens with one picture per KIND of thing (music, posters, clothing…), so everything
// in the store shows on the first screen. A kind with one product is that product: its name,
// its picture, and a link straight to where it's sold. A kind with two or more products shows
// the kind's name over a picture made from theirs, and jumps to a list of them further down
// the page. So adding a product is adding a row, and nothing else has to change.
//
// A product row:
//   id        a short name of its own, e.g. "song-a-day-poster"
//   kind      the id of one of the kinds at the top of the file
//   name      what it's called on the page
//   note      the one line under the name. It can use the values the build knows:
//             {{ALBUM_COUNT}}, {{PERSONAL_FROM}}, {{FIGURE_COUNT}}, {{POSTER_FROM}}
//   href      where it's sold: a page here ("/store/muscle/") or another shop's address
//             ("https://…", which opens in a new tab and gets the ↗)
//   image     its picture: an address on this site ("/assets/…") or an https one
//   fit       how the picture sits in its square: "cover" (fills it; the default), "contain"
//             (all of it shows, on the page's black) or "print" (a poster on a grey mat)
//   checkout  "posters" when it's bought through the Studio's own poster checkout; its note
//             then says "opens soon" until that checkout is open
//   list      "albums" for the one row that stands for the Bandcamp albums; its picture is
//             the newest covers and its link is the album list (no href or image)
export const TOP_ROW_LIMIT = 4;

const SLUG = /^[a-z][a-z0-9-]*$/;
const FITS = ['cover', 'contain', 'print'];
const TOKEN = /\{\{([A-Z_]+)\}\}/g;

const escapeHtml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const isExternal = (href) => href.startsWith('https://');
const okHref = (href) => typeof href === 'string' && (/^\/[^/]/.test(href) || isExternal(href));
const okImage = (image) => typeof image === 'string' && (image.startsWith('/assets/') || image.startsWith('https://'));

// What's wrong with the list, as sentences (empty when it's fine). `values` are the names a
// note may use, e.g. { ALBUM_COUNT: '32' }.
export function productProblems(data, values = {}) {
  const problems = [];
  const kinds = Array.isArray(data?.kinds) ? data.kinds : [];
  const products = Array.isArray(data?.products) ? data.products : [];
  if (!kinds.length) problems.push('store/products.json has no kinds.');
  if (!products.length) problems.push('store/products.json has no products.');
  const kindIds = new Set();
  for (const kind of kinds) {
    const name = kind?.id || 'A kind';
    if (!SLUG.test(kind?.id ?? '')) problems.push(`${name} needs an id in lowercase letters, numbers and hyphens.`);
    if (kindIds.has(kind?.id)) problems.push(`The kind ${name} is listed twice.`);
    kindIds.add(kind?.id);
    if (!kind?.name) problems.push(`The kind ${name} has no name.`);
  }
  const productIds = new Set();
  for (const product of products) {
    const name = product?.id || product?.name || 'A product';
    if (!SLUG.test(product?.id ?? '')) problems.push(`${name} needs an id in lowercase letters, numbers and hyphens.`);
    if (productIds.has(product?.id)) problems.push(`The product ${name} is listed twice.`);
    productIds.add(product?.id);
    if (!kindIds.has(product?.kind)) problems.push(`${name} is in the kind "${product?.kind}", which isn't one of the kinds.`);
    if (!product?.name) problems.push(`${name} has no name.`);
    if (typeof product?.note !== 'string' || !product.note) problems.push(`${name} has no note (the line under its name).`);
    for (const [, token] of String(product?.note ?? '').matchAll(TOKEN)) {
      if (!(token in values)) problems.push(`${name}'s note uses {{${token}}}, which the build doesn't know.`);
    }
    if (product?.list !== undefined) {
      if (product.list !== 'albums') problems.push(`${name} has the list "${product.list}"; the only list is "albums".`);
      if (product.href || product.image) problems.push(`${name} stands for the albums, so it takes no href or image.`);
    } else {
      if (!okHref(product?.href)) problems.push(`${name} needs an href: a page here ("/…") or an https address.`);
      if (!okImage(product?.image)) problems.push(`${name} needs an image: "/assets/…" or an https address.`);
    }
    if (product?.fit !== undefined && !FITS.includes(product.fit)) problems.push(`${name} has the fit "${product.fit}"; use ${FITS.join(', ')}.`);
    if (product?.checkout !== undefined && product.checkout !== 'posters') problems.push(`${name} has the checkout "${product.checkout}"; the only one is "posters".`);
  }
  if (products.filter((product) => product?.list === 'albums').length > 1) problems.push('Only one product can stand for the albums.');
  const shown = kinds.filter((kind) => products.some((product) => product?.kind === kind?.id));
  if (shown.length > TOP_ROW_LIMIT) {
    problems.push(`The first screen fits ${TOP_ROW_LIMIT} kinds, and ${shown.length} have products (${shown.map((kind) => kind.name).join(', ')}). Put the new product in one of the first ${TOP_ROW_LIMIT}, or redesign the top row.`);
  }
  return problems;
}

const fill = (note, values) => note.replaceAll(TOKEN, (match, token) => values[token]);

// "MUSCLE posters and Song A Day poster"; past three, "MUSCLE posters, Song A Day poster and 2 more".
function namesOf(products) {
  const names = products.map((product) => product.name);
  if (names.length <= 3) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join('');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

// One picture fills the square; two or three show the first two side by side; four or more
// show the first four, two by two.
function picture(images, fit, eager) {
  const shown = images.length >= 4 ? images.slice(0, 4) : images.slice(0, 2);
  const loading = eager ? '' : ' loading="lazy" decoding="async"';
  const kind = shown.length > 1 ? ' store-item-mosaic' : fit === 'print' ? ' store-item-print' : fit === 'contain' ? ' store-item-contain' : '';
  // Pictures kept on other sites (Bandcamp, Cotton Bureau, the print host) aren't told which page asked.
  const referrer = (image) => image.startsWith('https://') ? ' referrerpolicy="no-referrer"' : '';
  return `<span class="store-item-image${kind}">${shown.map((image) => `<img src="${escapeHtml(image)}" alt=""${loading}${referrer(image)}>`).join('')}</span>`;
}

function tile({ href, images, fit, name, note, opensSoon = false, eager }) {
  const external = isExternal(href);
  const link = `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>`;
  const tail = `${opensSoon ? '<span data-store-opens-soon> · opens soon</span>' : ''}${external ? ' ↗<span class="visually-hidden"> (opens in a new tab)</span>' : ''}`;
  return ` <li>${link}${picture(images, fit, eager)}<span class="store-item-name">${escapeHtml(name)}</span><span class="store-item-note">${escapeHtml(note)}${tail}</span></a></li>`;
}

// The top row and the sections under it. `albums` is renderAlbums()'s result (store-albums.mjs)
// and `values` fills the notes. Call productProblems first; this assumes a clean list.
export function renderStore(data, { albums, values = {} }) {
  const kinds = data.kinds.map((kind) => ({ ...kind, products: data.products.filter((product) => product.kind === kind.id) }))
    .filter((kind) => kind.products.length);
  const imagesOf = (product) => product.list === 'albums' ? albums.newestCovers : [product.image];
  const productTile = (product, kind, eager) => tile({
    href: product.list === 'albums' ? `#${kind.id}` : product.href,
    images: imagesOf(product),
    fit: product.fit,
    name: product.name,
    note: fill(product.note, values),
    opensSoon: product.checkout === 'posters',
    eager,
  });
  const items = kinds.map((kind) => kind.products.length === 1 ? productTile(kind.products[0], kind, true) : tile({
    href: `#${kind.id}`,
    images: kind.products.flatMap(imagesOf),
    name: kind.name,
    note: namesOf(kind.products),
    eager: true,
  }));
  // A kind gets a section when there's more to show than its one picture: several products,
  // or the album list. Sections follow the top row's order, except that the kind with the
  // album list goes last: it's dozens of covers long, and the short lists shouldn't sit under it.
  const hasAlbumList = (kind) => kind.products.some((product) => product.list === 'albums');
  const withSections = kinds.filter((kind) => kind.products.length > 1 || hasAlbumList(kind));
  const sections = [...withSections.filter((kind) => !hasAlbumList(kind)), ...withSections.filter(hasAlbumList)].map((kind) => {
    const several = kind.products.length > 1;
    const hasAlbums = hasAlbumList(kind);
    // In its own section the albums row would only point at the list right under it.
    const listed = kind.products.filter((product) => product.list !== 'albums');
    return `<section class="store-kind" id="${kind.id}" aria-labelledby="${kind.id}-heading">
 <h2 id="${kind.id}-heading">${escapeHtml(kind.name)}</h2>${kind.about ? `
 <p>${escapeHtml(kind.about)}</p>` : ''}${several && listed.length ? `
 <ul class="store-items" aria-labelledby="${kind.id}-heading">
${listed.map((product) => productTile(product, kind, false)).join('\n')}
 </ul>` : ''}${hasAlbums ? `
${albums.list(`${kind.id}-heading`)}` : ''}
</section>`;
  });
  return { items: items.join('\n'), sections: sections.join('\n') };
}

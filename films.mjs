// The Films page lists Jonathan's "Mini-documentaries" YouTube playlist. The build renders a
// snapshot into films/index.html, and the Worker re-renders it from the live feed, so new
// mini-docs appear without a redeploy. YouTube's feed lists up to 15 videos, in playlist order.

export const FILMS_PLAYLIST_ID = 'PLP2_tLAnnx_IIOt19kqdbMdM9mK9FOIHB';
export const FILMS_PLAYLIST_URL = `https://www.youtube.com/playlist?list=${FILMS_PLAYLIST_ID}`;
export const FILMS_FEED_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${FILMS_PLAYLIST_ID}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, code) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10FFFF ? String.fromCodePoint(point) : match;
  });
}

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => {
    const pick = (tag) => entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '';
    return {
      id: pick('yt:videoId').trim(),
      title: decodeXml(pick('title').trim()),
      published: pick('published').trim().slice(0, 10)
    };
  }).filter((film) => /^[\w-]{11}$/.test(film.id));
}

function formatMonth(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  return MONTHS[month - 1] ? `${MONTHS[month - 1]} ${year}` : '';
}

// Each film is a thumbnail button; the page script swaps in the YouTube player on click,
// so the page loads ten pictures instead of ten players. Full-size thumbnails fall back to
// YouTube's 480px one for older videos that don't have them.
export function renderFilms(films) {
  return films.map((film, index) => {
    const featured = index === 0;
    const title = escapeHtml(film.title);
    const id = escapeHtml(film.id);
    const thumb = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
    const fallback = ` data-fallback="https://i.ytimg.com/vi/${id}/hqdefault.jpg"`;
    const lazy = featured ? '' : ' loading="lazy"';
    const date = formatMonth(film.published);
    return `<article class="film${featured ? ' film-featured' : ''}">
  <button class="film-play" type="button" data-film-id="${id}" aria-label="Play ${title}">
    <img src="${thumb}" alt="" width="1280" height="720"${lazy} decoding="async"${fallback}>
    <span class="film-play-icon" aria-hidden="true"></span>
  </button>
  <h2 class="film-title">${title}</h2>${date ? `
  <p class="film-date"><time datetime="${escapeHtml(film.published)}">${date}</time></p>` : ''}
</article>`;
  }).join('\n');
}

export const FILMS_FALLBACK = `<p class="films-fallback">The films are on <a href="${FILMS_PLAYLIST_URL}">YouTube</a>.</p>`;

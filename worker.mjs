import { songADayNumber } from './song-day.mjs';
import { MEDIA_PATH, serveMedia } from './media.mjs';
import { FILMS_FEED_URL, parseFeed, renderFilms } from './films.mjs';
import { handleFumble } from './fumble.mjs';

// Section URLs live on songaday.studio so they can become real pages later.
// Temporary (302, no-store) redirects so browsers don't cache them for good.
const SECTION_REDIRECTS = {
  '/songs': 'https://gallery.songaday.world/',
  '/games': 'https://mann.cool/',
  '/mini-docs': '/films/',
  '/donate': '/#donate'
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// The live mini-docs playlist, cached at Cloudflare's edge for an hour. On any failure the
// Films page keeps the snapshot it was built with.
async function liveFilms() {
  try {
    const response = await fetch(FILMS_FEED_URL, {
      cf: { cacheTtl: 3600, cacheEverything: true },
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return null;
    const films = parseFeed(await response.text());
    return films.length ? films : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isLocal = LOCAL_HOSTS.has(url.hostname);
    if (url.hostname === 'www.songaday.studio' || (url.protocol === 'http:' && !isLocal)) {
      if (url.hostname === 'www.songaday.studio') url.hostname = 'songaday.studio';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '').toLowerCase() : url.pathname;
    const destination = SECTION_REDIRECTS[path];
    if (destination) {
      // Same-site destinations keep the query string (e.g. /donate?utm_source=… → /?utm_source=…#donate).
      const [target, hash = ''] = destination.split('#');
      const location = destination.startsWith('/') ? target + url.search + (hash ? '#' + hash : '') : destination;
      return new Response(null, {
        status: 302,
        headers: { Location: location, 'Cache-Control': 'no-store' }
      });
    }

    // Videos come from R2 so they can answer Range requests (see media.mjs).
    const media = env.MEDIA && MEDIA_PATH.exec(url.pathname);
    if (media) {
      const video = await serveMedia(request, env.MEDIA, media[1]);
      if (video) return video;
    }

    // songaday.studio/fumble: anonymous bag-fumble stories (fumble.mjs).
    const fumble = await handleFumble(request, env, url);
    if (fumble) return fumble;

    // /Films, /FILMS/ etc. land on the Films page (the section redirects above ignore case too).
    if (path === '/films' && url.pathname !== '/films/') {
      return new Response(null, { status: 302, headers: { Location: '/films/' + url.search, 'Cache-Control': 'no-store' } });
    }

    // Fetch the live playlist alongside the page, so the top of the page streams without waiting on YouTube.
    const filmsPromise = path === '/films' && request.method === 'GET' ? liveFilms() : null;
    const response = await env.ASSETS.fetch(request);
    if (!response.headers.get('Content-Type')?.includes('text/html')) return response;

    const number = songADayNumber();
    const rewriter = new HTMLRewriter()
      .on('[data-song-day="today"]', {
        element(element) { element.setInnerContent(String(number)); }
      })
      .on('[data-song-day="tomorrow"]', {
        element(element) { element.setInnerContent(String(number + 1)); }
      })
      .on('[data-song-day="count"]', {
        element(element) { element.setInnerContent(number.toLocaleString('en-US')); }
      });
    if (filmsPromise) {
      rewriter.on('#films-list', {
        async element(element) {
          const films = await filmsPromise;
          if (films) element.setInnerContent(renderFilms(films), { html: true });
        }
      });
    }
    const rewritten = rewriter.transform(response);
    // A fresh Response: the transformed one can have immutable headers (HEAD requests returned 500).
    const page = new Response(rewritten.body, rewritten);
    page.headers.set('Cache-Control', 'no-cache');
    page.headers.delete('ETag');
    page.headers.delete('Last-Modified');
    return page;
  }
};

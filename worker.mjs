import { songADayNumber } from './song-day.mjs';
import { MEDIA_PATH, serveMedia } from './media.mjs';
import { FILMS_FEED_URL, parseFeed, renderFilms } from './films.mjs';
import { handleFumble } from './fumble.mjs';
import { SONGS_FEED_URL, latestSong, renderTodaySong, renderTodaySongLink } from './today-song.mjs';
import { songDate } from './calendar.mjs';

// Short addresses on songaday.studio for every part of Song A Day, so they can be said out
// loud and become real pages later. Temporary (302, no-store) redirects so browsers don't
// cache them for good. /songs and /all go to songaday.fan's Explore until the new gallery
// replaces the old one, which stops at #5852. /commission goes to the Bandcamp commission
// listings until jonathanmann.net has a commissions page. /data goes to the data lab's code until
// the lab has its page here.
const SECTION_REDIRECTS = {
  '/all': 'https://songaday.fan/explore',
  '/songs': 'https://songaday.fan/explore',
  '/listen': 'https://songaday.fan/challenge',
  '/suggest': 'https://songaday.fan/suggestions',
  '/jamuary': 'https://songaday.fan/jamuary',
  '/today': '/#today',
  '/games': 'https://mann.cool/',
  '/wamp': 'https://wamp.land/',
  '/commission': 'https://jonathanmann.bandcamp.com/merch',
  '/commissions': 'https://jonathanmann.bandcamp.com/merch',
  '/albums': 'https://jonathanmann.bandcamp.com/music',
  '/discord': 'https://discord.gg/rGTQH7mFNS',
  '/me': 'https://www.jonathanmann.net/',
  '/motba': 'https://motba.art/',
  '/mini-docs': '/films/',
  '/donate': '/#donate'
};

// Pages that live in a folder: /Films, /now and the like land on /films/, /now/.
const FOLDER_PAGES = new Set(['/films', '/links', '/everything', '/now', '/data']);

// The universe bar and projects.json load on other Song A Day sites too, and module scripts and
// cross-origin fetches need CORS. The bar is pinned by version folder (bar/v1/), so it can be
// cached for a few hours; projects.json changes more often.
const SHARED_FILES = [
  { pattern: /^\/bar\/v\d+\//, cache: 'public, max-age=14400' },
  { pattern: /^\/projects\.json$/, cache: 'public, max-age=300' }
];

async function serveShared(request, env, cache) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Max-Age': '86400' } });
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  // A 304 needs the header too: browsers copy a revalidation's headers onto the cached copy.
  if (asset.ok || asset.status === 304) response.headers.set('Cache-Control', cache);
  return response;
}

// /year/2014 goes to that year on the home page's calendar, for 2009 through this year.
const YEAR_PATH = /^\/year\/(\d{4})$/;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Old songaday.world hostnames that are still out in the world but went dead: market. is the
// link in the X bio, enter. is the Discord link in years of YouTube descriptions, and jamuary.
// showed an expired certificate. They're custom domains of this Worker (wrangler.jsonc), so
// any path on them lands somewhere useful.
const HOST_REDIRECTS = {
  'market.songaday.world': 'https://songaday.studio/links/',
  'enter.songaday.world': 'https://discord.gg/rGTQH7mFNS',
  'jamuary.songaday.world': 'https://songaday.studio/jamuary'
};

// The newest song on the YouTube channel, cached at Cloudflare's edge for ten minutes. On any
// failure the home page keeps the snapshot it was built with.
async function liveLatestSong() {
  try {
    const response = await fetch(SONGS_FEED_URL, {
      cf: { cacheTtl: 600, cacheEverything: true },
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return null;
    return latestSong(await response.text());
  } catch {
    return null;
  }
}

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
    const hostDestination = HOST_REDIRECTS[url.hostname];
    if (hostDestination) {
      return new Response(null, { status: 302, headers: { Location: hostDestination, 'Cache-Control': 'no-store' } });
    }
    const isLocal = LOCAL_HOSTS.has(url.hostname);
    if (url.hostname === 'www.songaday.studio' || (url.protocol === 'http:' && !isLocal)) {
      if (url.hostname === 'www.songaday.studio') url.hostname = 'songaday.studio';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    const shared = SHARED_FILES.find((file) => file.pattern.test(url.pathname));
    if (shared) return serveShared(request, env, shared.cache);

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

    const year = Number(YEAR_PATH.exec(path)?.[1]);
    if (year >= 2009 && year <= songDate(songADayNumber()).getUTCFullYear()) {
      return new Response(null, {
        status: 302,
        headers: { Location: `/${url.search}#year-${year}`, 'Cache-Control': 'no-store' }
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

    // /Films, /LINKS/ etc. land on the page itself (the section redirects above ignore case too).
    if (FOLDER_PAGES.has(path) && url.pathname !== path + '/') {
      return new Response(null, { status: 302, headers: { Location: path + '/' + url.search, 'Cache-Control': 'no-store' } });
    }

    // Fetch the live feeds alongside the page, so the top of the page streams without waiting on YouTube.
    const filmsPromise = path === '/films' && request.method === 'GET' ? liveFilms() : null;
    const songPromise = (path === '/' || path === '/links') && request.method === 'GET' ? liveLatestSong() : null;
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
    if (songPromise) {
      rewriter.on('#today', {
        async element(element) {
          const song = await songPromise;
          const render = path === '/links' ? renderTodaySongLink : renderTodaySong;
          if (song) element.setInnerContent(render(song, number), { html: true });
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

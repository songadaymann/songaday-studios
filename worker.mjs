import {handleStore, runStoreOrders} from './store.mjs';
import { cleanupPatrons } from './patron-discounts.mjs';
import { handleMonthlyGiving } from './monthly-giving.mjs';
import { handleTroubadour } from './troubadour.mjs';
import { handleBusiness } from './business.mjs';
import { songADayAge, songADayNumber } from './song-day.mjs';
import { MEDIA_PATH, serveMedia } from './media.mjs';
import { FILMS_FEED_URL, parseFeed, renderFilms } from './films.mjs';
import { handleFumble } from './fumble.mjs';
import { handleCommission, runCommissionDaily } from './commission.mjs';
import { SONGS_FEED_URL, latestSong, renderTodaySong, renderTodaySongLink } from './today-song.mjs';
import { songDate } from './calendar.mjs';
import { livePress, pressFilters, pressSnapshot, renderPress, renderPressSummary } from './press.mjs';
import { serveGallery } from './gallery.mjs';
import { applyDonateTest, handleDonateTest } from './donate-test.mjs';

// Short addresses on songaday.studio for every part of Song A Day, so they can be said out
// loud and become real pages later. Temporary (302, no-store) redirects so browsers don't
// cache them for good. /songs and /all go to the gallery, every song on one zoomable wall.
// /commission is a page of its own (commission.mjs); /commissions and /custom land on it.
const SECTION_REDIRECTS = {
  '/all': '/gallery/',
  '/songs': '/gallery/',
  '/listen': 'https://songaday.fan/challenge',
  '/suggest': 'https://songaday.fan/suggestions',
  '/jamuary': 'https://songaday.fan/jamuary',
  '/today': '/#today',
  '/games': 'https://mann.cool/',
  '/wamp': 'https://wamp.land/',
  '/commissions': '/commission',
  '/custom': '/commission',
  '/albums': 'https://jonathanmann.bandcamp.com/music',
  '/discord': 'https://discord.gg/rGTQH7mFNS',
  '/me': 'https://www.jonathanmann.net/',
  '/motba': 'https://motba.art/',
  '/mini-docs': '/films/',
  // Other words for the press page that people might say or type.
  '/podcasts': '/press/',
  '/interviews': '/press/',
  '/media': '/press/',
  '/donate': '/#donate',
  // The story page, by the word people usually try first.
  '/about': '/story/',
  // The Conference Troubadour, by a shorter word and by its address on the old jonathanmann.net.
  '/troubadour': '/conference-troubadour/',
  '/conf': '/conference-troubadour/',
  '/conf-troubadour': '/conference-troubadour/',
  // Songs for a business, by what people call them and by the old site's address.
  '/theme-songs': '/business/',
  '/themes': '/business/'
};

// Pages that live in a folder: /Films, /now and the like land on /films/, /now/.
const FOLDER_PAGES = new Set(['/films', '/links', '/everything', '/now', '/story', '/patrons', '/conference-troubadour', '/business', '/data', '/press', '/store', '/store/muscle', '/node']);

// The poster picker used to be the whole store page. Links people shared to a figure, and the
// links Stripe sends buyers back on, name one of these; they land on the picker's own page.
const POSTER_PARAMS = ['figure', 'size', 'frame', 'order'];

// The programs that read a page's share picture when its link is posted. X's never shows the
// picture for a link that redirects (songaday.studio/store, /now), so they get the page itself.
const LINK_PREVIEW_BOTS = /twitterbot|facebookexternalhit|meta-externalagent|slackbot|discordbot|linkedinbot|whatsapp|telegrambot|redditbot|bluesky|mastodon|iframely|embedly/i;
const isLinkPreviewBot = (request) => LINK_PREVIEW_BOTS.test(request.headers.get('User-Agent') || '');

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
  // Every page goes through the Donate button test on its way out (donate-test.mjs).
  async fetch(request, env, ctx) {
    const response = await route(request, env, ctx);
    return applyDonateTest(request, new URL(request.url), response);
  },

  // Daily (wrangler.jsonc triggers): commission place-in-line emails, the payment reminder,
  // Jonathan's summary, and any email that didn't go out.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runStoreOrders(env));
    ctx.waitUntil(cleanupPatrons(env));
    if (!controller.cron || controller.cron === '0 14 * * *') ctx.waitUntil(runCommissionDaily(env, new Date(controller.scheduledTime)));
  }
};

// The page a redirect would land on, answered at the address the bot asked for.
function pageForBot(request, env, ctx, url, location) {
  return route(new Request(new URL(location, url), { method: request.method, headers: request.headers }), env, ctx);
}

async function route(request, env, ctx) {
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
  if (path === '/gallery' || url.pathname.startsWith('/gallery/')) {
    return serveGallery(request, env, url);
  }
  const destination = SECTION_REDIRECTS[path];
  if (destination) {
    // Same-site destinations keep the query string (e.g. /donate?utm_source=… → /?utm_source=…#donate).
    const [target, hash = ''] = destination.split('#');
    const location = destination.startsWith('/') ? target + url.search + (hash ? '#' + hash : '') : destination;
    if (destination.startsWith('/') && isLinkPreviewBot(request)) return pageForBot(request, env, ctx, url, target + url.search);
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

  // The Donate button test's counts and, for Jonathan, its totals (donate-test.mjs).
  const donateTest = await handleDonateTest(request, env, url);
  if (donateTest) return donateTest;

  // songaday.studio/commission: song commissions, the buyer pages and the admin (commission.mjs).
  const store = await handleStore(request, env, url);
  if (store) return store;
  // What monthly patrons give each month, for Jonathan only (monthly-giving.mjs).
  const monthly = await handleMonthlyGiving(request, env, url);
  if (monthly) return monthly;
  // Business songs were a choice on the personal form, and the menu linked to it that way for
  // a day (/commission?kind=business). They have their own page now.
  if (path === '/commission' && url.searchParams.get('kind') === 'business' && (request.method === 'GET' || request.method === 'HEAD')) {
    return new Response(null, { status: 302, headers: { Location: '/business/', 'Cache-Control': 'no-store' } });
  }
  const commission = await handleCommission(request, env, url, ctx);
  if (commission) return commission;
  // The Conference Troubadour page's Book me form (troubadour.mjs) and the business page's
  // request form (business.mjs).
  const booking = await handleTroubadour(request, env, url) ?? await handleBusiness(request, env, url);
  if (booking) return booking;

  // songaday.studio/fumble: anonymous bag-fumble stories (fumble.mjs).
  const fumble = await handleFumble(request, env, url);
  if (fumble) return fumble;

  if (path === '/store' && POSTER_PARAMS.some((name) => url.searchParams.has(name))) {
    return new Response(null, { status: 302, headers: { Location: '/store/muscle/' + url.search, 'Cache-Control': 'no-store' } });
  }

  // /Films, /LINKS/ etc. land on the page itself (the section redirects above ignore case too).
  if (FOLDER_PAGES.has(path) && url.pathname !== path + '/') {
    if (isLinkPreviewBot(request)) return pageForBot(request, env, ctx, url, path + '/' + url.search);
    return new Response(null, { status: 302, headers: { Location: path + '/' + url.search, 'Cache-Control': 'no-store' } });
  }

  // Fetch the live feeds alongside the page, so the top of the page streams without waiting on YouTube.
  const filmsPromise = path === '/films' && request.method === 'GET' ? liveFilms() : null;
  const songPromise = (path === '/' || path === '/links') && request.method === 'GET' ? liveLatestSong() : null;
  const pressPromise = path === '/press' && request.method === 'GET' ? livePress(env.PRESS_CSV_URL, { origin: url.origin }) : null;
  const response = await env.ASSETS.fetch(request);
  if (!response.headers.get('Content-Type')?.includes('text/html')) return response;

  const isHome = path === '/' || path === '/index.html';
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
    })
    .on('[data-song-day="age"]', {
      element(element) { element.setInnerContent(songADayAge(number).text); }
    });
  if (isHome) {
    const country = request.cf?.country;
    const method = /^[A-Z]{2}$/.test(country) && country !== 'US' && country !== 'XX' ? 'direct' : 'endaoment';
    rewriter.on('[data-crypto-method]', {
      element(element) {
        if (element.getAttribute('data-crypto-method') === method) element.removeAttribute('hidden');
        else element.remove();
      }
    });
  }
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
  if (pressPromise) {
    // The live press sheet, or the built-in snapshot again when the address asks for a filter
    // (?kind=, ?project=, ?year=: the other rows come back hidden, so the filters work without
    // JavaScript).
    const filters = pressFilters(url.searchParams);
    const filtered = Object.values(filters).some(Boolean);
    rewriter.on('#press-summary', {
      async element(element) {
        const live = await pressPromise;
        if (live) element.setInnerContent(renderPressSummary(live), { html: true });
      }
    }).on('#press', {
      async element(element) {
        const live = await pressPromise;
        if (live || filtered) element.setInnerContent(renderPress(live ?? pressSnapshot().items, filters), { html: true });
      }
    });
  }
  const rewritten = rewriter.transform(response);
  // A fresh Response: the transformed one can have immutable headers (HEAD requests returned 500).
  const page = new Response(rewritten.body, rewritten);
  page.headers.set('Cache-Control', isHome ? 'private, no-store' : 'no-cache');
  page.headers.delete('ETag');
  page.headers.delete('Last-Modified');
  return page;
}

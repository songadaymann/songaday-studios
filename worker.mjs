import { songADayNumber } from './song-day.mjs';
import { handleFumble } from './fumble.mjs';

// Section URLs live on songaday.studio so they can become real pages later.
// Temporary (302, no-store) redirects so browsers don't cache them for good.
const SECTION_REDIRECTS = {
  '/songs': 'https://gallery.songaday.world/',
  '/games': 'https://mann.cool/',
  // Until the Films page exists, mini-docs live on the YouTube channel.
  '/films': 'https://www.youtube.com/channel/UCvj5S3f10rO6CoibatfRGzg/videos',
  '/mini-docs': '/films',
  '/donate': '/#donate'
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

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

    // songaday.studio/fumble: anonymous bag-fumble stories (fumble.mjs).
    const fumble = await handleFumble(request, env, url);
    if (fumble) return fumble;

    const response = await env.ASSETS.fetch(request);
    if (!response.headers.get('Content-Type')?.includes('text/html')) return response;

    const number = songADayNumber();
    const rewritten = new HTMLRewriter()
      .on('[data-song-day="today"]', {
        element(element) { element.setInnerContent(String(number)); }
      })
      .on('[data-song-day="tomorrow"]', {
        element(element) { element.setInnerContent(String(number + 1)); }
      })
      .on('[data-song-day="count"]', {
        element(element) { element.setInnerContent(number.toLocaleString('en-US')); }
      })
      .transform(response);
    // A fresh Response: the transformed one can have immutable headers (HEAD requests returned 500).
    const page = new Response(rewritten.body, rewritten);
    page.headers.set('Cache-Control', 'no-cache');
    page.headers.delete('ETag');
    page.headers.delete('Last-Modified');
    return page;
  }
};

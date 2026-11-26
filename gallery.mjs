const pagePath = '/gallery/';
const stylesheetPath = '/gallery/studio.css';
// What a shared /gallery/ link shows (share-images.mjs drew the picture).
const GALLERY_SHARE_TAGS = `<meta property="og:type" content="website"><meta property="og:site_name" content="Song A Day Studio"><meta property="og:title" content="All songs · Song A Day Studio"><meta property="og:description" content="Every Song A Day song in one zoomable wall, one a day since January 1, 2009."><meta property="og:url" content="https://songaday.studio/gallery/"><meta property="og:image" content="https://songaday.studio/assets/images/share/gallery.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Every Song A Day song since 2009, on one wall."><meta name="twitter:card" content="summary_large_image">`;
const headerPath = '/gallery/studio-header.txt';
const forwardedHeaders = ['accept', 'origin', 'sec-fetch-site', 'cf-connecting-ip'];
const assetHeaders = ['range', 'if-range', 'if-none-match', 'if-modified-since'];

function unavailable() {
  return new Response('The gallery is temporarily unavailable. Please try again shortly.\n', {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function serveGallery(request, env, url) {
  const { pathname } = url;
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (pathname.replace(/\/+$/, '').toLowerCase() === '/gallery' && pathname !== pagePath) {
    return new Response(null, {
      status: 302,
      headers: { Location: pagePath + url.search, 'Cache-Control': 'no-store' },
    });
  }
  if (pathname === stylesheetPath) return env.ASSETS.fetch(request);
  const isPage = pathname === pagePath;
  if (!isPage && !pathname.startsWith('/gallery/assets/') && !pathname.startsWith('/gallery/api/')) {
    return new Response('Not found\n', { status: 404 });
  }
  if (!env.GALLERY) return unavailable();

  // Preserve the Studio origin for gallery API checks, without forwarding Studio credentials.
  // A rewritten document has its own representation and must never get an upstream 304.
  const headers = new Headers();
  for (const name of isPage ? forwardedHeaders : [...forwardedHeaders, ...assetHeaders]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const galleryRequest = new Request(url, { method: request.method, headers });
  if (!isPage) return env.GALLERY.fetch(galleryRequest);

  const response = await env.GALLERY.fetch(galleryRequest);
  if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return response;
  const pageHeaders = new Headers(response.headers);
  pageHeaders.set('Cache-Control', 'no-cache');
  for (const name of ['ETag', 'Last-Modified', 'Content-Length']) pageHeaders.delete(name);
  if (request.method === 'HEAD') return new Response(null, { status: response.status, headers: pageHeaders });

  const header = await env.ASSETS.fetch(new Request(new URL(headerPath, url)));
  if (!header.ok) return unavailable();
  const markup = await header.text();
  const page = new Response(response.body, { status: response.status, headers: pageHeaders });
  return new HTMLRewriter()
    .on('head', { element(element) {
      element.append(`<link rel="stylesheet" href="${stylesheetPath}"><link rel="canonical" href="https://songaday.studio/gallery/">${GALLERY_SHARE_TAGS}`, { html: true });
    } })
    .on('title', { element(element) { element.setInnerContent('All songs · Song A Day Studio'); } })
    .on('body', { element(element) { element.prepend(markup, { html: true }); } })
    .on('.top-bar-logo', { element(element) { element.remove(); } })
    .on('#home-btn', { element(element) { element.setInnerContent('Reset view'); } })
    .transform(page);
}

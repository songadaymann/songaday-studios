// Site videos live in the R2 bucket bound as MEDIA (wrangler.jsonc), not in dist/.
// Static assets answer a Range request with the whole file, and browsers need 206
// responses to seek (iOS Safari won't play video without them).

export const MEDIA_BUCKET = 'songaday-studio-media';

// /assets/video/<name>.mp4 is stored in the bucket under video/<name>.mp4.
export const MEDIA_PATH = /^\/assets\/(video\/[^/]+\.(?:mp4|m4v|webm|mov))$/i;

const CONTENT_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
export const mediaContentType = (key) => CONTENT_TYPES[key.split('.').pop().toLowerCase()];
// Video names aren't fingerprinted, so a replaced file shows up within a day.
const CACHE_CONTROL = 'public, max-age=86400';

// One byte range from a Range header: { offset, length }, 'unsatisfiable' when it starts
// past the end, or null when there's nothing usable (no header, a malformed one, or
// several ranges). RFC 9110 lets a server answer those with the whole file.
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header?.trim() ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const offset = Number(match[1]);
  const last = match[2] === '' ? Infinity : Number(match[2]);
  if (last < offset) return null;
  if (offset >= size) return 'unsatisfiable';
  return { offset, length: Math.min(last, size - 1) - offset + 1 };
}

const opaqueTag = (tag) => tag.trim().replace(/^W\//, '');

function notModified(request, object) {
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch) {
    return ifNoneMatch.trim() === '*' ||
      ifNoneMatch.split(',').some((tag) => opaqueTag(tag) === object.httpEtag);
  }
  const since = Date.parse(request.headers.get('If-Modified-Since') ?? '');
  return Number.isFinite(since) && Math.floor(object.uploaded.getTime() / 1000) * 1000 <= since;
}

// If-Range: only honor the Range header when the client's copy is this exact file.
function rangeStillValid(request, object) {
  const ifRange = request.headers.get('If-Range')?.trim();
  if (!ifRange) return true;
  if (ifRange.startsWith('"')) return ifRange === object.httpEtag;
  return ifRange === object.uploaded.toUTCString();
}

// Answers GET and HEAD for one bucket key, or returns null when the bucket doesn't have it.
export async function serveMedia(request, bucket, key) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const object = await bucket.head(key);
  if (!object) return null;

  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': CACHE_CONTROL,
    'Content-Type': object.httpMetadata?.contentType || mediaContentType(key),
    ETag: object.httpEtag,
    'Last-Modified': object.uploaded.toUTCString()
  });
  if (notModified(request, object)) return new Response(null, { status: 304, headers });

  const range = rangeStillValid(request, object) ? parseRange(request.headers.get('Range'), object.size) : null;
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  }
  headers.set('Content-Length', String(range ? range.length : object.size));
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });

  const body = await bucket.get(key, range ? { range } : undefined);
  if (!body) return null;
  return new Response(body.body, { status, headers });
}

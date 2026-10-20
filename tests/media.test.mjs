import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MEDIA_BUCKET, parseRange } from '../media.mjs';
import worker from '../worker.mjs';

const root = new URL('../', import.meta.url);
const VIDEO = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
const KEY = 'video/welcome-to-song-a-day.mp4';
const ETAG = '"abc123"';
const UPLOADED = new Date('2026-10-19T12:00:00Z');

// An R2 bucket stand-in that records every call.
function fakeBucket(objects = { [KEY]: VIDEO }) {
  const calls = [];
  const metadata = (key) => ({ key, size: objects[key].length, httpEtag: ETAG, uploaded: UPLOADED, httpMetadata: { contentType: 'video/mp4' } });
  return {
    calls,
    async head(key) {
      calls.push(['head', key]);
      return objects[key] ? metadata(key) : null;
    },
    async get(key, options) {
      calls.push(['get', key, options]);
      if (!objects[key]) return null;
      const { offset = 0, length = objects[key].length - offset } = options?.range ?? {};
      return { ...metadata(key), body: new Blob([objects[key].subarray(offset, offset + length)]).stream() };
    }
  };
}

function fetchVideo(headers = {}, { method = 'GET', path = '/assets/video/welcome-to-song-a-day.mp4', bucket = fakeBucket() } = {}) {
  const env = {
    MEDIA: bucket,
    ASSETS: { fetch: async () => new Response('asset', { headers: { 'Content-Type': 'image/webp' } }) }
  };
  return worker.fetch(new Request('https://songaday.studio' + path, { method, headers }), env);
}

const bytes = async (response) => new Uint8Array(await response.arrayBuffer());

test('parseRange handles first-last, open-ended, and suffix ranges', () => {
  const size = 5000;
  assert.deepEqual(parseRange('bytes=0-1023', size), { offset: 0, length: 1024 });
  assert.deepEqual(parseRange('bytes=0-1', size), { offset: 0, length: 2 });
  assert.deepEqual(parseRange('bytes=4000-', size), { offset: 4000, length: 1000 });
  assert.deepEqual(parseRange('bytes=-500', size), { offset: 4500, length: 500 });
  assert.deepEqual(parseRange('bytes=4999-4999', size), { offset: 4999, length: 1 });
  // Ends past the file are clamped, and a suffix longer than the file is the whole file.
  assert.deepEqual(parseRange('bytes=1000-999999999', size), { offset: 1000, length: 4000 });
  assert.deepEqual(parseRange('bytes=-999999', size), { offset: 0, length: 5000 });
});

test('parseRange rejects ranges past the end and ignores ones it cannot use', () => {
  const size = 5000;
  assert.equal(parseRange('bytes=5000-', size), 'unsatisfiable');
  assert.equal(parseRange('bytes=5000-6000', size), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', size), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable');
  for (const header of [null, '', 'bytes=-', 'bytes=10-5', 'bytes=0-1,5-6', 'items=0-1', 'bytes=a-b']) {
    assert.equal(parseRange(header, size), null, String(header));
  }
});

test('a byte range gets a 206 with exactly those bytes', async () => {
  const bucket = fakeBucket();
  const response = await fetchVideo({ Range: 'bytes=0-1023' }, { bucket });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-1023/5000');
  assert.equal(response.headers.get('Content-Length'), '1024');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  assert.equal(response.headers.get('ETag'), ETAG);
  assert.deepEqual(await bytes(response), VIDEO.subarray(0, 1024));
  assert.deepEqual(bucket.calls.at(-1), ['get', KEY, { range: { offset: 0, length: 1024 } }]);
});

test('Safari-style probes, open-ended, and suffix ranges', async () => {
  const cases = [
    ['bytes=0-1', 'bytes 0-1/5000', 0, 2],
    ['bytes=4096-', 'bytes 4096-4999/5000', 4096, 904],
    ['bytes=-100', 'bytes 4900-4999/5000', 4900, 100]
  ];
  for (const [range, contentRange, offset, length] of cases) {
    const response = await fetchVideo({ Range: range });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('Content-Range'), contentRange, range);
    assert.equal(response.headers.get('Content-Length'), String(length), range);
    assert.deepEqual(await bytes(response), VIDEO.subarray(offset, offset + length), range);
  }
});

test('without a Range header the whole video comes back, advertising ranges', async () => {
  const response = await fetchVideo();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('Content-Length'), '5000');
  assert.equal(response.headers.get('Content-Range'), null);
  assert.equal(response.headers.get('Last-Modified'), UPLOADED.toUTCString());
  assert.deepEqual(await bytes(response), VIDEO);
});

test('a range past the end gets a 416 naming the size', async () => {
  const response = await fetchVideo({ Range: 'bytes=5000-' });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('Content-Range'), 'bytes */5000');
});

test('HEAD answers with headers only and never reads the body', async () => {
  for (const [headers, status, length] of [[{}, 200, '5000'], [{ Range: 'bytes=100-199' }, 206, '100']]) {
    const bucket = fakeBucket();
    const response = await fetchVideo(headers, { method: 'HEAD', bucket });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Content-Length'), length);
    assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
    assert.equal(response.body, null);
    assert.ok(bucket.calls.every(([call]) => call === 'head'));
  }
});

test('revalidation and If-Range use the ETag', async () => {
  const cached = await fetchVideo({ 'If-None-Match': ETAG });
  assert.equal(cached.status, 304);
  assert.equal(cached.body, null);
  const changed = await fetchVideo({ 'If-None-Match': '"old"' });
  assert.equal(changed.status, 200);

  const sameFile = await fetchVideo({ Range: 'bytes=0-9', 'If-Range': ETAG });
  assert.equal(sameFile.status, 206);
  const replacedFile = await fetchVideo({ Range: 'bytes=0-9', 'If-Range': '"old"' });
  assert.equal(replacedFile.status, 200);
  assert.equal(replacedFile.headers.get('Content-Length'), '5000');
});

test('only GET and HEAD are allowed for videos', async () => {
  const response = await fetchVideo({}, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET, HEAD');
});

test('posters, other assets, and videos missing from R2 come from static assets', async () => {
  for (const path of ['/assets/video/welcome-to-song-a-day-poster.webp', '/assets/icons/tunes.png', '/assets/video/not-uploaded.mp4']) {
    const bucket = fakeBucket();
    const response = await fetchVideo({ Range: 'bytes=0-9' }, { path, bucket });
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), 'asset', path);
    assert.ok(bucket.calls.every(([call]) => call === 'head'), path);
  }
});

test('the MEDIA binding in wrangler.jsonc points at the bucket upload-media.mjs fills', async () => {
  const config = await readFile(new URL('wrangler.jsonc', root), 'utf8');
  assert.match(config, new RegExp(`"binding": "MEDIA",\\s*"bucket_name": "${MEDIA_BUCKET}"`));
});

test('every site video is under /assets/video/, which the Worker sends to R2', async () => {
  const html = await readFile(new URL('profile.html', root), 'utf8');
  const videos = [...html.matchAll(/(?:src|data-video-src)="([^"]+\.mp4)"/g)].map((match) => match[1]);
  assert.ok(videos.length >= 4, 'found the site videos');
  for (const video of videos) assert.match(video, /^assets\/video\/[^/]+\.mp4$/, video);
});

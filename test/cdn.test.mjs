import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../infra/cdn/worker.mjs';

function fixture() {
  const calls = [];
  const object = () => ({
    size: 7, httpEtag: '"version"', uploaded: new Date('2026-09-08T00:00:00Z'),
    writeHttpMetadata(headers) {
      headers.set('Content-Type', 'application/rss+xml');
      headers.set('Cache-Control', 'public,max-age=300');
    },
  });
  const env = { COMPANION: {
    async get(key) { calls.push(['get', key]); return { ...object(), body: new Response('release').body }; },
    async head(key) { calls.push(['head', key]); return object(); },
  } };
  const fetch = (path, init) => worker.fetch(new Request(`https://cdn.victor.computer${path}`, init), env);
  return { calls, env, fetch };
}

test('CDN strips the mount and streams release metadata and body', async () => {
  const { calls, fetch } = fixture();
  const response = await fetch('/companion/arm64/appcast.xml');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public,max-age=300');
  assert.equal(response.headers.get('Content-Length'), '7');
  assert.equal(await response.text(), 'release');
  assert.deepEqual(calls, [['get', 'arm64/appcast.xml']]);
});

test('CDN HEAD reads metadata only and matching ETags return 304', async () => {
  const { calls, fetch } = fixture();
  const head = await fetch('/companion/archive.zip', { method: 'HEAD' });
  assert.equal(await head.text(), '');
  assert.deepEqual(calls, [['head', 'archive.zip']]);
  const cached = await fetch('/companion/archive.zip', { headers: { 'If-None-Match': 'W/"version"' } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');
});

test('CDN rejects unknown mounts, malformed paths and writes without accessing R2', async () => {
  const { calls, fetch } = fixture();
  for (const path of ['/notate/a', '/constructor/a', '/companion/', '/companion/%2e%2e%2fsecret', '/companion/a%00']) {
    assert.equal((await fetch(path)).status, 404, path);
  }
  assert.equal((await fetch('/companion/%zz')).status, 400);
  assert.equal((await fetch('/companion/a', { method: 'PUT' })).status, 405);
  assert.deepEqual(calls, []);
});

test('CDN missing objects are not cached', async () => {
  const { env, fetch } = fixture();
  env.COMPANION.get = async () => null;
  const response = await fetch('/companion/missing.zip');
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

// Explicit mounts keep unrelated buckets private. Add new bindings here deliberately.
const mounts = { companion: 'COMPANION' };

export default {
  async fetch(request, env) {
    const reply = (text, status, headers = {}) => new Response(
      request.method === 'HEAD' ? null : text,
      { status, headers: { 'Cache-Control': 'no-store', ...headers } },
    );
    if (!['GET', 'HEAD'].includes(request.method)) {
      return reply('Method not allowed', 405, { Allow: 'GET, HEAD' });
    }
    let path;
    try { path = decodeURIComponent(new URL(request.url).pathname); }
    catch { return reply('Invalid path', 400); }
    const [, mount, ...parts] = path.split('/');
    const binding = Object.hasOwn(mounts, mount) && mounts[mount];
    if (!binding || !parts.length || parts.some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f]/.test(p))) {
      return reply('Not found', 404);
    }
    try {
      const key = parts.join('/');
      const object = request.method === 'HEAD'
        ? await env[binding].head(key)
        : await env[binding].get(key);
      if (!object) return reply('Not found', 404);
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('ETag', object.httpEtag);
      headers.set('Last-Modified', object.uploaded.toUTCString());
      headers.set('X-Content-Type-Options', 'nosniff');
      if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'public, max-age=300');
      const tags = request.headers.get('If-None-Match');
      if (tags && tags.split(',').some(t => t.trim() === '*' || t.trim().replace(/^W\//, '') === object.httpEtag)) {
        if (object.body) await object.body.cancel();
        return new Response(null, { status: 304, headers });
      }
      headers.set('Content-Length', String(object.size));
      // Stream whole objects; Range requests may legally receive a complete 200 response.
      return new Response(request.method === 'HEAD' ? null : object.body, { headers });
    } catch (error) {
      console.error(JSON.stringify({ event: 'cdn_read_failed', message: String(error) }));
      return reply('Temporarily unavailable', 503, { 'Retry-After': '5' });
    }
  },
};

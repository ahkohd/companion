import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {showcaseSnapshot} from './fixture.mjs';

const root = fileURLToPath(new URL('../../dist/', import.meta.url));
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json','.bin':'application/octet-stream'};
export async function startScreenshotServer({port = 0, theme = 'dark'} = {}) {
  const streams = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET') {res.writeHead(405); res.end('Screenshot preview is read-only.'); return;}
      if (url.pathname === '/api/events') {
        const source = new URL(req.headers.referer || '/', 'http://127.0.0.1');
        const module = source.searchParams.get('module') || 'face';
        if (!['face','usage'].includes(module)) {res.writeHead(400);res.end();return;}
        res.writeHead(200, {'Content-Type':'text/event-stream'});
        streams.add(res);
        res.write(`data: ${JSON.stringify(showcaseSnapshot(module, theme))}\n\n`);
        req.on('close', () => streams.delete(res));
        return;
      }
      if (url.pathname.startsWith('/api/')) {res.writeHead(404);res.end('No live integrations in screenshot preview.');return;}
      const target = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!target.startsWith(root)) {res.writeHead(403);res.end();return;}
      const data = await readFile(target);
      res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
      res.end(data);
    } catch {res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(port, '127.0.0.1', resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`, close:async () => {
    for (const stream of streams) stream.end();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }};
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const preview = await startScreenshotServer({port:Number(process.env.PORT || 4318)});
  console.log(`Read-only sample dashboard: ${preview.url}`);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => {await preview.close();process.exit();});
}

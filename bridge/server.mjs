import { AudioSource } from './audio-source.mjs';
import { Installations } from './installations.mjs';
import { AppSettings } from './app-settings.mjs';
import { DiagnosticLogs, installConsoleLogs } from './logs.mjs';
import { AttentionCallbacks } from './attention-callback.mjs';
import { Attention } from './attention.mjs';
import { SerialConnection } from './serial-connection.mjs';
import { SystemAppearance } from './system-appearance.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FaceStore } from './store.mjs';
import { HerdrClient } from './herdr.mjs';
import { DeviceLink } from './device.mjs';
import { PointerTracker } from './pointer.mjs';
import { DisplaySettings } from './display-settings.mjs';
import { StudioSettings } from './studio-settings.mjs';
import { ModuleSources } from './module-sources.mjs';
import { NowPlayingSource } from './now-playing-source.mjs';
import { openCard } from './open-card.mjs';

const appSettings = new AppSettings(process.env.COMPANION_NATIVE_TOKEN);
delete process.env.COMPANION_NATIVE_TOKEN;
const installations = new Installations({ home: process.env.COMPANION_INSTALL_HOME || undefined });
const logs = new DiagnosticLogs();
const restoreConsole = installConsoleLogs(logs);
const root = fileURLToPath(new URL('../dist/', import.meta.url));
let port = Number(process.env.PORT || 4317);
const store = new FaceStore();
const systemAppearance = new SystemAppearance(value => store.setSystemAppearance(value));
const herdr = new HerdrClient();
const pointer = new PointerTracker(store);
const sources = new ModuleSources();
const audio = new AudioSource();
const roon = new NowPlayingSource({ pairingPath: process.env.ROON_PAIRING_PATH || undefined });
let device, requestedArtId;
async function syncArtwork() {
  if (!device) return;
  const id = store.activeModule === 'roon' && studio.value.modules.roon.enabled ? roon.snapshot().artId || '' : '';
  if (id === requestedArtId) return;
  requestedArtId = id; device.setArtwork(null);
  if (!id) return;
  const art = await roon.artwork(id);
  if (requestedArtId === id && art) device.setArtwork(art);
}
let listening = false, closing = false;
let mutations = Promise.resolve();
const mutate = operation => {
  const pending = mutations.then(() => { if (closing) throw new Error('The bridge is shutting down.'); return operation(); }); mutations = pending.catch(() => {}); return pending;
};
const displaySettings = new DisplaySettings(store, { filePath: process.env.DISPLAY_SETTINGS_PATH || undefined });
// The legacy display file supplies the spacing only when no studio setting overrides it.
await displaySettings.load();
const studio = new StudioSettings(store, {
  filePath: process.env.STUDIO_SETTINGS_PATH || undefined,
  validateApply: settings => {
    if (closing) throw new Error('The bridge is shutting down. Try again after it restarts.');
    if (settings.device.followMouse && !pointer.supported) throw new Error('Follow mouse is available on macOS.');
  },
  onApply: settings => {
    if (closing) return;
    sources.configure(settings.modules);
    audio.configure({...settings.modules.audio,active:settings.device.activeModule==='audio'});
    roon.configure(settings.modules.roon);
    pointer.configure({ enabled: settings.device.followMouse, intervalMs: settings.device.mouseInterval });
    if (listening) {
      if (settings.modules.face.enabled) herdr.start();
      else { herdr.stop(); store.disconnect('Herdr module is off'); }
    }
  },
});
audio.on('change', snapshot => store.setSources({audio:snapshot}));
sources.on('change', snapshot => store.setSources(snapshot));
roon.on('change', snapshot => { store.setSources({ roon: snapshot }); void syncArtwork().catch(() => {}); });
await studio.load();
const attentionCallbacks = new AttentionCallbacks();
const attention = new Attention(store, { deliver: (target, result) => attentionCallbacks.deliver(target, result), filePath: path.join(path.dirname(studio.filePath), 'attention-settings.json') });
await attention.load();
await systemAppearance.start();
store.setSources({ roon: roon.snapshot(), audio:audio.snapshot() });
device = new DeviceLink(store, {
  onAttention: request => mutate(() => request.action === '__dismiss' ? attention.dismiss(request) : request.action === 'open' || request.action === 'back' ? attention.details({ ...request, detail: request.action === 'open' }) : attention.act(request)),
  onModule: direction => mutate(() => studio.cycleModule(direction)),
  onUsagePage: direction => mutate(() => store.cycleUsage(direction)),
  onHeyPage: direction => mutate(() => store.cycleHey(direction)),
  onOpenCard: request => mutate(() => openCard(store, request)),
  onAudioView: request => mutate(() => { if(store.activeModule!=='audio')throw Error('Show Audio first.'); return audio.view(request); }),
  onAudioPage: direction => mutate(() => { if(store.activeModule!=='audio')throw Error('Show Audio first.'); return audio.page({direction}); }),
  onAudioControl: request => mutate(() => { if(store.activeModule!=='audio')throw Error('Show Audio first.'); return audio.control(request); }),
  onRoonPlayer: direction => mutate(() => { if (store.activeModule !== 'roon') throw Error('Show Now Playing first.'); store.roonExpanded = false; return roon.select({ direction }); }),
  onRoonView: expanded => mutate(() => store.setRoonExpanded(expanded)),
  onRoonControl: (action, player) => mutate(() => {
    if (store.activeModule !== 'roon' || !studio.value.modules.roon.enabled) throw new Error('Show Now Playing on the device first.');
    return roon.control(action, player);
  }),
});
const connection = new SerialConnection(store, { link: device, filePath: path.join(path.dirname(studio.filePath), 'device-connection.json'), port: process.env.ESP_SERIAL_PORT || '' });
const streams = new Set();
const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const writeRoutes = ['show', 'update', 'clear', 'act', 'details', 'dismiss', 'configure'].map(action => `/api/attention/${action}`).concat(['/api/audio/view', '/api/audio/page', '/api/audio/control', '/api/installations', '/api/app-settings', '/api/native/sync', '/api/select', '/api/expression', '/api/pointer', '/api/display', '/api/settings', '/api/module', '/api/modules/refresh', '/api/usage/page', '/api/hey/page', '/api/roon/control', '/api/roon/player', '/api/roon/view', '/api/open-card', '/api/device/connection', '/api/device/refresh', '/api/device/reconnect']);
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, { error: 'Local access only' });
  let url;
  try { url = new URL(req.url, `http://127.0.0.1:${port}`); }
  catch { return send(res, 400, { error: 'Invalid URL' }); }
  if (url.pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify(store.snapshot())}\n\n`); streams.add(res);
    req.on('close', () => streams.delete(res)); return;
  }
  if (url.pathname === '/api/installations' && req.method === 'GET') {
    try { return send(res, 200, await installations.snapshot()); }
    catch (error) { return send(res, 500, { error: error.message }); }
  }
  if (url.pathname === '/api/app-settings' && req.method === 'GET') return send(res, 200, appSettings.snapshot());
  if (url.pathname === '/api/logs' && req.method === 'GET') return send(res, 200, logs.snapshot());
  if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, store.snapshot());
  if (url.pathname.startsWith('/api/roon/art/') && req.method === 'GET') {
    const id = url.pathname.slice('/api/roon/art/'.length);
    if (!/^[a-f0-9]{40}$/.test(id)) return send(res, 404, {error:'Artwork unavailable'});
    const art = await roon.artwork(id);
    if (!art) return send(res, 404, {error:'Artwork unavailable'});
    res.writeHead(200, {'Content-Type':art.mime,'Cache-Control':'private, max-age=3600'}); return res.end(art.bytes);
  }
  if (writeRoutes.includes(url.pathname) && req.method === 'POST') {
    if (url.pathname === '/api/native/sync' && !appSettings.authorized(req.headers['x-companion-token'])) return send(res, 403, { error: 'Native app authentication required' });
    if (req.headers.origin && !['http://127.0.0.1:5173', 'http://localhost:5173', `http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return send(res, 403, { error: 'Origin not allowed' });
    if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'Use JSON' });
    let body = '';
    try {
      // Settings can contain all animation mappings and provider choices. Serial frames
      // keep their separate 2048-byte limit in DeviceLink.
      let bytes = 0; const limit = (url.pathname === '/api/settings' || url.pathname.startsWith('/api/attention/')) ? 16384 : 1024;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) return send(res, 413, { error: 'Request too large' }); body += chunk; }
      const request = JSON.parse(body);
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Send a JSON object.');
      if (url.pathname === '/api/native/sync') return send(res, 200, appSettings.sync(request));
      if (url.pathname === '/api/installations') return send(res, 200, await installations.change(request));
      if (url.pathname === '/api/app-settings') return send(res, 200, await appSettings.change(request));
      if (url.pathname === '/api/modules/refresh') {
        await sources.refresh(request.id);
        return send(res, 200, store.snapshot());
      }
      const snapshot = await mutate(async () => {
        if (url.pathname.startsWith('/api/attention/')) { const result = await attention[url.pathname.split('/').at(-1)](request); return { ...store.snapshot(), attentionResult: result }; }
        if (url.pathname === '/api/device/connection') await connection.configure(request);
        else if (url.pathname === '/api/device/refresh') await connection.refresh();
        else if (url.pathname === '/api/device/reconnect') await connection.reconnect();
        else if (url.pathname === '/api/settings') await studio.save(request);
        else if (url.pathname === '/api/open-card') await openCard(store, request);
        else if (url.pathname === '/api/audio/view') audio.view(request);
        else if (url.pathname === '/api/audio/page') audio.page(request);
        else if (url.pathname === '/api/audio/control') await audio.control(request);
        else if (url.pathname === '/api/roon/player') { store.roonExpanded = false; roon.select(request); }
        else if (url.pathname === '/api/roon/view') store.setRoonExpanded(request.expanded);
        else if (url.pathname === '/api/roon/control') {
          if (!studio.value.modules.roon.enabled) throw new Error('Enable Now Playing first.');
          await roon.control(request.action, request.player);
        }
        else if (url.pathname === '/api/module') await studio.activateModule(request.id);
        else if (url.pathname === '/api/usage/page') store.cycleUsage(request.direction);
        else if (url.pathname === '/api/hey/page') store.cycleHey(request.direction);
        else if (url.pathname === '/api/pointer') await studio.save({ device: { followMouse: request.enabled, mouseInterval: request.intervalMs } });
        else if (url.pathname === '/api/display') await studio.save({ device: { textGap: request.textGap } });
        else {
          if (!studio.value.modules.face.enabled) throw new Error('Enable Herdr Face in Modules before selecting an agent or animation.');
          if (url.pathname === '/api/expression') store.validateExpression(request.expression);
          else store.validateSelection(request.id);
          await studio.activateModule('face');
          if (url.pathname === '/api/expression') store.setExpression(request.expression);
          else store.select(request.id);
        }
        return store.snapshot();
      });
      return send(res, 200, snapshot);
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
  try {
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const full = path.resolve(root, relative);
    if (!full.startsWith(root)) return send(res, 403, { error: 'Invalid path' });
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': mime[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { send(res, 404, { error: 'Page not found. Run npm run build first.' }); }
});
logs.observeDevice(store.device);
store.on('change', snapshot => {
  logs.observeDevice(snapshot.device);
  void syncArtwork().catch(() => {});
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const res of streams) { if (res.writableLength > 1024 * 1024) { res.destroy(); streams.delete(res); } else res.write(payload); }
});
herdr.on('agents', agents => store.ingest(agents));
herdr.on('offline', error => store.disconnect(error));
const keepAlive = setInterval(() => { for (const res of streams) res.write(': heartbeat\n\n'); }, 15000);
const clockTick = setInterval(() => { store.tickClock(); store.tickWorkingSessions(); }, 1000);
server.listen(port, '127.0.0.1', () => {
  listening = true; port = server.address().port; console.log(`Companion: http://127.0.0.1:${port}`);
  if (studio.value.modules.face.enabled) herdr.start();
  void connection.start().catch(error => store.setDevice({ status: 'disconnected', error: error.message })); void sources.start(); void roon.start(); audio.start();
});
server.on('error', error => { console.error(error.message); shutdown(); process.exitCode = 1; });
function shutdown() { if (closing) return; closing = true; listening = false; clearInterval(keepAlive); clearInterval(clockTick); appSettings.stop(); attention.stop(); attentionCallbacks.stop(); systemAppearance.stop(); sources.stop(); roon.stop(); audio.stop(); pointer.stop(); herdr.stop(); void connection.stop(); for (const res of streams) res.end(); server.close(); restoreConsole(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { defaultSettings, mergeSettings, MODULE_IDS } from '../bridge/studio-settings.mjs';

test('HTTP and SSE serve real state, restrict writes and shut down cleanly', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hf-http-'));
  const socketPath = path.join(directory, 'test.sock'); const peers = new Set();
  const herdr = net.createServer(socket => {
    peers.add(socket); socket.on('close', () => peers.delete(socket));
    let buffer = ''; socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk; if (!buffer.includes('\n')) return;
      const req = JSON.parse(buffer.trim());
      const result = req.method === 'agent.list' ? { agents: [{ pane_id: 'a', agent: 'pi', name: 'Test agent', agent_status: 'blocked' }] } : { type: 'subscribed' };
      socket.write(JSON.stringify({ id: req.id, result }) + '\n');
      if (req.method !== 'events.subscribe') socket.end();
    });
  });
  herdr.listen(socketPath); await once(herdr, 'listening');
  await writeFile(path.join(directory, 'codexbar'), `#!${process.execPath}\nconsole.log(process.argv.includes('--version') ? 'CodexBar 0.0.1' : JSON.stringify([{provider:'codex',usage:{primary:{usedPercent:25,windowMinutes:300},secondary:{usedPercent:12,windowMinutes:10080},extraRateWindows:[{id:'spark',title:'Codex Spark 5-hour',window:{usedPercent:4}}]}},{provider:'claude',usage:{primary:{usedPercent:10,windowMinutes:300},secondary:{usedPercent:15,windowMinutes:10080}}}]));\n`, { mode: 0o700 });
  await writeFile(path.join(directory, 'hey'), `#!${process.execPath}\nconst args=process.argv.slice(2);if(args[0]==='--version')console.log('HEY 0.0.1');else if(args[0]==='watch'){console.log(JSON.stringify({change:'ready'}));setInterval(()=>{},1000);}else console.log(JSON.stringify({items:Array.from({length:7},(_,i)=>({id:String(i+1),sender:'Sender '+(i+1),subject:'Subject '+(i+1)})),hasMore:true}));\n`, { mode: 0o700 });
  const studioPath = path.join(directory, 'studio.json');
  await writeFile(studioPath, JSON.stringify(mergeSettings(defaultSettings(), {
    device: { activeModule: 'face', moduleOrder: [...MODULE_IDS], followMouse: false },
    modules: { face: { enabled: true }, usage: { enabled: false }, hey: { enabled: false }, clock: { enabled: false } },
  })));
  const child = spawn(process.execPath, ['bridge/server.mjs'], { env: { ...process.env, PATH: directory + path.delimiter + process.env.PATH, HERDR_SOCKET_PATH: socketPath, ESP_SERIAL_PORT: '', DISPLAY_SETTINGS_PATH: path.join(directory, 'display.json'), STUDIO_SETTINGS_PATH: studioPath, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    for (const peer of peers) peer.destroy(); await new Promise(resolve => herdr.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const [output] = await once(child.stdout, 'data');
  const base = output.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; assert.ok(base, logs);
  const stream = await fetch(base + '/api/events'); const reader = stream.body.getReader();
  let streamText = '';
  while (!streamText.includes('Test agent')) streamText += new TextDecoder().decode((await reader.read()).value);
  assert.match(streamText, /"state":"blocked"/); await reader.cancel();
  const request = (body, headers = {}) => fetch(base + '/api/select', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  const selected = await request('{"id":"a"}'); assert.equal(selected.status, 200); assert.equal((await selected.json()).selected, 'a');
  assert.equal((await request('{"id":"all"}', { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request('{"id":"missing"}')).status, 400);
  assert.equal((await request('null')).status, 400);
  assert.equal((await request('x'.repeat(2048))).status, 413);
  const usb = (route, value, headers = {}) => fetch(base + '/api/device/' + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value)
  });
  const disconnected = await usb('connection', { mode: 'off' });
  assert.equal(disconnected.status, 200);
  assert.equal((await disconnected.json()).device.connection.mode, 'off');
  const ports = await usb('refresh', {});
  assert.equal(ports.status, 200);
  const usbState = (await ports.json()).device;
  assert.equal(usbState.status, 'disabled');
  assert.ok(Array.isArray(usbState.connection.ports));
  assert.equal((await usb('connection', { mode: 'manual', path: '/not-a-serial-device' })).status, 400);
  assert.equal((await usb('connection', { mode: 'invalid' })).status, 400);
  assert.equal((await usb('connection', { mode: 'auto' }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await usb('reconnect', {}, { Origin: 'https://example.com' })).status, 403);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'device-connection.json'), 'utf8')).mode, 'off');
  const spacing = (textGap, headers = {}) => fetch(base + '/api/display', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ textGap })
  });
  const close = await spacing(4); assert.equal(close.status, 200);
  assert.equal((await close.json()).layout.textGap, 4);
  for (const invalid of [0, 5, 100, '8', null]) assert.equal((await spacing(invalid)).status, 400);
  assert.equal((await spacing(16, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await (await fetch(base + '/api/state')).json()).layout.textGap, 4);
  const badHostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/state', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(base + '/%2e%2e%2fpackage.json')).status, 403);
  const state = await (await fetch(base + '/api/state')).json(); assert.equal(state.selected, 'a');
  const expression = (value, headers = {}) => fetch(base + '/api/expression', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ expression: value })
  });
  for (const value of ['working', 'blocked', 'done', 'idle', 'sleep']) {
    const response = await expression(value); assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.expression, value); assert.equal(snapshot.display.state, value);
    assert.equal(snapshot.agents[0].state, 'blocked');
  }
  assert.equal((await expression('constructor')).status, 400);
  assert.equal((await expression(undefined)).status, 400);
  assert.equal((await expression('done', { Origin: 'https://example.com' })).status, 403);
  const current = await (await fetch(base + '/api/state')).json(); assert.equal(current.expression, 'sleep');
  const restored = await (await expression(null)).json(); assert.equal(restored.display.state, 'blocked');
  assert.equal(restored.expression, null); assert.equal(restored.selected, 'a');
  const pointer = (value, headers = {}) => fetch(base + '/api/pointer', {
    method:'POST', headers:{'Content-Type':'application/json', ...headers}, body:JSON.stringify(value)
  });
  assert.equal(restored.pointer.enabled, false);
  assert.equal((await pointer({enabled:false,intervalMs:250})).status, 200);
  assert.equal((await pointer({enabled:true,intervalMs:20})).status, 400);
  assert.equal((await pointer({enabled:'yes',intervalMs:100})).status, 400);
  assert.equal((await pointer(null)).status, 400);
  assert.equal((await pointer({enabled:true,intervalMs:100}, {Origin:'https://example.com'})).status, 403);
  const pointerState = await (await fetch(base + '/api/state')).json();
  assert.equal(pointerState.pointer.enabled, false); assert.equal(pointerState.pointer.intervalMs, 250);
  await expression('done');
  assert.equal((await (await request('{"id":"all"}')).json()).expression, null);
  const post = (endpoint, value, headers = {}) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  const change = value => post('/api/settings', value);
  for (const endpoint of ['/api/settings', '/api/module', '/api/modules/refresh', '/api/usage/page', '/api/hey/page', '/api/roon/view', '/api/open-card']) {
    assert.equal((await post(endpoint, {}, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await post(endpoint, null)).status, 400);
    assert.equal((await post(endpoint, {}, { 'Content-Type': 'text/plain' })).status, 415);
  }
  assert.equal((await post('/api/open-card', {module:'hey',index:0,token:'a'.repeat(40)})).status, 400);
  const invalidView = await post('/api/roon/view', { expanded: 'true' });
  assert.equal(invalidView.status, 400); assert.match((await invalidView.json()).error, /on or off/);
  const unavailableView = await post('/api/roon/view', { expanded: true });
  assert.equal(unavailableView.status, 400); assert.match((await unavailableView.json()).error, /Show Roon/);
  assert.equal((await post('/api/module', { id: 'hey' })).status, 400);
  assert.equal((await post('/api/usage/page', { direction: 1 })).status, 400);
  assert.equal((await post('/api/modules/refresh', { id: 'face' })).status, 400);
  const detection = await (await post('/api/modules/refresh', { id: 'hey' })).json();
  assert.equal(detection.modules.hey.installed, true); assert.equal(detection.modules.hey.status, 'disabled');
  assert.equal(detection.modules.hey.updatedAt, null);
  const updates = await Promise.all([
    change({ modules: { usage: { enabled: true }, hey: { enabled: true } } }),
    change({ device: { textGap: 16, swipeEnabled: false } }),
    change({ mappings: { working: 'grok:happy', blocked: 'sleep' } }),
  ]);
  assert.ok(updates.every(response => response.status === 200));
  const studioState = await (await fetch(base + '/api/state')).json();
  assert.equal(studioState.settings.device.textGap, 16); assert.equal(studioState.settings.device.mouseInterval, 250);
  assert.equal(studioState.settings.modules.usage.enabled, true); assert.equal(studioState.settings.mappings.working, 'grok:happy');
  const usageModule = await (await post('/api/module', { id: 'usage' })).json(); assert.equal(usageModule.module, 'usage');
  const usage = await (await post('/api/modules/refresh', { id: 'usage' })).json();
  assert.equal(usage.display.dashboard.pageCount, 3); assert.equal(usage.display.dashboard.pageIndex, 0);
  const settingsBeforePages = await readFile(studioPath, 'utf8');
  const pages = await Promise.all([post('/api/usage/page', { direction: 1 }), post('/api/usage/page', { direction: 1 })]);
  assert.ok(pages.every(response => response.status === 200));
  const paged = await (await fetch(base + '/api/state')).json();
  assert.equal(paged.display.dashboard.pageIndex, 2); assert.equal(paged.display.dashboard.primary.provider, 'Claude');
  assert.equal(paged.display.dashboard.primary.label, 'Weekly'); assert.equal(paged.display.dashboard.secondary, undefined);
  assert.equal(paged.settingsRevision, usage.settingsRevision); assert.equal(await readFile(studioPath, 'utf8'), settingsBeforePages);
  assert.equal((await (await post('/api/usage/page', { direction: 1 })).json()).display.dashboard.pageIndex, 0);
  for (const direction of [undefined, null, '1', 0, 2, -2]) assert.equal((await post('/api/usage/page', { direction })).status, 400);
  assert.equal((await post('/api/usage/page', { direction: 1, padding: 'x'.repeat(1024) })).status, 413);
  await change({ modules: { usage: { provider: 'claude' } } });
  const filtered = await (await fetch(base + '/api/state')).json();
  assert.equal(filtered.display.dashboard.pageCount, 1); assert.equal(filtered.display.dashboard.primary.provider, 'Claude');
  assert.equal(filtered.modules.usage.providers.length, 2); assert.equal((await post('/api/usage/page', { direction: 1 })).status, 400);
  await change({ modules: { usage: { provider: 'auto' } } });
  const selectedFace = await (await expression('working')).json(); assert.equal(selectedFace.module, 'face');
  assert.equal(selectedFace.expression, 'working'); assert.equal(selectedFace.display.animation, undefined);
  await post('/api/module', { id: 'hey' });
  const mailbox = await (await post('/api/modules/refresh', { id: 'hey' })).json();
  assert.equal(mailbox.display.dashboard.pageCount, 4); assert.equal(mailbox.display.dashboard.items[0].sender, 'Sender 1');
  const settingsBeforeMailPages = await readFile(studioPath, 'utf8');
  const mailPages = await Promise.all([post('/api/hey/page', { direction: 1 }), post('/api/hey/page', { direction: 1 })]);
  assert.ok(mailPages.every(response => response.status === 200));
  const mailPaged = await (await fetch(base + '/api/state')).json();
  assert.equal(mailPaged.display.dashboard.pageIndex, 2); assert.deepEqual(mailPaged.display.dashboard.items, [{ sender: 'Sender 5', subject: 'Subject 5' }, { sender: 'Sender 6', subject: 'Subject 6' }]);
  const mailLast = await (await post('/api/hey/page', { direction: 1 })).json();
  assert.equal(mailLast.display.dashboard.pageIndex, 3);
  assert.deepEqual(mailLast.display.dashboard.items, [{ sender: 'Sender 7', subject: 'Subject 7' }]);
  assert.equal(await readFile(studioPath, 'utf8'), settingsBeforeMailPages);
  assert.equal((await (await post('/api/hey/page', { direction: 1 })).json()).display.dashboard.pageIndex, 0);
  for (const direction of [undefined, null, '1', 0, 2, -2]) assert.equal((await post('/api/hey/page', { direction })).status, 400);
  assert.equal((await post('/api/usage/page', { direction: 1 })).status, 400);
  assert.equal((await (await request('{"id":"all"}')).json()).module, 'face');
  await change({ modules: { face: { enabled: false } } });
  assert.equal((await expression('working')).status, 400); assert.equal((await request('{"id":"all"}')).status, 400);
  assert.equal((await (await fetch(base + '/api/state')).json()).module, 'usage');
  assert.equal((await change({ modules: { usage: { enabled: false }, hey: { enabled: false } } })).status, 400);
  for (const invalid of [{ mappings: { working: 'grok:missing' } }, { modules: { usage: { providers: ['bad_id'] } } }, { device: { moduleOrder: ['face', 'face', 'hey'] } }, { unexpected: true }]) {
    assert.equal((await change(invalid)).status, 400);
  }
  const persisted = JSON.parse(await readFile(studioPath, 'utf8'));
  assert.equal(persisted.device.textGap, 16); assert.equal(persisted.device.followMouse, false); assert.equal(persisted.device.mouseInterval, 250);
  assert.equal(persisted.device.activeModule, 'usage'); assert.equal(persisted.mappings.working, 'grok:happy');
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  assert.equal((await exited)[0], 0, logs);
});

test('clock-only HTTP settings persist and SSE advances without Herdr or an attached device', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-clock-http-'));
  const studioPath = path.join(directory, 'studio.json'), callsPath = path.join(directory, 'calls.jsonl');
  await writeFile(studioPath, JSON.stringify(mergeSettings(defaultSettings(), {
    modules: {
      face: { enabled: false }, usage: { enabled: false }, hey: { enabled: false },
      clock: { enabled: true, hourFormat: '12', showWeekday: true },
    },
    device: { activeModule: 'clock', followMouse: false },
  })));
  const preload = path.join(directory, 'clock-time.mjs');
  await writeFile(preload, 'const start = performance.now(); const base = new Date(2026, 8, 9, 23, 59).getTime(); Date.now = () => base + Math.floor((performance.now() - start) / 2000) * 60000;\n');
  for (const command of ['codexbar', 'hey']) await writeFile(path.join(directory, command),
    `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(process.env.CLOCK_CALLS,JSON.stringify([${JSON.stringify(command)},process.argv.slice(2)])+'\\n');console.log('CLI 1.0.0');\n`, { mode: 0o700 });
  const child = spawn(process.execPath, ['--import', preload, 'bridge/server.mjs'], {
    env: { ...process.env, TZ: 'UTC', CLOCK_CALLS: callsPath, PATH: directory + path.delimiter + process.env.PATH,
      HERDR_SOCKET_PATH: path.join(directory, 'absent.sock'), ESP_SERIAL_PORT: '',
      DISPLAY_SETTINGS_PATH: path.join(directory, 'display.json'), STUDIO_SETTINGS_PATH: studioPath, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = ''; child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    await rm(directory, { recursive: true, force: true });
  });
  const [output] = await once(child.stdout, 'data');
  const base = output.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; assert.ok(base, logs);
  const initial = await (await fetch(base + '/api/state')).json();
  assert.equal(initial.module, 'clock'); assert.equal(initial.connected, false); assert.equal(initial.device.status, 'disabled');
  assert.equal(initial.display.dashboard.time, '11:59'); assert.equal(initial.display.dashboard.weekday, 'Wed');
  const stream = await fetch(base + '/api/events', { signal: AbortSignal.timeout(5000) });
  const reader = stream.body.getReader(); let data = '';
  while (!data.includes('12:00')) data += new TextDecoder().decode((await reader.read()).value);
  assert.match(data, /"weekday":"Thu"/); await reader.cancel();
  const change = patch => fetch(base + '/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  const response = await change({ modules: { clock: { hourFormat: '24', showWeekday: false } } });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.module, 'clock'); assert.equal(updated.display.dashboard.time, '00:00');
  assert.equal(updated.display.dashboard.weekday, '');
  assert.deepEqual(updated.settings.modules.clock, { enabled: true, hourFormat: '24', showWeekday: false, blinkSeparator: true });
  assert.deepEqual(JSON.parse(await readFile(studioPath, 'utf8')), updated.settings);
  assert.equal((await change({ modules: { clock: { enabled: false } } })).status, 400);
  const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.sort((a, b) => a[0].localeCompare(b[0])), [['codexbar', ['--version']], ['hey', ['--version']]]);
  const exited = once(child, 'exit'); child.kill('SIGTERM'); assert.equal((await exited)[0], 0, logs);
});

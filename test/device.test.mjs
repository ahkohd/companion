import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceStore } from '../bridge/store.mjs';
import { DeviceLink } from '../bridge/device.mjs';
import { mergeSettings } from '../bridge/studio-settings.mjs';
import { setImmediate as turn } from 'node:timers/promises';

function setup() {
  const store = new FaceStore(); store.ingest([{ pane_id: 'a', agent: 'pi', agent_status: 'working' }]);
  const link = new DeviceLink(store); const frames = [];
  link.port = { isOpen: true, write: (frame, cb) => { frames.push(JSON.parse(frame)); cb(); } };
  store.on('change', link.onChange);
  return { store, link, frames };
}
const ready = '{"type":"ready","v":1,"board":"waveshare-1.75-b"}\n';

test('no writes until the expected board announces this protocol', () => {
  const { link, frames } = setup(); link.send();
  link.receive('{"type":"ready","v":1,"board":"different"}\n');
  assert.equal(frames.length, 0);
  link.receive(ready.slice(0, 15)); assert.equal(frames.length, 0);
  link.receive(ready.slice(15)); assert.ok(frames.length > 0);
  assert.equal(frames.at(-1).state, 'working');
});

test('acknowledgement does not create a serial feedback loop', () => {
  const { store, link, frames } = setup(); link.receive(ready);
  const count = frames.length;
  link.receive(JSON.stringify({ type: 'ack', v: 1, seq: store.seq }) + '\n');
  assert.equal(frames.length, count); assert.ok(store.device.lastAck);
  link.receive('{"type":"cycle","v":1}\n');
  assert.equal(store.selected, 'a'); assert.equal(frames.length, count + 1);
});

test('all-agent lower-line changes reach the device through the existing title field', () => {
  const { store, link, frames } = setup();
  link.receive(ready);
  const working = { pane_id: 'a', agent: 'pi', name: 'Session title', agent_status: 'working' };
  const other = { pane_id: 'b', agent: 'pi', agent_status: 'done' };
  store.ingest([working, other]);
  assert.equal(frames.at(-1).label, 'Working');
  assert.equal(frames.at(-1).name, 'Session title');
  store.ingest([working, { ...other, agent_status: 'idle' }]);
  assert.equal(frames.at(-1).name, 'Session title');
  store.select('a');
  assert.equal(frames.at(-1).label, 'Working');
  assert.equal(frames.at(-1).name, 'Session title');
});

test('malformed, null, version-mismatched and oversized lines recover', () => {
  const { link, frames } = setup();
  link.receive('factory log\nnull\n{"type":"ready","v":2}\n' + 'x'.repeat(2048));
  link.receive(ready); assert.equal(frames.length, 0);
  link.receive(ready); assert.ok(frames.length > 0);
});

test('a state change during a write is sent immediately after it', () => {
  const { store, link, frames } = setup(); let complete;
  link.port.write = (frame, callback) => { frames.push(JSON.parse(frame)); complete = callback; };
  link.receive(ready); assert.equal(frames.length, 1);
  store.select('a'); assert.equal(frames.length, 1);
  complete(); assert.equal(frames.length, 2); assert.equal(frames[1].name, 'pi');
  assert.equal(frames[1].seq, store.seq); complete();
});

test('playground selections reach serial and physical cycling returns to live', () => {
  const { store, link, frames } = setup(); link.receive(ready);
  store.setExpression('sleep');
  assert.equal(frames.at(-1).state, 'sleep'); assert.equal(frames.at(-1).preview, true);
  link.receive(JSON.stringify({ type: 'ack', v: 1, seq: store.seq }) + '\n');
  assert.equal(store.device.lastAckSeq, store.seq);
  link.receive('{"type":"cycle","v":1}\n');
  assert.equal(store.expression, null); assert.equal(frames.at(-1).state, 'working');
  assert.equal(frames.at(-1).preview, false);
});

test('render diagnostics publish once per ack and reject invalid decoration counts', () => {
  const {store,link}=setup();link.receive(ready);
  let updates=0;store.on('change',()=>updates++);
  const ack={type:'ack',v:1,seq:store.seq,rendered_seq:store.seq,render_us:24000,eyes:[[24,46],[20,38]],decor_count:20,shimmer_pixels:400,text_gap:8,status_top:360};
  link.receive(JSON.stringify(ack)+'\n');
  assert.equal(updates,1);assert.equal(store.device.renderedDecorCount,20);
  assert.equal(store.device.renderedShimmerPixels,400);
  assert.equal(store.device.renderedTextGap,8);assert.equal(store.device.renderedStatusTop,360);
  link.receive(JSON.stringify({...ack,decor_count:25,shimmer_pixels:25201,text_gap:16,status_top:360})+'\n');
  assert.equal(updates,2);assert.equal(store.device.renderedDecorCount,20);
  assert.equal(store.device.renderedShimmerPixels,400);
  assert.equal(store.device.renderedTextGap,8);assert.equal(store.device.renderedStatusTop,360);
});

test('clip diagnostics identify the rendered animation and reject malformed values', () => {
  const {store,link,frames}=setup();link.receive(ready);
  const ack={type:'ack',v:1,seq:store.seq,rendered_seq:store.seq,render_us:16000,eyes:[[18,41],[18,41]],clip:47,clip_frame:40,clip_hash:0xffffffff};
  const writes=frames.length;
  link.receive(JSON.stringify(ack)+'\n');
  assert.equal(store.device.renderedAnimation,'grok:spin-burst');assert.equal(store.device.renderedClipFrame,40);assert.equal(store.device.renderedClipHash,0xffffffff);
  for(const invalid of [{clip:48},{clip:-1},{clip:'1'},{clip_frame:3601},{clip_frame:-2},{clip_hash:-1},{clip_hash:0x100000000}]) {
    link.receive(JSON.stringify({...ack,...invalid})+'\n');assert.equal(store.device.renderedAnimation,'grok:spin-burst');assert.equal(store.device.renderedClipFrame,40);assert.equal(store.device.renderedClipHash,0xffffffff);
  }
  link.receive(JSON.stringify({...ack,clip:0,clip_frame:-1,clip_hash:0})+'\n');
  assert.equal(store.device.renderedAnimation,null);assert.equal(store.device.renderedClipFrame,-1);assert.equal(store.device.renderedClipHash,0);
  assert.equal(frames.length,writes,'Diagnostics must not create a serial write loop');
});

test('device swipes validate direction, obey the setting and persist before changing modules', async () => {
  const { store, link } = setup();
  store.setSettings(mergeSettings(store.settings, { modules: { usage: { enabled: true }, hey: { enabled: true } } }));
  const directions = []; let apply;
  link.onModule = direction => { directions.push(direction); return new Promise(resolve => { apply = () => { store.cycleModule(direction); resolve(); }; }); };
  link.receive('{"type":"module","v":1,"direction":1}\n'); await turn(); assert.deepEqual(directions, []);
  link.receive(ready); link.receive('{"type":"module","v":1,"direction":1}\n'); await turn();
  assert.deepEqual(directions, [1]); assert.equal(store.activeModule, 'face'); apply(); await turn();
  assert.equal(store.activeModule, 'usage');
  link.receive('{"type":"cycle","v":1}\n'); assert.equal(store.selected, 'all');
  for (const direction of [0, 2, '1', null]) link.receive(JSON.stringify({ type: 'module', v: 1, direction }) + '\n');
  await turn(); assert.equal(directions.length, 1);
  store.setSettings(mergeSettings(store.settings, { device: { swipeEnabled: false } }));
  link.receive('{"type":"module","v":1,"direction":-1}\n'); await turn(); assert.equal(directions.length, 1);
});

test('failed module persistence keeps the device on its current module with a safe error', async () => {
  const { store, link } = setup(); store.setSettings(mergeSettings(store.settings, { modules: { usage: { enabled: true } } }));
  link.onModule = async () => { throw new Error('private filesystem details'); }; link.receive(ready);
  link.receive('{"type":"module","v":1,"direction":1}\n'); await turn();
  assert.equal(store.activeModule, 'face'); assert.match(store.device.error, /Could not save/); assert.doesNotMatch(store.device.error, /private/);
});

test('module diagnostics identify only known modules for validated completed frames', () => {
  const { store, link, frames } = setup(); link.receive(ready);
  const ack = { type: 'ack', v: 1, seq: store.seq, rendered_seq: store.seq, render_us: 16000, eyes: [[0, 0], [0, 0]] };
  const writes = frames.length;
  for (const module of ['usage', 'hey', 'clock', 'face']) {
    link.receive(JSON.stringify({ ...ack, module }) + '\n'); assert.equal(store.device.renderedModule, module);
  }
  link.receive(JSON.stringify({ ...ack, module: 'malformed' }) + '\n'); assert.equal(store.device.renderedModule, 'face');
  link.receive(JSON.stringify({ ...ack, rendered_seq: store.seq + 1, module: 'hey' }) + '\n'); assert.equal(store.device.renderedModule, 'face');
  assert.equal(frames.length, writes);
});

test('vertical usage gestures validate protocol and state independently of module swipes', async () => {
  const { store, link, frames } = setup();
  const sources = { usage: { status: 'ready', providers: [{ id: 'claude', label: 'Claude', windows: Array.from({ length: 3 }, (_, index) => ({ id: String(index), label: `Window ${index}`, usedPercent: 10, resetAt: null })) }] } };
  store.setSettings(mergeSettings(store.settings, { modules: { usage: { enabled: true } }, device: { swipeEnabled: false } }));
  store.setSources(sources); store.setModule('usage');
  const page = direction => link.receive(JSON.stringify({ type: 'usage-page', v: 1, direction }) + '\n');
  page(1); await turn(); assert.equal(store.usagePage, 0);
  link.receive(ready);
  for (const direction of [0, 2, '1', null, undefined]) page(direction);
  link.receive('{"type":"usage-page","v":2,"direction":1}\n');
  await turn(); assert.equal(store.usagePage, 0);
  page(1); await turn(); assert.equal(store.usagePage, 1); assert.equal(frames.at(-1).dashboard.pageIndex, 1);
  assert.equal(frames.at(-1).dashboard.primary.provider, 'Claude');
  page(1); await turn(); assert.equal(store.usagePage, 0);
  store.setModule('face'); page(1); await turn(); assert.equal(store.usagePage, 0);
  store.setModule('usage'); store.setSources({ usage: { ...sources.usage, status: 'loading' } });
  page(1); await turn(); assert.equal(store.usagePage, 0);
  store.setSources(sources); store.setSettings(mergeSettings(store.settings, { modules: { usage: { enabled: false } } }));
  page(1); await turn(); assert.equal(store.usagePage, 0);
});


test('vertical mailbox gestures validate protocol and require the current ready HEY module', async () => {
  const { store, link, frames } = setup();
  const sources = { hey: { status: 'ready', selectedBox: 'imbox', hasMore: true, items: Array.from({ length: 4 }, (_, index) => ({ id: String(index + 1), sender: `Sender ${index}`, subject: `Subject ${index}` })) } };
  store.setSettings(mergeSettings(store.settings, { modules: { hey: { enabled: true } }, device: { activeModule: 'hey', swipeEnabled: false } }));
  store.setSources(sources);
  const page = direction => link.receive(JSON.stringify({ type: 'hey-page', v: 1, direction }) + '\n');
  page(1); await turn(); assert.equal(store.heyPage, 0);
  link.receive(ready);
  for (const direction of [0, 2, '1', null, undefined]) page(direction);
  link.receive('{"type":"hey-page","v":2,"direction":1}\n');
  await turn(); assert.equal(store.heyPage, 0);
  page(1); await turn(); assert.equal(store.heyPage, 1); assert.equal(frames.at(-1).dashboard.items[0].sender, 'Sender 2');
  page(1); await turn(); assert.equal(store.heyPage, 0);
  store.setModule('face'); page(1); await turn(); assert.equal(store.heyPage, 0);
  store.setModule('hey'); store.setSources({ hey: { ...sources.hey, status: 'loading' } });
  page(1); await turn(); assert.equal(store.heyPage, 0);
  store.setSources(sources); store.setSettings(mergeSettings(store.settings, { modules: { hey: { enabled: false } } }));
  page(1); await turn(); assert.equal(store.heyPage, 0);
});

test('panel transfer diagnostics distinguish accepted settings from pixel transfers', () => {
  const { store, link } = setup(); link.receive(ready);
  const ack = { type: 'ack', v: 1, seq: store.seq, rendered_seq: store.seq, render_us: 10,
    eyes: [[0, 0], [0, 0]], rotation: 22, panel_transfers: 8, panel_error: 257, panel_rotation: 0 };
  link.receive(JSON.stringify(ack) + '\n');
  assert.equal(store.device.renderedRotation, 22);
  assert.equal(store.device.panelRotation, 0);
  assert.equal(store.device.panelError, 257);
  link.receive(JSON.stringify({ ...ack, panel_transfers: 9, panel_error: 0, panel_rotation: 22 }) + '\n');
  assert.equal(store.device.panelTransfers, 9);
  assert.equal(store.device.panelError, 0);
  assert.equal(store.device.panelRotation, 22);
  link.receive(JSON.stringify({ ...ack, panel_transfers: -1 }) + '\n');
  assert.equal(store.device.panelTransfers, 9);
});


test('panel failures remain visible on healthy USB and clear only their own recovered error', () => {
  const { store, link, frames } = setup(); link.receive(ready);
  const writes = frames.length;
  const ack = { type: 'ack', v: 1, seq: store.seq, rendered_seq: store.seq, render_us: 10000, eyes: [[20,40],[20,40]], panel_transfers: 12, panel_rotation: 85, panel_error: 257 };
  const receive = fields => link.receive(JSON.stringify({ ...ack, ...fields }) + '\n');
  receive({});
  assert.equal(store.device.status, 'connected'); assert.equal(store.device.panelError, 257);
  assert.match(store.device.error, /Display transfer failed \(257\)/); assert.match(store.device.error, /USB is connected/);
  const failure = store.device.error;
  receive({ panel_error: -1 }); assert.equal(store.device.error, failure);
  receive({ panel_error: 0 }); assert.equal(store.device.error, null); assert.equal(store.device.panelError, 0);
  receive({ panel_error: 258 }); assert.match(store.device.error, /258/);
  store.setDevice({ error: 'Another error' }); receive({ panel_error: 0 }); assert.equal(store.device.error, 'Another error');
  assert.equal(frames.length, writes, 'Panel diagnostics must not trigger serial writes');
});

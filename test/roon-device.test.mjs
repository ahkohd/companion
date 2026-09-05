import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import { DeviceLink } from '../bridge/device.mjs';
import { FaceStore } from '../bridge/store.mjs';
import { mergeSettings } from '../bridge/studio-settings.mjs';

const ready = JSON.stringify({ type: 'ready', v: 1, board: 'waveshare-1.75-b' }) + '\n';
const artwork = id => ({ id: id.repeat(40), width: 160, height: 160, pixels: Buffer.from(Array.from({ length: 51200 }, (_, i) => i % 251)) });
const cjson = '.tools/esp-idf/components/json/cJSON';
const nativeAvailable = existsSync(path.join(cjson, 'cJSON.c'));
let directory, parser;
before(async () => {
  if (!nativeAvailable) return;
  directory = await mkdtemp(path.join(os.tmpdir(), 'roon-artwork-'));
  parser = path.join(directory, 'art');
  execFileSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', 'firmware/main', '-I', cjson,
    'test/roon-art-probe.c', 'firmware/main/roon_artwork.c', path.join(cjson, 'cJSON.c'), '-lm', '-o', parser]);
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
function setup(t) {
  const store = new FaceStore(), frames = [], link = new DeviceLink(store);
  link.port = { isOpen: true, write(frame, done) { frames.push(JSON.parse(frame)); done(); }, close() { this.isOpen = false; } };
  store.on('change', link.onChange); t.after(() => link.stop());
  return { store, frames, link };
}
function ack(link, patch = {}) {
  const packet = link.artPacket;
  assert.ok(packet);
  link.receive(JSON.stringify({ type: 'artAck', v: 1, transfer: packet.frame.transfer, op: packet.frame.op,
    ok: true, offset: packet.expected, ...patch }) + '\n');
}
function finish(link) { for (let i = 0; link.artPacket && i < 100; i++) ack(link); assert.equal(link.artPacket, null); }
function native(frames) {
  return execFileSync(parser, [], { input: frames.map(JSON.stringify).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
}

test('artwork upload is bounded, acknowledged, copied from the caller and reuploaded after ready', t => {
  const { link, frames } = setup(t), art = artwork('a'), expected = Buffer.from(art.pixels);
  link.setArtwork(art); art.pixels.fill(0); assert.equal(frames.length, 0);
  link.receive(ready); const initial = frames.filter(frame => frame.type === 'art');
  assert.equal(initial.length, 1); assert.equal(initial[0].op, 'begin');
  ack(link, { transfer: initial[0].transfer + 1 }); assert.equal(frames.filter(frame => frame.type === 'art').length, 1);
  ack(link, { offset: 51201 }); assert.equal(frames.filter(frame => frame.type === 'art').length, 1);
  finish(link);
  const artFrames = frames.filter(frame => frame.type === 'art');
  assert.equal(artFrames.at(-1).op, 'commit');
  assert.deepEqual(Buffer.concat(artFrames.filter(frame => frame.op === 'chunk').map(frame => Buffer.from(frame.data, 'base64'))), expected);
  assert.ok(artFrames.every(frame => Buffer.byteLength(JSON.stringify(frame) + '\n') <= 2048));
  const count = frames.length; link.setArtwork(artwork('a')); assert.equal(frames.length, count);
  link.receive(ready); assert.equal(link.artPacket.frame.op, 'begin');
  assert.notEqual(link.artPacket.frame.transfer, initial[0].transfer); finish(link);
});

test('state writes retain priority during artwork writes and while waiting for artwork acknowledgements', t => {
  const { link, store, frames } = setup(t); link.receive(ready);
  let complete;
  link.port.write = (frame, done) => { frames.push(JSON.parse(frame)); complete = done; };
  link.setArtwork(artwork('a')); assert.equal(frames.at(-1).type, 'art');
  store.setExpression('working'); assert.equal(frames.at(-1).type, 'art');
  complete(); assert.equal(frames.at(-1).type, 'state'); assert.equal(frames.at(-1).seq, store.seq); complete();
  assert.equal(link.artPacket.frame.op, 'begin');
  link.send(); assert.equal(frames.at(-1).type, 'state'); complete();
  ack(link); assert.equal(frames.at(-1).op, 'chunk'); complete();
});

test('changing tracks cancels stale artwork acknowledgements and clearing art sends a bounded cancel', t => {
  const { link, frames } = setup(t); link.receive(ready); link.setArtwork(artwork('a'));
  const stale = { ...link.artPacket.frame }; link.setArtwork(artwork('b'));
  const transfer = link.artPacket.frame.transfer;
  link.receive(JSON.stringify({ ...stale, type: 'artAck', ok: true, offset: 0 }) + '\n');
  assert.equal(link.artPacket.frame.transfer, transfer); assert.equal(link.artPacket.frame.op, 'begin');
  finish(link); link.setArtwork(null); assert.equal(frames.at(-1).op, 'cancel'); ack(link);
  assert.equal(link.artTransfer, null); assert.equal(link.artwork, null);
});

test('artwork rejects invalid buffers, retries a dropped packet and reports a failed upload without blocking state', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { link, store, frames } = setup(t);
  for (const patch of [{ id: 'a'.repeat(41) }, { width: 161 }, { height: 0 }, { pixels: Buffer.alloc(51201) }, { pixels: [] }])
    assert.throws(() => link.setArtwork({ ...artwork('a'), ...patch }), TypeError);
  link.receive(ready); link.setArtwork(artwork('a'));
  const packet = frames.at(-1); t.mock.timers.tick(1500); assert.deepEqual(frames.at(-1), packet);
  t.mock.timers.tick(1500); assert.deepEqual(frames.at(-1), packet);
  t.mock.timers.tick(1500); assert.match(store.device.error, /did not acknowledge/); assert.equal(link.artTransfer, null);
  store.setExpression('working'); assert.equal(frames.at(-1).type, 'state');
  link.receive(ready); assert.equal(link.artPacket.frame.op, 'begin'); ack(link, { ok: false });
  assert.match(store.device.error, /rejected/);
});

test('native artwork receiver matches bridge uploads and keeps committed pixels atomic through retries', { skip: !nativeAvailable }, t => {
  const { link, frames } = setup(t); link.receive(ready); link.setArtwork(artwork('a')); finish(link);
  const upload = frames.filter(frame => frame.type === 'art');
  const trace = [upload[0], upload[0], upload[1], upload[1], ...upload.slice(2), upload.at(-1)];
  const results = native(trace);
  assert.ok(results.every(result => result.ok));
  assert.ok(results.slice(0, -2).every(result => result.id === '' && result.revision === 0));
  assert.equal(results.at(-1).id, 'a'.repeat(40)); assert.equal(results.at(-1).crc32, upload[0].crc32);
  assert.equal(results.at(-1).revision, 1);
});

test('native artwork receiver rejects malformed chunks, incomplete images, stale transfers and bad checksums', { skip: !nativeAvailable }, t => {
  const { link, frames } = setup(t); link.receive(ready); link.setArtwork(artwork('a')); finish(link);
  const upload = frames.filter(frame => frame.type === 'art'), begin = upload[0], chunk = upload[1], commit = upload.at(-1);
  const invalid = [
    { ...begin, width: 159 }, { ...begin, id: 'g'.repeat(40) },
    { ...chunk, offset: 1 }, { ...chunk, offset: -1 }, { ...chunk, offset: 51200 },
    ...['!', 'AAAAA', 'AB==', 'AAB=', '=AAA', 'AA=A', 'AAAA'.repeat(257)].map(data => ({ ...chunk, data })),
    commit,
  ];
  const invalidResults = native([begin, ...invalid]);
  assert.equal(invalidResults[0].ok, true); assert.ok(invalidResults.slice(1).every(result => !result.ok));
  const replacement = { ...begin, transfer: begin.transfer + 1, id: 'b'.repeat(40) };
  const stale = native([begin, chunk, replacement, chunk, commit, { ...commit, op: 'cancel' }]);
  assert.ok(stale.slice(3).every(result => !result.ok && result.active && !result.id));
  const badChecksum = native([{ ...begin, crc32: begin.crc32 ^ 1 }, ...upload.slice(1)]);
  assert.equal(badChecksum.at(-1).ok, false); assert.equal(badChecksum.at(-1).id, '');
  const cleared = native([...upload, { ...commit, op: 'cancel' }, chunk]);
  assert.equal(cleared.at(-2).ok, true); assert.equal(cleared.at(-2).id, ''); assert.equal(cleared.at(-1).ok, false);
});

test('bridge restart can replace committed art or resume a partial image even with a reused transfer number', { skip: !nativeAvailable }, t => {
  const first = setup(t); first.link.artCounter = 0;
  first.link.receive(ready); first.link.setArtwork(artwork('a')); finish(first.link);
  const original = first.frames.filter(frame => frame.type === 'art');
  const replacement = setup(t); replacement.link.artCounter = 0;
  const changed = artwork('b'); changed.pixels.fill(0x3c);
  replacement.link.receive(ready); replacement.link.setArtwork(changed); finish(replacement.link);
  const next = replacement.frames.filter(frame => frame.type === 'art');
  assert.equal(next[0].transfer, original[0].transfer);
  const complete = native([...original, ...next]);
  assert.ok(complete.every(result => result.ok));
  assert.equal(complete.at(-1).id, changed.id); assert.equal(complete.at(-1).crc32, next[0].crc32);
  assert.equal(complete.at(-1).revision, 2);

  const resumed = setup(t); resumed.link.artCounter = 0;
  resumed.link.receive(ready); resumed.link.setArtwork(artwork('a'));
  ack(resumed.link, { offset: 768 });
  assert.equal(resumed.link.artPacket.frame.offset, 768); finish(resumed.link);
  const continuation = resumed.frames.filter(frame => frame.type === 'art');
  const partial = native([...original.slice(0, 2), ...continuation]);
  assert.ok(partial.every(result => result.ok));
  assert.equal(partial[2].offset, 768); assert.equal(partial.at(-1).id, 'a'.repeat(40));
  assert.equal(partial.at(-1).crc32, original[0].crc32);
});

test('device Roon controls require an enabled active module and validated actions', async t => {
  const { link, store } = setup(t), actions = []; link.onRoonControl = action => actions.push(action);
  const control = action => link.receive(JSON.stringify({ type: 'roon-control', v: 1, action }) + '\n');
  control('next'); link.receive(ready); control('next'); await turn(); assert.deepEqual(actions, []);
  store.setSettings(mergeSettings(store.settings, { modules: { roon: { enabled: true } }, device: { activeModule: 'roon' } }));
  for (const action of ['previous', 'next', 'playpause', 'stop', null, 1]) control(action);
  await turn(); assert.deepEqual(actions, ['previous', 'next', 'playpause']);
  store.setModule('face'); control('next'); await turn(); assert.equal(actions.length, 3);
});

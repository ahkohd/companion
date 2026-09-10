import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceStore, WORKING_SESSION_INTERVAL_MS } from '../bridge/store.mjs';
import { DeviceLink } from '../bridge/device.mjs';
import { mergeSettings } from '../bridge/studio-settings.mjs';

const agent = (id, state = 'working', name = id) => ({ pane_id: id, agent: 'pi', name, agent_status: state });
function setup(t) {
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  return { store: new FaceStore(), advance: ms => { now += ms; } };
}

test('working names rotate every four seconds without restarting the face or depending on Herdr updates', t => {
  const { store, advance } = setup(t);
  store.ingest([agent('a'), agent('b'), agent('c'), agent('ready', 'done')]);
  const { changedAt, animationEpoch } = store;
  let updates = 0;
  store.on('change', () => updates++);
  for (const name of ['b', 'c', 'a']) {
    advance(WORKING_SESSION_INTERVAL_MS - 1); store.tickWorkingSessions();
    assert.equal(updates, 0);
    advance(1); store.tickWorkingSessions();
    assert.equal(updates, 1); updates = 0;
    assert.equal(store.display().name, name);
    assert.equal(store.display().label, '3 Working');
    assert.equal(store.frame().nameShimmer, true);
    assert.equal(store.changedAt, changedAt);
    assert.equal(store.animationEpoch, animationEpoch);
  }
});

test('ordinary updates and sorting changes retain the current session and its dwell time', t => {
  const { store, advance } = setup(t);
  store.ingest([agent('a'), agent('b')]);
  advance(2000); store.ingest([agent('a', 'working', 'Z renamed'), agent('b')]);
  assert.equal(store.display().name, 'Z renamed');
  advance(2000); store.tickWorkingSessions();
  assert.equal(store.display().name, 'b');
  store.ingest([agent('a'), agent('b', 'done'), agent('c')]);
  assert.equal(store.display().name, 'a');
  advance(3999); store.tickWorkingSessions(); assert.equal(store.display().name, 'a');
  advance(1); store.tickWorkingSessions(); assert.equal(store.display().name, 'c');
});

test('ready and idle fallback, selected sessions, previews and disconnection never shimmer a stale name', t => {
  const { store, advance } = setup(t);
  store.ingest([agent('a'), agent('b', 'blocked'), agent('c', 'done')]);
  assert.equal(store.display().label, '1 needs attention');
  assert.equal(store.frame().name, 'a');
  assert.equal(store.frame().nameShimmer, true);
  store.select('a'); assert.equal(store.frame().nameShimmer, false);
  advance(9000); const seq = store.seq; store.tickWorkingSessions(); assert.equal(store.seq, seq);
  store.select('all'); store.setExpression('working');
  assert.equal(store.frame().name, 'Playground'); assert.equal(store.frame().nameShimmer, false);
  store.setExpression(null);
  store.ingest([agent('a', 'idle'), agent('c', 'done')]);
  assert.equal(store.frame().name, '1 ready'); assert.equal(store.frame().nameShimmer, false);
  store.ingest([agent('a', 'idle')]); assert.equal(store.frame().name, '1 idle');
  store.ingest([agent('a')]); store.disconnect();
  assert.equal(store.frame().name, ''); assert.equal(store.frame().nameShimmer, false);
});

test('one worker and inactive Face do not publish rotation frames; mapped expressions retain the session subtitle', t => {
  const { store, advance } = setup(t);
  store.ingest([agent('a')]);
  let seq = store.seq; advance(12000); store.tickWorkingSessions(); assert.equal(store.seq, seq);
  store.setSettings(mergeSettings(store.settings, { mappings: { working: 'done' } }));
  assert.equal(store.display().expression, 'done'); assert.equal(store.frame().nameShimmer, true);
  store.setSettings(mergeSettings(store.settings, { modules: { clock: { enabled: true } }, device: { activeModule: 'clock' } }));
  store.ingest([agent('a'), agent('b')]);
  seq = store.seq; advance(12000); store.tickWorkingSessions();
  assert.equal(store.seq, seq); assert.equal(store.frame().nameShimmer, false);
  store.setModule('face'); assert.equal(store.display().name, 'a');
});

test('rotation reaches serial and SSE snapshots together with bounded names and a stable animation epoch', t => {
  const { store, advance } = setup(t);
  const first = 'A'.repeat(64), second = 'B'.repeat(64);
  store.ingest([agent('a', 'working', first), agent('b', 'working', second)]);
  const frames = [], snapshots = [];
  const link = new DeviceLink(store);
  link.port = { isOpen: true, write: (wire, done) => { frames.push(JSON.parse(wire)); done(); } };
  store.on('change', snapshot => { snapshots.push(snapshot); link.onChange(snapshot); });
  link.receive('{"type":"ready","v":1,"board":"waveshare-1.75-b"}\n');
  const epoch = store.animationEpoch;
  advance(4000); store.tickWorkingSessions();
  assert.equal(frames.at(-1).name, second.slice(0, 48));
  assert.equal(snapshots.at(-1).display.name, frames.at(-1).name);
  assert.equal(frames.at(-1).nameShimmer, true);
  assert.equal(frames.at(-1).epoch, epoch);
  assert.ok(Buffer.byteLength(JSON.stringify(frames.at(-1))) < 1024);
});

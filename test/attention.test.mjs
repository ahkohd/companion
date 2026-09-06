import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import schema from '../shared/design-schema.json' with { type: 'json' };
import { Attention } from '../bridge/attention.mjs';
import { FaceStore } from '../bridge/store.mjs';
import { DeviceLink } from '../bridge/device.mjs';
const setup = () => { let time = 0; const store = new FaceStore(); const attention = new Attention(store, { now: () => time }); return { store, attention, advance: ms => { time += ms; attention.tick(); } }; };
const message = { owner: 'test', title: 'Build passed' };
const target = attention => ({ id: attention.active.id, revision: attention.active.revision });
test('gesture dismissal works on face or details without approval and rejects stale requests', () => {
  const { attention } = setup();
  attention.show({ ...message, kind: 'decision' });
  const first = target(attention);
  attention.show(message);
  attention.dismiss(first);
  assert.equal(attention.history[0].outcome, 'dismissed');
  assert.equal(attention.history[0].action, null);
  assert.throws(() => attention.dismiss(first), /changed/);
  attention.details({ ...target(attention), detail: true });
  attention.dismiss(target(attention));
  assert.equal(attention.active, null);
  assert.ok(attention.history.every(result => result.outcome === 'dismissed' && result.action === null));
});
test('notifications count visible time only, pause details, and restore underlying module', () => {
  const { store, attention, advance } = setup(); store.activeModule = 'clock';
  attention.show(message); assert.equal(store.snapshot().module, 'face'); store.tickClock();
  advance(9000); attention.details({ ...target(attention), detail: true }); advance(30000); assert.ok(attention.active);
  attention.details({ ...target(attention), detail: false }); advance(999); assert.ok(attention.active); advance(1);
  assert.equal(attention.active, null); assert.equal(store.snapshot().module, 'clock'); assert.equal(attention.history[0].outcome, 'expired');
});
test('decisions wait indefinitely, queue ahead of notices and require explicit current detail action', () => {
  const { attention, advance } = setup(); attention.show(message); attention.show({ ...message, title: 'Queued notice' });
  const decision = attention.show({ ...message, kind: 'decision' }); advance(10000); assert.equal(attention.active.id, decision.id);
  advance(999999); assert.ok(attention.active); const stale = target(attention);
  assert.throws(() => attention.act({ ...stale, action: 'approve' }), /detail/);
  attention.details({ ...stale, detail: true }); assert.throws(() => attention.act({ ...stale, action: 'approve' }), /changed/);
  attention.act({ ...target(attention), action: 'approve' }); assert.equal(attention.history[0].outcome, 'responded'); assert.equal(attention.history[0].action, 'approve'); assert.equal(attention.active.title, undefined); assert.equal(attention.snapshot().active.title, 'Queued notice');
});
test('chained screens advance once and owner updates reject stale actions', () => {
  const { attention } = setup(); attention.show({ owner: 'test', kind: 'decision', steps: [{ title: 'First', actions: [{ id: 'next', label: 'Next', kind: 'next' }] }, { title: 'Second' }] });
  attention.details({ ...target(attention), detail: true }); const before = target(attention); attention.act({ ...before, action: 'next' });
  assert.equal(attention.snapshot().active.title, 'Second'); assert.throws(() => attention.act({ ...before, action: 'next' }), /changed/);
  assert.throws(() => attention.update({ id: attention.active.id, owner: 'other', title: 'Bad' }), /owner/);
  attention.update({ id: attention.active.id, owner: 'test', title: 'Updated' }); assert.equal(attention.snapshot().active.title, 'Updated');
  attention.clear({ id: attention.active.id, owner: 'test' }); assert.equal(attention.history[0].outcome, 'cleared');
});
test('validation rejects overflow, unknown animations, duplicate actions, expiry decisions, invalid chains', () => {
  const { attention, store } = setup();
  for (const request of [{ title: 'line\nbreak' }, { description: 'tab\there' }, { title: 'x'.repeat(25) }, { description: 'x'.repeat(49) }, { body: 'x'.repeat(481) }, { body: '😀'.repeat(480) }, { animation: 'missing' }, { kind: 'decision', durationMs: 10000 }, { actions: [{ id: 'open', label: 'Open', kind: 'respond' }] }, { actions: [{ id: 'next', label: 'Next', kind: 'next' }] }]) assert.throws(() => attention.show({ ...message, ...request }));
  store.pointer = { ...store.pointer, enabled: true, status: 'active', x: 0.123456789012345, y: -0.123456789012345 }; store.seq = 4294967295; store.animationEpoch = 4294967295; store.settings.device.rotation = 359;
  attention.show({ ...message, title: '😀'.repeat(24), description: '😀'.repeat(48), body: 'é'.repeat(200), actions: [{id:'x'.repeat(24),label:'a'.repeat(16),kind:'dismiss'},{id:'y'.repeat(24),label:'a'.repeat(16),kind:'respond'}] });
  for (const mode of ['dark', 'light']) {
    store.settings.deviceAppearance.mode = mode;
    for (const field of schema.face) store.settings.design.face[field.key] = field.max ?? 16777215;
    const frame = store.frame(); assert.ok(frame.design); assert.ok(Buffer.byteLength(JSON.stringify(frame) + '\n') < 2048);
  }
});
test('disable persists, cancels requests without approval and prevents further messages', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'attention-')); const filePath = path.join(dir, 'settings.json');
  const store = new FaceStore(), attention = new Attention(store, { filePath });
  try { await attention.load(); attention.show({ ...message, kind: 'decision' }); attention.show(message); await attention.configure({ enabled: false }); assert.equal(attention.active, null); assert.equal(attention.queue.length, 0); assert.ok(attention.history.every(item => item.outcome === 'disabled')); assert.throws(() => attention.show(message), /disabled/); const second = new Attention(new FaceStore(), { filePath }); await second.load(); assert.equal(second.enabled, false); second.stop(); } finally { attention.stop(); await rm(dir, { recursive: true, force: true }); }
});
test('device attention events are routed and underlying controls suppressed', async () => {
  const { attention, store } = setup(); let received; const link = new DeviceLink(store, { onAttention: value => { received = value; } }); link.ready = true;
  attention.show(message); const selected = store.selected; link.receive(JSON.stringify({ v: 1, type: 'cycle' }) + '\n'); assert.equal(store.selected, selected);
  link.receive(JSON.stringify({ v: 1, type: 'attention', ...target(attention), action: 'open' }) + '\n'); await Promise.resolve(); assert.equal(received.action, 'open');
});

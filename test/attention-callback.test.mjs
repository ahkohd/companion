import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';
import { AttentionCallbacks, validateCallback } from '../bridge/attention-callback.mjs';
import { Attention } from '../bridge/attention.mjs';
import { FaceStore } from '../bridge/store.mjs';

function fakeExecution() {
  const calls = [];
  const execute = (command, args, options, done) => {
    const stdin = new EventEmitter(); stdin.end = input => { call.input = input; };
    const call = { command, args, options, done, input: null, killed: false }; calls.push(call);
    return { stdin, kill: signal => { call.killed = signal; queueMicrotask(() => done(Object.assign(new Error(), { killed: true }))); } };
  };
  return { calls, execute };
}
test('callbacks pass result JSON on stdin and preserve literal arguments without a shell', async () => {
  const { calls, execute } = fakeExecution(), delivery = new AttentionCallbacks({ execute });
  const result = { id: 'id', owner: 'agent', title: 'Finished', outcome: 'responded', action: 'approve', revision: 2, callbackDelivery: { status: 'pending' } };
  const promise = delivery.deliver({ command: '/local/tool', args: ['$(touch bad)', '; rm file', 'two words'], env: { TASK: 'literal $HOME' } }, result);
  assert.equal(calls.length, 1); const call = calls[0];
  assert.deepEqual(call.args, ['$(touch bad)', '; rm file', 'two words']); assert.equal(call.command, '/local/tool'); assert.equal(call.options.shell, false);
  assert.equal(call.options.timeout, 5000); assert.equal(call.options.killSignal, 'SIGKILL'); assert.equal(call.options.maxBuffer, 65536); assert.equal(call.options.env.TASK, 'literal $HOME');
  const payload = JSON.parse(call.input); assert.equal(payload.action, 'approve'); assert.equal(payload.id, 'id'); assert.equal(payload.callbackDelivery, undefined);
  call.done(null); await promise; delivery.stop();
});
test('callback queue is bounded, failures do not retry, and shutdown prevents queued execution', async () => {
  const { calls, execute } = fakeExecution(), delivery = new AttentionCallbacks({ execute, limit: 2 });
  const first = delivery.deliver({ command: 'test' }, {}), second = delivery.deliver({ command: 'test' }, {});
  const rejected = assert.rejects(second, /stopped/);
  await assert.rejects(delivery.deliver({ command: 'test' }, {}), /full/);
  const aborted = assert.rejects(first, /execution limit/); delivery.stop(); await Promise.all([rejected, aborted]);
  assert.equal(calls.length, 1); assert.equal(calls[0].killed, 'SIGKILL');
  await assert.rejects(delivery.deliver({ command: 'test' }, {}), /stopped/);
});
test('terminal events deliver exactly once and failed callbacks keep the result', async () => {
  let time = 0, delivered = [];
  const store = new FaceStore(), attention = new Attention(store, { now: () => time, deliver: async (callback, result) => { delivered.push({ callback, result }); if (result.outcome === 'dismissed') throw Error('fixture failure'); } });
  attention.show({ owner: 'test', title: 'No callback' }); attention.clear({ id: attention.active.id, owner: 'test' }); await turn(); assert.equal(delivered.length, 0);
  attention.show({ owner: 'test', kind: 'decision', title: 'Decision', callback: { command: 'fixture' } }); const id = attention.active.id;
  assert.equal(store.frame().callback, undefined); assert.equal(store.frame().attention.callback, undefined);
  attention.dismiss({ id, revision: 1 }); assert.equal(attention.history[0].callbackDelivery.status, 'pending'); await turn();
  assert.equal(delivered.length, 1); assert.equal(attention.history[0].outcome, 'dismissed'); assert.equal(attention.history[0].action, null); assert.equal(attention.history[0].callbackDelivery.status, 'failed');
  assert.throws(() => attention.dismiss({ id, revision: 1 }), /changed/); await turn(); assert.equal(delivered.length, 1);
  attention.show({ owner: 'test', title: 'Expires', callback: { command: 'fixture' } }); time = 10000; attention.tick(); await turn();
  assert.equal(attention.history[0].outcome, 'expired'); assert.equal(attention.history[0].callbackDelivery.status, 'succeeded'); attention.stop();
});
test('callback configuration validates commands, arguments, environment and byte budget', () => {
  for (const value of [{ command: '' }, { command: 'a\0b' }, { command: 'x'.repeat(1025) }, { command: 'x', args: Array(33).fill('a') }, { command: 'x', args: ['x\0'] }, { command: 'x', env: { 'BAD-NAME': 'x' } }, { command: 'x', env: { KEY: 2 } }, { command: 'x', env: { KEY: 'x'.repeat(8192) } }, { command: 'x', extra: true }]) assert.throws(() => validateCallback(value));
  assert.equal(validateCallback(null), null); assert.deepEqual(validateCallback({ command: 'sh', args: ['-c', 'explicit command'] }), { command: 'sh', args: ['-c', 'explicit command'], env: {} });
});

test('real isolated callback receives terminal JSON through stdin', async () => {
  const delivery = new AttentionCallbacks();
  try {
    await delivery.deliver({ command: process.execPath, args: ['-e', "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const x=JSON.parse(s);process.exit(x.id==='fixture'&&x.outcome==='responded'&&x.action==='approve'?0:1)})"] }, { id: 'fixture', owner: 'test', outcome: 'responded', action: 'approve', revision: 2 });
  } finally { delivery.stop(); }
});

test('responded, cleared and disabled callbacks are terminal-only and fire once', async () => {
  const outcomes = [], attention = new Attention(new FaceStore(), { deliver: async (_, result) => outcomes.push(result.outcome) });
  const request = { owner: 'test', kind: 'decision', title: 'Fixture', callback: { command: 'fixture' } };
  attention.show(request); attention.details({ id: attention.active.id, revision: 1, detail: true }); await turn(); assert.deepEqual(outcomes, []);
  attention.act({ id: attention.active.id, revision: 2, action: 'approve' }); await turn();
  attention.show(request); attention.clear({ id: attention.active.id, owner: 'test' }); await turn();
  attention.show(request); await attention.configure({ enabled: false }); await turn();
  assert.deepEqual(outcomes, ['responded', 'cleared', 'disabled']); attention.stop();
});

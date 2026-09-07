import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticLogs, installConsoleLogs } from '../bridge/logs.mjs';

test('diagnostics bound entry count and message length and expose independent snapshots', () => {
  const logs = new DiagnosticLogs({ now: () => new Date('2026-09-07T12:00:00Z') });
  for (let i = 0; i < 502; i++) logs.append('info', String(i));
  let snapshot = logs.snapshot(); assert.equal(snapshot.entries.length, 500); assert.equal(snapshot.entries[0].id, 3); assert.equal(snapshot.entries.at(-1).id, 502);
  logs.append('error', '😀'.repeat(2500)); snapshot = logs.snapshot(); assert.equal(Array.from(snapshot.entries.at(-1).message).length, 2000); assert.equal(snapshot.entries.at(-1).timestamp, '2026-09-07T12:00:00.000Z');
  snapshot.entries[0].message = 'changed'; assert.notEqual(logs.snapshot().entries[0].message, 'changed');
  assert.notEqual(new DiagnosticLogs().sessionId, logs.sessionId); assert.throws(() => logs.append('invalid', 'text')); assert.throws(() => new DiagnosticLogs({ limit: 501 }));
});

test('console capture preserves arguments, receiver, return value and restoration', () => {
  const logs = new DiagnosticLogs(), calls = [];
  const target = Object.fromEntries(['log', 'info', 'warn', 'error'].map(method => [method, function (...args) { calls.push({ method, args, receiver: this }); return method; }]));
  const originals = { ...target }, restore = installConsoleLogs(logs, target);
  const data = { key: 'value' };
  assert.equal(target.log('Count %d', 4), 'log'); target.info(data); target.warn('Warning'); target.error(new Error('Failure'));
  assert.equal(calls[1].args[0], data); assert.equal(calls[0].receiver, target); assert.deepEqual(logs.snapshot().entries.map(entry => entry.level), ['info', 'info', 'warn', 'error']); assert.equal(logs.snapshot().entries[0].message, 'Count 4');
  restore(); restore(); assert.equal(target.log, originals.log); target.log('After restore'); assert.equal(logs.snapshot().entries.length, 4);
});

test('device transitions omit session and mail data and deduplicate acknowledgements', () => {
  const logs = new DiagnosticLogs();
  const device = { status: 'connected', connection: { mode: 'auto' }, error: null, privateSession: 'session title', mail: 'private subject' };
  logs.observeDevice(device); logs.observeDevice({ ...device, lastAck: 123 }); assert.equal(logs.snapshot().entries.length, 2);
  logs.observeDevice({ ...device, error: 'Display transfer failed (257).' }); logs.observeDevice({ ...device, error: 'Display transfer failed (257).', lastAck: 456 });
  logs.observeDevice(device); const entries = logs.snapshot().entries; assert.equal(entries.length, 4); assert.equal(entries[2].level, 'error'); assert.equal(entries[3].message, 'Device error cleared.');
  assert.doesNotMatch(JSON.stringify(entries), /private subject|session title/);
});

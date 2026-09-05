import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dashboardFor } from '../bridge/dashboard.mjs';
import { FaceStore } from '../bridge/store.mjs';
import { DeviceLink } from '../bridge/device.mjs';
import { StudioSettings, defaultSettings, mergeSettings, MODULE_IDS } from '../bridge/studio-settings.mjs';
import { ModuleSources } from '../bridge/module-sources.mjs';

const clockSettings = patch => mergeSettings(defaultSettings(), {
  modules: {
    face: { enabled: true }, usage: { enabled: false }, hey: { enabled: false },
    clock: { enabled: true, hourFormat: '12', showWeekday: true, ...patch },
  },
  device: { activeModule: 'clock', followMouse: false },
});
const localTime = (hour, minute, day = 9) => new Date(2026, 8, day, hour, minute, 0).getTime();

test('the clock formats local time with twelve-hour defaults, noon, midnight and weekday rollover', () => {
  const settings = clockSettings();
  for (const [hour, minute, day, time, weekday] of [
    [0, 0, 9, '12:00', 'Wed'], [9, 5, 9, '9:05', 'Wed'],
    [12, 0, 9, '12:00', 'Wed'], [17, 20, 9, '5:20', 'Wed'],
    [23, 59, 9, '11:59', 'Wed'], [0, 0, 10, '12:00', 'Thu'],
  ]) {
    const display = dashboardFor('clock', {}, settings, localTime(hour, minute, day));
    assert.deepEqual(display, { dashboard: { status: 'ready', title: 'Clock', detail: '', time, weekday, blinkSeparator: true }, label: '', name: '', state: 'idle' });
  }
  const twentyFour = clockSettings({ hourFormat: '24', showWeekday: false });
  for (const [hour, minute, time] of [[0, 0, '00:00'], [9, 5, '09:05'], [12, 0, '12:00'], [17, 20, '17:20'], [23, 59, '23:59']]) {
    const dashboard = dashboardFor('clock', {}, twentyFour, localTime(hour, minute)).dashboard;
    assert.equal(dashboard.time, time); assert.equal(dashboard.weekday, '');
  }
  const disabled = dashboardFor('clock', {}, clockSettings({ enabled: false }), localTime(17, 20)).dashboard;
  assert.equal(disabled.status, 'unavailable'); assert.equal(disabled.time, undefined);
});

test('saved three-module settings acquire clock defaults without losing existing preferences', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-clock-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'studio.json');
  const saved = mergeSettings(defaultSettings(), {
    appearance: { theme: 'dark', direction: 'rtl', reducedMotion: true },
    device: { activeModule: 'hey', moduleOrder: ['hey', 'face', 'usage', 'clock', 'roon'], textGap: 4, followMouse: true, mouseInterval: 250, swipeEnabled: false, showModuleNavigation: true, showCardBackgrounds: true },
    modules: { usage: { enabled: true, providers: ['codex'], provider: 'codex', refreshSeconds: 120 }, hey: { enabled: true, box: 'feed', refreshSeconds: 300 } },
    mappings: { working: 'grok:happy', disconnected: 'sleep' },
  });
  const expected = structuredClone(saved);
  delete saved.modules.clock; delete saved.modules.roon; delete saved.design.roon; saved.device.moduleOrder = ['hey','face','usage'];
  await writeFile(filePath, JSON.stringify(saved));
  const store = new FaceStore(), settings = new StudioSettings(store, { filePath }); await settings.load();
  assert.deepEqual(store.settings, expected); assert.equal(store.activeModule, 'hey');
  await settings.save({ modules: { clock: { enabled: true, hourFormat: '24', showWeekday: false, blinkSeparator: false } } });
  await settings.activateModule('clock');
  const restarted = new StudioSettings(new FaceStore(), { filePath }); await restarted.load();
  assert.deepEqual(restarted.value, JSON.parse(await readFile(filePath, 'utf8')));
  assert.equal(restarted.value.device.activeModule, 'clock');
  assert.deepEqual(restarted.value.modules.clock, { enabled: true, hourFormat: '24', showWeekday: false, blinkSeparator: false });
  for (const patch of [
    { device: { moduleOrder: ['hey', 'face', 'usage'] } },
    { device: { moduleOrder: ['hey', 'face', 'usage', 'usage'] } },
    ...[12, 24, '1222', null].map(hourFormat => ({ modules: { clock: { hourFormat } } })),
    { modules: { clock: { showWeekday: 'true' } } },
    { modules: { clock: { blinkSeparator: 'true' } } },
  ]) await assert.rejects(settings.save(patch));
});

test('all four modules cycle in configured order and disabling clock chooses the next enabled module', () => {
  const store = new FaceStore();
  store.setSettings(mergeSettings(store.settings, {
    device: { activeModule: 'face', moduleOrder: [...MODULE_IDS] },
    modules: { face: { enabled: true }, usage: { enabled: true }, hey: { enabled: true }, clock: { enabled: true } },
  }));
  assert.deepEqual(store.enabledModules(), MODULE_IDS.filter(id=>id!=='roon'));
  for (const id of ['usage', 'hey', 'clock', 'face']) assert.equal(store.cycleModule(1), id);
  assert.equal(store.cycleModule(-1), 'clock');
  store.setSettings(mergeSettings(store.settings, { modules: { clock: { enabled: false } } }));
  assert.equal(store.activeModule, 'face'); assert.deepEqual(store.enabledModules(), ['face', 'usage', 'hey']);
});

test('minute changes publish the clock to browser and device without restarting animation or changing gaze', t => {
  let now = localTime(23, 59);
  t.mock.method(Date, 'now', () => now);
  const store = new FaceStore(); store.setSettings(clockSettings());
  store.setPointer({ enabled: true, status: 'active', x: 0.25, y: -0.5 });
  store.disconnect('Herdr is unavailable');
  const frames = [], snapshots = [];
  const link = new DeviceLink(store);
  link.port = { isOpen: true, write: (frame, callback) => { frames.push(JSON.parse(frame)); callback(); } };
  store.on('change', link.onChange); store.on('change', snapshot => snapshots.push(snapshot));
  link.receive('{"type":"ready","v":1,"board":"waveshare-1.75-b"}\n');
  const initial = store.snapshot(), frameCount = frames.length, snapshotCount = snapshots.length;
  assert.equal(initial.display.dashboard.status, 'ready'); assert.equal(initial.connected, false);
  now += 59000; store.tickClock();
  assert.equal(frames.length, frameCount); assert.equal(snapshots.length, snapshotCount);
  now += 1000; store.tickClock();
  assert.equal(frames.length, frameCount + 1); assert.equal(snapshots.length, snapshotCount + 1);
  assert.equal(snapshots.at(-1).display.dashboard.time, '12:00');
  assert.equal(snapshots.at(-1).display.dashboard.weekday, 'Thu');
  assert.equal(frames.at(-1).module, 'clock'); assert.equal(frames.at(-1).dashboard.time, '12:00');
  assert.equal(store.changedAt, initial.changedAt); assert.equal(frames.at(-1).epoch, frames[0].epoch);
  assert.deepEqual(frames.at(-1).look, { x: 0.25, y: -0.5 });
  assert.equal(store.settingsRevision, initial.settingsRevision);
  store.tickClock(); assert.equal(frames.length, frameCount + 1);
  store.setModule('face'); const seq = store.seq;
  now += 60000; store.tickClock(); assert.equal(store.seq, seq);
});

test('clock frames stay bounded and clock preferences do not launch a source collector', async t => {
  const store = new FaceStore(); store.setSettings(clockSettings());
  t.mock.method(Date, 'now', () => localTime(12, 59));
  t.mock.method(performance, 'now', () => 4294967295);
  store.setPointer({ enabled: true, status: 'active', x: -0.12345678901234567, y: 0.12345678901234567 });
  store.seq = 4294967295; store.animationEpoch = 4294967295; store.changedAt = 0;
  const frame = store.frame();
  assert.equal(frame.dashboard.time, '12:59'); assert.ok(Buffer.byteLength(frame.dashboard.time) <= 7);
  assert.ok(Buffer.byteLength(frame.dashboard.weekday) <= 3);
  assert.ok(Buffer.byteLength(JSON.stringify(frame) + '\n') <= 1024);
  assert.equal(Object.hasOwn(store.snapshot().modules, 'clock'), false);
  const calls = [];
  const source = new ModuleSources({ settings: store.settings.modules, runner: async (command, args) => {
    calls.push([command, args]); return { code: 0, stdout: 'CLI 1.0.0' };
  } });
  t.after(() => source.stop()); await source.start();
  assert.deepEqual(calls, [['codexbar', ['--version']], ['hey', ['--version']]]);
  source.configure(clockSettings({ hourFormat: '24', showWeekday: false }).modules);
  assert.equal(calls.length, 2); await assert.rejects(source.refresh('clock'), /usage or hey/);
});

test('clock blinking can be disabled without changing the time text', () => {
  const settings = clockSettings({ blinkSeparator: false });
  const store = new FaceStore(); store.setSettings(settings);
  assert.equal(store.frame().dashboard.blinkSeparator, false);
  const off = dashboardFor('clock', {}, settings, localTime(17, 20)).dashboard;
  const on = dashboardFor('clock', {}, clockSettings(), localTime(17, 20)).dashboard;
  assert.equal(off.time, on.time); assert.equal(on.blinkSeparator, true);
});

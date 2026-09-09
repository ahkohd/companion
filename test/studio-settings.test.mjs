import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FaceStore } from '../bridge/store.mjs';
import { StudioSettings, defaultSettings, mergeSettings } from '../bridge/studio-settings.mjs';
import { DisplaySettings } from '../bridge/display-settings.mjs';
import { ModuleSources } from '../bridge/module-sources.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FaceStore(), filePath = path.join(directory, 'studio.json');
  return { store, filePath, directory, settings: new StudioSettings(store, { filePath, ...options }) };
}

test('settings migrate legacy text spacing and persist display and mouse preferences together', async t => {
  const { directory, filePath } = await fixture(t);
  const legacyPath = path.join(directory, 'display.json'); await writeFile(legacyPath, '{"textGap":16}');
  const store = new FaceStore(); await new DisplaySettings(store, { filePath: legacyPath }).load();
  const settings = new StudioSettings(store, { filePath }); await settings.load();
  assert.equal(store.settings.device.textGap, 16); assert.equal(store.textGap, 16);
  await settings.save({ device: { followMouse: true, mouseInterval: 250, textGap: 4 } });
  const next = new FaceStore(), restarted = new StudioSettings(next, { filePath }); await restarted.load();
  assert.equal(next.textGap, 4); assert.equal(next.settings.device.followMouse, true); assert.equal(next.settings.device.mouseInterval, 250);
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), next.settings);
});

test('concurrent partial settings merge in order without losing unrelated changes', async t => {
  const { settings, store } = await fixture(t); await settings.load();
  await settings.save({ appearance: { theme: 'light' }, modules: { usage: { enabled: false }, hey: { enabled: false }, clock: { enabled: false } } });
  const revision = store.settingsRevision;
  const results = await Promise.all([
    settings.save({ modules: { usage: { enabled: true } } }),
    settings.save({ modules: { face: { enabled: false } } }),
    settings.save({ appearance: { theme: 'dark' } }),
    settings.save({ device: { textGap: 4 } }),
    settings.save({ mappings: { working: 'grok:happy' } }),
  ]);
  assert.equal(results[0].modules.face.enabled, true); assert.equal(results[1].modules.face.enabled, false);
  assert.equal(store.activeModule, 'usage'); assert.equal(store.settings.device.activeModule, 'usage');
  assert.equal(store.settings.appearance.theme, 'dark'); assert.equal(store.textGap, 4);
  assert.equal(store.settings.mappings.working, 'grok:happy'); assert.equal(store.settingsRevision, revision + 5);
});

test('failed writes do not change live settings and the write queue recovers', async t => {
  const { settings, store, filePath } = await fixture(t); await settings.load();
  await mkdir(filePath); await assert.rejects(settings.save({ device: { textGap: 4 } }));
  assert.equal(store.textGap, 8); assert.equal(store.settingsRevision, 0);
  await rm(filePath, { recursive: true }); await settings.save({ device: { textGap: 16 } });
  assert.equal(store.textGap, 16); assert.equal(store.settingsRevision, 1);
});

test('invalid settings are rejected without writes and cannot disable every module', async t => {
  const { settings, store, filePath } = await fixture(t); await settings.load();
  const before = structuredClone(store.settings);
  for (const patch of [null, [], { version: 2 }, { modules: { face: { enabled: false }, usage: { enabled: false }, hey: { enabled: false }, clock: { enabled: false } } },
    { device: { activeModule: 'other' } }, { device: { moduleOrder: ['face', 'face', 'hey'] } },
    { mappings: { working: 'grok:not-real' } }, { modules: { usage: { refreshSeconds: 1 } } },
    { device: null }, { appearance: { theme: 'other' } }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
    await assert.rejects(settings.save(patch)); assert.deepEqual(store.settings, before);
  }
  await assert.rejects(readFile(filePath), { code: 'ENOENT' }); assert.equal({}.polluted, undefined);
});

test('provider validation agrees with the collector and snapshots retain valid source settings', async t => {
  const { settings } = await fixture(t); await settings.load();
  for (const providers of [['bad_name'], ['123'], ['--flag'], ['codex', 'codex'], Array.from({ length: 17 }, (_, n) => `provider-${n}`)]) {
    await assert.rejects(settings.save({ modules: { usage: { providers } } }));
  }
  const valid = await settings.save({ modules: { usage: { providers: ['codex', 'azure-openai'], provider: 'codex' } } });
  const source = new ModuleSources(); assert.doesNotThrow(() => source.configure(valid.modules)); source.stop();
});

test('module activation and queued swipes preserve order and skip disabled modules', async t => {
  const { settings, store, filePath } = await fixture(t); await settings.load();
  await settings.save({ modules: { usage: { enabled: false }, hey: { enabled: false }, clock: { enabled: false } } });
  await assert.rejects(settings.activateModule('usage'), /Enable/);
  await settings.save({ modules: { usage: { enabled: true }, hey: { enabled: true } }, device: { moduleOrder: ['hey', 'face', 'usage', 'clock', 'roon', 'audio'] } });
  await Promise.all([settings.cycleModule(1), settings.cycleModule(1)]);
  assert.equal(store.activeModule, 'hey'); assert.equal(JSON.parse(await readFile(filePath, 'utf8')).device.activeModule, 'hey');
  await settings.save({ modules: { usage: { enabled: false } } });
  await settings.cycleModule(-1); assert.equal(store.activeModule, 'face');
  await settings.save({ device: { swipeEnabled: false } }); const revision = store.settingsRevision;
  await settings.cycleModule(1); assert.equal(store.activeModule, 'face'); assert.equal(store.settingsRevision, revision);
  await assert.rejects(settings.cycleModule(0)); await assert.rejects(settings.activateModule('unknown'));
});

test('saved files are validated and platform checks run before committing a preference', async t => {
  const { settings, store, filePath } = await fixture(t, { validateApply: value => { if (value.device.followMouse) throw new Error('Unsupported platform'); } });
  t.mock.method(console, 'warn', () => {}); await writeFile(filePath, 'not-json'); await settings.load();
  assert.equal(store.activeModule, 'face'); await assert.rejects(settings.save({ device: { followMouse: true } }), /Unsupported/);
  assert.equal(store.settings.device.followMouse, false);
  const saved = defaultSettings(); saved.device.followMouse = true; await writeFile(filePath, JSON.stringify(saved));
  await settings.load(); assert.equal(store.settings.device.followMouse, false);
});

test('unrelated settings and identical saves preserve animation age', async t => {
  const { settings, store } = await fixture(t); await settings.load();
  store.ingest([{ pane_id: 'a', agent: 'pi', agent_status: 'working' }]); store.select('a');
  store.changedAt = Date.now() - 5000; const { changedAt, animationEpoch } = store;
  await settings.save({ appearance: { theme: 'dark' }, device: { textGap: 4 } });
  assert.equal(store.changedAt, changedAt); assert.equal(store.animationEpoch, animationEpoch);
  const revision = store.settingsRevision; await settings.save({ appearance: { theme: 'dark' } });
  assert.equal(store.settingsRevision, revision);
});

test('all native and Grok remaps preserve logical statuses and captions', () => {
  const store = new FaceStore(); store.ingest([{ pane_id: 'a', agent: 'pi', agent_status: 'working', name: 'Project task' }]); store.select('a');
  store.setSettings(mergeSettings(defaultSettings(), { mappings: { working: 'sleep' } }));
  assert.equal(store.frame().state, 'working'); assert.equal(store.frame().expression, 'sleep');
  assert.equal(store.frame().label, 'Working'); assert.equal(store.frame().name, 'Project task'); assert.equal(store.frame().preview, false);
  store.setSettings(mergeSettings(store.settings, { mappings: { working: 'grok:happy' } }));
  assert.equal(store.frame().animation, 'grok:happy'); assert.equal(store.frame().state, 'working');
  store.setExpression('unknown'); assert.equal(store.frame().state, 'unknown'); assert.equal(store.frame().label, 'Status unknown');
  store.setExpression('disconnected'); assert.equal(store.frame().state, 'disconnected');
  store.setExpression(null); assert.equal(store.frame().animation, 'grok:happy');
});

test('existing settings default to hidden navigation and preserve the choice after restart', async t => {
  const { settings, store, filePath } = await fixture(t);
  const legacy = defaultSettings(); delete legacy.device.showModuleNavigation;
  await writeFile(filePath, JSON.stringify(legacy)); await settings.load();
  assert.equal(store.settings.device.showModuleNavigation, false);
  await settings.save({ device: { showModuleNavigation: true } });
  const restarted = new StudioSettings(new FaceStore(), { filePath }); await restarted.load();
  assert.equal(restarted.value.device.showModuleNavigation, true);
  assert.equal(store.frame().showModuleNavigation, true);
  await assert.rejects(settings.save({ device: { showModuleNavigation: 'true' } }));
});

test('card backgrounds default off, persist both choices and reach every module frame', async t => {
  const { settings, store, filePath } = await fixture(t);
  const legacy = defaultSettings(); delete legacy.device.showCardBackgrounds;
  legacy.modules.usage.enabled = legacy.modules.hey.enabled = true;
  await writeFile(filePath, JSON.stringify(legacy)); await settings.load();
  assert.equal(store.settings.device.showCardBackgrounds, false);
  assert.equal(store.frame().showCardBackgrounds, false);
  for (const showCardBackgrounds of [true, false]) {
    await settings.save({ device: { showCardBackgrounds } });
    for (const id of ['usage', 'hey', 'face']) {
      await settings.activateModule(id);
      assert.equal(store.frame().showCardBackgrounds, showCardBackgrounds);
    }
    const restarted = new StudioSettings(new FaceStore(), { filePath }); await restarted.load();
    assert.equal(restarted.value.device.showCardBackgrounds, showCardBackgrounds);
    assert.deepEqual(restarted.value.modules, legacy.modules);
  }
  for (const value of [null, 'true', 1, []]) {
    await assert.rejects(settings.save({ device: { showCardBackgrounds: value } }));
    assert.equal(store.settings.device.showCardBackgrounds, false);
  }
});

test('display rotation migrates upright, persists, and reaches every module frame', async t => {
  const {store,settings,filePath} = await fixture(t);
  const legacy = defaultSettings(); delete legacy.device.rotation;
  await writeFile(filePath, JSON.stringify(legacy)); await settings.load();
  assert.equal(settings.value.device.rotation, 0);
  await settings.save({modules:{usage:{enabled:true},hey:{enabled:true},clock:{enabled:true},roon:{enabled:true}}});
  for (const rotation of [0,1,15,37,90,180,270,359]) {
    await settings.save({device:{rotation}});
    for(const id of store.enabledModules()) { store.setModule(id); assert.equal(store.frame().rotation, rotation); }
  }
  const restored = new StudioSettings(new FaceStore(), {filePath}); await restored.load();
  assert.equal(restored.value.device.rotation,359);
  for(const rotation of [-90,45.5,360,'90',null,true]) await assert.rejects(settings.save({device:{rotation}}));
  assert.equal(settings.value.device.rotation,359);
});

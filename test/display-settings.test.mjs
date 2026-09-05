import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FaceStore } from '../bridge/store.mjs';
import { DisplaySettings } from '../bridge/display-settings.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hf-display-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FaceStore(), filePath = path.join(directory, 'settings.json');
  return { store, filePath, settings: new DisplaySettings(store, { filePath }) };
}

test('spacing is saved in request order and restored after restart', async t => {
  const { store, filePath, settings } = await fixture(t);
  await settings.load();
  assert.equal(store.textGap, 8);
  await Promise.all([settings.save(4), settings.save(16), settings.save(8)]);
  assert.equal(store.textGap, 8);
  await settings.save(4);
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), { textGap: 4 });
  const restarted = new FaceStore();
  await new DisplaySettings(restarted, { filePath }).load();
  assert.equal(restarted.snapshot().layout.textGap, 4);
  assert.equal(restarted.frame().textGap, 4);
});

test('invalid saved spacing falls back and invalid requests leave saved settings intact', async t => {
  const { store, filePath, settings } = await fixture(t);
  t.mock.method(console, 'warn', () => {});
  for (const contents of ['not json', 'null', '{"textGap":100}', '{"textGap":"4"}']) {
    await writeFile(filePath, contents); await settings.load();
    assert.equal(store.textGap, 8);
  }
  await settings.save(16);
  for (const value of [null, undefined, '4', true, 4.5, 0, 7, 20, 100, NaN]) {
    assert.throws(() => settings.save(value), /text spacing/);
  }
  assert.equal(store.textGap, 16);
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), { textGap: 16 });
});

test('a failed save leaves the live setting intact and later saves recover', async t => {
  const { store, filePath, settings } = await fixture(t);
  await mkdir(filePath);
  await assert.rejects(settings.save(4));
  assert.equal(store.textGap, 8);
  await rm(filePath, { recursive: true });
  await settings.save(16);
  assert.equal(store.textGap, 16);
});

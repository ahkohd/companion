import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bundleDependencies, externalLibraries } from '../scripts/bundle-menubar.mjs';

test('portable Node rejects machine-specific library dependencies', () => {
  assert.deepEqual(externalLibraries('/bin/node:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1)\n\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 1)\n'), []);
  assert.deepEqual(externalLibraries('/bin/node:\n\t/nix/store/private/libz.dylib (compatibility version 1)\n\t@rpath/missing.dylib (compatibility version 1)\n'), ['/nix/store/private/libz.dylib', '@rpath/missing.dylib']);
});

test('production bundle preserves dependency cycles with internal links and excludes development packages', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'companion-bundle-'));
  const root = path.join(temporary, 'source'), destination = path.join(temporary, 'bundle/node_modules');
  try {
    for (const [name, dependencies] of [['a', { b: '1' }], ['b', { a: '1' }], ['development-only', {}]]) {
      const folder = path.join(root, 'node_modules', name); await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, version: '1.0.0', dependencies }));
    }
    assert.equal(await bundleDependencies(root, destination, ['a']), 2);
    const a = await realpath(path.join(destination, 'a')), b = await realpath(path.join(a, 'node_modules/b'));
    const actualDestination = await realpath(destination); assert.ok(a.startsWith(actualDestination)); assert.ok(b.startsWith(actualDestination)); assert.equal(await realpath(path.join(b, 'node_modules/a')), a);
    assert.equal(JSON.parse(await readFile(path.join(b, 'package.json'))).name, 'b'); assert.ok(!(await readdir(destination)).includes('development-only'));
    await rm(root, { recursive: true }); assert.equal(JSON.parse(await readFile(path.join(destination, 'a/node_modules/b/package.json'))).name, 'b');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

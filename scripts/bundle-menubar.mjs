import { buildAudio } from './build-audio.mjs';
import { buildMediaRemote } from './build-mediaremote.mjs';
import { createHash } from 'node:crypto';
import { cp, mkdir, open, readdir, readFile, realpath, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const execute = promisify(execFile);

export function externalLibraries(output) {
  return output.split('\n').slice(1).map(line => line.trim().split(' (')[0]).filter(line => line && !line.endsWith(':') && !line.startsWith('/usr/lib/') && !line.startsWith('/System/Library/'));
}
export async function validateNode(binary, arch) {
  const resolved = await realpath(binary);
  const { stdout } = await execute('/usr/bin/otool', ['-L', resolved]);
  const dependencies = externalLibraries(stdout);
  if (dependencies.length) throw new Error(`Use an official standalone Node binary. External dependencies: ${dependencies.join(', ')}`);
  const result = await execute(resolved, ['-p', 'JSON.stringify({arch:process.arch,major:Number(process.versions.node.split(".")[0])})']);
  const runtime = JSON.parse(result.stdout);
  if (runtime.arch !== arch || runtime.major < 24) throw new Error(`Node must be version 24 or later for ${arch}.`);
  return resolved;
}

const runtimePackages = ['serialport', 'node-roon-api', 'node-roon-api-transport', 'node-roon-api-image', 'sharp'];
async function packageDirectory(name, from) {
  for (let directory = from; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', name);
    try { await readFile(path.join(candidate, 'package.json')); return await realpath(candidate); } catch {}
    if (directory === path.dirname(directory)) throw new Error(`Missing runtime dependency ${name} from ${from}`);
  }
}
export async function bundleDependencies(root, destination, packages = runtimePackages) {
  const copied = new Map();
  await mkdir(destination, { recursive: true });
  const link = async (source, target) => { await mkdir(path.dirname(target), { recursive: true }); await symlink(path.relative(path.dirname(target), source), target); };
  async function copyPackage(source) {
    if (copied.has(source)) return copied.get(source);
    const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
    const id = createHash('sha256').update(source).digest('hex').slice(0, 16);
    const target = path.join(destination, '.companion-packages', id);
    copied.set(source, target);
    await cp(source, target, { recursive: true, dereference: true, filter: file => !['node_modules', '.git'].includes(path.basename(file)) });
    const optional = manifest.optionalDependencies || {};
    const dependencies = { ...manifest.dependencies, ...optional };
    for (const name of Object.keys(dependencies)) {
      let dependency;
      try { dependency = await packageDirectory(name, source); } catch (error) { if (Object.hasOwn(optional, name)) continue; throw error; }
      const resolved = await copyPackage(dependency);
      await link(resolved, path.join(target, 'node_modules', name));
    }
    return target;
  }
  for (const name of packages) await link(await copyPackage(await packageDirectory(name, root)), path.join(destination, name));
  return copied.size;
}

export async function bundleRuntime({ root, resources, node, run, arch }) {
  const runtime = path.join(resources, 'runtime');
  await mkdir(runtime, { recursive: true });
  for (const entry of ['bridge', 'shared', 'skills', 'dist', 'package.json', 'LICENSE']) {
    await cp(path.join(root, entry), path.join(runtime, entry), { recursive: true, dereference: true, filter: source => !['.ignored', '.vite-temp'].includes(path.basename(source)) });
  }
  await buildAudio({root,destination:path.join(runtime,'.tools'),run,arch});
  await buildMediaRemote({ root, destination: path.join(runtime, '.tools/mediaremote'), run, arch });
  const packages = await bundleDependencies(root, path.join(runtime, 'node_modules'));
  console.log(`Bundled ${packages} production runtime packages.`);
  await mkdir(path.join(runtime, 'scripts'), { recursive: true });
  for (const script of ['pointer.swift', 'companion.mjs']) await cp(path.join(root, 'scripts', script), path.join(runtime, 'scripts', script));
  await cp(node, path.join(resources, 'node'), { dereference: true });
  await mkdir(path.join(runtime, '.tools/bin'), { recursive: true });
  await run('/usr/bin/xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macosx13.0`, path.join(runtime, 'scripts/pointer.swift'), '-o', path.join(runtime, '.tools/bin/herdr-pointer')]);
  const licenses = path.join(resources, 'Licenses'); await mkdir(licenses, { recursive: true });
  await cp(path.join(path.dirname(path.dirname(node)), 'LICENSE'), path.join(licenses, 'Node-LICENSE'));
  for (const [source, name] of [['fonts/geist/OFL.txt', 'Geist-OFL.txt'], ['web/vendor/bloub/LICENSE', 'Bloub-LICENSE'], ['web/vendor/grok-bot/LICENSE', 'Grok-LICENSE'], ['public/icons/reicon/LICENSE.txt', 'Reicon-LICENSE.txt']]) await cp(path.join(root, source), path.join(licenses, name));
  return runtime;
}

const magicNumbers = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);
async function macho(file) {
  const handle = await open(file, 'r');
  try { const bytes = Buffer.alloc(4), result = await handle.read(bytes, 0, 4, 0); if (result.bytesRead !== 4 || !magicNumbers.has(bytes.readUInt32BE())) return false; }
  finally { await handle.close(); }
  const { stdout } = await execute('/usr/bin/file', ['-b', file]); return stdout.includes('Mach-O');
}
export async function signingTargets(root) {
  const targets = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await visit(file); if (/\.(app|xpc|framework)$/.test(entry.name)) targets.push({ path: file, bundle: true }); }
      else if (entry.isFile() && await macho(file)) targets.push({ path: file, bundle: false });
    }
  }
  await visit(root); targets.push({ path: root, bundle: true }); return targets;
}

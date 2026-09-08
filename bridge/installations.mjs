import { readFile, writeFile, mkdir, lstat, readdir, realpath, rename, unlink, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, delimiter, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import catalog from '../shared/skill-catalog.json' with { type: 'json' };

const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const stat = async path => { try { return await lstat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
async function filesAt(path, prefix = '') {
  const result = {};
  const info = await stat(path);
  if (!info) return null;
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Not a regular directory: ${path}`);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) { result[relative + '/'] = Buffer.alloc(0); Object.assign(result, await filesAt(join(path, entry.name), relative + '/')); }
    else if (entry.isFile()) result[relative] = await readFile(join(path, entry.name));
    else throw new Error(`Symbolic links and special files cannot be managed: ${join(path, entry.name)}`);
  }
  return result;
}
const hashes = files => Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]));
const equal = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export class Installations {
  constructor({ root = rootDefault, home = homedir(), node = process.execPath } = {}) {
    this.root = resolve(root); this.home = resolve(home); this.node = resolve(node);
    this.configDirectory = join(this.home, '.config', 'companion');
    this.configPath = join(this.configDirectory, 'installations.json');
  }
  async config() {
    const info = await stat(this.configPath);
    if (!info) return { directory: join(this.home, '.agents', 'skills'), managed: {} };
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Installation settings must be a regular file.');
    const config = JSON.parse(await readFile(this.configPath, 'utf8'));
    if (typeof config.directory !== 'string' || !isAbsolute(config.directory) || !config.managed || typeof config.managed !== 'object') throw new Error('Invalid installation settings.');
    for (const [path, manifest] of Object.entries(config.managed)) {
      if (!isAbsolute(path) || !manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid installation ownership.');
      for (const [relative, digest] of Object.entries(manifest)) {
        if (relative && (isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '.') || relative.includes('\\') || relative.includes('\0'))) throw new Error('Invalid installation ownership path.');
        if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid installation ownership hash.');
      }
    }
    return config;
  }
  async save(config) {
    const temp = join(this.configDirectory, `.installations-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, this.configPath);
  }
  async desired(kind, name) {
    if (kind === 'cli') return { '': Buffer.from(`#!/bin/sh\n# Installed by Companion.\nexec ${quote(this.node)} ${quote(join(this.root, 'scripts', 'companion.mjs'))} "$@"\n`) };
    if (!catalog.some(item => item.name === name)) throw new Error(`Unknown skill: ${name}`);
    const files = await filesAt(join(this.root, 'skills', name));
    if (!files || !files['SKILL.md']) throw new Error(`Bundled skill is missing: ${name}`);
    return files;
  }
  async inspect(path, desired, config, kind) {
    const info = await stat(path);
    if (!info) return 'missing';
    const owned = config.managed[path];
    if (!owned || info.isSymbolicLink()) return 'conflict';
    try {
      const actual = kind === 'cli' ? (info.isFile() ? { '': hash(await readFile(path)) } : null) : hashes(await filesAt(path));
      if (!actual || !equal(actual, owned)) return 'modified';
      return equal(actual, hashes(desired)) && (kind !== 'cli' || (info.mode & 0o111)) ? 'installed' : 'outdated';
    } catch { return 'modified'; }
  }
  async target(directory, name) {
    // Resolve the chosen parent, including intentional dotfiles symlinks, never the managed target.
    let parent;
    try { parent = await realpath(directory); } catch (e) { if (e.code !== 'ENOENT') throw e; parent = resolve(directory); }
    return join(parent, name);
  }
  async snapshot() {
    const config = await this.config();
    const cliPath = await this.target(join(this.home, '.local', 'bin'), 'companion');
    const items = [];
    for (const item of catalog) {
      const path = await this.target(config.directory, item.name);
      items.push({ ...item, path, status: await this.inspect(path, await this.desired('skill', item.name), config, 'skill') });
    }
    const pathDirs = await Promise.all((process.env.PATH || '').split(delimiter).map(async p => { try { return await realpath(p); } catch { return resolve(p); } }));
    let resolvedCommand;
    for (const directory of pathDirs) { const candidate = join(directory, 'companion'); try { const actual = await realpath(candidate); const info = await stat(actual); if (info?.isFile() && (info.mode & 0o111)) { resolvedCommand = actual; break; } } catch {} }
    return { cli: { path: cliPath, status: await this.inspect(cliPath, await this.desired('cli'), config, 'cli'), onPath: resolvedCommand === cliPath }, skills: { directory: config.directory, items } };
  }
  async manage(config, kind, name, remove) {
    const directory = kind === 'cli' ? join(this.home, '.local', 'bin') : config.directory;
    await mkdir(directory, { recursive: true });
    const path = await this.target(directory, kind === 'cli' ? 'companion' : name);
    const desired = await this.desired(kind, name);
    const status = await this.inspect(path, desired, config, kind);
    if (['modified', 'conflict'].includes(status)) throw new Error(`Preserving ${status} files at ${path}. Move or remove them manually first.`);
    if (remove) {
      if (status !== 'missing') await this.removeOwned(path, config.managed[path], kind);
      delete config.managed[path];
      await this.save(config); return;
    }
    if (status === 'installed') return;
    const staged = join(dirname(path), `.companion-stage-${randomUUID()}`);
    const backup = join(dirname(path), `.companion-backup-${randomUUID()}`);
    const desiredHashes = hashes(desired);
    const previous = config.managed[path];
    let backedUp = false, published = false;
    try {
      if (kind === 'skill') await mkdir(staged);
      for (const [relative, bytes] of Object.entries(desired)) {
        const file = kind === 'cli' ? staged : join(staged, relative);
        if (relative.endsWith('/')) { await mkdir(file, { recursive: true }); continue; }
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes, { flag: 'wx', mode: kind === 'cli' ? 0o755 : 0o644 });
      }
      // Fully stage the replacement before moving the working installation.
      const latest = await this.inspect(path, desired, config, kind);
      if (latest !== status) throw new Error('Installation changed while updating. Try again.');
      if (status !== 'missing') { await rename(path, backup); backedUp = true; }
      await rename(staged, path); published = true;
      config.managed[path] = desiredHashes;
      await this.save(config);
    } catch (error) {
      if (published) await this.removeOwned(path, desiredHashes, kind);
      if (backedUp) await rename(backup, path);
      throw error;
    } finally {
      if (await stat(staged)) {
        if (kind === 'cli') await unlink(staged);
        else await this.removeOwned(staged, hashes(await filesAt(staged)), kind);
      }
    }
    if (backedUp) await this.removeOwned(backup, previous, kind);
  }
  async removeOwned(path, owned, kind) {
    if (kind === 'cli') { await unlink(path); return; }
    for (const relative of Object.keys(owned)) if (!relative.endsWith('/')) await unlink(join(path, relative));
    const dirs = new Set(['']);
    for (const relative of Object.keys(owned)) {
      let dir = relative.endsWith('/') ? relative.slice(0, -1) : dirname(relative);
      while (dir !== '.') { dirs.add(dir); dir = dirname(dir); }
    }
    for (const dir of [...dirs].sort((a,b) => b.length - a.length)) await rmdir(join(path, dir));
  }
  async change(input) {
    if (!input || typeof input !== 'object') throw new Error('An installation action is required.');
    await mkdir(this.configDirectory, { recursive: true });
    const lock = join(this.configDirectory, 'installations.lock');
    const owner = join(lock, 'owner.json');
    const acquire = async () => { await mkdir(lock); await writeFile(owner, JSON.stringify({ pid: process.pid }), { flag: 'wx' }); };
    try { await acquire(); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try {
        const { pid } = JSON.parse(await readFile(owner, 'utf8'));
        if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (error) { stale = error.code === 'ESRCH'; } }
      } catch (error) { if (error.code === 'ENOENT') stale = Date.now() - (await stat(lock))?.mtimeMs > 10000; }
      if (!stale) throw new Error('Another installation is in progress. Try again.');
      try { await unlink(owner); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rmdir(lock);
      await acquire();
    }
    try {
      const config = await this.config();
      if (input.action === 'skills.directory') {
        if (typeof input.directory !== 'string' || !input.directory.trim() || /[\0\r\n]/.test(input.directory)) throw new Error('Enter an absolute skills directory.');
        const directory = input.directory === '~' ? this.home : input.directory.startsWith('~/') ? join(this.home, input.directory.slice(2)) : input.directory;
        if (!isAbsolute(directory)) throw new Error('Enter an absolute skills directory.');
        config.directory = resolve(directory); await this.save(config);
      } else if (input.action === 'cli.install' || input.action === 'cli.uninstall') await this.manage(config, 'cli', null, input.action.endsWith('uninstall'));
      else if (input.action === 'skills.install' || input.action === 'skills.uninstall') await this.manage(config, 'skill', input.name, input.action.endsWith('uninstall'));
      else if (input.action === 'skills.installAll') {
        for (const item of catalog) await this.manage(config, 'skill', item.name, false);
      } else throw new Error('Unknown installation action.');
      return await this.snapshot();
    } finally { await unlink(owner); await rmdir(lock); }
  }
}

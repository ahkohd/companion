import { spawn, execFile } from 'node:child_process';
import { stat, mkdir, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const POINTER_INTERVALS = [100, 250, 500, 1000];
const source = fileURLToPath(new URL('../scripts/pointer.swift', import.meta.url));
const binary = fileURLToPath(new URL('../.tools/bin/herdr-pointer', import.meta.url));
let building;
export function ensurePointerHelper() {
  if (process.env.COMPANION_POINTER_HELPER) return stat(process.env.COMPANION_POINTER_HELPER).then(() => process.env.COMPANION_POINTER_HELPER);
  return building ??= (async () => {
    const sourceInfo = await stat(source);
    const built = await stat(binary).catch(() => null);
    if (built && built.mtimeMs >= sourceInfo.mtimeMs) return binary;
    await mkdir(new URL('../.tools/bin/', import.meta.url), { recursive: true });
    const temporary = `${binary}.${process.pid}`;
    try {
      await promisify(execFile)('xcrun', ['swiftc', '-O', source, '-o', temporary], { timeout: 60000, maxBuffer: 16384 });
      await rename(temporary, binary);
    } catch {
      throw new Error('Could not build mouse helper. Install the Xcode command line tools, then try again.');
    } finally { await rm(temporary, { force: true }); }
    return binary;
  })().finally(() => { building = undefined; });
}

export class PointerTracker {
  child = null; timer = null; generation = 0;
  constructor(store, { platform = process.platform, prepare = ensurePointerHelper, launch = spawn, staleMs = 3500 } = {}) {
    this.store = store; this.prepare = prepare; this.launch = launch; this.staleMs = staleMs;
    this.supported = platform === 'darwin';
    store.setPointer({ supported: this.supported });
  }
  configure(config) {
    if (!config || typeof config.enabled !== 'boolean' || !POINTER_INTERVALS.includes(config.intervalMs)) {
      throw new Error('Choose a mouse update interval of 100, 250, 500 or 1000 ms.');
    }
    if (config.enabled && !this.supported) throw new Error('Follow mouse is available on macOS.');
    const current = this.store.pointer;
    if (config.enabled === current.enabled && config.intervalMs === current.intervalMs && current.status !== 'error') return;
    this.release();
    this.store.setPointer({ enabled: config.enabled, intervalMs: config.intervalMs, status: config.enabled ? 'starting' : 'off', x: 0, y: 0, error: null });
    if (config.enabled) void this.start(this.generation, config.intervalMs);
  }
  release() {
    this.generation++;
    clearInterval(this.timer); this.timer = null;
    this.child?.kill(); this.child = null;
  }
  stop() { this.release(); this.store.setPointer({ enabled: false, status: 'off', x: 0, y: 0, error: null }); }
  async start(generation, intervalMs) {
    const current = () => generation === this.generation;
    const fail = message => {
      if (!current()) return;
      this.release();
      this.store.setPointer({ status: 'error', x: 0, y: 0, error: message });
    };
    try {
      const executable = await this.prepare();
      if (!current()) return;
      const child = this.launch(executable, [String(intervalMs)], { stdio: ['ignore', 'pipe', 'ignore'] });
      this.child = child;
      let buffer = '', lastSample = Date.now();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (!current()) return;
        buffer += chunk;
        if (buffer.length > 4096) return fail('Mouse helper returned invalid data. Switch Follow mouse off and on to retry.');
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          let point;
          try { point = JSON.parse(line); } catch { continue; }
          if (!point || ![point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1)) continue;
          lastSample = Date.now();
          this.store.setPointer({ status: 'active', error: null, x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 });
        }
      });
      child.on('error', () => fail('Could not start mouse helper. Switch Follow mouse off and on to retry.'));
      child.on('close', () => fail('Mouse helper stopped. Switch Follow mouse off and on to retry.'));
      this.timer = setInterval(() => {
        if (Date.now() - lastSample > this.staleMs) fail('Mouse position stopped updating. Switch Follow mouse off and on to retry.');
      }, Math.min(1000, this.staleMs));
      this.timer.unref();
    } catch (error) { fail(error.message); }
  }
}

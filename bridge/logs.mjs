import { randomUUID } from 'node:crypto';
import { formatWithOptions } from 'node:util';

const levels = new Set(['info', 'warn', 'error']);
export class DiagnosticLogs {
  constructor({ limit = 500, now = () => new Date() } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Log capacity must be between 1 and 500.');
    this.limit = limit; this.now = now; this.sessionId = randomUUID(); this.nextId = 1; this.entries = []; this.previousDevice = null;
  }
  append(level, message) {
    if (!levels.has(level)) throw new Error('Unknown log level.');
    const bounded = Array.from(String(message).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')).slice(0, 2000).join('');
    this.entries.push({ id: this.nextId++, timestamp: this.now().toISOString(), level, message: bounded });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }
  snapshot() { return { sessionId: this.sessionId, entries: this.entries.map(entry => ({ ...entry })) }; }
  observeDevice(device) {
    const current = { status: device.status ?? 'unknown', mode: device.connection?.mode ?? null, error: device.error || null };
    const previous = this.previousDevice;
    this.previousDevice = current;
    if (!previous || previous.status !== current.status) this.append('info', `USB device status: ${current.status}`);
    if (current.mode && previous?.mode !== current.mode) this.append('info', `USB connection mode: ${current.mode}`);
    if (current.error !== previous?.error) {
      if (current.error) this.append('error', `Device: ${current.error}`);
      else if (previous?.error) this.append('info', 'Device error cleared.');
    }
  }
}

export function installConsoleLogs(logs, target = console) {
  const originals = {}, wrappers = {};
  for (const [method, level] of Object.entries({ log: 'info', info: 'info', warn: 'warn', error: 'error' })) {
    const original = target[method]; originals[method] = original;
    wrappers[method] = function (...args) {
      try { logs.append(level, formatWithOptions({ depth: 3, maxArrayLength: 20, maxStringLength: 2000, customInspect: false, getters: false, colors: false }, ...args)); } catch { /* Logging must not interfere with application output. */ }
      return Reflect.apply(original, target, args);
    };
    target[method] = wrappers[method];
  }
  return () => { for (const method of Object.keys(originals)) if (target[method] === wrappers[method]) target[method] = originals[method]; };
}

import { SerialPort } from 'serialport';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function normalizeSerialPath(value) { return typeof value === 'string' ? value.replace(/^\/dev\/tty\./, '/dev/cu.') : ''; }
const modes = ['off', 'auto', 'manual'];
const usbId = value => String(value ?? '').replace(/^0x/i, '').toLowerCase().padStart(4, '0');
function portsFrom(rows) {
  const ports = new Map();
  for (const row of rows) {
    if (!row || typeof row.path !== 'string' || !row.path) continue;
    const port = { path: normalizeSerialPath(row.path), manufacturer: String(row.manufacturer ?? ''), serialNumber: String(row.serialNumber ?? ''), vendorId: String(row.vendorId ?? ''), productId: String(row.productId ?? '') };
    port.compatible = usbId(port.vendorId) === '303a' && usbId(port.productId) === '1001';
    ports.set(port.path, port);
  }
  return [...ports.values()].sort((a, b) => a.path.localeCompare(b.path));
}
export class SerialConnection {
  constructor(store, { link, filePath = '.cache/device-connection.json', port = process.env.ESP_SERIAL_PORT || '', listPorts = () => SerialPort.list(), interval = 3000 } = {}) {
    this.store = store; this.link = link; this.filePath = filePath; this.listPorts = listPorts; this.interval = interval;
    this.config = { mode: port ? 'auto' : 'off', path: normalizeSerialPath(port), serialNumber: '' };
    this.ports = []; this.error = null; this.scanning = false; this.activePath = ''; this.stopped = true; this.queue = Promise.resolve();
  }
  snapshot() { return { ...this.config, ports: this.ports.map(port => ({ ...port })), scanning: this.scanning, error: this.error }; }
  publish() { this.store.setDevice({ connection: this.snapshot() }); }
  run(operation) { const result = this.queue.then(operation); this.queue = result.catch(() => {}); return result; }
  async save(config = this.config) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
  start() { return this.run(async () => {
    if (!this.stopped) return this.snapshot();
    try {
      const saved = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!modes.includes(saved.mode) || typeof saved.path !== 'string' || typeof saved.serialNumber !== 'string') throw Error('Invalid saved device connection');
      if ((saved.vendorId !== undefined && typeof saved.vendorId !== 'string') || (saved.productId !== undefined && typeof saved.productId !== 'string')) throw Error('Invalid saved USB identity');
      this.config = { mode: saved.mode, path: normalizeSerialPath(saved.path), serialNumber: saved.serialNumber, vendorId: saved.vendorId ?? '', productId: saved.productId ?? '' };
    } catch (error) { if (error.code !== 'ENOENT') { this.config.mode = 'off'; this.loadError = this.error = 'Could not read saved device connection. Select a device to reconnect.'; } }
    this.stopped = false;
    await this.scan();
    this.timer = setInterval(() => { void this.refresh().catch(() => {}); }, this.interval); this.timer.unref?.();
    return this.snapshot();
  }); }
  stop() { clearInterval(this.timer); return this.run(async () => { this.stopped = true; clearInterval(this.timer); await this.switchPort(''); }); }
  refresh() { return this.run(async () => { if (!this.stopped) await this.scan(); return this.snapshot(); }); }
  async enumerate() {
    this.scanning = true; this.publish();
    try { this.ports = portsFrom(await this.listPorts()); this.error = this.loadError ?? null; return true; }
    catch (error) { this.error = `Could not scan USB ports: ${error.message}`; return false; }
    finally { this.scanning = false; this.publish(); }
  }
  async switchPort(next) {
    if (next && next === this.activePath && !this.link.stopped) return;
    await this.link.stop(); this.activePath = ''; this.link.path = '';
    if (next && !this.stopped) { this.link.path = next; this.activePath = next; this.link.start(); }
    else this.store.setDevice({ status: this.config.mode === 'off' ? 'disabled' : 'disconnected', port: null, error: null });
  }
  async scan() {
    if (!await this.enumerate()) return;
    let selected;
    if (this.config.mode !== 'off') {
      if (this.config.serialNumber) {
        const matches = this.ports.filter(port => port.serialNumber === this.config.serialNumber && (this.config.mode === 'manual' || port.compatible) &&
          (!this.config.vendorId || usbId(port.vendorId) === usbId(this.config.vendorId)) && (!this.config.productId || usbId(port.productId) === usbId(this.config.productId)));
        if (matches.length === 1) selected = matches[0];
        else if (matches.length > 1 && this.config.mode === 'manual') selected = matches.find(port => port.path === this.config.path);
        if (matches.length > 1 && !selected) this.error = 'Multiple ports report this device identity. Select a port.';
      } else {
        if (this.config.path) selected = this.ports.find(port => port.path === this.config.path && (this.config.mode === 'manual' || port.compatible));
        if (!selected && this.config.mode === 'auto') {
        const candidates = this.ports.filter(port => port.compatible);
        if (candidates.length === 1) selected = candidates[0];
        else if (candidates.length > 1) this.error = 'Multiple compatible devices found. Select a port.';
        }
      }
      if (selected && (selected.path !== this.config.path || selected.serialNumber !== this.config.serialNumber || selected.vendorId !== this.config.vendorId || selected.productId !== this.config.productId)) {
        const updated = { ...this.config, path: selected.path, serialNumber: selected.serialNumber, vendorId: selected.vendorId, productId: selected.productId };
        await this.save(updated); this.config = updated;
      }
    }
    await this.switchPort(selected?.path ?? ''); this.publish();
  }
  configure(input) { return this.run(async () => {
    if (!input || typeof input !== 'object' || !modes.includes(input.mode) || Object.keys(input).some(key => !['mode', 'path'].includes(key)) || (input.path !== undefined && typeof input.path !== 'string')) throw Error('Choose off, auto or manual device connection.');
    let updated = { ...this.config, mode: input.mode };
    if (input.mode === 'manual' || input.path !== undefined) {
      if (!await this.enumerate()) throw Error(this.error);
      const selected = this.ports.find(port => port.path === normalizeSerialPath(input.path));
      if (!selected) throw Error('Select a currently available USB port.');
      updated = { mode: input.mode, path: selected.path, serialNumber: selected.serialNumber, vendorId: selected.vendorId, productId: selected.productId };
    }
    await this.save(updated); this.config = updated; this.loadError = null; this.error = null;
    if (updated.mode === 'off') { await this.switchPort(''); this.publish(); }
    else await this.scan();
    return this.snapshot();
  }); }
  reconnect() { return this.run(async () => {
    if (this.config.mode !== 'off' && !this.stopped) { await this.switchPort(''); await this.scan(); }
    return this.snapshot();
  }); }
}

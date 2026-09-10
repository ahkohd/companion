import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { resolveDeviceAppearance } from '../shared/device-appearance.mjs';
import { speedDialPageSize, SPEED_DIAL_MAX_SLOTS, SPEED_DIAL_ATLAS_ICON_SIZE } from '../shared/speed-dial-layout.mjs';

const hash = (value, algorithm = 'sha1') => createHash(algorithm).update(value).digest('hex');
const isId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value);
const isAsset = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim() && !value.includes('\0') && value.length <= max;
const SUCCESS_FEEDBACK_MS = 2000;

export function validateSpeedDial(config) {
  if (!object(config) || !['grid', 'list'].includes(config.layout) || ![0, 4, 6].includes(config.gridSize) || ![3, 4].includes(config.listRows) || typeof config.showLabels !== 'boolean') throw Error('Choose a valid Speed Dial layout.');
  if (!Array.isArray(config.buttons) || config.buttons.length > 48) throw Error('Speed Dial supports up to 48 buttons.');
  const ids = new Set();
  for (const button of config.buttons) {
    if (!object(button) || !isId(button.id) || ids.has(button.id)) throw Error('Each Speed Dial button needs a unique ID.');
    ids.add(button.id);
    if (!text(button.label, 96) || [...button.label].length > 24 || Buffer.byteLength(button.label) > 64 || /[\x00-\x1f\x7f]/.test(button.label)) throw Error('Button names must be 1 to 24 characters and at most 64 bytes.');
    if (typeof button.enabled !== 'boolean' || !(button.color === null || (Number.isInteger(button.color) && button.color >= 0 && button.color <= 0xffffff))) throw Error('Choose a valid button color and enabled state.');
    if (!object(button.icon) || !['emoji', 'builtin', 'image'].includes(button.icon.kind) || typeof button.icon.value !== 'string' || button.icon.value.length > 256 || !isAsset(button.icon.assetId)) throw Error('Choose an icon for each Speed Dial button.');
    if (!Array.isArray(button.actions) || button.actions.length < 1 || button.actions.length > 8) throw Error('Add 1 to 8 actions to each button.');
    for (const action of button.actions) {
      if (!object(action) || !['shell', 'app', 'url', 'file', 'shortcut'].includes(action.type) || !text(action.value, 4096)) throw Error('Each action needs a type and a value of up to 4096 characters.');
      if (action.type === 'url') {
        let url; try { url = new URL(action.value); } catch { throw Error('Enter a complete URL, including its scheme.'); }
        if (!/^[a-z][a-z0-9+.-]*:$/.test(url.protocol) || ['javascript:', 'data:', 'file:'].includes(url.protocol)) throw Error('Use a website or app URL. For local files, choose Open file.');
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(config)) > 220000) throw Error('Speed Dial settings are too large. Shorten the action scripts.');
}

export class SpeedDialIcons {
  constructor(directory) { this.directory = directory; }
  async save(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.length > 180000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw Error('Choose a PNG icon of at most 128 KB.');
    const input = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    if (input.length > 131072 || !input.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw Error('Choose a valid PNG icon.');
    let bytes;
    try { bytes = await sharp(input, { limitInputPixels: 1048576 }).resize(96, 96, { fit: 'contain', background: '#00000000' }).ensureAlpha().png().toBuffer(); }
    catch { throw Error('This icon could not be read. Choose another image.'); }
    const assetId = hash(bytes, 'sha256');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(this.directory, `${assetId}.png`), bytes, { mode: 0o600, flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    return { assetId, url: `/api/speed-dial/icons/${assetId}.png` };
  }
  async read(id) {
    if (!isAsset(id)) return null;
    try { return await readFile(path.join(this.directory, `${id}.png`)); }
    catch { return null; }
  }
}

const hexColor = color => `#${color.toString(16).padStart(6, '0')}`;
export async function makeSpeedDialAtlas(buttons, palette, icons, layout = 'grid') {
  if (buttons.length > SPEED_DIAL_MAX_SLOTS) throw Error('Too many buttons on one page.');
  // ponytail: 32px tiles retain the existing transfer; enlarge the atlas if icons need more detail.
  const size = SPEED_DIAL_ATLAS_ICON_SIZE, columns = 160 / size;
  const overlays = await Promise.all(buttons.map(async (button, index) => {
    const background = hexColor(layout === 'list' ? palette.background : button.color ?? palette.surface);
    const bytes = await icons.read(button.icon.assetId);
    const input = bytes
      ? await sharp(bytes).resize(size, size).flatten({ background }).removeAlpha().png().toBuffer()
      : await sharp({ create: { width: size, height: size, channels: 3, background } }).png().toBuffer();
    return { input, left: index % columns * size, top: Math.floor(index / columns) * size };
  }));
  const rgb = await sharp({ create: { width: 160, height: 160, channels: 3, background: hexColor(palette.background) } }).composite(overlays).removeAlpha().raw().toBuffer();
  const pixels = Buffer.alloc(51200);
  for (let i = 0; i < 25600; i++) pixels.writeUInt16LE(((rgb[i * 3] >> 3) << 11) | ((rgb[i * 3 + 1] >> 2) << 5) | (rgb[i * 3 + 2] >> 3), i * 2);
  return { id: hash(pixels), width: 160, height: 160, pixels };
}

export function actionCommand(action, platform = process.platform, home = os.homedir()) {
  if (action.type === 'shell') return [platform === 'darwin' ? '/bin/zsh' : '/bin/sh', ['-lc', action.value]];
  if (platform !== 'darwin') throw Error('This action requires macOS.');
  if (action.type === 'shortcut') return ['/usr/bin/shortcuts', ['run', action.value]];
  if (action.type === 'app') return ['/usr/bin/open', ['-a', action.value]];
  if (action.type === 'file') {
    const value = action.value.startsWith('~/') ? path.join(home, action.value.slice(2)) : action.value;
    if (!path.isAbsolute(value)) throw Error('Enter an absolute file path or a path starting with ~/.');
    return ['/usr/bin/open', ['--', value]];
  }
  return ['/usr/bin/open', ['--', action.value]];
}

export function executeSpeedDialAction(action, { signal, timeout = 30000, platform = process.platform } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error('Action cancelled.'));
    const [command, args] = actionCommand(action, platform);
    const child = spawn(command, args, { cwd: os.homedir(), stdio: ['ignore', 'pipe', 'pipe'], detached: platform !== 'win32' });
    let output = '', failure;
    const kill = reason => {
      failure = reason;
      try { platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
    };
    const abort = () => kill('Action cancelled.');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => kill('Action timed out after 30 seconds.'), timeout);
    const capture = bytes => { output = (output + bytes.toString('utf8')).slice(-4096); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.once('error', () => { cleanup(); reject(Error('The action could not be started.')); });
    child.once('close', code => { cleanup(); if (failure || code !== 0) reject(Object.assign(Error(failure || `Action exited with code ${code}.`), { output })); else resolve(output); });
  });
}

export class SpeedDial extends EventEmitter {
  constructor({ icons, execute = executeSpeedDialAction } = {}) {
    super(); this.icons = icons; this.execute = execute; this.pageIndex = 0; this.results = Object.create(null); this.running = new Map(); this.successTimers = new Map(); this.art = null; this.artCache = new Map(); this.stopped = false;
  }
  configure(settings, systemAppearance = 'dark', profile = null) {
    const appearance = resolveDeviceAppearance(settings, systemAppearance);
    const screenShape = profile?.display?.shape === 'rectangular' ? 'rectangular' : 'round';
    const key = JSON.stringify([settings.modules.speedDial, appearance.design.speedDial, appearance.palette, screenShape]);
    if (key === this.configKey) return;
    this.configKey = key; this.config = {...structuredClone(settings.modules.speedDial), screenShape}; this.palette = appearance.palette;
    this.design = appearance.design.speedDial;
    this.pageIndex = Math.min(this.pageIndex, this.pageCount() - 1);
    for (const id of Object.keys(this.results)) if (!this.config.buttons.some(button => button.id === id)) { delete this.results[id]; this.clearSuccessFeedback(id); }
    this.updatePage(); return true;
  }
  buttons() { return this.config?.buttons.filter(button => button.enabled) || []; }
  pageCount() { return Math.max(1, Math.ceil(this.buttons().length / speedDialPageSize(this.config, this.design))); }
  visible() { const size = speedDialPageSize(this.config, this.design); return this.buttons().slice(this.pageIndex * size, (this.pageIndex + 1) * size); }
  publish() { if (!this.stopped) this.emit('change', this.snapshot()); }
  clearSuccessFeedback(id) { clearTimeout(this.successTimers.get(id)); this.successTimers.delete(id); }
  showSuccessFeedback(id) {
    this.clearSuccessFeedback(id);
    if (this.stopped || !this.config.buttons.some(button => button.id === id)) return;
    const timer = setTimeout(() => {
      if (this.successTimers.get(id) !== timer) return;
      this.successTimers.delete(id); this.publish();
    }, SUCCESS_FEEDBACK_MS);
    timer.unref?.(); this.successTimers.set(id, timer);
  }
  buttonStatus(id) {
    const status = this.results[id]?.status || 'idle';
    return status === 'success' && !this.successTimers.has(id) ? 'idle' : status;
  }
  updatePage() {
    this.openToken = hash(`${this.configKey}:${this.pageIndex}`);
    const visible = this.visible();
    const key = JSON.stringify([this.config.layout, visible.map(({ icon, color }) => [icon.assetId, color]), this.palette]);
    this.artKey = key; this.art = this.artCache.get(key) || null;
    this.publish();
    if (this.art) return;
    void makeSpeedDialAtlas(visible, this.palette, this.icons, this.config.layout).then(art => {
      if (this.stopped) return;
      this.artCache.set(key, art);
      if (this.artCache.size > 8) this.artCache.delete(this.artCache.keys().next().value);
      if (this.artKey === key) { this.art = art; this.publish(); }
    }).catch(error => { if (this.artKey === key) { this.artError = error.message; this.publish(); } });
  }
  page({ direction }) {
    if (![-1, 1].includes(direction)) throw Error('Choose a valid page direction.');
    this.pageIndex = (this.pageIndex + direction + this.pageCount()) % this.pageCount(); this.updatePage();
  }
  snapshot() {
    if (!this.config) return null;
    return { pageIndex: this.pageIndex, pageCount: this.pageCount(), results: structuredClone(this.results), dashboard: {
      status: 'ready', title: 'Speed Dial', detail: '', layout: this.config.layout, gridSize: this.config.gridSize, listRows: this.config.listRows, showLabels: this.config.showLabels, screenShape: this.config.screenShape,
      pageIndex: this.pageIndex, pageCount: this.pageCount(), openToken: this.openToken, artId: this.art?.id || '0'.repeat(40),
      buttons: this.visible().map((button, index) => ({ id: button.id, label: button.label, color: button.color, iconId: button.icon.assetId, iconIndex: index, enabled: button.enabled, status: this.buttonStatus(button.id) })),
    } };
  }
  run({ id, token }) {
    if (this.stopped) throw Error('The bridge is stopping.');
    const button = this.config.buttons.find(button => button.id === id && button.enabled);
    if (!button) throw Error('This button is no longer available.');
    if (token !== undefined && (token !== this.openToken || !this.visible().some(button => button.id === id))) throw Error('This page has changed. Tap the button again.');
    if (this.running.has(id)) throw Error('This button is already running.');
    if (this.running.size >= 4) throw Error('Four buttons are running. Wait for one to finish.');
    this.clearSuccessFeedback(id);
    const controller = new AbortController(); this.running.set(id, controller);
    this.results[id] = { status: 'running' }; this.publish();
    void this.runSequence(structuredClone(button), controller);
  }
  async runSequence(button, controller) {
    let output = '';
    try {
      for (const action of button.actions) {
        if (controller.signal.aborted) throw Error('Action cancelled.');
        output = (output + await this.execute(action, { signal: controller.signal })).slice(-4096);
      }
      this.results[button.id] = { status: 'success', output, finishedAt: Date.now() };
      this.showSuccessFeedback(button.id);
    } catch (error) { this.results[button.id] = { status: 'error', error: error.message, output: (output + (error.output || '')).slice(-4096), finishedAt: Date.now() }; }
    finally { this.running.delete(button.id); this.publish(); }
  }
  stop() { this.stopped = true; for (const id of this.successTimers.keys()) this.clearSuccessFeedback(id); for (const controller of this.running.values()) controller.abort(); }
}

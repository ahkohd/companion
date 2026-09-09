import packageInfo from '../package.json' with { type: 'json' };
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RoonApi from 'node-roon-api';
import RoonTransport from 'node-roon-api-transport';
import RoonImage from 'node-roon-api-image';
import sharp from 'sharp';

const clean = (value, limit = 160) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, limit);
const blank = () => ({ status: 'disabled', installed: true, version: '1.2.3', updatedAt: null, error: null,
  coreName: '', zones: [], zoneId: '', track: '', artist: '', playing: false, canPrevious: false, canNext: false, artId: null, artworkLoading: false });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class RoonSource extends EventEmitter {
  constructor({ pairingPath = fileURLToPath(new URL('../.cache/roon-pairing.json', import.meta.url)), dependencies = {}, requestTimeout = 5000, retryDelay = 5000 } = {}) {
    super(); this.pairingPath = pairingPath; this.deps = { RoonApi, RoonTransport, RoonImage, sharp, ...dependencies };
    this.requestTimeout = requestTimeout; this.retryDelay = retryDelay;
    this.config = { enabled: false, host: '', zoneId: '' }; this.value = blank(); this.generation = 0;
    this.started = false; this.pairing = {}; this.writeQueue = Promise.resolve(); this.zones = new Map(); this.artGeneration = 0;
  }
  snapshot() { return structuredClone(this.value); }
  publish(patch) {
    const next = { ...this.value, ...patch };
    if (same(next, this.value)) return;
    next.updatedAt = Date.now(); this.value = next; this.emit('change', this.snapshot());
  }
  configure(config) {
    if (!config || typeof config.enabled !== 'boolean' || typeof config.host !== 'string' || typeof config.zoneId !== 'string') throw Error('Invalid Roon settings.');
    const host = config.host.trim();
    if (host.length > 253 || host && !/^[a-zA-Z0-9.-]+$/.test(host) || config.zoneId.length > 256) throw Error('Use a Roon server hostname or IP address without a port.');
    const next = { enabled: config.enabled, host, zoneId: config.zoneId };
    const reconnect = next.enabled !== this.config.enabled || next.host !== this.config.host;
    if (same(next, this.config)) return;
    this.config = next;
    if (this.started && reconnect) { this.disconnect(); if (next.enabled) void this.connect(); else this.publish(blank()); }
    else if (this.started && this.core) this.selectZone();
  }
  async start() { if (this.started) return; this.started = true; if (this.config.enabled) await this.connect(); }
  stop() { this.started = false; this.disconnect(); this.publish(blank()); }
  disconnect() {
    this.generation++; this.artGeneration++; clearTimeout(this.retry); clearTimeout(this.authTimer);
    this.core = null; this.zones.clear(); this.art = null; this.artKey = ''; this.artPromise = null; this.controlPending = false;
    const api = this.api, manual = this.manual; this.api = this.manual = null;
    // The pinned Roon transport drops its ws reference when close() starts a
    // graceful handshake. Retain it so shutdown does not wait for the peer.
    const sockets = new Set([manual, ...Object.values(api?._sood_conns ?? {})]
      .map(connection => connection?.transport?.ws).filter(Boolean));
    try { api?.stop_discovery(); } catch { /* An already closed discovery socket needs no further cleanup. */ }
    try { manual?.transport?.close(); } catch { /* Close is best effort during shutdown. */ }
    try { api?.disconnect_all(); } catch { /* Close is best effort during shutdown. */ }
    for (const socket of sockets) {
      try { socket.terminate?.(); } catch { /* Already closed. */ }
    }
  }
  async loadPairing() {
    try { if ((await stat(this.pairingPath)).size > 65536) throw Error('oversize'); const value = JSON.parse(await readFile(this.pairingPath, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch (error) { if (error.code !== 'ENOENT') this.publish({ error: 'Could not read saved Roon pairing. Enable the extension again in Roon.' }); return {}; }
  }
  persist(state, generation) {
    if (generation !== this.generation) return;
    const copy = structuredClone(state), text = JSON.stringify(copy);
    if (Buffer.byteLength(text) > 65536) return;
    this.pairing = copy;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.pairingPath), { recursive: true, mode: 0o700 });
      const temp = `${this.pairingPath}.${process.pid}.tmp`;
      try { await writeFile(temp, text + '\n', { mode: 0o600 }); await rename(temp, this.pairingPath); }
      finally { await rm(temp, { force: true }); }
    }).catch(() => { if (generation === this.generation) this.publish({ error: 'Could not save Roon pairing. Check local file permissions.' }); });
  }
  async connect() {
    const generation = ++this.generation;
    this.publish({ ...blank(), status: 'loading' });
    await this.writeQueue;
    const pairing = await this.loadPairing();
    if (generation !== this.generation || !this.started || !this.config.enabled) return;
    this.pairing = pairing;
    const active = () => generation === this.generation && this.started && this.config.enabled;
    try {
      const api = new this.deps.RoonApi({ extension_id: 'com.companion-studio.display', display_name: 'Companion', display_version: packageInfo.version,
        publisher: 'Companion', email: 'companion-studio@localhost', log_level: 'none',
        get_persisted_state: () => structuredClone(this.pairing), set_persisted_state: state => this.persist(state, generation),
        core_paired: core => { if (active()) this.paired(core, generation); },
        core_unpaired: core => { if (active() && this.core === core) { this.core = null; this.zones.clear(); this.clearArt(); this.publish({ ...blank(), status: 'auth-required', error: 'Reconnect or enable Companion in Roon Settings > Extensions.' }); } },
      });
      this.api = api;
      api.init_services({ required_services: [this.deps.RoonTransport, this.deps.RoonImage] });
      if (!this.config.host) api.start_discovery();
      const manualConnect = () => {
        if (!active() || !this.config.host || this.core) return;
        this.manual = api.ws_connect({ host: this.config.host, port: 9330, onclose: () => {
          if (active() && !this.core) { clearTimeout(this.retry); this.retry = setTimeout(manualConnect, this.retryDelay); this.retry.unref?.(); }
        }, onerror: () => {
          if (!active() || this.core) return;
          clearTimeout(this.authTimer);
          this.publish({ status: 'unavailable', error: 'Cannot reach the Roon server. Check its address and allow Companion access to your local network.' });
          clearTimeout(this.retry); this.retry = setTimeout(manualConnect, this.retryDelay); this.retry.unref?.();
        } });
        this.manual?.transport?.ws?.on?.('error', error => {
          if (active() && !this.core) console.warn('Roon connection failed:', error.code || error.message);
        });
      };
      manualConnect();
      this.authTimer = setTimeout(() => { if (active() && !this.core) this.publish({ status: 'auth-required', error: 'Enable Companion in Roon Settings > Extensions. If it is missing, enter the server address.' }); }, this.requestTimeout);
      this.authTimer.unref?.();
    } catch { if (active()) this.publish({ status: 'error', error: 'Could not connect to Roon. Check the server address and network.' }); }
  }
  paired(core, generation) {
    if (this.core === core) return;
    clearTimeout(this.authTimer); clearTimeout(this.retry); this.core = core; this.zones.clear(); this.clearArt();
    const transport = core.services?.RoonApiTransport;
    if (!transport) { this.publish({ status: 'error', error: 'This Roon server does not provide playback controls.' }); return; }
    this.publish({ ...blank(), status: 'ready', coreName: clean(core.display_name, 80) });
    transport.subscribe_zones((response, message) => {
      if (generation !== this.generation || this.core !== core) return;
      if (response === 'Subscribed') this.zones.clear();
      if (response === 'Unsubscribed') { this.zones.clear(); this.selectZone(); return; }
      if (!message || !['Subscribed', 'Changed'].includes(response)) return;
      for (const id of message.zones_removed ?? []) this.zones.delete(id);
      for (const zone of [...(message.zones ?? []), ...(message.zones_added ?? []), ...(message.zones_changed ?? [])]) {
        if (zone && typeof zone.zone_id === 'string' && zone.zone_id.length <= 256 && (this.zones.has(zone.zone_id) || this.zones.size < 128)) this.zones.set(zone.zone_id, zone);
      }
      this.selectZone();
    });
  }
  clearArt() { this.artGeneration++; this.art = null; this.artKey = ''; this.artPromise = null; this.artRetryAt = 0; }
  selectZone() {
    if (!this.core) return;
    const zones = [...this.zones.values()];
    const zone = this.config.zoneId ? this.zones.get(this.config.zoneId) : zones.find(z => z.state === 'playing') ?? zones[0];
    const now = zone?.now_playing;
    const key = now?.image_key;
    const identity = zone && typeof key === 'string' && key.length <= 512 ? `${this.core.core_id}\n${zone.zone_id}\n${key}` : '';
    const changedArt = identity !== this.artKey;
    if (changedArt) { this.clearArt(); this.artKey = identity; }
    this.publish({ status: 'ready', error: this.config.zoneId && !zone ? 'The selected Roon zone is unavailable.' : null,
      zones: zones.map(z => ({ id: z.zone_id, name: clean(z.display_name, 80), state: clean(z.state, 24) })), zoneId: zone?.zone_id ?? '',
      track: clean(now?.three_line?.line1 ?? now?.two_line?.line1), artist: clean(now?.three_line?.line2 ?? now?.two_line?.line2),
      playing: zone?.state === 'playing', canPrevious: zone?.is_previous_allowed === true, canNext: zone?.is_next_allowed === true,
      ...(changedArt ? { artId: null, artworkLoading: Boolean(identity) } : {}) });
    if (identity && (changedArt || !this.art && !this.value.artworkLoading && Date.now() >= this.artRetryAt)) {
      this.publish({ artworkLoading: true }); this.fetchArt(key, identity);
    }
  }
  fetchArt(key, identity) {
    const generation = this.generation, artGeneration = this.artGeneration, core = this.core;
    const valid = () => generation === this.generation && artGeneration === this.artGeneration && core === this.core && identity === this.artKey;
    this.artPromise = new Promise(resolve => {
      let settled = false;
      const finish = value => { if (settled) return; settled = true; clearTimeout(timeout); resolve(value); };
      const timeout = setTimeout(() => finish(null), this.requestTimeout); timeout.unref?.();
      try { core.services.RoonApiImage.get_image(key, { scale: 'fill', width: 160, height: 160, format: 'image/jpeg' }, (error, mime, bytes) => {
        if (error || !Buffer.isBuffer(bytes) || bytes.length > 2 * 1024 * 1024) finish(null); else finish(bytes);
      }); } catch { finish(null); }
    }).then(async bytes => {
      if (!bytes || !valid()) return null;
      try {
        const image = this.deps.sharp(bytes, { limitInputPixels: 16000000 }).rotate().resize(160, 160, { fit: 'cover' }).flatten({ background: '#000' }).removeAlpha().toColourspace('srgb');
        const [rgb, jpeg] = await Promise.all([image.clone().raw().toBuffer(), image.clone().jpeg({ quality: 85 }).toBuffer()]);
        if (!valid() || rgb.length !== 160 * 160 * 3) return null;
        const pixels = Buffer.alloc(160 * 160 * 2);
        for (let i = 0; i < 160 * 160; i++) pixels.writeUInt16LE(((rgb[i * 3] >> 3) << 11) | ((rgb[i * 3 + 1] >> 2) << 5) | (rgb[i * 3 + 2] >> 3), i * 2);
        const id = createHash('sha1').update(identity).digest('hex');
        this.art = { id, width: 160, height: 160, pixels, bytes: jpeg, mime: 'image/jpeg' }; return this.art;
      } catch { return null; }
    }).then(art => { if (valid()) { this.artRetryAt = art ? 0 : Date.now() + 10000; this.publish({ artId: art?.id ?? null, artworkLoading: false }); } return art; }).catch(() => null);
  }
  async artwork(id) {
    if (!this.started || !this.config.enabled || !this.core || !id || id !== this.art?.id) return null;
    return this.art;
  }
  async control(action) {
    if (!['previous', 'next', 'playpause'].includes(action)) throw Error('Choose previous, next or playpause.');
    const core = this.core, zone = this.zones.get(this.value.zoneId), generation = this.generation;
    if (!this.started || !this.config.enabled || !core || !zone || this.value.status !== 'ready') throw Error('Connect Roon and select an available zone first.');
    if (this.controlPending) throw Error('A Roon playback command is already pending.');
    if (action === 'previous' && !zone.is_previous_allowed || action === 'next' && !zone.is_next_allowed) throw Error('That playback control is unavailable for this zone.');
    this.controlPending = true;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Roon did not acknowledge the playback command.')), this.requestTimeout); timer.unref?.();
        try { core.services.RoonApiTransport.control(zone, action, error => { clearTimeout(timer); error ? reject(Error('Roon could not perform the playback command.')) : resolve(); }); }
        catch { clearTimeout(timer); reject(Error('Roon could not perform the playback command.')); }
      });
      if (generation !== this.generation || core !== this.core || zone.zone_id !== this.value.zoneId) throw Error('The Roon connection or zone changed while the command was pending.');
    } finally { if (generation === this.generation) this.controlPending = false; }
    return this.snapshot();
  }
}

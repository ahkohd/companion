import { SerialPort } from 'serialport';
import { randomInt } from 'node:crypto';
import grokCatalog from '../shared/grok-catalog.json' with { type: 'json' };
import displayLayout from '../shared/display-layout.json' with { type: 'json' };
import { MODULE_IDS } from './studio-settings.mjs';

const ART_BYTES = 160 * 160 * 2, ART_CHUNK = 768;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

export class DeviceLink {
  constructor(store, { port = process.env.ESP_SERIAL_PORT || '', baudRate = 115200, onAttention = null, onModule = null, onUsagePage = null, onHeyPage = null, onRoonControl = null, onRoonView = null, onOpenCard = null, Port = SerialPort } = {}) {
    this.Port = Port; this.store = store; this.path = port; this.baudRate = baudRate; this.buffer = ''; this.stopped = true;
    this.onAttention = onAttention; this.onModule = onModule; this.onUsagePage = onUsagePage; this.onHeyPage = onHeyPage;
    this.onOpenCard = onOpenCard; this.onRoonControl = onRoonControl; this.onRoonView = onRoonView; this.artwork = null; this.artCounter = randomInt(1, 0x100000000);
    this.onChange = () => { if (this.lastSeq !== this.store.seq) this.send(); };
  }
  start() {
    if (!this.path || !this.stopped) return;
    this.attempted = false; this.stopped = false; this.store.on('change', this.onChange); this.connect();
    this.heartbeat = setInterval(() => {
      if (this.ready && Date.now() - this.lastAck > 8000) {
        this.ready = false; this.store.setDevice({ status: 'unresponsive', error: 'Device stopped responding' }); this.port?.close();
      } else this.send();
    }, 2000);
  }
  connect() {
    if (this.stopped) return;
    this.ready = false; this.buffer = ''; this.dropping = false; this.writing = false;
    this.clearArtPacket(); this.artTransfer = null;
    if (!this.attempted) this.store.setDevice({ status: 'connecting', port: this.path, error: null });
    this.attempted = true;
    const port = new this.Port({ path: this.path, baudRate: this.baudRate, autoOpen: false }); this.port = port;
    const current = () => !this.stopped && this.port === port;
    let opened;
    port.openSettled = new Promise(resolve => { opened = resolve; });
    port.on('data', chunk => { if (current()) this.receive(chunk.toString('utf8')); });
    port.on('error', error => { if (current()) this.store.setDevice({ status: 'disconnected', error: error.message }); });
    port.on('close', () => {
      if (!current()) return;
      this.ready = false;
      this.clearArtPacket(); this.artTransfer = null; this.writing = false;
      if (this.store.device.status !== 'unresponsive') this.store.setDevice({ status: 'disconnected' });
      this.reconnect();
    });
    port.open(error => {
      opened();
      if (!current()) return;
      if (error) { this.store.setDevice({ status: 'disconnected', error: error.message }); this.reconnect(); }
      else { this.store.setDevice({ status: 'waiting', error: null }); }
    });
  }
  reconnect() { clearTimeout(this.retry); if (!this.stopped) this.retry = setTimeout(() => this.connect(), 2500); }
  receive(chunk) {
    for (const char of chunk) {
      if (char !== '\n') {
        if (!this.dropping) this.buffer += char;
        if (this.buffer.length > 1024) { this.buffer = ''; this.dropping = true; }
        continue;
      }
      const line = this.buffer; this.buffer = '';
      if (this.dropping) { this.dropping = false; continue; }
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (!message || message.v !== 1) continue;
      if (message.type === 'attention' && this.ready && this.onAttention) {
        Promise.resolve().then(() => this.onAttention(message)).catch(() => {}); continue;
      }
      if (this.store.attention?.active && !['ready', 'ack', 'artAck'].includes(message.type)) continue;
      if (message.type === 'ready' && message.board === 'waveshare-1.75-b') {
        this.ready = true; this.lastAck = Date.now(); this.prepareArtwork();
        this.store.setDevice({ status: 'connected', error: null }); this.send();
      } else if (message.type === 'artAck') {
        this.receiveArtAck(message);
      } else if (message.type === 'ack' && this.ready && Number.isSafeInteger(message.seq) && message.seq >= 0 && message.seq <= this.store.seq) {
        this.lastAck = Date.now();
        const update = { lastAck: this.lastAck, lastAckSeq: message.seq };
        if (Number.isSafeInteger(message.rendered_seq) && message.rendered_seq >= 0 && message.rendered_seq <= this.store.seq &&
            Number.isSafeInteger(message.render_us) && message.render_us >= 0 && message.render_us < 10000000 &&
            Array.isArray(message.eyes) && message.eyes.length === 2 && message.eyes.every(eye =>
              Array.isArray(eye) && eye.length === 2 && eye.every(n => Number.isFinite(n) && n >= 0 && n <= 100))) {
          Object.assign(update, { renderedSeq: message.rendered_seq, renderUs: message.render_us, renderedEyes: message.eyes });
          if (MODULE_IDS.includes(message.module)) update.renderedModule = message.module;
          if (Number.isInteger(message.rotation) && message.rotation >= 0 && message.rotation <= 359) update.renderedRotation = message.rotation;
          if (Number.isSafeInteger(message.panel_transfers) && message.panel_transfers >= 0 &&
              Number.isInteger(message.panel_error) && message.panel_error >= 0 &&
              Number.isInteger(message.panel_rotation) && message.panel_rotation >= 0 && message.panel_rotation <= 359) {
            Object.assign(update, { panelTransfers: message.panel_transfers, panelError: message.panel_error, panelRotation: message.panel_rotation });
            if (message.panel_error !== 0) {
              this.panelError = `Display transfer failed (${message.panel_error}). USB is connected, but the screen may be frozen.`;
              update.error = this.panelError;
            } else {
              if (this.panelError && this.store.device.error === this.panelError) update.error = null;
              this.panelError = null;
            }
          }
          if (['light', 'dark'].includes(message.theme)) update.renderedTheme = message.theme;
          if (Number.isSafeInteger(message.rotation_us) && message.rotation_us >= 0) update.rotationUs = message.rotation_us;
          if (Number.isSafeInteger(message.rotation_pixels) && message.rotation_pixels >= 0 && message.rotation_pixels <= 466 * 466) update.rotationPixels = message.rotation_pixels;
          if (typeof message.font_error === 'boolean') update.fontError = message.font_error;
          if (Number.isInteger(message.clip) && message.clip >= 0 && message.clip <= grokCatalog.length &&
              Number.isInteger(message.clip_frame) && message.clip_frame >= -1 && message.clip_frame < 3601 &&
              Number.isInteger(message.clip_hash) && message.clip_hash >= 0 && message.clip_hash <= 0xffffffff) {
            Object.assign(update, { renderedAnimation: message.clip ? grokCatalog[message.clip - 1].id : null,
              renderedClipFrame: message.clip_frame, renderedClipHash: message.clip_hash });
          }
          if (Number.isInteger(message.decor_count) && message.decor_count >= 0 && message.decor_count <= 24) {
            update.renderedDecorCount = message.decor_count;
          }
          if (Number.isInteger(message.shimmer_pixels) && message.shimmer_pixels >= 0 && message.shimmer_pixels <= 25200) {
            update.renderedShimmerPixels = message.shimmer_pixels;
          }
          if (Number.isInteger(message.name_shimmer_pixels) && message.name_shimmer_pixels >= 0 && message.name_shimmer_pixels <= 22800) {
            update.renderedNameShimmerPixels = message.name_shimmer_pixels;
          }
          const titleOffset = message.module === 'face' ? this.store.settings.design?.face?.titleOffset ?? 0 : 0;
          if (displayLayout.gaps.includes(message.text_gap) && message.status_top === 395 - 27 - message.text_gap + titleOffset) {
            update.renderedTextGap = message.text_gap;
            update.renderedStatusTop = message.status_top;
          }
        }
        this.store.setDevice(update);
      } else if (message.type === 'cycle' && this.ready && this.store.activeModule === 'face' && this.store.settings.modules.face.enabled) this.store.cycle();
      else if (message.type === 'module' && this.ready && [-1, 1].includes(message.direction) && this.store.settings.device.swipeEnabled && this.store.enabledModules().length > 1) {
        Promise.resolve().then(() => this.onModule ? this.onModule(message.direction) : this.store.cycleModule(message.direction))
          .catch(() => this.store.setDevice({ error: 'Could not save the module change. Try again in the playground.' }));
      } else if (message.type === 'usage-page' && this.ready && [-1, 1].includes(message.direction) && this.store.canCycleUsage()) {
        Promise.resolve().then(() => this.onUsagePage ? this.onUsagePage(message.direction) : this.store.cycleUsage(message.direction))
          .catch(() => this.store.setDevice({ error: 'Could not change the usage page. Try again in the playground.' }));
      } else if (message.type === 'hey-page' && this.ready && [-1, 1].includes(message.direction) && this.store.canCycleHey()) {
        Promise.resolve().then(() => this.onHeyPage ? this.onHeyPage(message.direction) : this.store.cycleHey(message.direction))
          .catch(() => this.store.setDevice({ error: 'Could not change the mailbox page. Try again in the playground.' }));
      } else if (message.type === 'open-card' && this.ready && this.onOpenCard && ['hey', 'usage'].includes(message.module) && message.module === this.store.activeModule && Number.isInteger(message.index) && message.index >= 0 && message.index <= (message.module === 'usage' ? 1 : 2) && typeof message.token === 'string' && /^[a-f0-9]{40}$/.test(message.token)) {
        Promise.resolve().then(() => this.onOpenCard({module: message.module, index: message.index, token: message.token}))
          .catch(error => this.store.setDevice({ error: error.message || 'Could not open this card. Try again in the playground.' }));
      } else if (message.type === 'roon-view' && this.ready && typeof message.expanded === 'boolean' && this.store.canSetRoonView(message.expanded)) {
        Promise.resolve().then(() => this.onRoonView ? this.onRoonView(message.expanded) : this.store.setRoonExpanded(message.expanded))
          .catch(() => this.store.setDevice({ error: 'Could not change the Roon artwork view. Try again in the playground.' }));
      } else if (message.type === 'roon-control' && this.ready && this.store.activeModule === 'roon' &&
                 this.store.settings.modules.roon?.enabled && ['previous', 'next', 'playpause'].includes(message.action)) {
        Promise.resolve().then(() => this.onRoonControl?.(message.action))
          .catch(() => this.store.setDevice({ error: 'Could not control Roon. Try again in the playground.' }));
      }
    }
  }
  send() {
    if (!this.ready || !this.port?.isOpen || this.writing) return;
    const frame = JSON.stringify(this.store.frame()) + '\n';
    const bytes = Buffer.byteLength(frame);
    if (bytes > 2048) {
      this.lastSeq = this.store.seq;
      this.frameError = `Device update is too large (${bytes} bytes; maximum 2048). Reduce the display content and try again.`;
      this.store.setDevice({ error: this.frameError });
      return;
    }
    this.writing = true; this.lastSeq = this.store.seq;
    if (this.frameError && this.store.device.error === this.frameError) this.store.setDevice({ error: null });
    this.frameError = null;
    const port = this.port;
    port.write(frame, error => {
      if (port !== this.port) return;
      this.writing = false;
      if (error) this.store.setDevice({ status: 'disconnected', error: error.message });
      else if (this.lastSeq !== this.store.seq) this.send();
      else this.pumpArtwork();
    });
  }
  setArtwork(artwork) {
    if (artwork !== null && (!artwork || !/^[a-f0-9]{40}$/.test(artwork.id) || artwork.width !== 160 ||
        artwork.height !== 160 || !Buffer.isBuffer(artwork.pixels) || artwork.pixels.length !== ART_BYTES)) {
      throw new TypeError('Artwork requires a SHA-1 id and a 160 by 160 RGB565 buffer');
    }
    if ((artwork?.id ?? null) === (this.artwork?.id ?? null)) return;
    const cancelTransfer = this.artTransfer?.transfer ?? this.artCommittedTransfer;
    this.artwork = artwork ? { id: artwork.id, width: 160, height: 160, pixels: Buffer.from(artwork.pixels), crc32: crc32(artwork.pixels) } : null;
    this.prepareArtwork();
    if (!artwork && cancelTransfer) this.artTransfer = { transfer: cancelTransfer, op: 'cancel', offset: 0 };
    this.pumpArtwork();
  }
  clearArtPacket() {
    clearTimeout(this.artTimer); this.artTimer = null; this.artPacket = null;
  }
  prepareArtwork() {
    this.clearArtPacket();
    this.artTransfer = this.artwork ? { ...this.artwork, transfer: this.artCounter = (this.artCounter + 1) >>> 0 || 1, op: 'begin', offset: 0 } : null;
    this.artCommittedTransfer = null;
    if (this.artError && this.store.device.error === this.artError) this.store.setDevice({ error: null });
    this.artError = null;
  }
  artworkFailed(detail) {
    this.clearArtPacket(); this.artTransfer = null;
    this.artError = `Could not upload album artwork: ${detail}`;
    this.store.setDevice({ error: this.artError });
  }
  pumpArtwork() {
    if (!this.ready || !this.port?.isOpen || this.writing || !this.artTransfer || this.artPacket) return;
    if (this.lastSeq !== this.store.seq) { this.send(); return; }
    const transfer = this.artTransfer;
    const frame = { type: 'art', v: 1, transfer: transfer.transfer, op: transfer.op };
    let expected = transfer.offset;
    if (transfer.op === 'begin') Object.assign(frame, { id: transfer.id, width: 160, height: 160, crc32: transfer.crc32 });
    else if (transfer.op === 'chunk') {
      const bytes = transfer.pixels.subarray(transfer.offset, transfer.offset + ART_CHUNK);
      Object.assign(frame, { offset: transfer.offset, data: bytes.toString('base64') }); expected += bytes.length;
    }
    const packet = { frame, expected, attempts: 0, transfer };
    this.artPacket = packet; this.writeArtPacket(packet);
  }
  writeArtPacket(packet) {
    if (!this.ready || !this.port?.isOpen || packet !== this.artPacket) return;
    if (this.writing) { this.artTimer = setTimeout(() => this.writeArtPacket(packet), 20); this.artTimer.unref?.(); return; }
    // Heartbeats and changed state may run while an artwork packet awaits its acknowledgement.
    if (this.lastSeq !== this.store.seq) { this.send(); this.artTimer = setTimeout(() => this.writeArtPacket(packet), 20); this.artTimer.unref?.(); return; }
    packet.attempts++; this.writing = true;
    const port = this.port;
    port.write(JSON.stringify(packet.frame) + '\n', error => {
      if (port !== this.port) return;
      this.writing = false;
      if (error) { if (packet === this.artPacket) this.artworkFailed(error.message); return; }
      if (packet === this.artPacket) {
        this.artTimer = setTimeout(() => {
          if (packet !== this.artPacket) return;
          if (packet.attempts >= 3) this.artworkFailed('device did not acknowledge the image');
          else this.writeArtPacket(packet);
        }, 1500);
        this.artTimer.unref?.();
      }
      if (this.lastSeq !== this.store.seq) this.send(); else this.pumpArtwork();
    });
  }
  receiveArtAck(message) {
    const packet = this.artPacket;
    if (!this.ready || !packet || message.transfer !== packet.frame.transfer || message.op !== packet.frame.op ||
        typeof message.ok !== 'boolean' || !Number.isInteger(message.offset) || message.offset < 0 || message.offset > ART_BYTES) return;
    if (!message.ok) { this.artworkFailed('device rejected the image'); return; }
    if (packet.frame.op !== 'begin' && message.offset !== packet.expected) return;
    this.clearArtPacket();
    const transfer = packet.transfer;
    if (transfer !== this.artTransfer) return;
    if (transfer.op === 'commit' || transfer.op === 'cancel') {
      this.artCommittedTransfer = transfer.op === 'commit' ? transfer.transfer : null;
      this.artTransfer = null;
    } else {
      transfer.offset = message.offset;
      transfer.op = transfer.offset === ART_BYTES ? 'commit' : 'chunk';
      this.pumpArtwork();
    }
  }
  stop() {
    this.stopped = true; this.ready = false; this.store.off('change', this.onChange);
    this.clearArtPacket(); this.artTransfer = null;
    clearInterval(this.heartbeat); clearTimeout(this.retry);
    const port = this.port; this.port = null; this.writing = false;
    if (!port) return this.closing ?? Promise.resolve();
    this.closing = (async () => {
      await port.openSettled;
      if (port.isOpen) await new Promise((resolve, reject) => {
        port.close(error => error && port.isOpen ? reject(error) : resolve());
        if (!port.isOpen && !port.closing) resolve();
      });
    })();
    return this.closing;
  }
}

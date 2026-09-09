import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { runModuleCommand } from './module-sources.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const clean = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 256) : '';
const blank = () => ({ status: 'disabled', track: '', artist: '', album: '', artId: null, artworkLoading: false, playing: false, canPrevious: false, canNext: false, canLike: false, liked: false, error: null, zones: [], zoneId: '' });
const actions = { previous: '5', next: '4', playpause: '2' };

export class LocalMusicSource extends EventEmitter {
  constructor({ player, runner = runModuleCommand, platform = process.platform, fetcher = fetch, converter = convertArtwork, intervalMs = 2500, helperRoot = path.join(root, '.tools/mediaremote') } = {}) {
    super();
    if (!['spotify', 'appleMusic', 'system'].includes(player)) throw Error('Unknown music player');
    Object.assign(this, { player, runner, platform, fetcher, converter, intervalMs, helperRoot });
    this.value = blank(); this.enabled = false; this.started = false; this.generation = 0; this.art = null; this.artKey = ''; this.artRetryAt = 0; this.controlPending = false;
  }
  snapshot() { return structuredClone(this.value); }
  publish(patch) { const next = { ...this.value, ...patch }; if (JSON.stringify(next) === JSON.stringify(this.value)) return; this.value = next; this.emit('change', this.snapshot()); }
  configure({ enabled }) { if (this.enabled === enabled) return; this.enabled = enabled; this.reset(); if (this.started && enabled) void this.poll(); }
  start() { if (this.started) return; this.started = true; if (this.enabled) void this.poll(); }
  reset() { this.generation++; clearTimeout(this.timer); this.controller?.abort(); this.commandController?.abort(); this.controller = null; this.art = null; this.artKey = ''; this.artRetryAt = 0; this.missingSince = null; this.controlPending = false; this.publish(blank()); }
  stop() { this.started = false; this.reset(); }
  async read(signal, action = 'get') {
    let result;
    if (this.player !== 'system') result = await this.runner('/usr/bin/osascript', ['-l', 'JavaScript', path.join(root, this.player === 'appleMusic' ? 'bridge/apple-music.jxa' : 'bridge/spotify.jxa'), action], { signal, timeoutMs: 5000, maxOutputBytes: this.player === 'appleMusic' ? 4 * 1024 * 1024 : 65536 });
    else result = await this.runner('/usr/bin/perl', [path.join(this.helperRoot, 'mediaremote-adapter.pl'), path.join(this.helperRoot, 'MediaRemoteAdapter.framework'), ...(action === 'get' ? ['get'] : ['send', actions[action]])], { signal, timeoutMs: 5000, maxOutputBytes: 4 * 1024 * 1024 });
    if (result.code !== 0) throw Error(this.player !== 'system' ? `Allow Companion to control ${this.player === 'appleMusic' ? 'Music' : 'Spotify'} in System Settings > Privacy & Security > Automation.` : 'System Now Playing is unavailable on this Mac. Restart Companion or check for an update.');
    return action !== 'get' && this.player === 'system' ? null : JSON.parse(result.stdout || 'null');
  }
  async poll() {
    if (!this.started || !this.enabled) return;
    const generation = this.generation, controller = new AbortController(); this.controller = controller;
    const valid = () => this.started && this.enabled && generation === this.generation;
    try {
      if (this.platform !== 'darwin') { this.publish({ ...blank(), status: 'unavailable', error: 'This player requires macOS.' }); return; }
      const data = await this.read(controller.signal);
      if (!valid()) return;
      if (!data?.title || this.player !== 'system' && !data.running) {
        // Players briefly omit metadata between tracks. Keep the complete last frame.
        if (data?.running !== false && this.value.status === 'ready') {
          this.missingSince ??= Date.now();
          if (Date.now() - this.missingSince < 8000) return;
        }
        this.art = null; this.artKey = '';
        this.publish({ ...blank(), status: 'unavailable', error: this.player !== 'system' ? `Open ${this.player === 'appleMusic' ? 'Music' : 'Spotify'} and play something on this Mac.` : 'Play something in a Mac app that shares Now Playing information.' });
        return;
      }
      this.missingSince = null;
      const bundleIdentifier = clean(data.parentApplicationBundleIdentifier || data.bundleIdentifier);
      const identity = JSON.stringify([bundleIdentifier, data.trackId, data.title, data.artist, data.album]);
      const hasArtwork = Boolean(data.artworkUrl || data.artworkData);
      const key = !hasArtwork && identity === this.trackIdentity && this.art ? this.artKey : createHash('sha1').update(JSON.stringify([identity, data.artworkUrl, data.artworkData])).digest('hex');
      this.trackIdentity = identity;
      const changed = key !== this.artKey;
      if (changed) this.artKey = key;
      const trackPatch = { status: 'ready', error: null, track: clean(data.title), artist: clean(data.artist), album: clean(data.album), playing: data.playing === true,
        zoneId: this.player, canPrevious: data.prohibitsSkip !== true, canNext: data.prohibitsSkip !== true, canLike: false, liked: data.isLiked === true,
        ...(changed ? { artId: null, artworkLoading: Boolean(data.artworkUrl || data.artworkData) } : {}) };
      if (!changed) { this.bundleIdentifier = bundleIdentifier; this.publish(trackPatch); }
      if (changed || !this.art && Date.now() >= (this.artRetryAt || 0)) {
        const bytes = await this.artBytes(data, controller.signal);
        if (!valid() || this.artKey !== key) return;
        let art = null;
        try { if (bytes) art = await this.converter(bytes, this.player); } catch { /* Keep playback available when artwork cannot decode. */ }
        if (!valid() || this.artKey !== key) return;
        this.art = art; this.artRetryAt = Date.now() + 10000;
        this.bundleIdentifier = bundleIdentifier;
        this.publish({ ...trackPatch, artId: this.art?.id || null, artworkLoading: false });
      }
    } catch (error) {
      if (valid() && error.code !== 'ABORT_ERR') { this.art = null; this.artKey = ''; this.publish({ ...blank(), status: 'error', error: clean(error.message) || 'Could not read playback information.' }); }
    } finally {
      if (valid()) { this.controller = null; this.timer = setTimeout(() => void this.poll(), this.intervalMs); this.timer.unref?.(); }
    }
  }
  async artBytes(data, signal) {
    try {
      if (typeof data.artworkData === 'string' && data.artworkData.length <= 3 * 1024 * 1024) return Buffer.from(data.artworkData, 'base64');
      if (!data.artworkUrl) return null;
      const url = new URL(data.artworkUrl);
      if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'scdn.co' || url.hostname.endsWith('.scdn.co'))) return null;
      const response = await this.fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: 'error' });
      if (!response.ok || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) { await response.body?.cancel(); return null; }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) return null; chunks.push(chunk); }
      return Buffer.concat(chunks);
    } catch { return null; }
  }
  async artwork(id) { return this.art?.id === id ? this.art : null; }
  async control(action) {
    if (!Object.hasOwn(actions, action)) throw Error('That playback action is not supported by this player.');
    if (!this.started || !this.enabled || this.value.status !== 'ready') throw Error('Start this player before using playback controls.');
    if (this.controlPending) throw Error('A playback command is already pending.');
    if (action === 'previous' && !this.value.canPrevious || action === 'next' && !this.value.canNext) throw Error('This playback control is unavailable.');
    const generation = this.generation, controller = new AbortController(); this.commandController = controller; this.controlPending = true;
    try {
      if (this.player === 'system') {
        const current = await this.read(controller.signal);
        if (clean(current?.parentApplicationBundleIdentifier || current?.bundleIdentifier) !== this.bundleIdentifier) throw Error('The active Mac player changed. Try again after the display updates.');
      }
      if (generation !== this.generation || !this.enabled) throw Error('The player changed.');
      await this.read(controller.signal, action);
      if (generation !== this.generation) throw Error('The player changed.');
    } finally { if (generation === this.generation) this.controlPending = false; if (this.commandController === controller) this.commandController = null; }
    if (!this.controller && this.started && this.enabled) { clearTimeout(this.timer); void this.poll(); }
    return this.snapshot();
  }
}

export async function convertArtwork(bytes, player) {
  const image = sharp(bytes, { limitInputPixels: 16000000 }).rotate().resize(160, 160, { fit: 'cover' }).flatten({ background: '#000' }).removeAlpha().toColourspace('srgb');
  const [rgb, jpeg] = await Promise.all([image.clone().raw().toBuffer(), image.clone().jpeg({ quality: 85 }).toBuffer()]);
  const pixels = Buffer.alloc(160 * 160 * 2);
  for (let i = 0; i < 160 * 160; i++) pixels.writeUInt16LE(((rgb[i * 3] >> 3) << 11) | ((rgb[i * 3 + 1] >> 2) << 5) | (rgb[i * 3 + 2] >> 3), i * 2);
  return { id: createHash('sha1').update(player).update(jpeg).digest('hex'), bytes: jpeg, pixels, width: 160, height: 160, mime: 'image/jpeg' };
}

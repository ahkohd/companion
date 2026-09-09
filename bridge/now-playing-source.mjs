import { EventEmitter } from 'node:events';
import { RoonSource } from './roon-source.mjs';
import { LocalMusicSource } from './local-music-source.mjs';
const names = { roon: 'Roon', spotify: 'Spotify', appleMusic: 'Apple Music', system: 'System' };
export class NowPlayingSource extends EventEmitter {
  constructor({ pairingPath, sources } = {}) {
    super(); this.sources = sources || { roon: new RoonSource({ pairingPath }), spotify: new LocalMusicSource({ player: 'spotify' }), appleMusic: new LocalMusicSource({ player: 'appleMusic' }), system: new LocalMusicSource({ player: 'system' }) };
    this.config = { enabled: false, players: { roon: true, spotify: false, appleMusic: false, system: false } }; this.player = 'roon'; this.started = false;
    for (const source of Object.values(this.sources)) source.on('change', () => this.publish());
  }
  enabledPlayers() { return Object.keys(names).filter(id => this.config.players[id]); }
  snapshot() {
    const ids = this.enabledPlayers(), roon = this.sources.roon.snapshot();
    return { ...this.sources[this.player].snapshot(), player: this.player, playerName: names[this.player],
      players: ids.map(id => ({ id, name: names[id], status: this.sources[id].snapshot().status })),
      pageIndex: Math.max(0, ids.indexOf(this.player)), pageCount: Math.max(1, ids.length), canLike: this.sources[this.player].snapshot().canLike === true, roon };
  }
  publish() { if (!this.configuring) this.emit('change', this.snapshot()); }
  configure(config) {
    this.config = { ...config, players: config.players || { roon: true, spotify: false, appleMusic: false, system: false } };
    this.configuring = true;
    const ids = this.enabledPlayers(); if (!ids.includes(this.player)) this.player = ids[0] || 'roon';
    for (const [id, source] of Object.entries(this.sources)) source.configure({ ...config, enabled: config.enabled && this.config.players[id] });
    this.configuring = false; this.publish();
  }
  start() { this.started = true; for (const source of Object.values(this.sources)) void source.start(); }
  stop() { this.started = false; for (const source of Object.values(this.sources)) source.stop(); }
  select({ id, direction } = {}) {
    if (!this.config.enabled) throw Error('Enable Now Playing first.');
    const ids = this.enabledPlayers();
    if (direction !== undefined) {
      if (![-1, 1].includes(direction)) throw Error('Choose a valid player direction.');
      id = ids[(ids.indexOf(this.player) + direction + ids.length) % ids.length];
    }
    if (!ids.includes(id)) throw Error('Enable this player first.');
    this.player = id; this.publish(); return this.snapshot();
  }
  async artwork(id) {
    for (const source of Object.values(this.sources)) { const art = await source.artwork(id); if (art) return art; }
    return null;
  }
  async control(action, player = this.player) {
    if (!this.config.enabled || !this.config.players[player] || player !== this.player) throw Error('The selected player changed. Try again.');
    return this.sources[player].control(action);
  }
}

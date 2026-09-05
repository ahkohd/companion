import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export function defaultSocket(env = process.env) {
  const config = env.HERDR_CONFIG_PATH ? path.dirname(env.HERDR_CONFIG_PATH) : path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'herdr');
  return env.HERDR_SOCKET_PATH || env.HERDR_API_SOCKET ||
    path.join(config, ...(env.HERDR_SESSION ? ['sessions', env.HERDR_SESSION] : []), 'herdr.sock');
}
function errorMessage(error) {
  return ['ENOENT', 'ECONNREFUSED'].includes(error.code) ? 'Herdr is not running' : error.message;
}
export class HerdrClient extends EventEmitter {
  constructor({ socketPath = defaultSocket(), refreshMs = 5000, timeoutMs = 2500 } = {}) {
    super(); this.socketPath = socketPath; this.refreshMs = refreshMs; this.timeoutMs = timeoutMs;
    this.sockets = new Set(); this.nextId = 0; this.stopped = true; this.retryMs = 500; this.fingerprint = '';
  }
  start() { if (!this.stopped) return; this.stopped = false; this.refresh(); }
  // Ordinary requests close after one response. Subscriptions use their own connection.
  request(method, params = {}, onEvent) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath); this.sockets.add(socket);
      const id = `face:${++this.nextId}`; let buffer = '', acknowledged = false;
      const timer = setTimeout(() => socket.destroy(new Error('Herdr response timed out')), this.timeoutMs);
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
      socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 4 * 1024 * 1024) return socket.destroy(new Error('Oversized Herdr response'));
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          let message;
          try { message = JSON.parse(line); if (!message || typeof message !== 'object') throw new Error(); }
          catch { return socket.destroy(new Error('Invalid Herdr response')); }
          if (!acknowledged && message.id === id) {
            clearTimeout(timer);
            if (message.error) return socket.destroy(new Error(message.error.message || 'Herdr API error'));
            acknowledged = true;
            resolve(onEvent ? { socket, result: message.result } : message.result);
            if (!onEvent) socket.end();
          } else if (acknowledged && onEvent) onEvent(message);
        }
      });
      socket.on('error', reject);
      socket.on('close', () => {
        clearTimeout(timer); this.sockets.delete(socket);
        if (!acknowledged) reject(new Error('Herdr disconnected before replying'));
        if (socket === this.subscription) { this.subscription = null; this.fingerprint = ''; }
      });
    });
  }
  async subscribe(ids) {
    const fingerprint = JSON.stringify(ids);
    if (fingerprint === this.fingerprint && !this.subscription?.destroyed) return;
    const previous = this.subscription;
    const { socket } = await this.request('events.subscribe', { subscriptions: [
      ...['pane.created', 'pane.closed', 'pane.exited', 'pane.agent_detected', 'pane.moved'].map(type => ({ type })),
      ...ids.map(pane_id => ({ type: 'pane.agent_status_changed', pane_id }))
    ] }, () => {
      clearTimeout(this.debounce); this.debounce = setTimeout(() => this.refresh(), 40);
    });
    if (this.stopped) { socket.destroy(); return; }
    this.subscription = socket; this.fingerprint = fingerprint; previous?.destroy();
  }
  async refresh() {
    if (this.stopped) return;
    if (this.refreshing) { this.refreshAgain = true; return; }
    clearTimeout(this.poll); this.refreshing = true; let delay = this.refreshMs;
    try {
      const result = await this.request('agent.list');
      if (!Array.isArray(result?.agents)) throw new Error('Unexpected Herdr agent response');
      if (this.stopped) return;
      this.retryMs = 500; this.emit('agents', result.agents);
      // A lost event stream falls back to polling and is retried on the next refresh.
      try { await this.subscribe([...new Set(result.agents.map(a => a.pane_id).filter(id => typeof id === 'string'))].sort()); }
      catch { this.fingerprint = ''; }
    } catch (error) {
      if (!this.stopped) this.emit('offline', errorMessage(error));
      this.subscription?.destroy(); delay = this.retryMs; this.retryMs = Math.min(5000, this.retryMs * 2);
    } finally {
      this.refreshing = false;
      if (!this.stopped) this.poll = setTimeout(() => this.refresh(), this.refreshAgain ? 40 : delay);
      this.refreshAgain = false;
    }
  }
  stop() {
    this.stopped = true; clearTimeout(this.poll); clearTimeout(this.debounce);
    for (const socket of this.sockets) socket.destroy();
  }
}

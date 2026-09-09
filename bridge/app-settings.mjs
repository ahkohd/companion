import { randomUUID, timingSafeEqual } from 'node:crypto';

export class AppSettings {
  constructor(token) { this.token = token; this.updated = 0; this.state = {}; this.pending = null; }
  stop() {
    this.token = null;
    const pending = this.pending; this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(Error('Companion is shutting down.')); }
  }
  authorized(value) {
    if (!this.token || typeof value !== 'string') return false;
    const a = Buffer.from(value), b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  snapshot() { return { ...this.state, available: Boolean(this.token && Date.now() - this.updated < 10000) }; }
  sync(input) {
    this.state = {
      version: String(input.version || ''),
      launchAtLogin: input.launchAtLogin === true,
      loginNeedsApproval: input.loginNeedsApproval === true,
      updatesAvailable: input.updatesAvailable === true,
      automaticallyChecksForUpdates: input.automaticallyChecksForUpdates === true,
      automaticallyDownloadsUpdates: input.automaticallyDownloadsUpdates === true,
    };
    this.updated = Date.now();
    if (this.pending && input.result?.id === this.pending.command.id) {
      const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
      if (input.result.error) pending.reject(Error(String(input.result.error)));
      else pending.resolve(this.snapshot());
    }
    if (!this.pending) return {};
    return { command: this.pending.command };
  }
  change(input) {
    if (!this.snapshot().available) throw Error('Open the Companion menu bar app to change these settings.');
    if (this.pending) throw Error('Another app setting is being changed. Try again shortly.');
    const toggles = ['launchAtLogin', 'automaticallyChecksForUpdates', 'automaticallyDownloadsUpdates'];
    if (![...toggles, 'checkForUpdates', 'openLoginSettings', 'about'].includes(input.action)) throw Error('Unknown app setting');
    if (toggles.includes(input.action) && typeof input.value !== 'boolean') throw Error('Setting must be true or false');
    if (input.action.includes('Updates') && !this.state.updatesAvailable) throw Error('Updates require a release build.');
    return new Promise((resolve, reject) => {
      const command = { id: randomUUID(), action: input.action, value: input.value };
      const timer = setTimeout(() => { this.pending = null; reject(Error('The app did not respond. Refresh to check its current settings.')); }, 10000);
      this.pending = { command, timer, resolve, reject };
    });
  }
}

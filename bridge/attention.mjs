import { validateCallback } from './attention-callback.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const text = (value, name, limit, required = false) => {
  if (typeof value !== 'string' || (name === 'Body' ? /[\x00-\x08\x0b-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value) || Array.from(value).length > limit || (required && !value.trim())) throw new Error(`${name} must be ${required ? '1 to ' : 'at most '}${limit} characters.`);
  return value.trim();
};
export class Attention {
  constructor(store, { filePath, now = Date.now, deliver = null } = {}) {
    this.deliver = deliver; this.stopped = false; this.store = store; this.filePath = filePath; this.now = now; this.enabled = true; this.active = null; this.queue = []; this.history = []; store.attention = this;
  }
  async load() {
    if (this.filePath) try { const value = JSON.parse(await readFile(this.filePath, 'utf8')); if (typeof value.enabled !== 'boolean') throw new Error('Invalid attention settings'); this.enabled = value.enabled; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.timer = setInterval(() => this.tick(), 250); this.timer.unref();
  }
  stop() { this.stopped = true; clearInterval(this.timer); }
  validateStep(value, kind) {
    const animation = value.animation ?? (kind === 'decision' ? 'blocked' : 'done'); this.store.validateExpression(animation);
    if (animation === null) throw new Error('Choose an animation.');
    const actions = value.actions ?? (kind === 'decision' ? [{ id: 'approve', label: 'Approve', kind: 'respond' }, { id: 'decline', label: 'Decline', kind: 'dismiss' }] : [{ id: 'dismiss', label: 'Dismiss', kind: 'dismiss' }]);
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > 2) throw new Error('Choose one or two actions.');
    const ids = new Set();
    return { title: text(value.title, 'Title', 24, true), description: text(value.description ?? '', 'Description', 48), body: text(value.body ?? '', 'Body', 480), animation, actions: actions.map(a => {
      if (!a || !/^[a-z][a-z0-9_-]{0,23}$/.test(a.id) || ['open', 'back'].includes(a.id) || ids.has(a.id) || !['dismiss', 'respond', 'next'].includes(a.kind)) throw new Error('Choose unique action IDs and a valid action kind.');
      ids.add(a.id); return { id: a.id, label: text(a.label, 'Action label', 16, true), kind: a.kind };
    }) };
  }
  validate(value) {
    const owner = text(value.owner, 'Owner', 64, true), kind = value.kind ?? 'notification';
    if (!['notification', 'decision'].includes(kind)) throw new Error('Choose notification or decision.');
    const durationMs = value.durationMs ?? 10000;
    if (kind === 'notification' && (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 300000)) throw new Error('Notification duration must be 1000 to 300000 milliseconds.');
    if (kind === 'decision' && value.durationMs !== undefined && value.durationMs !== null) throw new Error('Decisions cannot expire.');
    const steps = value.steps ?? [value];
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 8) throw new Error('Choose one to eight steps.');
    const normalized = steps.map(step => this.validateStep(step, kind));
    if (normalized.at(-1).actions.some(a => a.kind === 'next')) throw new Error('The last step cannot have a Next action.');
    // The device receives UTF-8 JSON in a bounded serial frame. Reject rather than truncate.
    for (const step of normalized) if (Buffer.byteLength(JSON.stringify(step)) > 1000) throw new Error('This message uses too many bytes for the display. Shorten it.');
    return { owner, kind, callback: validateCallback(value.callback), durationMs: kind === 'decision' ? null : durationMs, steps: normalized };
  }
  current(item) { if (!item) return null; const { steps, startedAt, ...rest } = item; return { ...rest, ...steps[item.stepIndex], stepCount: steps.length, remainingMs: item.remainingMs === null ? null : Math.max(0, item.remainingMs - (startedAt === null ? 0 : this.now() - startedAt)) }; }
  snapshot() { return { enabled: this.enabled, active: this.current(this.active), queue: this.queue.map(item => this.current(item)), history: this.history.map(item => ({ ...item })) }; }
  publish() { this.store.publish(); }
  promote() { if (!this.active && this.enabled && this.queue.length) { this.queue.sort((a,b) => (a.kind === 'decision' ? 0 : 1) - (b.kind === 'decision' ? 0 : 1)); this.active = this.queue.shift(); this.active.startedAt = this.now(); } }
  show(value) {
    if (!this.enabled) throw new Error('Attention is disabled. Enable it in the playground.');
    if (this.queue.length >= 32) throw new Error('The attention queue is full.');
    const validated = this.validate(value); const item = { ...validated, id: randomUUID(), revision: 1, stepIndex: 0, detail: false, createdAt: this.now(), startedAt: null, remainingMs: validated.durationMs };
    this.queue.push(item); this.promote(); this.publish(); return { id: item.id, revision: item.revision };
  }
  owned(value) { const item = this.active?.id === value.id ? this.active : this.queue.find(item => item.id === value.id); if (!item || item.owner !== value.owner) throw new Error('Message not found for this owner.'); return item; }
  update(value) {
    const item = this.owned(value); const current = item.steps[item.stepIndex];
    const candidate = this.validate({ ...item, ...current, ...value, steps: value.steps ?? item.steps.slice(item.stepIndex).map((step, index) => index ? step : { ...current, ...value }) });
    Object.assign(item, candidate, { stepIndex: 0, detail: false, revision: item.revision + 1, remainingMs: candidate.durationMs, startedAt: item === this.active ? this.now() : null }); this.publish(); return { id: item.id, revision: item.revision };
  }
  terminal(item, outcome, action = null) {
    const result = { id: item.id, owner: item.owner, title: item.steps[item.stepIndex].title, kind: item.kind, outcome, action, revision: item.revision, completedAt: this.now(), ...(item.callback ? { callbackDelivery: { status: 'pending' } } : {}) };
    this.history.unshift(result); this.history.length = Math.min(this.history.length, 100);
    if (this.active === item) this.active = null; else this.queue = this.queue.filter(entry => entry !== item);
    this.promote(); this.publish();
    if (item.callback) void Promise.resolve().then(() => {
      if (this.stopped || !this.deliver) throw new Error('Callback delivery is unavailable.');
      return this.deliver(item.callback, result);
    }).then(() => { result.callbackDelivery = { status: 'succeeded' }; }, error => {
      result.callbackDelivery = { status: 'failed', error: String(error?.message || 'Could not run the callback.').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 180) };
    }).then(() => { if (!this.stopped) this.publish(); }).catch(() => {});
  }
  clear(value) { const item = this.owned(value); this.terminal(item, 'cleared'); return { id: item.id }; }
  checked(value) { if (!this.active || this.active.id !== value.id || this.active.revision !== value.revision) throw new Error('This message has changed. Refresh before responding.'); return this.active; }
  details(value) {
    const item = this.checked(value); if (typeof value.detail !== 'boolean') throw new Error('Detail must be on or off.');
    if (item.detail !== value.detail) { if (item.remainingMs !== null && item.startedAt !== null) item.remainingMs = Math.max(0, item.remainingMs - (this.now() - item.startedAt)); item.detail = value.detail; item.startedAt = value.detail ? null : this.now(); item.revision++; this.publish(); }
    return { id: item.id, revision: item.revision };
  }
  dismiss(value) { const item = this.checked(value); this.terminal(item, 'dismissed'); return { id: item.id, revision: item.revision }; }
  act(value) {
    const item = this.checked(value); if (!item.detail) throw new Error('Open the detail view before choosing an action.');
    const action = item.steps[item.stepIndex].actions.find(a => a.id === value.action); if (!action) throw new Error('Unknown action.');
    if (action.kind === 'next') { item.stepIndex++; item.revision++; item.detail = false; item.remainingMs = item.durationMs; item.startedAt = this.now(); this.publish(); }
    else this.terminal(item, action.kind === 'dismiss' ? 'dismissed' : 'responded', action.id);
    return { id: item.id, revision: item.revision };
  }
  tick() { if (this.active && !this.active.detail && this.active.remainingMs !== null && this.now() - this.active.startedAt >= this.active.remainingMs) this.terminal(this.active, 'expired'); }
  async configure(value) {
    if (typeof value.enabled !== 'boolean') throw new Error('Enabled must be on or off.');
    if (this.filePath) { await mkdir(path.dirname(this.filePath), { recursive: true }); await writeFile(`${this.filePath}.tmp`, JSON.stringify({ enabled: value.enabled }), { mode: 0o600 }); await rename(`${this.filePath}.tmp`, this.filePath); }
    this.enabled = value.enabled;
    if (!this.enabled) { const items = [this.active, ...this.queue].filter(Boolean); for (const item of items) this.terminal(item, 'disabled'); }
    this.promote(); this.publish(); return { enabled: this.enabled };
  }
}

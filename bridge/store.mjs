import { resolveDeviceAppearance } from '../shared/device-appearance.mjs';
import DESIGN_SCHEMA from '../shared/design-schema.json' with { type: 'json' };
import { EventEmitter } from 'node:events';
import path from 'node:path';
import GROK_CATALOG from '../shared/grok-catalog.json' with { type: 'json' };
import DISPLAY_LAYOUT from '../shared/display-layout.json' with { type: 'json' };
import STATUS_LABELS from '../shared/status-labels.json' with { type: 'json' };
import { defaultSettings } from './studio-settings.mjs';
import { dashboardFor, usagePageCount, heyPageCount } from './dashboard.mjs';
const GROK_BY_ID = new Map(GROK_CATALOG.map(item => [item.id, item]));

export const STATES = ['working', 'blocked', 'done', 'idle', 'unknown'];
export const PRIORITY = ['blocked', 'working', 'done', 'unknown', 'idle'];
export const WORKING_SESSION_INTERVAL_MS = 4000;
export function validateTextGap(value) {
  if (!DISPLAY_LAYOUT.gaps.includes(value)) throw new Error('Choose Close, Balanced or Wide text spacing.');
  return value;
}
const EXPRESSION_LABELS = new Map(
  [...['working', 'blocked', 'done', 'idle', 'sleep', 'unknown'].map(state => [state, STATUS_LABELS[state]]), ['disconnected', 'Herdr disconnected']]
);
export function cleanText(value, limit = 64) {
  return String(value ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, limit);
}
export function wireText(value, maxBytes = 48) {
  let result = '';
  for (const char of cleanText(value)) {
    if (Buffer.byteLength(result + char, 'utf8') > maxBytes) break;
    result += char;
  }
  return result;
}
export function normalizeAgent(raw) {
  if (!raw || typeof raw.pane_id !== 'string' || !raw.agent) return null;
  return {
    id: raw.pane_id, kind: cleanText(raw.agent, 24),
    name: cleanText(raw.name || raw.title || raw.terminal_title_stripped || raw.agent)
      .replace(/^[\u25d0-\u25d3\u25f4-\u25f7\u2800-\u28ff\u25cf\u25cb]\s*/, ''),
    project: cleanText(path.basename(raw.foreground_cwd || raw.cwd || '')),
    state: STATES.includes(raw.agent_status) ? raw.agent_status : 'unknown',
    focused: raw.focused === true, workspace: cleanText(raw.workspace_id, 32)
  };
}
export function aggregate(agents, connected = true) {
  const counts = Object.fromEntries(STATES.map(s => [s, 0]));
  for (const agent of agents) counts[agent.state]++;
  if (!connected) return { state: 'disconnected', label: 'Herdr disconnected', counts };
  const state = PRIORITY.find(s => counts[s] > 0) ?? 'idle';
  const n = counts[state];
  const label = !agents.length ? 'No agents running' : {
    blocked: `${n} need${n === 1 ? 's' : ''} attention`, working: `${n} working`,
    done: `${n} ready`, idle: 'Idle', unknown: `${n} unknown`
  }[state];
  return { state, label, counts };
}
export class FaceStore extends EventEmitter {
  agents = []; connected = false; selected = 'all'; seq = 0; expression = null;
  textGap = DISPLAY_LAYOUT.defaultGap;
  settings = defaultSettings(); settingsRevision = 0; activeModule = 'face'; usagePage = 0; heyPage = 0; roonExpanded = false;
  sources = { usage: { status: 'disabled', refreshing: false, installed: null, version: null, updatedAt: null, error: null, providers: [] }, hey: { status: 'disabled', refreshing: false, installed: null, version: null, updatedAt: null, error: null, items: [], hasMore: false, selectedBox: 'imbox' } };
  animationEpoch = 0; changedAt = Date.now(); updatedAt = null; error = 'Connecting to Herdr';
  device = { profile: null, status: 'disabled', port: null, lastAck: null, error: null };
  pointer = { supported: process.platform === 'darwin', enabled: false, intervalMs: 100, status: 'off', error: null, x: 0, y: 0 };
  lastDisplayKey = ''; lastClockKey = '';
  workingSessionId = null; workingSessionSince = 0;
  ingest(rawAgents) {
    if (!Array.isArray(rawAgents)) throw new Error('Invalid Herdr agent list');
    this.agents = rawAgents.map(normalizeAgent).filter(Boolean).sort((a, b) =>
      PRIORITY.indexOf(a.state) - PRIORITY.indexOf(b.state) || a.name.localeCompare(b.name));
    this.connected = true; this.error = null; this.updatedAt = Date.now();
    if (this.selected !== 'all' && !this.agents.some(a => a.id === this.selected)) this.selected = 'all';
    this.publish();
  }
  disconnect(error = 'Herdr is not running') {
    this.connected = false; this.error = cleanText(error, 150); this.publish();
  }
  select(id) {
    this.validateSelection(id);
    this.selected = id; this.expression = null; this.publish();
  }
  validateSelection(id) {
    if (id !== 'all' && !this.agents.some(a => a.id === id)) throw new Error('Agent is no longer available');
  }
  validateExpression(expression) {
    if (expression !== null && !EXPRESSION_LABELS.has(expression) && !GROK_BY_ID.has(expression)) throw new Error('Unknown expression');
  }
  setExpression(expression) {
    this.validateExpression(expression);
    if (expression !== null && expression === this.expression) { this.changedAt = Date.now(); this.animationEpoch = (this.animationEpoch + 1) >>> 0; }
    this.expression = expression; this.publish();
  }
  cycle() {
    const ids = ['all', ...this.agents.map(a => a.id)];
    this.select(ids[(ids.indexOf(this.selected) + 1) % ids.length]);
  }
  setDevice(update) { this.device = { ...this.device, ...update }; this.emit('change', this.snapshot()); }
  setTextGap(value) {
    validateTextGap(value);
    if (this.textGap === value) return;
    this.textGap = value; this.publish();
  }
  setPointer(update) {
    if (Object.entries(update).every(([key, value]) => this.pointer[key] === value)) return;
    this.pointer = { ...this.pointer, ...update }; this.publish();
  }
  faceDisplay() {
    const summary = aggregate(this.agents, this.connected);
    const clip = GROK_BY_ID.get(this.expression);
    if (clip) return { ...summary, state: 'idle', animation: clip.id, label: clip.label, name: 'Playground' };
    if (this.expression !== null) return {
      ...summary, state: this.expression, label: EXPRESSION_LABELS.get(this.expression), name: 'Playground'
    };
    const selected = this.agents.find(a => a.id === this.selected);
    if (selected && this.connected) return {
      ...summary, state: selected.state, label: STATUS_LABELS[selected.state], name: selected.name
    };
    if (!this.connected || !this.agents.length) return { ...summary, name: '' };
    const { working, done, idle } = summary.counts;
    const session = this.agents.find(agent => agent.id === this.workingSessionId && agent.state === 'working');
    return {
      ...summary,
      label: ['blocked', 'unknown'].includes(summary.state) ? summary.label : working === 1 ? 'Working' : working > 1 ? `${working} Working` : 'Idle',
      name: session ? wireText(session.name || session.kind) : done > 0 ? `${done} ready` : `${idle} idle`,
      nameShimmer: Boolean(session)
    };
  }
  syncWorkingSession(now = Date.now(), advance = false) {
    const sessions = this.activeModule === 'face' && this.selected === 'all' && this.expression === null && this.connected
      ? this.agents.filter(agent => agent.state === 'working') : [];
    const previous = this.workingSessionId;
    const index = sessions.findIndex(agent => agent.id === previous);
    if (index < 0) {
      this.workingSessionId = sessions[0]?.id ?? null;
      this.workingSessionSince = now;
    } else if (advance && sessions.length > 1 && now - this.workingSessionSince >= WORKING_SESSION_INTERVAL_MS) {
      this.workingSessionId = sessions[(index + 1) % sessions.length].id;
      this.workingSessionSince = now;
    }
    return previous !== this.workingSessionId;
  }
  tickWorkingSessions() {
    if (this.syncWorkingSession(Date.now(), true)) this.publish();
  }
  enabledModules() { return this.settings.device.moduleOrder.filter(id => this.settings.modules[id].enabled); }
  setModule(id) {
    if (!this.enabledModules().includes(id)) throw new Error('Enable this module before showing it on the device.');
    this.activeModule = id; this.settings.device.activeModule = id; this.expression = null; this.publish();
  }
  cycleModule(direction = 1) {
    const modules = this.enabledModules();
    const id = modules[(modules.indexOf(this.activeModule) + direction + modules.length) % modules.length];
    this.setModule(id); return id;
  }
  canCycleUsage() {
    return this.activeModule === 'usage' && this.settings.modules.usage.enabled &&
      this.display().dashboard?.status === 'ready' && this.display().dashboard.pageCount > 1;
  }
  cycleUsage(direction) {
    if (![-1, 1].includes(direction)) throw new Error('Choose a valid page direction.');
    if (!this.canCycleUsage()) throw new Error('Show usage with more than one page before changing pages.');
    const pageCount = usagePageCount(this.sources, this.settings);
    this.usagePage = (this.usagePage + direction + pageCount) % pageCount;
    this.publish();
  }
  canCycleHey() {
    return this.activeModule === 'hey' && this.settings.modules.hey.enabled &&
      this.display().dashboard?.status === 'ready' && this.display().dashboard.pageCount > 1;
  }
  cycleHey(direction) {
    if (![-1, 1].includes(direction)) throw new Error('Choose a valid page direction.');
    if (!this.canCycleHey()) throw new Error('Show a mailbox with more than one page before changing pages.');
    const pageCount = heyPageCount(this.sources, this.settings);
    this.heyPage = (this.heyPage + direction + pageCount) % pageCount;
    this.publish();
  }
  canSetRoonView(expanded = true) {
    return this.activeModule === 'roon' && this.settings.modules.roon?.enabled &&
      this.sources.roon?.status === 'ready' && (!expanded && this.roonExpanded || /^[a-f0-9]{40}$/.test(this.sources.roon.artId || ''));
  }
  setRoonExpanded(expanded) {
    if (typeof expanded !== 'boolean') throw new Error('Expanded artwork must be on or off.');
    if (!this.canSetRoonView(expanded)) throw new Error('Show Roon with available artwork before changing its view.');
    if (expanded === this.roonExpanded) return;
    this.roonExpanded = expanded; this.publish();
  }
  setSettings(settings, revision = this.settingsRevision) {
    if (this.settings.modules.usage.provider !== settings.modules.usage.provider) this.usagePage = 0;
    if (this.settings.modules.hey.box !== settings.modules.hey.box) this.heyPage = 0;
    this.settings = structuredClone(settings); this.settingsRevision = revision;
    this.heyPage = Math.min(this.heyPage, heyPageCount(this.sources, this.settings) - 1);
    const next = settings.device.activeModule;
    if (this.activeModule !== next) this.expression = null;
    this.activeModule = next; this.textGap = settings.device.textGap; this.publish();
  }
  setSources(sources) {
    this.sources = { ...this.sources, ...structuredClone(sources) };
    if (sources.usage?.status === 'ready') this.usagePage = Math.min(this.usagePage, usagePageCount(this.sources, this.settings) - 1);
    if (sources.hey?.status === 'ready') this.heyPage = Math.min(this.heyPage, heyPageCount(this.sources, this.settings) - 1);
    this.publish();
  }
  display() {
    const attention = this.attention?.snapshot().active;
    if (attention) return { state: attention.animation.startsWith('grok:') ? 'idle' : attention.animation, animation: attention.animation.startsWith('grok:') ? attention.animation : null, label: attention.title, name: attention.description, statusDots: false, nameShimmer: false };
    if (this.activeModule !== 'face') {
      const display = dashboardFor(this.activeModule, this.sources, this.settings, Date.now(), this.usagePage, this.heyPage);
      if (this.activeModule === 'roon') display.dashboard.expanded = this.roonExpanded;
      return display;
    }
    const display = this.faceDisplay();
    const mapping = this.expression === null ? this.settings.mappings[display.state] : null;
    if (mapping?.startsWith('grok:')) return { ...display, animation: mapping };
    if (mapping) return { ...display, expression: mapping };
    return display;
  }
  tickClock() {
    if (this.activeModule !== 'clock' || this.attention?.active) return;
    const dashboard = this.display().dashboard;
    const key = JSON.stringify([dashboard.time, dashboard.weekday]);
    if (key !== this.lastClockKey) this.publish();
  }
  publish() {
    const roon = this.sources.roon;
    if (this.activeModule !== 'roon' || !this.settings.modules.roon?.enabled || roon?.status !== 'ready' ||
        !/^[a-f0-9]{40}$/.test(roon.artId || '') && !roon.artworkLoading) this.roonExpanded = false;
    this.syncWorkingSession();
    const display = this.display();
    if (this.activeModule === 'clock' && !this.attention?.active) this.lastClockKey = JSON.stringify([display.dashboard.time, display.dashboard.weekday]);
    const displayKey = JSON.stringify([this.selected, this.expression, this.activeModule, display.state, display.animation, display.expression, this.attention?.active?.id, this.attention?.active?.stepIndex]);
    if (displayKey !== this.lastDisplayKey) { this.changedAt = Date.now(); this.animationEpoch = (this.animationEpoch + 1) >>> 0; this.lastDisplayKey = displayKey; }
    this.seq++; this.emit('change', this.snapshot());
  }
  systemAppearance = 'dark';
  setSystemAppearance(value) {
    if (!['dark', 'light'].includes(value) || value === this.systemAppearance) return;
    this.systemAppearance = value; this.publish();
  }
  snapshot() {
    return { v: 1, deviceAppearance: resolveDeviceAppearance(this.settings, this.systemAppearance), module: this.attention?.active ? 'face' : this.activeModule, attention: this.attention?.snapshot() ?? { enabled: true, active: null, queue: [], history: [] }, modules: this.sources, settings: this.settings, settingsRevision: this.settingsRevision, animationMs: Math.round(performance.now()), ageMs: Math.min(4294967295, Math.max(0, Date.now() - this.changedAt)), seq: this.seq, connected: this.connected, error: this.error, agents: this.agents,
      selected: this.selected, expression: this.expression, display: this.display(), layout: { textGap: this.textGap }, changedAt: this.changedAt, updatedAt: this.updatedAt, device: this.device, pointer: this.pointer };
  }
  wireDashboard(dashboard) {
    const bounded = { ...dashboard, title: wireText(dashboard.title, 32), detail: wireText(dashboard.detail, 48) };
    if (dashboard.time !== undefined) bounded.time = wireText(dashboard.time, 7);
    if (dashboard.weekday !== undefined) bounded.weekday = wireText(dashboard.weekday, 3);
    for (const key of ['primary', 'secondary']) if (dashboard[key]) bounded[key] = { ...dashboard[key], provider: wireText(dashboard[key].provider, 16), label: wireText(dashboard[key].label, 16), reset: wireText(dashboard[key].reset, 24) };
    return bounded;
  }
  frame() {
    const { state, animation = null, expression, dashboard, statusDots = false, nameShimmer = false, label, name, counts = this.faceDisplay().counts } = this.display();
    const look = this.pointer.enabled && this.pointer.status === 'active' ? { x: this.pointer.x, y: this.pointer.y } : null;
    const moduleIds = this.enabledModules();
    const attention = this.attention?.snapshot().active;
    const visibleModule = attention ? 'face' : this.activeModule;
    const moduleFrame = visibleModule === 'face' ? {} : { module: visibleModule, dashboard: this.wireDashboard(dashboard) };
    const fields = DESIGN_SCHEMA[visibleModule];
    const appearance = resolveDeviceAppearance(this.settings, this.systemAppearance);
    const design = fields.map(field => appearance.design[visibleModule]?.[field.key] ?? field.default);
    const designFrame = fields.some((field, index) => design[index] !== field.default) ? { design } : {};
    return { type: 'state', v: 1, theme: appearance.resolved, palette: appearance.palette, rotation: this.settings.device.rotation, ...moduleFrame, ...designFrame, ...(attention ? { attention: { id: attention.id, revision: attention.revision, detail: attention.detail, body: attention.body || attention.description || 'No additional details.', actions: attention.actions.map(({ id, label }) => ({ id, label })) } } : {}), moduleIndex: moduleIds.indexOf(this.activeModule), moduleCount: moduleIds.length, showModuleNavigation: !attention && this.settings.device.showModuleNavigation, showCardBackgrounds: this.settings.device.showCardBackgrounds, expression, epoch: this.animationEpoch, animationMs: Math.round(performance.now()), ageMs: Math.min(4294967295, Math.max(0, Date.now() - this.changedAt)), seq: this.seq, state, animation, statusDots, nameShimmer, preview: this.expression !== null, look, label: attention ? label : wireText(label), name: attention ? name : wireText(name), counts, textGap: this.textGap };
  }
}

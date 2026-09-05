import { COLOR_TOKENS } from '../shared/device-appearance.mjs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import DEFAULTS from '../shared/studio-defaults.json' with { type: 'json' };
import DESIGN_SCHEMA from '../shared/design-schema.json' with { type: 'json' };
import CATALOG from '../shared/grok-catalog.json' with { type: 'json' };
import { MAX_USAGE_PROVIDERS, validProviderId } from './module-sources.mjs';

export const MODULE_IDS = ['face', 'usage', 'hey', 'clock', 'roon'];
export const MAPPING_STATES = ['working', 'blocked', 'done', 'idle', 'unknown', 'disconnected'];
export const NATIVE_EXPRESSIONS = ['working', 'blocked', 'done', 'idle', 'sleep', 'unknown', 'disconnected'];
const animationIds = new Set([...NATIVE_EXPRESSIONS, ...CATALOG.map(item => item.id)]);
const enumValue = (value, values, name) => { if (!values.includes(value)) throw new Error(`Choose a valid ${name}.`); };
const boolean = (value, name) => { if (typeof value !== 'boolean') throw new Error(`${name} must be on or off.`); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function defaultSettings(textGap = DEFAULTS.device.textGap) {
  const settings = structuredClone(DEFAULTS); settings.device.textGap = textGap; return settings;
}
export function mergeSettings(current, patch) {
  if (!object(patch)) throw new Error('Settings must be an object.');
  const merge = (target, value) => {
    if (!object(value)) throw new Error('Invalid settings section.');
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(target, key)) throw new Error(`Unknown setting: ${key}.`);
      if (object(target[key])) merge(target[key], value[key]);
      else target[key] = structuredClone(value[key]);
    }
  };
  const next = structuredClone(current); merge(next, patch); validateSettings(next); return next;
}
export function validateSettings(settings) {
  if (settings.version !== 1) throw new Error('Unsupported settings version.');
  enumValue(settings.appearance.theme, ['light', 'dark', 'system'], 'theme');
  enumValue(settings.appearance.direction, ['ltr', 'rtl'], 'reading direction');
  boolean(settings.appearance.reducedMotion, 'Reduced motion');
  const appearance = settings.deviceAppearance;
  if (!object(appearance) || !object(appearance.palettes)) throw new Error('Choose valid device appearance settings.');
  enumValue(appearance.mode, ['light', 'dark', 'system'], 'device appearance');
  for (const mode of ['light', 'dark']) {
    const palette = appearance.palettes[mode];
    if (!object(palette)) throw new Error('Choose valid device colors.');
    for (const key of COLOR_TOKENS) if (!Number.isInteger(palette[key]) || palette[key] < 0 || palette[key] > 0xffffff) throw new Error(`Choose a valid ${mode} ${key} color.`);
  }
  const device = settings.device;
  if (!Number.isInteger(device.rotation) || device.rotation < 0 || device.rotation > 359) throw new Error('Choose a display rotation from 0 to 359 degrees.');
  enumValue(device.textGap, [4, 8, 16], 'text spacing');
  enumValue(device.mouseInterval, [100, 250, 500, 1000], 'mouse interval');
  boolean(device.followMouse, 'Follow mouse'); boolean(device.swipeEnabled, 'Swipe navigation');
  boolean(device.showModuleNavigation, 'Module selector');
  boolean(device.showCardBackgrounds, 'Card backgrounds');
  enumValue(device.activeModule, MODULE_IDS, 'module');
  if (!Array.isArray(device.moduleOrder) || device.moduleOrder.length !== MODULE_IDS.length || new Set(device.moduleOrder).size !== MODULE_IDS.length || device.moduleOrder.some(id => !MODULE_IDS.includes(id))) throw new Error('Include each module exactly once in the order.');
  for (const id of MODULE_IDS) boolean(settings.modules[id].enabled, id);
  if (!MODULE_IDS.some(id => settings.modules[id].enabled)) throw new Error('Keep at least one module enabled.');
  for (const id of ['usage', 'hey']) enumValue(settings.modules[id].refreshSeconds, [30, 60, 120, 300], 'refresh interval');
  const usage = settings.modules.usage;
  if (!Array.isArray(usage.providers) || usage.providers.length > MAX_USAGE_PROVIDERS || new Set(usage.providers).size !== usage.providers.length || usage.providers.some(id => !validProviderId(id))) throw new Error('Choose valid usage providers.');
  if (usage.provider !== 'auto' && !validProviderId(usage.provider)) throw new Error('Choose a valid device provider.');
  enumValue(settings.modules.hey.box, ['imbox', 'feed', 'paperTrail', 'replyLater', 'screener'], 'HEY box');
  enumValue(settings.modules.clock.hourFormat, ['12', '24'], 'clock format');
  boolean(settings.modules.clock.showWeekday, 'Show weekday');
  boolean(settings.modules.clock.blinkSeparator, 'Blink separator');
  const roon = settings.modules.roon;
  if (typeof roon.host !== 'string' || roon.host.length > 253 || (roon.host && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(roon.host))) throw new Error('Enter a Roon server hostname or IPv4 address.');
  if (typeof roon.zoneId !== 'string' || roon.zoneId.length > 128 || /[\x00-\x1f\x7f]/.test(roon.zoneId)) throw new Error('Choose a valid Roon zone.');
  for (const state of MAPPING_STATES) if (settings.mappings[state] !== null && !animationIds.has(settings.mappings[state])) throw new Error(`Choose a valid animation for ${state}.`);
  if (!object(settings.design) || Object.keys(settings.design).some(id => !Object.hasOwn(DESIGN_SCHEMA, id))) throw new Error('Choose valid module design settings.');
  for (const [id, fields] of Object.entries(DESIGN_SCHEMA)) {
    const values = settings.design[id];
    if (!object(values) || Object.keys(values).some(key => !fields.some(field => field.key === key))) throw new Error(`Choose valid ${id} design settings.`);
    for (const field of fields) {
      const value = values[field.key];
      if (!Number.isInteger(value) || (!(field.allowAuto && value === 0) && value < field.min) || value > field.max || (field.options && !field.options.includes(value))) throw new Error(`Choose a valid ${id} ${field.label.toLowerCase()}.`);
    }
  }
  if (!settings.modules[device.activeModule].enabled) device.activeModule = device.moduleOrder.find(id => settings.modules[id].enabled);
  return settings;
}

function migrateSavedSettings(saved) {
  const order = saved?.device?.moduleOrder;
  if (saved?.version === 1 && Array.isArray(order) && [3, 4].includes(order.length) &&
      new Set(order).size === order.length && order.every(id => MODULE_IDS.includes(id)) &&
      ['face', 'usage', 'hey'].every(id => order.includes(id))) {
    saved.device.moduleOrder = [...order, ...MODULE_IDS.filter(id => !order.includes(id))];
  }
  return saved;
}

export class StudioSettings {
  pending = Promise.resolve();
  constructor(store, { filePath = fileURLToPath(new URL('../.cache/studio-settings.json', import.meta.url)), onApply = () => {}, validateApply = () => {} } = {}) {
    this.store = store; this.filePath = filePath; this.onApply = onApply; this.validateApply = validateApply;
    this.value = defaultSettings(store.textGap); this.revision = 0;
  }
  async load() {
    try { this.value = mergeSettings(this.value, migrateSavedSettings(JSON.parse(await readFile(this.filePath, 'utf8')))); }
    catch (error) { if (error.code !== 'ENOENT') console.warn('Could not load dashboard settings; using safe defaults.'); }
    // Keep saved preferences portable when the bridge moves to another platform.
    try { this.validateApply(this.value); } catch { this.value.device.followMouse = false; }
    this.apply();
  }
  apply() { this.onApply(structuredClone(this.value)); this.store.setSettings(this.value, this.revision); }
  save(patch) {
    const savedPatch = structuredClone(patch);
    return this.update(current => mergeSettings(current, savedPatch));
  }
  activateModule(id) {
    return this.update(current => {
      enumValue(id, MODULE_IDS, 'module');
      if (!current.modules[id].enabled) throw new Error('Enable this module before showing it on the device.');
      return mergeSettings(current, { device: { activeModule: id } });
    });
  }
  cycleModule(direction) {
    return this.update(current => {
      enumValue(direction, [-1, 1], 'swipe direction');
      if (!current.device.swipeEnabled) return current;
      const ids = current.device.moduleOrder.filter(id => current.modules[id].enabled);
      const next = ids[(ids.indexOf(current.device.activeModule) + direction + ids.length) % ids.length];
      return mergeSettings(current, { device: { activeModule: next } });
    });
  }
  update(transform) {
    const operation = this.pending.then(async () => {
      const next = transform(structuredClone(this.value));
      validateSettings(next); this.validateApply(next);
      if (JSON.stringify(next) === JSON.stringify(this.value)) return structuredClone(this.value);
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await mkdir(path.dirname(this.filePath), { recursive: true });
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
        await rename(temporary, this.filePath);
        this.value = next; this.revision++; this.apply();
      } finally { await rm(temporary, { force: true }); }
      return structuredClone(this.value);
    });
    this.pending = operation.catch(() => {}); return operation;
  }
}

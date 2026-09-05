import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { heyCardURL } from './card-links.mjs';

const MODULES = ['usage', 'hey'];
const COMMANDS = { usage: 'codexbar', hey: 'hey' };
const BOXES = { imbox: 'imbox', feed: 'feedbox', paperTrail: 'trailbox', replyLater: 'laterbox', screener: null };
export const MAX_USAGE_PROVIDERS = 16;
export const validProviderId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value);
const DEFAULTS = {
  usage: { enabled: false, providers: [], refreshSeconds: 60 },
  hey: { enabled: false, box: 'imbox', refreshSeconds: 60 },
};
const PROVIDER_LABELS = { codex: 'Codex', claude: 'Claude', copilot: 'GitHub Copilot', openai: 'OpenAI',
  cursor: 'Cursor', gemini: 'Gemini', zai: 'z.ai', openrouter: 'OpenRouter', jetbrains: 'JetBrains' };
const initial = id => ({ status: 'disabled', refreshing: false, installed: null, version: null, updatedAt: null, error: null,
  ...(id === 'usage' ? { providers: [] } : { items: [], hasMore: false, selectedBox: 'imbox' }) });
const clone = value => structuredClone(value);

function failure(code, message = code) { return Object.assign(new Error(message), { code }); }

// All commands run with fixed executables, argv, closed stdin and bounded output.
// onLine streams watch events without retaining mail subjects or message contents.
export function runModuleCommand(command, args, {
  signal, timeoutMs = 30000, maxOutputBytes = 1024 * 1024, onLine,
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(failure('ABORT_ERR'));
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false,
      env: { ...process.env, HEY_NONINTERACTIVE: '1', NO_COLOR: '1' } });
    let stdout = '', stderr = '', pending = '', bytes = 0, done = false, killTimer;
    const timeout = setTimeout(() => finish(failure('ETIMEDOUT')), timeoutMs);
    timeout.unref?.();
    const abort = () => finish(failure('ABORT_ERR'));
    signal?.addEventListener('abort', abort, { once: true });
    function finish(error, code) {
      if (done) return;
      done = true; clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      if (error) {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 500); killTimer.unref?.();
        reject(error);
      } else resolve({ stdout, stderr, code });
    }
    function read(chunk, isError) {
      if (done) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxOutputBytes) return finish(failure('OUTPUT_LIMIT'));
      if (isError) { stderr += chunk; return; }
      if (!onLine) { stdout += chunk; return; }
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try { onLine(line); } catch { return finish(failure('INVALID_OUTPUT')); }
      }
      if (pending.length > 65536) finish(failure('OUTPUT_LIMIT'));
    }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => read(chunk, false)); child.stderr.on('data', chunk => read(chunk, true));
    child.on('error', error => finish(error));
    child.on('close', code => {
      clearTimeout(killTimer);
      if (onLine && pending && !done) {
        try { onLine(pending); } catch { return finish(failure('INVALID_OUTPUT')); }
      }
      finish(null, code ?? 1);
    });
  });
}

function parseJSON(text) {
  try { return typeof text === 'string' ? JSON.parse(text) : text; }
  catch { throw failure('INVALID_OUTPUT'); }
}

function authError(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  return /auth(?:entication)?[_ -]?(?:required|failed)|unauthori[sz]ed|not[_ -]?(?:authenticated|logged[_ -]?in)|sign[_ -]?in|log[_ -]?in|expired.{0,20}(?:token|session)|(?:token|credentials|cookies?).{0,20}(?:missing|expired|invalid)|\b(?:401|403)\b/i.test(text);
}

function classify(error, id) {
  const name = id === 'usage' ? 'CodexBar' : 'HEY';
  if (error.code === 'ENOENT') return { status: 'missing', installed: false, version: null, error: `${name} CLI was not found. Install it, then refresh detection.` };
  if (error.code === 'AUTH_REQUIRED' || authError(error.message)) return {
    status: 'auth-required', error: id === 'usage' ? 'Sign in to your provider in CodexBar, then refresh.' : 'Sign in with hey auth login in your terminal, then refresh.',
  };
  if (error.code === 'ETIMEDOUT') return { status: 'error', error: `${name} took too long to respond. Try refreshing.` };
  if (error.code === 'OUTPUT_LIMIT') return { status: 'error', error: `${name} returned too much data. Try refreshing.` };
  if (error.code === 'INVALID_OUTPUT') return { status: 'error', error: `${name} returned an unsupported response. Check your CLI version.` };
  return { status: 'error', error: `${name} could not refresh. Check the CLI in your terminal and try again.` };
}

function readResult(result) {
  if (result.code !== 0) throw failure(authError(result.stdout) || authError(result.stderr) ? 'AUTH_REQUIRED' : 'COMMAND_FAILED');
  const value = parseJSON(result.stdout);
  if (value?.ok === false) throw failure(authError(value.error) ? 'AUTH_REQUIRED' : 'COMMAND_FAILED');
  return value;
}

function resetTime(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value); return Number.isFinite(time) ? time : null;
}

function windowLabel(window, fallback) {
  const minutes = window.windowMinutes;
  return minutes === 10080 ? 'Weekly' : minutes === 300 ? 'Session' : minutes >= 40320 && minutes <= 44640 ? 'Monthly' : fallback;
}

function safeLabel(value, fallback, limit = 40) {
  return typeof value === 'string' && /^[A-Za-z0-9 .()/_-]+$/.test(value) && value.length <= limit ? value : fallback;
}

export function parseCodexBar(value) {
  const payload = parseJSON(value);
  const rows = Array.isArray(payload) ? payload : payload?.provider ? [payload] : null;
  if (!rows) throw failure('INVALID_OUTPUT');
  const providers = [], seen = new Set(); let errors = 0, authErrors = 0, providerErrors = 0;
  for (const row of rows) {
    if (row?.error) { errors++; providerErrors++; if (authError(row.error)) authErrors++; continue; }
    if (!row || typeof row.provider !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(row.provider) || !row.usage || typeof row.usage !== 'object' || Array.isArray(row.usage)) { errors++; continue; }
    if (seen.has(row.provider)) continue;
    seen.add(row.provider);
    const usage = row.usage, windows = [], ids = new Set();
    const addWindow = (id, window, label) => {
      if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent) || window.usedPercent < 0 || ids.has(id)) return;
      ids.add(id); windows.push({ id, label, usedPercent: Math.min(100, Math.round(window.usedPercent * 100) / 100), resetAt: resetTime(window.resetsAt) });
    };
    for (const [id, fallback] of [['primary', 'Session'], ['secondary', 'Weekly'], ['tertiary', 'Additional']]) {
      addWindow(id, usage[id], windowLabel(usage[id] ?? {}, fallback));
    }
    for (const [index, extra] of (Array.isArray(usage.extraRateWindows) ? usage.extraRateWindows : []).slice(0, 20).entries()) {
      const id = safeLabel(extra?.id, `extra-${index}`);
      addWindow(id, extra?.window, safeLabel(extra?.title, windowLabel(extra?.window ?? {}, 'Additional')));
    }
    const provider = { id: row.provider, label: PROVIDER_LABELS[row.provider] ?? row.provider.replace(/(^|-)([a-z])/g, (_, dash, letter) => `${dash ? ' ' : ''}${letter.toUpperCase()}`), windows };
    const plan = usage.plan ?? usage.loginMethod;
    if (typeof plan === 'string' && /^(free|plus|pro|team|teams|business|enterprise|max(?: (?:5x|20x))?)$/i.test(plan)) provider.plan = plan;
    providers.push(provider);
  }
  if (!providers.length) {
    if (authErrors) throw failure('AUTH_REQUIRED');
    if (providerErrors) throw failure('COMMAND_FAILED');
    if (errors) throw failure('INVALID_OUTPUT');
    return { providers: [], error: 'No providers are enabled in CodexBar. Enable a provider there, then refresh.' };
  }
  return { providers, error: errors ? 'Some providers could not refresh. Check their connection in CodexBar.' : null };
}

// Select list metadata inside the CLI. Bodies, summaries and account details never enter the bridge.
export const HEY_LIST_LIMIT = 30;
const limitedString = (field, limit) => `(${field} // "" | if type == "string" then .[0:${limit}] else . end)`;
export const HEY_LIST_FILTER = `{items:(if (.data.postings | type) == "array" then [.data.postings[0:30][] | {id:(.id | tostring),url:${limitedString('(if .kind == "bundle" then (.app_bundle_url // .app_url) else .app_url end)', 1024)},sender:${limitedString('.creator.name', 120)},subject:${limitedString('.name', 240)}}] else null end),hasMore:((.data.next_page // "") != "" or (.data.next_history_url // "") != "" or (.data.postings | length) > 30)}`;
export const HEY_SCREENER_FILTER = `{items:(if (.data | type) == "array" then [.data[0:30][] | {id:(.id | tostring),sender:${limitedString('.name', 120)},subject:${limitedString('.subject', 240)}}] else null end),hasMore:((.meta.next_page // "") != "" or (.data | length) > 30)}`;
function mailLabel(value, limit, fallback) {
  const clean = value.toWellFormed().replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, limit).join('') || fallback;
}
export function parseHeyList(value) {
  const data = parseJSON(value);
  if (!data || !Array.isArray(data.items) || data.items.length > HEY_LIST_LIMIT || typeof data.hasMore !== 'boolean') throw failure('INVALID_OUTPUT');
  const seen = new Set(), items = [];
  for (const row of data.items) {
    if (!row || typeof row.id !== 'string' || !/^[1-9][0-9]{0,23}$/.test(row.id) || typeof row.sender !== 'string' || typeof row.subject !== 'string') throw failure('INVALID_OUTPUT');
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    items.push({ id: row.id, ...(heyCardURL(row.url) ? { url: heyCardURL(row.url) } : {}), sender: mailLabel(row.sender, 120, 'Unknown sender'), subject: mailLabel(row.subject, 240, '(No subject)') });
  }
  return { items, hasMore: data.hasMore };
}

function normalize(settings) {
  const result = clone(DEFAULTS);
  for (const id of MODULES) {
    const config = settings?.[id];
    if (!config || typeof config.enabled !== 'boolean') throw new Error(`Choose whether the ${id} module is enabled.`);
    if (!Number.isInteger(config.refreshSeconds) || config.refreshSeconds < 10 || config.refreshSeconds > 3600) throw new Error('Choose a refresh interval from 10 to 3600 seconds.');
    result[id] = { ...result[id], enabled: config.enabled, refreshSeconds: config.refreshSeconds };
  }
  if (!Array.isArray(settings.usage.providers) || settings.usage.providers.length > MAX_USAGE_PROVIDERS || settings.usage.providers.some(id => !validProviderId(id))) throw new Error('Choose valid CodexBar providers.');
  result.usage.providers = [...new Set(settings.usage.providers)];
  if (!Object.hasOwn(BOXES, settings.hey.box)) throw new Error('Choose a HEY box.');
  result.hey.box = settings.hey.box;
  return result;
}

export class ModuleSources extends EventEmitter {
  constructor({ runner = runModuleCommand, now = Date.now, minimumRefreshMs = 10000, settings = DEFAULTS } = {}) {
    super(); this.runner = runner; this.now = now; this.minimumRefreshMs = minimumRefreshMs;
    this.settings = normalize(settings); this.state = { usage: initial('usage'), hey: initial('hey') };
    this.state.hey.selectedBox = this.settings.hey.box;
    this.started = false; this.lifecycle = 0;
    this.jobs = Object.fromEntries(MODULES.map(id => [id, { generation: 0, lastStarted: -Infinity, inFlight: null, controller: null, timer: null }]));
    this.detections = new Map(); this.watcher = null; this.watchRetry = null; this.mailDirty = false;
  }
  snapshot() { return clone(this.state); }
  publish() { this.emit('change', this.snapshot()); }
  configure(settings) {
    const next = normalize(settings);
    for (const id of MODULES) {
      if (JSON.stringify(next[id]) === JSON.stringify(this.settings[id])) continue;
      const sameQuery = id === 'usage'
        ? JSON.stringify(next.usage.providers) === JSON.stringify(this.settings.usage.providers)
        : next.hey.box === this.settings.hey.box;
      const keepData = next[id].enabled && this.settings[id].enabled && sameQuery;
      this.cancel(id); this.settings[id] = next[id];
      if (!keepData) {
        const { installed, version } = this.state[id];
        this.state[id] = { ...initial(id), installed, version, status: next[id].enabled ? 'loading' : 'disabled' };
        if (id === 'hey') {
          this.state.hey.selectedBox = next.hey.box;
        }
      }
      if (this.started && next[id].enabled) void this.refresh(id);
    }
    this.publish(); return this.snapshot();
  }
  async start() {
    if (this.started) return this.snapshot();
    this.started = true; const lifecycle = ++this.lifecycle;
    await Promise.all(MODULES.map(id => this.detect(id)));
    if (!this.started || lifecycle !== this.lifecycle) return this.snapshot();
    await Promise.all(MODULES.filter(id => this.settings[id].enabled).map(id => this.refresh(id)));
    return this.snapshot();
  }
  stop() {
    this.started = false; this.lifecycle++;
    for (const controller of this.detections.values()) controller.abort();
    this.detections.clear();
    for (const id of MODULES) { this.cancel(id); this.state[id].status = 'disabled'; }
    this.publish();
  }
  async detect(id) {
    const lifecycle = this.lifecycle, controller = new AbortController();
    this.detections.get(id)?.abort(); this.detections.set(id, controller);
    try {
      const result = await this.runner(COMMANDS[id], ['--version'], { signal: controller.signal, timeoutMs: 4000, maxOutputBytes: 16384 });
      if (!this.started || lifecycle !== this.lifecycle || controller.signal.aborted) return;
      this.state[id].installed = true;
      this.state[id].version = result.code === 0 ? result.stdout.match(/\b\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*\b/)?.[0] ?? null : null;
    } catch (error) {
      if (!this.started || lifecycle !== this.lifecycle || controller.signal.aborted) return;
      this.state[id].installed = error.code === 'ENOENT' ? false : null;
      this.state[id].version = null;
    } finally {
      if (this.detections.get(id) === controller) this.detections.delete(id);
    }
    this.publish();
  }
  cancel(id) {
    const job = this.jobs[id]; job.generation++; job.controller?.abort(); clearTimeout(job.timer);
    job.inFlight = null; job.controller = null; job.timer = null; job.lastStarted = -Infinity;
    this.state[id].refreshing = false;
    if (id === 'hey') { this.watcher?.abort(); this.watcher = null; clearTimeout(this.watchRetry); this.watchRetry = null; this.mailDirty = false; }
  }
  current(id, generation) { return this.started && this.settings[id].enabled && this.jobs[id].generation === generation; }
  async refresh(id) {
    if (!MODULES.includes(id)) throw new Error('Choose the usage or hey module.');
    if (!this.started) return this.snapshot();
    if (!this.settings[id].enabled) { await this.detect(id); return this.snapshot(); }
    const job = this.jobs[id];
    if (job.inFlight) return job.inFlight;
    if (this.now() - job.lastStarted < this.minimumRefreshMs) return this.snapshot();
    clearTimeout(job.timer); job.timer = null; job.lastStarted = this.now();
    const generation = job.generation, controller = new AbortController(); job.controller = controller;
    const settings = clone(this.settings[id]);
    if (this.state[id].status !== 'ready') {
      this.state[id].status = 'loading'; this.state[id].error = null;
    }
    this.state[id].refreshing = true; this.publish();
    job.inFlight = (async () => {
      try {
        const update = id === 'usage' ? await this.readUsage(settings, controller.signal) : await this.readHey(settings, controller.signal);
        if (!this.current(id, generation)) return this.snapshot();
        this.state[id] = { ...this.state[id], ...update, installed: true, status: 'ready', refreshing: false, updatedAt: this.now() };
        if (id === 'hey') this.startWatch(generation);
      } catch (error) {
        if (!this.current(id, generation) || controller.signal.aborted) return this.snapshot();
        this.state[id] = { ...this.state[id], ...classify(error, id), refreshing: false };
      } finally {
        if (this.current(id, generation)) {
          job.inFlight = null; job.controller = null;
          if (id === 'usage' || (id === 'hey' && (this.settings.hey.box === 'screener' || this.state.hey.status === 'error'))) this.schedule(id, this.settings[id].refreshSeconds * 1000);
          else if (this.mailDirty) { this.mailDirty = false; this.schedule('hey', this.settings.hey.refreshSeconds * 1000); }
          this.publish();
        }
      }
      return this.snapshot();
    })();
    return job.inFlight;
  }
  schedule(id, milliseconds) {
    const job = this.jobs[id], generation = job.generation;
    if (job.timer) return;
    job.timer = setTimeout(() => { job.timer = null; if (this.current(id, generation)) void this.refresh(id); }, Math.max(milliseconds, this.minimumRefreshMs));
    job.timer.unref?.();
  }
  async readUsage(settings, signal) {
    const args = ['usage', '--json', '--no-credits', '--no-color'];
    const selections = settings.providers.length ? settings.providers : [null];
    const rows = [];
    for (const provider of selections) {
      if (signal.aborted) throw failure('ABORT_ERR');
      const result = await this.runner('codexbar', provider ? [...args, '--provider', provider] : args, { signal, timeoutMs: 45000, maxOutputBytes: 1024 * 1024 });
      // CodexBar returns useful provider results alongside errors with a nonzero exit.
      let payload;
      try { payload = parseJSON(result.stdout); }
      catch { readResult(result); throw failure('INVALID_OUTPUT'); }
      if (!Array.isArray(payload)) { readResult(result); throw failure('INVALID_OUTPUT'); }
      if (result.code !== 0 && !payload.length) readResult(result);
      rows.push(...payload);
    }
    return parseCodexBar(rows);
  }
  async readHey(settings, signal) {
    const args = settings.box === 'screener'
      ? ['screener', 'list', '--jq', HEY_SCREENER_FILTER]
      : ['box', 'view', BOXES[settings.box], '--limit', String(HEY_LIST_LIMIT), '--jq', HEY_LIST_FILTER];
    const result = await this.runner('hey', args, { signal, timeoutMs: 30000, maxOutputBytes: 131072 });
    return { ...parseHeyList(readResult(result)), selectedBox: settings.box, error: null };
  }

  startWatch(generation) {
    if (this.watcher || !this.current('hey', generation)) return;
    clearTimeout(this.watchRetry); this.watchRetry = null;
    const controller = new AbortController(); this.watcher = controller;
    void Promise.resolve().then(() => this.runner('hey', ['watch', '--events', 'added,updated,deleted,resync', '--timeout', '30m'], {
      signal: controller.signal, timeoutMs: 31 * 60 * 1000, maxOutputBytes: 1024 * 1024,
      onLine: line => {
        if (!this.current('hey', generation) || controller.signal.aborted) return;
        let event; try { event = JSON.parse(line); } catch { return; }
        if (event?.change === 'disconnected') {
          this.state.hey.status = 'error'; this.state.hey.error = 'HEY is reconnecting. The mailbox may be out of date.'; this.publish();
        } else if (['ready', 'added', 'updated', 'deleted', 'resync'].includes(event?.change)) {
          if (this.jobs.hey.inFlight) this.mailDirty = true;
          else this.schedule('hey', this.settings.hey.refreshSeconds * 1000);
        }
      },
    })).then(result => {
      if (!this.current('hey', generation) || controller.signal.aborted) return;
      if (result.code !== 0) throw failure(authError(result.stderr) || authError(result.stdout) ? 'AUTH_REQUIRED' : 'COMMAND_FAILED');
    }).catch(error => {
      if (!this.current('hey', generation) || controller.signal.aborted) return;
      this.state.hey = { ...this.state.hey, ...classify(error, 'hey') }; this.publish();
    }).finally(() => {
      if (this.watcher !== controller) return;
      this.watcher = null;
      if (!this.current('hey', generation) || this.state.hey.status === 'auth-required') return;
      this.watchRetry = setTimeout(() => { this.watchRetry = null; this.startWatch(generation); }, Math.max(10000, this.settings.hey.refreshSeconds * 1000));
      this.watchRetry.unref?.();
    });
  }
}

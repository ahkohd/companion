import { execFile } from 'node:child_process';

export function validateCallback(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.command !== 'string' || !value.command.trim() || value.command.includes('\0') || Buffer.byteLength(value.command) > 1024 || Object.keys(value).some(key => !['command', 'args', 'env'].includes(key))) throw new Error('Callback requires a command of at most 1024 bytes.');
  const args = value.args ?? [];
  if (!Array.isArray(args) || args.length > 32 || args.some(arg => typeof arg !== 'string' || arg.includes('\0')) || args.reduce((bytes, arg) => bytes + Buffer.byteLength(arg), 0) > 8192) throw new Error('Callback accepts at most 32 arguments and 8192 argument bytes.');
  const env = value.env ?? {};
  if (!env || typeof env !== 'object' || Array.isArray(env) || Object.keys(env).length > 64 || Object.entries(env).some(([key, val]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > 128 || typeof val !== 'string' || val.includes('\0'))) throw new Error('Callback environment requires valid variable names and string values.');
  const callback = { command: value.command, args: [...args], env: { ...env } };
  if (Buffer.byteLength(JSON.stringify(callback)) > 8192) throw new Error('Callback configuration must be at most 8192 bytes.');
  return callback;
}

export class AttentionCallbacks {
  constructor({ execute = execFile, limit = 32 } = {}) { this.execute = execute; this.limit = limit; this.queue = []; this.running = false; this.stopped = false; }
  deliver(callback, result) {
    if (this.stopped) return Promise.reject(new Error('Callback delivery stopped with the bridge.'));
    if (this.queue.length + Number(this.running) >= this.limit) return Promise.reject(new Error('Callback queue is full.'));
    return new Promise((resolve, reject) => { this.queue.push({ callback, result: { ...result }, resolve, reject }); void this.drain(); });
  }
  run(callback, result) {
    return new Promise((resolve, reject) => {
      const { callbackDelivery, ...payload } = result;
      let input;
      try { input = JSON.stringify(payload) + '\n'; } catch { reject(new Error('Callback result could not be encoded.')); return; }
      try {
        this.child = this.execute(callback.command, callback.args, { env: { ...process.env, ...callback.env }, timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 65536, shell: false }, error => {
          this.child = null;
          if (error) reject(new Error(error.killed ? 'Callback exceeded its execution limit.' : `Callback failed${typeof error.code === 'number' ? ` with exit code ${error.code}` : ''}.`));
          else resolve();
        });
        this.child.stdin?.on('error', () => {});
        this.child.stdin?.end(input);
      } catch { this.child = null; reject(new Error('Callback could not be started.')); }
    });
  }
  async drain() {
    if (this.running || this.stopped) return;
    this.running = true;
    try { while (this.queue.length && !this.stopped) {
      const job = this.queue.shift();
      try { const callback = validateCallback(job.callback); if (!callback) throw new Error('Callback is missing.'); await this.run(callback, job.result); job.resolve(); }
      catch (error) { job.reject(error); }
    } } finally { this.running = false; }
  }
  stop() { this.stopped = true; this.child?.kill('SIGKILL'); for (const job of this.queue.splice(0)) job.reject(new Error('Callback delivery stopped with the bridge.')); }
}

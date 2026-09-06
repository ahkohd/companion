#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import catalog from '../shared/grok-catalog.json' with { type: 'json' };

export async function run(args, { out = value => console.log(JSON.stringify(value)), fetcher = fetch } = {}) {
  const [command = 'help', ...rest] = args;
  if (command === 'help' || command === '--help') {
    out({ usage: 'companion <show|update|clear|status|wait|animations> [--json file|-] [--id ID] [--owner OWNER] [--timeout seconds]',
      examples: ['companion show --json request.json', 'companion wait --id MESSAGE_ID --timeout 300', 'companion clear --id MESSAGE_ID --owner my-agent'],
      note: 'JSON output. wait exits 2 on timeout or a missing result; neither means approval. COMPANION_URL defaults to http://127.0.0.1:4317.' }); return 0;
  }
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--json', '--id', '--owner', '--timeout'].includes(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Invalid option: ${rest[i]}`);
    options[rest[i].slice(2)] = rest[i + 1];
  }
  if (command === 'animations') { out([...['working', 'blocked', 'done', 'idle', 'sleep', 'unknown'].map(id => ({ id })), ...catalog]); return 0; }
  if (!['show', 'update', 'clear', 'status', 'wait'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const base = new URL(process.env.COMPANION_URL || 'http://127.0.0.1:4317');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.username || base.password) throw new Error('COMPANION_URL must be a local HTTP address.');
  const request = async (route, body) => {
    const response = await fetcher(new URL(route, base), { signal: AbortSignal.timeout(10000), ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    if (!result.attention) throw new Error('This bridge does not support attention. Restart the updated bridge.');
    return result;
  };
  if (command === 'status') { out((await request('/api/state')).attention); return 0; }
  if (command === 'wait') {
    if (!options.id) throw new Error('wait requires --id.');
    const timeout = Number(options.timeout ?? 300);
    if (!Number.isFinite(timeout) || timeout < 0 || timeout > 86400) throw new Error('Timeout must be between 0 and 86400 seconds.');
    const deadline = Date.now() + timeout * 1000;
    while (true) {
      const attention = (await request('/api/state')).attention;
      const result = attention.history.find(item => item.id === options.id);
      if (result) { out(result); return 0; }
      if (attention.active?.id !== options.id && !attention.queue.some(item => item.id === options.id)) { out({ id: options.id, status: 'unavailable', approved: false }); return 2; }
      if (Date.now() >= deadline) { out({ id: options.id, status: 'timeout', approved: false }); return 2; }
      await new Promise(resolve => setTimeout(resolve, Math.min(500, deadline - Date.now())));
    }
  }
  let body = {};
  if (options.json) {
    let input;
    if (options.json === '-') { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); input = Buffer.concat(chunks).toString(); }
    else input = await readFile(options.json, 'utf8');
    body = JSON.parse(input);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Send a JSON object.');
  }
  if (options.id) body.id = options.id;
  if (options.owner) body.owner = options.owner;
  if (!body.owner) throw new Error('Set owner in JSON or use --owner. Use a stable, unique agent/session name.');
  const result = await request(`/api/attention/${command}`, body);
  out(result.attentionResult || result.attention); return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  try { process.exitCode = await run(process.argv.slice(2)); }
  catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}

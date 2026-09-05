import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { allowedCardURL, heyCardURL, usageCardURL } from './card-links.mjs';
import { heyItems, heyPageSize, usageWindows } from './dashboard.mjs';

const run = promisify(execFile);
export async function launchCardURL(url, {runCommand = run, platform = process.platform} = {}) {
  if (!allowedCardURL(url)) throw new Error('This card does not have a supported link.');
  if (platform !== 'darwin') throw new Error('Opening cards is available on macOS.');
  await runCommand('/usr/bin/open', [url], {timeout: 10000, maxBuffer: 4096});
}

export function resolveCardURL(store, request) {
  if (!request || !['hey', 'usage'].includes(request.module) || !Number.isInteger(request.index) || request.index < 0 || request.index > (request.module === 'usage' ? 1 : 2) || !/^[a-f0-9]{40}$/.test(request.token || '')) throw new Error('Choose a valid card.');
  if (store.activeModule !== request.module || !store.settings.modules[request.module].enabled) throw new Error('Show this module on the device first.');
  const dashboard = store.display().dashboard;
  if (dashboard?.status !== 'ready' || dashboard.openToken !== request.token) throw new Error('This card has changed. Tap it again.');
  let url;
  if (request.module === 'hey') {
    if (!dashboard.items?.[request.index]?.openable) throw new Error('This message does not have a supported link.');
    const item = heyItems(store.sources, store.settings)[dashboard.pageIndex * heyPageSize(store.settings) + request.index];
    url = heyCardURL(item?.url);
  } else {
    if (!dashboard[request.index ? 'secondary' : 'primary']?.openable) throw new Error('This provider does not have a supported usage page.');
    const item = usageWindows(store.sources, store.settings)[dashboard.pageIndex * 2 + request.index];
    url = usageCardURL(item?.providerId);
  }
  if (!url || !allowedCardURL(url)) throw new Error('This card does not have a supported link.');
  return url;
}

export async function openCard(store, request, {launch = launchCardURL} = {}) {
  // Resolve immediately before launch inside the server's serialized mutation queue.
  const url = resolveCardURL(store, request);
  await launch(url);
}

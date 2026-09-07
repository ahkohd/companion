import { mailWireText } from './mail-text.mjs';
import { cardToken, heyCardURL, usageCardURL } from './card-links.mjs';
const titles = { usage: 'CodexBar', hey: 'HEY' };
export const BOX_LABELS = { imbox: 'Imbox', feed: 'The Feed', paperTrail: 'Paper Trail', replyLater: 'Reply Later', screener: 'Screener' };
function statusDetail(module, status) {
  const name = titles[module];
  return { disabled: `Enable ${name} in the playground`, loading: name, missing: `Install the ${name} CLI`,
    'auth-required': `Open ${name} to reconnect`, error: `Check ${name} and try again` }[status] || '';
}
const wireStatus = { disabled: 'unavailable', loading: 'loading', missing: 'unavailable', 'auth-required': 'auth', error: 'error', ready: 'ready' };
function resetText(at, now) {
  if (!Number.isFinite(at)) return 'No reset time';
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));
  if (!seconds) return 'Resetting soon';
  const minutes = Math.ceil(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  return days ? `Resets in ${days}d ${hours % 24}h` : hours ? `Resets in ${hours}h ${minutes % 60}m` : `Resets in ${minutes}m`;
}
function compactWindowLabel(label, provider) {
  const prefix = `${provider} `;
  const text = label.startsWith(prefix) ? label.slice(prefix.length) : label;
  return text.replace(/\b(\d+)[ -]hours?\b/gi, '$1h').replace(/\b(\d+)[ -]weeks?\b/gi, '$1w').replace(/\b(\d+)[ -]days?\b/gi, '$1d');
}
export function usageWindows(sources, settings) {
  const filter = settings.modules.usage.provider;
  return (sources.usage?.providers || []).filter(provider => filter === 'auto' || provider.id === filter)
    .flatMap(provider => (provider.windows || []).map(window => ({ provider: provider.label, providerId: provider.id, window })));
}
export function usagePageCount(sources, settings) {
  return Math.max(1, Math.ceil(usageWindows(sources, settings).length / 2));
}
export function heyItems(sources, settings) {
  const source = sources.hey;
  return source?.selectedBox === settings.modules.hey.box && Array.isArray(source.items) ? source.items.slice(0, 30) : [];
}
export const heyPageSize = settings => settings.design?.hey?.rows ?? 2;
export function heyPageCount(sources, settings) {
  return Math.max(1, Math.ceil(heyItems(sources, settings).length / heyPageSize(settings)));
}
export function dashboardFor(module, sources, settings, now = Date.now(), usagePage = 0, heyPage = 0) {
  if (module === 'roon') {
    const r = sources.roon || {}, enabled = settings.modules.roon.enabled;
    const status = enabled ? (r.status === 'ready' && !r.zoneId ? 'unavailable' : wireStatus[r.status] || 'unavailable') : 'unavailable';
    return { state: 'idle', label: '', name: '', dashboard: {
      status, title: 'Roon', expanded: false, detail: !enabled ? 'Enable Roon in the playground' : status === 'auth' ? 'Enable Companion in Roon' : r.status === 'ready' && !r.zoneId ? 'Choose a Roon zone in the playground' : status !== 'ready' ? 'Connect Roon in the playground' : '',
      track: mailWireText(r.track || 'Nothing playing', 64), artist: mailWireText(r.artist || '', 64),
      artId: /^[a-f0-9]{40}$/.test(r.artId || '') ? r.artId : '', playing: !!r.playing,
      canPrevious: status === 'ready' && !!r.canPrevious, canNext: status === 'ready' && !!r.canNext,
    } };
  }
  if (module === 'clock') {
    const clock = settings.modules.clock;
    const dashboard = { status: clock.enabled ? 'ready' : 'unavailable', title: 'Clock', detail: clock.enabled ? '' : 'Enable Clock in the playground' };
    if (clock.enabled) {
      const date = new Date(now), hour = date.getHours(), minute = String(date.getMinutes()).padStart(2, '0');
      dashboard.blinkSeparator = clock.blinkSeparator;
      dashboard.time = clock.hourFormat === '24' ? `${String(hour).padStart(2, '0')}:${minute}` : `${hour % 12 || 12}:${minute}`;
      dashboard.weekday = clock.showWeekday ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()] : '';
    }
    return { dashboard, label: '', name: '', state: 'idle' };
  }
  const source = sources[module] || { status: 'disabled' };
  const dashboard = { status: wireStatus[source.status] || 'unavailable', title: titles[module], detail: statusDetail(module, source.status) };
  if (module === 'usage') {
    dashboard.title = ''; dashboard.pageIndex = 0; dashboard.pageCount = 1;
    const display = { dashboard, label: '', name: '', state: 'idle' };
    if (source.status !== 'ready') return display;
    const windows = usageWindows(sources, settings);
    if (!windows.length || windows.length > 512) {
      dashboard.status = 'unavailable'; dashboard.detail = windows.length > 512 ? 'Too many usage windows' : 'No usage available';
      return display;
    }
    dashboard.pageCount = Math.ceil(windows.length / 2);
    dashboard.pageIndex = Number.isInteger(usagePage) ? Math.max(0, Math.min(usagePage, dashboard.pageCount - 1)) : 0;
    if (source.refreshing === true) dashboard.refreshing = true;
    const visible = windows.slice(dashboard.pageIndex * 2, dashboard.pageIndex * 2 + 2);
    if (visible.some(item => usageCardURL(item.providerId))) dashboard.openToken = cardToken('usage', dashboard.pageIndex, visible.map(item => [item.providerId, item.window.label, usageCardURL(item.providerId)]));
    for (const [index, { provider, providerId, window }] of visible.entries()) dashboard[index ? 'secondary' : 'primary'] = {
      provider, label: compactWindowLabel(window.label, provider), remaining: Number.isFinite(window.usedPercent) ? Math.max(0, Math.min(100, 100 - window.usedPercent)) : null,
      reset: resetText(window.resetAt, now), ...(usageCardURL(providerId) ? {openable: true} : {})
    };
    return display;
  }
  dashboard.pageIndex = 0; dashboard.pageCount = 1;
  if (source.status !== 'ready') return { dashboard, label: '', name: '', state: 'idle' };
  const key = settings.modules.hey.box;
  dashboard.title = BOX_LABELS[key];
  if (source.selectedBox !== key || !Array.isArray(source.items)) {
    dashboard.status = 'unavailable'; dashboard.detail = 'Mailbox unavailable';
    return { dashboard, label: '', name: '', state: 'idle' };
  }
  const items = heyItems(sources, settings);
  dashboard.pageCount = heyPageCount(sources, settings);
  dashboard.pageIndex = Number.isInteger(heyPage) ? Math.max(0, Math.min(heyPage, dashboard.pageCount - 1)) : 0;
  const visible = items.slice(dashboard.pageIndex * heyPageSize(settings), (dashboard.pageIndex + 1) * heyPageSize(settings));
  if (visible.some(item => heyCardURL(item.url))) dashboard.openToken = cardToken('hey', [key, dashboard.pageIndex], visible.map(item => [item.id, heyCardURL(item.url)]));
  dashboard.items = visible.map(item => ({
    sender: mailWireText(item.sender, 32), subject: mailWireText(item.subject, 64), ...(heyCardURL(item.url) ? {openable: true} : {}),
  }));
  dashboard.detail = items.length ? '' : key === 'imbox' ? 'You are all caught up' : 'Nothing here yet';
  if (source.refreshing === true) dashboard.refreshing = true;
  return { dashboard, label: '', name: '', state: 'idle' };
}

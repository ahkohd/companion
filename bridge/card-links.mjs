import { createHash } from 'node:crypto';
import PROVIDER_LINKS from './provider-links.json' with { type: 'json' };

// CodexBar official descriptors, commit 211781b (2026-09-06), dashboardURL;
// Claude uses its subscriptionDashboardURL. Providers without a verified URL stay inert.
export const usageCardURL = provider => Object.hasOwn(PROVIDER_LINKS, provider) ? PROVIDER_LINKS[provider] : null;

// HEY posting IDs are not topic IDs. Preserve the supplied app URL, including bundle
// destinations, rather than constructing a topic URL from the posting ID.
export function heyCardURL(value) {
  if (typeof value !== 'string' || value.length > 1024 || /[\x00-\x20\x7f\\]/.test(value)) return null;
  let url; try { url = new URL(value); } catch { return null; }
  if (url.origin !== 'https://app.hey.com' || url.username || url.password || url.search) return null;
  if (!/^\/(?:topics\/[1-9][0-9]*|contacts\/[1-9][0-9]*|postings\/[1-9][0-9]*\/bundles\/unseen|bundles\/[1-9][0-9]*\/topics\/[1-9][0-9]*\/see)$/.test(url.pathname)) return null;
  if (url.hash && !/^#entry_[0-9_]+$/.test(url.hash)) return null;
  return url.href;
}

export function cardToken(module, page, identities) {
  return createHash('sha1').update(JSON.stringify([module, page, identities])).digest('hex');
}

export function allowedCardURL(url) {
  return heyCardURL(url) === url || Object.values(PROVIDER_LINKS).includes(url);
}

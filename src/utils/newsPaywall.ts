const TRACKING_QUERY_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'src',
  'ocid',
  'guccounter',
  'guce_referrer',
  'guce_referrer_sig',
  'cmpid',
  'mod',
  'smid',
  'ncid',
  'partner',
]);

const PAYWALL_UPDATE_EVENT = 'quorix-paywall-status-updated';
const sharedPaywallStatusByUrl = new Map<string, boolean>();

/**
 * Canonicalize an article URL on the client so NEWS HUB, GRAPH PRICE,
 * and NEWS TICKER CRAWL reference the exact same cached paywall status.
 */
export function normalizeClientNewsUrl(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const kept: Array<[string, string]> = [];
    parsed.searchParams.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(lowerKey)) {
        return;
      }
      kept.push([key, value]);
    });
    kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
    const params = new URLSearchParams(kept);
    const query = params.toString();
    return `${host}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Synchronizes server-detected paywall statuses into the shared client store.
 * Notifies other mounted news views when an already-loaded article becomes known to be paywalled.
 */
export function syncNewsPaywallStatuses(
  items: Array<{ url?: string; paywalled?: boolean }>,
): void {
  if (!Array.isArray(items) || items.length === 0) return;

  let changed = false;
  for (const item of items) {
    const key = normalizeClientNewsUrl(item?.url);
    if (!key) continue;
    const incoming = Boolean(item?.paywalled);
    const existing = sharedPaywallStatusByUrl.get(key);
    // Once positive article-level evidence marks a URL paywalled, preserve that status
    // across already-loaded views even if a concurrent partial fetch returned before timeout.
    if (incoming && existing !== true) {
      sharedPaywallStatusByUrl.set(key, true);
      changed = true;
    } else if (existing === undefined) {
      sharedPaywallStatusByUrl.set(key, incoming);
    }
  }

  if (changed && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(PAYWALL_UPDATE_EVENT));
  }
}

/**
 * Returns whether an article has positive paywall evidence from either the item
 * payload itself or the shared client status store.
 */
export function isNewsItemPaywalled(item?: { url?: string; paywalled?: boolean } | null): boolean {
  if (!item) return false;
  if (item.paywalled === true) return true;
  const key = normalizeClientNewsUrl(item.url);
  if (!key) return false;
  return sharedPaywallStatusByUrl.get(key) === true;
}

export function subscribePaywallUpdates(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  window.addEventListener(PAYWALL_UPDATE_EVENT, callback);
  return () => window.removeEventListener(PAYWALL_UPDATE_EVENT, callback);
}

export function clearSharedPaywallStore(): void {
  sharedPaywallStatusByUrl.clear();
}

/**
 * Formats the publisher label consistently across NEWS HUB and GRAPH PRICE.
 */
export function formatNewsSourceLabel(source?: string): string {
  if (!source) return '';
  return source.replace(' Business', '').trim().toUpperCase();
}

/**
 * Formats the ticker timestamp by removing the literal "UTC" suffix while
 * preserving the displayed time value and existing timezone conversion behavior.
 */
export function formatTickerTimestamp(time?: string): string {
  if (!time) return '';
  return time.replace(/\s*\bUTC\b/gi, '').replace(/\s{2,}/g, ' ').trim();
}

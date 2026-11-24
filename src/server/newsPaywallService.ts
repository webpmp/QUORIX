import dns from 'node:dns/promises';
import net from 'node:net';

export type PaywallStatus = 'paywalled' | 'free' | 'unknown';

export interface PaywallDetectionResult {
  status: PaywallStatus;
  paywalled: boolean;
  signal?: string;
  checkedAt: number;
}

interface CacheEntry {
  result: PaywallDetectionResult;
  expiresAt: number;
}

export interface FetchArticleResponse {
  status: number;
  headers: { get(name: string): string | null };
  bodyText: () => Promise<string>;
  cancelBody?: () => Promise<void> | void;
}

export interface PaywallServiceOptions {
  /** Cache TTL for confirmed paywalled/free results (default: 6 hours). */
  confirmedTtlMs?: number;
  /** Cache TTL for inconclusive/unknown results (default: 30 minutes). */
  unknownTtlMs?: number;
  /** Maximum number of cached article URLs (default: 2000). */
  maxCacheEntries?: number;
  /** Per-article HTTP fetch timeout (default: 2500ms). */
  requestTimeoutMs?: number;
  /** Maximum number of HTTP redirects to follow (default: 5). */
  maxRedirects?: number;
  /** Maximum HTML bytes to read from an article response (default: 256 KB). */
  maxHtmlBytes?: number;
  /** Default batch deadline for enriching a feed slice (default: 2500ms). */
  defaultBatchTimeoutMs?: number;
  /** Default concurrent article checks per batch (default: 6). */
  defaultConcurrency?: number;
  /** Optional custom clock for tests. */
  now?: () => number;
  /** Optional DNS lookup override for tests. */
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  /** Optional HTTP fetch override for tests. */
  fetchUrl?: (url: string, signal: AbortSignal) => Promise<FetchArticleResponse>;
}

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

const DEFAULT_CONFIRMED_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_UNKNOWN_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 2000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2500;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_HTML_BYTES = 256 * 1024;
const DEFAULT_BATCH_TIMEOUT_MS = 2500;
const DEFAULT_CONCURRENCY = 6;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
]);

const ACCESS_META_KEYS = new Set([
  'article:content_tier',
  'cxenseparse:recs:access',
  'dj.article.access',
  'article:access',
  'access_level',
  'access-level',
  'content-access',
  'content_access',
  'lp.access',
  'ft.access',
  'byl.access',
  'piano:content_tier',
  'og:restrictions:access',
  'access',
]);

const PAYWALL_BOOLEAN_META_KEYS = new Set([
  'paywall',
  'is_paywalled',
  'ispaywalled',
  'article:paywall',
  'requires_subscription',
]);

const LOCKED_ACCESS_VALUES = new Set([
  'locked',
  'paid',
  'subscriber',
  'subscribers',
  'subscriber-only',
  'subscriber_only',
  'subscription',
  'premium',
  'paywall',
  'paywalled',
  'hard',
  'hard-paywall',
  'hard_paywall',
  'members',
  'members-only',
  'members_only',
  'restricted',
]);

const FREE_ACCESS_VALUES = new Set([
  'free',
  'open',
  'public',
  'unlocked',
  'none',
]);

/**
 * Canonicalize an article URL for cache deduplication across all news views.
 */
export function normalizePaywallUrl(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
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
    return '';
  }
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast & reserved (224.0.0.0/4, 240.0.0.0/4)
  return false;
}

function isPrivateOrReservedIpv6(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().split('%')[0];
  if (!ip) return true;
  if (ip === '::' || ip === '::1') return true;
  // IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (ip.startsWith('::ffff:')) {
    const rest = ip.slice('::ffff:'.length);
    if (net.isIPv4(rest)) {
      return isPrivateOrReservedIpv4(rest);
    }
    const hexParts = rest.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        const ipv4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
        return isPrivateOrReservedIpv4(ipv4);
      }
    }
    return true;
  }
  const firstGroup = ip.split(':')[0] || '0';
  const firstVal = parseInt(firstGroup, 16);
  if (Number.isNaN(firstVal)) return true;
  // fc00::/7 Unique Local Addresses (ULA)
  if ((firstVal & 0xfe00) === 0xfc00) return true;
  // fe80::/10 Link-Local
  if ((firstVal & 0xffc0) === 0xfe80) return true;
  // ff00::/8 Multicast
  if ((firstVal & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 Documentation
  if (ip.startsWith('2001:db8:') || ip.startsWith('2001:0db8:')) return true;
  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateOrReservedIpv4(ip);
  if (version === 6) return isPrivateOrReservedIpv6(ip);
  return true;
}

/**
 * Validates that an article URL is an external HTTP(S) target and does not resolve
 * to a loopback, link-local, metadata, or private network address.
 */
export async function isSafeExternalArticleUrl(
  rawUrl: string,
  lookupFn: (hostname: string) => Promise<Array<{ address: string; family: number }>> = (h) =>
    dns.lookup(h, { all: true }),
): Promise<boolean> {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) return false;
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return false;
  }

  // If the hostname is an IP literal, validate it directly.
  if (net.isIP(hostname) !== 0) {
    return !isPrivateOrReservedIp(hostname);
  }

  try {
    const records = await lookupFn(hostname);
    if (!Array.isArray(records) || records.length === 0) return false;
    return records.every((rec) => rec?.address && !isPrivateOrReservedIp(rec.address));
  } catch {
    return false;
  }
}

function parseBooleanish(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const norm = value.trim().toLowerCase();
    if (norm === 'true') return true;
    if (norm === 'false') return false;
  }
  return null;
}

/**
 * Recursively inspects a parsed JSON-LD structure for Schema.org `isAccessibleForFree`
 * declarations on articles, graphs, and `hasPart` sections.
 */
function inspectJsonLdNode(node: unknown): { sawPaywalled: boolean; sawFree: boolean } {
  const acc = { sawPaywalled: false, sawFree: false };
  if (!node || typeof node !== 'object') return acc;

  const stack: unknown[] = [node];
  let visited = 0;

  while (stack.length > 0 && visited < 400) {
    const current = stack.pop();
    visited++;
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    if ('isAccessibleForFree' in record) {
      const parsed = parseBooleanish(record.isAccessibleForFree);
      if (parsed === false) {
        acc.sawPaywalled = true;
      } else if (parsed === true) {
        acc.sawFree = true;
      }
    }

    if (record['@graph']) stack.push(record['@graph']);
    if (record.hasPart) stack.push(record.hasPart);
    if (record.mainEntity) stack.push(record.mainEntity);
    if (record.mainEntityOfPage) stack.push(record.mainEntityOfPage);
  }

  return acc;
}

function parseTagAttributes(tagSource: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tagSource)) !== null) {
    const key = match[1].toLowerCase();
    const val = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    attrs[key] = val;
  }
  return attrs;
}

/**
 * Pure article-level HTML + HTTP status paywall signal analyzer.
 * Classifies an article as `paywalled` ONLY when positive article-level evidence exists.
 * Never infers paywall status from publisher name/domain or HTTP 403/429 bot blocks.
 */
export function analyzeHtmlForPaywall(
  html: string,
  httpStatus?: number,
): { status: PaywallStatus; signal?: string } {
  if (httpStatus === 402) {
    return { status: 'paywalled', signal: 'http:402' };
  }

  if (!html || typeof html !== 'string') {
    return { status: 'unknown' };
  }

  // 1. Schema.org JSON-LD (<script type="application/ld+json">)
  let jsonLdSawFree = false;
  const jsonLdRegex = /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json[^"]*"|'application\/ld\+json[^']*'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = jsonLdRegex.exec(html)) !== null) {
    const rawJson = (ldMatch[1] || '').trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      const outcome = inspectJsonLdNode(parsed);
      if (outcome.sawPaywalled) {
        return { status: 'paywalled', signal: 'jsonld:isAccessibleForFree=false' };
      }
      if (outcome.sawFree) {
        jsonLdSawFree = true;
      }
    } catch {
      // Fallback for mildly malformed JSON-LD containing explicit isAccessibleForFree: false
      if (/"isAccessibleForFree"\s*:\s*(?:false|"false"|'false')/i.test(rawJson)) {
        return { status: 'paywalled', signal: 'jsonld-raw:isAccessibleForFree=false' };
      }
    }
  }

  // 2. HTML <meta> tags (microdata itemprop="isAccessibleForFree" and publisher subscription metadata)
  let metaSawFree = false;
  const metaRegex = /<meta\b[^>]*>/gi;
  let metaMatch: RegExpExecArray | null;
  while ((metaMatch = metaRegex.exec(html)) !== null) {
    const attrs = parseTagAttributes(metaMatch[0]);
    const contentRaw = attrs.content || '';
    const content = contentRaw.trim().toLowerCase();
    if (!content) continue;

    // Schema.org microdata on <meta itemprop="isAccessibleForFree" content="false">
    if ((attrs.itemprop || '').toLowerCase() === 'isaccessibleforfree') {
      const boolVal = parseBooleanish(content);
      if (boolVal === false) {
        return { status: 'paywalled', signal: 'microdata:isAccessibleForFree=false' };
      }
      if (boolVal === true) {
        metaSawFree = true;
      }
      continue;
    }

    const key = (attrs.name || attrs.property || '').toLowerCase();
    if (!key) continue;

    if (PAYWALL_BOOLEAN_META_KEYS.has(key)) {
      if (content === 'true' || content === '1' || LOCKED_ACCESS_VALUES.has(content)) {
        return { status: 'paywalled', signal: `meta:${key}=${content}` };
      }
      if (content === 'false' || content === '0' || FREE_ACCESS_VALUES.has(content)) {
        metaSawFree = true;
      }
      continue;
    }

    if (ACCESS_META_KEYS.has(key)) {
      if (LOCKED_ACCESS_VALUES.has(content)) {
        return { status: 'paywalled', signal: `meta:${key}=${content}` };
      }
      if (FREE_ACCESS_VALUES.has(content)) {
        metaSawFree = true;
      }
    }
  }

  // 3. Explicit microdata on non-meta elements (e.g., <span itemprop="isAccessibleForFree" content="false">)
  const microdataTagRegex = /<[a-z0-9-]+\b[^>]*itemprop\s*=\s*(?:"isAccessibleForFree"|'isAccessibleForFree'|isAccessibleForFree)[^>]*>/gi;
  let microMatch: RegExpExecArray | null;
  while ((microMatch = microdataTagRegex.exec(html)) !== null) {
    const attrs = parseTagAttributes(microMatch[0]);
    const boolVal = parseBooleanish(attrs.content);
    if (boolVal === false) {
      return { status: 'paywalled', signal: 'microdata-tag:isAccessibleForFree=false' };
    }
    if (boolVal === true) {
      metaSawFree = true;
    }
  }

  // 4. Explicit embedded structured state flags (e.g. __NEXT_DATA__, hydration JSON)
  const structuredPaywallPatterns: Array<{ regex: RegExp; signal: string }> = [
    {
      regex: /"isAccessibleForFree"\s*:\s*(?:false|"false")/i,
      signal: 'state:isAccessibleForFree=false',
    },
    {
      regex: /"(?:isPaywalled|is_paywalled|isSubscriberOnly|is_subscriber_only|subscriberOnly|subscriber_only|requiresSubscription|requires_subscription|isPremiumContent|is_premium_content)"\s*:\s*true\b/i,
      signal: 'state:subscriberFlag=true',
    },
    {
      regex: /"(?:contentTier|content_tier|accessLevel|access_level|paywallState|paywall_state)"\s*:\s*"(?:locked|paid|subscriber|subscribers|subscriber_only|subscriber-only|subscription|hard|paywalled)"/i,
      signal: 'state:accessTier=locked',
    },
    {
      regex: /"(?:paywallType|paywall_type)"\s*:\s*"(?:hard|subscriber|subscription|locked)"/i,
      signal: 'state:paywallType=hard',
    },
  ];
  for (const { regex, signal } of structuredPaywallPatterns) {
    if (regex.test(html)) {
      return { status: 'paywalled', signal };
    }
  }

  // 5. Explicit rendered HTML paywall barrier attributes
  const barrierAttrPatterns: Array<{ regex: RegExp; signal: string }> = [
    {
      regex: /\bdata-(?:is-)?paywall(?:ed)?\s*=\s*(?:"true"|'true'|true\b)/i,
      signal: 'dom:data-paywall=true',
    },
    {
      regex: /\bdata-(?:content-tier|access-state|access-level)\s*=\s*(?:"(?:locked|paid|subscriber|paywall)"|'(?:locked|paid|subscriber|paywall)')/i,
      signal: 'dom:data-access=locked',
    },
    {
      regex: /\bdata-(?:testid|component)\s*=\s*(?:"(?:paywall|paywall-container|paywall-wall|hard-paywall)"|'(?:paywall|paywall-container|paywall-wall|hard-paywall)')/i,
      signal: 'dom:paywall-barrier',
    },
  ];
  for (const { regex, signal } of barrierAttrPatterns) {
    if (regex.test(html)) {
      return { status: 'paywalled', signal };
    }
  }

  if (jsonLdSawFree || metaSawFree) {
    return { status: 'free', signal: jsonLdSawFree ? 'jsonld:isAccessibleForFree=true' : 'meta:access=free' };
  }

  return { status: 'unknown' };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const full = await response.text();
    return full.slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let bytesRead = 0;
  let text = '';

  try {
    while (bytesRead < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = maxBytes - bytesRead;
      if (value.byteLength <= remaining) {
        bytesRead += value.byteLength;
        text += decoder.decode(value, { stream: true });
      } else {
        bytesRead += remaining;
        text += decoder.decode(value.subarray(0, remaining), { stream: false });
        break;
      }
    }
    text += decoder.decode();
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore stream cancellation errors
    }
  }

  return text;
}

function defaultFetchArticleUrl(maxHtmlBytes: number) {
  return async (url: string, signal: AbortSignal): Promise<FetchArticleResponse> => {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (compatible; QuorixMetadataInspector/1.0; +https://quorix.local)',
      },
    });

    return {
      status: response.status,
      headers: response.headers,
      bodyText: () => readBoundedText(response, maxHtmlBytes),
      cancelBody: async () => {
        try {
          await response.body?.cancel();
        } catch {
          // Ignore cancellation errors
        }
      },
    };
  };
}

export interface NewsPaywallService {
  detectPaywall(rawUrl: string): Promise<PaywallDetectionResult>;
  getCachedPaywallStatus(rawUrl?: string): PaywallDetectionResult | null;
  enrichNewsItemsWithPaywall<T extends { url?: string }>(
    items: T[],
    options?: { batchTimeoutMs?: number; concurrency?: number },
  ): Promise<Array<T & { paywalled: boolean }>>;
  clearCache(): void;
  getCacheSize(): number;
}

export function createNewsPaywallService(options: PaywallServiceOptions = {}): NewsPaywallService {
  const confirmedTtlMs = options.confirmedTtlMs ?? DEFAULT_CONFIRMED_TTL_MS;
  const unknownTtlMs = options.unknownTtlMs ?? DEFAULT_UNKNOWN_TTL_MS;
  const maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxHtmlBytes = options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  const defaultBatchTimeoutMs = options.defaultBatchTimeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS;
  const defaultConcurrency = options.defaultConcurrency ?? DEFAULT_CONCURRENCY;
  const now = options.now ?? (() => Date.now());
  const dnsLookup = options.dnsLookup ?? ((hostname: string) => dns.lookup(hostname, { all: true }));
  const fetchUrl = options.fetchUrl ?? defaultFetchArticleUrl(maxHtmlBytes);

  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<PaywallDetectionResult>>();

  function readCache(cacheKey: string): PaywallDetectionResult | null {
    const entry = cache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(cacheKey);
      return null;
    }
    return entry.result;
  }

  function writeCache(cacheKey: string, result: PaywallDetectionResult): void {
    const ttl = result.status === 'unknown' ? unknownTtlMs : confirmedTtlMs;
    if (cache.has(cacheKey)) {
      cache.delete(cacheKey);
    } else if (cache.size >= maxCacheEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
    cache.set(cacheKey, {
      result,
      expiresAt: now() + ttl,
    });
  }

  async function inspectArticleUrl(rawUrl: string): Promise<PaywallDetectionResult> {
    const checkedAt = now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      let currentUrl = rawUrl.trim();
      for (let hop = 0; hop <= maxRedirects; hop++) {
        const safe = await isSafeExternalArticleUrl(currentUrl, dnsLookup);
        if (!safe) {
          return { status: 'unknown', paywalled: false, signal: 'blocked-url', checkedAt };
        }

        const res = await fetchUrl(currentUrl, controller.signal);

        if (res.status === 402) {
          await res.cancelBody?.();
          return { status: 'paywalled', paywalled: true, signal: 'http:402', checkedAt };
        }

        // Handle HTTP 3xx redirects manually so every redirect target is validated.
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          await res.cancelBody?.();
          if (!location || hop === maxRedirects) {
            return { status: 'unknown', paywalled: false, checkedAt };
          }
          try {
            currentUrl = new URL(location, currentUrl).toString();
          } catch {
            return { status: 'unknown', paywalled: false, checkedAt };
          }
          continue;
        }

        // Do not treat 403/429/401/5xx as paywalled — could be bot protection or transient errors.
        if (res.status < 200 || res.status >= 300) {
          await res.cancelBody?.();
          return { status: 'unknown', paywalled: false, checkedAt };
        }

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (
          contentType &&
          !contentType.includes('text/html') &&
          !contentType.includes('application/xhtml+xml')
        ) {
          await res.cancelBody?.();
          return { status: 'unknown', paywalled: false, checkedAt };
        }

        const html = await res.bodyText();
        const analysis = analyzeHtmlForPaywall(html, res.status);
        return {
          status: analysis.status,
          paywalled: analysis.status === 'paywalled',
          signal: analysis.signal,
          checkedAt,
        };
      }

      return { status: 'unknown', paywalled: false, checkedAt };
    } catch {
      return { status: 'unknown', paywalled: false, checkedAt };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function detectPaywall(rawUrl: string): Promise<PaywallDetectionResult> {
    const cacheKey = normalizePaywallUrl(rawUrl);
    if (!cacheKey) {
      return { status: 'unknown', paywalled: false, checkedAt: now() };
    }

    const cached = readCache(cacheKey);
    if (cached) return cached;

    const existingPromise = inFlight.get(cacheKey);
    if (existingPromise) return existingPromise;

    const task = inspectArticleUrl(rawUrl)
      .then((result) => {
        writeCache(cacheKey, result);
        return result;
      })
      .catch(() => {
        const fallback: PaywallDetectionResult = {
          status: 'unknown',
          paywalled: false,
          checkedAt: now(),
        };
        writeCache(cacheKey, fallback);
        return fallback;
      })
      .finally(() => {
        inFlight.delete(cacheKey);
      });

    inFlight.set(cacheKey, task);
    return task;
  }

  function getCachedPaywallStatus(rawUrl?: string): PaywallDetectionResult | null {
    const cacheKey = normalizePaywallUrl(rawUrl);
    if (!cacheKey) return null;
    return readCache(cacheKey);
  }

  async function enrichNewsItemsWithPaywall<T extends { url?: string }>(
    items: T[],
    enrichOptions?: { batchTimeoutMs?: number; concurrency?: number },
  ): Promise<Array<T & { paywalled: boolean }>> {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const batchTimeoutMs = enrichOptions?.batchTimeoutMs ?? defaultBatchTimeoutMs;
    const concurrency = Math.max(1, enrichOptions?.concurrency ?? defaultConcurrency);

    const uniqueUrlsByKey = new Map<string, string>();
    const resultsByKey = new Map<string, PaywallDetectionResult>();

    for (const item of items) {
      if (!item?.url) continue;
      const key = normalizePaywallUrl(item.url);
      if (!key) continue;
      const cached = readCache(key);
      if (cached) {
        resultsByKey.set(key, cached);
      } else if (!uniqueUrlsByKey.has(key)) {
        uniqueUrlsByKey.set(key, item.url);
      }
    }

    const pendingEntries = Array.from(uniqueUrlsByKey.entries());
    if (pendingEntries.length > 0) {
      let cursor = 0;
      const workerCount = Math.min(concurrency, pendingEntries.length);

      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < pendingEntries.length) {
          const idx = cursor++;
          const [key, url] = pendingEntries[idx];
          const res = await detectPaywall(url);
          resultsByKey.set(key, res);
        }
      });

      const allDone = Promise.all(workers).then(() => undefined);
      if (batchTimeoutMs > 0) {
        let timerId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<void>((resolve) => {
          timerId = setTimeout(resolve, batchTimeoutMs);
        });
        await Promise.race([allDone, timeoutPromise]);
        if (timerId !== undefined) clearTimeout(timerId);
      } else {
        await allDone;
      }
    }

    return items.map((item) => {
      const key = normalizePaywallUrl(item?.url);
      const detected = key ? resultsByKey.get(key) ?? readCache(key) : null;
      return {
        ...item,
        paywalled: Boolean(detected?.paywalled),
      };
    });
  }

  return {
    detectPaywall,
    getCachedPaywallStatus,
    enrichNewsItemsWithPaywall,
    clearCache: () => {
      cache.clear();
      inFlight.clear();
    },
    getCacheSize: () => cache.size,
  };
}

export const newsPaywallService = createNewsPaywallService();

import {
  findValidYahooSearchEquity,
  isValidTickerFormat,
  normalizeTickerSymbol,
} from '../utils/equityValidation';
import {
  TICKER_COMPANY_PROFILES,
  getTickerCompanyProfile,
  type TickerCompanyProfile,
} from '../utils/polymarketFilter';

export type TickerResolutionStatus = 'recognized' | 'unrecognized' | 'invalid';

export interface PolymarketTickerResolution {
  status: TickerResolutionStatus;
  ticker: string;
  companyName?: string;
  profile?: TickerCompanyProfile;
  source: 'builtin' | 'hint' | 'yahoo' | 'format' | 'fallback';
  reason?: string;
}

interface CacheRecord {
  resolution: PolymarketTickerResolution;
  expiresAt: number;
}

const RECOGNIZED_TTL_MS = 12 * 60 * 60 * 1000;
const UNRECOGNIZED_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const LOOKUP_TIMEOUT_MS = 3500;

export interface TickerResolverOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function createPolymarketTickerResolver(options: TickerResolverOptions = {}) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, CacheRecord>();

  function getCached(ticker: string): PolymarketTickerResolution | null {
    const entry = cache.get(ticker);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(ticker);
      return null;
    }
    return entry.resolution;
  }

  function setCached(ticker: string, resolution: PolymarketTickerResolution): void {
    const ttl = resolution.status === 'recognized' ? RECOGNIZED_TTL_MS : UNRECOGNIZED_TTL_MS;
    if (cache.has(ticker)) {
      cache.delete(ticker);
    } else if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(ticker, { resolution, expiresAt: now() + ttl });
  }

  async function resolveTicker(
    rawTicker: string,
    companyNameHint?: string,
  ): Promise<PolymarketTickerResolution> {
    const ticker = normalizeTickerSymbol(rawTicker);
    if (!ticker || !isValidTickerFormat(ticker)) {
      return {
        status: 'invalid',
        ticker,
        source: 'format',
        reason: `Ticker "${rawTicker.trim() || ticker}" is not a valid ticker symbol format.`,
      };
    }

    // 1. Built-in shared company-to-ticker profile registry
    const builtIn = TICKER_COMPANY_PROFILES[ticker];
    if (builtIn) {
      return {
        status: 'recognized',
        ticker,
        companyName: builtIn.displayName || companyNameHint?.trim() || undefined,
        profile: builtIn,
        source: 'builtin',
      };
    }

    // 2. Cached prior resolution
    const cached = getCached(ticker);
    if (cached) return cached;

    // 3. Validated company name hint from tracked stocks (non-placeholder)
    const trimmedHint = typeof companyNameHint === 'string' ? companyNameHint.trim() : '';
    const isUsableHint =
      trimmedHint.length >= 3 &&
      trimmedHint.toUpperCase() !== ticker &&
      trimmedHint.toUpperCase() !== `${ticker} CORP.`;
    if (isUsableHint) {
      const resolution: PolymarketTickerResolution = {
        status: 'recognized',
        ticker,
        companyName: trimmedHint,
        profile: getTickerCompanyProfile(ticker, trimmedHint),
        source: 'hint',
      };
      setCached(ticker, resolution);
      return resolution;
    }

    // 4. Dynamic validation & company-name lookup using existing Yahoo Finance equity validation
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=8&newsCount=0`;
      const res = await fetchFn.call(globalThis, url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; QuorixTerminal/1.0)',
        },
      });

      if (!res.ok) {
        // Provider lookup unavailable — do not falsely classify as invalid ticker
        return {
          status: 'recognized',
          ticker,
          profile: getTickerCompanyProfile(ticker),
          source: 'fallback',
        };
      }

      const json = await res.json();
      const match = findValidYahooSearchEquity(json?.quotes, ticker, ticker.replace(/\./g, '-'));
      if (!match) {
        const unrecognized: PolymarketTickerResolution = {
          status: 'unrecognized',
          ticker,
          source: 'yahoo',
          reason: `Ticker "${ticker}" was not recognized as a valid public equity symbol.`,
        };
        setCached(ticker, unrecognized);
        return unrecognized;
      }

      const companyName = match.longname || match.shortname || undefined;
      const recognized: PolymarketTickerResolution = {
        status: 'recognized',
        ticker,
        companyName,
        profile: getTickerCompanyProfile(ticker, companyName),
        source: 'yahoo',
      };
      setCached(ticker, recognized);
      return recognized;
    } catch {
      // Network/timeout on auxiliary ticker lookup — gracefully fall back without false invalidation
      return {
        status: 'recognized',
        ticker,
        profile: getTickerCompanyProfile(ticker),
        source: 'fallback',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    resolveTicker,
    clearCache: () => cache.clear(),
  };
}

export const polymarketTickerResolver = createPolymarketTickerResolver();

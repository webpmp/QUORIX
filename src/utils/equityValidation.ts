import { StockData } from '../types';

export const TRACKED_TICKERS_STORAGE_KEY = 'quorix_tracked_equities_v1';

export const VALID_SECURITY_TYPES = new Set([
  'EQUITY',
  'ETF',
  'MUTUALFUND',
  'INDEX',
  'CRYPTOCURRENCY',
  'FUTURE',
  'CURRENCY',
]);

const TICKER_FORMAT_RE = /^(?=.*[A-Z])[A-Z0-9^]{1,8}(?:[.-][A-Z0-9]{1,4})?$/;

export function normalizeTickerSymbol(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().trim();
}

export function isValidTickerFormat(raw: unknown): boolean {
  const sym = normalizeTickerSymbol(raw);
  return sym.length > 0 && TICKER_FORMAT_RE.test(sym);
}

/**
 * Validates Yahoo Finance `/v8/finance/chart` `meta` object.
 * Distinguishes real identifiable securities (including ones with missing price/volume)
 * from empty or unusable placeholder objects.
 */
export function isValidYahooChartMeta(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as Record<string, unknown>;

  const metaSymbol = normalizeTickerSymbol(m.symbol);
  if (!metaSymbol) return false;

  const instrumentType = normalizeTickerSymbol(m.instrumentType);
  const hasValidType = VALID_SECURITY_TYPES.has(instrumentType);
  const hasName =
    Boolean(typeof m.longName === 'string' && m.longName.trim()) ||
    Boolean(typeof m.shortName === 'string' && m.shortName.trim());
  const hasExchange =
    Boolean(typeof m.exchangeName === 'string' && m.exchangeName.trim()) ||
    Boolean(typeof m.fullExchangeName === 'string' && m.fullExchangeName.trim());
  const hasPrice =
    typeof m.regularMarketPrice === 'number' &&
    Number.isFinite(m.regularMarketPrice) &&
    m.regularMarketPrice > 0;

  if (hasValidType && (hasName || hasExchange || hasPrice)) return true;
  if (hasName && hasExchange) return true;
  if (hasPrice && (hasName || hasExchange || hasValidType)) return true;

  return false;
}

export interface YahooSearchQuoteCandidate {
  symbol: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
  exchDisp?: string;
  isYahooFinance?: boolean;
}

/**
 * Finds an exact-matching, identifiable security from Yahoo Finance `/v1/finance/search` `quotes[]`.
 * - Rejects empty results, placeholder items lacking metadata, `isYahooFinance === false`,
 *   or partial/unrelated suggestions (e.g. searching `TAKE` returning `TTWO`/`TAK`, or `YHOO` returning `YHOO.L`).
 * - Accepts legitimate equities/securities even when quote price or volume is unavailable.
 */
export function findValidYahooSearchEquity(
  quotes: unknown,
  queriedSymbol: string,
  mappedSymbol?: string
): YahooSearchQuoteCandidate | null {
  if (!Array.isArray(quotes) || quotes.length === 0) return null;

  const target = normalizeTickerSymbol(queriedSymbol);
  const mappedTarget = normalizeTickerSymbol(mappedSymbol);
  if (!target) return null;

  for (const item of quotes) {
    if (!item || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    if (q.isYahooFinance === false) continue;

    const candidateSymbol = normalizeTickerSymbol(q.symbol);
    if (!candidateSymbol) continue;

    const symbolMatches =
      candidateSymbol === target || (mappedTarget.length > 0 && candidateSymbol === mappedTarget);
    if (!symbolMatches) continue;

    const quoteType = normalizeTickerSymbol(q.quoteType);
    if (!VALID_SECURITY_TYPES.has(quoteType)) continue;

    const shortname = typeof q.shortname === 'string' ? q.shortname.trim() : '';
    const longname = typeof q.longname === 'string' ? q.longname.trim() : '';
    const exchange = typeof q.exchange === 'string' ? q.exchange.trim() : '';
    const exchDisp = typeof q.exchDisp === 'string' ? q.exchDisp.trim() : '';

    if (!shortname && !longname && !exchange && !exchDisp) {
      continue;
    }

    return {
      symbol: candidateSymbol,
      shortname: shortname || undefined,
      longname: longname || undefined,
      quoteType,
      exchange: exchange || undefined,
      exchDisp: exchDisp || undefined,
      isYahooFinance: typeof q.isYahooFinance === 'boolean' ? q.isYahooFinance : undefined,
    };
  }

  return null;
}

/**
 * Centralized validation of quote API payloads returned to the client before
 * allowing any searched ticker to enter `trackedTickers`, `stocks`, or `localStorage`.
 */
export function isValidQuotePayload(response: unknown, queriedSymbol?: string): boolean {
  if (!response || typeof response !== 'object') return false;
  const res = response as Record<string, unknown>;
  if (res.success !== true) return false;
  if (!res.quote || typeof res.quote !== 'object') return false;

  const q = res.quote as Record<string, unknown>;
  if (q.isInvalid === true || q.isInvalidTicker === true) return false;

  const qSymbol = normalizeTickerSymbol(q.symbol);
  if (!isValidTickerFormat(qSymbol)) return false;

  if (queriedSymbol) {
    const target = normalizeTickerSymbol(queriedSymbol);
    if (
      target &&
      qSymbol !== target &&
      qSymbol.replace(/\./g, '-') !== target.replace(/\./g, '-')
    ) {
      return false;
    }
  }

  const name = typeof q.name === 'string' ? q.name.trim() : '';
  const exchange = typeof q.exchange === 'string' ? q.exchange.trim() : '';
  const secType = normalizeTickerSymbol(q.instrumentType ?? q.quoteType);
  const priceNum =
    typeof q.price === 'number' && Number.isFinite(q.price)
      ? q.price
      : typeof q.price === 'string' && q.price.trim() !== '' && Number.isFinite(Number(q.price))
      ? Number(q.price)
      : 0;

  const hasValidType = VALID_SECURITY_TYPES.has(secType);
  const isPlaceholderName =
    !name ||
    name.toUpperCase() === qSymbol ||
    name.toUpperCase() === `${qSymbol} CORP.`;
  const hasRealName = !isPlaceholderName && name.length > 0;
  const hasExchange = exchange.length > 0;
  const hasPositivePrice = priceNum > 0;

  if (q.isValidSecurity === true && (hasValidType || hasRealName || hasExchange || hasPositivePrice)) {
    return true;
  }

  if (hasValidType && (hasRealName || hasExchange || hasPositivePrice)) {
    return true;
  }

  if (hasRealName && hasExchange) {
    return true;
  }

  if (hasPositivePrice) {
    return true;
  }

  return false;
}

function toFiniteNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function buildStockDataFromQuote(quote: any, existing?: StockData): StockData {
  const prevPrice = existing?.price || 0;
  const nextPrice = toFiniteNumber(quote?.price, 0);
  const nextHistory =
    Array.isArray(quote?.history) && quote.history.length > 0
      ? quote.history
      : existing?.history || [];

  const direction =
    prevPrice > 0 && nextPrice > 0 && nextPrice !== prevPrice
      ? nextPrice > prevPrice
        ? 'up'
        : 'down'
      : undefined;

  const sym = normalizeTickerSymbol(quote?.symbol || existing?.symbol);
  const rawName = typeof quote?.name === 'string' ? quote.name.trim() : '';
  const safeName = rawName || existing?.name || sym;
  const rawExchange = typeof quote?.exchange === 'string' ? quote.exchange.trim() : '';

  return {
    symbol: sym,
    name: safeName,
    exchange: rawExchange || existing?.exchange,
    price: nextPrice,
    change: toFiniteNumber(quote?.change, 0),
    changePercent: toFiniteNumber(quote?.changePercent, 0),
    open: toFiniteNumber(quote?.open, 0),
    high: toFiniteNumber(quote?.high, 0),
    low: toFiniteNumber(quote?.low, 0),
    prevClose: toFiniteNumber(quote?.prevClose, 0),
    volume: toFiniteNumber(quote?.volume, 0),
    marketCap: existing?.marketCap || '—',
    peRatio: existing?.peRatio || 0,
    beta: existing?.beta || 0,
    history: nextHistory,
    isRealTime: true,
    isPreMarket: Boolean(quote?.isPreMarket),
    isAfterHours: Boolean(quote?.isAfterHours),
    preMarketPrice: quote?.preMarketPrice ?? null,
    afterHoursPrice: quote?.afterHoursPrice ?? null,
    extHoursPrice: quote?.extHoursPrice ?? null,
    extHoursChange: quote?.extHoursChange ?? null,
    extHoursChangePercent: quote?.extHoursChangePercent ?? null,
    extHoursSession: quote?.extHoursSession ?? null,
    isCoreHours: typeof quote?.isCoreHours === 'boolean' ? quote.isCoreHours : existing?.isCoreHours,
    lastTickTime: direction ? Date.now() : existing?.lastTickTime,
    lastTickDirection: direction || existing?.lastTickDirection,
  };
}

export function sanitizeTrackedTickersList(
  rawList: unknown,
  tapeSymbols: readonly string[]
): string[] {
  if (!Array.isArray(rawList)) return [];
  const tapeSet = new Set(tapeSymbols.map((s) => normalizeTickerSymbol(s)));
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const item of rawList) {
    const sym = normalizeTickerSymbol(item);
    if (!isValidTickerFormat(sym)) continue;
    if (tapeSet.has(sym) || seen.has(sym)) continue;
    seen.add(sym);
    cleaned.push(sym);
  }

  return cleaned;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadPersistedTrackedTickers(
  storage: Pick<StorageLike, 'getItem'> | null | undefined,
  defaultTickers: readonly string[],
  tapeSymbols: readonly string[]
): string[] {
  if (!storage) return [...defaultTickers];
  try {
    const saved = storage.getItem(TRACKED_TICKERS_STORAGE_KEY);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return sanitizeTrackedTickersList(parsed, tapeSymbols);
      }
    }
  } catch {
    // ignore storage errors
  }
  return [...defaultTickers];
}

export function savePersistedTrackedTickers(
  storage: Pick<StorageLike, 'setItem'> | null | undefined,
  tickers: readonly string[]
): void {
  if (!storage) return;
  try {
    storage.setItem(TRACKED_TICKERS_STORAGE_KEY, JSON.stringify(tickers));
  } catch {
    // ignore storage errors
  }
}

export interface EquitySearchResolution {
  accepted: boolean;
  symbol: string;
  stock?: StockData;
  quote?: Record<string, unknown>;
  isInvalidTicker?: boolean;
  error?: string;
}

/**
 * Fetches quote + security metadata for a searched ticker and validates whether
 * it represents a legitimate, identifiable security before updating tracked state.
 */
export async function resolveEquitySearch(
  rawSymbol: string,
  fetchFn?: typeof fetch,
  existingStock?: StockData
): Promise<EquitySearchResolution> {
  const sym = normalizeTickerSymbol(rawSymbol);
  if (!isValidTickerFormat(sym)) {
    return {
      accepted: false,
      symbol: sym,
      isInvalidTicker: true,
      error: 'Invalid ticker format.',
    };
  }

  try {
    const url = `/api/alpha-vantage/quote?symbol=${encodeURIComponent(sym)}&force=true`;
    // Always invoke fetch with globalThis as receiver so browser Window.fetch never throws Illegal invocation
    const response = fetchFn
      ? await fetchFn.call(globalThis, url)
      : await globalThis.fetch(url);

    if (!response.ok) {
      return {
        accepted: false,
        symbol: sym,
        isInvalidTicker: response.status === 404,
        error: `Quote request returned HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    if (!isValidQuotePayload(data, sym)) {
      return {
        accepted: false,
        symbol: sym,
        isInvalidTicker: Boolean(data?.isInvalidTicker || data?.success === false),
        error:
          (typeof data?.error === 'string' && data.error) ||
          `No valid equity found for symbol "${sym}".`,
      };
    }

    const stock = buildStockDataFromQuote(data.quote, existingStock);
    return {
      accepted: true,
      symbol: stock.symbol,
      stock,
      quote: data.quote,
    };
  } catch (err: any) {
    return {
      accepted: false,
      symbol: sym,
      isInvalidTicker: false,
      error: err?.message || `Failed to validate symbol "${sym}".`,
    };
  }
}

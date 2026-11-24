export const POLYMARKET_TICKERS_STORAGE_KEY = 'quorix_polymarket_ticker_filter_v1';
export const MAX_POLYMARKET_TICKERS = 10;

export const DEFAULT_POLYMARKET_TICKERS: readonly string[] = [
  'AAPL',
  'NVDA',
  'TSLA',
  'MSFT',
  'GOOG',
  'AMZN',
  'META',
];

const TICKER_FORMAT_REGEX = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

/**
 * Trims surrounding whitespace and converts a ticker symbol to uppercase.
 */
export function normalizePolymarketTicker(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase();
}

/**
 * Sanitizes an arbitrary ticker list: trims, uppercases, removes empty/invalid
 * entries and duplicates, and enforces the 10-ticker maximum.
 */
export function sanitizePolymarketTickerList(items: unknown): string[] {
  if (!Array.isArray(items)) return [...DEFAULT_POLYMARKET_TICKERS];

  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const raw of items) {
    if (typeof raw !== 'string') continue;
    const normalized = normalizePolymarketTicker(raw);
    if (!normalized || !TICKER_FORMAT_REGEX.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    cleaned.push(normalized);
    if (cleaned.length >= MAX_POLYMARKET_TICKERS) break;
  }

  return cleaned;
}

/**
 * Loads the persisted Polymarket Screener ticker list from storage.
 * Returns the default list (without WULF) for new users or invalid storage payloads.
 */
export function loadPolymarketTickers(
  storage?: Pick<Storage, 'getItem'> | null,
): string[] {
  if (!storage) return [...DEFAULT_POLYMARKET_TICKERS];
  try {
    const raw = storage.getItem(POLYMARKET_TICKERS_STORAGE_KEY);
    if (raw === null) return [...DEFAULT_POLYMARKET_TICKERS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_POLYMARKET_TICKERS];
    return sanitizePolymarketTickerList(parsed);
  } catch {
    return [...DEFAULT_POLYMARKET_TICKERS];
  }
}

/**
 * Persists a sanitized Polymarket Screener ticker list to storage.
 */
export function savePolymarketTickers(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  tickers: string[],
): string[] {
  const sanitized = sanitizePolymarketTickerList(tickers);
  if (storage) {
    try {
      storage.setItem(POLYMARKET_TICKERS_STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
      // Ignore storage quota or private-mode errors
    }
  }
  return sanitized;
}

export interface AddTickerResult {
  tickers: string[];
  error: string | null;
  added?: string;
}

/**
 * Validates and appends a ticker symbol to the draft list, enforcing:
 * - uppercase normalization and whitespace trimming
 * - non-empty and valid ticker characters
 * - no duplicates
 * - strict 10-ticker maximum
 */
export function addPolymarketTicker(
  current: string[],
  rawInput: string,
): AddTickerResult {
  const sanitizedCurrent = sanitizePolymarketTickerList(current);
  const normalized = normalizePolymarketTicker(rawInput);

  if (!normalized) {
    return {
      tickers: sanitizedCurrent,
      error: 'Enter a ticker symbol.',
    };
  }

  if (!TICKER_FORMAT_REGEX.test(normalized)) {
    return {
      tickers: sanitizedCurrent,
      error: "Use letters, numbers, '.' or '-' (max 12 chars).",
    };
  }

  if (sanitizedCurrent.includes(normalized)) {
    return {
      tickers: sanitizedCurrent,
      error: `${normalized} is already in the list.`,
    };
  }

  if (sanitizedCurrent.length >= MAX_POLYMARKET_TICKERS) {
    return {
      tickers: sanitizedCurrent,
      error: `Maximum of ${MAX_POLYMARKET_TICKERS} tickers reached. Remove one to add another.`,
    };
  }

  return {
    tickers: [...sanitizedCurrent, normalized],
    error: null,
    added: normalized,
  };
}

/**
 * Removes a ticker symbol from the draft list.
 */
export function removePolymarketTicker(current: string[], ticker: string): string[] {
  const target = normalizePolymarketTicker(ticker);
  return current.filter((item) => normalizePolymarketTicker(item) !== target);
}

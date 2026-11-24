import type { StockData } from '../types';

export type HistoricalPriceBar = StockData['history'][number] & {
  isMarketCloseSnapshot?: boolean;
};

export interface AlphaVantageIntradayParseResult {
  bars: HistoricalPriceBar[];
  rateLimited: boolean;
  premiumRestricted: boolean;
  notice: string | null;
  errorMessage: string | null;
}

/**
 * Identifies legitimate exchange market-closing price snapshots emitted by Yahoo Finance
 * at 16:00 ET (open === high === low === close with zero interval volume, because regular
 * 15:30-16:00 trading volume is already recorded in the 15:30 hourly bar).
 */
export function isClosingPriceSnapshotBar(bar: {
  date?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}): boolean {
  if (!bar) return false;
  const isFlat =
    Number.isFinite(bar.open) &&
    bar.open === bar.high &&
    bar.high === bar.low &&
    bar.low === bar.close;
  if (!isFlat || bar.volume !== 0) return false;
  return typeof bar.date === 'string' && /(?:^|\s)16:00(?::00)?$/.test(bar.date.trim());
}

/**
 * Formats a Unix timestamp (seconds) in US Eastern Time for the Historical Price hourly log.
 * Includes the 2-digit year when records span multiple calendar years so dates stay unambiguous.
 */
export function formatHistoricalHourlyTimestamp(tsSeconds: number, includeYear: boolean): string {
  const date = new Date(tsSeconds * 1000);
  const md = date.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
    ...(includeYear ? { year: '2-digit' as const } : {}),
  });
  const hm = date.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${md} ${hm}`;
}

/**
 * Deduplicates historical bars by timestamp (or formatted date fallback) and returns
 * them strictly ordered newest-first. When duplicate timestamps occur, prefers the record
 * with higher positive volume so legitimate trading bars are never overwritten by zero-volume duplicates.
 */
export function deduplicateAndSortHistoricalBars(
  bars: HistoricalPriceBar[]
): HistoricalPriceBar[] {
  if (!Array.isArray(bars) || bars.length === 0) return [];

  const byKey = new Map<string, HistoricalPriceBar>();
  for (const bar of bars) {
    if (
      !bar ||
      typeof bar.open !== 'number' ||
      typeof bar.high !== 'number' ||
      typeof bar.low !== 'number' ||
      typeof bar.close !== 'number' ||
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close)
    ) {
      continue;
    }

    const ts = typeof bar.timestamp === 'number' && Number.isFinite(bar.timestamp) ? bar.timestamp : 0;
    const key = ts > 0 ? `ts:${ts}` : `dt:${bar.date}`;
    const normalized: HistoricalPriceBar = {
      ...bar,
      timestamp: ts,
      volume: typeof bar.volume === 'number' && Number.isFinite(bar.volume) ? bar.volume : 0,
      isMarketCloseSnapshot:
        bar.isMarketCloseSnapshot ?? isClosingPriceSnapshotBar(bar),
    };

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, normalized);
    } else if (normalized.volume > existing.volume) {
      byKey.set(key, normalized);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const tsA = typeof a.timestamp === 'number' ? a.timestamp : 0;
    const tsB = typeof b.timestamp === 'number' ? b.timestamp : 0;
    if (tsA !== tsB) return tsB - tsA;
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
}

/**
 * Counts distinct US Eastern trading dates represented in a historical bar list.
 */
export function countDistinctTradingDays(bars: HistoricalPriceBar[]): number {
  if (!Array.isArray(bars) || bars.length === 0) return 0;
  const days = new Set<string>();
  for (const bar of bars) {
    if (typeof bar.timestamp === 'number' && bar.timestamp > 0) {
      const dayKey = new Date(bar.timestamp * 1000).toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      days.add(dayKey);
    } else if (typeof bar.date === 'string' && bar.date.trim()) {
      days.add(bar.date.trim().split(' ')[0]);
    }
  }
  return days.size;
}

/**
 * Parses an Alpha Vantage US Eastern timestamp string ("YYYY-MM-DD HH:mm:ss")
 * into Unix epoch seconds accurately accounting for EST (-05:00) vs EDT (-04:00).
 */
export function parseEasternTimestampToSeconds(raw: string): number {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return 0;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || '0');

  // Approximate UTC then refine offset using America/New_York wall-clock check
  const guessUtcMs = Date.UTC(year, month - 1, day, hour + 5, minute, second);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(guessUtcMs));

  const renderedHour = Number(parts.find((p) => p.type === 'hour')?.value ?? hour);
  const deltaHours = renderedHour - hour;
  let adjustedMs = guessUtcMs;
  if (deltaHours === 1 || deltaHours === -23) {
    // Daylight saving time (EDT = UTC-4, so UTC is 1 hour earlier than EST guess)
    adjustedMs = guessUtcMs - 3600_000;
  } else if (deltaHours === -1 || deltaHours === 23) {
    adjustedMs = guessUtcMs + 3600_000;
  }
  return Math.floor(adjustedMs / 1000);
}

/**
 * Parses Alpha Vantage TIME_SERIES_INTRADAY (60min) payload into normalized,
 * deduplicated, newest-first HistoricalPriceBar entries while identifying rate-limit
 * or premium subscription notices cleanly.
 */
export function parseAlphaVantageIntradayBars(rawPayload: any): AlphaVantageIntradayParseResult {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return {
      bars: [],
      rateLimited: false,
      premiumRestricted: false,
      notice: null,
      errorMessage: 'Empty Alpha Vantage response.',
    };
  }

  const noticeText =
    typeof rawPayload.Information === 'string'
      ? rawPayload.Information
      : typeof rawPayload.Note === 'string'
      ? rawPayload.Note
      : null;

  const errorMessage =
    typeof rawPayload['Error Message'] === 'string' ? rawPayload['Error Message'] : null;

  const premiumRestricted = Boolean(
    noticeText && /premium|subscription|paid|outputsize/i.test(noticeText)
  );
  const rateLimited = Boolean(
    noticeText && /rate limit|25 requests|per day|per minute|higher api call frequency/i.test(noticeText)
  );

  const seriesKey = Object.keys(rawPayload).find((k) => /^Time Series \(\d+min\)$/i.test(k));
  const series = seriesKey ? rawPayload[seriesKey] : null;
  if (!series || typeof series !== 'object') {
    return {
      bars: [],
      rateLimited,
      premiumRestricted,
      notice: noticeText,
      errorMessage,
    };
  }

  const rawEntries = Object.entries(series);
  const years = new Set<string>();
  for (const [tsStr] of rawEntries) {
    const y = tsStr.slice(0, 4);
    if (/^\d{4}$/.test(y)) years.add(y);
  }
  const includeYear = years.size > 1;

  const parsed: HistoricalPriceBar[] = [];
  for (const [tsStr, row] of rawEntries) {
    const rec = row as Record<string, string>;
    const open = parseFloat(rec?.['1. open']);
    const high = parseFloat(rec?.['2. high']);
    const low = parseFloat(rec?.['3. low']);
    const close = parseFloat(rec?.['4. close']);
    const volume = parseInt(rec?.['5. volume'] || '0', 10);
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }

    const timestamp = parseEasternTimestampToSeconds(tsStr);
    const formattedDate =
      timestamp > 0
        ? formatHistoricalHourlyTimestamp(timestamp, includeYear)
        : tsStr.slice(0, 16);

    const bar: HistoricalPriceBar = {
      date: formattedDate,
      timestamp,
      open: parseFloat(open.toFixed(3)),
      high: parseFloat(high.toFixed(3)),
      low: parseFloat(low.toFixed(3)),
      close: parseFloat(close.toFixed(3)),
      volume: Number.isFinite(volume) && volume >= 0 ? volume : 0,
    };
    bar.isMarketCloseSnapshot = isClosingPriceSnapshotBar(bar);
    parsed.push(bar);
  }

  return {
    bars: deduplicateAndSortHistoricalBars(parsed),
    rateLimited,
    premiumRestricted,
    notice: noticeText,
    errorMessage,
  };
}

/**
 * Selects the richer non-empty historical bar set so a transient incomplete response
 * never silently replaces valid historical data already held for the same symbol.
 */
export function selectBestHistoricalBars(
  incoming: HistoricalPriceBar[],
  existing: HistoricalPriceBar[]
): HistoricalPriceBar[] {
  const cleanIncoming = deduplicateAndSortHistoricalBars(incoming);
  const cleanExisting = deduplicateAndSortHistoricalBars(existing);
  if (cleanIncoming.length === 0) return cleanExisting;
  if (cleanExisting.length === 0) return cleanIncoming;
  // Never downgrade a richer historical dataset to a severely truncated response
  if (cleanIncoming.length < cleanExisting.length && cleanIncoming.length <= 20) {
    return cleanExisting;
  }
  return cleanIncoming;
}

export interface AlphaVantageEarningsParseResult {
  reportedDates: string[];
  rateLimited: boolean;
  premiumRestricted: boolean;
  notice: string | null;
  errorMessage: string | null;
}

/**
 * Validates that a string is a real ISO calendar date in YYYY-MM-DD format.
 */
export function isValidIsoCalendarDate(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

/**
 * Parses Alpha Vantage EARNINGS API payloads and extracts validated quarterly
 * `reportedDate` strings (YYYY-MM-DD), strictly ignoring `fiscalDateEnding`
 * and `annualEarnings`.
 */
export function parseAlphaVantageEarningsDates(
  rawPayload: unknown
): AlphaVantageEarningsParseResult {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return {
      reportedDates: [],
      rateLimited: false,
      premiumRestricted: false,
      notice: null,
      errorMessage: 'Empty Alpha Vantage earnings response.',
    };
  }

  const payload = rawPayload as Record<string, unknown>;
  const noticeText =
    typeof payload.Information === 'string'
      ? payload.Information
      : typeof payload.Note === 'string'
      ? payload.Note
      : null;

  const errorMessage =
    typeof payload['Error Message'] === 'string' ? payload['Error Message'] : null;

  const premiumRestricted = Boolean(
    noticeText && /premium|subscription|paid/i.test(noticeText)
  );
  const rateLimited = Boolean(
    noticeText && /rate limit|25 requests|per day|per minute|higher api call frequency/i.test(noticeText)
  );

  const quarterly = payload.quarterlyEarnings;
  if (!Array.isArray(quarterly)) {
    return {
      reportedDates: [],
      rateLimited,
      premiumRestricted,
      notice: noticeText,
      errorMessage,
    };
  }

  const uniqueDates = new Set<string>();
  for (const record of quarterly) {
    if (!record || typeof record !== 'object') continue;
    const rawReportedDate = (record as Record<string, unknown>).reportedDate;
    if (isValidIsoCalendarDate(rawReportedDate)) {
      uniqueDates.add(rawReportedDate.trim());
    }
  }

  return {
    reportedDates: Array.from(uniqueDates).sort((a, b) => b.localeCompare(a)),
    rateLimited,
    premiumRestricted,
    notice: noticeText,
    errorMessage,
  };
}

/**
 * Derives the US Eastern Time (America/New_York) calendar date (YYYY-MM-DD) for a
 * Historical Price Log bar using the same timezone convention as timestamp display
 * and trading-day counting. Never fabricates a year if none is present.
 */
export function getHistoricalBarEasternIsoDate(
  bar: Pick<HistoricalPriceBar, 'timestamp' | 'date'>
): string | null {
  if (!bar) return null;

  if (typeof bar.timestamp === 'number' && Number.isFinite(bar.timestamp) && bar.timestamp > 0) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(bar.timestamp * 1000));

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) {
      const iso = `${year}-${month}-${day}`;
      return isValidIsoCalendarDate(iso) ? iso : null;
    }
  }

  if (typeof bar.date === 'string') {
    const trimmed = bar.date.trim();
    const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:\b|\s|$)/);
    if (isoMatch && isValidIsoCalendarDate(isoMatch[1])) {
      return isoMatch[1];
    }

    const usWithYearMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s|$)/);
    if (usWithYearMatch) {
      const month = usWithYearMatch[1].padStart(2, '0');
      const day = usWithYearMatch[2].padStart(2, '0');
      const rawYear = usWithYearMatch[3];
      const fullYear = rawYear.length === 2 ? `20${rawYear}` : rawYear;
      const iso = `${fullYear}-${month}-${day}`;
      return isValidIsoCalendarDate(iso) ? iso : null;
    }
  }

  return null;
}

/**
 * Returns the subset of earnings `reportedDate` values (YYYY-MM-DD) that match
 * actual trading dates present in the displayed Historical Price Log bars.
 */
export function matchEarningsDatesToBars(
  reportedDates: readonly string[],
  bars: readonly HistoricalPriceBar[]
): Set<string> {
  const matched = new Set<string>();
  if (!Array.isArray(reportedDates) || reportedDates.length === 0) return matched;
  if (!Array.isArray(bars) || bars.length === 0) return matched;

  const reportedSet = new Set<string>();
  for (const dateStr of reportedDates) {
    if (isValidIsoCalendarDate(dateStr)) {
      reportedSet.add(dateStr.trim());
    }
  }
  if (reportedSet.size === 0) return matched;

  for (const bar of bars) {
    const barIso = getHistoricalBarEasternIsoDate(bar);
    if (barIso && reportedSet.has(barIso)) {
      matched.add(barIso);
    }
  }

  return matched;
}


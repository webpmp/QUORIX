import type {
  CentralBankPolicyRate,
  CurrencyPair,
  FxObservation,
  FxPairHistory,
  FxTimeframeId,
  FxUsdIndexSeries,
  MajorCurrencyCode,
  MonetaryPolicyDirection,
} from '../types';

export const MAJOR_CURRENCIES: readonly MajorCurrencyCode[] = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
] as const;

/** Canonical map of currency aliases, names, and nicknames to canonical ISO 4217 code. */
export const CURRENCY_ALIAS_MAP: Record<string, MajorCurrencyCode> = {
  // USD
  USD: 'USD',
  'US DOLLAR': 'USD',
  'U.S. DOLLAR': 'USD',
  DOLLAR: 'USD',
  DOLLARS: 'USD',
  GREENBACK: 'USD',
  BUCKS: 'USD',

  // EUR
  EUR: 'EUR',
  EURO: 'EUR',
  EUROS: 'EUR',

  // GBP
  GBP: 'GBP',
  'BRITISH POUND': 'GBP',
  'GREAT BRITISH POUND': 'GBP',
  POUND: 'GBP',
  POUNDS: 'GBP',
  STERLING: 'GBP',
  CABLE: 'GBP',
  QUID: 'GBP',

  // JPY
  JPY: 'JPY',
  'JAPANESE YEN': 'JPY',
  YEN: 'JPY',

  // AUD
  AUD: 'AUD',
  'AUSTRALIAN DOLLAR': 'AUD',
  AUSSIE: 'AUD',

  // CAD
  CAD: 'CAD',
  'CANADIAN DOLLAR': 'CAD',
  LOONIE: 'CAD',

  // CHF (Swiss Franc - mapped to CHF / handled gracefully)
  CHF: 'CHF' as MajorCurrencyCode,
  'SWISS FRANC': 'CHF' as MajorCurrencyCode,
  FRANC: 'CHF' as MajorCurrencyCode,
  SWISSIE: 'CHF' as MajorCurrencyCode,

  // NZD (New Zealand Dollar - mapped to NZD / handled gracefully)
  NZD: 'NZD' as MajorCurrencyCode,
  'NEW ZEALAND DOLLAR': 'NZD' as MajorCurrencyCode,
  KIWI: 'NZD' as MajorCurrencyCode,
};

/**
 * Normalizes user input into a canonical ISO 4217 3-letter currency code.
 * Returns null if unrecognized.
 */
export function normalizeCurrencyCode(input: string): string | null {
  if (!input) return null;
  const cleaned = input
    .toUpperCase()
    .replace(/[()]/g, ' ')
    .replace(/[^A-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!cleaned) return null;
  if (CURRENCY_ALIAS_MAP[cleaned]) {
    return CURRENCY_ALIAS_MAP[cleaned];
  }
  // Check if it's already an ISO code in uppercase
  if (/^[A-Z]{3}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

export interface FxCurrencyMetadata {
  code: MajorCurrencyCode;
  name: string;
  symbol: string;
  pairLabel: string;
  seriesId: string;
  /** True when the FRED H.10 pair is quoted as USD per 1 unit of foreign currency (EUR/USD, GBP/USD, AUD/USD). */
  isDirectUsdQuote: boolean;
  quoteDecimals: number;
}

export const FX_CURRENCY_META: Record<MajorCurrencyCode, FxCurrencyMetadata> = {
  USD: {
    code: 'USD',
    name: 'U.S. Dollar',
    symbol: '$',
    pairLabel: 'BROAD USD INDEX',
    seriesId: 'DTWEXBGS',
    isDirectUsdQuote: true,
    quoteDecimals: 2,
  },
  EUR: {
    code: 'EUR',
    name: 'Euro',
    symbol: '€',
    pairLabel: 'EUR/USD',
    seriesId: 'DEXUSEU',
    isDirectUsdQuote: true,
    quoteDecimals: 4,
  },
  GBP: {
    code: 'GBP',
    name: 'British Pound',
    symbol: '£',
    pairLabel: 'GBP/USD',
    seriesId: 'DEXUSUK',
    isDirectUsdQuote: true,
    quoteDecimals: 4,
  },
  JPY: {
    code: 'JPY',
    name: 'Japanese Yen',
    symbol: '¥',
    pairLabel: 'USD/JPY',
    seriesId: 'DEXJPUS',
    isDirectUsdQuote: false,
    quoteDecimals: 2,
  },
  AUD: {
    code: 'AUD',
    name: 'Australian Dollar',
    symbol: 'A$',
    pairLabel: 'AUD/USD',
    seriesId: 'DEXUSAL',
    isDirectUsdQuote: true,
    quoteDecimals: 4,
  },
  CAD: {
    code: 'CAD',
    name: 'Canadian Dollar',
    symbol: 'C$',
    pairLabel: 'USD/CAD',
    seriesId: 'DEXCAUS',
    isDirectUsdQuote: false,
    quoteDecimals: 4,
  },
};

export interface FxTimeframeOption {
  id: FxTimeframeId;
  label: string;
  calendarDays: number;
}

export const FX_TIMEFRAMES: readonly FxTimeframeOption[] = [
  { id: '1W', label: '1W', calendarDays: 7 },
  { id: '1M', label: '1M', calendarDays: 30 },
  { id: '3M', label: '3M', calendarDays: 90 },
  { id: '6M', label: '6M', calendarDays: 180 },
  { id: '1Y', label: '1Y', calendarDays: 365 },
  { id: '5Y', label: '5Y', calendarDays: 1826 },
] as const;

export type CurrencyTrendLabel = 'Strengthening' | 'Weakening' | 'Mixed' | 'Unavailable';

export interface CurrencyPerformanceRow {
  code: MajorCurrencyCode;
  name: string;
  symbol: string;
  pairLabel: string;
  seriesId: string;
  isDirectUsdQuote: boolean;
  isIndexMetric: boolean;
  /** Latest quoted market rate (e.g. 1.0842 for EUR/USD, 154.25 for USD/JPY, or Broad USD Index level for USD). */
  latestQuotedRate: number | null;
  latestDate: string | null;
  previousDate: string | null;
  /** Daily % change in the currency's own strength (vs USD for non-USD; trade-weighted index for USD). */
  dailyPct: number | null;
  /** Weekly % change (~7 calendar days prior actual observation, no interpolation). */
  weeklyPct: number | null;
  /** Monthly % change (~30 calendar days prior actual observation, no interpolation). */
  monthlyPct: number | null;
  /** Composite strength score (weighted recent performance) used purely for visual trend bar scaling. */
  trendScore: number | null;
  trend: CurrencyTrendLabel;
  referenceNote: string;
}

export interface HistoricalFxTrendSummary {
  points: FxObservation[];
  latestRate: number | null;
  latestDate: string | null;
  periodOpen: number | null;
  periodOpenDate: string | null;
  periodClose: number | null;
  periodCloseDate: string | null;
  periodHigh: number | null;
  periodHighDate: string | null;
  periodLow: number | null;
  periodLowDate: string | null;
  periodChangeAbs: number | null;
  periodChangePct: number | null;
  observationCount: number;
}

export interface CrossRateCell {
  base: MajorCurrencyCode;
  quote: MajorCurrencyCode;
  rate: number | null;
  isDiagonal: boolean;
  decimals: number;
}

export interface CrossRateMatrixResult {
  currencies: readonly MajorCurrencyCode[];
  rows: Record<MajorCurrencyCode, Record<MajorCurrencyCode, CrossRateCell>>;
  latestObservationDate: string | null;
  availableCount: number;
}

export interface CentralBankMeta {
  currency: MajorCurrencyCode;
  bisArea: string;
  centralBank: string;
  shortName: string;
  rateLabel: string;
  fredFallbackSeriesId: string;
}

export const CENTRAL_BANK_DIRECTORY: readonly CentralBankMeta[] = [
  {
    currency: 'USD',
    bisArea: 'US',
    centralBank: 'Federal Reserve',
    shortName: 'Fed',
    rateLabel: 'Fed Funds Target (Midpoint)',
    fredFallbackSeriesId: 'DFEDTARU',
  },
  {
    currency: 'EUR',
    bisArea: 'XM',
    centralBank: 'European Central Bank',
    shortName: 'ECB',
    rateLabel: 'ECB Policy / Deposit Rate',
    fredFallbackSeriesId: 'ECBDFR',
  },
  {
    currency: 'GBP',
    bisArea: 'GB',
    centralBank: 'Bank of England',
    shortName: 'BoE',
    rateLabel: 'Official Bank Rate',
    fredFallbackSeriesId: 'IRSTCI01GBM156N',
  },
  {
    currency: 'JPY',
    bisArea: 'JP',
    centralBank: 'Bank of Japan',
    shortName: 'BoJ',
    rateLabel: 'Uncollateralized Overnight Call Rate',
    fredFallbackSeriesId: 'IRSTCB01JPM156N',
  },
  {
    currency: 'AUD',
    bisArea: 'AU',
    centralBank: 'Reserve Bank of Australia',
    shortName: 'RBA',
    rateLabel: 'Cash Rate Target',
    fredFallbackSeriesId: 'IRSTCI01AUM156N',
  },
  {
    currency: 'CAD',
    bisArea: 'CA',
    centralBank: 'Bank of Canada',
    shortName: 'BoC',
    rateLabel: 'Target for the Overnight Rate',
    fredFallbackSeriesId: 'IRSTCB01CAM156N',
  },
] as const;

/**
 * Pure UTC ISO calendar date shift (YYYY-MM-DD +/- calendarDays).
 * Avoids local timezone / DST offsets.
 */
export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const shifted = new Date(utc + deltaDays * 86_400_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Difference in calendar days between two YYYY-MM-DD dates (laterDate - earlierDate).
 */
export function diffIsoDays(earlierDate: string, laterDate: string): number {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(earlierDate);
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(laterDate);
  if (!m1 || !m2) return 0;
  const t1 = Date.UTC(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
  const t2 = Date.UTC(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
  return Math.round((t2 - t1) / 86_400_000);
}

/**
 * Normalizes and sorts raw observations chronologically (oldest -> newest),
 * dropping non-finite values and deduplicating by date (retaining last valid observation).
 */
export function normalizeObservations(observations: FxObservation[]): FxObservation[] {
  const byDate = new Map<string, number>();
  for (const obs of observations) {
    if (!obs || typeof obs.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obs.date)) continue;
    if (typeof obs.value !== 'number' || !Number.isFinite(obs.value) || obs.value <= 0) continue;
    byDate.set(obs.date, obs.value);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
}

/**
 * Normalizes policy rate observations (values may be <= 0, e.g., historical negative policy rates).
 */
export function normalizePolicyObservations(observations: FxObservation[]): FxObservation[] {
  const byDate = new Map<string, number>();
  for (const obs of observations) {
    if (!obs || typeof obs.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obs.date)) continue;
    if (typeof obs.value !== 'number' || !Number.isFinite(obs.value)) continue;
    byDate.set(obs.date, obs.value);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
}

/**
 * Finds the latest actual observation whose date is <= targetDate (no interpolation).
 */
export function findObservationOnOrBefore(
  sortedAsc: FxObservation[],
  targetDate: string
): FxObservation | null {
  let lo = 0;
  let hi = sortedAsc.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid].date <= targetDate) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? sortedAsc[best] : null;
}

/**
 * Converts a raw FX observation value into USD value per 1 unit of the foreign currency.
 * - Direct quotes (EUR/USD, GBP/USD, AUD/USD): already USD per 1 foreign unit -> value
 * - Inverse quotes (USD/JPY, USD/CAD): foreign units per 1 USD -> 1 / value
 */
export function toUsdPerForeignUnit(quotedRate: number, isDirectUsdQuote: boolean): number | null {
  if (!Number.isFinite(quotedRate) || quotedRate <= 0) return null;
  return isDirectUsdQuote ? quotedRate : 1 / quotedRate;
}

/**
 * Computes percentage change between two positive values: ((end - start) / start) * 100.
 */
export function computePctChange(startValue: number | null, endValue: number | null): number | null {
  if (
    startValue === null ||
    endValue === null ||
    !Number.isFinite(startValue) ||
    !Number.isFinite(endValue) ||
    startValue <= 0
  ) {
    return null;
  }
  return ((endValue - startValue) / startValue) * 100;
}

/**
 * Computes Daily, Weekly, and Monthly percentage strength changes from actual observations.
 * - For foreign currencies: measures appreciation (+) or depreciation (-) of 1 unit of that currency vs USD.
 * - For direct series (EUR/USD, GBP/USD, AUD/USD) and the Broad USD Index (DTWEXBGS):
 *   set isDirectUsdQuote = true so increases are positive (+).
 * - For inverse series (USD/JPY, USD/CAD):
 *   set isDirectUsdQuote = false so rate increases (stronger USD / weaker foreign currency) map to negative (-).
 */
export function computeCurrencyPeriodChanges(
  rawObservations: FxObservation[],
  isDirectUsdQuote: boolean
): {
  latestQuotedRate: number | null;
  latestDate: string | null;
  previousDate: string | null;
  dailyPct: number | null;
  weeklyPct: number | null;
  monthlyPct: number | null;
} {
  const sorted = normalizeObservations(rawObservations);
  if (sorted.length === 0) {
    return {
      latestQuotedRate: null,
      latestDate: null,
      previousDate: null,
      dailyPct: null,
      weeklyPct: null,
      monthlyPct: null,
    };
  }

  const latest = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const weekBase = findObservationOnOrBefore(sorted, shiftIsoDate(latest.date, -7));
  const monthBase = findObservationOnOrBefore(sorted, shiftIsoDate(latest.date, -30));

  const latestStrength = toUsdPerForeignUnit(latest.value, isDirectUsdQuote);
  const prevStrength = prev ? toUsdPerForeignUnit(prev.value, isDirectUsdQuote) : null;
  const weekStrength =
    weekBase && weekBase.date < latest.date
      ? toUsdPerForeignUnit(weekBase.value, isDirectUsdQuote)
      : null;
  const monthStrength =
    monthBase && monthBase.date < latest.date
      ? toUsdPerForeignUnit(monthBase.value, isDirectUsdQuote)
      : null;

  return {
    latestQuotedRate: latest.value,
    latestDate: latest.date,
    previousDate: prev?.date ?? null,
    dailyPct: computePctChange(prevStrength, latestStrength),
    weeklyPct: computePctChange(weekStrength, latestStrength),
    monthlyPct: computePctChange(monthStrength, latestStrength),
  };
}

function classifyCurrencyTrend(
  dailyPct: number | null,
  weeklyPct: number | null,
  monthlyPct: number | null
): { trend: CurrencyTrendLabel; score: number | null } {
  const available = [dailyPct, weeklyPct, monthlyPct].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  );
  if (available.length === 0) {
    return { trend: 'Unavailable', score: null };
  }

  // Deterministic composite across available horizons (favoring medium-term direction)
  const wDaily = dailyPct !== null ? dailyPct * 0.2 : 0;
  const wWeekly = weeklyPct !== null ? weeklyPct * 0.35 : 0;
  const wMonthly = monthlyPct !== null ? monthlyPct * 0.45 : 0;
  const totalWeight =
    (dailyPct !== null ? 0.2 : 0) +
    (weeklyPct !== null ? 0.35 : 0) +
    (monthlyPct !== null ? 0.45 : 0);
  const score = totalWeight > 0 ? (wDaily + wWeekly + wMonthly) / totalWeight : 0;

  if (score > 0.15) return { trend: 'Strengthening', score };
  if (score < -0.15) return { trend: 'Weakening', score };
  return { trend: 'Mixed', score };
}

/**
 * Builds the 6-currency Overview & Performance dataset from real FRED H.10 pair histories
 * and the Federal Reserve Broad U.S. Dollar Index (DTWEXBGS).
 */
export function buildCurrencyPerformanceRows(
  pairHistories: FxPairHistory[],
  usdIndex: FxUsdIndexSeries | null
): CurrencyPerformanceRow[] {
  const bySeries = new Map<string, FxPairHistory>();
  for (const history of pairHistories) {
    bySeries.set(history.seriesId.toUpperCase(), history);
  }

  return MAJOR_CURRENCIES.map((code) => {
    const meta = FX_CURRENCY_META[code];

    if (code === 'USD') {
      const obs = usdIndex?.observations ?? [];
      const stats = computeCurrencyPeriodChanges(obs, true);
      const { trend, score } = classifyCurrencyTrend(
        stats.dailyPct,
        stats.weeklyPct,
        stats.monthlyPct
      );
      return {
        code,
        name: meta.name,
        symbol: meta.symbol,
        pairLabel: 'USD BROAD IDX',
        seriesId: usdIndex?.seriesId || meta.seriesId,
        isDirectUsdQuote: true,
        isIndexMetric: true,
        latestQuotedRate: stats.latestQuotedRate,
        latestDate: stats.latestDate,
        previousDate: stats.previousDate,
        dailyPct: stats.dailyPct,
        weeklyPct: stats.weeklyPct,
        monthlyPct: stats.monthlyPct,
        trendScore: score,
        trend,
        referenceNote: 'Federal Reserve Nominal Broad U.S. Dollar Index (FRED DTWEXBGS, Jan 2006 = 100)',
      };
    }

    const history = bySeries.get(meta.seriesId.toUpperCase());
    const stats = computeCurrencyPeriodChanges(history?.observations ?? [], meta.isDirectUsdQuote);
    const { trend, score } = classifyCurrencyTrend(
      stats.dailyPct,
      stats.weeklyPct,
      stats.monthlyPct
    );
    return {
      code,
      name: meta.name,
      symbol: meta.symbol,
      pairLabel: meta.pairLabel,
      seriesId: meta.seriesId,
      isDirectUsdQuote: meta.isDirectUsdQuote,
      isIndexMetric: false,
      latestQuotedRate: stats.latestQuotedRate,
      latestDate: stats.latestDate,
      previousDate: stats.previousDate,
      dailyPct: stats.dailyPct,
      weeklyPct: stats.weeklyPct,
      monthlyPct: stats.monthlyPct,
      trendScore: score,
      trend,
      referenceNote: meta.isDirectUsdQuote
        ? `${meta.pairLabel} direct quote (USD per 1 ${code})`
        : `${meta.pairLabel} inverse quote (${code} per 1 USD); performance inverted to reflect ${code} vs USD`,
    };
  });
}

/**
 * Filters real historical observations for a selected timeframe without interpolating missing dates,
 * and computes latest, open, close, high, low, and percentage change over the timeframe.
 */
export function computeHistoricalFxTrend(
  rawObservations: FxObservation[],
  timeframe: FxTimeframeId
): HistoricalFxTrendSummary {
  const sorted = normalizeObservations(rawObservations);
  if (sorted.length === 0) {
    return {
      points: [],
      latestRate: null,
      latestDate: null,
      periodOpen: null,
      periodOpenDate: null,
      periodClose: null,
      periodCloseDate: null,
      periodHigh: null,
      periodHighDate: null,
      periodLow: null,
      periodLowDate: null,
      periodChangeAbs: null,
      periodChangePct: null,
      observationCount: 0,
    };
  }

  const tfConfig = FX_TIMEFRAMES.find((t) => t.id === timeframe) || FX_TIMEFRAMES[1];
  const latest = sorted[sorted.length - 1];
  const cutoffDate = shiftIsoDate(latest.date, -tfConfig.calendarDays);

  // Start at the last actual observation on or before cutoffDate (if available)
  // so short windows like 1W always anchor on a genuine starting observation.
  let startIdx = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].date <= cutoffDate) {
      startIdx = i;
      break;
    }
    startIdx = i;
  }

  const points = sorted.slice(startIdx);
  const first = points[0];
  const last = points[points.length - 1];

  let high = first.value;
  let highDate = first.date;
  let low = first.value;
  let lowDate = first.date;

  for (const pt of points) {
    if (pt.value > high) {
      high = pt.value;
      highDate = pt.date;
    }
    if (pt.value < low) {
      low = pt.value;
      lowDate = pt.date;
    }
  }

  const changeAbs = last.value - first.value;
  const changePct = computePctChange(first.value, last.value);

  return {
    points,
    latestRate: last.value,
    latestDate: last.date,
    periodOpen: first.value,
    periodOpenDate: first.date,
    periodClose: last.value,
    periodCloseDate: last.date,
    periodHigh: high,
    periodHighDate: highDate,
    periodLow: low,
    periodLowDate: lowDate,
    periodChangeAbs: changeAbs,
    periodChangePct: changePct,
    observationCount: points.length,
  };
}

/**
 * Determines standard FX desk decimal precision for a BASE/QUOTE pair.
 */
export function getCrossRateDecimals(base: MajorCurrencyCode, quote: MajorCurrencyCode): number {
  if (base === quote) return 2;
  if (quote === 'JPY') return 2;
  if (base === 'JPY') return 5;
  return 4;
}

/**
 * Builds the 6x6 Currency Cross Rates matrix (USD, EUR, GBP, JPY, AUD, CAD) strictly from
 * latest USD-based FRED H.10 observations.
 * Cell [base][quote] represents units of `quote` per 1 unit of `base` (BASE/QUOTE).
 * Guarantees:
 * - Diagonal [C][C] = 1.00
 * - Reciprocal consistency: [A][B] * [B][A] === 1
 */
export function buildCurrencyCrossRates(
  pairHistories: FxPairHistory[],
  fallbackCurrencies: CurrencyPair[] = []
): CrossRateMatrixResult {
  const usdPerUnit: Partial<Record<MajorCurrencyCode, number>> = { USD: 1 };
  let latestObservationDate: string | null = null;

  const trackDate = (d: string | null | undefined) => {
    if (d && (!latestObservationDate || d > latestObservationDate)) {
      latestObservationDate = d;
    }
  };

  for (const history of pairHistories) {
    const sorted = normalizeObservations(history.observations);
    if (sorted.length === 0) continue;
    const latest = sorted[sorted.length - 1];
    trackDate(latest.date);

    if (history.baseCurrency === 'USD' && history.quoteCurrency !== 'USD') {
      const val = toUsdPerForeignUnit(latest.value, false);
      if (val !== null) usdPerUnit[history.quoteCurrency] = val;
    } else if (history.quoteCurrency === 'USD' && history.baseCurrency !== 'USD') {
      const val = toUsdPerForeignUnit(latest.value, true);
      if (val !== null) usdPerUnit[history.baseCurrency] = val;
    }
  }

  // Fallback to existing CurrencyPair spot array if pairHistories has not finished loading
  for (const curr of fallbackCurrencies) {
    if (!curr || typeof curr.rate !== 'number' || !Number.isFinite(curr.rate) || curr.rate <= 0) {
      continue;
    }
    trackDate(curr.date);
    const parts = curr.pair.toUpperCase().split('/');
    if (parts.length !== 2) continue;
    const [base, quote] = parts as [MajorCurrencyCode, MajorCurrencyCode];
    if (base === 'USD' && MAJOR_CURRENCIES.includes(quote) && usdPerUnit[quote] === undefined) {
      const val = toUsdPerForeignUnit(curr.rate, false);
      if (val !== null) usdPerUnit[quote] = val;
    } else if (quote === 'USD' && MAJOR_CURRENCIES.includes(base) && usdPerUnit[base] === undefined) {
      const val = toUsdPerForeignUnit(curr.rate, true);
      if (val !== null) usdPerUnit[base] = val;
    }
  }

  const rows = {} as Record<MajorCurrencyCode, Record<MajorCurrencyCode, CrossRateCell>>;
  let availableCount = 0;

  for (const base of MAJOR_CURRENCIES) {
    rows[base] = {} as Record<MajorCurrencyCode, CrossRateCell>;
    for (const quote of MAJOR_CURRENCIES) {
      const decimals = getCrossRateDecimals(base, quote);
      if (base === quote) {
        rows[base][quote] = { base, quote, rate: 1, isDiagonal: true, decimals: 2 };
      } else {
        const baseUsd = usdPerUnit[base];
        const quoteUsd = usdPerUnit[quote];
        const rate =
          typeof baseUsd === 'number' &&
          typeof quoteUsd === 'number' &&
          baseUsd > 0 &&
          quoteUsd > 0
            ? baseUsd / quoteUsd
            : null;
        if (rate !== null) availableCount += 1;
        rows[base][quote] = { base, quote, rate, isDiagonal: false, decimals };
      }
    }
  }

  return {
    currencies: MAJOR_CURRENCIES,
    rows,
    latestObservationDate,
    availableCount,
  };
}

/**
 * Parses BIS SDMX `detail=dataonly&format=csv` response (`FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE`)
 * into per-area chronological observation arrays.
 */
export function parseBisPolicyCsv(csvText: string): Record<string, FxObservation[]> {
  const byArea: Record<string, FxObservation[]> = {};
  if (!csvText || typeof csvText !== 'string') return byArea;

  const lines = csvText.replace(/\r/g, '').split('\n');
  if (lines.length < 2) return byArea;

  const header = lines[0].split(',').map((h) => h.trim().toUpperCase());
  const areaIdx = header.indexOf('REF_AREA');
  const periodIdx = header.indexOf('TIME_PERIOD');
  const valueIdx = header.indexOf('OBS_VALUE');

  if (areaIdx < 0 || periodIdx < 0 || valueIdx < 0) return byArea;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length <= Math.max(areaIdx, periodIdx, valueIdx)) continue;

    const area = cols[areaIdx].trim().toUpperCase();
    const date = cols[periodIdx].trim();
    const val = parseFloat(cols[valueIdx].trim());
    if (!area || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(val)) continue;

    if (!byArea[area]) byArea[area] = [];
    byArea[area].push({ date, value: val });
  }

  for (const area of Object.keys(byArea)) {
    byArea[area] = normalizePolicyObservations(byArea[area]);
  }

  return byArea;
}

/**
 * Derives current policy rate, most recent rate decision (bps & effective date),
 * and monetary policy direction strictly from real policy rate observations.
 *
 * Direction rule:
 * - If the most recent policy rate change occurred within the past 180 calendar days
 *   of the latest observation, direction is 'Increasing' (delta > 0) or 'Decreasing' (delta < 0).
 * - If the rate has remained unchanged for more than 180 calendar days (or across the entire
 *   fetched observation window), direction is 'Unchanged'.
 */
export function deriveCentralBankPolicySummary(
  rawObservations: FxObservation[],
  meta: CentralBankMeta,
  source: string,
  seriesId: string
): CentralBankPolicyRate {
  const sorted = normalizePolicyObservations(rawObservations);
  const nextMeetingNote =
    'Official future policy meeting dates are not published in BIS/FRED policy rate feeds.';

  if (sorted.length === 0) {
    return {
      currency: meta.currency,
      centralBank: meta.centralBank,
      shortName: meta.shortName,
      rateLabel: meta.rateLabel,
      currentRate: null,
      previousRate: null,
      lastDecisionBps: null,
      lastDecisionLabel: null,
      lastDecisionDate: null,
      direction: 'Unavailable',
      nextMeetingDate: null,
      nextMeetingNote,
      latestObservationDate: null,
      source,
      seriesId,
      available: false,
      unavailableReason: 'Policy rate observations unavailable from feed.',
    };
  }

  const latest = sorted[sorted.length - 1];
  let changeIdx = -1;
  for (let i = sorted.length - 1; i >= 1; i--) {
    if (Math.abs(sorted[i].value - sorted[i - 1].value) > 1e-6) {
      changeIdx = i;
      break;
    }
  }

  let previousRate: number | null = null;
  let lastDecisionBps: number | null = null;
  let lastDecisionLabel: string | null = null;
  let lastDecisionDate: string | null = null;
  let direction: MonetaryPolicyDirection = 'Unchanged';

  if (changeIdx >= 1) {
    const prevVal = sorted[changeIdx - 1].value;
    const nextVal = sorted[changeIdx].value;
    const bps = Math.round((nextVal - prevVal) * 100);
    previousRate = prevVal;
    lastDecisionBps = bps;
    lastDecisionDate = sorted[changeIdx].date;

    if (bps > 0) {
      lastDecisionLabel = `Hike +${bps} bps`;
    } else if (bps < 0) {
      lastDecisionLabel = `Cut ${bps} bps`;
    } else {
      lastDecisionLabel = 'Unchanged';
    }

    const daysSinceChange = diffIsoDays(lastDecisionDate, latest.date);
    if (daysSinceChange <= 180) {
      direction = bps > 0 ? 'Increasing' : bps < 0 ? 'Decreasing' : 'Unchanged';
    } else {
      direction = 'Unchanged';
    }
  } else {
    lastDecisionLabel = 'Hold (no change in window)';
    direction = 'Unchanged';
  }

  return {
    currency: meta.currency,
    centralBank: meta.centralBank,
    shortName: meta.shortName,
    rateLabel: meta.rateLabel,
    currentRate: latest.value,
    previousRate,
    lastDecisionBps,
    lastDecisionLabel,
    lastDecisionDate,
    direction,
    nextMeetingDate: null,
    nextMeetingNote,
    latestObservationDate: latest.date,
    source,
    seriesId,
    available: true,
    unavailableReason: null,
  };
}

export function formatSignedPct(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatPolicyRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  // Preserve 3 decimal places when needed (e.g., 3.875% Fed Funds midpoint), else 2 decimals
  const rounded2 = Math.round(value * 100) / 100;
  const decimals = Math.abs(value - rounded2) > 1e-4 ? 3 : 2;
  return `${value.toFixed(decimals)}%`;
}

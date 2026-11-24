export interface DailyPricePoint {
  date: string; // Normalized YYYY-MM-DD
  timestamp: number; // Unix seconds
  close: number;
  adjClose: number;
  usedAdjustedClose: boolean;
}

export type SecurityPriceBasis = 'adjclose' | 'close';

export interface SecurityHistorySeries {
  symbol: string;
  resolvedSymbol?: string;
  name: string;
  instrumentType: string;
  exchange: string;
  currency?: string;
  priceBasis: SecurityPriceBasis;
  adjustedCloseAvailable: boolean;
  bars: DailyPricePoint[];
  earliestDate: string | null;
  latestDate: string | null;
  isCached?: boolean;
  fetchedAt?: number;
  error?: string | null;
  isInvalidTicker?: boolean;
  unsupported?: boolean;
  rateLimited?: boolean;
}

export type LookbackPeriodId = '30D' | '60D' | '90D' | '180D' | '1Y';

export interface LookbackPeriodConfig {
  id: LookbackPeriodId;
  label: string;
  shortLabel: string;
  calendarDays: number;
  /** Minimum calendar span expected to consider historical coverage complete (allows holiday/weekend margin). */
  minExpectedCalendarDays: number;
}

export const LOOKBACK_PERIODS: readonly LookbackPeriodConfig[] = [
  { id: '30D', label: '30 Days', shortLabel: '30D', calendarDays: 30, minExpectedCalendarDays: 22 },
  { id: '60D', label: '60 Days', shortLabel: '60D', calendarDays: 60, minExpectedCalendarDays: 46 },
  { id: '90D', label: '90 Days', shortLabel: '90D', calendarDays: 90, minExpectedCalendarDays: 74 },
  { id: '180D', label: '180 Days', shortLabel: '180D', calendarDays: 180, minExpectedCalendarDays: 160 },
  { id: '1Y', label: '1 Year', shortLabel: '1Y', calendarDays: 365, minExpectedCalendarDays: 340 },
] as const;

export const DEFAULT_LOOKBACK_PERIOD: LookbackPeriodId = '90D';
export const DEFAULT_ROLLING_WINDOW = 30;
export const ROLLING_WINDOW_OPTIONS = [20, 30, 60] as const;
export const MIN_PAIRWISE_OBSERVATIONS = 10;

export const BENCHMARK_DEFAULTS: readonly {
  symbol: string;
  name: string;
  instrumentType: string;
  exchange: string;
}[] = [
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', instrumentType: 'ETF', exchange: 'NYSE ARCA' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust (Nasdaq-100)', instrumentType: 'ETF', exchange: 'NASDAQ' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', instrumentType: 'ETF', exchange: 'NYSE ARCA' },
  { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', instrumentType: 'ETF', exchange: 'NYSE ARCA' },
] as const;

export type CorrelationBandId =
  | 'strong-positive'
  | 'moderate-positive'
  | 'weak-positive'
  | 'neutral'
  | 'weak-negative'
  | 'moderate-negative'
  | 'strong-negative'
  | 'unavailable';

export interface CorrelationBandMeta {
  id: CorrelationBandId;
  label: string;
  rangeLabel: string;
  direction: 'positive' | 'negative' | 'neutral' | 'unavailable';
}

export const CORRELATION_LEGEND_BANDS: readonly CorrelationBandMeta[] = [
  { id: 'strong-positive', label: 'Strong positive', rangeLabel: '+0.80 to +1.00', direction: 'positive' },
  { id: 'moderate-positive', label: 'Moderate positive', rangeLabel: '+0.40 to +0.79', direction: 'positive' },
  { id: 'weak-positive', label: 'Weak positive', rangeLabel: '+0.10 to +0.39', direction: 'positive' },
  { id: 'neutral', label: 'Little or no correlation', rangeLabel: '-0.09 to +0.09', direction: 'neutral' },
  { id: 'weak-negative', label: 'Weak negative', rangeLabel: '-0.39 to -0.10', direction: 'negative' },
  { id: 'moderate-negative', label: 'Moderate negative', rangeLabel: '-0.79 to -0.40', direction: 'negative' },
  { id: 'strong-negative', label: 'Strong negative', rangeLabel: '-1.00 to -0.80', direction: 'negative' },
] as const;

export function getLookbackConfig(periodId: LookbackPeriodId): LookbackPeriodConfig {
  return LOOKBACK_PERIODS.find((p) => p.id === periodId) || LOOKBACK_PERIODS[2];
}

/**
 * Classifies a Pearson correlation coefficient into the practical interpretation bands.
 * Uses symmetric rounding to two decimal places before checking boundaries so positive and
 * negative ranges agree exactly with CORRELATION_LEGEND_BANDS with no gaps or overlaps.
 */
export function interpretCorrelation(r: number | null | undefined): CorrelationBandMeta {
  if (r === null || r === undefined || !Number.isFinite(r)) {
    return {
      id: 'unavailable',
      label: 'Unavailable',
      rangeLabel: 'N/A',
      direction: 'unavailable',
    };
  }

  const clamped = Math.max(-1, Math.min(1, r));
  const rounded = (clamped < 0 ? -1 : 1) * (Math.round(Math.abs(clamped) * 100) / 100);
  if (rounded >= 0.8) return CORRELATION_LEGEND_BANDS[0];
  if (rounded >= 0.4) return CORRELATION_LEGEND_BANDS[1];
  if (rounded >= 0.1) return CORRELATION_LEGEND_BANDS[2];
  if (rounded >= -0.09) return CORRELATION_LEGEND_BANDS[3];
  if (rounded >= -0.39) return CORRELATION_LEGEND_BANDS[4];
  if (rounded >= -0.79) return CORRELATION_LEGEND_BANDS[5];
  return CORRELATION_LEGEND_BANDS[6];
}

export function formatCorrelationValue(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return '—';
  const normalized = Math.abs(r) < 0.005 ? 0 : r;
  if (normalized > 0) return `+${normalized.toFixed(2)}`;
  return normalized.toFixed(2);
}

/**
 * Computes calendar days between two YYYY-MM-DD ISO dates (end - start).
 */
export function diffCalendarDays(startIso: string, endIso: string): number {
  const s = Date.parse(`${startIso}T00:00:00Z`);
  const e = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  return Math.round((e - s) / 86_400_000);
}

/**
 * Shifts a YYYY-MM-DD ISO date by deltaDays (negative to go backward).
 */
export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return isoDate;
  const dt = new Date(ms + deltaDays * 86_400_000);
  return dt.toISOString().slice(0, 10);
}

/**
 * Normalizes raw daily price bars:
 * - Removes malformed, null, or non-positive price records
 * - Deduplicates duplicate YYYY-MM-DD dates (retaining the latest timestamp for that date)
 * - Sorts strictly chronologically (oldest first)
 */
export function normalizeDailyPriceBars(bars: readonly DailyPricePoint[]): DailyPricePoint[] {
  if (!Array.isArray(bars) || bars.length === 0) return [];
  const byDate = new Map<string, DailyPricePoint>();

  for (const bar of bars) {
    if (!bar || typeof bar.date !== 'string') continue;
    const dateKey = bar.date.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    const effectivePrice =
      typeof bar.adjClose === 'number' && Number.isFinite(bar.adjClose) && bar.adjClose > 0
        ? bar.adjClose
        : typeof bar.close === 'number' && Number.isFinite(bar.close) && bar.close > 0
        ? bar.close
        : NaN;

    if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) continue;

    const close =
      typeof bar.close === 'number' && Number.isFinite(bar.close) && bar.close > 0
        ? bar.close
        : effectivePrice;
    const ts =
      typeof bar.timestamp === 'number' && Number.isFinite(bar.timestamp) ? bar.timestamp : 0;

    const normalized: DailyPricePoint = {
      date: dateKey,
      timestamp: ts,
      close,
      adjClose: effectivePrice,
      usedAdjustedClose:
        typeof bar.usedAdjustedClose === 'boolean'
          ? bar.usedAdjustedClose
          : typeof bar.adjClose === 'number' && Number.isFinite(bar.adjClose) && bar.adjClose > 0,
    };

    const existing = byDate.get(dateKey);
    if (!existing || normalized.timestamp >= existing.timestamp) {
      byDate.set(dateKey, normalized);
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export interface DailyReturnPoint {
  date: string;
  ret: number; // Decimal return: (currentAdjClose / previousAdjClose) - 1
  price: number; // Effective adjusted close on `date`
}

/**
 * Calculates daily percentage returns strictly from consecutive valid adjusted closing prices:
 *   Daily Return = (Current Adjusted Close / Previous Adjusted Close) - 1
 * Never fills missing dates with zero returns.
 */
export function computeDailyReturns(bars: readonly DailyPricePoint[]): DailyReturnPoint[] {
  const clean = normalizeDailyPriceBars(bars);
  if (clean.length < 2) return [];

  const returns: DailyReturnPoint[] = [];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const curr = clean[i];
    if (prev.adjClose <= 0 || curr.adjClose <= 0) continue;
    const ret = curr.adjClose / prev.adjClose - 1;
    if (!Number.isFinite(ret)) continue;
    returns.push({
      date: curr.date,
      ret,
      price: curr.adjClose,
    });
  }
  return returns;
}

/**
 * Numerically stable two-pass Pearson correlation coefficient.
 * - Returns null if fewer than 2 paired observations exist
 * - Returns null if either series has zero variance (constant returns) to prevent misleading values
 * - Clamps floating-point drift strictly within [-1, 1]
 */
export function computePearsonCorrelation(
  xs: readonly number[],
  ys: readonly number[]
): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sumX += x;
    sumY += y;
    count++;
  }
  if (count < 2) return null;

  const meanX = sumX / count;
  const meanY = sumY / count;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dx = x - meanX;
    const dy = y - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  // Guard against constant return series (zero or near-zero variance)
  const EPSILON = 1e-18;
  if (varX <= EPSILON || varY <= EPSILON) {
    return null;
  }

  const denom = Math.sqrt(varX * varY);
  if (!Number.isFinite(denom) || denom <= EPSILON) {
    return null;
  }

  const raw = cov / denom;
  if (!Number.isFinite(raw)) return null;
  return Math.max(-1, Math.min(1, raw));
}

export interface AlignedReturnObservation {
  date: string;
  retA: number;
  retB: number;
  priceA: number;
  priceB: number;
}

export interface SecurityCoverageStatus {
  symbol: string;
  name: string;
  availableDays: number;
  availableBars: number;
  earliestDate: string | null;
  latestDate: string | null;
  requestedDays: number;
  hasSufficientCoverage: boolean;
  adjustedCloseAvailable: boolean;
  priceBasis: SecurityPriceBasis;
  warningMessage: string | null;
}

export function evaluateSecurityCoverage(
  series: SecurityHistorySeries,
  lookbackPeriod: LookbackPeriodId
): SecurityCoverageStatus {
  const cfg = getLookbackConfig(lookbackPeriod);
  const cleanBars = normalizeDailyPriceBars(series.bars);
  const earliestDate = cleanBars.length > 0 ? cleanBars[0].date : null;
  const latestDate = cleanBars.length > 0 ? cleanBars[cleanBars.length - 1].date : null;
  const availableDays =
    earliestDate && latestDate ? Math.max(0, diffCalendarDays(earliestDate, latestDate)) : 0;

  const hasSufficientCoverage =
    cleanBars.length >= MIN_PAIRWISE_OBSERVATIONS + 1 &&
    availableDays >= cfg.minExpectedCalendarDays;

  let warningMessage: string | null = null;
  if (series.error) {
    warningMessage = series.error;
  } else if (cleanBars.length === 0) {
    warningMessage = `${series.symbol}: No daily historical price observations available.`;
  } else if (cleanBars.length < MIN_PAIRWISE_OBSERVATIONS + 1) {
    warningMessage = `${series.symbol}: Only ${cleanBars.length} daily observations available (${earliestDate} to ${latestDate}); insufficient for reliable correlation.`;
  } else if (!hasSufficientCoverage) {
    warningMessage = `${series.symbol}: Historical coverage spans ${availableDays} calendar days (${earliestDate} to ${latestDate}), shorter than the requested ${cfg.label} lookback.`;
  }

  return {
    symbol: series.symbol,
    name: series.name,
    availableDays,
    availableBars: cleanBars.length,
    earliestDate,
    latestDate,
    requestedDays: cfg.calendarDays,
    hasSufficientCoverage,
    adjustedCloseAvailable: series.adjustedCloseAvailable,
    priceBasis: series.priceBasis,
    warningMessage,
  };
}

export interface RollingCorrelationPoint {
  date: string;
  correlation: number;
  windowSize: number;
}

export interface NormalizedPerformancePoint {
  date: string;
  indexA: number;
  indexB: number;
  priceA: number;
  priceB: number;
}

export interface ReturnScatterPoint {
  date: string;
  retAPct: number;
  retBPct: number;
}

export interface RegressionLine {
  slope: number;
  intercept: number;
}

export interface PairwiseCorrelationAnalysis {
  symbolA: string;
  symbolB: string;
  nameA: string;
  nameB: string;
  lookbackPeriod: LookbackPeriodId;
  lookbackLabel: string;
  rollingWindow: number;
  correlation: number | null;
  interpretation: CorrelationBandMeta;
  observationCount: number;
  totalAlignedHistoryCount: number;
  startDate: string | null;
  endDate: string | null;
  sameDirectionPct: number | null;
  sameDirectionCount: number;
  rollingSeries: RollingCorrelationPoint[];
  rollingUnavailableReason: string | null;
  normalizedSeries: NormalizedPerformancePoint[];
  scatterPoints: ReturnScatterPoint[];
  regressionLine: RegressionLine | null;
  unavailableReason: string | null;
  coverageWarnings: string[];
  hasUnadjustedSeries: boolean;
}

/**
 * Aligns two daily price series by exact normalized trading date (YYYY-MM-DD),
 * excluding any date where either security lacks a valid daily return observation.
 */
export function alignSecurityReturns(
  barsA: readonly DailyPricePoint[],
  barsB: readonly DailyPricePoint[]
): AlignedReturnObservation[] {
  const returnsA = computeDailyReturns(barsA);
  const returnsB = computeDailyReturns(barsB);
  if (returnsA.length === 0 || returnsB.length === 0) return [];

  const mapB = new Map<string, DailyReturnPoint>();
  for (const pt of returnsB) {
    mapB.set(pt.date, pt);
  }

  const aligned: AlignedReturnObservation[] = [];
  for (const ptA of returnsA) {
    const ptB = mapB.get(ptA.date);
    if (!ptB) continue;
    aligned.push({
      date: ptA.date,
      retA: ptA.ret,
      retB: ptB.ret,
      priceA: ptA.price,
      priceB: ptB.price,
    });
  }
  return aligned;
}

function computeOlsRegression(
  xs: readonly number[],
  ys: readonly number[]
): RegressionLine | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  if (den <= 1e-18) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  return { slope, intercept };
}

/**
 * Computes the complete pairwise analysis between two securities over the requested
 * lookback period and rolling observation window.
 */
export function computePairwiseAnalysis(
  seriesA: SecurityHistorySeries,
  seriesB: SecurityHistorySeries,
  lookbackPeriod: LookbackPeriodId,
  rollingWindow: number = DEFAULT_ROLLING_WINDOW
): PairwiseCorrelationAnalysis {
  const cfg = getLookbackConfig(lookbackPeriod);
  const safeWindow = Math.max(5, Math.floor(rollingWindow));
  const covA = evaluateSecurityCoverage(seriesA, lookbackPeriod);
  const covB = evaluateSecurityCoverage(seriesB, lookbackPeriod);

  const coverageWarnings: string[] = [];
  if (covA.warningMessage) coverageWarnings.push(covA.warningMessage);
  if (seriesA.symbol !== seriesB.symbol && covB.warningMessage) {
    coverageWarnings.push(covB.warningMessage);
  }

  const hasUnadjustedSeries = !seriesA.adjustedCloseAvailable || !seriesB.adjustedCloseAvailable;

  const allAligned = alignSecurityReturns(seriesA.bars, seriesB.bars);
  if (allAligned.length === 0) {
    return {
      symbolA: seriesA.symbol,
      symbolB: seriesB.symbol,
      nameA: seriesA.name,
      nameB: seriesB.name,
      lookbackPeriod,
      lookbackLabel: cfg.label,
      rollingWindow: safeWindow,
      correlation: null,
      interpretation: interpretCorrelation(null),
      observationCount: 0,
      totalAlignedHistoryCount: 0,
      startDate: null,
      endDate: null,
      sameDirectionPct: null,
      sameDirectionCount: 0,
      rollingSeries: [],
      rollingUnavailableReason: `No overlapping daily trading observations exist between ${seriesA.symbol} and ${seriesB.symbol}.`,
      normalizedSeries: [],
      scatterPoints: [],
      regressionLine: null,
      unavailableReason: `No overlapping daily return observations between ${seriesA.symbol} and ${seriesB.symbol}.`,
      coverageWarnings,
      hasUnadjustedSeries,
    };
  }

  const latestCommonDate = allAligned[allAligned.length - 1].date;
  const cutoffDate = shiftIsoDate(latestCommonDate, -cfg.calendarDays);

  const windowAligned = allAligned.filter((obs) => obs.date >= cutoffDate);
  const startDate = windowAligned.length > 0 ? windowAligned[0].date : null;
  const endDate = windowAligned.length > 0 ? windowAligned[windowAligned.length - 1].date : null;

  // Check overlapping calendar span against requested lookback
  if (startDate && endDate) {
    const overlapSpanDays = diffCalendarDays(startDate, endDate);
    if (
      overlapSpanDays < cfg.minExpectedCalendarDays &&
      coverageWarnings.length === 0
    ) {
      coverageWarnings.push(
        `Overlapping trading history between ${seriesA.symbol} and ${seriesB.symbol} spans ${overlapSpanDays} calendar days (${startDate} to ${endDate}), shorter than the requested ${cfg.label} lookback.`
      );
    }
  }

  let correlation: number | null = null;
  let unavailableReason: string | null = null;
  if (windowAligned.length < MIN_PAIRWISE_OBSERVATIONS) {
    unavailableReason = `Insufficient overlapping observations (${windowAligned.length} found; at least ${MIN_PAIRWISE_OBSERVATIONS} daily return observations required).`;
  } else {
    const xs = windowAligned.map((o) => o.retA);
    const ys = windowAligned.map((o) => o.retB);
    correlation = computePearsonCorrelation(xs, ys);
    if (correlation === null) {
      unavailableReason = `Correlation undefined: ${seriesA.symbol} or ${seriesB.symbol} exhibited constant daily returns (zero variance) over this period.`;
    }
  }

  // Same-direction trading sessions
  let sameDirectionCount = 0;
  for (const obs of windowAligned) {
    const signA = obs.retA > 0 ? 1 : obs.retA < 0 ? -1 : 0;
    const signB = obs.retB > 0 ? 1 : obs.retB < 0 ? -1 : 0;
    if (signA === signB) {
      sameDirectionCount++;
    }
  }
  const sameDirectionPct =
    windowAligned.length > 0 ? (sameDirectionCount / windowAligned.length) * 100 : null;

  // Rolling correlation using exact trailing `safeWindow` aligned trading observations
  // ending at each date within the selected lookback period (using pre-window history as warmup).
  const rollingSeries: RollingCorrelationPoint[] = [];
  let rollingUnavailableReason: string | null = null;

  if (allAligned.length < safeWindow) {
    rollingUnavailableReason = `Insufficient overlapping trading observations for a ${safeWindow}-observation rolling window (${allAligned.length} total overlapping observations available; ${safeWindow} required).`;
  } else {
    for (let i = safeWindow - 1; i < allAligned.length; i++) {
      const endObs = allAligned[i];
      if (endObs.date < cutoffDate) continue;
      const slice = allAligned.slice(i - safeWindow + 1, i + 1);
      const r = computePearsonCorrelation(
        slice.map((s) => s.retA),
        slice.map((s) => s.retB)
      );
      if (r !== null) {
        rollingSeries.push({
          date: endObs.date,
          correlation: r,
          windowSize: safeWindow,
        });
      }
    }
    if (rollingSeries.length < 2) {
      rollingUnavailableReason = `Fewer than 2 valid ${safeWindow}-observation rolling correlation points could be computed within the ${cfg.label} lookback period.`;
    }
  }

  // Normalized performance series (Base = 100 on the first aligned trading date in the lookback period)
  const cleanBarsA = normalizeDailyPriceBars(seriesA.bars);
  const cleanBarsB = normalizeDailyPriceBars(seriesB.bars);
  const priceMapB = new Map<string, number>();
  for (const b of cleanBarsB) {
    priceMapB.set(b.date, b.adjClose);
  }
  const commonPrices: { date: string; priceA: number; priceB: number }[] = [];
  for (const b of cleanBarsA) {
    if (b.date < cutoffDate) continue;
    const pB = priceMapB.get(b.date);
    if (pB === undefined) continue;
    commonPrices.push({ date: b.date, priceA: b.adjClose, priceB: pB });
  }

  const normalizedSeries: NormalizedPerformancePoint[] = [];
  if (commonPrices.length >= 2) {
    const baseA = commonPrices[0].priceA;
    const baseB = commonPrices[0].priceB;
    if (baseA > 0 && baseB > 0) {
      for (const pt of commonPrices) {
        normalizedSeries.push({
          date: pt.date,
          indexA: (pt.priceA / baseA) * 100,
          indexB: (pt.priceB / baseB) * 100,
          priceA: pt.priceA,
          priceB: pt.priceB,
        });
      }
    }
  }

  // Daily return scatter plot points (expressed in percentage points)
  const scatterPoints: ReturnScatterPoint[] = windowAligned.map((obs) => ({
    date: obs.date,
    retAPct: obs.retA * 100,
    retBPct: obs.retB * 100,
  }));

  const regressionLine =
    scatterPoints.length >= 2
      ? computeOlsRegression(
          scatterPoints.map((p) => p.retAPct),
          scatterPoints.map((p) => p.retBPct)
        )
      : null;

  return {
    symbolA: seriesA.symbol,
    symbolB: seriesB.symbol,
    nameA: seriesA.name,
    nameB: seriesB.name,
    lookbackPeriod,
    lookbackLabel: cfg.label,
    rollingWindow: safeWindow,
    correlation,
    interpretation: interpretCorrelation(correlation),
    observationCount: windowAligned.length,
    totalAlignedHistoryCount: allAligned.length,
    startDate,
    endDate,
    sameDirectionPct,
    sameDirectionCount,
    rollingSeries,
    rollingUnavailableReason,
    normalizedSeries,
    scatterPoints,
    regressionLine,
    unavailableReason,
    coverageWarnings,
    hasUnadjustedSeries,
  };
}

export interface MatrixCell {
  rowSymbol: string;
  colSymbol: string;
  correlation: number | null;
  interpretation: CorrelationBandMeta;
  observationCount: number;
  isDiagonal: boolean;
  hasPartialCoverage: boolean;
  unavailableReason: string | null;
}

export interface CorrelationMatrixResult {
  symbols: string[];
  lookbackPeriod: LookbackPeriodId;
  cells: MatrixCell[][];
  coverageBySymbol: Record<string, SecurityCoverageStatus>;
  minOverlapCount: number | null;
  maxOverlapCount: number | null;
}

/**
 * Builds a guaranteed-symmetrical N x N Pearson correlation matrix across all selected securities.
 * Diagonal cells equal 1.00 when the security has valid return variance, or null if unavailable/constant.
 */
export function buildCorrelationMatrix(
  securities: readonly SecurityHistorySeries[],
  lookbackPeriod: LookbackPeriodId
): CorrelationMatrixResult {
  const n = securities.length;
  const symbols = securities.map((s) => s.symbol);
  const cfg = getLookbackConfig(lookbackPeriod);

  const coverageBySymbol: Record<string, SecurityCoverageStatus> = {};
  for (const sec of securities) {
    coverageBySymbol[sec.symbol] = evaluateSecurityCoverage(sec, lookbackPeriod);
  }

  const cells: MatrixCell[][] = Array.from({ length: n }, () => new Array<MatrixCell>(n));
  let minOverlap: number | null = null;
  let maxOverlap: number | null = null;

  for (let i = 0; i < n; i++) {
    const secI = securities[i];
    const covI = coverageBySymbol[secI.symbol];

    // Diagonal cell (i, i)
    const returnsI = computeDailyReturns(secI.bars);
    let diagWindowCount = 0;
    let diagCorr: number | null = null;
    let diagReason: string | null = null;
    if (returnsI.length > 0) {
      const latestI = returnsI[returnsI.length - 1].date;
      const cutoffI = shiftIsoDate(latestI, -cfg.calendarDays);
      const winI = returnsI.filter((r) => r.date >= cutoffI);
      diagWindowCount = winI.length;
      if (winI.length < MIN_PAIRWISE_OBSERVATIONS) {
        diagReason = `Only ${winI.length} daily observations available.`;
      } else {
        const vals = winI.map((r) => r.ret);
        const selfR = computePearsonCorrelation(vals, vals);
        if (selfR === null) {
          diagReason = 'Constant daily return series (zero variance).';
        } else {
          diagCorr = 1.0;
        }
      }
    } else {
      diagReason = secI.error || 'No valid daily return observations.';
    }

    cells[i][i] = {
      rowSymbol: secI.symbol,
      colSymbol: secI.symbol,
      correlation: diagCorr,
      interpretation: interpretCorrelation(diagCorr),
      observationCount: diagWindowCount,
      isDiagonal: true,
      hasPartialCoverage: !covI.hasSufficientCoverage,
      unavailableReason: diagReason,
    };

    // Upper triangle (i, j) mirrored identically to (j, i)
    for (let j = i + 1; j < n; j++) {
      const secJ = securities[j];
      const covJ = coverageBySymbol[secJ.symbol];
      const allAligned = alignSecurityReturns(secI.bars, secJ.bars);

      let corr: number | null = null;
      let obsCount = 0;
      let reason: string | null = null;
      let partial = !covI.hasSufficientCoverage || !covJ.hasSufficientCoverage;

      if (allAligned.length === 0) {
        reason = `No overlapping daily observations between ${secI.symbol} and ${secJ.symbol}.`;
      } else {
        const latestDate = allAligned[allAligned.length - 1].date;
        const cutoff = shiftIsoDate(latestDate, -cfg.calendarDays);
        const win = allAligned.filter((o) => o.date >= cutoff);
        obsCount = win.length;
        if (win.length > 0) {
          const span = diffCalendarDays(win[0].date, win[win.length - 1].date);
          if (span < cfg.minExpectedCalendarDays) partial = true;
        }
        if (win.length < MIN_PAIRWISE_OBSERVATIONS) {
          reason = `Insufficient overlap (${win.length} sessions; ${MIN_PAIRWISE_OBSERVATIONS} required).`;
        } else {
          corr = computePearsonCorrelation(
            win.map((o) => o.retA),
            win.map((o) => o.retB)
          );
          if (corr === null) {
            reason = 'Undefined correlation (constant return series).';
          }
        }
      }

      if (obsCount > 0) {
        minOverlap = minOverlap === null ? obsCount : Math.min(minOverlap, obsCount);
        maxOverlap = maxOverlap === null ? obsCount : Math.max(maxOverlap, obsCount);
      }

      const interpretation = interpretCorrelation(corr);
      cells[i][j] = {
        rowSymbol: secI.symbol,
        colSymbol: secJ.symbol,
        correlation: corr,
        interpretation,
        observationCount: obsCount,
        isDiagonal: false,
        hasPartialCoverage: partial,
        unavailableReason: reason,
      };
      cells[j][i] = {
        rowSymbol: secJ.symbol,
        colSymbol: secI.symbol,
        correlation: corr,
        interpretation,
        observationCount: obsCount,
        isDiagonal: false,
        hasPartialCoverage: partial,
        unavailableReason: reason,
      };
    }
  }

  return {
    symbols,
    lookbackPeriod,
    cells,
    coverageBySymbol,
    minOverlapCount: minOverlap,
    maxOverlapCount: maxOverlap,
  };
}

export interface CorrelationInsight {
  id: string;
  category:
    | 'STRONG_RELATIONSHIP'
    | 'INVERSE_RELATIONSHIP'
    | 'WEAKENING_RELATIONSHIP'
    | 'STRENGTHENING_RELATIONSHIP'
    | 'RELATIONSHIP_SHIFT'
    | 'POTENTIAL_DIVERSIFICATION';
  title: string;
  summary: string;
  metricLabel: string;
  metricTickers?: string[];
  metricValue?: string;
  tone: 'positive' | 'negative' | 'warning' | 'neutral';
}

/**
 * Generates deterministic, rule-based analytical observations strictly from actual calculated
 * correlations and rolling series. Avoids causal claims, predictions, or diversification guarantees.
 */
export function generateCorrelationInsights(
  matrix: CorrelationMatrixResult,
  activePair: PairwiseCorrelationAnalysis | null
): CorrelationInsight[] {
  const insights: CorrelationInsight[] = [];
  const cfg = getLookbackConfig(matrix.lookbackPeriod);

  // Collect all valid unique off-diagonal pairs
  const pairs: { a: string; b: string; r: number; n: number }[] = [];
  for (let i = 0; i < matrix.cells.length; i++) {
    for (let j = i + 1; j < matrix.cells[i].length; j++) {
      const cell = matrix.cells[i][j];
      if (cell.correlation !== null && Number.isFinite(cell.correlation)) {
        pairs.push({
          a: cell.rowSymbol,
          b: cell.colSymbol,
          r: cell.correlation,
          n: cell.observationCount,
        });
      }
    }
  }

  if (pairs.length === 0) return insights;

  // 1. Strongest positive relationship
  const sortedDesc = [...pairs].sort((x, y) => y.r - x.r);
  const strongestPos = sortedDesc[0];
  if (strongestPos && strongestPos.r >= 0.4) {
    const band = interpretCorrelation(strongestPos.r);
    insights.push({
      id: `strong-pos-${strongestPos.a}-${strongestPos.b}`,
      category: 'STRONG_RELATIONSHIP',
      title: 'Strong Relationship',
      summary: `${strongestPos.a} and ${strongestPos.b} exhibit a ${band.label.toLowerCase()} linear correlation (${formatCorrelationValue(strongestPos.r)}) across ${strongestPos.n} overlapping daily sessions over the ${cfg.label} lookback.`,
      metricLabel: `${strongestPos.a} / ${strongestPos.b}: ${formatCorrelationValue(strongestPos.r)}`,
      metricTickers: [strongestPos.a, strongestPos.b],
      metricValue: formatCorrelationValue(strongestPos.r),
      tone: 'positive',
    });
  }

  // 2. Strongest negative / inverse relationship
  const sortedAsc = [...pairs].sort((x, y) => x.r - y.r);
  const strongestNeg = sortedAsc[0];
  if (strongestNeg && strongestNeg.r <= -0.25) {
    const band = interpretCorrelation(strongestNeg.r);
    insights.push({
      id: `inverse-${strongestNeg.a}-${strongestNeg.b}`,
      category: 'INVERSE_RELATIONSHIP',
      title: 'Inverse Co-Movement',
      summary: `${strongestNeg.a} and ${strongestNeg.b} show a ${band.label.toLowerCase()} relationship (${formatCorrelationValue(strongestNeg.r)}) over ${strongestNeg.n} overlapping daily sessions, tending to move in opposite directions during this window.`,
      metricLabel: `${strongestNeg.a} / ${strongestNeg.b}: ${formatCorrelationValue(strongestNeg.r)}`,
      metricTickers: [strongestNeg.a, strongestNeg.b],
      metricValue: formatCorrelationValue(strongestNeg.r),
      tone: 'negative',
    });
  }

  // 3. Rolling relationship change / divergence on the active pair
  if (activePair && activePair.rollingSeries.length >= 6) {
    const series = activePair.rollingSeries;
    const latest = series[series.length - 1];
    // Compare latest rolling point against the rolling point one window earlier (or start of lookback)
    const compareIdx = Math.max(0, series.length - 1 - Math.min(activePair.rollingWindow, Math.floor(series.length / 2)));
    const prior = series[compareIdx];
    const delta = latest.correlation - prior.correlation;

    const crossedZero =
      (prior.correlation >= 0.15 && latest.correlation <= -0.15) ||
      (prior.correlation <= -0.15 && latest.correlation >= 0.15);

    if (crossedZero) {
      insights.push({
        id: `shift-${activePair.symbolA}-${activePair.symbolB}`,
        category: 'RELATIONSHIP_SHIFT',
        title: 'Relationship Shift',
        summary: `The ${activePair.rollingWindow}-session rolling correlation between ${activePair.symbolA} and ${activePair.symbolB} reversed sign from ${formatCorrelationValue(prior.correlation)} (${prior.date}) to ${formatCorrelationValue(latest.correlation)} (${latest.date}), indicating a notable regime change in co-movement.`,
        metricLabel: `${formatCorrelationValue(prior.correlation)} → ${formatCorrelationValue(latest.correlation)}`,
        tone: 'warning',
      });
    } else if (delta <= -0.15) {
      insights.push({
        id: `weaken-${activePair.symbolA}-${activePair.symbolB}`,
        category: 'WEAKENING_RELATIONSHIP',
        title: 'Weakening Relationship',
        summary: `${activePair.symbolA}'s ${activePair.rollingWindow}-session rolling correlation with ${activePair.symbolB} declined by ${Math.abs(delta).toFixed(2)} (from ${formatCorrelationValue(prior.correlation)} on ${prior.date} to ${formatCorrelationValue(latest.correlation)} on ${latest.date}), reflecting increasing return divergence.`,
        metricLabel: `Δ ${delta.toFixed(2)} (${activePair.rollingWindow}D roll)`,
        tone: 'warning',
      });
    } else if (delta >= 0.15) {
      insights.push({
        id: `strengthen-${activePair.symbolA}-${activePair.symbolB}`,
        category: 'STRENGTHENING_RELATIONSHIP',
        title: 'Strengthening Relationship',
        summary: `${activePair.symbolA}'s ${activePair.rollingWindow}-session rolling correlation with ${activePair.symbolB} increased by +${delta.toFixed(2)} (from ${formatCorrelationValue(prior.correlation)} on ${prior.date} to ${formatCorrelationValue(latest.correlation)} on ${latest.date}).`,
        metricLabel: `Δ +${delta.toFixed(2)} (${activePair.rollingWindow}D roll)`,
        tone: 'positive',
      });
    }
  }

  // 4. Potential diversification observation (lowest average absolute correlation with other selected holdings)
  if (matrix.symbols.length >= 3) {
    const avgCorrBySymbol: { symbol: string; meanAbs: number; meanSigned: number; peerCount: number }[] = [];
    for (let i = 0; i < matrix.symbols.length; i++) {
      let sumAbs = 0;
      let sumSigned = 0;
      let count = 0;
      for (let j = 0; j < matrix.symbols.length; j++) {
        if (i === j) continue;
        const r = matrix.cells[i][j].correlation;
        if (r !== null && Number.isFinite(r)) {
          sumAbs += Math.abs(r);
          sumSigned += r;
          count++;
        }
      }
      if (count > 0) {
        avgCorrBySymbol.push({
          symbol: matrix.symbols[i],
          meanAbs: sumAbs / count,
          meanSigned: sumSigned / count,
          peerCount: count,
        });
      }
    }

    avgCorrBySymbol.sort((a, b) => a.meanAbs - b.meanAbs);
    const lowest = avgCorrBySymbol[0];
    if (lowest && lowest.meanAbs < 0.55) {
      insights.push({
        id: `diversify-${lowest.symbol}`,
        category: 'POTENTIAL_DIVERSIFICATION',
        title: 'Lower Historical Co-Movement',
        summary: `${lowest.symbol} exhibits the lowest average historical correlation with the other ${lowest.peerCount} selected securities (mean ${formatCorrelationValue(lowest.meanSigned)}, mean |r| ${lowest.meanAbs.toFixed(2)} over ${cfg.label}). Historical independence can break down during market stress.`,
        metricLabel: `${lowest.symbol} avg r: ${formatCorrelationValue(lowest.meanSigned)}`,
        metricTickers: [lowest.symbol],
        metricValue: `avg r: ${formatCorrelationValue(lowest.meanSigned)}`,
        tone: 'neutral',
      });
    }
  }

  return insights;
}

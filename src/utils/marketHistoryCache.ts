import type { StockData } from '../types';

export type HistoryBar = StockData['history'][number];

export interface MarketHistoryCacheEntry {
  bars: HistoryBar[];
  fetchedAt: number;
}

export const HISTORY_CACHE_FRESH_MS = 30_000;

const historyCache = new Map<string, MarketHistoryCacheEntry>();

export function getHistoryCacheKey(symbol: string, interval: string): string {
  return `${symbol.toUpperCase().trim()}:${interval.trim()}`;
}

export function getCachedMarketHistory(
  symbol: string,
  interval: string
): MarketHistoryCacheEntry | null {
  if (!symbol || !interval) return null;
  const key = getHistoryCacheKey(symbol, interval);
  return historyCache.get(key) || null;
}

export function isCachedHistoryFresh(
  entry: MarketHistoryCacheEntry | null,
  now = Date.now()
): boolean {
  if (!entry || entry.bars.length === 0) return false;
  return now - entry.fetchedAt < HISTORY_CACHE_FRESH_MS;
}

export function setCachedMarketHistory(
  symbol: string,
  interval: string,
  bars: HistoryBar[],
  fetchedAt = Date.now()
): MarketHistoryCacheEntry {
  const key = getHistoryCacheKey(symbol, interval);
  const entry: MarketHistoryCacheEntry = { bars, fetchedAt };
  if (bars.length > 0) {
    historyCache.set(key, entry);
  } else {
    historyCache.delete(key);
  }
  return entry;
}

export function clearMarketHistoryCache(): void {
  historyCache.clear();
}

export type ChartDataPhase = 'pending' | 'ready' | 'unavailable';

export interface ChartDataPhaseInput {
  hasStock: boolean;
  hasUsableBars: boolean;
  hasResolvedHistoryAttempt: boolean;
  isHistoryFetching: boolean;
}

/**
 * Determines the chart plot state inside the Graph Price layout:
 * - 'ready': usable bars are available (cached or fetched)
 * - 'pending': initial history request is still in flight (never interpret as unavailable)
 * - 'unavailable': history request completed and confirmed no usable bars
 */
export function deriveChartDataPhase(params: ChartDataPhaseInput): ChartDataPhase {
  if (!params.hasStock) {
    return 'unavailable';
  }
  if (params.hasUsableBars) {
    return 'ready';
  }
  if (!params.hasResolvedHistoryAttempt || params.isHistoryFetching) {
    return 'pending';
  }
  return 'unavailable';
}

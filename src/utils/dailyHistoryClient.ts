import type { DailyPricePoint, SecurityHistorySeries } from './correlation';
import { normalizeTickerSymbol } from './equityValidation';

const CLIENT_HISTORY_CACHE_TTL_MS = 15 * 60 * 1000;

// Shared client-side cache & in-flight deduplication across CORR and PRM workspaces
const clientHistoryCache = new Map<string, { fetchedAt: number; series: SecurityHistorySeries }>();
const inFlightRequests = new Map<string, Promise<SecurityHistorySeries>>();

export function clearDailyHistoryClientCache(): void {
  clientHistoryCache.clear();
  inFlightRequests.clear();
}

export function getCachedSecurityDailyHistory(rawSymbol: string): SecurityHistorySeries | null {
  const sym = normalizeTickerSymbol(rawSymbol);
  if (!sym) return null;
  const cached = clientHistoryCache.get(sym);
  if (cached && Date.now() - cached.fetchedAt < CLIENT_HISTORY_CACHE_TTL_MS) {
    return { ...cached.series, isCached: true };
  }
  return null;
}

export async function fetchSecurityDailyHistory(
  rawSymbol: string,
  force = false
): Promise<SecurityHistorySeries> {
  const sym = normalizeTickerSymbol(rawSymbol);
  const now = Date.now();

  if (!force) {
    const cached = clientHistoryCache.get(sym);
    if (cached && now - cached.fetchedAt < CLIENT_HISTORY_CACHE_TTL_MS) {
      return { ...cached.series, isCached: true };
    }
    const pending = inFlightRequests.get(sym);
    if (pending) return pending;
  }

  const reqPromise = (async (): Promise<SecurityHistorySeries> => {
    try {
      const url = `/api/market/history?symbol=${encodeURIComponent(sym)}&interval=daily_adj${
        force ? '&force=true' : ''
      }`;
      const resp = await fetch(url);
      let data: any = null;
      try {
        data = await resp.json();
      } catch {
        data = null;
      }

      if (resp.status === 429 || data?.rateLimited) {
        return {
          symbol: sym,
          name: sym,
          instrumentType: 'UNKNOWN',
          exchange: '',
          priceBasis: 'close',
          adjustedCloseAvailable: false,
          bars: [],
          earliestDate: null,
          latestDate: null,
          rateLimited: true,
          error:
            data?.error ||
            `Rate limit reached while retrieving historical prices for ${sym}. Wait a moment and retry.`,
        };
      }

      if (!data || data.success !== true) {
        return {
          symbol: sym,
          name: sym,
          instrumentType: data?.instrumentType || 'UNKNOWN',
          exchange: '',
          priceBasis: 'close',
          adjustedCloseAvailable: false,
          bars: [],
          earliestDate: null,
          latestDate: null,
          isInvalidTicker: Boolean(data?.isInvalidTicker),
          unsupported: Boolean(data?.unsupported),
          error: data?.error || `Historical daily prices are unavailable for "${sym}".`,
        };
      }

      const bars: DailyPricePoint[] = Array.isArray(data.bars) ? data.bars : [];
      const series: SecurityHistorySeries = {
        symbol: sym,
        resolvedSymbol: data.resolvedSymbol || sym,
        name: data.name || sym,
        instrumentType: data.instrumentType || 'EQUITY',
        exchange: data.exchange || 'US',
        currency: data.currency || 'USD',
        priceBasis: data.priceBasis === 'adjclose' ? 'adjclose' : 'close',
        adjustedCloseAvailable: Boolean(data.adjustedCloseAvailable),
        bars,
        earliestDate: data.earliestDate || (bars[0]?.date ?? null),
        latestDate: data.latestDate || (bars[bars.length - 1]?.date ?? null),
        isCached: Boolean(data.isCached),
        fetchedAt: Date.now(),
        error: null,
      };

      if (bars.length > 0) {
        clientHistoryCache.set(sym, { fetchedAt: Date.now(), series });
      }
      return series;
    } catch (err: any) {
      return {
        symbol: sym,
        name: sym,
        instrumentType: 'UNKNOWN',
        exchange: '',
        priceBasis: 'close',
        adjustedCloseAvailable: false,
        bars: [],
        earliestDate: null,
        latestDate: null,
        error: err?.message || `Network error retrieving daily history for "${sym}".`,
      };
    } finally {
      inFlightRequests.delete(sym);
    }
  })();

  inFlightRequests.set(sym, reqPromise);
  return reqPromise;
}

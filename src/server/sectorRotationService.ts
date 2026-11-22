import type {
  InstitutionalAccumulationRow,
  SectorClassificationCoverage,
  SectorId,
  SectorInsiderSentiment,
  SectorPerformancePeriod,
  SectorPeriodReturnPoint,
  SectorPriceHistoryPoint,
  SectorRotationItem,
  SectorRotationResponse,
} from '../types';
import {
  BENCHMARK_ETF,
  GICS_SECTORS,
  PERFORMANCE_PERIODS,
  aggregateInstitutionalBySector,
  buildSectorMarketPerformance,
  classifyInsiderSentiment,
  computePeriodReturn,
  finalizeMarketRankingsAndOverview,
  isBroadMarketOrMultiSectorFund,
  mapMarketSectorToGicsSector,
  mapSicToGicsSector,
  matchDirectSectorEtf,
  normalizeCompanyMatchKey,
  type ClassifiedSecurityMeta,
} from '../utils/sectorRotation';
import {
  ThreeSpreadError,
  fetchThreeSpreadJson,
  getComparableCohortSnapshot,
  isThreeSpreadConfigured,
  sanitizePeriodInput,
  type CohortSnapshot,
} from './threeSpreadService';
import { redactErrorMessage } from './apiCredentials';

const YAHOO_USER_AGENT = 'Mozilla/5.0 (compatible; QuorixTerminal/1.0)';
const YAHOO_TIMEOUT_MS = 10_000;
const MARKET_HISTORY_TTL_MS = 10 * 60_000; // 10 minutes
const SIC_INDEX_TTL_MS = 60 * 60_000; // 1 hour
const YAHOO_SECTOR_TTL_MS = 6 * 60 * 60_000; // 6 hours
const INSIDER_TTL_MS = 30 * 60_000; // 30 minutes
const MAX_CACHE_ENTRIES = 400;
const MAX_YAHOO_FALLBACK_LOOKUPS = 120;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const serviceCache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string, force = false): T | null {
  if (force) return null;
  const hit = serviceCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    serviceCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number): T {
  if (serviceCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = serviceCache.keys().next().value;
    if (oldest) serviceCache.delete(oldest);
  }
  serviceCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

export function clearSectorRotationCache(): void {
  serviceCache.clear();
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => next()));
  return results;
}

function shiftDaysIso(isoDate: string, deltaDays: number): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

/**
 * Fetches 1-year daily closing history for a US ETF ticker from Yahoo Finance's chart API
 * (the application's existing market-data provider). Returns date-sorted unique daily bars.
 */
async function fetchDailyEtfHistory(
  ticker: string,
  force = false
): Promise<{ bars: SectorPriceHistoryPoint[]; error: string | null }> {
  const symbol = ticker.trim().toUpperCase();
  if (!/^[A-Z]{1,6}$/.test(symbol)) {
    return { bars: [], error: 'Invalid ETF ticker.' };
  }

  const cacheKey = `etf-history:${symbol}`;
  const cached = getCached<{ bars: SectorPriceHistoryPoint[]; error: string | null }>(cacheKey, force);
  if (cached) return cached;

  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=1y`;

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': YAHOO_USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS),
    });

    if (!resp.ok) {
      return {
        bars: [],
        error: `Market data provider returned HTTP ${resp.status} for ${symbol}.`,
      };
    }

    const json: any = await resp.json();
    const chartResult = json?.chart?.result?.[0];
    const timestamps: unknown = chartResult?.timestamp;
    const closes: unknown = chartResult?.indicators?.quote?.[0]?.close;

    if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length === 0) {
      return { bars: [], error: `No historical price bars available for ${symbol}.` };
    }

    const byDate = new Map<string, number>();
    const len = Math.min(timestamps.length, closes.length);
    for (let i = 0; i < len; i++) {
      const ts = Number(timestamps[i]);
      const close = Number(closes[i]);
      if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue;
      const isoDate = new Date(ts * 1000).toISOString().slice(0, 10);
      byDate.set(isoDate, close);
    }

    const bars: SectorPriceHistoryPoint[] = Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, close]) => ({ date, close }));

    if (bars.length === 0) {
      return { bars: [], error: `No valid closing prices returned for ${symbol}.` };
    }

    return setCached(cacheKey, { bars, error: null }, MARKET_HISTORY_TTL_MS);
  } catch (err) {
    return {
      bars: [],
      error: redactErrorMessage(err, `Failed to retrieve market history for ${symbol}.`),
    };
  }
}

interface ThreeSpreadFilingLite {
  cik?: string | number | null;
  filer_name?: string | null;
  filer_tickers?: string[] | null;
  filer_sic?: string | number | null;
  sic?: string | number | null;
  form_type?: string | null;
}

interface SicRegistryEntry {
  cik: string;
  sic: string;
  ticker: string | null;
}

/**
 * Builds a normalized issuer-name -> SEC SIC index from recent 3spread 10-Q/10-K financial
 * filings via GET /v1/financials (returns filer_name, filer_tickers, and filer_sic).
 */
async function getThreeSpreadSicIndex(force = false): Promise<Map<string, SicRegistryEntry>> {
  const cacheKey = '3spread-sic-index';
  const cached = getCached<Map<string, SicRegistryEntry>>(cacheKey, force);
  if (cached) return cached;

  const index = new Map<string, SicRegistryEntry>();
  if (!isThreeSpreadConfigured()) {
    return index;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  // Bounded 14-day windows across the recent quarterly reporting cycle
  const windows: Array<{ start: string; end: string }> = [];
  for (let offset = 0; offset < 56; offset += 14) {
    windows.push({
      start: shiftDaysIso(todayIso, -(offset + 13)),
      end: shiftDaysIso(todayIso, -offset),
    });
  }

  const queries: Array<{ formType: string; start: string; end: string }> = [];
  for (const w of windows) {
    queries.push({ formType: '10-Q', start: w.start, end: w.end });
  }
  for (const w of windows.slice(0, 2)) {
    queries.push({ formType: '10-K', start: w.start, end: w.end });
  }

  const batches = await runWithConcurrency(queries, 4, async (q) => {
    try {
      const res = await fetchThreeSpreadJson<{ data?: ThreeSpreadFilingLite[] }>('/v1/financials', {
        form_type: q.formType,
        accepted_start: q.start,
        accepted_end: q.end,
        limit: 100,
      });
      if (Array.isArray(res?.data)) return res.data;
      if (Array.isArray(res)) return res as ThreeSpreadFilingLite[];
      return [];
    } catch {
      return [];
    }
  });

  for (const batch of batches) {
    for (const row of batch) {
      const rawSic = row?.filer_sic ?? row?.sic;
      const sicDigits = rawSic !== null && rawSic !== undefined ? String(rawSic).replace(/\D/g, '') : '';
      if (!sicDigits) continue;
      const normKey = normalizeCompanyMatchKey(row?.filer_name);
      if (!normKey) continue;
      const ticker =
        Array.isArray(row?.filer_tickers) && row.filer_tickers.length > 0 && row.filer_tickers[0]
          ? String(row.filer_tickers[0]).trim().toUpperCase()
          : null;
      const cik = row?.cik !== undefined && row?.cik !== null ? String(row.cik).padStart(10, '0') : '';

      if (!index.has(normKey)) {
        index.set(normKey, { cik, sic: sicDigits, ticker });
      }
      if (ticker) {
        const tickerKey = `TICKER::${ticker}`;
        if (!index.has(tickerKey)) {
          index.set(tickerKey, { cik, sic: sicDigits, ticker });
        }
      }
    }
  }

  if (index.size > 0) {
    setCached(cacheKey, index, SIC_INDEX_TTL_MS);
  }
  return index;
}

interface YahooSectorLookupResult {
  sectorId: SectorId | null;
  ticker: string | null;
  isFundOrEtf: boolean;
}

function hasReasonableNameOverlap(queryKey: string, candidateName: string): boolean {
  const candKey = normalizeCompanyMatchKey(candidateName);
  if (!queryKey || !candKey) return false;
  if (queryKey === candKey || candKey.startsWith(queryKey) || queryKey.startsWith(candKey)) {
    return true;
  }
  const qTokens = queryKey.split(' ').filter((t) => t.length >= 2);
  const cTokens = new Set(candKey.split(' ').filter((t) => t.length >= 2));
  if (qTokens.length === 0 || cTokens.size === 0) return false;
  // Require the primary distinguishing token (first token) to match
  return cTokens.has(qTokens[0]);
}

/**
 * Bounded fallback lookup via Yahoo Finance Search for operating equities not matched
 * by the 3spread SEC SIC index. Explicitly rejects ETFs/funds so they remain Unclassified.
 */
async function lookupYahooEquitySector(
  issuerName: string,
  knownTicker?: string | null
): Promise<YahooSectorLookupResult> {
  const normKey = normalizeCompanyMatchKey(issuerName);
  const cacheKey = `yahoo-sector:${knownTicker || normKey}`;
  const cached = getCached<YahooSectorLookupResult>(cacheKey, false);
  if (cached) return cached;

  const queryTerm = (knownTicker || normKey || issuerName).trim().slice(0, 60);
  if (!queryTerm) {
    return { sectorId: null, ticker: null, isFundOrEtf: false };
  }

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      queryTerm
    )}&quotesCount=5&newsCount=0`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': YAHOO_USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6_000),
    });

    if (!resp.ok) {
      return { sectorId: null, ticker: null, isFundOrEtf: false };
    }

    const json: any = await resp.json();
    const quotes: any[] = Array.isArray(json?.quotes) ? json.quotes : [];

    // First look for an equity quote matching the issuer/ticker with a valid GICS sector
    for (const q of quotes) {
      const qType = String(q?.quoteType || '').toUpperCase();
      const qSymbol = typeof q?.symbol === 'string' ? q.symbol.trim().toUpperCase() : '';
      const qName = String(q?.longname || q?.shortname || '');

      if (qType === 'EQUITY') {
        const tickerMatches = knownTicker ? qSymbol === knownTicker.toUpperCase() : false;
        const nameMatches = hasReasonableNameOverlap(normKey, qName);
        if (!tickerMatches && !nameMatches) continue;

        const mappedSector = mapMarketSectorToGicsSector(q?.sector);
        if (mappedSector) {
          return setCached(
            cacheKey,
            {
              sectorId: mappedSector,
              ticker: /^[A-Z]{1,6}(?:[.-][A-Z])?$/.test(qSymbol) ? qSymbol : null,
              isFundOrEtf: false,
            },
            YAHOO_SECTOR_TTL_MS
          );
        }
      }
    }

    // If top match is explicitly an ETF / MUTUALFUND / INDEX, mark as unclassified fund
    const first = quotes[0];
    const firstType = String(first?.quoteType || '').toUpperCase();
    const isFund =
      firstType === 'ETF' ||
      firstType === 'MUTUALFUND' ||
      firstType === 'INDEX' ||
      firstType === 'CLOSEDENDFUND';

    return setCached(
      cacheKey,
      { sectorId: null, ticker: null, isFundOrEtf: isFund },
      YAHOO_SECTOR_TTL_MS
    );
  } catch {
    return { sectorId: null, ticker: null, isFundOrEtf: false };
  }
}

/**
 * Classifies institutional 13F cohort securities into the 11 GICS sectors using a
 * deterministic, auditable 4-step pipeline:
 * 1. Direct single-sector SPDR ETF match
 * 2. Explicit exclusion of broad-market / multi-sector ETFs and funds
 * 3. 3spread SEC filing SIC registry -> documented SIC-to-GICS mapping
 * 4. Bounded Yahoo Finance operating-equity sector fallback (top unmatched equities by USD value)
 * Unmatched or non-operating instruments remain explicitly Unclassified.
 */
async function classifyCohortSecurities(
  accumulation: InstitutionalAccumulationRow[],
  force = false
): Promise<Map<string, ClassifiedSecurityMeta>> {
  const result = new Map<string, ClassifiedSecurityMeta>();
  if (accumulation.length === 0) return result;

  const sicIndex = await getThreeSpreadSicIndex(force);
  const unmatchedCandidates: InstitutionalAccumulationRow[] = [];

  for (const sec of accumulation) {
    if (!sec.cusip || result.has(sec.cusip)) continue;

    // 1. Direct Select Sector SPDR ETF match
    const directEtfSector = matchDirectSectorEtf(sec.issuerName, sec.ticker);
    if (directEtfSector) {
      result.set(sec.cusip, {
        sectorId: directEtfSector,
        method: 'SECTOR_ETF',
        ticker: sec.ticker || null,
      });
      continue;
    }

    // 2. Broad-market / multi-sector ETFs, bond funds, and index trusts remain explicitly Unclassified
    if (isBroadMarketOrMultiSectorFund(sec.issuerName, sec.titleOfClass)) {
      result.set(sec.cusip, {
        sectorId: null,
        method: 'UNCLASSIFIED_FUND',
        ticker: sec.ticker || null,
      });
      continue;
    }

    // 3. 3spread SEC filing SIC index match
    const normKey = normalizeCompanyMatchKey(sec.issuerName);
    const sicEntry =
      (sec.ticker ? sicIndex.get(`TICKER::${sec.ticker.toUpperCase()}`) : undefined) ||
      (normKey ? sicIndex.get(normKey) : undefined);

    if (sicEntry) {
      const mapped = mapSicToGicsSector(sicEntry.sic, sec.issuerName);
      if (mapped) {
        result.set(sec.cusip, {
          sectorId: mapped,
          method: '3SPREAD_SIC',
          sic: sicEntry.sic,
          ticker: sec.ticker || sicEntry.ticker || null,
        });
        continue;
      }
      // Explicitly unassignable fund/SPAC SIC code (6722, 6726, 6770)
      if (sicEntry.sic === '6722' || sicEntry.sic === '6726' || sicEntry.sic === '6770') {
        result.set(sec.cusip, {
          sectorId: null,
          method: 'UNCLASSIFIED_FUND',
          sic: sicEntry.sic,
          ticker: sec.ticker || sicEntry.ticker || null,
        });
        continue;
      }
    }

    unmatchedCandidates.push(sec);
  }

  // 4. Bounded Yahoo Finance operating-equity fallback prioritized by institutional USD value
  const prioritized = [...unmatchedCandidates]
    .sort((a, b) => b.totalValueUsd - a.totalValueUsd)
    .slice(0, MAX_YAHOO_FALLBACK_LOOKUPS);

  await runWithConcurrency(prioritized, 6, async (sec) => {
    const lookup = await lookupYahooEquitySector(sec.issuerName, sec.ticker);
    if (lookup.sectorId) {
      result.set(sec.cusip, {
        sectorId: lookup.sectorId,
        method: 'MARKET_SECTOR',
        ticker: sec.ticker || lookup.ticker || null,
      });
    } else if (lookup.isFundOrEtf) {
      result.set(sec.cusip, {
        sectorId: null,
        method: 'UNCLASSIFIED_FUND',
        ticker: sec.ticker || null,
      });
    } else {
      result.set(sec.cusip, {
        sectorId: null,
        method: 'UNCLASSIFIED_UNKNOWN',
        ticker: sec.ticker || null,
      });
    }
  });

  // Remaining beyond bounded cap are recorded honestly as Unclassified
  for (const sec of unmatchedCandidates) {
    if (!result.has(sec.cusip)) {
      result.set(sec.cusip, {
        sectorId: null,
        method: 'UNCLASSIFIED_UNKNOWN',
        ticker: sec.ticker || null,
      });
    }
  }

  return result;
}

interface RawInsiderRatioPayload {
  sic?: string | null;
  since?: string | null;
  until?: string | null;
  buys_dollars?: number | string | null;
  sells_dollars?: number | string | null;
  buys_count?: number | string | null;
  sells_count?: number | string | null;
  buy_sell_ratio?: number | string | null;
}

function toFiniteNumberOrZero(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

async function fetchSingleSicInsiderRatio(
  sic: string,
  windowDays: number,
  force = false
): Promise<RawInsiderRatioPayload | null> {
  const cacheKey = `insider-sic:${sic}:${windowDays}`;
  const cached = getCached<RawInsiderRatioPayload | null>(cacheKey, force);
  if (cached !== null) return cached;

  try {
    const raw = await fetchThreeSpreadJson<any>('/v1/insiders/buy-sell-ratio', {
      sic,
      window_days: windowDays,
    });
    const payload: RawInsiderRatioPayload =
      raw?.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw;
    if (!payload || typeof payload !== 'object') {
      return setCached(cacheKey, null, INSIDER_TTL_MS);
    }
    return setCached(cacheKey, payload, INSIDER_TTL_MS);
  } catch (err) {
    if (err instanceof ThreeSpreadError && (err.requiresKey || err.rateLimited)) {
      throw err;
    }
    return null;
  }
}

/**
 * Aggregates Form 4 insider buying and selling across each GICS sector's documented
 * representative 4-digit SIC codes using 3spread's GET /v1/insiders/buy-sell-ratio.
 * Strictly separate from institutional 13F holdings.
 */
async function fetchSectorInsiderSentimentMap(
  windowDays: number,
  force = false
): Promise<{
  bySector: Record<SectorId, SectorInsiderSentiment>;
  anyAvailable: boolean;
  since: string | null;
  until: string | null;
  note: string;
}> {
  const makeUnavailable = (reason: string): SectorInsiderSentiment => ({
    available: false,
    windowDays,
    since: null,
    until: null,
    buysDollars: null,
    sellsDollars: null,
    buysCount: null,
    sellsCount: null,
    buySellRatio: null,
    sicCodesQueried: [],
    sicCodesWithActivity: 0,
    sentiment: 'UNAVAILABLE',
    unavailableReason: reason,
  });

  const bySector = {} as Record<SectorId, SectorInsiderSentiment>;

  if (!isThreeSpreadConfigured()) {
    const msg = 'Configure 3SPREAD API key in System Settings to enable Form 4 insider activity.';
    for (const s of GICS_SECTORS) {
      bySector[s.id] = makeUnavailable(msg);
    }
    return {
      bySector,
      anyAvailable: false,
      since: null,
      until: null,
      note: msg,
    };
  }

  const allUniqueSics = Array.from(
    new Set(GICS_SECTORS.flatMap((s) => [...s.representativeSics]))
  );

  const sicResultMap = new Map<string, RawInsiderRatioPayload | null>();
  let abortedReason: string | null = null;

  try {
    await runWithConcurrency(allUniqueSics, 6, async (sic) => {
      if (abortedReason) return;
      const data = await fetchSingleSicInsiderRatio(sic, windowDays, force);
      sicResultMap.set(sic, data);
    });
  } catch (err) {
    if (err instanceof ThreeSpreadError && err.requiresKey) {
      abortedReason = '3SPREAD API key required or rejected for Form 4 insider endpoints.';
    } else if (err instanceof ThreeSpreadError && err.rateLimited) {
      abortedReason = '3SPREAD API rate limit reached while querying Form 4 insider sentiment.';
    } else {
      abortedReason = redactErrorMessage(err, 'Unable to load Form 4 insider sentiment.');
    }
  }

  if (abortedReason && sicResultMap.size === 0) {
    for (const s of GICS_SECTORS) {
      bySector[s.id] = makeUnavailable(abortedReason);
    }
    return {
      bySector,
      anyAvailable: false,
      since: null,
      until: null,
      note: abortedReason,
    };
  }

  let globalSince: string | null = null;
  let globalUntil: string | null = null;
  let anyAvailable = false;

  for (const sector of GICS_SECTORS) {
    let buysDollars = 0;
    let sellsDollars = 0;
    let buysCount = 0;
    let sellsCount = 0;
    let sicsWithActivity = 0;
    let sectorSince: string | null = null;
    let sectorUntil: string | null = null;

    for (const sic of sector.representativeSics) {
      const payload = sicResultMap.get(sic);
      if (!payload) continue;
      if (payload.since && (!sectorSince || payload.since < sectorSince)) {
        sectorSince = payload.since;
      }
      if (payload.until && (!sectorUntil || payload.until > sectorUntil)) {
        sectorUntil = payload.until;
      }
      const bCount = Math.max(0, Math.round(toFiniteNumberOrZero(payload.buys_count)));
      const sCount = Math.max(0, Math.round(toFiniteNumberOrZero(payload.sells_count)));
      const bDollars = Math.max(0, toFiniteNumberOrZero(payload.buys_dollars));
      const sDollars = Math.max(0, toFiniteNumberOrZero(payload.sells_dollars));

      if (bCount > 0 || sCount > 0 || bDollars > 0 || sDollars > 0) {
        sicsWithActivity += 1;
        buysCount += bCount;
        sellsCount += sCount;
        buysDollars += bDollars;
        sellsDollars += sDollars;
      }
    }

    if (sectorSince && (!globalSince || sectorSince < globalSince)) globalSince = sectorSince;
    if (sectorUntil && (!globalUntil || sectorUntil > globalUntil)) globalUntil = sectorUntil;

    const totalDollars = buysDollars + sellsDollars;
    const totalTx = buysCount + sellsCount;
    const buySellRatio = totalDollars > 0 ? buysDollars / totalDollars : null;
    const sentiment = classifyInsiderSentiment({ buySellRatio, buysCount, sellsCount });
    const hasData = totalTx > 0 && totalDollars > 0;
    if (hasData) anyAvailable = true;

    bySector[sector.id] = {
      available: hasData,
      windowDays,
      since: sectorSince,
      until: sectorUntil,
      buysDollars: hasData ? buysDollars : null,
      sellsDollars: hasData ? sellsDollars : null,
      buysCount: hasData ? buysCount : null,
      sellsCount: hasData ? sellsCount : null,
      buySellRatio,
      sicCodesQueried: [...sector.representativeSics],
      sicCodesWithActivity: sicsWithActivity,
      sentiment,
      unavailableReason: !hasData
        ? `No qualifying Form 4 open-market insider transactions reported across representative SIC codes (${sector.representativeSics.join(
            ', '
          )}) in the last ${windowDays} days.`
        : totalTx < 3
        ? `Low sample size (${totalTx} transaction${totalTx === 1 ? '' : 's'}) across representative SIC codes; directional label withheld.`
        : null,
    };
  }

  return {
    bySector,
    anyAvailable,
    since: globalSince,
    until: globalUntil,
    note: anyAvailable
      ? `Form 4 open-market insider buy/sell dollar volume aggregated via 3spread over the trailing ${windowDays}-day window across representative 4-digit SEC SIC codes per sector. Separate from quarterly Form 13F institutional holdings.`
      : abortedReason ||
        `No qualifying Form 4 insider activity was returned across representative sector SIC codes for the trailing ${windowDays}-day window.`,
  };
}

function createEmptyCoverage(): SectorClassificationCoverage {
  return {
    totalSecuritiesInCohort: 0,
    classifiedSecuritiesCount: 0,
    unclassifiedSecuritiesCount: 0,
    unclassifiedFundOrEtfCount: 0,
    unclassifiedUnknownCount: 0,
    classifiedValueUsd: 0,
    unclassifiedValueUsd: 0,
    classifiedValuePct: null,
    threeSpreadSicMatchedCount: 0,
    marketSectorMatchedCount: 0,
    directSectorEtfMatchedCount: 0,
  };
}

export function sanitizeInsiderWindowDays(raw: unknown): number {
  const allowed = [30, 90, 180, 365];
  const parsed = Number(raw);
  if (allowed.includes(parsed)) return parsed;
  return 90;
}

/**
 * Orchestrates the complete Sector Rotation payload:
 * - Market Sector Performance (Yahoo Finance daily bars for 11 Select Sector SPDR ETFs vs SPY)
 * - Institutional Sector Positioning (3spread comparable-period Form 13F cohort aggregated by GICS sector)
 * - Insider Sector Sentiment (3spread Form 4 buy/sell ratios across representative sector SIC codes)
 *
 * Designed for graceful partial availability: if 3spread is unconfigured or rate-limited,
 * Market Sector Performance remains fully functional while institutional & insider sections
 * transparently report unavailability without fabricating values.
 */
export async function getSectorRotationData(params: {
  period?: string;
  windowDays?: number;
  force?: boolean;
}): Promise<SectorRotationResponse> {
  const requestedPeriod = sanitizePeriodInput(params.period);
  const windowDays = sanitizeInsiderWindowDays(params.windowDays);
  const force = Boolean(params.force);

  // 1. Market performance pipeline (SPY + 11 Select Sector SPDR ETFs)
  const marketPromise = (async () => {
    const tickers = [BENCHMARK_ETF.ticker, ...GICS_SECTORS.map((s) => s.etfTicker)];
    const fetched = await runWithConcurrency(tickers, 6, async (ticker) => ({
      ticker,
      result: await fetchDailyEtfHistory(ticker, force),
    }));
    const historyMap = new Map<string, { bars: SectorPriceHistoryPoint[]; error: string | null }>();
    for (const item of fetched) {
      historyMap.set(item.ticker, item.result);
    }
    return historyMap;
  })();

  // 2. Institutional 13F cohort positioning pipeline (reuses threeSpreadService comparable cohort)
  const institutionalPromise = (async (): Promise<{
    snapshot: CohortSnapshot | null;
    classificationByCusip: Map<string, ClassifiedSecurityMeta>;
    available: boolean;
    requiresKey: boolean;
    rateLimited: boolean;
    error: string | null;
  }> => {
    if (!isThreeSpreadConfigured()) {
      return {
        snapshot: null,
        classificationByCusip: new Map(),
        available: false,
        requiresKey: true,
        rateLimited: false,
        error:
          '3SPREAD API key is not configured. Configure it in System Settings (SETT) to load quarterly Form 13F institutional positioning.',
      };
    }

    try {
      const snapshot = await getComparableCohortSnapshot(requestedPeriod || undefined, force);
      const classificationByCusip = await classifyCohortSecurities(snapshot.accumulation, force);
      return {
        snapshot,
        classificationByCusip,
        available: snapshot.managersAnalyzed > 0,
        requiresKey: false,
        rateLimited: false,
        error:
          snapshot.managersAnalyzed > 0
            ? null
            : 'Insufficient matched dual-period Form 13F filings found for the selected reporting period.',
      };
    } catch (err) {
      if (err instanceof ThreeSpreadError) {
        return {
          snapshot: null,
          classificationByCusip: new Map(),
          available: false,
          requiresKey: Boolean(err.requiresKey),
          rateLimited: Boolean(err.rateLimited),
          error: err.message,
        };
      }
      return {
        snapshot: null,
        classificationByCusip: new Map(),
        available: false,
        requiresKey: false,
        rateLimited: false,
        error: redactErrorMessage(err, 'Failed to load institutional Form 13F sector positioning.'),
      };
    }
  })();

  // 3. Insider Form 4 sentiment pipeline (strictly separate from 13F holdings)
  const insiderPromise = fetchSectorInsiderSentimentMap(windowDays, force);

  const [historyMap, instOutcome, insiderOutcome] = await Promise.all([
    marketPromise,
    institutionalPromise,
    insiderPromise,
  ]);

  // Compute benchmark (SPY) period returns
  const spyHistory = historyMap.get(BENCHMARK_ETF.ticker) || {
    bars: [],
    error: 'Benchmark history unavailable.',
  };
  const benchmarkReturns = {} as Record<SectorPerformancePeriod, SectorPeriodReturnPoint>;
  for (const period of PERFORMANCE_PERIODS) {
    benchmarkReturns[period] = computePeriodReturn(spyHistory.bars, period);
  }
  const latestSpy = spyHistory.bars.length > 0 ? spyHistory.bars[spyHistory.bars.length - 1] : null;

  // Aggregate institutional cohort holdings by sector (with strict anti-double-counting & coverage tracking)
  const institutionalAgg = instOutcome.snapshot
    ? aggregateInstitutionalBySector({
        accumulation: instOutcome.snapshot.accumulation,
        changes: instOutcome.snapshot.changes,
        classificationByCusip: instOutcome.classificationByCusip,
        reportingPeriod: instOutcome.snapshot.reportingPeriod,
        previousPeriod: instOutcome.snapshot.previousPeriod,
        comparableManagersTotal: instOutcome.snapshot.managersAnalyzed,
        available: instOutcome.available,
      })
    : {
        bySector: aggregateInstitutionalBySector({
          accumulation: [],
          changes: [],
          classificationByCusip: new Map(),
          reportingPeriod: null,
          previousPeriod: null,
          comparableManagersTotal: 0,
          available: false,
        }).bySector,
        coverage: createEmptyCoverage(),
      };

  // Assemble unified 11-sector items
  const sectors: SectorRotationItem[] = GICS_SECTORS.map((sectorDef) => {
    const etfHist = historyMap.get(sectorDef.etfTicker) || {
      bars: [],
      error: `Market history unavailable for ${sectorDef.etfTicker}.`,
    };
    const market = buildSectorMarketPerformance({
      sector: sectorDef,
      bars: etfHist.bars,
      benchmarkReturns,
      unavailableReason: etfHist.error,
    });

    return {
      id: sectorDef.id,
      name: sectorDef.name,
      shortName: sectorDef.shortName,
      etfTicker: sectorDef.etfTicker,
      etfName: sectorDef.etfName,
      market,
      institutional: institutionalAgg.bySector[sectorDef.id],
      insider: insiderOutcome.bySector[sectorDef.id],
    };
  });

  const overviewByPeriod = finalizeMarketRankingsAndOverview(sectors);

  return {
    success: true,
    fetchedAt: new Date().toISOString(),
    benchmark: {
      ticker: BENCHMARK_ETF.ticker,
      name: BENCHMARK_ETF.name,
      latestPrice: latestSpy ? latestSpy.close : null,
      latestDate: latestSpy ? latestSpy.date : null,
      returns: benchmarkReturns,
      history: spyHistory.bars,
      unavailableReason: spyHistory.bars.length === 0 ? spyHistory.error : null,
    },
    overviewByPeriod,
    sectors,
    institutionalMeta: {
      available: instOutcome.available,
      requiresKey: instOutcome.requiresKey,
      rateLimited: instOutcome.rateLimited,
      error: instOutcome.error,
      reportingPeriod: instOutcome.snapshot?.reportingPeriod || null,
      previousPeriod: instOutcome.snapshot?.previousPeriod || null,
      availablePeriods: instOutcome.snapshot?.availablePeriods || [],
      managersAnalyzed: instOutcome.snapshot?.managersAnalyzed || 0,
      freshness: instOutcome.snapshot?.freshness || null,
      coverage: institutionalAgg.coverage,
    },
    insiderMeta: {
      available: insiderOutcome.anyAvailable,
      windowDays,
      since: insiderOutcome.since,
      until: insiderOutcome.until,
      note: insiderOutcome.note,
    },
    methodology: {
      marketPerformance:
        'Historical price returns across 1W, 1M, 3M, and 6M using daily closing prices for the 11 Select Sector SPDR ETFs benchmarked against SPY. Relative Strength equals Sector Return minus SPY Return over the identical lookback window.',
      rotationClassification:
        'Deterministic quadrant model comparing selected-period Relative Strength vs SPY against near-term Relative Strength (1W for 1M view; 1M for 3M/6M views; 1W vs 1M baseline for 1W view): Leading (+/+), Weakening (+/-), Improving (-/+), Lagging (-/-). Reflects historical relative performance, not predictive forecasts.',
      institutionalPositioning:
        'Aggregated from matched dual-period SEC Form 13F-HR filings via 3spread (delayed quarterly disclosures filed up to 45 days after quarter-end, not real-time flows). Managers are counted once per sector by net share change across classified holdings; broad-market ETFs and unmapped securities remain excluded as Unclassified.',
      insiderSentiment:
        'Form 4 open-market insider buying and selling dollar volumes via 3spread (/v1/insiders/buy-sell-ratio) across representative 4-digit SEC SIC codes per sector. Strictly separated from Form 13F institutional holdings; requires >=3 transactions before assigning Net Buying (>=40%), Balanced (15%-40%), or Net Selling (<15%).',
    },
  };
}

import {
  buildCohortAccumulationAndChanges,
  buildInstitutionalHoldingsView,
  buildInvestorProfile,
  getPreviousQuarterEnd,
  normalizeCik,
  normalizeCusip,
  normalizePeriodDate,
  parseNumericField,
  selectCanonicalFilings,
  type ManagerPeriodComparisonPair,
  type ThreeSpreadFilingSummary,
  type ThreeSpreadHoldingRecord,
} from '../utils/institutionalActivity';
import type {
  InstitutionalAccumulationRow,
  InstitutionalDataFreshness,
  InstitutionalHoldingRow,
  InstitutionalHoldingsSummary,
  InstitutionalInvestorProfile,
  InstitutionalManagerDirectoryItem,
  InstitutionalPositionChangeRow,
} from '../types';
import {
  getActiveApiKey,
  getEnvApiKey,
  redactSecrets,
  setRuntimeApiKey,
  validateApiKeyInput,
} from './apiCredentials';

const THREESPREAD_BASE_URL = 'https://api.3spread.com';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CACHE_ENTRIES = 250;

// Conservative in-process guard well below Community tier limits (600 req/min, 10,000 req/day)
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_MINUTE = 180;
const requestTimestamps: number[] = [];
let upstreamRateLimitUntil = 0;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

export class ThreeSpreadError extends Error {
  status: number;
  requiresKey?: boolean;
  rateLimited?: boolean;

  constructor(
    message: string,
    options: { status?: number; requiresKey?: boolean; rateLimited?: boolean } = {}
  ) {
    super(message);
    this.name = 'ThreeSpreadError';
    this.status = options.status ?? 500;
    this.requiresKey = options.requiresKey;
    this.rateLimited = options.rateLimited;
  }
}

export function getEnvThreeSpreadApiKey(): string {
  return getEnvApiKey('3SPREAD_API_KEY');
}

export function setRuntimeThreeSpreadApiKey(rawKey: string): boolean {
  // Never overwrite environment-provided credentials through the UI
  if (getEnvThreeSpreadApiKey()) {
    return false;
  }
  const validation = validateApiKeyInput(rawKey, '3SPREAD API key');
  if (!validation.ok || validation.skipped) {
    return false;
  }
  const result = setRuntimeApiKey('3SPREAD_API_KEY', validation.value || '');
  if (result.updated) {
    cache.clear();
  }
  return !result.blockedByEnv;
}

export function getThreeSpreadApiKey(): string {
  return getActiveApiKey('3SPREAD_API_KEY');
}

export function isThreeSpreadConfigured(): boolean {
  return Boolean(getThreeSpreadApiKey());
}

export function clearThreeSpreadCache(): void {
  cache.clear();
}

function getCached<T>(key: string, force = false): T | null {
  if (force) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number): T {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

export function sanitizeTickerInput(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (!/^[A-Z0-9.-]{1,10}$/.test(cleaned)) return '';
  return cleaned;
}

export function sanitizeCusipInput(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = normalizeCusip(raw);
  return /^[A-Z0-9]{9}$/.test(cleaned) ? cleaned : '';
}

export function sanitizeCikInput(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const cleaned = normalizeCik(raw);
  return /^\d{1,10}$/.test(cleaned) ? cleaned : '';
}

export function sanitizePeriodInput(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const norm = normalizePeriodDate(raw);
  return norm && /^\d{4}-\d{2}-\d{2}$/.test(norm) ? norm : '';
}

export function sanitizeSearchInput(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80);
}

function enforceRateLimitGuard(): void {
  const now = Date.now();
  if (now < upstreamRateLimitUntil) {
    const retrySec = Math.max(1, Math.ceil((upstreamRateLimitUntil - now) / 1000));
    throw new ThreeSpreadError(
      `3spread API rate limit cooldown active. Retry in ${retrySec}s.`,
      { status: 429, rateLimited: true }
    );
  }
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    throw new ThreeSpreadError(
      'Local 3spread API request rate guard reached. Please wait a moment and retry.',
      { status: 429, rateLimited: true }
    );
  }
  requestTimestamps.push(now);
}

export async function fetchThreeSpreadJson<T>(
  endpointPath: string,
  queryParams?: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
  const apiKey = getThreeSpreadApiKey();
  if (!apiKey) {
    throw new ThreeSpreadError(
      'THREESPREAD_API_KEY is not configured. Set THREESPREAD_API_KEY in server environment variables (.env) to enable live Form 13F institutional holdings data from 3spread.',
      { status: 503, requiresKey: true }
    );
  }

  if (!endpointPath.startsWith('/v1/') || endpointPath.includes('..') || endpointPath.includes('://')) {
    throw new ThreeSpreadError('Invalid 3spread API endpoint path.', { status: 400 });
  }

  enforceRateLimitGuard();

  const url = new URL(endpointPath, THREESPREAD_BASE_URL);
  if (url.origin !== THREESPREAD_BASE_URL) {
    throw new ThreeSpreadError('Disallowed upstream host.', { status: 400 });
  }

  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new ThreeSpreadError('3spread API request timed out. Please try again.', { status: 504 });
    }
    throw new ThreeSpreadError('Unable to reach 3spread API. Check network connectivity.', {
      status: 502,
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new ThreeSpreadError(
      '3spread API rejected the configured THREESPREAD_API_KEY. Verify the key in your server environment.',
      { status: 401, requiresKey: true }
    );
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after') || '15');
    const cooldownMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000;
    upstreamRateLimitUntil = Date.now() + Math.min(cooldownMs, 60_000);
    throw new ThreeSpreadError(
      '3spread API rate limit reached (Community tier: 600 req/min, 10,000 req/day). Please retry shortly.',
      { status: 429, rateLimited: true }
    );
  }

  if (response.status === 404) {
    throw new ThreeSpreadError('Requested resource was not found in 3spread.', { status: 404 });
  }

  if (!response.ok) {
    let detail = `3spread API returned HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      const errObj = errBody?.error;
      if (errObj && typeof errObj.message === 'string') {
        const codePrefix = typeof errObj.code === 'string' ? `[${errObj.code}] ` : '';
        detail = `3spread API error (${response.status}): ${codePrefix}${redactSecrets(errObj.message, {
          extraSecrets: [apiKey],
          maxLength: 220,
        })}`;
      } else if (typeof errBody?.detail === 'string') {
        detail = `3spread API error (${response.status}): ${redactSecrets(errBody.detail, {
          extraSecrets: [apiKey],
          maxLength: 220,
        })}`;
      } else if (typeof errBody?.message === 'string') {
        detail = `3spread API error (${response.status}): ${redactSecrets(errBody.message, {
          extraSecrets: [apiKey],
          maxLength: 220,
        })}`;
      }
    } catch {
      // ignore body parse failures
    }
    throw new ThreeSpreadError(redactSecrets(detail, { extraSecrets: [apiKey], maxLength: 240 }), {
      status: response.status >= 500 ? 502 : response.status,
    });
  }

  return (await response.json()) as T;
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function isStandardQuarterEnd(isoDate: string): boolean {
  return /-(?:03-31|06-30|09-30|12-31)$/.test(isoDate);
}

/**
 * Fetches dataset freshness from GET /v1/data-as-of (cached 5 minutes).
 * Verified against 3spread OpenAPI FamilyAsOf schema:
 * accepted_time_max, period_of_report_max, filing_count.
 */
export async function getDataFreshness(force = false): Promise<InstitutionalDataFreshness> {
  const cacheKey = 'data-as-of';
  const cached = getCached<InstitutionalDataFreshness>(cacheKey, force);
  if (cached) return cached;

  type FamilyAsOfShape = {
    family?: string;
    accepted_time_max?: string | null;
    period_of_report_max?: string | null;
    latest_accepted_time?: string | null;
    latest_period_of_report?: string | null;
    filing_count?: number;
  };

  const raw = await fetchThreeSpreadJson<{
    families?: Record<string, FamilyAsOfShape> | FamilyAsOfShape[];
  }>('/v1/data-as-of');

  let ihFamily: FamilyAsOfShape | null = null;

  if (Array.isArray(raw?.families)) {
    ihFamily =
      raw.families.find((f) => /institutional[_-]?holdings|13f/i.test(String(f.family || ''))) ||
      null;
  } else if (raw?.families && typeof raw.families === 'object') {
    for (const [k, v] of Object.entries(raw.families)) {
      if (/institutional[_-]?holdings|13f/i.test(k)) {
        ihFamily = v;
        break;
      }
    }
  }

  const latestAccepted = ihFamily?.accepted_time_max || ihFamily?.latest_accepted_time || null;
  const latestPeriod = ihFamily?.period_of_report_max || ihFamily?.latest_period_of_report || null;

  const result: InstitutionalDataFreshness = {
    provider: '3spread',
    latestAcceptedTime: latestAccepted,
    latestPeriodOfReport: normalizePeriodDate(latestPeriod) || null,
    totalFilingsCount: typeof ihFamily?.filing_count === 'number' ? ihFamily.filing_count : null,
    fetchedAt: new Date().toISOString(),
  };

  return setCached(cacheKey, result, 5 * 60_000);
}

/**
 * Lists canonical 13F HOLDINGS REPORT filings for a given calendar quarter-end reporting period
 * using bounded accepted_time windows (<= 27 days each) to comply with 3spread's 31-day
 * unfiltered scan window policy. Form 13F filings are due within 45 days after quarter-end,
 * with peak submissions in days +25..+52 and early submissions in days +1..+24.
 */
export async function fetchPeriodFilings(
  period: string,
  force = false
): Promise<ThreeSpreadFilingSummary[]> {
  const normPeriod = sanitizePeriodInput(period);
  if (!normPeriod) return [];

  const cacheKey = `period-filings:${normPeriod}`;
  const cached = getCached<ThreeSpreadFilingSummary[]>(cacheKey, force);
  if (cached) return cached;

  const todayIso = new Date().toISOString().slice(0, 10);
  const windows: Array<{ start: string; end: string; limit: number }> = [
    // Primary 13F deadline surge window (days +25..+52 after quarter end = 27-day span)
    {
      start: shiftIsoDate(normPeriod, 25),
      end: shiftIsoDate(normPeriod, 52),
      limit: 1000,
    },
    // Early filers window (days +1..+24 after quarter end = 23-day span)
    {
      start: shiftIsoDate(normPeriod, 1),
      end: shiftIsoDate(normPeriod, 24),
      limit: 500,
    },
  ].filter((w) => w.start <= todayIso);

  const clampedWindows = windows.map((w) => ({
    ...w,
    end: w.end > todayIso ? todayIso : w.end,
  }));

  const batches = await Promise.all(
    clampedWindows.map((w) =>
      fetchThreeSpreadJson<{ data?: ThreeSpreadFilingSummary[] }>('/v1/institutional-holdings', {
        period_start: normPeriod,
        period_end: normPeriod,
        accepted_start: w.start,
        accepted_end: w.end,
        report_type: '13F HOLDINGS REPORT',
        is_amendment: false,
        limit: w.limit,
      })
        .then((res) => (Array.isArray(res?.data) ? res.data : []))
        .catch(() => [] as ThreeSpreadFilingSummary[])
    )
  );

  const byId = new Map<string, ThreeSpreadFilingSummary>();
  for (const batch of batches) {
    for (const row of batch) {
      if (row?.filing_id && !byId.has(row.filing_id)) {
        byId.set(row.filing_id, row);
      }
    }
  }

  const rows = Array.from(byId.values());
  return setCached(cacheKey, rows, 15 * 60_000);
}

/**
 * Discovers recent available 13F reporting periods directly from 3spread freshness metadata
 * and a bounded 28-day accepted_time sample window (strictly within 3spread's 31-day limit).
 */
export async function getAvailableReportingPeriods(force = false): Promise<{
  periods: string[];
  freshness: InstitutionalDataFreshness;
}> {
  const cacheKey = 'available-periods';
  const cached = getCached<{ periods: string[]; freshness: InstitutionalDataFreshness }>(cacheKey, force);
  if (cached) return cached;

  const freshness = await getDataFreshness(force);
  const anchorAccepted =
    normalizePeriodDate(freshness.latestAcceptedTime) || new Date().toISOString().slice(0, 10);
  const windowStart = shiftIsoDate(anchorAccepted, -28);

  const recentFilingsRes = await fetchThreeSpreadJson<{ data?: ThreeSpreadFilingSummary[] }>(
    '/v1/institutional-holdings',
    {
      accepted_start: windowStart,
      accepted_end: anchorAccepted,
      report_type: '13F HOLDINGS REPORT',
      is_amendment: false,
      limit: 500,
    }
  ).catch(() => ({ data: [] as ThreeSpreadFilingSummary[] }));

  const periodCounts = new Map<string, number>();
  const rows = Array.isArray(recentFilingsRes?.data) ? recentFilingsRes.data : [];
  for (const f of rows) {
    const p = normalizePeriodDate(f.period_of_report);
    if (!p || !isStandardQuarterEnd(p)) continue;
    periodCounts.set(p, (periodCounts.get(p) || 0) + 1);
  }

  // Prefer the most recent standard quarter-end with meaningful filing volume (>= 10 filings)
  const sortedByRecency = Array.from(periodCounts.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  const majorPopulated = sortedByRecency.find(([, count]) => count >= 10)?.[0];
  const mostRecentObserved = sortedByRecency[0]?.[0];

  // Fallback anchor derived from freshness watermark if recent 28-day window was mid-quarter
  let anchor = majorPopulated || mostRecentObserved || null;
  if (!anchor && freshness.latestPeriodOfReport && isStandardQuarterEnd(freshness.latestPeriodOfReport)) {
    anchor = freshness.latestPeriodOfReport;
  }
  if (!anchor) {
    // Derive the most recently completed calendar quarter-end before anchorAccepted
    const [yStr, mStr] = anchorAccepted.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    if (m <= 3) anchor = `${y - 1}-12-31`;
    else if (m <= 6) anchor = `${y}-03-31`;
    else if (m <= 9) anchor = `${y}-06-30`;
    else anchor = `${y}-09-30`;
  }

  const periods: string[] = [];
  let cursor: string | null = anchor;
  for (let i = 0; i < 6 && cursor; i++) {
    periods.push(cursor);
    cursor = getPreviousQuarterEnd(cursor);
  }

  const merged = Array.from(new Set(periods))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 8);

  return setCached(cacheKey, { periods: merged, freshness }, 10 * 60_000);
}

export interface ResolvedIssuerInfo {
  ticker: string | null;
  cik: string | null;
  companyName: string | null;
  cusip: string | null;
  searchIssuerTerm: string | null;
}

function simplifyIssuerSearchTerm(companyName: string): string {
  return companyName
    .replace(/,/g, ' ')
    .replace(
      /(?:^|\s)(?:INC|CORP|CORPORATION|COMPANY|CO|LTD|LIMITED|PLC|N\.?V|S\.?A|HOLDINGS?|GROUP|DELAWARE|NEW)\.?(?=\s|$)/gi,
      ' '
    )
    .replace(/^\s*THE\s+/i, '')
    .replace(/\./g, ' ')
    .replace(/[^A-Za-z0-9\s&-]/g, ' ')
    .replace(/^[\s&-]+|[\s&-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a ticker symbol or CUSIP to canonical issuer metadata & primary 9-char CUSIP
 * exclusively through 3spread endpoints (/v1/coverage/by-issuer, /v1/beneficial-ownership,
 * and /v1/institutional-holdings/holdings).
 */
export async function resolveSecurityViaThreeSpread(params: {
  ticker?: string;
  cusip?: string;
  issuer?: string;
  period?: string;
  force?: boolean;
}): Promise<ResolvedIssuerInfo> {
  const ticker = sanitizeTickerInput(params.ticker);
  const explicitCusip = sanitizeCusipInput(params.cusip);
  const explicitIssuer = sanitizeSearchInput(params.issuer);

  if (explicitCusip) {
    return {
      ticker: ticker || null,
      cik: null,
      companyName: explicitIssuer || null,
      cusip: explicitCusip,
      searchIssuerTerm: explicitIssuer || null,
    };
  }

  if (!ticker && explicitIssuer) {
    return {
      ticker: null,
      cik: null,
      companyName: explicitIssuer,
      cusip: null,
      searchIssuerTerm: explicitIssuer,
    };
  }

  if (!ticker) {
    return {
      ticker: null,
      cik: null,
      companyName: null,
      cusip: null,
      searchIssuerTerm: null,
    };
  }

  const cacheKey = `resolve-ticker:${ticker}`;
  const cached = getCached<ResolvedIssuerInfo>(cacheKey, params.force);
  if (cached) return cached;

  let cik: string | null = null;
  let companyName: string | null = null;

  try {
    const coverage = await fetchThreeSpreadJson<{
      cik?: string;
      company_name?: string;
      tickers?: string[];
    }>(`/v1/coverage/by-issuer/${encodeURIComponent(ticker)}`);
    cik = normalizeCik(coverage?.cik) || null;
    companyName = coverage?.company_name?.trim() || null;
  } catch (err) {
    if (err instanceof ThreeSpreadError && (err.requiresKey || err.rateLimited)) {
      throw err;
    }
    // 404 or missing issuer coverage: allow falling back to name_of_issuer search if user entered company text
  }

  const searchTerm = companyName ? simplifyIssuerSearchTerm(companyName) || companyName : ticker;
  const upperTarget = searchTerm.toUpperCase();
  const escapedTarget = upperTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactWordRegex = escapedTarget ? new RegExp(`(?:^|\\s)${escapedTarget}(?:\\s|$)`) : null;
  const prefixWordRegex = escapedTarget ? new RegExp(`^${escapedTarget}(?:\\s|$)`) : null;

  const scoreIssuerMatch = (rawIssuerName: string | null | undefined): number => {
    const simplified = simplifyIssuerSearchTerm(rawIssuerName || '').toUpperCase();
    if (!simplified || !upperTarget) return 0;
    if (simplified === upperTarget) return 3;
    if (prefixWordRegex && prefixWordRegex.test(simplified)) return 2;
    if (exactWordRegex && exactWordRegex.test(simplified)) return 1;
    return 0;
  };

  let resolvedCusip: string | null = null;

  // 1. Primary: find dominant equity (SH) CUSIP directly from 3spread 13F holdings stream
  // using exact/word-boundary issuer matching and USD value ranking (prevents substring
  // false positives such as "PINEAPPLE" matching "APPLE").
  if (searchTerm) {
    try {
      const probe = await fetchThreeSpreadJson<{ data?: ThreeSpreadHoldingRecord[] }>(
        '/v1/institutional-holdings/holdings',
        {
          name_of_issuer: searchTerm.split(' ').slice(0, 2).join(' '),
          ...(params.period ? { period_start: params.period, period_end: params.period } : {}),
          sort: 'value',
          order: 'desc',
          limit: 80,
        }
      );
      const rows = Array.isArray(probe?.data) ? probe.data : [];
      const candidates = new Map<
        string,
        { matchTier: number; totalUsd: number; count: number; issuer: string }
      >();

      for (const r of rows) {
        const type = (r.ssh_prnamt_type || 'SH').toUpperCase();
        if (type !== 'SH') continue;
        const c = normalizeCusip(r.cusip);
        if (c.length !== 9) continue;
        const tier = scoreIssuerMatch(r.name_of_issuer);
        if (tier === 0) continue;
        const val = parseNumericField(r.value_usd);
        const entry = candidates.get(c) || {
          matchTier: tier,
          totalUsd: 0,
          count: 0,
          issuer: r.name_of_issuer || '',
        };
        entry.matchTier = Math.max(entry.matchTier, tier);
        entry.totalUsd += val;
        entry.count += 1;
        candidates.set(c, entry);
      }

      const best = Array.from(candidates.entries()).sort(
        (a, b) =>
          b[1].matchTier - a[1].matchTier ||
          b[1].totalUsd - a[1].totalUsd ||
          b[1].count - a[1].count
      )[0];
      if (best) {
        resolvedCusip = best[0];
        if (!companyName && best[1].issuer) {
          companyName = best[1].issuer;
        }
      }
    } catch (err) {
      if (err instanceof ThreeSpreadError && (err.requiresKey || err.rateLimited)) {
        throw err;
      }
    }
  }

  // 2. Fallback: check 3spread Schedule 13D/13G beneficial ownership metadata with strict word-boundary matching
  if (!resolvedCusip && companyName) {
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const bo = await fetchThreeSpreadJson<{
        data?: Array<{ issuer_cusip?: string | null; issuer_name?: string | null }>;
      }>('/v1/beneficial-ownership', {
        issuer_name: searchTerm.split(' ').slice(0, 2).join(' '),
        accepted_start: shiftIsoDate(todayIso, -85),
        accepted_end: todayIso,
        limit: 20,
      });
      const rows = Array.isArray(bo?.data) ? bo.data : [];
      const scored = rows
        .map((r) => {
          const c = normalizeCusip(r.issuer_cusip);
          if (!c || c.length !== 9) return null;
          const score = scoreIssuerMatch(r.issuer_name);
          if (score === 0) return null;
          return { cusip: c, score };
        })
        .filter((x): x is { cusip: string; score: number } => Boolean(x))
        .sort((a, b) => b.score - a.score);
      if (scored.length > 0) {
        resolvedCusip = scored[0].cusip;
      }
    } catch {
      // Non-fatal; holdings view will fall back to name_of_issuer
    }
  }

  const info: ResolvedIssuerInfo = {
    ticker,
    cik,
    companyName,
    cusip: resolvedCusip,
    searchIssuerTerm: searchTerm,
  };

  return setCached(cacheKey, info, 30 * 60_000);
}

/**
 * Fetches Section A (Institutional Holdings) for a stock (by ticker, CUSIP, or issuer name)
 * or manager CIK across comparable consecutive reporting periods.
 */
export async function getInstitutionalHoldingsData(params: {
  ticker?: string;
  cusip?: string;
  issuer?: string;
  managerCik?: string;
  managerQuery?: string;
  period?: string;
  sortBy?: string;
  sortDir?: string;
  statusFilter?: string;
  page?: number;
  pageSize?: number;
  force?: boolean;
}): Promise<{
  resolvedSecurity: ResolvedIssuerInfo;
  reportingPeriod: string;
  previousPeriod: string | null;
  availablePeriods: string[];
  summary: InstitutionalHoldingsSummary;
  rows: InstitutionalHoldingRow[];
  totalRows: number;
  page: number;
  pageSize: number;
  freshness: InstitutionalDataFreshness;
  limitations: string[];
}> {
  const { periods: availablePeriods, freshness } = await getAvailableReportingPeriods(params.force);
  const requestedPeriod = sanitizePeriodInput(params.period);
  const reportingPeriod = requestedPeriod || availablePeriods[0] || freshness.latestPeriodOfReport || '';
  const previousPeriod = reportingPeriod ? getPreviousQuarterEnd(reportingPeriod) : null;

  const managerCikFilter = sanitizeCikInput(params.managerCik);
  const managerQuery = sanitizeSearchInput(params.managerQuery).toLowerCase();

  const resolvedSecurity = await resolveSecurityViaThreeSpread({
    ticker: params.ticker,
    cusip: params.cusip,
    issuer: params.issuer,
    period: reportingPeriod,
    force: params.force,
  });

  if (!resolvedSecurity.cusip && !resolvedSecurity.searchIssuerTerm && !managerCikFilter) {
    return {
      resolvedSecurity,
      reportingPeriod,
      previousPeriod,
      availablePeriods,
      summary: {
        totalReportedShares: 0,
        totalReportedValueUsd: 0,
        activeInstitutions: 0,
        institutionsIncreasing: 0,
        institutionsDecreasing: 0,
        newPositions: 0,
        exitedPositions: 0,
        unchangedPositions: 0,
        noPriorDataCount: 0,
        netShareChange: 0,
        netPercentChange: null,
      },
      rows: [],
      totalRows: 0,
      page: 1,
      pageSize: params.pageSize || 50,
      freshness,
      limitations: [
        'Specify a ticker symbol, 9-character CUSIP, issuer name, or institutional manager CIK to query 3spread Form 13F holdings.',
      ],
    };
  }

  const baseFilter: Record<string, string> = {};
  if (resolvedSecurity.cusip) {
    baseFilter.cusip = resolvedSecurity.cusip;
  } else if (resolvedSecurity.searchIssuerTerm) {
    baseFilter.name_of_issuer = resolvedSecurity.searchIssuerTerm.split(' ').slice(0, 2).join(' ');
  }
  if (managerCikFilter) {
    baseFilter.filing_manager_cik = managerCikFilter;
  }

  const holdingsCacheKey = `holdings:${JSON.stringify(baseFilter)}:${reportingPeriod}:${previousPeriod || 'none'}`;
  let rawPair = getCached<{
    currentRecords: ThreeSpreadHoldingRecord[];
    previousRecords: ThreeSpreadHoldingRecord[];
    currentFilings: ThreeSpreadFilingSummary[];
    previousFilings: ThreeSpreadFilingSummary[];
  }>(holdingsCacheKey, params.force);

  if (!rawPair) {
    const [currRes, prevRes, currFilings, prevFilings] = await Promise.all([
      fetchThreeSpreadJson<{ data?: ThreeSpreadHoldingRecord[] }>(
        '/v1/institutional-holdings/holdings',
        {
          ...baseFilter,
          ...(reportingPeriod ? { period_start: reportingPeriod, period_end: reportingPeriod } : {}),
          sort: 'value',
          order: 'desc',
          limit: 500,
        }
      ),
      previousPeriod
        ? fetchThreeSpreadJson<{ data?: ThreeSpreadHoldingRecord[] }>(
            '/v1/institutional-holdings/holdings',
            {
              ...baseFilter,
              period_start: previousPeriod,
              period_end: previousPeriod,
              sort: 'value',
              order: 'desc',
              limit: 500,
            }
          ).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      reportingPeriod ? fetchPeriodFilings(reportingPeriod, params.force).catch(() => []) : Promise.resolve([]),
      previousPeriod ? fetchPeriodFilings(previousPeriod, params.force).catch(() => []) : Promise.resolve([]),
    ]);

    rawPair = setCached(
      holdingsCacheKey,
      {
        currentRecords: Array.isArray(currRes?.data) ? currRes.data : [],
        previousRecords: Array.isArray(prevRes?.data) ? prevRes.data : [],
        currentFilings: currFilings,
        previousFilings: prevFilings,
      },
      15 * 60_000
    );
  }

  const filingMetaById = new Map<string, ThreeSpreadFilingSummary>();
  const confirmedCurrentFilingManagerCiks = new Set<string>();
  const confirmedPriorFilingManagerCiks = new Set<string>();

  for (const f of rawPair.currentFilings) {
    filingMetaById.set(f.filing_id, f);
    const cik = normalizeCik(f.filing_manager_cik || f.cik);
    if (cik) confirmedCurrentFilingManagerCiks.add(cik);
  }
  for (const f of rawPair.previousFilings) {
    filingMetaById.set(f.filing_id, f);
    const cik = normalizeCik(f.filing_manager_cik || f.cik);
    if (cik) confirmedPriorFilingManagerCiks.add(cik);
  }

  const { rows: allRows, summary } = buildInstitutionalHoldingsView({
    currentRecords: rawPair.currentRecords,
    previousRecords: rawPair.previousRecords,
    reportingPeriod,
    previousPeriod,
    ticker: resolvedSecurity.ticker,
    filingMetaById,
    confirmedPriorFilingManagerCiks,
    confirmedCurrentFilingManagerCiks,
  });

  // Apply optional client-requested manager substring filter & status filter
  let filtered = allRows;
  if (managerQuery) {
    filtered = filtered.filter(
      (r) =>
        r.managerName.toLowerCase().includes(managerQuery) ||
        r.managerCik.includes(managerQuery)
    );
  }
  const statusFilter = (params.statusFilter || 'ALL').toUpperCase();
  if (statusFilter !== 'ALL') {
    filtered = filtered.filter((r) => r.status === statusFilter);
  }

  // Sort
  const sortBy = params.sortBy || 'valueUsd';
  const sortDir = params.sortDir === 'asc' ? 1 : -1;
  filtered = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'shares':
        return (a.shares - b.shares) * sortDir;
      case 'shareChange':
        return ((a.shareChange ?? -Infinity) - (b.shareChange ?? -Infinity)) * sortDir;
      case 'percentChange':
        return ((a.percentChange ?? -Infinity) - (b.percentChange ?? -Infinity)) * sortDir;
      case 'portfolioPct':
        return ((a.portfolioPct ?? -1) - (b.portfolioPct ?? -1)) * sortDir;
      case 'managerName':
        return a.managerName.localeCompare(b.managerName) * sortDir;
      case 'valueUsd':
      default:
        return (a.valueUsd - b.valueUsd) * sortDir;
    }
  });

  const pageSize = Math.min(100, Math.max(10, Number(params.pageSize) || 50));
  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(params.page) || 1));
  const pagedRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const limitations: string[] = [];
  if (!resolvedSecurity.cusip && resolvedSecurity.ticker) {
    limitations.push(
      `3spread did not return an exact CUSIP mapping for ${resolvedSecurity.ticker}; results were matched by issuer name (${resolvedSecurity.searchIssuerTerm || resolvedSecurity.ticker}).`
    );
  }
  if (rawPair.currentRecords.length >= 500) {
    limitations.push(
      'Showing top 500 reported institutional positions by USD value for this period (3spread single-page holdings cap).'
    );
  }
  if (summary.noPriorDataCount > 0) {
    limitations.push(
      `${summary.noPriorDataCount} holder(s) had no confirmed prior-period filing in the current filing index and are marked NO PRIOR DATA instead of NEW.`
    );
  }

  return {
    resolvedSecurity,
    reportingPeriod,
    previousPeriod,
    availablePeriods,
    summary,
    rows: pagedRows,
    totalRows,
    page,
    pageSize,
    freshness,
    limitations,
  };
}

export interface CohortSnapshot {
  reportingPeriod: string;
  previousPeriod: string;
  managersAnalyzed: number;
  managerNames: string[];
  accumulation: InstitutionalAccumulationRow[];
  changes: InstitutionalPositionChangeRow[];
  freshness: InstitutionalDataFreshness;
  availablePeriods: string[];
}

/**
 * Builds and caches a verified multi-institution comparable-period cohort snapshot
 * by selecting major 13F-HR institutional managers who filed complete reports in BOTH
 * consecutive reporting periods, fetching their full holdings (non-truncated, <=500 entries),
 * and aggregating security-level accumulation + categorized position changes.
 */
export async function getComparableCohortSnapshot(
  requestedPeriod?: string,
  force = false
): Promise<CohortSnapshot> {
  const { periods: availablePeriods, freshness } = await getAvailableReportingPeriods(force);
  const reportingPeriod = sanitizePeriodInput(requestedPeriod) || availablePeriods[0] || '';
  const previousPeriod = reportingPeriod ? getPreviousQuarterEnd(reportingPeriod) || '' : '';

  if (!reportingPeriod || !previousPeriod) {
    return {
      reportingPeriod,
      previousPeriod,
      managersAnalyzed: 0,
      managerNames: [],
      accumulation: [],
      changes: [],
      freshness,
      availablePeriods,
    };
  }

  const cacheKey = `cohort-snapshot:${reportingPeriod}:${previousPeriod}`;
  const cached = getCached<CohortSnapshot>(cacheKey, force);
  if (cached) return cached;

  const [currFilingsRaw, prevFilingsRaw] = await Promise.all([
    fetchPeriodFilings(reportingPeriod, force),
    fetchPeriodFilings(previousPeriod, force),
  ]);

  const currCanonical = selectCanonicalFilings(currFilingsRaw);
  const prevCanonical = selectCanonicalFilings(prevFilingsRaw);

  // Pair managers that have verified complete filings in BOTH consecutive comparable quarters.
  // Prioritize large institutional portfolios whose holdings fit completely within a single 500-row
  // 3spread page (20..480 positions) so NEW and EXITED detections are 100% untruncated.
  const matchedCandidates: Array<{
    managerCik: string;
    managerName: string;
    currentFiling: ThreeSpreadFilingSummary;
    previousFiling: ThreeSpreadFilingSummary;
    aumUsd: number;
  }> = [];

  for (const [key, currFiling] of currCanonical.entries()) {
    const managerCik = key.split('::')[0];
    const prevFiling = prevCanonical.get(`${managerCik}::${previousPeriod}`);
    if (!prevFiling) continue;

    const currEntries = currFiling.table_entry_total ?? 0;
    const prevEntries = prevFiling.table_entry_total ?? 0;
    if (currEntries < 10 || currEntries > 480 || prevEntries < 10 || prevEntries > 480) continue;

    const aumUsd = parseNumericField(currFiling.table_value_total_usd);
    if (aumUsd <= 0) continue;

    matchedCandidates.push({
      managerCik,
      managerName: (currFiling.filing_manager_name || currFiling.filer_name || `CIK ${managerCik}`).trim(),
      currentFiling: currFiling,
      previousFiling: prevFiling,
      aumUsd,
    });
  }

  // Fallback if strict 10..480 filter yields too few managers in a sparse period: relax upper cap slightly
  let selectedCohort = matchedCandidates
    .sort((a, b) => b.aumUsd - a.aumUsd)
    .slice(0, 14);

  if (selectedCohort.length < 4) {
    const fallbackCandidates: typeof matchedCandidates = [];
    for (const [key, currFiling] of currCanonical.entries()) {
      const managerCik = key.split('::')[0];
      const prevFiling = prevCanonical.get(`${managerCik}::${previousPeriod}`);
      if (!prevFiling) continue;
      const aumUsd = parseNumericField(currFiling.table_value_total_usd);
      fallbackCandidates.push({
        managerCik,
        managerName: (currFiling.filing_manager_name || currFiling.filer_name || `CIK ${managerCik}`).trim(),
        currentFiling: currFiling,
        previousFiling: prevFiling,
        aumUsd,
      });
    }
    selectedCohort = fallbackCandidates.sort((a, b) => b.aumUsd - a.aumUsd).slice(0, 12);
  }

  // Fetch holdings in bounded batches of 4 managers to stay gentle on upstream latency & rate limits
  const managerPairs: ManagerPeriodComparisonPair[] = [];
  const batchSize = 4;

  for (let i = 0; i < selectedCohort.length; i += batchSize) {
    const batch = selectedCohort.slice(i, i + batchSize);
    const resolvedBatch = await Promise.all(
      batch.map(async (item) => {
        try {
          const [currH, prevH] = await Promise.all([
            fetchThreeSpreadJson<{ data?: ThreeSpreadHoldingRecord[] }>(
              '/v1/institutional-holdings/holdings',
              {
                filing_id: item.currentFiling.filing_id,
                sort: 'value',
                order: 'desc',
                limit: 500,
              }
            ),
            fetchThreeSpreadJson<{ data?: ThreeSpreadHoldingRecord[] }>(
              '/v1/institutional-holdings/holdings',
              {
                filing_id: item.previousFiling.filing_id,
                sort: 'value',
                order: 'desc',
                limit: 500,
              }
            ),
          ]);
          return {
            managerCik: item.managerCik,
            managerName: item.managerName,
            currentFiling: item.currentFiling,
            previousFiling: item.previousFiling,
            currentHoldings: Array.isArray(currH?.data) ? currH.data : [],
            previousHoldings: Array.isArray(prevH?.data) ? prevH.data : [],
          } satisfies ManagerPeriodComparisonPair;
        } catch {
          return null;
        }
      })
    );

    for (const entry of resolvedBatch) {
      if (entry && (entry.currentHoldings.length > 0 || entry.previousHoldings.length > 0)) {
        managerPairs.push(entry);
      }
    }
  }

  const { accumulation, changes } = buildCohortAccumulationAndChanges({
    managerPairs,
    reportingPeriod,
    previousPeriod,
  });

  const snapshot: CohortSnapshot = {
    reportingPeriod,
    previousPeriod,
    managersAnalyzed: managerPairs.length,
    managerNames: managerPairs.map((m) => m.managerName),
    accumulation,
    changes,
    freshness,
    availablePeriods,
  };

  return setCached(cacheKey, snapshot, 20 * 60_000);
}

/**
 * Section B: Institutional Accumulation Screener
 */
export async function getInstitutionalAccumulation(params: {
  period?: string;
  minIncreasing?: number;
  minPctIncrease?: number;
  minNewPositions?: number;
  search?: string;
  sortBy?: string;
  sortDir?: string;
  force?: boolean;
}) {
  const snapshot = await getComparableCohortSnapshot(params.period, params.force);

  // Enforce multi-institution accumulation threshold (>= 2 by default; never flag single-manager moves as accumulation)
  const minIncreasing = Math.max(2, Number(params.minIncreasing) || 2);
  const minPctIncrease = Number.isFinite(Number(params.minPctIncrease)) ? Number(params.minPctIncrease) : 0;
  const minNewPositions = Math.max(0, Number(params.minNewPositions) || 0);
  const search = sanitizeSearchInput(params.search).toLowerCase();

  let rows = snapshot.accumulation.filter((r) => {
    const positiveInstitutions = r.institutionsIncreasing + r.newPositions;
    if (positiveInstitutions < minIncreasing) return false;
    if (r.newPositions < minNewPositions) return false;
    if (minPctIncrease > 0 && (r.netPercentChange === null || r.netPercentChange < minPctIncrease)) {
      return false;
    }
    if (search) {
      const hay = `${r.issuerName} ${r.cusip} ${r.ticker || ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const sortBy = params.sortBy || 'institutionsIncreasing';
  const sortDir = params.sortDir === 'asc' ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    switch (sortBy) {
      case 'newPositions':
        return (a.newPositions - b.newPositions) * sortDir;
      case 'netShareChange':
        return (a.netShareChange - b.netShareChange) * sortDir;
      case 'netPercentChange':
        return ((a.netPercentChange ?? -Infinity) - (b.netPercentChange ?? -Infinity)) * sortDir;
      case 'totalValueUsd':
        return (a.totalValueUsd - b.totalValueUsd) * sortDir;
      case 'institutionsDecreasing':
        return (a.institutionsDecreasing - b.institutionsDecreasing) * sortDir;
      case 'institutionsIncreasing':
      default:
        return (
          (a.institutionsIncreasing + a.newPositions - (b.institutionsIncreasing + b.newPositions)) *
            sortDir ||
          (a.totalValueUsd - b.totalValueUsd) * -1
        );
    }
  });

  return {
    reportingPeriod: snapshot.reportingPeriod,
    previousPeriod: snapshot.previousPeriod,
    availablePeriods: snapshot.availablePeriods,
    managersAnalyzed: snapshot.managersAnalyzed,
    managerNames: snapshot.managerNames,
    rows: rows.slice(0, 150),
    totalRows: rows.length,
    freshness: snapshot.freshness,
    methodologyNote:
      snapshot.managersAnalyzed > 0
        ? `Computed from ${snapshot.managersAnalyzed} institutional investment managers with complete 13F-HR filings in both ${snapshot.previousPeriod} and ${snapshot.reportingPeriod}. Requires at least ${minIncreasing} institutions increasing/initiating positions.`
        : 'Insufficient matched dual-period 13F-HR filings found for the selected reporting period.',
  };
}

/**
 * Section C (Directory): List/search institutional investment managers from 3spread 13F filings.
 */
export async function getInstitutionalManagersDirectory(params: {
  q?: string;
  period?: string;
  force?: boolean;
}): Promise<{
  reportingPeriod: string;
  availablePeriods: string[];
  managers: InstitutionalManagerDirectoryItem[];
  freshness: InstitutionalDataFreshness;
}> {
  const { periods: availablePeriods, freshness } = await getAvailableReportingPeriods(params.force);
  const reportingPeriod = sanitizePeriodInput(params.period) || availablePeriods[0] || '';
  const query = sanitizeSearchInput(params.q).toLowerCase();

  const filings = reportingPeriod ? await fetchPeriodFilings(reportingPeriod, params.force) : [];
  const canonical = selectCanonicalFilings(filings);

  let managers: InstitutionalManagerDirectoryItem[] = Array.from(canonical.values()).map((f) => ({
    cik: normalizeCik(f.filing_manager_cik || f.cik),
    name: (f.filing_manager_name || f.filer_name || `CIK ${normalizeCik(f.cik)}`).trim(),
    latestFilingId: f.filing_id,
    latestPeriod: normalizePeriodDate(f.period_of_report) || reportingPeriod,
    latestFilingDate: f.accepted_time || null,
    tableEntryTotal: typeof f.table_entry_total === 'number' ? f.table_entry_total : null,
    tableValueTotalUsd: f.table_value_total_usd ? parseNumericField(f.table_value_total_usd) : null,
    formType: f.form_type || '13F-HR',
    sourceUrl: f.source_url || null,
  }));

  if (query) {
    managers = managers.filter(
      (m) => m.name.toLowerCase().includes(query) || m.cik.includes(query.replace(/^0+/, ''))
    );

    // If user typed a numeric CIK that wasn't in the first 1,000 filings of the period, query 3spread directly
    const numericCik = sanitizeCikInput(query);
    if (numericCik && managers.length === 0) {
      const directRes = await fetchThreeSpreadJson<{ data?: ThreeSpreadFilingSummary[] }>(
        '/v1/institutional-holdings',
        {
          filing_manager_cik: numericCik,
          report_type: '13F HOLDINGS REPORT',
          limit: 5,
        }
      ).catch(() => ({ data: [] }));
      const directRows = Array.isArray(directRes?.data) ? directRes.data : [];
      if (directRows.length > 0) {
        const latest = directRows[0];
        managers.push({
          cik: normalizeCik(latest.filing_manager_cik || latest.cik),
          name: (latest.filing_manager_name || latest.filer_name || `CIK ${numericCik}`).trim(),
          latestFilingId: latest.filing_id,
          latestPeriod: normalizePeriodDate(latest.period_of_report) || reportingPeriod,
          latestFilingDate: latest.accepted_time || null,
          tableEntryTotal: typeof latest.table_entry_total === 'number' ? latest.table_entry_total : null,
          tableValueTotalUsd: latest.table_value_total_usd
            ? parseNumericField(latest.table_value_total_usd)
            : null,
          formType: latest.form_type || '13F-HR',
          sourceUrl: latest.source_url || null,
        });
      }
    }
  }

  managers.sort((a, b) => (b.tableValueTotalUsd || 0) - (a.tableValueTotalUsd || 0));

  return {
    reportingPeriod,
    availablePeriods,
    managers: managers.slice(0, 60),
    freshness,
  };
}

/**
 * Section C (Profile): Full Institutional Investor Profile comparing current vs immediately
 * preceding comparable reporting period filings.
 */
export async function getInstitutionalInvestorProfile(params: {
  cik: string;
  period?: string;
  force?: boolean;
}): Promise<{
  profile: InstitutionalInvestorProfile;
  availableManagerPeriods: string[];
  freshness: InstitutionalDataFreshness;
}> {
  const cik = sanitizeCikInput(params.cik);
  if (!cik) {
    throw new ThreeSpreadError('Valid institutional manager CIK is required.', { status: 400 });
  }

  const requestedPeriod = sanitizePeriodInput(params.period);
  const cacheKey = `investor-profile:${cik}:${requestedPeriod || 'latest'}`;
  const cached = getCached<{
    profile: InstitutionalInvestorProfile;
    availableManagerPeriods: string[];
    freshness: InstitutionalDataFreshness;
  }>(cacheKey, params.force);
  if (cached) return cached;

  const [freshness, filingsRes] = await Promise.all([
    getDataFreshness(params.force),
    fetchThreeSpreadJson<{ data?: ThreeSpreadFilingSummary[] }>('/v1/institutional-holdings', {
      filing_manager_cik: cik,
      report_type: '13F HOLDINGS REPORT',
      limit: 24,
    }),
  ]);

  const rawFilings = Array.isArray(filingsRes?.data) ? filingsRes.data : [];
  if (rawFilings.length === 0) {
    throw new ThreeSpreadError(`No Form 13F holdings filings found in 3spread for manager CIK ${cik}.`, {
      status: 404,
    });
  }

  const canonicalMap = selectCanonicalFilings(rawFilings);
  const sortedFilings = Array.from(canonicalMap.values()).sort((a, b) =>
    String(b.period_of_report || '').localeCompare(String(a.period_of_report || ''))
  );

  const availableManagerPeriods = sortedFilings
    .map((f) => normalizePeriodDate(f.period_of_report))
    .filter((p): p is string => Boolean(p));

  const currentFiling = requestedPeriod
    ? sortedFilings.find((f) => normalizePeriodDate(f.period_of_report) === requestedPeriod) ||
      sortedFilings[0]
    : sortedFilings[0];

  const currentPeriod = normalizePeriodDate(currentFiling.period_of_report) || '';
  const expectedPrevPeriod = getPreviousQuarterEnd(currentPeriod);
  // Compare strictly against the immediately preceding equivalent reporting period
  const previousFiling =
    (expectedPrevPeriod
      ? sortedFilings.find((f) => normalizePeriodDate(f.period_of_report) === expectedPrevPeriod)
      : null) || null;

  const fetchFilingHoldings = async (filingId: string): Promise<{ rows: ThreeSpreadHoldingRecord[]; truncated: boolean }> => {
    const page1 = await fetchThreeSpreadJson<{ data?: ThreeSpreadHoldingRecord[]; has_more?: boolean }>(
      '/v1/institutional-holdings/holdings',
      {
        filing_id: filingId,
        sort: 'value',
        order: 'desc',
        limit: 500,
        offset: 0,
      }
    );
    const rows1 = Array.isArray(page1?.data) ? page1.data : [];
    if (!page1?.has_more) {
      return { rows: rows1, truncated: false };
    }
    const page2 = await fetchThreeSpreadJson<{ data?: ThreeSpreadHoldingRecord[]; has_more?: boolean }>(
      '/v1/institutional-holdings/holdings',
      {
        filing_id: filingId,
        sort: 'value',
        order: 'desc',
        limit: 500,
        offset: 500,
      }
    ).catch(() => ({ data: [], has_more: true }));
    const rows2 = Array.isArray(page2?.data) ? page2.data : [];
    return { rows: [...rows1, ...rows2], truncated: Boolean(page2?.has_more) };
  };

  const [detailFiling, currHoldingsRes, prevHoldingsRes] = await Promise.all([
    fetchThreeSpreadJson<ThreeSpreadFilingSummary>(
      `/v1/institutional-holdings/${encodeURIComponent(currentFiling.filing_id)}`
    ).catch(() => currentFiling),
    fetchFilingHoldings(currentFiling.filing_id),
    previousFiling
      ? fetchFilingHoldings(previousFiling.filing_id)
      : Promise.resolve({ rows: [] as ThreeSpreadHoldingRecord[], truncated: false }),
  ]);

  const mergedCurrentFiling: ThreeSpreadFilingSummary = {
    ...currentFiling,
    ...detailFiling,
  };

  const profile = buildInvestorProfile({
    currentFiling: mergedCurrentFiling,
    previousFiling,
    currentHoldings: currHoldingsRes.rows,
    previousHoldings: prevHoldingsRes.rows,
    holdingsTruncated: currHoldingsRes.truncated || prevHoldingsRes.truncated,
  });

  return setCached(cacheKey, { profile, availableManagerPeriods, freshness }, 15 * 60_000);
}

/**
 * Section D: Position Changes Activity Feed
 * Supports both security-scoped (ticker/CUSIP) and cross-manager cohort position changes.
 */
export async function getInstitutionalPositionChanges(params: {
  category?: string;
  ticker?: string;
  cusip?: string;
  managerQuery?: string;
  period?: string;
  page?: number;
  pageSize?: number;
  force?: boolean;
}): Promise<{
  reportingPeriod: string;
  previousPeriod: string | null;
  availablePeriods: string[];
  managersAnalyzed: number | null;
  rows: InstitutionalPositionChangeRow[];
  counts: {
    all: number;
    NEW: number;
    INCREASED: number;
    DECREASED: number;
    EXITED: number;
  };
  totalRows: number;
  page: number;
  pageSize: number;
  freshness: InstitutionalDataFreshness;
}> {
  const ticker = sanitizeTickerInput(params.ticker);
  const cusip = sanitizeCusipInput(params.cusip);
  const managerQuery = sanitizeSearchInput(params.managerQuery).toLowerCase();
  const category = (params.category || 'ALL').toUpperCase();

  let allChanges: InstitutionalPositionChangeRow[] = [];
  let reportingPeriod = '';
  let previousPeriod: string | null = null;
  let availablePeriods: string[] = [];
  let managersAnalyzed: number | null = null;
  let freshness: InstitutionalDataFreshness;

  if (ticker || cusip) {
    // Security-scoped position changes across all institutional holders of that security
    const holdingsData = await getInstitutionalHoldingsData({
      ticker,
      cusip,
      period: params.period,
      page: 1,
      pageSize: 500,
      force: params.force,
    });
    reportingPeriod = holdingsData.reportingPeriod;
    previousPeriod = holdingsData.previousPeriod;
    availablePeriods = holdingsData.availablePeriods;
    freshness = holdingsData.freshness;

    allChanges = holdingsData.rows
      .filter(
        (r): r is InstitutionalHoldingRow & { status: 'NEW' | 'INCREASED' | 'DECREASED' | 'EXITED' } =>
          r.status === 'NEW' || r.status === 'INCREASED' || r.status === 'DECREASED' || r.status === 'EXITED'
      )
      .map((r) => ({
        id: `${r.id}-${r.status}`,
        category: r.status,
        ticker: r.ticker,
        issuerName: r.issuerName,
        cusip: r.cusip,
        managerCik: r.managerCik,
        managerName: r.managerName,
        previousShares: r.previousShares ?? 0,
        currentShares: r.shares,
        shareChange: r.shareChange ?? 0,
        percentChange: r.percentChange,
        currentValueUsd: r.valueUsd,
        previousValueUsd: r.previousValueUsd ?? 0,
        previousPeriod: r.previousPeriod || '',
        currentPeriod: r.reportingPeriod,
        filingDate: r.filingDate,
        sourceUrl: r.sourceUrl,
      }));
  } else {
    const snapshot = await getComparableCohortSnapshot(params.period, params.force);
    reportingPeriod = snapshot.reportingPeriod;
    previousPeriod = snapshot.previousPeriod;
    availablePeriods = snapshot.availablePeriods;
    managersAnalyzed = snapshot.managersAnalyzed;
    freshness = snapshot.freshness;
    allChanges = snapshot.changes;
  }

  let baseFiltered = allChanges;
  if (managerQuery) {
    baseFiltered = baseFiltered.filter(
      (r) =>
        r.managerName.toLowerCase().includes(managerQuery) ||
        r.managerCik.includes(managerQuery) ||
        r.issuerName.toLowerCase().includes(managerQuery) ||
        r.cusip.toLowerCase().includes(managerQuery)
    );
  }

  const counts = {
    all: baseFiltered.length,
    NEW: baseFiltered.filter((r) => r.category === 'NEW').length,
    INCREASED: baseFiltered.filter((r) => r.category === 'INCREASED').length,
    DECREASED: baseFiltered.filter((r) => r.category === 'DECREASED').length,
    EXITED: baseFiltered.filter((r) => r.category === 'EXITED').length,
  };

  const categoryFiltered =
    category === 'ALL' ? baseFiltered : baseFiltered.filter((r) => r.category === category);

  const pageSize = Math.min(100, Math.max(10, Number(params.pageSize) || 50));
  const totalRows = categoryFiltered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(params.page) || 1));
  const rows = categoryFiltered.slice((page - 1) * pageSize, page * pageSize);

  return {
    reportingPeriod,
    previousPeriod,
    availablePeriods,
    managersAnalyzed,
    rows,
    counts,
    totalRows,
    page,
    pageSize,
    freshness,
  };
}

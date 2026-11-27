import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { enrichBarsWithStudies } from "./src/utils/technicalStudies";
import {
  VALID_SECURITY_TYPES,
  findValidYahooSearchEquity,
  isValidYahooChartMeta,
} from "./src/utils/equityValidation";
import {
  normalizeDailyPriceBars,
  type DailyPricePoint,
} from "./src/utils/correlation";
import {
  countDistinctTradingDays,
  deduplicateAndSortHistoricalBars,
  formatHistoricalHourlyTimestamp,
  isClosingPriceSnapshotBar,
  parseAlphaVantageEarningsDates,
  parseAlphaVantageIntradayBars,
  type HistoricalPriceBar,
} from "./src/utils/historicalPricing";
import {
  CENTRAL_BANK_DIRECTORY,
  deriveCentralBankPolicySummary,
  normalizeObservations as normalizeFxObservations,
  parseBisPolicyCsv,
  shiftIsoDate,
} from "./src/utils/fxAnalytics";
import { COMMAND_DEFINITIONS } from "./src/utils/commandParser";
import {
  ThreeSpreadError,
  clearThreeSpreadCache,
  getAvailableReportingPeriods,
  getEnvThreeSpreadApiKey,
  getInsiderTradingByTicker,
  getInstitutionalAccumulation,
  getInstitutionalHoldingsData,
  getInstitutionalInvestorProfile,
  getInstitutionalManagersDirectory,
  getInstitutionalPositionChanges,
  getThreeSpreadApiKey,
  isThreeSpreadConfigured,
  setRuntimeThreeSpreadApiKey,
} from "./src/server/threeSpreadService";
import {
  clearSectorRotationCache,
  getSectorRotationData,
} from "./src/server/sectorRotationService";
import {
  getCongressTradingStatus,
  initializeCongressionalTradingService,
  queryCongressTrades,
  runIngestionBackfill,
} from "./src/server/congressionalTradingService";
import { newsPaywallService } from "./src/server/newsPaywallService";
import {
  filterPolymarketEventsByTicker,
  getTickerCompanyProfile,
  resolveTickerFromQuery,
} from "./src/utils/polymarketFilter";
import { polymarketTickerResolver } from "./src/server/polymarketTickerResolver";
import {
  SECTOR_BY_ID,
  isBroadMarketOrMultiSectorFund,
  mapMarketSectorToGicsSector,
  matchDirectSectorEtf,
} from "./src/utils/sectorRotation";
import type { PortfolioSecurityMetadata } from "./src/types";
import {
  DIAGNOSTIC_PROVIDER_SET,
  runProviderConnectionTest,
  type DiagnosticProviderId,
} from "./src/server/apiDiagnostics";
import {
  API_KEY_IDS,
  API_KEY_LABELS,
  getActiveApiKey,
  getApiKeysStatusPayload,
  getEnvApiKey,
  getRuntimeApiKey,
  isMaskedKeyPlaceholder,
  redactErrorMessage,
  redactSecrets,
  setRuntimeApiKey,
  validateApiKeyInput,
  type ApiKeyId,
} from "./src/server/apiCredentials";

// Load environment variables
dotenv.config();

// In-memory cooldowns and 5-minute caches to prevent rate limits (429) on ticker switches / polling
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;
const apiCooldowns = {
  nyt: 0,
  newsapi: 0,
  newsdata: 0,
};
const newsProviderCache: {
  nyt: { timestamp: number; items: any[] };
  newsapi: { timestamp: number; items: any[] };
  newsdata: { timestamp: number; items: any[] };
  yahoo: { timestamp: number; items: any[] };
} = {
  nyt: { timestamp: 0, items: [] },
  newsapi: { timestamp: 0, items: [] },
  newsdata: { timestamp: 0, items: [] },
  yahoo: { timestamp: 0, items: [] },
};

// In-memory cache for FRED API responses (5 minute TTL)
const FRED_CACHE_TTL_MS = 5 * 60 * 1000;
const BIS_POLICY_CACHE_TTL_MS = 30 * 60 * 1000;
let fredEconomicsCache: { timestamp: number; data: any } | null = null;
let fredCurrenciesCache: { timestamp: number; data: any } | null = null;
let fredFxIntelligenceCache: { timestamp: number; data: any } | null = null;
let bisCentralBanksCache: {
  timestamp: number;
  data: {
    centralBanks: any[];
    fetchedAt: string;
    source: string | null;
    error: string | null;
  };
} | null = null;

function getFredApiKey(): string {
  return getActiveApiKey("FRED_API_KEY");
}

async function fetchFredObservations(
  seriesId: string,
  apiKey: string,
  options: {
    units?: "lin" | "pc1";
    limit?: number;
    observationStart?: string;
    sortOrder?: "asc" | "desc";
  } = {}
): Promise<Array<{ date: string; value: number }>> {
  const { units = "lin", limit = 6, observationStart, sortOrder = "desc" } = options;
  const startParam =
    observationStart && /^\d{4}-\d{2}-\d{2}$/.test(observationStart)
      ? `&observation_start=${encodeURIComponent(observationStart)}`
      : "";
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
    seriesId
  )}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=${sortOrder}&limit=${limit}&units=${units}${startParam}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FRED ${seriesId} returned status ${res.status}`);
  }
  const data = await res.json();
  const obs = Array.isArray(data?.observations) ? data.observations : [];
  return obs
    .filter((o: any) => o.value !== "." && o.value !== "" && !isNaN(parseFloat(o.value)))
    .map((o: any) => ({
      date: o.date as string,
      value: parseFloat(o.value),
    }));
}

async function fetchCentralBankPolicyRates(
  fredApiKey: string,
  force = false
): Promise<{
  centralBanks: any[];
  fetchedAt: string;
  source: string | null;
  error: string | null;
}> {
  const now = Date.now();
  if (!force && bisCentralBanksCache && now - bisCentralBanksCache.timestamp < BIS_POLICY_CACHE_TTL_MS) {
    return bisCentralBanksCache.data;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const startPeriod = shiftIsoDate(todayIso, -1100); // ~3 years of daily policy rate history

  let bisByArea: Record<string, Array<{ date: string; value: number }>> = {};
  let bisError: string | null = null;

  try {
    // Allowlisted static BIS SDMX v2 dataflow URL (Central Bank Policy Rates, daily)
    const bisUrl = `https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.US+XM+GB+JP+AU+CA?startPeriod=${encodeURIComponent(
      startPeriod
    )}&detail=dataonly&format=csv`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch(bisUrl, {
        headers: { Accept: "text/csv" },
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`BIS WS_CBPOL returned status ${resp.status}`);
      }
      const csvText = await resp.text();
      bisByArea = parseBisPolicyCsv(csvText);
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    bisError = redactErrorMessage(err, "BIS central bank policy rate feed temporarily unavailable.");
    console.warn("BIS policy rates fetch failed:", bisError);
  }

  const usedSources = new Set<string>();
  const centralBanks = await Promise.all(
    CENTRAL_BANK_DIRECTORY.map(async (meta) => {
      const bisObs = bisByArea[meta.bisArea];
      if (bisObs && bisObs.length > 0) {
        usedSources.add("BIS WS_CBPOL");
        return deriveCentralBankPolicySummary(
          bisObs,
          meta,
          "BIS WS_CBPOL",
          `D.${meta.bisArea}`
        );
      }

      // Fallback to FRED policy rate series if BIS data is missing and FRED_API_KEY is available
      if (fredApiKey) {
        try {
          const fredObs = await fetchFredObservations(meta.fredFallbackSeriesId, fredApiKey, {
            units: "lin",
            limit: 1200,
            observationStart: startPeriod,
            sortOrder: "asc",
          });
          if (fredObs.length > 0) {
            usedSources.add("FRED");
            return deriveCentralBankPolicySummary(
              fredObs,
              meta,
              "FRED",
              meta.fredFallbackSeriesId
            );
          }
        } catch (err: any) {
          console.warn(
            `FRED fallback policy series ${meta.fredFallbackSeriesId} error:`,
            redactErrorMessage(err, "FRED policy rate fallback failed.", { extraSecrets: [fredApiKey] })
          );
        }
      }

      return deriveCentralBankPolicySummary([], meta, "BIS WS_CBPOL", `D.${meta.bisArea}`);
    })
  );

  const anyAvailable = centralBanks.some((cb) => cb.available);
  const payload = {
    centralBanks,
    fetchedAt: new Date().toISOString(),
    source: usedSources.size > 0 ? Array.from(usedSources).join(" / ") : null,
    error: anyAvailable ? null : bisError || "Central bank policy rates are currently unavailable.",
  };

  if (anyAvailable) {
    bisCentralBanksCache = { timestamp: now, data: payload };
  }
  return payload;
}

const FRED_RELEASES_CATALOG_TTL_MS = 60 * 60 * 1000;
let fredReleasesCatalogCache: {
  timestamp: number;
  byId: Map<number, { link: string | null; pressRelease: boolean }>;
} | null = null;

function sanitizeReportUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

async function fetchFredReleasesCatalog(apiKey: string) {
  const now = Date.now();
  if (fredReleasesCatalogCache && now - fredReleasesCatalogCache.timestamp < FRED_RELEASES_CATALOG_TTL_MS) {
    return fredReleasesCatalogCache.byId;
  }

  const byId = new Map<number, { link: string | null; pressRelease: boolean }>();
  const url = `https://api.stlouisfed.org/fred/releases?api_key=${encodeURIComponent(
    apiKey
  )}&file_type=json&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FRED releases catalog returned status ${res.status}`);
  }
  const data = await res.json();
  const releases = Array.isArray(data?.releases) ? data.releases : [];
  for (const rel of releases) {
    if (typeof rel?.id === "number") {
      byId.set(rel.id, {
        link: sanitizeReportUrl(rel.link),
        pressRelease: Boolean(rel.press_release),
      });
    }
  }

  fredReleasesCatalogCache = { timestamp: now, byId };
  return byId;
}

async function fetchFredReleaseDates(apiKey: string, lookbackDays = 31) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 86400 * 1000);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const [catalog, pages] = await Promise.all([
    fetchFredReleasesCatalog(apiKey).catch((err) => {
      console.warn("FRED releases catalog fetch failed:", err.message);
      return new Map<number, { link: string | null; pressRelease: boolean }>();
    }),
    (async () => {
      const collected: any[] = [];
      const pageLimit = 1000;
      const maxPages = 3;

      for (let page = 0; page < maxPages; page++) {
        const offset = page * pageLimit;
        const url = `https://api.stlouisfed.org/fred/releases/dates?api_key=${encodeURIComponent(
          apiKey
        )}&file_type=json&include_release_dates_with_no_data=false&sort_order=desc&realtime_start=${startStr}&realtime_end=${endStr}&limit=${pageLimit}&offset=${offset}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`FRED releases/dates returned status ${res.status}`);
        }
        const data = await res.json();
        const batch = Array.isArray(data?.release_dates) ? data.release_dates : [];
        collected.push(...batch);
        if (batch.length < pageLimit) break;
      }
      return collected;
    })(),
  ]);

  const seen = new Set<string>();
  const results: Array<{
    releaseId: number;
    releaseName: string;
    date: string;
    fredUrl: string;
    sourceUrl: string | null;
    pressRelease: boolean;
  }> = [];

  for (const r of pages) {
    const releaseId = Number(r?.release_id);
    const releaseName = typeof r?.release_name === "string" ? r.release_name.trim() : "";
    const date = typeof r?.date === "string" ? r.date.trim() : "";
    if (!releaseId || !releaseName || !date) continue;
    if (date < startStr || date > endStr) continue;

    const dedupeKey = `${releaseId}:${date}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const meta = catalog.get(releaseId);
    results.push({
      releaseId,
      releaseName,
      date,
      fredUrl: `https://fred.stlouisfed.org/release?rid=${releaseId}`,
      sourceUrl: meta?.link ?? null,
      pressRelease: meta?.pressRelease ?? false,
    });
  }

  results.sort((a, b) => b.date.localeCompare(a.date) || a.releaseName.localeCompare(b.releaseName));
  return results;
}

async function fetchLiveFredEconomics(apiKey: string, force = false) {
  const now = Date.now();
  if (!force && fredEconomicsCache && now - fredEconomicsCache.timestamp < FRED_CACHE_TTL_MS) {
    return fredEconomicsCache.data;
  }

  const safeObs = async (
    seriesId: string,
    options: { units?: "lin" | "pc1"; limit?: number } = {}
  ) => {
    try {
      return await fetchFredObservations(seriesId, apiKey, options);
    } catch (err: any) {
      console.warn(`FRED series ${seriesId} fetch skipped:`, err.message);
      return [];
    }
  };

  const [
    usGdp,
    usUnrate,
    usCpi,
    usRateTarget,
    usRateEff,
    euGdp,
    euUnrate,
    euCpi,
    euRate,
    jpGdp,
    jpUnrate,
    jpCpi,
    jpRate,
    ukGdp,
    ukUnrate,
    ukCpi,
    ukRate,
    cnGdp,
    cnUnrate,
    cnCpi,
    cnRate,
    t10y2y,
    dgs10,
    dgs2,
    mortgage30,
    releaseDates,
  ] = await Promise.all([
    safeObs("A191RL1Q225SBEA", { units: "lin", limit: 3 }),
    safeObs("UNRATE", { units: "lin", limit: 3 }),
    safeObs("CPIAUCSL", { units: "pc1", limit: 3 }),
    safeObs("DFEDTARU", { units: "lin", limit: 3 }),
    safeObs("FEDFUNDS", { units: "lin", limit: 3 }),
    safeObs("CLVMNACSCAB1GQEA19", { units: "pc1", limit: 3 }),
    safeObs("LRHUTTTTEZM156S", { units: "lin", limit: 3 }),
    safeObs("CP0000EZ19M086NEST", { units: "pc1", limit: 3 }),
    safeObs("ECBDFR", { units: "lin", limit: 3 }),
    safeObs("JPNRGDPEXP", { units: "pc1", limit: 3 }),
    safeObs("LRUN64TTJPM156S", { units: "lin", limit: 3 }),
    safeObs("JPNCPIALLMINMEI", { units: "pc1", limit: 3 }),
    safeObs("IRSTCI01JPM156N", { units: "lin", limit: 3 }),
    safeObs("RGDPMPUKQ", { units: "pc1", limit: 3 }),
    safeObs("LRHUTTTTGBM156S", { units: "lin", limit: 3 }),
    safeObs("GBRCPALTT01IXNBM", { units: "pc1", limit: 3 }),
    safeObs("IRSTCI01GBM156N", { units: "lin", limit: 3 }),
    safeObs("CHNGDPNQDSMEI", { units: "pc1", limit: 3 }),
    safeObs("SLUEM1524ZSCHN", { units: "lin", limit: 3 }),
    safeObs("CHNCPIALLMINMEI", { units: "pc1", limit: 3 }),
    safeObs("IRSTCI01CNM156N", { units: "lin", limit: 3 }),
    safeObs("T10Y2Y", { units: "lin", limit: 3 }),
    safeObs("DGS10", { units: "lin", limit: 3 }),
    safeObs("DGS2", { units: "lin", limit: 3 }),
    safeObs("MORTGAGE30US", { units: "lin", limit: 3 }),
    fetchFredReleaseDates(apiKey, 31).catch((err) => {
      console.warn("FRED releases/dates fetch failed:", err.message);
      return [];
    }),
  ]);

  const fmtPct = (obs: Array<{ date: string; value: number }>, signed = false, decimals = 1) => {
    if (!obs || obs.length === 0) return "N/A";
    const val = obs[0].value;
    const prefix = signed && val > 0 ? "+" : "";
    return `${prefix}${val.toFixed(decimals)}%`;
  };

  const latestDate = (...lists: Array<Array<{ date: string; value: number }>>) => {
    const dates = lists.flatMap((l) => (l[0]?.date ? [l[0].date] : []));
    dates.sort();
    return dates[dates.length - 1] || "";
  };

  const indicators = [
    {
      country: "UNITED STATES",
      flag: "🇺🇸",
      gdpGrow: fmtPct(usGdp, true, 1),
      unemployment: fmtPct(usUnrate, false, 1),
      inflation: fmtPct(usCpi, false, 1),
      rate: fmtPct(usRateTarget.length > 0 ? usRateTarget : usRateEff, false, 2),
      updatedAt: latestDate(usGdp, usUnrate, usCpi, usRateTarget, usRateEff),
    },
    {
      country: "EURO AREA",
      flag: "🇪🇺",
      gdpGrow: fmtPct(euGdp, true, 1),
      unemployment: fmtPct(euUnrate, false, 1),
      inflation: fmtPct(euCpi, false, 1),
      rate: fmtPct(euRate, false, 2),
      updatedAt: latestDate(euGdp, euUnrate, euCpi, euRate),
    },
    {
      country: "JAPAN",
      flag: "🇯🇵",
      gdpGrow: fmtPct(jpGdp, true, 1),
      unemployment: fmtPct(jpUnrate, false, 1),
      inflation: fmtPct(jpCpi, false, 1),
      rate: fmtPct(jpRate, false, 2),
      updatedAt: latestDate(jpGdp, jpUnrate, jpCpi, jpRate),
    },
    {
      country: "UNITED KINGDOM",
      flag: "🇬🇧",
      gdpGrow: fmtPct(ukGdp, true, 1),
      unemployment: fmtPct(ukUnrate, false, 1),
      inflation: fmtPct(ukCpi, false, 1),
      rate: fmtPct(ukRate, false, 2),
      updatedAt: latestDate(ukGdp, ukUnrate, ukCpi, ukRate),
    },
    {
      country: "CHINA",
      flag: "🇨🇳",
      gdpGrow: fmtPct(cnGdp, true, 1),
      unemployment: fmtPct(cnUnrate, false, 1),
      inflation: fmtPct(cnCpi, false, 1),
      rate: fmtPct(cnRate, false, 2),
      updatedAt: latestDate(cnGdp, cnUnrate, cnCpi, cnRate),
    },
  ];

  const macroMetrics = [
    {
      id: "FEDFUNDS",
      label: "EFFECTIVE FED FUNDS",
      value: fmtPct(usRateEff, false, 2),
      date: usRateEff[0]?.date || "",
    },
    {
      id: "DGS10",
      label: "US 10Y TREASURY",
      value: fmtPct(dgs10, false, 2),
      date: dgs10[0]?.date || "",
    },
    {
      id: "DGS2",
      label: "US 2Y TREASURY",
      value: fmtPct(dgs2, false, 2),
      date: dgs2[0]?.date || "",
    },
    {
      id: "T10Y2Y",
      label: "10Y-2Y YIELD SPREAD",
      value: fmtPct(t10y2y, true, 2),
      date: t10y2y[0]?.date || "",
    },
    {
      id: "MORTGAGE30US",
      label: "30Y FIXED MORTGAGE",
      value: fmtPct(mortgage30, false, 2),
      date: mortgage30[0]?.date || "",
    },
  ];

  const payload = {
    indicators,
    macroMetrics,
    releases: releaseDates,
    fetchedAt: new Date().toISOString(),
  };

  fredEconomicsCache = { timestamp: now, data: payload };
  return payload;
}

const app = express();
app.use(express.json());

function resolvePort(): number {
  const portFlagIdx = process.argv.indexOf("--port");
  const cliPort =
    portFlagIdx !== -1 && process.argv[portFlagIdx + 1]
      ? Number(process.argv[portFlagIdx + 1])
      : NaN;
  const envPort = Number(process.env.PORT);
  if (Number.isInteger(cliPort) && cliPort > 0) return cliPort;
  if (Number.isInteger(envPort) && envPort > 0) return envPort;
  return 3000;
}

const PORT = resolvePort();

// Lazy initialize Gemini API client and refresh automatically if GEMINI_API_KEY changes
let aiClient: GoogleGenAI | null = null;
let aiClientKey: string = "";

function getNormalizedGeminiKey(): string {
  const raw = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, "").trim();
  if (!cleaned || cleaned === "MY_GEMINI_API_KEY") return "";
  return cleaned;
}

function getAiClient(): GoogleGenAI | null {
  const key = getNormalizedGeminiKey();
  if (!key) {
    aiClient = null;
    aiClientKey = "";
    return null;
  }
  if (!aiClient || aiClientKey !== key) {
    try {
      aiClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      aiClientKey = key;
    } catch (err) {
      console.warn("Failed to initialize GoogleGenAI client:", err);
      aiClient = null;
      aiClientKey = "";
    }
  }
  return aiClient;
}

// Cached Yahoo Finance session cookie + crumb for quoteSummary (unlocked fundamentals & business profile)
const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
let yahooCrumbCache: { cookie: string; crumb: string; timestamp: number } | null = null;
const YAHOO_CRUMB_TTL_MS = 30 * 60 * 1000;

async function getYahooCrumb(forceRefresh = false): Promise<{ cookie: string; crumb: string } | null> {
  const now = Date.now();
  if (!forceRefresh && yahooCrumbCache && now - yahooCrumbCache.timestamp < YAHOO_CRUMB_TTL_MS) {
    return { cookie: yahooCrumbCache.cookie, crumb: yahooCrumbCache.crumb };
  }
  try {
    const cRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": YAHOO_UA } });
    const getSetCookie = (cRes.headers as any).getSetCookie;
    const rawCookies: string[] = typeof getSetCookie === "function"
      ? getSetCookie.call(cRes.headers)
      : [cRes.headers.get("set-cookie")].filter((v): v is string => Boolean(v));
    const cookie = rawCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    if (!cookie) return null;

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": YAHOO_UA, Cookie: cookie },
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes("<")) return null;

    yahooCrumbCache = { cookie, crumb, timestamp: now };
    return { cookie, crumb };
  } catch {
    return null;
  }
}

async function fetchYahooQuoteSummary(symbol: string): Promise<any | null> {
  const yfSymbol = mapToYahooSymbol(symbol.toUpperCase());
  const modules = "assetProfile,summaryDetail,financialData,defaultKeyStatistics,recommendationTrend,price";

  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await getYahooCrumb(attempt > 0);
    if (!auth) continue;
    try {
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
        yfSymbol
      )}?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": YAHOO_UA, Cookie: auth.cookie },
      });
      if (res.status === 401 || res.status === 403) {
        yahooCrumbCache = null;
        continue;
      }
      if (!res.ok) return null;
      const data = await res.json();
      return data?.quoteSummary?.result?.[0] || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchYahooChartSnapshot(symbol: string): Promise<any | null> {
  try {
    const yfSymbol = mapToYahooSymbol(symbol.toUpperCase());
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?interval=1h&range=5d`;
    const res = await fetch(url, { headers: { "User-Agent": YAHOO_UA } });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : 0;
    const prevClose =
      typeof meta.regularMarketPreviousClose === "number"
        ? meta.regularMarketPreviousClose
        : typeof meta.previousClose === "number"
        ? meta.previousClose
        : price;
    const change = price - prevClose;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
    return {
      symbol: symbol.toUpperCase(),
      yfSymbol,
      name: meta.longName || meta.shortName || symbol.toUpperCase(),
      exchange: meta.fullExchangeName || meta.exchangeName || "",
      currency: meta.currency || "USD",
      price,
      prevClose,
      change,
      changePercent,
      dayHigh: meta.regularMarketDayHigh,
      dayLow: meta.regularMarketDayLow,
      high52w: meta.fiftyTwoWeekHigh,
      low52w: meta.fiftyTwoWeekLow,
      volume: meta.regularMarketVolume,
    };
  } catch {
    return null;
  }
}

async function fetchYahooSearchDetailed(
  query: string,
  quotesCount = 5,
  newsCount = 6
): Promise<{ ok: boolean; quotes: any[]; news: any[] }> {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      query
    )}&quotesCount=${quotesCount}&newsCount=${newsCount}`;
    const res = await fetch(url, { headers: { "User-Agent": YAHOO_UA } });
    if (!res.ok) return { ok: false, quotes: [], news: [] };
    const data = await res.json();
    return {
      ok: true,
      quotes: Array.isArray(data?.quotes) ? data.quotes : [],
      news: Array.isArray(data?.news) ? data.news : [],
    };
  } catch {
    return { ok: false, quotes: [], news: [] };
  }
}

async function fetchYahooSearch(query: string, quotesCount = 5, newsCount = 6): Promise<{ quotes: any[]; news: any[] }> {
  const { quotes, news } = await fetchYahooSearchDetailed(query, quotesCount, newsCount);
  return { quotes, news };
}

const COMPANY_NAME_TO_TICKER: Record<string, string> = {
  APPLE: "AAPL",
  NVIDIA: "NVDA",
  TESLA: "TSLA",
  MICROSOFT: "MSFT",
  AMAZON: "AMZN",
  ALPHABET: "GOOG",
  GOOGLE: "GOOG",
  META: "META",
  FACEBOOK: "META",
  AMD: "AMD",
  INTEL: "INTC",
  BROADCOM: "AVGO",
  NETFLIX: "NFLX",
  TERAWULF: "WULF",
  PALANTIR: "PLTR",
  SALESFORCE: "CRM",
  ORACLE: "ORCL",
  QUALCOMM: "QCOM",
  BERKSHIRE: "BRK-B",
  JPMORGAN: "JPM",
  WALMART: "WMT",
  EXXON: "XOM",
  CHEVRON: "CVX",
  BITCOIN: "BTC",
  GOLD: "GC",
  CRUDE: "CL",
  WTI: "CL",
  BRENT: "BZ",
  "S&P": "SPX",
  SP500: "SPX",
  DOW: "DJI",
  NASDAQ: "IXIC",
  TREASURY: "TNX",
  "10Y": "TNX",
};

export const TICKER_STOP_WORDS: Set<string> = new Set([
  ...COMMAND_DEFINITIONS.map((cmd) => cmd.code.toUpperCase().trim()),
  "A", "I", "AM", "AN", "AS", "AT", "BE", "BY", "DO", "GO", "HE", "IF", "IN", "IS", "IT",
  "ME", "MY", "NO", "OF", "ON", "OR", "SO", "TO", "UP", "US", "WE",
  "AND", "ARE", "BUT", "CAN", "DID", "FOR", "GET", "HAS", "HAD", "HER", "HIM", "HIS", "HOW",
  "ITS", "LET", "MAY", "NEW", "NOT", "NOW", "OFF", "OLD", "ONE", "OUR", "OUT", "OWN", "PUT",
  "RUN", "SAY", "SEE", "SET", "SHE", "THE", "TOO", "TWO", "USE", "WAS", "WAY", "WHO", "WHY",
  "WIN", "YES", "YOU",
  "ALL", "ANY", "ASK", "BUY", "CEO", "CFO", "CPI", "CTO", "DAY", "DES", "ECO", "EPS", "EST",
  "ETF", "EUR", "FED", "FCF", "GDP", "GP", "HP", "HLP", "IPO", "JPY", "KEY", "LOW", "MAX",
  "MIN", "NET", "OIL", "GAS", "GOLD", "SILVER", "CRUDE", "BRENT", "WTI", "PAY", "PEG", "PE",
  "ROE", "ROI", "SEC", "TOP", "USD", "VS", "WEB", "YOY", "ANR", "CRNC", "POLY", "NEWS", "HELP",
  "SETT", "BWRITE", "QUORIX",
  "ABOUT", "ANALYZE", "ANALYSIS", "AFFECT", "BEAR", "BETA", "BOND", "BONDS", "BULL",
  "CASH", "CHART", "COMPARE", "COMPANY", "DATA", "DESCRIBE", "DETAILS", "DOES", "EARNINGS",
  "EXPLAIN", "FACTS", "FIND", "FLOW", "FREE", "FROM", "GIVE", "GLOBAL", "GROWTH", "HAVE",
  "HIGH", "HOLD", "HOWS", "IMPACT", "IMPACTS", "INFLATION", "INFO", "LATEST", "LIST", "LIVE",
  "LOGIC", "MAIN", "MARGIN", "MARGINS", "MARKET", "MARKETS", "METRICS", "MORE", "MOVERS",
  "OUTLOOK", "OVERVIEW", "PRICE", "PRICES", "QUOTE", "QUOTES", "RATE", "RATES", "RATING",
  "RECENT", "REPORT", "REVENUE", "RISK", "RISKS", "SEARCH", "SEGMENT", "SEGMENTS", "SELL",
  "SEMICONDUCTOR", "SHARE", "SHARES", "SHOW", "STOCK", "STOCKS", "SUMMARIZE", "SUMMARY",
  "TARGET", "TECH", "TELL", "TERMINAL", "THAT", "THEIR", "THEM", "THEN", "THEY", "THIS",
  "TODAY", "TREND", "TRENDS", "VALUATION", "VERSUS", "WHAT", "WHEN", "WHERE", "WHICH", "WITH",
  "YIELD", "YIELDS",
]);

export function extractTickersFromCommand(command: string, fallbackTicker?: string): string[] {
  const found: string[] = [];
  const add = (sym: string) => {
    const clean = sym.toUpperCase().replace(/^\$/, "");
    if (clean && !found.includes(clean)) found.push(clean);
  };

  const upper = command.toUpperCase();

  // 1. Named company/index keywords
  for (const [name, sym] of Object.entries(COMPANY_NAME_TO_TICKER)) {
    const re = new RegExp(`(^|[^A-Z0-9])${name.replace("&", "\\&")}([^A-Z0-9]|$)`);
    if (re.test(upper)) add(sym);
  }

  // 2. Explicit $TICKER tags
  for (const m of command.matchAll(/\$([A-Za-z]{1,6}(?:-[A-Za-z]{1,2})?)/g)) {
    add(m[1]);
  }

  // 3. Uppercase tokens in original command
  for (const m of command.matchAll(/\b([A-Z]{2,5}(?:-[A-Z]{1,2})?)\b/g)) {
    if (!TICKER_STOP_WORDS.has(m[1])) add(m[1]);
  }

  // 4. Lowercase ticker-like tokens directly after command verbs / prepositions (e.g. "describe nvda", "nvda vs amd")
  const verbPatterns = [
    /\b(?:describe|analyze|summarise|summarize|about|quote|price|target|rating|ratings|overview|des|anr|gp|hp)\s+([a-zA-Z]{1,5})\b/gi,
    /\b(?:compare)\s+([a-zA-Z]{1,5})\s+(?:and|vs\.?|versus|with|to)\s+([a-zA-Z]{1,5})\b/gi,
    /\b([a-zA-Z]{1,5})\s+(?:vs\.?|versus|and)\s+([a-zA-Z]{1,5})\b/gi,
    /\bnews\s+(?:on|for|about)\s+([a-zA-Z]{1,5})\b/gi,
  ];
  for (const re of verbPatterns) {
    for (const m of command.matchAll(re)) {
      for (let idx = 1; idx < m.length; idx++) {
        const tok = (m[idx] || "").toUpperCase();
        if (tok && !TICKER_STOP_WORDS.has(tok)) add(tok);
      }
    }
  }

  if (found.length === 0 && fallbackTicker) {
    add(fallbackTicker);
  }
  return found.slice(0, 4);
}

function fmtVal(obj: any, fallback = "N/A"): string {
  if (obj === null || obj === undefined) return fallback;
  if (typeof obj === "object" && typeof obj.fmt === "string" && obj.fmt.trim()) return obj.fmt;
  if (typeof obj === "object" && typeof obj.raw === "number") return obj.raw.toFixed(2);
  if (typeof obj === "number") return isFinite(obj) ? obj.toFixed(2) : fallback;
  if (typeof obj === "string" && obj.trim()) return obj;
  return fallback;
}

function formatDescribeReport(sym: string, summary: any, chart: any, newsItems: any[]) {
  const profile = summary?.assetProfile || {};
  const detail = summary?.summaryDetail || {};
  const fin = summary?.financialData || {};
  const stats = summary?.defaultKeyStatistics || {};
  const priceObj = summary?.price || {};

  const name = priceObj.longName || priceObj.shortName || chart?.name || sym;
  const exchange = priceObj.exchangeName || chart?.exchange || "MARKET";
  const lastPrice = typeof chart?.price === "number" && chart.price > 0
    ? chart.price
    : fin?.currentPrice?.raw || priceObj?.regularMarketPrice?.raw || 0;
  const chg = typeof chart?.change === "number" ? chart.change : priceObj?.regularMarketChange?.raw || 0;
  const chgPct = typeof chart?.changePercent === "number"
    ? chart.changePercent
    : typeof priceObj?.regularMarketChangePercent?.raw === "number"
    ? priceObj.regularMarketChangePercent.raw * 100
    : 0;
  const sign = chg >= 0 ? "+" : "";

  const lines: string[] = [];
  lines.push(`${name.toUpperCase()} (${sym})`);
  lines.push(`${"=".repeat(72)}`);

  if (profile.sector || profile.industry || profile.fullTimeEmployees) {
    lines.push(
      `SECTOR: ${profile.sector || "N/A"} | INDUSTRY: ${profile.industry || "N/A"} | EXCHANGE: ${exchange}`
    );
    const hqParts = [profile.city, profile.state, profile.country].filter(Boolean).join(", ");
    lines.push(
      `HQ: ${hqParts || "N/A"} | EMPLOYEES: ${
        typeof profile.fullTimeEmployees === "number" ? profile.fullTimeEmployees.toLocaleString() : "N/A"
      } | WEB: ${profile.website || "N/A"}`
    );
  } else {
    lines.push(`EXCHANGE: ${exchange} | CURRENCY: ${chart?.currency || "USD"}`);
  }

  lines.push("");
  lines.push(`MARKET & VALUATION METRICS`);
  lines.push(
    `  LAST PRICE   : ${lastPrice > 0 ? `$${lastPrice.toFixed(2)} (${sign}${chg.toFixed(2)} / ${sign}${chgPct.toFixed(2)}%)` : "N/A"}`
  );
  lines.push(
    `  MARKET CAP   : ${fmtVal(priceObj.marketCap || detail.marketCap)}    |  BETA         : ${fmtVal(detail.beta || stats.beta)}`
  );
  lines.push(
    `  TRAILING P/E : ${fmtVal(detail.trailingPE)}    |  FORWARD P/E  : ${fmtVal(detail.forwardPE || stats.forwardPE)}`
  );
  lines.push(
    `  52W RANGE    : ${fmtVal(detail.fiftyTwoWeekLow, chart?.low52w ? chart.low52w.toFixed(2) : "N/A")} - ${fmtVal(detail.fiftyTwoWeekHigh, chart?.high52w ? chart.high52w.toFixed(2) : "N/A")}    |  DIV YIELD    : ${fmtVal(detail.dividendYield, "0.00%")}`
  );

  if (fin && Object.keys(fin).length > 0) {
    lines.push("");
    lines.push(`FINANCIAL HEALTH & CASH FLOW`);
    lines.push(
      `  REVENUE (TTM): ${fmtVal(fin.totalRevenue)}    |  REV GROWTH   : ${fmtVal(fin.revenueGrowth)}`
    );
    lines.push(
      `  GROSS MARGIN : ${fmtVal(fin.grossMargins)}    |  OPER MARGIN  : ${fmtVal(fin.operatingMargins)}`
    );
    lines.push(
      `  PROFIT MARGIN: ${fmtVal(fin.profitMargins)}    |  ROE          : ${fmtVal(fin.returnOnEquity)}`
    );
    lines.push(
      `  FREE CASH FLW: ${fmtVal(fin.freeCashflow)}    |  TOTAL CASH   : ${fmtVal(fin.totalCash)}`
    );
    lines.push(
      `  TOTAL DEBT   : ${fmtVal(fin.totalDebt)}    |  DEBT/EQUITY  : ${fmtVal(fin.debtToEquity)}`
    );
    if (fin.recommendationKey || fin.targetMeanPrice) {
      lines.push(
        `  CONSENSUS    : ${(fin.recommendationKey || "N/A").toUpperCase()} (${fin.numberOfAnalystOpinions?.raw || "—"} analysts) | MEAN TARGET: ${fmtVal(fin.targetMeanPrice)}`
      );
    }
  }

  if (profile.longBusinessSummary) {
    lines.push("");
    lines.push(`BUSINESS OVERVIEW`);
    lines.push(profile.longBusinessSummary);
  }

  if (Array.isArray(profile.companyOfficers) && profile.companyOfficers.length > 0) {
    lines.push("");
    lines.push(`KEY EXECUTIVES`);
    for (const off of profile.companyOfficers.slice(0, 5)) {
      lines.push(`  • ${off.name} — ${off.title || "Executive"}`);
    }
  }

  const links: Array<{ title: string; url: string }> = [
    { title: `Yahoo Finance: ${sym}`, url: `https://finance.yahoo.com/quote/${encodeURIComponent(mapToYahooSymbol(sym))}` },
  ];
  const headlines: Array<{ date: string; source: string; title: string; url: string }> = [];

  if (newsItems.length > 0) {
    lines.push("");
    lines.push(`RECENT HEADLINES (${sym})`);
    for (const item of newsItems.slice(0, 4)) {
      const ts = item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString().slice(0, 10)
        : "RECENT";
      const publisher = item.publisher || "MarketWire";
      const title = item.title || "";
      const link = typeof item.link === "string" ? item.link : "";
      lines.push(`  • [${ts}] ${publisher}: ${title}`);
      if (link) {
        links.push({ title: `${publisher}: ${title}`, url: link });
        headlines.push({ date: ts, source: publisher, title, url: link });
      } else {
        headlines.push({ date: ts, source: publisher, title, url: "" });
      }
    }
  }

  lines.push("");
  lines.push(`SOURCE: YAHOO FINANCE LIVE STREAM`);

  return { output: lines.join("\n"), links, headlines };
}

function formatAnalystReport(sym: string, summary: any, chart: any) {
  const fin = summary?.financialData || {};
  const priceObj = summary?.price || {};
  const trend = Array.isArray(summary?.recommendationTrend?.trend) ? summary.recommendationTrend.trend : [];
  const name = priceObj.longName || priceObj.shortName || chart?.name || sym;

  const currentPrice = typeof chart?.price === "number" && chart.price > 0
    ? chart.price
    : fin?.currentPrice?.raw || 0;
  const targetMean = fin?.targetMeanPrice?.raw;
  const upside = currentPrice > 0 && typeof targetMean === "number"
    ? (((targetMean - currentPrice) / currentPrice) * 100).toFixed(2)
    : null;

  const lines: string[] = [];
  lines.push(`${name.toUpperCase()} (${sym})`);
  lines.push(`${"=".repeat(72)}`);
  lines.push(
    `RECOMMENDATION : ${(fin.recommendationKey || "N/A").replace(/_/g, " ").toUpperCase()}  |  ANALYST COUNT: ${fin.numberOfAnalystOpinions?.raw ?? "N/A"}`
  );
  lines.push(
    `CURRENT PRICE  : ${currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : "N/A"}`
  );
  lines.push(
    `TARGET MEAN    : ${fmtVal(fin.targetMeanPrice)}${upside !== null ? ` (${parseFloat(upside) >= 0 ? "+" : ""}${upside}% implied)` : ""}`
  );
  lines.push(
    `TARGET RANGE   : LOW ${fmtVal(fin.targetLowPrice)}  |  MEDIAN ${fmtVal(fin.targetMedianPrice)}  |  HIGH ${fmtVal(fin.targetHighPrice)}`
  );

  if (trend.length > 0) {
    lines.push("");
    lines.push(`RATING BREAKDOWN (BY PERIOD)`);
    const columns = [
      { header: "PERIOD", align: "left" as const },
      { header: "STRONG BUY", align: "right" as const },
      { header: "BUY", align: "right" as const },
      { header: "HOLD", align: "right" as const },
      { header: "SELL", align: "right" as const },
      { header: "STRONG SELL", align: "right" as const },
    ];
    const rowValues = trend.slice(0, 4).map((row: any) => [
      String(row.period || ""),
      String(row.strongBuy ?? 0),
      String(row.buy ?? 0),
      String(row.hold ?? 0),
      String(row.sell ?? 0),
      String(row.strongSell ?? 0),
    ]);
    const colWidths = columns.map((col, idx) =>
      Math.max(col.header.length, ...rowValues.map((vals) => vals[idx].length))
    );
    const formatCols = (vals: string[]) =>
      "  " +
      vals
        .map((val, idx) =>
          columns[idx].align === "left"
            ? val.padEnd(colWidths[idx])
            : val.padStart(colWidths[idx])
        )
        .join("   ");

    lines.push(formatCols(columns.map((c) => c.header)));
    lines.push(formatCols(colWidths.map((w) => "-".repeat(w))));
    for (const vals of rowValues) {
      lines.push(formatCols(vals));
    }
  }

  lines.push("");
  lines.push(`KEY FUNDAMENTAL DRIVERS`);
  lines.push(`  • Revenue Growth (YoY) : ${fmtVal(fin.revenueGrowth)}`);
  lines.push(`  • Earnings Growth (YoY): ${fmtVal(fin.earningsGrowth)}`);
  lines.push(`  • Gross / Oper Margin  : ${fmtVal(fin.grossMargins)} / ${fmtVal(fin.operatingMargins)}`);
  lines.push(`  • Forward P/E          : ${fmtVal(summary?.summaryDetail?.forwardPE || summary?.defaultKeyStatistics?.forwardPE)}`);
  lines.push("");
  lines.push(`SOURCE: YAHOO FINANCE ANALYST DATA`);

  return {
    output: lines.join("\n"),
    links: [
      { title: `Yahoo Finance Analyst Estimates: ${sym}`, url: `https://finance.yahoo.com/quote/${encodeURIComponent(mapToYahooSymbol(sym))}/analysis` },
    ],
  };
}

export async function runExistingApiFallback(params: {
  command: string;
  screen?: string;
  ticker?: string;
  fredKey?: string;
}): Promise<{ output: string; links: Array<{ title: string; url: string }> }> {
  const { command = "", screen = "", ticker = "", fredKey = "" } = params;
  const cmdLower = command.toLowerCase();
  let tickers = extractTickersFromCommand(command, screen === "DES" || screen === "ANR" ? ticker : undefined);

  // If no explicit ticker was parsed and the user asks about a company/entity, try resolving via Yahoo search
  if (tickers.length === 0 && !/\b(macro|gdp|cpi|inflation|fed|rate|rates|treasury|yield|oil|gold|polymarket|market|news)\b/i.test(command)) {
    const searchRes = await fetchYahooSearch(command, 3, 4);
    const eq = searchRes.quotes.find((q: any) => q.quoteType === "EQUITY" && q.symbol);
    if (eq?.symbol) {
      tickers = [eq.symbol.toUpperCase()];
    }
  }

  const nonEquityMacroSymbols = new Set(["GC", "CL", "BZ", "TNX", "SPX", "DJI", "IXIC"]);
  const equityTickers = tickers.filter((t) => !nonEquityMacroSymbols.has(t));

  const isMacroQuery =
    /\b(fred|macro|cpi|inflation|gdp|unemployment|fed|fomc|rate|rates|treasury|yield|yields|oil|crude|brent|wti|gold|commodity|commodities|fx|currency|currencies|polymarket)\b/i.test(
      command
    );

  const isCompare =
    equityTickers.length >= 2 ||
    (/\b(compare|vs\.?|versus)\b/i.test(command) && tickers.length >= 2);

  const isNewsQuery =
    screen === "NEWS" ||
    /\b(news|headline|headlines|movers|search the web|latest)\b/i.test(command);

  const isAnrQuery =
    screen === "ANR" ||
    /\b(analyst|consensus|rating|ratings|price target|recommendations)\b/i.test(command);

  const isDesQuery =
    screen === "DES" ||
    (!isMacroQuery &&
      /\b(describe|description|overview|segment|segments|business|valuation|fundamentals|cash flow|margin|margins|bull|bear|risks|analyze)\b/i.test(
        command
      ));

  // 1. Multi-ticker comparison
  if (isCompare && tickers.length >= 2) {
    const results = await Promise.all(
      tickers.map(async (sym) => {
        const [summary, chart] = await Promise.all([
          fetchYahooQuoteSummary(sym),
          fetchYahooChartSnapshot(sym),
        ]);
        return { sym, summary, chart };
      })
    );

    const pad = (v: string, w = 13) => v.slice(0, w).padEnd(w);
    const lines: string[] = [];
    lines.push(`SIDE-BY-SIDE EQUITY COMPARISON: ${tickers.join(" vs ")}`);
    lines.push(`${"=".repeat(78)}`);
    lines.push(`${pad("METRIC", 18)} ${results.map((r) => pad(r.sym, 14)).join(" ")}`);
    lines.push(`${"-".repeat(18)} ${results.map(() => "-".repeat(14)).join(" ")}`);

    const rows: Array<[string, (r: { sym: string; summary: any; chart: any }) => string]> = [
      ["LAST PRICE", (r) => (r.chart?.price > 0 ? `$${r.chart.price.toFixed(2)}` : "N/A")],
      ["DAY CHG %", (r) => (typeof r.chart?.changePercent === "number" ? `${r.chart.changePercent >= 0 ? "+" : ""}${r.chart.changePercent.toFixed(2)}%` : "N/A")],
      ["MARKET CAP", (r) => fmtVal(r.summary?.price?.marketCap || r.summary?.summaryDetail?.marketCap)],
      ["TRAILING P/E", (r) => fmtVal(r.summary?.summaryDetail?.trailingPE)],
      ["FORWARD P/E", (r) => fmtVal(r.summary?.summaryDetail?.forwardPE || r.summary?.defaultKeyStatistics?.forwardPE)],
      ["BETA", (r) => fmtVal(r.summary?.summaryDetail?.beta || r.summary?.defaultKeyStatistics?.beta)],
      ["REV GROWTH", (r) => fmtVal(r.summary?.financialData?.revenueGrowth)],
      ["GROSS MARGIN", (r) => fmtVal(r.summary?.financialData?.grossMargins)],
      ["OPER MARGIN", (r) => fmtVal(r.summary?.financialData?.operatingMargins)],
      ["PROFIT MARGIN", (r) => fmtVal(r.summary?.financialData?.profitMargins)],
      ["FREE CASH FLW", (r) => fmtVal(r.summary?.financialData?.freeCashflow)],
      ["ROE", (r) => fmtVal(r.summary?.financialData?.returnOnEquity)],
      ["MEAN TARGET", (r) => fmtVal(r.summary?.financialData?.targetMeanPrice)],
      ["CONSENSUS", (r) => (r.summary?.financialData?.recommendationKey || "N/A").toUpperCase()],
    ];

    for (const [label, fn] of rows) {
      lines.push(`${pad(label, 18)} ${results.map((r) => pad(fn(r), 14)).join(" ")}`);
    }
    lines.push("");
    lines.push(`SOURCE: YAHOO FINANCE LIVE STREAM`);

    return {
      output: lines.join("\n"),
      links: results.map((r) => ({
        title: `Yahoo Finance: ${r.sym}`,
        url: `https://finance.yahoo.com/quote/${encodeURIComponent(mapToYahooSymbol(r.sym))}`,
      })),
    };
  }

  // 2. Analyst consensus (ANR)
  if (isAnrQuery && tickers.length >= 1) {
    const sym = tickers[0];
    const [summary, chart] = await Promise.all([
      fetchYahooQuoteSummary(sym),
      fetchYahooChartSnapshot(sym),
    ]);
    if (summary || chart) {
      return formatAnalystReport(sym, summary, chart);
    }
  }

  // 3. Security description / single-ticker deep dive (DES / "DESCRIBE NVDA")
  if ((isDesQuery || (!isNewsQuery && !isMacroQuery)) && tickers.length >= 1 && !(isMacroQuery && equityTickers.length === 0)) {
    const sym = equityTickers[0] || tickers[0];
    const [summary, chart, search] = await Promise.all([
      fetchYahooQuoteSummary(sym),
      fetchYahooChartSnapshot(sym),
      fetchYahooSearch(sym, 2, 5),
    ]);
    if (summary || chart) {
      return formatDescribeReport(sym, summary, chart, search.news);
    }

    // When explicitly on the DES screen and no company profile exists from Yahoo,
    // show a clean short notice instead of dumping market-wide benchmarks and FRED data
    if (screen === "DES") {
      const lines: string[] = [];
      lines.push(`${sym.toUpperCase()}`);
      lines.push("=".repeat(72));
      lines.push(`No company profile available for ${sym.toUpperCase()} yet.`);
      lines.push("");
      lines.push("SOURCE: LIVE MARKET DISCLOSURE DATA");

      return {
        output: lines.join("\n"),
        links: [
          {
            title: `Yahoo Finance: ${sym.toUpperCase()}`,
            url: `https://finance.yahoo.com/quote/${encodeURIComponent(mapToYahooSymbol(sym))}`,
          },
        ],
      };
    }
  }

  // 4. News / Web Headlines fallback via Yahoo Finance Search News
  if (isNewsQuery) {
    const searchTopic = tickers.length > 0 ? tickers.join(" ") : command.replace(/\b(latest|news|on|for|search the web|today's|recent)\b/gi, "").trim() || "stock market";
    const searchRes = await fetchYahooSearch(searchTopic, 3, 8);
    const lines: string[] = [];
    const links: Array<{ title: string; url: string }> = [];
    lines.push(`LIVE MARKET NEWS DISPATCH — QUERY: "${searchTopic.toUpperCase()}"`);
    lines.push(`${"=".repeat(72)}`);
    if (searchRes.news.length === 0) {
      lines.push("No live headlines matched this exact query. Try the NEWS tab for the full multi-source feed.");
    } else {
      for (const item of searchRes.news) {
        const dt = item.providerPublishTime
          ? new Date(item.providerPublishTime * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC"
          : "LIVE";
        lines.push(`[${dt}] ${item.publisher || "MarketWire"}`);
        lines.push(`  ${item.title}`);
        lines.push("");
        if (item.link) links.push({ title: `${item.publisher || "Source"}: ${item.title}`, url: item.link });
      }
    }
    lines.push(`SOURCE: YAHOO FINANCE LIVE NEWS STREAM`);
    return { output: lines.join("\n"), links };
  }

  // 5. Macro, Rates, Commodities, Polymarket & General Fallback
  const lines: string[] = [];
  const links: Array<{ title: string; url: string }> = [];
  lines.push(`QUORIX LIVE DATA BRIEF — QUERY: "${command.toUpperCase()}"`);
  lines.push(`${"=".repeat(72)}`);

  const [spx, ixic, tnx, cl, bz, gc, btc, searchRes, fredData] = await Promise.all([
    fetchYahooChartSnapshot("SPX"),
    fetchYahooChartSnapshot("IXIC"),
    fetchYahooChartSnapshot("TNX"),
    fetchYahooChartSnapshot("CL"),
    fetchYahooChartSnapshot("BZ"),
    fetchYahooChartSnapshot("GC"),
    fetchYahooChartSnapshot("BTC"),
    fetchYahooSearch(command, 3, 5),
    fredKey ? fetchLiveFredEconomics(fredKey).catch(() => null) : Promise.resolve(null),
  ]);

  lines.push(`LIVE CROSS-ASSET BENCHMARKS`);
  for (const q of [spx, ixic, tnx, cl, bz, gc, btc]) {
    if (!q || !q.price) continue;
    const s = q.change >= 0 ? "+" : "";
    const unit = q.symbol === "TNX" ? "%" : "";
    const px = q.symbol === "TNX" ? q.price.toFixed(3) : q.price.toFixed(2);
    lines.push(`  ${q.symbol.padEnd(5)} (${q.name.slice(0, 22).padEnd(22)}): ${px}${unit} (${s}${q.changePercent.toFixed(2)}%)`);
  }

  if (fredData) {
    lines.push("");
    lines.push(`LIVE FRED MACROECONOMIC & TREASURY SNAPSHOT`);
    const us = fredData.indicators?.find((i: any) => i.country === "UNITED STATES");
    if (us) {
      lines.push(`  US GDP Growth: ${us.gdpGrow} | US Unemployment: ${us.unemployment} | US CPI YoY: ${us.inflation} | Fed Target: ${us.rate}`);
    }
    for (const m of fredData.macroMetrics || []) {
      if (m.value !== "N/A") {
        lines.push(`  ${m.label.padEnd(22)}: ${m.value} (as of ${m.date})`);
      }
    }
    links.push({ title: "St. Louis Fed FRED", url: "https://fred.stlouisfed.org/" });
  }

  if (cmdLower.includes("oil") || cmdLower.includes("crude") || cmdLower.includes("gold") || cmdLower.includes("fed") || cmdLower.includes("rate") || cmdLower.includes("inflation") || cmdLower.includes("polymarket")) {
    try {
      const pmRes = await fetch("https://gamma-api.polymarket.com/events?active=true&closed=false&limit=12&order=volume&ascending=false");
      if (pmRes.ok) {
        const pmEvents = await pmRes.json();
        if (Array.isArray(pmEvents)) {
          const keywords = command.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
          const matched = pmEvents.filter((ev: any) => {
            const title = (ev.title || "").toLowerCase();
            return keywords.some((kw) => title.includes(kw));
          }).slice(0, 3);
          if (matched.length > 0) {
            lines.push("");
            lines.push(`RELATED POLYMARKET PREDICTION ODDS`);
            for (const ev of matched) {
              lines.push(`  • ${ev.title} (Vol: $${Math.round(Number(ev.volume || 0)).toLocaleString()})`);
              if (ev.slug) links.push({ title: `Polymarket: ${ev.title}`, url: `https://polymarket.com/event/${ev.slug}` });
            }
          }
        }
      }
    } catch {
      // ignore Polymarket failure in fallback
    }
  }

  if (searchRes.news.length > 0) {
    lines.push("");
    lines.push(`RELATED LIVE NEWS HEADLINES`);
    for (const item of searchRes.news.slice(0, 4)) {
      const dt = item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString().slice(0, 10)
        : "LIVE";
      lines.push(`  • [${dt}] ${item.publisher || "MarketWire"}: ${item.title}`);
      if (item.link) links.push({ title: `${item.publisher || "News"}: ${item.title}`, url: item.link });
    }
  }

  lines.push("");
  lines.push(`SOURCE: FRED MACRO + YAHOO FINANCE + POLYMARKET`);

  return { output: lines.join("\n"), links };
}

// REST endpoints
app.post("/api/terminal/analyze", async (req, res) => {
  const { command, context, ticker, screen } = req.body;
  const ai = getAiClient();

  // Prompt configuration based on screen type
  let prompt = "";
  let systemInstruction = "You are a QUORIX Core Intelligence Server. Provide hyper-professional, concise, data-dense financial responses. Use standard monospaced formatting where helpful, with tabulations or lists. Avoid conversational introductory fluff like 'Here is your report'. Start directly with the factual data or table.";

  // Inject live FRED US macro snapshot when FRED_API_KEY is available
  let fredContextSummary = "";
  const fredKey = getFredApiKey();
  if (fredKey) {
    try {
      const fredData = await fetchLiveFredEconomics(fredKey);
      const us = fredData.indicators.find((i: any) => i.country === "UNITED STATES");
      const ratesSummary = fredData.macroMetrics
        .filter((m: any) => m.value !== "N/A")
        .map((m: any) => `${m.label}: ${m.value} (${m.date})`)
        .join(", ");
      if (us || ratesSummary) {
        fredContextSummary = `\nLive FRED Macro Snapshot: US GDP Growth=${us?.gdpGrow || "N/A"}, US Unemployment=${us?.unemployment || "N/A"}, US CPI YoY=${us?.inflation || "N/A"}, Fed Target=${us?.rate || "N/A"}; ${ratesSummary}.`;
      }
    } catch {
      // ignore if FRED fails during AI call
    }
  }

  if (screen === "DES") {
    prompt = `Generate a standard Quorix-style DES (Description) page for ticker ${ticker || command}. Provide:
    1. A concise business description of 3-4 sentences.
    2. Primary executives and titles.
    3. Structural financial characteristics (e.g. Major business segments, growth outlook).
    Keep it extremely factual, professional, and compact.`;
  } else if (screen === "ANR") {
    prompt = `Analyze current analyst consensus recommendations for ${ticker || command}. Provide:
    1. A breakdown of BUY / HOLD / SELL recommendations.
    2. An estimated Consensus Price Target.
    3. 3 core bullish arguments and 3 core bearish risks.
    Format as plain text with absolute brevity. If presenting tabular columns (e.g. a Rating Breakdown), pad every cell strictly with ASCII spaces (no tabs, no markdown tables) so every data value aligns cleanly under its column header in a monospaced font.`;
  } else if (screen === "NEWS") {
    prompt = `Retrieve 4 recent factual financial news headlines for stock ticker/symbol ${ticker || command || 'Global Markets'}.
    For each headline, specify:
    - Time of release (in hh:mm UTC format)
    - Source (e.g. Bloomberg News, Reuters, WSJ, SEC Filing)
    - A 1-line headline summarizing the story
    - Market Sentiment (Positive, Negative, or Neutral)
    Only provide factual news that fits current market conditions. Use Google Search grounding for real-time headlines.`;
  } else {
    // General terminal prompt or conversation (ASK / HELP)
    prompt = `You are interpreting a QUORIX terminal command/query: "${command}".
    If it represents a stock analysis, analyze it in a highly sophisticated financial context.
    If it's a general question or financial theory request, give a precise tabular or list breakdown of the core mechanics.
    Current terminal context: ${JSON.stringify(context || {})}.${fredContextSummary}`;
  }

  // Execute with Gemini when configured
  if (ai) {
    try {
      const config: any = {
        systemInstruction,
      };

      // Enable Google Search grounding for REAL-TIME market news
      if (screen === "NEWS" || command?.toLowerCase().includes("news") || command?.toLowerCase().includes("web")) {
        config.tools = [{ googleSearch: {} }];
      }

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: prompt,
        config,
      });

      const text = response.text || "NO DATA RETURNED FROM SYSTEM CORE";
      
      // Get grounding metadata if present and return it
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || null;
      let links: Array<{ title: string; url: string }> = [];
      if (chunks) {
        links = chunks
          .filter((c: any) => c.web?.uri)
          .map((c: any) => ({
            title: c.web.title || "Source",
            url: c.web.uri,
          }));
      }

      return res.json({
        success: true,
        output: text,
        links,
        headlines: [],
        modelUsed: "gemini-4-hydrogen",
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const isKeyError =
        errMsg.includes("API key not valid") ||
        errMsg.includes("API_KEY_INVALID") ||
        err?.status === 400 ||
        err?.status === 403;
      if (isKeyError) {
        aiClient = null;
        aiClientKey = "";
      }
      console.log(`Gemini unavailable (${err?.status || "error"}); falling back to existing live APIs.`);
    }
  }

  // Fallback to existing live APIs (Yahoo Finance fundamentals/charts/search, FRED macro, Polymarket)
  try {
    const fallback = await runExistingApiFallback({
      command: command || ticker || "",
      screen,
      ticker,
      fredKey,
    });
    return res.json({
      success: true,
      output: fallback.output,
      links: fallback.links,
      headlines: (fallback as any).headlines || [],
      modelUsed: "existing-apis-fallback",
      timestamp: new Date().toISOString(),
    });
  } catch (fallbackErr: any) {
    return res.json({
      success: false,
      output: `LIVE ANALYSIS UNAVAILABLE: ${fallbackErr?.message || "Failed to fetch fallback market data."}`,
      links: [],
      modelUsed: "unavailable",
      timestamp: new Date().toISOString(),
    });
  }
});

// Simple in-memory cache for Alpha Vantage quotes to protect against rate-limiting
const quoteCache: Record<string, { timestamp: number; quote: any }> = {};
const CACHE_TTL_MS = 60000; // Cache for 60 seconds (1 minute)

function getETDetails(date: Date = new Date()) {
  try {
    const etString = date.toLocaleString("en-US", { timeZone: "America/New_York" });
    const etDate = new Date(etString);
    
    const day = etDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const hours = etDate.getHours();
    const minutes = etDate.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    const isWeekend = day === 0 || day === 6;
    const isCoreHours = !isWeekend && (totalMinutes >= 9 * 60 + 30) && (totalMinutes < 16 * 60);
    const isPreMarket = !isWeekend && (totalMinutes >= 4 * 60) && (totalMinutes < 9 * 60 + 30);
    const isAfterHours = !isWeekend && (totalMinutes >= 16 * 60) && (totalMinutes < 20 * 60);

    return {
      isWeekend,
      isCoreHours,
      isPreMarket,
      isAfterHours,
      hours,
      minutes,
      day,
      totalMinutes,
      timeStr: etDate.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
  } catch (err) {
    const day = date.getDay();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    const isWeekend = day === 0 || day === 6;
    const isCoreHours = !isWeekend && (totalMinutes >= 9 * 60 + 30) && (totalMinutes < 16 * 60);
    const isPreMarket = !isWeekend && (totalMinutes >= 4 * 60) && (totalMinutes < 9 * 60 + 30);
    const isAfterHours = !isWeekend && (totalMinutes >= 16 * 60) && (totalMinutes < 20 * 60);
    return {
      isWeekend,
      isCoreHours,
      isPreMarket,
      isAfterHours,
      hours,
      minutes,
      day,
      totalMinutes,
      timeStr: date.toLocaleTimeString()
    };
  }
}

function adjustQuoteForTradingHours(quoteObj: any) {
  const cloned = { ...quoteObj };
  const et = getETDetails();
  const cacheKey = cloned.symbol.toUpperCase();
  const basePrice = cloned.price;
  
  let isPreMarket = false;
  let isAfterHours = false;
  let isCoreHours = et.isCoreHours;
  
  let preMarketPrice: number | null = null;
  let afterHoursPrice: number | null = null;
  let extHoursPrice: number | null = null;
  let extHoursChange: number | null = null;
  let extHoursChangePercent: number | null = null;
  let extHoursSession: 'PRE' | 'POST' | null = null;

  const decimals = cacheKey === 'TNX' ? 3 : 2;
  const candidateExt =
    typeof cloned.fulldayPriceYF === 'number' && cloned.fulldayPriceYF > 0
      ? cloned.fulldayPriceYF
      : et.isPreMarket && typeof cloned.preMarketPriceYF === 'number' && cloned.preMarketPriceYF > 0
      ? cloned.preMarketPriceYF
      : et.isAfterHours && typeof cloned.postMarketPriceYF === 'number' && cloned.postMarketPriceYF > 0
      ? cloned.postMarketPriceYF
      : null;

  const supportsPrePost = Boolean(cloned.hasPrePostMarketData || cloned.preMarketPriceYF || cloned.postMarketPriceYF);

  if (cloned.isRealYF && supportsPrePost && !et.isCoreHours && typeof candidateExt === 'number' && candidateExt > 0) {
    if (et.isPreMarket) {
      isPreMarket = true;
      preMarketPrice = parseFloat(candidateExt.toFixed(decimals));
      extHoursPrice = preMarketPrice;
      extHoursSession = 'PRE';
    } else if (et.isAfterHours) {
      isAfterHours = true;
      afterHoursPrice = parseFloat(candidateExt.toFixed(decimals));
      extHoursPrice = afterHoursPrice;
      extHoursSession = 'POST';
    } else if (Math.abs(candidateExt - basePrice) > 0.0001) {
      // Overnight / post-close outside 4:00-8:00 PM ET window: retain last post-market quote
      afterHoursPrice = parseFloat(candidateExt.toFixed(decimals));
      extHoursPrice = afterHoursPrice;
      extHoursSession = 'POST';
    }

    if (typeof extHoursPrice === 'number' && basePrice > 0) {
      extHoursChange = parseFloat((extHoursPrice - basePrice).toFixed(decimals));
      extHoursChangePercent = parseFloat(((extHoursChange / basePrice) * 100).toFixed(2));
    }
  }

  return {
    ...cloned,
    isPreMarket,
    isAfterHours,
    isCoreHours,
    preMarketPrice,
    afterHoursPrice,
    extHoursPrice,
    extHoursChange,
    extHoursChangePercent,
    extHoursSession,
    originalPrice: basePrice
  };
}

function mapToYahooSymbol(cacheKey: string): string {
  const key = cacheKey.toUpperCase().trim();
  if (key === 'SPX') return '^GSPC';
  if (key === 'DJI') return '^DJI';
  if (key === 'IXIC') return '^IXIC';
  if (key === 'VIX') return '^VIX';
  if (key === 'RUT') return '^RUT';
  if (key === 'GC') return 'GC=F';
  if (key === 'CL') return 'CL=F';
  if (key === 'BZ') return 'BZ=F';
  if (key === 'TNX') return '^TNX';
  if (key === 'BTC') return 'BTC-USD';
  if (key === 'ETH') return 'ETH-USD';
  if (key === 'SOL') return 'SOL-USD';
  if (key === 'DXY') return 'DX-Y.NYB';
  // Convert US class-share dot notation (e.g., BRK.B -> BRK-B, BF.B -> BF-B)
  if (/^[A-Z0-9]+\.[A-Z]$/.test(key)) return key.replace('.', '-');
  return key;
}

function formatYahooTimestamp(tsSeconds: number, interval: string): string {
  const date = new Date(tsSeconds * 1000);
  if (interval === '5m') {
    return date.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  if (['15m', '30m', '1h'].includes(interval)) {
    const md = date.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric',
      day: 'numeric'
    });
    const hm = date.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${md} ${hm}`;
  }
  if (interval === '1M') {
    return date.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      year: 'numeric'
    });
  }
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric'
  });
}

function extractYahooBars(
  result: any,
  interval: string,
  maxBarsOrOpts:
    | number
    | {
        maxBars?: number;
        windowSeconds?: number;
        todayOnly?: boolean;
        evenlySample?: boolean;
        preserveAll?: boolean;
      } = 24
) {
  const opts =
    typeof maxBarsOrOpts === 'number'
      ? { maxBars: maxBarsOrOpts, evenlySample: false, todayOnly: false, preserveAll: false }
      : { maxBars: 36, evenlySample: false, todayOnly: false, preserveAll: false, ...maxBarsOrOpts };

  const timestamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const opens: any[] = Array.isArray(quote.open) ? quote.open : [];
  const highs: any[] = Array.isArray(quote.high) ? quote.high : [];
  const lows: any[] = Array.isArray(quote.low) ? quote.low : [];
  const closes: any[] = Array.isArray(quote.close) ? quote.close : [];
  const volumes: any[] = Array.isArray(quote.volume) ? quote.volume : [];

  // Detect whether timestamps span multiple calendar years (for unambiguous HP timestamps)
  let includeYearInHourly = false;
  if (opts.preserveAll && timestamps.length > 1) {
    const firstYear = new Date(timestamps[0] * 1000).toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
    });
    const lastYear = new Date(timestamps[timestamps.length - 1] * 1000).toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
    });
    includeYearInHourly = firstYear !== lastYear;
  }

  const byTimestamp = new Map<
    number,
    {
      date: string;
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      isMarketCloseSnapshot?: boolean;
      [key: string]: any;
    }
  >();

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (
      typeof ts === 'number' &&
      typeof o === 'number' &&
      typeof h === 'number' &&
      typeof l === 'number' &&
      typeof c === 'number' &&
      Number.isFinite(ts) &&
      Number.isFinite(o) &&
      Number.isFinite(h) &&
      Number.isFinite(l) &&
      Number.isFinite(c)
    ) {
      const formattedDate = opts.preserveAll
        ? formatHistoricalHourlyTimestamp(ts, includeYearInHourly)
        : formatYahooTimestamp(ts, interval);
      const bar = {
        date: formattedDate,
        timestamp: ts,
        open: parseFloat(o.toFixed(3)),
        high: parseFloat(h.toFixed(3)),
        low: parseFloat(l.toFixed(3)),
        close: parseFloat(c.toFixed(3)),
        volume: typeof volumes[i] === 'number' && Number.isFinite(volumes[i]) ? volumes[i] : 0,
        isMarketCloseSnapshot: false,
      };
      bar.isMarketCloseSnapshot = isClosingPriceSnapshotBar(bar);

      const existing = byTimestamp.get(ts);
      if (!existing || bar.volume > existing.volume) {
        byTimestamp.set(ts, bar);
      }
    }
  }

  let bars = Array.from(byTimestamp.values());

  // Sort strictly chronologically (oldest first)
  bars.sort((a, b) => a.timestamp - b.timestamp);

  // Compute all technical studies over full continuous warmup series BEFORE window slicing
  const tz = result?.meta?.exchangeTimezoneName || 'America/New_York';
  if (bars.length > 0 && !opts.preserveAll) {
    enrichBarsWithStudies(bars, tz);
  }

  if (bars.length > 0 && !opts.preserveAll) {
    const latestTs = bars[bars.length - 1].timestamp;
    if (opts.todayOnly) {
      const latestDay = new Date(latestTs * 1000).toLocaleDateString('en-US', { timeZone: tz });
      bars = bars.filter(
        (b) => new Date(b.timestamp * 1000).toLocaleDateString('en-US', { timeZone: tz }) === latestDay
      );
    }
    if (typeof opts.windowSeconds === 'number' && opts.windowSeconds > 0) {
      const cutoff = latestTs - opts.windowSeconds;
      const windowed = bars.filter((b) => b.timestamp >= cutoff);
      if (windowed.length > 0) {
        bars = windowed;
      }
    }
  }

  if (!opts.preserveAll) {
    const maxBars = opts.maxBars ?? 36;
    if (bars.length > maxBars) {
      if (opts.evenlySample) {
        // Sample evenly while preserving earliest (index 0) and latest/current (index bars.length - 1)
        const sampled: typeof bars = [];
        for (let i = 0; i < maxBars; i++) {
          const idx = Math.round((i / (maxBars - 1)) * (bars.length - 1));
          if (sampled.length === 0 || sampled[sampled.length - 1].timestamp !== bars[idx].timestamp) {
            sampled.push(bars[idx]);
          }
        }
        bars = sampled;
      } else {
        bars = bars.slice(bars.length - maxBars);
      }
    }
  }

  // Return newest first
  return bars.reverse();
}

// Proxy endpoint for Alpha Vantage / Yahoo Finance quote updates to keep API keys safe server-side
app.get("/api/alpha-vantage/quote", async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) {
      return res.status(400).json({ success: false, error: "Symbol is required" });
    }
    const cacheKey = (symbol as string).toUpperCase();
    const now = Date.now();
    const cached = quoteCache[cacheKey];
    const force = req.query.force === "true";

    // If cache exists and is fresh (within 60 seconds), return it immediately (unless forced)
    if (!force && cached && (now - cached.timestamp < CACHE_TTL_MS)) {
      console.log(`Serving FRESH cached quote for: ${cacheKey} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
      return res.json({
        success: true,
        quote: adjustQuoteForTradingHours(cached.quote),
        cachedAt: new Date(cached.timestamp).toLocaleTimeString(),
        isCached: true
      });
    }

    const yfSymbol = mapToYahooSymbol(cacheKey);
    let yfChartReturned404 = false;

    // --- STEP 1: Try Yahoo Finance Chart First (Free, real-time, includes real hourly bars) ---
    try {
      console.log(`Querying Yahoo Finance proxy for symbol: ${yfSymbol} (requested as: ${cacheKey})`);
      const yfUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?interval=1h&range=5d`;
      const yfResponse = await fetch(yfUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      if (yfResponse.status === 404) {
        yfChartReturned404 = true;
      }
      if (yfResponse.ok) {
        const yfData = await yfResponse.json();
        const result = yfData?.chart?.result?.[0];
        if (result && isValidYahooChartMeta(result.meta)) {
          const meta = result.meta;
          const quote = result.indicators?.quote?.[0] || {};
          const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
          const price = typeof meta.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice)
            ? meta.regularMarketPrice
            : 0;
          const rawPrevClose =
            typeof meta.regularMarketPreviousClose === 'number'
              ? meta.regularMarketPreviousClose
              : typeof meta.previousClose === 'number'
              ? meta.previousClose
              : typeof meta.chartPreviousClose === 'number'
              ? meta.chartPreviousClose
              : null;
          const prevClose = rawPrevClose !== null ? rawPrevClose : 0;
          const decimals = cacheKey === 'TNX' ? 3 : 2;
          const change = rawPrevClose !== null && price > 0 ? parseFloat((price - rawPrevClose).toFixed(decimals)) : 0;
          const changePercent = rawPrevClose !== null && rawPrevClose > 0 && price > 0 ? parseFloat(((change / rawPrevClose) * 100).toFixed(2)) : 0;
          const history = extractYahooBars(result, '1h', 40);

          const regularStart = meta.currentTradingPeriod?.regular?.start;
          let todayOpen = typeof meta.regularMarketOpen === 'number' ? meta.regularMarketOpen : 0;
          if (!todayOpen && typeof regularStart === 'number' && Array.isArray(quote.open)) {
            const idx = timestamps.findIndex((ts) => ts >= regularStart);
            if (idx !== -1 && typeof quote.open[idx] === 'number') {
              todayOpen = quote.open[idx];
            }
          }
          if (!todayOpen && Array.isArray(quote.open)) {
            const validOpens = quote.open.filter((v: any) => typeof v === 'number');
            if (validOpens.length > 0) todayOpen = validOpens[validOpens.length - 1];
          }
          if (!todayOpen) todayOpen = prevClose;

          const formatExchangeName = (m: any): string => {
            const full = String(m?.fullExchangeName || '').trim();
            const code = String(m?.exchangeName || '').trim().toUpperCase();
            const fullUpper = full.toUpperCase();
            if (fullUpper.includes('NASDAQ') || ['NMS', 'NCM', 'NGM', 'NAS', 'NIM'].includes(code)) return 'NASDAQ';
            if (fullUpper === 'NYSEARCA' || code === 'PCX') return 'NYSE ARCA';
            if (fullUpper === 'NYSE' || code === 'NYQ') return 'NYSE';
            if (fullUpper.includes('NYSE AMERICAN') || code === 'ASE') return 'NYSE AMERICAN';
            if (fullUpper.includes('NY MERCANTILE') || code === 'NYM') return 'NYMEX';
            if (code === 'CMX') return 'COMEX';
            if (code === 'CCC' || fullUpper === 'CCC') return 'CRYPTO';
            if (code === 'SNP') return 'S&P INDEX';
            if (code === 'DJI') return 'DOW JONES';
            return (full || code || '').toUpperCase();
          };

          const parsedQuote = {
            symbol: cacheKey,
            open: todayOpen,
            high: typeof meta.regularMarketDayHigh === 'number' ? meta.regularMarketDayHigh : price,
            low: typeof meta.regularMarketDayLow === 'number' ? meta.regularMarketDayLow : price,
            price: price,
            volume: typeof meta.regularMarketVolume === 'number' ? meta.regularMarketVolume : 0,
            latestTradingDay: new Date().toISOString().split('T')[0],
            prevClose: prevClose,
            change: change,
            changePercent: changePercent,
            name: String(meta.longName || meta.shortName || cacheKey).trim(),
            exchange: formatExchangeName(meta),
            instrumentType: typeof meta.instrumentType === 'string' ? meta.instrumentType.toUpperCase() : undefined,
            isValidSecurity: true,
            history,
            isRealYF: true,
            hasPrePostMarketData: Boolean(meta.hasPrePostMarketData),
            fulldayPriceYF: typeof meta.fulldayPrice === 'number' && meta.fulldayPrice > 0 ? meta.fulldayPrice : null,
            preMarketPriceYF: meta.preMarketPrice || null,
            postMarketPriceYF: meta.postMarketPrice || meta.extendedMarketPrice || null
          };

          // Save to in-memory cache
          quoteCache[cacheKey] = {
            timestamp: now,
            quote: parsedQuote
          };

          console.log(`Yahoo Finance fetch successful for ${cacheKey} (via ${yfSymbol}): $${parsedQuote.price}`);
          return res.json({
            success: true,
            quote: adjustQuoteForTradingHours(parsedQuote),
            isCached: false
          });
        }
      }
    } catch (yfErr: any) {
      console.log("Yahoo Finance query failed or returned empty results, checking search/fallback:", yfErr.message);
    }

    // --- STEP 2: Verify Security Identity via Yahoo Search (accepts valid equities missing chart price/volume) ---
    const searchLookup = await fetchYahooSearchDetailed(cacheKey, 5, 0);
    const searchEquityMatch = findValidYahooSearchEquity(searchLookup.quotes, cacheKey, yfSymbol);

    // --- STEP 3: Fallback to Alpha Vantage if configured ---
    const apiKey = getActiveApiKey("ALPHA_VANTAGE_API_KEY");
    if (apiKey) {
      try {
        const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(cacheKey)}&apikey=${encodeURIComponent(apiKey)}`;
        console.log(`Querying Alpha Vantage proxy for symbol: ${cacheKey}`);
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();

          if (data.Note || data.Information) {
            console.log(
              "Alpha Vantage notice:",
              redactSecrets(data.Note || data.Information, { extraSecrets: [apiKey], maxLength: 240 })
            );
            if (cached) {
              return res.json({
                success: true,
                quote: adjustQuoteForTradingHours(cached.quote),
                cachedAt: new Date(cached.timestamp).toLocaleTimeString(),
                isCached: true,
                warning: "API rate limit reached. Serving last known live quote.",
                isRateLimited: true
              });
            }
          } else if (!data["Error Message"]) {
            const quote = data["Global Quote"];
            const avSymbol = String(quote?.["01. symbol"] || "").trim().toUpperCase();
            const avPrice = parseFloat(quote?.["05. price"] || "0");
            const hasQuoteFields = Boolean(quote && avSymbol && (avPrice > 0 || quote["07. latest trading day"]));
            if (hasQuoteFields) {
              const parsedQuote = {
                symbol: avSymbol,
                open: parseFloat(quote["02. open"] || "0"),
                high: parseFloat(quote["03. high"] || "0"),
                low: parseFloat(quote["04. low"] || "0"),
                price: Number.isFinite(avPrice) ? avPrice : 0,
                volume: parseInt(quote["06. volume"] || "0") || 0,
                latestTradingDay: quote["07. latest trading day"] || "",
                prevClose: parseFloat(quote["08. previous close"] || "0"),
                change: parseFloat(quote["09. change"] || "0"),
                changePercent: parseFloat((quote["10. change percent"] || "0%").replace("%", "")) || 0,
                name: searchEquityMatch?.longname || searchEquityMatch?.shortname || avSymbol,
                exchange: (searchEquityMatch?.exchDisp || searchEquityMatch?.exchange || "").toUpperCase(),
                instrumentType: searchEquityMatch?.quoteType,
                isValidSecurity: true,
              };

              quoteCache[cacheKey] = {
                timestamp: now,
                quote: parsedQuote
              };

              return res.json({
                success: true,
                quote: adjustQuoteForTradingHours(parsedQuote),
                isCached: false
              });
            }
          }
        }
      } catch (avErr: any) {
        console.log(
          "Alpha Vantage fallback failed:",
          redactErrorMessage(avErr, "Alpha Vantage request failed.", { extraSecrets: [apiKey] })
        );
      }
    }

    // If Yahoo Search confirmed a legitimate identifiable security whose price/volume is temporarily unavailable, allow it
    if (searchEquityMatch) {
      const securityOnlyQuote = {
        symbol: cacheKey,
        open: 0,
        high: 0,
        low: 0,
        price: 0,
        volume: 0,
        latestTradingDay: new Date().toISOString().split('T')[0],
        prevClose: 0,
        change: 0,
        changePercent: 0,
        name: searchEquityMatch.longname || searchEquityMatch.shortname || cacheKey,
        exchange: (searchEquityMatch.exchDisp || searchEquityMatch.exchange || "").toUpperCase(),
        instrumentType: searchEquityMatch.quoteType,
        isValidSecurity: true,
        quoteUnavailable: true,
        history: [],
      };

      return res.json({
        success: true,
        quote: adjustQuoteForTradingHours(securityOnlyQuote),
        isCached: false
      });
    }

    if (cached && !yfChartReturned404) {
      return res.json({
        success: true,
        quote: adjustQuoteForTradingHours(cached.quote),
        cachedAt: new Date(cached.timestamp).toLocaleTimeString(),
        isCached: true,
        warning: "Live quote provider unavailable. Serving cached quote."
      });
    }

    const confirmedInvalid = searchLookup.ok && yfChartReturned404;
    return res.json({
      success: false,
      isInvalidTicker: confirmedInvalid,
      error: confirmedInvalid
        ? `No valid equity or security found for ticker "${cacheKey}".`
        : "Unable to verify live quote data for symbol."
    });
  } catch (err: any) {
    const safeMsg = redactErrorMessage(err, "Unable to fetch quote data.");
    console.log("Quote endpoint handled gracefully:", safeMsg);
    return res.json({
      success: false,
      isInvalidTicker: false,
      error: safeMsg,
    });
  }
});

// Dedicated server-side cache for Historical Price (HP) hourly datasets (5-minute TTL)
const HP_HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_HP_CACHE_ENTRIES = 120;
const hpHistoryCache = new Map<
  string,
  {
    timestamp: number;
    history: HistoricalPriceBar[];
    provider: string;
    tradingDays: number;
    warning: string | null;
  }
>();

function setHpHistoryCache(
  symbol: string,
  entry: {
    timestamp: number;
    history: HistoricalPriceBar[];
    provider: string;
    tradingDays: number;
    warning: string | null;
  }
) {
  if (hpHistoryCache.size >= MAX_HP_CACHE_ENTRIES) {
    const oldest = hpHistoryCache.keys().next().value;
    if (oldest) hpHistoryCache.delete(oldest);
  }
  hpHistoryCache.set(symbol, entry);
}

// Server-side cache for Alpha Vantage quarterly earnings announcement dates (6-hour TTL for valid responses, 60s cooldown on rate-limit)
const EARNINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EARNINGS_RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const MAX_EARNINGS_CACHE_ENTRIES = 200;
interface EarningsHistoryCacheEntry {
  timestamp: number;
  ttlMs: number;
  success: boolean;
  reportedDates: string[];
  error: string | null;
}
const earningsHistoryCache = new Map<string, EarningsHistoryCacheEntry>();
const earningsInFlight = new Map<string, Promise<EarningsHistoryCacheEntry>>();

function setEarningsHistoryCache(symbol: string, entry: EarningsHistoryCacheEntry) {
  if (earningsHistoryCache.size >= MAX_EARNINGS_CACHE_ENTRIES) {
    const oldest = earningsHistoryCache.keys().next().value;
    if (oldest) earningsHistoryCache.delete(oldest);
  }
  earningsHistoryCache.set(symbol, entry);
}

// In-memory cache for 2-year daily adjusted-close series used by Correlation Analyzer (15-min TTL)
const DAILY_ADJ_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_DAILY_ADJ_CACHE_ENTRIES = 200;
interface DailyAdjCacheEntry {
  timestamp: number;
  symbol: string;
  resolvedSymbol: string;
  name: string;
  instrumentType: string;
  exchange: string;
  currency: string;
  priceBasis: "adjclose" | "close";
  adjustedCloseAvailable: boolean;
  bars: DailyPricePoint[];
  earliestDate: string | null;
  latestDate: string | null;
}
const dailyAdjHistoryCache = new Map<string, DailyAdjCacheEntry>();

function setDailyAdjHistoryCache(symbol: string, entry: DailyAdjCacheEntry) {
  if (dailyAdjHistoryCache.size >= MAX_DAILY_ADJ_CACHE_ENTRIES) {
    const oldest = dailyAdjHistoryCache.keys().next().value;
    if (oldest) dailyAdjHistoryCache.delete(oldest);
  }
  dailyAdjHistoryCache.set(symbol, entry);
}

const MARKET_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_MARKET_SEARCH_CACHE_ENTRIES = 200;
const marketSearchCache = new Map<
  string,
  {
    timestamp: number;
    results: Array<{
      symbol: string;
      name: string;
      instrumentType: string;
      exchange: string;
      supported: boolean;
    }>;
  }
>();

const MARKET_SEARCH_ALIASES: ReadonlyArray<{
  symbol: string;
  aliases: string[];
  name: string;
  instrumentType: string;
  exchange: string;
}> = [
  { symbol: "SPX", aliases: ["SPX", "S&P 500", "S&P500", "^GSPC"], name: "S&P 500 Index", instrumentType: "INDEX", exchange: "SNP" },
  { symbol: "DJI", aliases: ["DJI", "DOW JONES", "DJIA", "^DJI"], name: "Dow Jones Industrial Average", instrumentType: "INDEX", exchange: "DJI" },
  { symbol: "IXIC", aliases: ["IXIC", "NASDAQ COMPOSITE", "^IXIC"], name: "NASDAQ Composite Index", instrumentType: "INDEX", exchange: "NIM" },
  { symbol: "VIX", aliases: ["VIX", "VOLATILITY", "^VIX"], name: "CBOE Volatility Index", instrumentType: "INDEX", exchange: "WCB" },
  { symbol: "RUT", aliases: ["RUT", "RUSSELL 2000", "^RUT"], name: "Russell 2000 Index", instrumentType: "INDEX", exchange: "WCB" },
  { symbol: "GC", aliases: ["GC", "GOLD", "GC=F"], name: "Gold Futures (COMEX)", instrumentType: "FUTURE", exchange: "COMEX" },
  { symbol: "CL", aliases: ["CL", "CRUDE OIL", "WTI", "CL=F"], name: "Crude Oil WTI Futures", instrumentType: "FUTURE", exchange: "NYMEX" },
  { symbol: "TNX", aliases: ["TNX", "10Y TREASURY", "US10Y", "^TNX"], name: "US 10-Year Treasury Yield Index", instrumentType: "INDEX", exchange: "ICE" },
  { symbol: "BTC", aliases: ["BTC", "BITCOIN", "BTC-USD"], name: "Bitcoin USD", instrumentType: "CRYPTOCURRENCY", exchange: "CCC" },
  { symbol: "ETH", aliases: ["ETH", "ETHEREUM", "ETH-USD"], name: "Ethereum USD", instrumentType: "CRYPTOCURRENCY", exchange: "CCC" },
  { symbol: "SOL", aliases: ["SOL", "SOLANA", "SOL-USD"], name: "Solana USD", instrumentType: "CRYPTOCURRENCY", exchange: "CCC" },
  { symbol: "DXY", aliases: ["DXY", "US DOLLAR INDEX", "DX-Y.NYB"], name: "US Dollar Index", instrumentType: "INDEX", exchange: "ICE" },
];

function formatExchangeIsoDate(tsSeconds: number, timeZone: string): string {
  const safeTz = timeZone && typeof timeZone === "string" ? timeZone : "America/New_York";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: safeTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(tsSeconds * 1000));
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fall through to UTC ISO date
  }
  return new Date(tsSeconds * 1000).toISOString().slice(0, 10);
}

function extractYahooDailyAdjustedBars(result: any): {
  bars: DailyPricePoint[];
  adjustedCloseAvailable: boolean;
  priceBasis: "adjclose" | "close";
} {
  const timestamps: unknown = result?.timestamp;
  const closes: unknown = result?.indicators?.quote?.[0]?.close;
  const adjCloses: unknown = result?.indicators?.adjclose?.[0]?.adjclose;
  const tz = result?.meta?.exchangeTimezoneName || "America/New_York";

  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length === 0) {
    return { bars: [], adjustedCloseAvailable: false, priceBasis: "close" };
  }

  const adjArr = Array.isArray(adjCloses) ? adjCloses : [];
  let validAdjCount = 0;
  let validCloseCount = 0;
  const rawBars: DailyPricePoint[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = Number(timestamps[i]);
    const closeVal = Number(closes[i]);
    const adjVal = i < adjArr.length ? Number(adjArr[i]) : NaN;

    if (!Number.isFinite(ts) || ts <= 0) continue;
    const hasClose = Number.isFinite(closeVal) && closeVal > 0;
    const hasAdj = Number.isFinite(adjVal) && adjVal > 0;
    if (!hasClose && !hasAdj) continue;

    if (hasClose) validCloseCount++;
    if (hasAdj) validAdjCount++;

    const isoDate = formatExchangeIsoDate(ts, tz);
    rawBars.push({
      date: isoDate,
      timestamp: ts,
      close: hasClose ? Number(closeVal.toFixed(6)) : Number(adjVal.toFixed(6)),
      adjClose: hasAdj ? Number(adjVal.toFixed(6)) : Number(closeVal.toFixed(6)),
      usedAdjustedClose: hasAdj,
    });
  }

  const bars = normalizeDailyPriceBars(rawBars);
  const adjustedCloseAvailable =
    validAdjCount > 0 && validAdjCount >= Math.max(1, Math.floor(validCloseCount * 0.9));

  return {
    bars,
    adjustedCloseAvailable,
    priceBasis: adjustedCloseAvailable ? "adjclose" : "close",
  };
}

async function fetchAlphaVantageHourlyHistory(
  symbol: string
): Promise<{
  history: HistoricalPriceBar[];
  provider: string;
  warning: string | null;
  error: string | null;
}> {
  const apiKey = getActiveApiKey("ALPHA_VANTAGE_API_KEY");
  if (!apiKey) {
    return { history: [], provider: "Alpha Vantage", warning: null, error: "Alpha Vantage API key not configured." };
  }

  const queryAv = async (outputsize: "full" | "compact") => {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(
      symbol
    )}&interval=60min&outputsize=${outputsize}&apikey=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!resp.ok) {
      throw new Error(`Alpha Vantage returned HTTP ${resp.status}`);
    }
    const raw = await resp.json();
    return parseAlphaVantageIntradayBars(raw);
  };

  try {
    const fullAttempt = await queryAv("full");
    if (fullAttempt.bars.length > 0) {
      return {
        history: fullAttempt.bars,
        provider: "Alpha Vantage (TIME_SERIES_INTRADAY 60min, full)",
        warning: null,
        error: null,
      };
    }

    if (fullAttempt.premiumRestricted) {
      const compactAttempt = await queryAv("compact");
      if (compactAttempt.bars.length > 0) {
        return {
          history: compactAttempt.bars,
          provider: "Alpha Vantage (TIME_SERIES_INTRADAY 60min, compact)",
          warning:
            "Alpha Vantage outputsize=full requires a premium subscription; displaying latest 100 hourly intervals (compact).",
          error: null,
        };
      }
      return {
        history: [],
        provider: "Alpha Vantage",
        warning: null,
        error: compactAttempt.notice
          ? redactSecrets(compactAttempt.notice, { extraSecrets: [apiKey], maxLength: 200 })
          : "Alpha Vantage intraday history unavailable.",
      };
    }

    return {
      history: [],
      provider: "Alpha Vantage",
      warning: null,
      error: fullAttempt.notice
        ? redactSecrets(fullAttempt.notice, { extraSecrets: [apiKey], maxLength: 200 })
        : fullAttempt.errorMessage
        ? redactSecrets(fullAttempt.errorMessage, { extraSecrets: [apiKey], maxLength: 200 })
        : "No intraday records returned by Alpha Vantage.",
    };
  } catch (err) {
    return {
      history: [],
      provider: "Alpha Vantage",
      warning: null,
      error: redactErrorMessage(err, "Alpha Vantage intraday request failed.", { extraSecrets: [apiKey] }),
    };
  }
}

// Historical quarterly earnings announcement dates via Alpha Vantage EARNINGS endpoint
app.get("/api/market/earnings", async (req, res) => {
  try {
    const symbol = ((req.query.symbol as string) || "").toUpperCase().trim();
    if (!symbol || !/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) {
      return res.status(400).json({
        success: false,
        symbol,
        reportedDates: [],
        error: "Valid ticker symbol is required",
      });
    }

    const now = Date.now();
    const cached = earningsHistoryCache.get(symbol);
    if (cached && now - cached.timestamp < cached.ttlMs) {
      return res.json({
        success: cached.success,
        symbol,
        reportedDates: cached.reportedDates,
        isCached: true,
        ...(cached.error ? { error: cached.error } : {}),
      });
    }

    const apiKey = getActiveApiKey("ALPHA_VANTAGE_API_KEY");
    if (!apiKey) {
      return res.json({
        success: false,
        symbol,
        reportedDates: [],
        isCached: false,
        error: "Alpha Vantage API key not configured.",
      });
    }

    let pending = earningsInFlight.get(symbol);
    if (!pending) {
      pending = (async (): Promise<EarningsHistoryCacheEntry> => {
        try {
          const url = `https://www.alphavantage.co/query?function=EARNINGS&symbol=${encodeURIComponent(
            symbol
          )}&apikey=${encodeURIComponent(apiKey)}`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(12_000) });
          if (!resp.ok) {
            return {
              timestamp: Date.now(),
              ttlMs: 0,
              success: false,
              reportedDates: [],
              error: `Alpha Vantage earnings returned HTTP ${resp.status}`,
            };
          }
          const raw = await resp.json();
          const parsed = parseAlphaVantageEarningsDates(raw);

          if (parsed.rateLimited || parsed.premiumRestricted) {
            const entry: EarningsHistoryCacheEntry = {
              timestamp: Date.now(),
              ttlMs: EARNINGS_RATE_LIMIT_COOLDOWN_MS,
              success: false,
              reportedDates: [],
              error: parsed.notice
                ? redactSecrets(parsed.notice, { extraSecrets: [apiKey], maxLength: 200 })
                : "Alpha Vantage earnings rate limit reached.",
            };
            setEarningsHistoryCache(symbol, entry);
            return entry;
          }

          if (parsed.errorMessage) {
            return {
              timestamp: Date.now(),
              ttlMs: 0,
              success: false,
              reportedDates: [],
              error: redactSecrets(parsed.errorMessage, { extraSecrets: [apiKey], maxLength: 200 }),
            };
          }

          const entry: EarningsHistoryCacheEntry = {
            timestamp: Date.now(),
            ttlMs: EARNINGS_CACHE_TTL_MS,
            success: true,
            reportedDates: parsed.reportedDates,
            error: null,
          };
          setEarningsHistoryCache(symbol, entry);
          return entry;
        } catch (err) {
          return {
            timestamp: Date.now(),
            ttlMs: 0,
            success: false,
            reportedDates: [],
            error: redactErrorMessage(err, "Alpha Vantage earnings request failed.", {
              extraSecrets: [apiKey],
            }),
          };
        } finally {
          earningsInFlight.delete(symbol);
        }
      })();
      earningsInFlight.set(symbol, pending);
    }

    const result = await pending;
    return res.json({
      success: result.success,
      symbol,
      reportedDates: result.reportedDates,
      isCached: false,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (err) {
    return res.json({
      success: false,
      symbol: ((req.query.symbol as string) || "").toUpperCase().trim(),
      reportedDates: [],
      isCached: false,
      error: redactErrorMessage(err, "Unable to retrieve earnings history."),
    });
  }
});

// Real OHLCV history endpoint via Yahoo Finance for GP multi-interval charts and HP expanded hourly archive
app.get("/api/market/history", async (req, res) => {
  try {
    const symbol = ((req.query.symbol as string) || "").toUpperCase().trim();
    const interval = ((req.query.interval as string) || "1h").trim();
    const force = req.query.force === "true";
    if (!symbol) {
      return res.status(400).json({ success: false, error: "Symbol is required" });
    }

    // Expanded Historical Price (HP) hourly archive mode: 3 months of full 60-minute OHLCV bars (no artificial 16-bar cap)
    if (interval === "hp") {
      const now = Date.now();
      const cached = hpHistoryCache.get(symbol);
      if (!force && cached && now - cached.timestamp < HP_HISTORY_CACHE_TTL_MS) {
        return res.json({
          success: true,
          symbol,
          interval: "60m",
          provider: cached.provider,
          tradingDays: cached.tradingDays,
          totalRecords: cached.history.length,
          history: cached.history,
          warning: cached.warning,
          isCached: true,
        });
      }

      const fetchYahooHp = async (targetYfSymbol: string) => {
        const yfUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          targetYfSymbol
        )}?interval=1h&range=3mo`;
        return fetch(yfUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          },
          signal: AbortSignal.timeout(12_000),
        });
      };

      let yahooError: string | null = null;
      try {
        let yfSymbol = mapToYahooSymbol(symbol);
        let yfResponse = await fetchYahooHp(yfSymbol);

        if (yfResponse.status === 404) {
          const searchRes = await fetchYahooSearch(symbol, 5, 0);
          const resolved = findValidYahooSearchEquity(searchRes.quotes, symbol, yfSymbol)?.symbol;
          if (resolved && resolved.toUpperCase() !== yfSymbol.toUpperCase()) {
            yfSymbol = resolved;
            yfResponse = await fetchYahooHp(yfSymbol);
          }
        }

        if (yfResponse.ok) {
          const yfData = await yfResponse.json();
          const result = yfData?.chart?.result?.[0];
          if (result) {
            const history = deduplicateAndSortHistoricalBars(
              extractYahooBars(result, "1h", { preserveAll: true })
            );
            if (history.length > 0) {
              const tradingDays = countDistinctTradingDays(history);
              const entry = {
                timestamp: now,
                history,
                provider: "Yahoo Finance (60m, 3mo)",
                tradingDays,
                warning: null,
              };
              setHpHistoryCache(symbol, entry);
              return res.json({
                success: true,
                symbol,
                interval: "60m",
                provider: entry.provider,
                tradingDays,
                totalRecords: history.length,
                history,
                warning: null,
                isCached: false,
              });
            }
          }
          yahooError = `No hourly historical bars returned for "${symbol}".`;
        } else {
          yahooError = `Market history provider returned HTTP ${yfResponse.status}.`;
        }
      } catch (err) {
        yahooError = redactErrorMessage(err, "Primary hourly history request failed.");
      }

      // Secondary fallback: Alpha Vantage TIME_SERIES_INTRADAY (60min, outputsize=full with compact fallback)
      const avResult = await fetchAlphaVantageHourlyHistory(symbol);
      if (avResult.history.length > 0) {
        const tradingDays = countDistinctTradingDays(avResult.history);
        const entry = {
          timestamp: now,
          history: avResult.history,
          provider: avResult.provider,
          tradingDays,
          warning: avResult.warning,
        };
        setHpHistoryCache(symbol, entry);
        return res.json({
          success: true,
          symbol,
          interval: "60m",
          provider: entry.provider,
          tradingDays,
          totalRecords: avResult.history.length,
          history: avResult.history,
          warning: avResult.warning,
          isCached: false,
        });
      }

      // Preserve previously cached valid historical data rather than replacing it with an empty response
      if (cached && cached.history.length > 0) {
        return res.json({
          success: true,
          symbol,
          interval: "60m",
          provider: cached.provider,
          tradingDays: cached.tradingDays,
          totalRecords: cached.history.length,
          history: cached.history,
          warning: "Live historical refresh unavailable. Serving last valid cached dataset.",
          isCached: true,
        });
      }

      return res.json({
        success: false,
        symbol,
        interval: "60m",
        error: avResult.error || yahooError || `No historical data returned for "${symbol}".`,
        history: [],
      });
    }

    // Daily adjusted-close 2-year history mode for Correlation Analyzer (reuses Yahoo Finance chart API)
    if (interval === "daily_adj") {
      const now = Date.now();
      const cached = dailyAdjHistoryCache.get(symbol);
      if (!force && cached && now - cached.timestamp < DAILY_ADJ_CACHE_TTL_MS) {
        return res.json({
          success: true,
          symbol: cached.symbol,
          resolvedSymbol: cached.resolvedSymbol,
          name: cached.name,
          instrumentType: cached.instrumentType,
          exchange: cached.exchange,
          currency: cached.currency,
          interval: "1d",
          priceBasis: cached.priceBasis,
          adjustedCloseAvailable: cached.adjustedCloseAvailable,
          earliestDate: cached.earliestDate,
          latestDate: cached.latestDate,
          totalRecords: cached.bars.length,
          bars: cached.bars,
          isCached: true,
        });
      }

      const fetchYahooDailyAdj = async (targetYfSymbol: string) => {
        const yfUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          targetYfSymbol
        )}?interval=1d&range=2y`;
        return fetch(yfUrl, {
          headers: {
            "User-Agent": YAHOO_UA,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(12_000),
        });
      };

      try {
        let yfSymbol = mapToYahooSymbol(symbol);
        let yfResponse = await fetchYahooDailyAdj(yfSymbol);

        if (yfResponse.status === 404) {
          const searchRes = await fetchYahooSearch(symbol, 5, 0);
          const resolved = findValidYahooSearchEquity(searchRes.quotes, symbol, yfSymbol)?.symbol;
          if (resolved && resolved.toUpperCase() !== yfSymbol.toUpperCase()) {
            yfSymbol = resolved;
            yfResponse = await fetchYahooDailyAdj(yfSymbol);
          }
        }

        if (yfResponse.status === 429) {
          if (cached && cached.bars.length > 0) {
            return res.json({
              success: true,
              symbol: cached.symbol,
              resolvedSymbol: cached.resolvedSymbol,
              name: cached.name,
              instrumentType: cached.instrumentType,
              exchange: cached.exchange,
              currency: cached.currency,
              interval: "1d",
              priceBasis: cached.priceBasis,
              adjustedCloseAvailable: cached.adjustedCloseAvailable,
              earliestDate: cached.earliestDate,
              latestDate: cached.latestDate,
              totalRecords: cached.bars.length,
              bars: cached.bars,
              warning: "Market data rate limit encountered; serving cached historical prices.",
              isCached: true,
            });
          }
          return res.status(429).json({
            success: false,
            symbol,
            rateLimited: true,
            error: "Historical market data provider rate limit reached. Please retry shortly.",
            bars: [],
          });
        }

        if (yfResponse.status === 404) {
          return res.json({
            success: false,
            symbol,
            isInvalidTicker: true,
            error: `Symbol "${symbol}" was not found in the market data directory.`,
            bars: [],
          });
        }

        if (!yfResponse.ok) {
          if (cached && cached.bars.length > 0) {
            return res.json({
              success: true,
              symbol: cached.symbol,
              resolvedSymbol: cached.resolvedSymbol,
              name: cached.name,
              instrumentType: cached.instrumentType,
              exchange: cached.exchange,
              currency: cached.currency,
              interval: "1d",
              priceBasis: cached.priceBasis,
              adjustedCloseAvailable: cached.adjustedCloseAvailable,
              earliestDate: cached.earliestDate,
              latestDate: cached.latestDate,
              totalRecords: cached.bars.length,
              bars: cached.bars,
              warning: "Live historical refresh unavailable; serving cached daily prices.",
              isCached: true,
            });
          }
          return res.json({
            success: false,
            symbol,
            error: `Historical market data provider returned HTTP ${yfResponse.status} for "${symbol}".`,
            bars: [],
          });
        }

        const yfData = await yfResponse.json();
        const result = yfData?.chart?.result?.[0];
        const meta = result?.meta;
        if (!result || !isValidYahooChartMeta(meta)) {
          return res.json({
            success: false,
            symbol,
            isInvalidTicker: true,
            error: `No valid security metadata returned for "${symbol}".`,
            bars: [],
          });
        }

        const instrumentType = String(meta?.instrumentType || "EQUITY").toUpperCase();
        if (!VALID_SECURITY_TYPES.has(instrumentType)) {
          return res.json({
            success: false,
            symbol,
            unsupported: true,
            instrumentType,
            error: `Instrument "${symbol}" (${instrumentType}) is not supported for daily correlation analysis.`,
            bars: [],
          });
        }

        const extracted = extractYahooDailyAdjustedBars(result);
        if (extracted.bars.length === 0) {
          return res.json({
            success: false,
            symbol,
            error: `No daily historical closing prices are available for "${symbol}".`,
            bars: [],
          });
        }

        const resolvedName = String(meta?.longName || meta?.shortName || symbol).trim();
        const exchange = String(meta?.fullExchangeName || meta?.exchangeName || "US").trim();
        const currency = String(meta?.currency || "USD").trim();
        const earliestDate = extracted.bars[0]?.date || null;
        const latestDate = extracted.bars[extracted.bars.length - 1]?.date || null;

        const entry: DailyAdjCacheEntry = {
          timestamp: now,
          symbol,
          resolvedSymbol: yfSymbol,
          name: resolvedName,
          instrumentType,
          exchange,
          currency,
          priceBasis: extracted.priceBasis,
          adjustedCloseAvailable: extracted.adjustedCloseAvailable,
          bars: extracted.bars,
          earliestDate,
          latestDate,
        };
        setDailyAdjHistoryCache(symbol, entry);

        return res.json({
          success: true,
          symbol: entry.symbol,
          resolvedSymbol: entry.resolvedSymbol,
          name: entry.name,
          instrumentType: entry.instrumentType,
          exchange: entry.exchange,
          currency: entry.currency,
          interval: "1d",
          priceBasis: entry.priceBasis,
          adjustedCloseAvailable: entry.adjustedCloseAvailable,
          earliestDate: entry.earliestDate,
          latestDate: entry.latestDate,
          totalRecords: entry.bars.length,
          bars: entry.bars,
          isCached: false,
        });
      } catch (err: any) {
        if (cached && cached.bars.length > 0) {
          return res.json({
            success: true,
            symbol: cached.symbol,
            resolvedSymbol: cached.resolvedSymbol,
            name: cached.name,
            instrumentType: cached.instrumentType,
            exchange: cached.exchange,
            currency: cached.currency,
            interval: "1d",
            priceBasis: cached.priceBasis,
            adjustedCloseAvailable: cached.adjustedCloseAvailable,
            earliestDate: cached.earliestDate,
            latestDate: cached.latestDate,
            totalRecords: cached.bars.length,
            bars: cached.bars,
            warning: "Live historical refresh failed; serving last valid cached daily prices.",
            isCached: true,
          });
        }
        const safeMsg = redactErrorMessage(err, `Failed to retrieve daily history for "${symbol}".`);
        return res.json({
          success: false,
          symbol,
          error: safeMsg,
          bars: [],
        });
      }
    }

    const intervalMap: Record<
      string,
      { yfInterval: string; yfRange: string; windowSeconds: number; todayOnly: boolean; maxBars: number }
    > = {
      "5m": { yfInterval: "1m", yfRange: "5d", windowSeconds: 5 * 60, todayOnly: true, maxBars: 10 },
      "15m": { yfInterval: "1m", yfRange: "5d", windowSeconds: 15 * 60, todayOnly: true, maxBars: 20 },
      "30m": { yfInterval: "1m", yfRange: "5d", windowSeconds: 30 * 60, todayOnly: true, maxBars: 35 },
      "1h": { yfInterval: "2m", yfRange: "5d", windowSeconds: 60 * 60, todayOnly: true, maxBars: 35 },
      "1D": { yfInterval: "15m", yfRange: "5d", windowSeconds: 24 * 60 * 60, todayOnly: true, maxBars: 42 },
      "1W": { yfInterval: "1h", yfRange: "1mo", windowSeconds: 7 * 24 * 60 * 60, todayOnly: false, maxBars: 48 },
      "1M": { yfInterval: "1d", yfRange: "6mo", windowSeconds: 31 * 24 * 60 * 60, todayOnly: false, maxBars: 35 },
    };

    const cfg = intervalMap[interval] || intervalMap["1h"];
    const fetchChartForSymbol = async (targetYfSymbol: string) => {
      const yfUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(targetYfSymbol)}?interval=${cfg.yfInterval}&range=${cfg.yfRange}`;
      return fetch(yfUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
    };

    let yfSymbol = mapToYahooSymbol(symbol);
    let yfResponse = await fetchChartForSymbol(yfSymbol);

    // If Yahoo returned 404, only resolve if search confirms an exact security match
    if (yfResponse.status === 404) {
      const searchRes = await fetchYahooSearch(symbol, 5, 0);
      const resolved = findValidYahooSearchEquity(searchRes.quotes, symbol, yfSymbol)?.symbol;
      if (resolved && resolved.toUpperCase() !== yfSymbol.toUpperCase()) {
        yfSymbol = resolved;
        yfResponse = await fetchChartForSymbol(yfSymbol);
      }
    }

    if (yfResponse.status === 404) {
      console.log(`Yahoo Finance returned 404 for symbol "${symbol}" (${yfSymbol})`);
      return res.json({
        success: false,
        error: `No market chart data found for symbol "${symbol}".`,
        history: []
      });
    }

    if (!yfResponse.ok) {
      console.log(`Yahoo Finance history status ${yfResponse.status} for ${yfSymbol}`);
      return res.json({
        success: false,
        error: `Yahoo Finance returned status ${yfResponse.status}`,
        history: []
      });
    }

    const yfData = await yfResponse.json();
    const result = yfData?.chart?.result?.[0];
    if (!result) {
      return res.json({ success: false, error: "No historical data returned.", history: [] });
    }

    const history = extractYahooBars(result, interval, {
      windowSeconds: cfg.windowSeconds,
      todayOnly: cfg.todayOnly,
      maxBars: cfg.maxBars,
      evenlySample: true,
    });
    return res.json({ success: true, symbol, interval, history });
  } catch (err: any) {
    const safeMsg = redactErrorMessage(err, "Unable to fetch market history.");
    console.log("History endpoint handled gracefully:", safeMsg);
    return res.json({ success: false, error: safeMsg, history: [] });
  }
});

// Security search endpoint by ticker or company/instrument name (reuses Yahoo Finance search)
app.get("/api/market/search", async (req, res) => {
  try {
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!rawQuery) {
      return res.json({ success: true, results: [] });
    }
    const queryKey = rawQuery.toUpperCase();
    const now = Date.now();
    const cached = marketSearchCache.get(queryKey);
    if (cached && now - cached.timestamp < MARKET_SEARCH_CACHE_TTL_MS) {
      return res.json({ success: true, results: cached.results, isCached: true });
    }

    const merged: Array<{
      symbol: string;
      name: string;
      instrumentType: string;
      exchange: string;
      supported: boolean;
    }> = [];
    const seen = new Set<string>();

    // Match terminal benchmark/commodity/index/crypto aliases first
    for (const alias of MARKET_SEARCH_ALIASES) {
      const matched =
        alias.symbol === queryKey ||
        alias.aliases.some((a) => a.includes(queryKey) || queryKey.includes(a)) ||
        alias.name.toUpperCase().includes(queryKey);
      if (matched && !seen.has(alias.symbol)) {
        seen.add(alias.symbol);
        merged.push({
          symbol: alias.symbol,
          name: alias.name,
          instrumentType: alias.instrumentType,
          exchange: alias.exchange,
          supported: true,
        });
      }
    }

    const searchRes = await fetchYahooSearchDetailed(rawQuery, 10, 0);
    if (searchRes.ok) {
      for (const item of searchRes.quotes) {
        if (!item || typeof item !== "object") continue;
        if (item.isYahooFinance === false) continue;
        const sym = typeof item.symbol === "string" ? item.symbol.toUpperCase().trim() : "";
        if (!sym || seen.has(sym)) continue;
        const quoteType = String(item.quoteType || "").toUpperCase().trim();
        const name = String(item.longname || item.shortname || sym).trim();
        const exchange = String(item.exchDisp || item.exchange || "US").trim();
        const supported = VALID_SECURITY_TYPES.has(quoteType);

        seen.add(sym);
        merged.push({
          symbol: sym,
          name,
          instrumentType: quoteType || "UNKNOWN",
          exchange,
          supported,
        });
        if (merged.length >= 10) break;
      }
    }

    if (marketSearchCache.size >= MAX_MARKET_SEARCH_CACHE_ENTRIES) {
      const oldest = marketSearchCache.keys().next().value;
      if (oldest) marketSearchCache.delete(oldest);
    }
    marketSearchCache.set(queryKey, { timestamp: now, results: merged });

    return res.json({ success: true, results: merged, isCached: false });
  } catch (err: any) {
    const safeMsg = redactErrorMessage(err, "Unable to search securities.");
    return res.json({ success: false, error: safeMsg, results: [] });
  }
});

// Batch portfolio security metadata endpoint (price + name + verified sector/industry; reuses Yahoo chart/search & quoteCache)
const portfolioMetaCache = new Map<string, { timestamp: number; data: PortfolioSecurityMetadata }>();
const PORTFOLIO_META_CACHE_TTL_MS = 10 * 60 * 1000;
const PORTFOLIO_PRICE_FRESH_TTL_MS = 60 * 1000;
const MAX_PORTFOLIO_META_CACHE = 400;

async function resolveSinglePortfolioMetadata(
  rawSymbol: string,
  force = false
): Promise<PortfolioSecurityMetadata> {
  const sym = rawSymbol.toUpperCase().trim();
  const now = Date.now();
  const cachedMeta = portfolioMetaCache.get(sym);

  if (
    !force &&
    cachedMeta &&
    now - cachedMeta.timestamp < PORTFOLIO_PRICE_FRESH_TTL_MS
  ) {
    return cachedMeta.data;
  }

  const yfSymbol = mapToYahooSymbol(sym);

  // 1. Live price & basic instrument info (reuse existing quoteCache when fresh)
  let price: number | null = null;
  let prevClose: number | null = null;
  let changePercent: number | null = null;
  let name = cachedMeta?.data.name || sym;
  let exchange = cachedMeta?.data.exchange || "";
  let instrumentType = cachedMeta?.data.instrumentType || "EQUITY";
  let chartValid = false;

  const existingQuote = quoteCache[sym];
  if (!force && existingQuote && now - existingQuote.timestamp < CACHE_TTL_MS) {
    const q = existingQuote.quote;
    if (typeof q?.price === "number" && Number.isFinite(q.price) && q.price > 0) {
      price = q.price;
      prevClose = typeof q.prevClose === "number" && Number.isFinite(q.prevClose) ? q.prevClose : null;
      changePercent =
        typeof q.changePercent === "number" && Number.isFinite(q.changePercent) ? q.changePercent : null;
      name = String(q.name || name).trim() || sym;
      exchange = String(q.exchange || exchange).trim();
      instrumentType = String(q.instrumentType || instrumentType).toUpperCase();
      chartValid = true;
    }
  }

  if (!chartValid) {
    try {
      const yfUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        yfSymbol
      )}?interval=1d&range=5d`;
      const yfResp = await fetch(yfUrl, {
        headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (yfResp.ok) {
        const yfData = await yfResp.json();
        const result = yfData?.chart?.result?.[0];
        if (result && isValidYahooChartMeta(result.meta)) {
          const meta = result.meta;
          chartValid = true;
          const p =
            typeof meta.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice) && meta.regularMarketPrice > 0
              ? meta.regularMarketPrice
              : null;
          const pc =
            typeof meta.regularMarketPreviousClose === "number" && Number.isFinite(meta.regularMarketPreviousClose)
              ? meta.regularMarketPreviousClose
              : typeof meta.chartPreviousClose === "number" && Number.isFinite(meta.chartPreviousClose)
              ? meta.chartPreviousClose
              : null;
          price = p;
          prevClose = pc;
          changePercent =
            p !== null && pc !== null && pc > 0
              ? Number((((p - pc) / pc) * 100).toFixed(2))
              : null;
          name = String(meta.longName || meta.shortName || name || sym).trim();
          exchange = String(meta.fullExchangeName || meta.exchangeName || exchange || "").trim().toUpperCase();
          if (typeof meta.instrumentType === "string" && meta.instrumentType.trim()) {
            instrumentType = meta.instrumentType.trim().toUpperCase();
          }
        }
      }
    } catch {
      // Fall through to search/cached metadata
    }
  }

  // 2. Sector & industry classification (cached for 10 min; reuse Yahoo Search without inventing missing values)
  let sector: string | null = cachedMeta?.data.sector ?? null;
  let gicsSectorId = cachedMeta?.data.gicsSectorId ?? null;
  let industry: string | null = cachedMeta?.data.industry ?? null;
  let classificationMethod: PortfolioSecurityMetadata["classificationMethod"] =
    cachedMeta?.data.classificationMethod ?? "unavailable";
  let searchValid = Boolean(cachedMeta?.data.valid);

  const needsClassificationRefresh =
    force || !cachedMeta || now - cachedMeta.timestamp >= PORTFOLIO_META_CACHE_TTL_MS;

  if (needsClassificationRefresh) {
    const searchRes = await fetchYahooSearchDetailed(sym, 6, 0);
    const matched = searchRes.ok
      ? searchRes.quotes.find((q: any) => {
          if (!q || typeof q !== "object" || q.isYahooFinance === false) return false;
          const qSym = String(q.symbol || "").toUpperCase().trim();
          return qSym === sym || qSym === yfSymbol.toUpperCase();
        })
      : null;

    if (matched) {
      const qType = String(matched.quoteType || "").toUpperCase().trim();
      if (VALID_SECURITY_TYPES.has(qType)) {
        searchValid = true;
        instrumentType = qType || instrumentType;
        name = String(matched.longname || matched.shortname || name || sym).trim();
        exchange = String(matched.exchDisp || matched.exchange || exchange || "").trim().toUpperCase();
      }

      const rawSector = typeof matched.sectorDisp === "string" && matched.sectorDisp.trim()
        ? matched.sectorDisp.trim()
        : typeof matched.sector === "string" && matched.sector.trim()
        ? matched.sector.trim()
        : null;
      const rawIndustry = typeof matched.industryDisp === "string" && matched.industryDisp.trim()
        ? matched.industryDisp.trim()
        : typeof matched.industry === "string" && matched.industry.trim()
        ? matched.industry.trim()
        : null;

      const directSectorId = matchDirectSectorEtf(name, sym);
      if (directSectorId) {
        gicsSectorId = directSectorId;
        sector = SECTOR_BY_ID[directSectorId].name;
        industry = rawIndustry || `${SECTOR_BY_ID[directSectorId].name} Sector ETF`;
        classificationMethod = "sector_etf";
      } else if (
        qType === "ETF" ||
        qType === "MUTUALFUND" ||
        qType === "INDEX" ||
        isBroadMarketOrMultiSectorFund(name)
      ) {
        gicsSectorId = null;
        sector = null;
        industry = null;
        classificationMethod = "unclassified_fund";
      } else if (rawSector) {
        const mappedGics = mapMarketSectorToGicsSector(rawSector);
        gicsSectorId = mappedGics;
        sector = mappedGics ? SECTOR_BY_ID[mappedGics].name : rawSector;
        industry = rawIndustry;
        classificationMethod = "yahoo_search";
      } else {
        gicsSectorId = null;
        sector = null;
        industry = null;
        classificationMethod = "unavailable";
      }
    } else if (chartValid) {
      const directSectorId = matchDirectSectorEtf(name, sym);
      if (directSectorId) {
        gicsSectorId = directSectorId;
        sector = SECTOR_BY_ID[directSectorId].name;
        industry = `${SECTOR_BY_ID[directSectorId].name} Sector ETF`;
        classificationMethod = "sector_etf";
      } else if (
        instrumentType === "ETF" ||
        instrumentType === "MUTUALFUND" ||
        instrumentType === "INDEX" ||
        isBroadMarketOrMultiSectorFund(name)
      ) {
        classificationMethod = "unclassified_fund";
      } else {
        classificationMethod = "unavailable";
      }
    }
  }

  const valid = chartValid || searchValid;
  const record: PortfolioSecurityMetadata = {
    symbol: sym,
    valid,
    name: valid ? name : sym,
    exchange,
    instrumentType,
    price,
    prevClose,
    changePercent,
    sector,
    gicsSectorId,
    industry,
    classificationMethod,
    fetchedAt: new Date(now).toISOString(),
    error: valid ? null : `Symbol "${sym}" could not be verified as a valid market security.`,
  };

  if (valid) {
    if (portfolioMetaCache.size >= MAX_PORTFOLIO_META_CACHE) {
      const oldest = portfolioMetaCache.keys().next().value;
      if (oldest) portfolioMetaCache.delete(oldest);
    }
    portfolioMetaCache.set(sym, { timestamp: now, data: record });
  }

  return record;
}

app.get("/api/portfolio/metadata", async (req, res) => {
  try {
    const rawSymbols = typeof req.query.symbols === "string" ? req.query.symbols : "";
    const force = req.query.force === "true";
    const parsedSymbols = Array.from(
      new Set(
        rawSymbols
          .split(",")
          .map((s) => s.toUpperCase().trim())
          .filter((s) => /^[A-Z0-9^][A-Z0-9.-]{0,11}$/.test(s))
      )
    ).slice(0, 40);

    if (parsedSymbols.length === 0) {
      return res.json({ success: true, metadata: {} });
    }

    // Bounded concurrency of 6 to stay polite to upstream Yahoo endpoints
    const results = new Array<PortfolioSecurityMetadata>(parsedSymbols.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < parsedSymbols.length) {
        const idx = cursor++;
        results[idx] = await resolveSinglePortfolioMetadata(parsedSymbols[idx], force);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(6, parsedSymbols.length) }, () => worker())
    );

    const metadata: Record<string, PortfolioSecurityMetadata> = {};
    for (const item of results) {
      metadata[item.symbol] = item;
    }

    return res.json({
      success: true,
      metadata,
      benchmarkSectorWeightsAvailable: false,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    const safeMsg = redactErrorMessage(err, "Unable to retrieve portfolio security metadata.");
    return res.status(500).json({ success: false, error: safeMsg, metadata: {} });
  }
});

// FRED API: Global Economic Indicators, US Macro Benchmarks, and Release Calendar
app.get("/api/fred/economics", async (req, res) => {
  try {
    const apiKey = getFredApiKey();
    if (!apiKey) {
      return res.json({
        success: false,
        requiresKey: true,
        error: "FRED_API_KEY is not configured. Add FRED_API_KEY to AI Studio Secrets or .env.",
        indicators: [],
        macroMetrics: [],
        releases: [],
      });
    }

    const force = req.query.force === "true";
    const data = await fetchLiveFredEconomics(apiKey, force);
    return res.json({
      success: true,
      ...data,
    });
  } catch (err: any) {
    const safeMsg = redactErrorMessage(err, "Failed to retrieve FRED macroeconomic data.");
    console.error("FRED economics error:", safeMsg);
    return res.json({
      success: false,
      error: safeMsg,
      indicators: [],
      macroMetrics: [],
      releases: [],
    });
  }
});

// FRED API: Federal Reserve H.10 Daily Spot Exchange Rates
app.get("/api/fred/currencies", async (req, res) => {
  try {
    const apiKey = getFredApiKey();
    if (!apiKey) {
      return res.json({
        success: false,
        requiresKey: true,
        error: "FRED_API_KEY is not configured. Add FRED_API_KEY to AI Studio Secrets or .env.",
        currencies: [],
      });
    }

    const now = Date.now();
    const force = req.query.force === "true";
    if (!force && fredCurrenciesCache && now - fredCurrenciesCache.timestamp < FRED_CACHE_TTL_MS) {
      return res.json({
        success: true,
        ...fredCurrenciesCache.data,
        isCached: true,
      });
    }

    const fxSeries = [
      { pair: "EUR/USD", seriesId: "DEXUSEU" },
      { pair: "USD/JPY", seriesId: "DEXJPUS" },
      { pair: "GBP/USD", seriesId: "DEXUSUK" },
      { pair: "AUD/USD", seriesId: "DEXUSAL" },
      { pair: "USD/CAD", seriesId: "DEXCAUS" },
    ];

    const results = await Promise.all(
      fxSeries.map(async ({ pair, seriesId }) => {
        try {
          const obs = await fetchFredObservations(seriesId, apiKey, { units: "lin", limit: 5 });
          if (obs.length === 0) return null;
          const latest = obs[0];
          const prev = obs[1] || latest;
          return {
            pair,
            seriesId,
            rate: latest.value,
            prevRate: prev.value,
            change: parseFloat((latest.value - prev.value).toFixed(4)),
            date: latest.date,
          };
        } catch (err: any) {
          console.warn(
            `FRED FX ${seriesId} error:`,
            redactErrorMessage(err, "FRED FX series error.", { extraSecrets: [apiKey] })
          );
          return null;
        }
      })
    );

    const currencies = results.filter(Boolean);
    const payload = {
      currencies,
      fetchedAt: new Date().toISOString(),
    };
    fredCurrenciesCache = { timestamp: now, data: payload };

    return res.json({
      success: true,
      ...payload,
      isCached: false,
    });
  } catch (err: any) {
    const safeMsg = redactErrorMessage(err, "Failed to retrieve FRED FX rates.");
    console.error("FRED currencies error:", safeMsg);
    return res.json({
      success: false,
      error: safeMsg,
      currencies: [],
    });
  }
});

// FRED H.10 + BIS Central Bank Policy Rates: Comprehensive FX Market Intelligence Workspace
app.get("/api/fred/fx-intelligence", async (req, res) => {
  try {
    const apiKey = getFredApiKey();
    const force = req.query.force === "true";
    const now = Date.now();

    // Central bank policy rates come primarily from public BIS WS_CBPOL daily feed
    // (with FRED fallback when configured), so they can load even if FRED_API_KEY is absent.
    const centralBankPromise = fetchCentralBankPolicyRates(apiKey, force);

    if (!apiKey) {
      const cbData = await centralBankPromise;
      return res.json({
        success: false,
        requiresKey: true,
        error: "FRED_API_KEY is not configured. Add FRED_API_KEY to AI Studio Secrets or .env.",
        fetchedAt: null,
        isCached: false,
        currencies: [],
        pairHistories: [],
        usdIndex: null,
        centralBanks: cbData.centralBanks,
        centralBanksFetchedAt: cbData.fetchedAt,
        centralBanksSource: cbData.source,
        centralBanksError: cbData.error,
      });
    }

    if (
      !force &&
      fredFxIntelligenceCache &&
      now - fredFxIntelligenceCache.timestamp < FRED_CACHE_TTL_MS
    ) {
      const cbData = await centralBankPromise;
      return res.json({
        success: true,
        ...fredFxIntelligenceCache.data,
        centralBanks: cbData.centralBanks,
        centralBanksFetchedAt: cbData.fetchedAt,
        centralBanksSource: cbData.source,
        centralBanksError: cbData.error,
        isCached: true,
      });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    // ~5.2 years of business-day observations to cleanly cover 5Y historical window without interpolation
    const observationStart = shiftIsoDate(todayIso, -1900);

    const fxPairSpecs = [
      {
        pair: "EUR/USD",
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        seriesId: "DEXUSEU",
        title: "U.S. Dollars to One Euro",
        isDirectUsdQuote: true,
      },
      {
        pair: "USD/JPY",
        baseCurrency: "USD",
        quoteCurrency: "JPY",
        seriesId: "DEXJPUS",
        title: "Japanese Yen to One U.S. Dollar",
        isDirectUsdQuote: false,
      },
      {
        pair: "GBP/USD",
        baseCurrency: "GBP",
        quoteCurrency: "USD",
        seriesId: "DEXUSUK",
        title: "U.S. Dollars to One U.K. Pound",
        isDirectUsdQuote: true,
      },
      {
        pair: "AUD/USD",
        baseCurrency: "AUD",
        quoteCurrency: "USD",
        seriesId: "DEXUSAL",
        title: "U.S. Dollars to One Australian Dollar",
        isDirectUsdQuote: true,
      },
      {
        pair: "USD/CAD",
        baseCurrency: "USD",
        quoteCurrency: "CAD",
        seriesId: "DEXCAUS",
        title: "Canadian Dollars to One U.S. Dollar",
        isDirectUsdQuote: false,
      },
    ] as const;

    const [pairResults, usdIndexObs, cbData] = await Promise.all([
      Promise.all(
        fxPairSpecs.map(async (spec) => {
          try {
            const rawObs = await fetchFredObservations(spec.seriesId, apiKey, {
              units: "lin",
              limit: 2000,
              observationStart,
              sortOrder: "asc",
            });
            const observations = normalizeFxObservations(rawObs);
            return { ...spec, observations };
          } catch (err: any) {
            console.warn(
              `FRED FX history ${spec.seriesId} error:`,
              redactErrorMessage(err, "FRED FX history error.", { extraSecrets: [apiKey] })
            );
            return { ...spec, observations: [] as Array<{ date: string; value: number }> };
          }
        })
      ),
      (async () => {
        try {
          const rawObs = await fetchFredObservations("DTWEXBGS", apiKey, {
            units: "lin",
            limit: 2000,
            observationStart,
            sortOrder: "asc",
          });
          return normalizeFxObservations(rawObs);
        } catch (err: any) {
          console.warn(
            "FRED DTWEXBGS error:",
            redactErrorMessage(err, "FRED Broad USD Index error.", { extraSecrets: [apiKey] })
          );
          return [] as Array<{ date: string; value: number }>;
        }
      })(),
      centralBankPromise,
    ]);

    const currencies = pairResults
      .map((item) => {
        if (item.observations.length === 0) return null;
        const latest = item.observations[item.observations.length - 1];
        const prev =
          item.observations.length >= 2
            ? item.observations[item.observations.length - 2]
            : latest;
        return {
          pair: item.pair,
          seriesId: item.seriesId,
          rate: latest.value,
          prevRate: prev.value,
          change: parseFloat((latest.value - prev.value).toFixed(4)),
          date: latest.date,
        };
      })
      .filter(Boolean);

    const fetchedAt = new Date().toISOString();
    const fredPayload = {
      currencies,
      pairHistories: pairResults,
      usdIndex: {
        seriesId: "DTWEXBGS",
        name: "Nominal Broad U.S. Dollar Index",
        observations: usdIndexObs,
      },
      fetchedAt,
    };

    fredFxIntelligenceCache = { timestamp: now, data: fredPayload };
    if (currencies.length > 0) {
      fredCurrenciesCache = { timestamp: now, data: { currencies, fetchedAt } };
    }

    return res.json({
      success: true,
      ...fredPayload,
      centralBanks: cbData.centralBanks,
      centralBanksFetchedAt: cbData.fetchedAt,
      centralBanksSource: cbData.source,
      centralBanksError: cbData.error,
      isCached: false,
    });
  } catch (err: any) {
    const safeMsg = redactErrorMessage(err, "Failed to retrieve FX Market Intelligence data.");
    console.error("FRED FX intelligence error:", safeMsg);
    return res.json({
      success: false,
      error: safeMsg,
      fetchedAt: null,
      currencies: [],
      pairHistories: [],
      usdIndex: null,
      centralBanks: [],
      centralBanksFetchedAt: null,
      centralBanksSource: null,
      centralBanksError: safeMsg,
    });
  }
});

// Proxy endpoint for Polymarket API focused on individual stocks, earnings, equities, and market catalysts
app.get("/api/polymarket/events", async (req, res) => {
  try {
    const search = ((req.query.search as string) || "").trim();
    const tickerParam = ((req.query.ticker as string) || "").trim();
    const companyNameParam = ((req.query.companyName as string) || "").trim();
    const category = ((req.query.category as string) || "Stocks").trim();
    const limitNum = Math.min(50, Math.max(10, parseInt(String(req.query.limit || "30"), 10) || 30));
    const effectiveTicker = resolveTickerFromQuery(tickerParam, search);

    const fetchGammaByTag = async (tagSlug: string, tagLimit: number): Promise<any[]> => {
      try {
        const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=${tagLimit}&order=volume&ascending=false&tag_slug=${encodeURIComponent(tagSlug)}`;
        const r = await fetch(url);
        if (!r.ok) return [];
        const json = await r.json();
        return Array.isArray(json) ? json : [];
      } catch {
        return [];
      }
    };

    const fetchGammaSearch = async (query: string, searchLimit: number): Promise<any[]> => {
      const searchUrl = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(query)}&events_status=active&limit_per_type=${searchLimit}`;
      const r = await fetch(searchUrl);
      if (!r.ok) {
        throw new Error(`Polymarket search returned status ${r.status}`);
      }
      const json = await r.json();
      return Array.isArray(json?.events) ? json.events : [];
    };

    const getTagSlugs = (ev: any): string[] => {
      if (!Array.isArray(ev?.tags)) return [];
      return ev.tags.map((t: any) => String(t?.slug || t?.label || "").toLowerCase()).filter(Boolean);
    };

    const classifyEvent = (ev: any): string => {
      const slugs = getTagSlugs(ev);
      if (slugs.includes("earnings")) return "Earnings";
      if (slugs.includes("ipos") || slugs.includes("ipo") || slugs.includes("acquisitions")) return "IPOs & M&A";
      if (slugs.includes("big-tech") || slugs.includes("ai") || slugs.includes("tech")) return "Big Tech & AI";
      if (slugs.includes("fed-rates") || slugs.includes("fed") || slugs.includes("fomc")) return "Fed & Macro";
      if (slugs.includes("stocks") || slugs.includes("equities") || slugs.includes("multi-strikes") || slugs.includes("hit-price") || slugs.includes("market-cap")) return "Stocks";
      if (slugs.includes("economy") || slugs.includes("economic-policy")) return "Fed & Macro";
      return "Stocks";
    };

    const isEquityOrMarketRelevant = (ev: any, allowMacro = false): boolean => {
      if (!ev || ev.closed === true || ev.active === false) return false;
      const slugs = getTagSlugs(ev);
      const title = String(ev.title || "").toLowerCase();

      const hasStockTag = slugs.some((s) =>
        ["stocks", "equities", "earnings", "market-cap", "hit-price", "multi-strikes", "ipos", "ipo", "acquisitions", "big-tech", "corporate-financials"].includes(s)
      );
      const hasPoliticalTag = slugs.some((s) =>
        ["politics", "elections", "geopolitics", "diplomacy-ceasefire", "sports", "ukraine", "iran", "senate", "congress", "presidential-election"].includes(s)
      );

      // Block pure politics/geopolitics/sports unless explicitly equity-tagged
      if (hasPoliticalTag && !hasStockTag) return false;
      if (/\b(election|senate|president|trump|biden|macron|ukrain|ceasefire|military|nato|tariff|indiana enacts)\b/i.test(title) && !hasStockTag) {
        return false;
      }

      if (allowMacro) return true;
      // In stock-first mode, avoid general political/crypto noise unless matched by stock/tech/earnings tags
      if (!hasStockTag && slugs.includes("crypto") && !/\b(mstr|microstrategy|coin|coinbase|hood|robinhood|mara|riot)\b/i.test(title)) {
        return false;
      }
      return true;
    };

    let rawEvents: any[] = [];
    let resolvedCompanyName: string | null = null;

    if (effectiveTicker) {
      const resolution = await polymarketTickerResolver.resolveTicker(
        effectiveTicker,
        companyNameParam || undefined,
      );

      if (resolution.status === "invalid" || resolution.status === "unrecognized") {
        return res.json({
          success: true,
          status: "unrecognized_ticker",
          appliedTicker: effectiveTicker,
          resolvedCompanyName: null,
          error:
            resolution.reason ||
            `Ticker "${effectiveTicker}" is not recognized as a valid stock symbol.`,
          data: [],
        });
      }

      resolvedCompanyName = resolution.companyName || null;
      const profile =
        resolution.profile ||
        getTickerCompanyProfile(effectiveTicker, resolvedCompanyName || undefined);
      const searchWindow = Math.max(limitNum, 40);
      const settledResults = await Promise.allSettled(
        profile.searchQueries.map((q) => fetchGammaSearch(q, searchWindow)),
      );

      const fulfilledBatches = settledResults
        .filter((r): r is PromiseFulfilledResult<any[]> => r.status === "fulfilled")
        .map((r) => r.value);

      if (fulfilledBatches.length === 0) {
        const firstRejection = settledResults.find(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        throw new Error(
          firstRejection?.reason?.message ||
            "Polymarket search provider did not respond.",
        );
      }

      const seenIds = new Set<string>();
      const mergedEvents: any[] = [];
      for (const batch of fulfilledBatches) {
        for (const ev of batch) {
          const evId = String(ev?.id || ev?.slug || ev?.title || "");
          if (!evId || seenIds.has(evId)) continue;
          seenIds.add(evId);
          mergedEvents.push(ev);
        }
      }

      // Strictly filter events and multi-company contracts to only those belonging to the selected ticker/company
      rawEvents = filterPolymarketEventsByTicker(mergedEvents, effectiveTicker, {
        companyName: resolvedCompanyName || undefined,
      });
    } else if (search) {
      rawEvents = await fetchGammaSearch(search, limitNum);
    } else {
      const catLower = category.toLowerCase();
      let batchArrays: any[][] = [];
      let allowMacro = false;

      if (catLower === "earnings") {
        batchArrays = await Promise.all([fetchGammaByTag("earnings", limitNum)]);
      } else if (catLower === "big tech & ai" || catLower === "tech") {
        batchArrays = await Promise.all([fetchGammaByTag("big-tech", limitNum), fetchGammaByTag("tech", 15)]);
      } else if (catLower === "ipos & m&a" || catLower === "ipos") {
        batchArrays = await Promise.all([fetchGammaByTag("ipos", limitNum), fetchGammaByTag("acquisitions", 15)]);
      } else if (catLower === "fed & macro" || catLower === "macro") {
        allowMacro = true;
        batchArrays = await Promise.all([fetchGammaByTag("fed-rates", limitNum), fetchGammaByTag("economy", 15)]);
      } else {
        // Default "Stocks" / "All": focus strictly on individual stocks, equities, and earnings
        batchArrays = await Promise.all([
          fetchGammaByTag("stocks", limitNum),
          fetchGammaByTag("equities", limitNum),
          fetchGammaByTag("earnings", 20),
        ]);
      }

      const seenIds = new Set<string>();
      for (const arr of batchArrays) {
        for (const ev of arr) {
          const evId = String(ev?.id || ev?.slug || ev?.title || "");
          if (!evId || seenIds.has(evId)) continue;
          if (!isEquityOrMarketRelevant(ev, allowMacro)) continue;
          seenIds.add(evId);
          rawEvents.push(ev);
        }
      }
    }

    const normalized = rawEvents
      .filter((ev) => ev && ev.closed !== true && Array.isArray(ev.markets) && ev.markets.length > 0)
      .map((ev) => ({
        ...ev,
        category: classifyEvent(ev),
        volume: Number(ev.volume || 0),
      }))
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, limitNum);

    return res.json({
      success: true,
      status: normalized.length > 0 ? "ok" : "no_matching_markets",
      appliedTicker: effectiveTicker || null,
      resolvedCompanyName,
      data: normalized,
    });
  } catch (err: any) {
    console.log("Polymarket events fetch handled gracefully:", err.message);
    return res.json({
      success: false,
      status: "provider_error",
      error: err.message || "Unable to retrieve market data from Polymarket.",
      data: [],
    });
  }
});

const DIAGNOSTIC_PROVIDER_TO_KEY_ID: Record<DiagnosticProviderId, ApiKeyId> = {
  ALPHA_VANTAGE: "ALPHA_VANTAGE_API_KEY",
  NYT: "NYT_API_KEY",
  NEWS_API: "NEWS_API_KEY",
  NEWSDATA: "NEWSDATA_API_KEY",
  FRED: "FRED_API_KEY",
  "3SPREAD": "3SPREAD_API_KEY",
};

// GET current keys status (fixed placeholder & source metadata only — never expose any characters of saved keys)
app.get("/api/settings/keys", (_req, res) => {
  const status = getApiKeysStatusPayload();
  res.json({
    success: true,
    maskedKeys: status.maskedKeys,
    credentials: status.credentials,
  });
});

// POST to update optional runtime keys in server memory only (environment credentials always take precedence)
app.post("/api/settings/keys", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const validatedUpdates: Partial<Record<ApiKeyId, string>> = {};

  for (const id of API_KEY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(body, id)) continue;
    const rawValue = body[id];
    const validation = validateApiKeyInput(rawValue, API_KEY_LABELS[id]);
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        error: validation.error || "Invalid API credential submitted.",
      });
    }
    if (!validation.skipped && !getEnvApiKey(id)) {
      validatedUpdates[id] = validation.value || "";
    }
  }

  const protectedByEnvironment: ApiKeyId[] = [];
  for (const id of API_KEY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(body, id)) continue;
    if (getEnvApiKey(id)) {
      if (!isMaskedKeyPlaceholder(body[id]) && typeof body[id] === "string" && body[id].trim() !== "") {
        protectedByEnvironment.push(id);
      }
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(validatedUpdates, id)) continue;

    const nextVal = validatedUpdates[id] || "";
    const result = setRuntimeApiKey(id, nextVal);
    if (result.blockedByEnv) {
      protectedByEnvironment.push(id);
      continue;
    }
    if (result.updated) {
      if (id === "ALPHA_VANTAGE_API_KEY") {
        hpHistoryCache.clear();
        earningsHistoryCache.clear();
      } else if (id === "NYT_API_KEY") {
        newsProviderCache.nyt = { timestamp: 0, items: [] };
        apiCooldowns.nyt = 0;
      } else if (id === "NEWS_API_KEY") {
        newsProviderCache.newsapi = { timestamp: 0, items: [] };
        apiCooldowns.newsapi = 0;
      } else if (id === "NEWSDATA_API_KEY") {
        newsProviderCache.newsdata = { timestamp: 0, items: [] };
        apiCooldowns.newsdata = 0;
      } else if (id === "FRED_API_KEY") {
        fredEconomicsCache = null;
        fredCurrenciesCache = null;
        fredFxIntelligenceCache = null;
      } else if (id === "3SPREAD_API_KEY") {
        clearThreeSpreadCache();
        clearSectorRotationCache();
      }
    }
  }

  const status = getApiKeysStatusPayload();
  return res.json({
    success: true,
    message: "API Keys updated in-memory successfully",
    protectedByEnvironment,
    maskedKeys: status.maskedKeys,
    credentials: status.credentials,
  });
});

// POST to execute a lightweight connectivity & authentication test for a single configured API provider
app.post("/api/settings/test-connection", async (req, res) => {
  const rawProvider = typeof req.body?.provider === "string" ? req.body.provider.trim().toUpperCase() : "";
  if (!DIAGNOSTIC_PROVIDER_SET.has(rawProvider)) {
    return res.status(400).json({
      success: false,
      status: "FAILED",
      message: "Unsupported API provider requested for connection test.",
    });
  }

  const provider = rawProvider as DiagnosticProviderId;
  const keyId = DIAGNOSTIC_PROVIDER_TO_KEY_ID[provider];
  const envKey = getEnvApiKey(keyId);

  let candidateKey = "";
  if (!envKey && req.body && Object.prototype.hasOwnProperty.call(req.body, "apiKey")) {
    const rawCandidate = req.body.apiKey;
    if (rawCandidate !== undefined && rawCandidate !== null && rawCandidate !== "" && !isMaskedKeyPlaceholder(rawCandidate)) {
      const validation = validateApiKeyInput(rawCandidate, API_KEY_LABELS[keyId]);
      if (!validation.ok) {
        return res.status(400).json({
          success: false,
          provider,
          status: "FAILED",
          message: validation.error || "Invalid API credential submitted.",
        });
      }
      candidateKey = validation.value || "";
    }
  }

  // Strict precedence: environment credential > unsaved UI candidate > saved runtime credential
  const resolvedKey = envKey || candidateKey || getRuntimeApiKey(keyId);

  const result = await runProviderConnectionTest({
    provider,
    apiKey: resolvedKey,
  });

  return res.json({
    success: result.ok,
    provider,
    status: result.status,
    message: result.message,
    latencyMs: result.latencyMs,
  });
});

// Helper functions for News Ticker
function formatNewsTime(dateStr?: string): string {
  if (!dateStr) return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  } catch {
    return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  }
}

function isBlacklistedNews(title: string, content: string): boolean {
  const fullText = `${title} ${content}`.toLowerCase();
  const blacklist = [
    "lotto", "lottery", "jackpot", "powerball", "mega millions", "mega-millions", "scratch-off",
    "recipe", "recipes", "how to cook", "bake", "baking", "dessert", "culinary", "delicious", "chef", "cocktail",
    "obituary", "obituaries", "funeral", "neighborhood", "traffic accident", "car crash", "local resident",
    "high school", "sports scores", "horoscope", "dating tips", "relationship advice", "best books to read",
    "lucky winner", "drawn numbers", "soup", "salad", "sauce", "kitchen", "restaurant review"
  ];
  return blacklist.some((word) => fullText.includes(word));
}

function isStockOrMarketRelated(title: string, content: string): boolean {
  const fullText = `${title} ${content}`.toLowerCase();

  // Strict blacklist to filter out lotto, recipes, local fluff, sports, lifestyle, crime obits
  if (isBlacklistedNews(title, content)) {
    return false;
  }

  // Ensure it has clear relevance to business, stocks, finance, macroeconomics, or public markets
  const businessKeywords = [
    // Markets & Indices
    "s&p", "dow", "nasdaq", "nikkei", "ftse", "dax", "hang seng", "index", "indices", "market", "equities", "bonds", "yield", "treasuries", "futures", "forex", "fomc", "fed", "federal reserve", "inflation", "cpi", "gdp", "interest rate", "interest rates", "monetary",
    // Corporate financial events
    "earnings", "quarterly", "revenue", "profit", "dividend", "ipo", "acquisition", "merger", "shares", "stocks", "stock", "equity", "ticker", "valuation", "market cap", "antitrust", "sec", "ceo", "board of directors", "layoffs", "restructuring", "guidance", "q1", "q2", "q3", "q4", "fiscal", "shareholder", "buyback",
    // Sectors / Commodities
    "oil", "wti", "crude", "gold", "energy", "semiconductor", "automaker", "retailer", "banking", "treasury", "tariff", "trade", "economic", "commodity", "commodities",
    // Major publicly traded company references & tech giants
    "apple", "microsoft", "nvidia", "amazon", "alphabet", "google", "meta", "tesla", "berkshire", "broadcom", "eli lilly", "jpmorgan", "visa", "walmart", "exxon", "chevron", "intel", "amd", "tsmc",
    // Major digital assets / crypto markets
    "bitcoin", "btc", "ethereum", "solana", "crypto", "cryptocurrency"
  ];

  const hasBusinessKeyword = businessKeywords.some(keyword => fullText.includes(keyword));
  return hasBusinessKeyword;
}

function decodeNewsText(raw: string): string {
  if (!raw) return "";
  let text = raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  // Fix merged Yahoo RSS section labels like "Key TakeawaysApple is..."
  text = text.replace(/\bKey Takeaways(?=[A-Z])/g, "Key Takeaways: ");
  return text.replace(/\s+/g, " ").trim();
}

function formatIntroSentences(raw: string, title = "", maxSentences = 2, maxChars = 260): string {
  const clean = decodeNewsText(raw);
  if (!clean) return "";
  // Avoid repeating identical headline text verbatim
  if (title && clean.toLowerCase() === decodeNewsText(title).toLowerCase()) {
    return "";
  }
  const parts = clean.split(/(?<=[.!?]["”']?)\s+(?=[A-Z0-9"“‘$])/).filter(Boolean);
  let selected = parts.slice(0, maxSentences).join(" ").trim();
  if (!selected) selected = clean;
  if (selected.length > maxChars) {
    selected = selected.slice(0, maxChars - 1).replace(/\s+\S*$/, "") + "…";
  }
  return selected;
}

async function fetchYahooTickerRssIntros(
  yfTicker: string
): Promise<{
  byGuid: Map<string, string>;
  byTitle: Map<string, string>;
  items: Array<{ guid: string; title: string; link: string; publishedAt: string; intro: string }>;
}> {
  const byGuid = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const items: Array<{ guid: string; title: string; link: string; publishedAt: string; intro: string }> = [];
  try {
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
      yfTicker
    )}&region=US&lang=en-US`;
    const res = await fetch(url, { headers: { "User-Agent": YAHOO_UA } });
    if (!res.ok) return { byGuid, byTitle, items };
    const xml = await res.text();
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = m[1];
      const getTag = (tag: string) => {
        const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
        return match ? match[1].trim() : "";
      };
      const guid = decodeNewsText(getTag("guid"));
      const rawTitle = decodeNewsText(getTag("title"));
      const link = decodeNewsText(getTag("link"));
      const pubDateRaw = decodeNewsText(getTag("pubDate"));
      const rawDesc = getTag("description");
      const intro = formatIntroSentences(rawDesc, rawTitle, 2, 260);
      if (guid && intro) byGuid.set(guid, intro);
      if (rawTitle && intro) {
        const normTitle = rawTitle.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
        if (normTitle) byTitle.set(normTitle, intro);
      }
      if (rawTitle && link) {
        let publishedAt = new Date().toISOString();
        if (pubDateRaw) {
          const parsed = new Date(pubDateRaw);
          if (!isNaN(parsed.getTime())) publishedAt = parsed.toISOString();
        }
        items.push({ guid, title: rawTitle, link, publishedAt, intro });
      }
    }
  } catch {
    // Non-fatal if RSS fails; search items still render headlines
  }
  return { byGuid, byTitle, items };
}

function normalizeNewsUrl(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const keptParams = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.startsWith("utm_") ||
        lowerKey === "fbclid" ||
        lowerKey === "gclid" ||
        lowerKey === "ref" ||
        lowerKey === "src" ||
        lowerKey === "ocid" ||
        lowerKey === "guccounter" ||
        lowerKey === "guce_referrer" ||
        lowerKey === "guce_referrer_sig"
      ) {
        return;
      }
      keptParams.append(key, value);
    });
    const query = keptParams.toString();
    return `${host}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}

function normalizeNewsTitle(rawTitle?: string): string {
  if (!rawTitle || typeof rawTitle !== "string") return "";
  return decodeNewsText(rawTitle)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NEWS_DEDUP_STOPWORDS = new Set([
  "with", "that", "from", "this", "have", "been", "about", "will",
  "after", "over", "amid", "says", "near", "under", "into",
]);

function extractSignificantNewsWords(title: string): string[] {
  return normalizeNewsTitle(title)
    .split(" ")
    .filter((w) => w.length > 3 && !NEWS_DEDUP_STOPWORDS.has(w));
}

function deduplicateNewsItems<T extends { title?: string; url?: string }>(items: T[]): T[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const keptWordSets: string[][] = [];
  const result: T[] = [];

  for (const item of items) {
    const normTitle = normalizeNewsTitle(item?.title);
    if (!normTitle) continue;
    const normUrl = normalizeNewsUrl(item?.url);

    if (normUrl && seenUrls.has(normUrl)) continue;
    if (seenTitles.has(normTitle)) continue;

    const words = extractSignificantNewsWords(item?.title || "");
    let isTopicDup = false;
    if (words.length > 0) {
      for (const existingWords of keptWordSets) {
        if (existingWords.length === 0) continue;
        const common = words.filter((w) => existingWords.includes(w));
        const overlap = common.length / Math.min(words.length, existingWords.length);
        if (overlap > 0.5) {
          isTopicDup = true;
          break;
        }
      }
    }
    if (isTopicDup) continue;

    if (normUrl) seenUrls.add(normUrl);
    seenTitles.add(normTitle);
    keptWordSets.push(words);
    result.push(item);
  }

  return result;
}

function analyzeNewsSentiment(_text: string): "positive" | "negative" | "neutral" {
  // News sentiment scoring temporarily disabled until accuracy is improved
  /*
  const lower = _text.toLowerCase();
  const positiveWords = ["rally", "surge", "gain", "rise", "beat", "positive", "bullish", "record", "growth", "high", "success", "won", "boost", "exceed", "upgrade", "acquisition", "merger", "expansion"];
  const negativeWords = ["fall", "plummet", "drop", "loss", "decline", "negative", "bearish", "miss", "low", "failure", "risk", "retreat", "slump", "cooldown", "downgrade", "scarcity", "cut", "inflation", "tariff", "lawsuit"];

  let positiveScore = 0;
  let negativeScore = 0;

  positiveWords.forEach(w => {
    if (lower.includes(w)) positiveScore++;
  });
  negativeWords.forEach(w => {
    if (lower.includes(w)) negativeScore++;
  });

  if (positiveScore > negativeScore) return "positive";
  if (negativeScore > positiveScore) return "negative";
  */
  return "neutral";
}

// Proxy endpoint for news aggregation from NYT, News API, Newsdata.io, and ticker-specific Yahoo Finance
app.get("/api/news/ticker", async (req, res) => {
  const nytKey = getActiveApiKey("NYT_API_KEY");
  const newsApiKey = getActiveApiKey("NEWS_API_KEY");
  const newsdataKey = getActiveApiKey("NEWSDATA_API_KEY");
  const requestedTicker = ((req.query.ticker as string) || "").toUpperCase().trim();
  const requestedTickers = requestedTicker
    ? Array.from(new Set(requestedTicker.split(/[\s,]+/).filter(Boolean)))
    : [];
  const forceRefresh = req.query.force === "true";
  const rotateMode = req.query.mode === "rotate";
  const parsedSlot = parseInt(String(req.query.slot ?? ""), 10);

  const hasNytKey = Boolean(nytKey);
  const hasNewsApiKey = Boolean(newsApiKey);
  const hasNewsdataKey = Boolean(newsdataKey);

  const configuredSources = {
    nyt: hasNytKey,
    news: hasNewsApiKey,
    newsdata: hasNewsdataKey,
  };

  type ApiNewsSourceId = "nyt" | "news" | "newsdata";
  type RotationSourceId = ApiNewsSourceId | "yahoo";
  const availableApiSources: ApiNewsSourceId[] = [];
  if (hasNytKey) availableApiSources.push("nyt");
  if (hasNewsApiKey) availableApiSources.push("news");
  if (hasNewsdataKey) availableApiSources.push("newsdata");

  const newsItems: any[] = [];
  const activeSources: string[] = [];
  const fetchPromises: Promise<any>[] = [];
  let chosenRotationSource: RotationSourceId | null = null;

  // 0. Yahoo Finance News
  // For ticker-specific queries: fetch Yahoo search + ticker RSS intros for each requested ticker
  if (requestedTickers.length > 0) {
    for (const singleTicker of requestedTickers) {
      const yfTicker = mapToYahooSymbol(singleTicker);
      const yfUpper = yfTicker.toUpperCase();
      const baseTicker = yfUpper.split("-")[0].split("=")[0].replace(/^\^/, "");
      const tickerMatchSet = new Set([singleTicker, yfUpper, baseTicker]);

      const newsSearchAlias: Record<string, string> = {
        BTC: "Bitcoin",
        "BTC-USD": "Bitcoin",
        ETH: "Ethereum",
        "ETH-USD": "Ethereum",
        SOL: "Solana",
        "SOL-USD": "Solana",
        SPX: "S&P 500",
        "^GSPC": "S&P 500",
        DJI: "Dow Jones",
        "^DJI": "Dow Jones",
        IXIC: "Nasdaq",
        "^IXIC": "Nasdaq",
        GC: "Gold price",
        "GC=F": "Gold price",
        CL: "Crude oil",
        "CL=F": "Crude oil",
        TNX: "Treasury yield",
        "^TNX": "Treasury yield",
      };

      const aliasQuery = newsSearchAlias[singleTicker] || newsSearchAlias[yfUpper];
      const primaryQuery = aliasQuery || yfTicker;
      const escapedBase = baseTicker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedAlias = aliasQuery ? aliasQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
      const titleTickerRegex = escapedAlias
        ? new RegExp(`(\\b${escapedBase}\\b|\\b${escapedAlias}\\b)`, "i")
        : new RegExp(`\\b${escapedBase}\\b`, "i");

      activeSources.push(`Yahoo Finance (${singleTicker})`);
      fetchPromises.push(
        Promise.all([
          fetchYahooSearch(primaryQuery, 2, 50).then(async (resData) => {
            if (Array.isArray(resData?.news) && resData.news.length > 0) return resData;
            if (primaryQuery !== yfTicker) return fetchYahooSearch(yfTicker, 2, 50);
            return resData;
          }),
          fetchYahooTickerRssIntros(yfTicker),
        ])
          .then(([searchData, rssIntros]) => {
            const rawNews = Array.isArray(searchData?.news) ? searchData.news : [];
            const seenKeys = new Set<string>();
            const fromSearch = rawNews
              .filter((art: any) => {
                if (!art?.title || !art?.link) return false;
                if (isBlacklistedNews(art.title, "")) return false;
                const rel = Array.isArray(art.relatedTickers)
                  ? art.relatedTickers.map((t: any) => String(t).toUpperCase())
                  : [];
                if (rel.length > 0) {
                  if (rel.some((t: string) => tickerMatchSet.has(t))) return true;
                }
                return titleTickerRegex.test(art.title);
              })
              .map((art: any, index: number) => {
                const publishedAt =
                  typeof art.providerPublishTime === "number"
                    ? new Date(art.providerPublishTime * 1000).toISOString()
                    : new Date().toISOString();
                const publisher = typeof art.publisher === "string" && art.publisher.trim()
                  ? art.publisher.trim()
                  : "Yahoo Finance";
                const normTitle = decodeNewsText(art.title).toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
                if (art.uuid) seenKeys.add(art.uuid);
                if (normTitle) seenKeys.add(normTitle);
                const intro =
                  (art.uuid ? rssIntros.byGuid.get(art.uuid) : undefined) ||
                  rssIntros.byTitle.get(normTitle) ||
                  "";
                return {
                  id: `yf-${art.uuid || index}-${singleTicker}`,
                  title: art.title,
                  source: publisher === "Yahoo Finance" ? "Yahoo Finance" : `${publisher} / Yahoo Finance`,
                  time: formatNewsTime(publishedAt),
                  symbol: singleTicker,
                  relatedTickers: Array.isArray(art.relatedTickers)
                    ? art.relatedTickers.filter((t: any) => typeof t === "string" && /^[A-Z0-9.-]{1,8}$/i.test(t))
                    : [singleTicker],
                  sentiment: analyzeNewsSentiment(`${art.title} ${intro}`),
                  classification: `YAHOO FINANCE - ${singleTicker}`,
                  content: intro,
                  url: art.link,
                  publishedAt,
                };
              });

            // Also include fresh Yahoo Finance RSS articles for the ticker not returned by Search
            const fromRss = rssIntros.items
              .filter((rssArt) => {
                if (isBlacklistedNews(rssArt.title, rssArt.intro)) return false;
                const normTitle = rssArt.title.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
                if (rssArt.guid && seenKeys.has(rssArt.guid)) return false;
                if (normTitle && seenKeys.has(normTitle)) return false;
                return titleTickerRegex.test(`${rssArt.title} ${rssArt.intro}`);
              })
              .slice(0, 20)
              .map((rssArt, index) => ({
                id: `yfrss-${rssArt.guid || index}-${singleTicker}`,
                title: rssArt.title,
                source: "Yahoo Finance",
                time: formatNewsTime(rssArt.publishedAt),
                symbol: singleTicker,
                relatedTickers: [singleTicker],
                sentiment: analyzeNewsSentiment(`${rssArt.title} ${rssArt.intro}`),
                classification: `YAHOO FINANCE - ${singleTicker}`,
                content: rssArt.intro,
                url: rssArt.link,
                publishedAt: rssArt.publishedAt,
              }));

            return [...fromSearch, ...fromRss];
          })
          .catch(() => [])
      );
    }
  } else if (!rotateMode) {
    // For general unfiltered NEWS HUB: execute broad Yahoo Finance search queries (markets, stock market, SPY)
    activeSources.push("Yahoo Finance (Markets)");
    const generalYahooQueries = ["markets", "stock market", "SPY"];
    fetchPromises.push(
      Promise.all(
        generalYahooQueries.map((query) =>
          fetchYahooSearch(query, 2, 50).catch(() => ({ quotes: [], news: [] }))
        )
      )
        .then((queryResults) => {
          const rawItems: any[] = [];
          for (const resData of queryResults) {
            if (Array.isArray(resData?.news)) {
              rawItems.push(...resData.news);
            }
          }

          const seenUrls = new Set<string>();
          const seenUuids = new Set<string>();
          const seenNormTitles = new Set<string>();
          const normalizedArticles: any[] = [];

          for (let index = 0; index < rawItems.length; index++) {
            const art = rawItems[index];
            if (!art?.title || !art?.link) continue;
            if (isBlacklistedNews(art.title, "")) continue;

            const normUrl = normalizeNewsUrl(art.link);
            const uuid = typeof art.uuid === "string" ? art.uuid.trim() : "";
            const normTitle = decodeNewsText(art.title).toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();

            if (normUrl && seenUrls.has(normUrl)) continue;
            if (uuid && seenUuids.has(uuid)) continue;
            if (normTitle && seenNormTitles.has(normTitle)) continue;

            if (normUrl) seenUrls.add(normUrl);
            if (uuid) seenUuids.add(uuid);
            if (normTitle) seenNormTitles.add(normTitle);

            const publishedAt =
              typeof art.providerPublishTime === "number" && art.providerPublishTime > 0
                ? new Date(art.providerPublishTime * 1000).toISOString()
                : "";
            if (!publishedAt) continue;

            const publisher = typeof art.publisher === "string" && art.publisher.trim()
              ? art.publisher.trim()
              : "Yahoo Finance";

            const relatedTickers: string[] = Array.isArray(art.relatedTickers)
              ? art.relatedTickers.filter((t: any) => typeof t === "string" && /^[A-Z0-9.-]{1,8}$/i.test(t))
              : [];

            normalizedArticles.push({
              id: `yfg-${uuid || index}`,
              title: art.title,
              source: publisher === "Yahoo Finance" ? "Yahoo Finance" : `${publisher} / Yahoo Finance`,
              time: formatNewsTime(publishedAt),
              symbol: relatedTickers[0] || "MARKET",
              relatedTickers,
              sentiment: analyzeNewsSentiment(art.title),
              classification: "YAHOO FINANCE - MARKETS",
              content: "",
              url: art.link,
              publishedAt,
            });
          }

          // Deduplicate overlapping results across the three Yahoo queries
          return deduplicateNewsItems(normalizedArticles);
        })
        .catch(() => [])
    );
  }

  const fetchNytItems = async (): Promise<any[]> => {
    if (!hasNytKey) return [];
    const nytAge = Date.now() - newsProviderCache.nyt.timestamp;
    if (newsProviderCache.nyt.items.length > 0 && ((!forceRefresh && nytAge < NEWS_CACHE_TTL_MS) || Date.now() < apiCooldowns.nyt)) {
      return newsProviderCache.nyt.items;
    }
    if (Date.now() < apiCooldowns.nyt) {
      console.log("NYT Business is in cooldown. Skipping fetch.");
      return [];
    }
    try {
      const r = await fetch(
        `https://api.nytimes.com/svc/topstories/v2/business.json?api-key=${encodeURIComponent(nytKey)}`
      );
      if (!r.ok) {
        apiCooldowns.nyt = Date.now() + 5 * 60 * 1000;
        throw new Error(`NYT status ${r.status}`);
      }
      const data = await r.json();
      if (data && Array.isArray(data.results)) {
        const mapped = data.results.map((art: any, index: number) => ({
          id: `nyt-${index}-${art.published_date || index}`,
          title: art.title || "NYT Market Update",
          source: "New York Times Business",
          time: formatNewsTime(art.published_date || art.created_date),
          sentiment: analyzeNewsSentiment((art.title || "") + " " + (art.abstract || "")),
          classification: "NYT - BUSINESS",
          content: formatIntroSentences(art.abstract || "", art.title || "", 2, 260),
          url: art.url || "https://www.nytimes.com/section/business",
          publishedAt: art.published_date || art.created_date || new Date().toISOString()
        }));
        const filtered = deduplicateNewsItems(
          mapped.filter((item: any) => isStockOrMarketRelated(item.title, item.content))
        ).slice(0, 30);
        newsProviderCache.nyt = { timestamp: Date.now(), items: filtered };
        return filtered;
      }
      return newsProviderCache.nyt.items;
    } catch (err: any) {
      console.log(
        "NYT API fetch handled gracefully:",
        redactErrorMessage(err, "NYT API request failed.", { extraSecrets: [nytKey] })
      );
      return newsProviderCache.nyt.items;
    }
  };

  const fetchNewsApiItems = async (): Promise<any[]> => {
    if (!hasNewsApiKey) return [];
    const newsApiAge = Date.now() - newsProviderCache.newsapi.timestamp;
    if (newsProviderCache.newsapi.items.length > 0 && ((!forceRefresh && newsApiAge < NEWS_CACHE_TTL_MS) || Date.now() < apiCooldowns.newsapi)) {
      return newsProviderCache.newsapi.items;
    }
    if (Date.now() < apiCooldowns.newsapi) {
      console.log("News API is in cooldown. Skipping fetch.");
      return [];
    }
    try {
      const r = await fetch("https://newsapi.org/v2/top-headlines?category=business&country=us", {
        headers: {
          "X-Api-Key": newsApiKey,
          Accept: "application/json",
        },
      });
      if (!r.ok) {
        apiCooldowns.newsapi = Date.now() + 5 * 60 * 1000;
        throw new Error(`News API status ${r.status}`);
      }
      const data = await r.json();
      if (data && Array.isArray(data.articles)) {
        const mapped = data.articles.map((art: any, index: number) => ({
          id: `newsapi-${index}-${art.publishedAt || index}`,
          title: art.title || "Corporate Headline",
          source: art.source?.name || "News API Business",
          time: formatNewsTime(art.publishedAt),
          sentiment: analyzeNewsSentiment((art.title || "") + " " + (art.description || "")),
          classification: "NEWSAPI - CORP",
          content: formatIntroSentences(art.description || art.content || "", art.title || "", 2, 260),
          url: art.url || "https://newsapi.org",
          publishedAt: art.publishedAt || new Date().toISOString()
        }));
        const filtered = deduplicateNewsItems(
          mapped.filter((item: any) => isStockOrMarketRelated(item.title, item.content))
        ).slice(0, 30);
        newsProviderCache.newsapi = { timestamp: Date.now(), items: filtered };
        return filtered;
      }
      return newsProviderCache.newsapi.items;
    } catch (err: any) {
      console.log(
        "News API fetch handled gracefully:",
        redactErrorMessage(err, "News API request failed.", { extraSecrets: [newsApiKey] })
      );
      return newsProviderCache.newsapi.items;
    }
  };

  const fetchNewsdataItems = async (): Promise<any[]> => {
    if (!hasNewsdataKey) return [];
    const newsdataAge = Date.now() - newsProviderCache.newsdata.timestamp;
    if (newsProviderCache.newsdata.items.length > 0 && ((!forceRefresh && newsdataAge < NEWS_CACHE_TTL_MS) || Date.now() < apiCooldowns.newsdata)) {
      return newsProviderCache.newsdata.items;
    }
    if (Date.now() < apiCooldowns.newsdata) {
      console.log("Newsdata.io is in cooldown. Skipping fetch.");
      return [];
    }
    try {
      const r = await fetch(
        `https://newsdata.io/api/1/news?apikey=${encodeURIComponent(newsdataKey)}&category=business&language=en`
      );
      if (!r.ok) {
        apiCooldowns.newsdata = Date.now() + 5 * 60 * 1000;
        throw new Error(`Newsdata.io status ${r.status}`);
      }
      const data = await r.json();
      if (data && Array.isArray(data.results)) {
        const mapped = data.results.map((art: any, index: number) => ({
          id: `newsdata-${index}-${art.pubDate || index}`,
          title: art.title || "Market Pulse",
          source: art.source_id || "Newsdata.io",
          time: formatNewsTime(art.pubDate),
          sentiment: analyzeNewsSentiment((art.title || "") + " " + (art.description || "")),
          classification: "NEWSDATA - MARKET",
          content: formatIntroSentences(art.description || "", art.title || "", 2, 260),
          url: art.link || "https://newsdata.io",
          publishedAt: art.pubDate || new Date().toISOString()
        }));
        const filtered = deduplicateNewsItems(
          mapped.filter((item: any) => isStockOrMarketRelated(item.title, item.content))
        ).slice(0, 30);
        newsProviderCache.newsdata = { timestamp: Date.now(), items: filtered };
        return filtered;
      }
      return newsProviderCache.newsdata.items;
    } catch (err: any) {
      console.log(
        "Newsdata.io API fetch handled gracefully:",
        redactErrorMessage(err, "Newsdata.io request failed.", { extraSecrets: [newsdataKey] })
      );
      return newsProviderCache.newsdata.items;
    }
  };

  const fetchYahooMarketItems = async (): Promise<any[]> => {
    const yahooAge = Date.now() - newsProviderCache.yahoo.timestamp;
    if (newsProviderCache.yahoo.items.length > 0 && !forceRefresh && yahooAge < NEWS_CACHE_TTL_MS) {
      return newsProviderCache.yahoo.items;
    }
    try {
      const r = await fetch(
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5EDJI,%5EIXIC&region=US&lang=en-US",
        { headers: { "User-Agent": YAHOO_UA } }
      );
      if (!r.ok) throw new Error(`Yahoo RSS status ${r.status}`);
      const xml = await r.text();
      const parsedItems: any[] = [];
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const block = m[1];
        const getTag = (tag: string) => {
          const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
          return match ? match[1].trim() : "";
        };
        const guid = decodeNewsText(getTag("guid"));
        const rawTitle = decodeNewsText(getTag("title"));
        const link = decodeNewsText(getTag("link"));
        const pubDateRaw = decodeNewsText(getTag("pubDate"));
        const intro = formatIntroSentences(getTag("description"), rawTitle, 2, 260);
        if (!rawTitle || !link || isBlacklistedNews(rawTitle, intro)) continue;
        let publishedAt = new Date().toISOString();
        if (pubDateRaw) {
          const d = new Date(pubDateRaw);
          if (!isNaN(d.getTime())) publishedAt = d.toISOString();
        }
        parsedItems.push({
          id: `yhmkt-${guid || parsedItems.length}`,
          title: rawTitle,
          source: "Yahoo Finance",
          time: formatNewsTime(publishedAt),
          sentiment: analyzeNewsSentiment(`${rawTitle} ${intro}`),
          classification: "YAHOO FINANCE - MARKETS",
          content: intro,
          url: link,
          publishedAt,
        });
        if (parsedItems.length >= 30) break;
      }
      const dedupedYahoo = deduplicateNewsItems(parsedItems).slice(0, 30);
      if (dedupedYahoo.length > 0) {
        newsProviderCache.yahoo = { timestamp: Date.now(), items: dedupedYahoo };
        return dedupedYahoo;
      }
      return newsProviderCache.yahoo.items;
    } catch (err: any) {
      console.log("Yahoo Market RSS fetch handled gracefully:", err.message);
      return newsProviderCache.yahoo.items;
    }
  };

  const providerFetchers: Record<RotationSourceId, { label: string; fn: () => Promise<any[]> }> = {
    nyt: { label: "NYT Business", fn: fetchNytItems },
    news: { label: "News API", fn: fetchNewsApiItems },
    newsdata: { label: "Newsdata.io", fn: fetchNewsdataItems },
    yahoo: { label: "Yahoo Finance", fn: fetchYahooMarketItems },
  };

  try {
    if (rotateMode && !requestedTicker) {
      const rotationCandidates: RotationSourceId[] = [...availableApiSources, "yahoo"];
      const results = await Promise.all(
        rotationCandidates.map(async (id) => ({
          id,
          items: await providerFetchers[id].fn(),
        }))
      );
      const workingPool = results.filter((entry) => entry.items.length > 0);
      if (workingPool.length > 0) {
        const slot = Number.isFinite(parsedSlot)
          ? Math.abs(parsedSlot)
          : Math.floor(Date.now() / (10 * 60 * 1000));
        const picked = workingPool[slot % workingPool.length];
        chosenRotationSource = picked.id;
        activeSources.push(providerFetchers[picked.id].label);
        newsItems.push(...picked.items);
      }
    } else {
      if (!requestedTicker) {
        // Unfiltered NEWS HUB: always include Yahoo Market RSS alongside any configured secondary sources
        activeSources.push("Yahoo Finance (RSS)");
        fetchPromises.push(providerFetchers.yahoo.fn());
      }
      for (const srcId of availableApiSources) {
        activeSources.push(providerFetchers[srcId].label);
        fetchPromises.push(providerFetchers[srcId].fn());
      }
    }

    if (fetchPromises.length > 0) {
      const results = await Promise.all(fetchPromises);
      results.forEach(items => {
        if (Array.isArray(items)) {
          newsItems.push(...items);
        }
      });
    }

    // Sort all real news by publication date descending (newest first) and deduplicate strictly
    const sortedNews = deduplicateNewsItems(
      [...newsItems].sort((a, b) => {
        const pubA = a.publishedAt || a.published_date || a.pubDate || '';
        const pubB = b.publishedAt || b.published_date || b.pubDate || '';
        if (!pubA) return 1;
        if (!pubB) return -1;
        return new Date(pubB).getTime() - new Date(pubA).getTime();
      })
    );

    // Prefer headlines published within a rolling 24-hour window (avoids midnight-ET cliff
    // collapsing a 15-article feed down to 1 headline right after 00:00 ET).
    const nowMs = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const FUTURE_SKEW_MS = 12 * 60 * 60 * 1000;
    const recentNews = sortedNews.filter((item) => {
      const pubStr = item.publishedAt || item.published_date || item.pubDate;
      if (!pubStr) return false;
      const itemMs = new Date(pubStr).getTime();
      if (Number.isNaN(itemMs)) return false;
      const ageMs = nowMs - itemMs;
      return ageMs >= -FUTURE_SKEW_MS && ageMs <= ONE_DAY_MS;
    });

    const minFreshCount = rotateMode ? 6 : 1;
    const finalNewsPool = recentNews.length >= minFreshCount ? recentNews : sortedNews;
    const finalNewsSlice = finalNewsPool.slice(0, 60);
    let enrichedNewsSlice = finalNewsSlice;
    try {
      enrichedNewsSlice = await newsPaywallService.enrichNewsItemsWithPaywall(finalNewsSlice);
    } catch {
      // Paywall detection failures must never block news retrieval or rendering
      enrichedNewsSlice = finalNewsSlice;
    }

    return res.json({
      success: true,
      sources: activeSources,
      configuredSources,
      activeSource: chosenRotationSource,
      isSimulated: false,
      data: enrichedNewsSlice
    });

  } catch (err: any) {
    const safeMsg = redactErrorMessage(err, "Unable to aggregate financial news.");
    console.error("News aggregation error:", safeMsg);
    return res.json({
      success: false,
      sources: activeSources,
      configuredSources,
      error: safeMsg,
      data: []
    });
  }
});

// ---------------------------------------------------------------------------
// INSTITUTIONAL ACTIVITY (Form 13F) — Exclusively powered by 3spread API
// ---------------------------------------------------------------------------
function handleInstitutionalError(res: express.Response, err: unknown, context: string) {
  if (err instanceof ThreeSpreadError) {
    return res.status(err.status).json({
      success: false,
      requiresKey: Boolean(err.requiresKey),
      rateLimited: Boolean(err.rateLimited),
      error: redactErrorMessage(err, "3spread API request failed."),
      provider: "3spread",
    });
  }
  const msg = redactErrorMessage(err, "Failed to retrieve institutional holdings data.");
  console.error(`Institutional (${context}) error:`, msg);
  return res.status(502).json({
    success: false,
    requiresKey: false,
    rateLimited: false,
    error: "Unable to retrieve institutional holdings data from 3spread.",
    provider: "3spread",
  });
}

app.get("/api/institutional/status", async (req, res) => {
  try {
    const configured = isThreeSpreadConfigured();
    if (!configured) {
      return res.json({
        success: true,
        configured: false,
        requiresKey: true,
        provider: "3spread",
        availablePeriods: [],
        freshness: null,
      });
    }
    const force = req.query.force === "true";
    const { periods, freshness } = await getAvailableReportingPeriods(force);
    return res.json({
      success: true,
      configured: true,
      requiresKey: false,
      provider: "3spread",
      availablePeriods: periods,
      freshness,
    });
  } catch (err) {
    return handleInstitutionalError(res, err, "status");
  }
});

app.get("/api/institutional/holdings", async (req, res) => {
  try {
    const data = await getInstitutionalHoldingsData({
      ticker: typeof req.query.ticker === "string" ? req.query.ticker : undefined,
      cusip: typeof req.query.cusip === "string" ? req.query.cusip : undefined,
      issuer: typeof req.query.issuer === "string" ? req.query.issuer : undefined,
      managerCik: typeof req.query.managerCik === "string" ? req.query.managerCik : undefined,
      managerQuery: typeof req.query.managerQuery === "string" ? req.query.managerQuery : undefined,
      period: typeof req.query.period === "string" ? req.query.period : undefined,
      sortBy: typeof req.query.sortBy === "string" ? req.query.sortBy : undefined,
      sortDir: typeof req.query.sortDir === "string" ? req.query.sortDir : undefined,
      statusFilter: typeof req.query.statusFilter === "string" ? req.query.statusFilter : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      force: req.query.force === "true",
    });
    return res.json({ success: true, provider: "3spread", ...data });
  } catch (err) {
    return handleInstitutionalError(res, err, "holdings");
  }
});

app.get("/api/institutional/accumulation", async (req, res) => {
  try {
    const data = await getInstitutionalAccumulation({
      period: typeof req.query.period === "string" ? req.query.period : undefined,
      minIncreasing: req.query.minIncreasing ? Number(req.query.minIncreasing) : 2,
      minPctIncrease: req.query.minPctIncrease ? Number(req.query.minPctIncrease) : 0,
      minNewPositions: req.query.minNewPositions ? Number(req.query.minNewPositions) : 0,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      sortBy: typeof req.query.sortBy === "string" ? req.query.sortBy : undefined,
      sortDir: typeof req.query.sortDir === "string" ? req.query.sortDir : undefined,
      force: req.query.force === "true",
    });
    return res.json({ success: true, provider: "3spread", ...data });
  } catch (err) {
    return handleInstitutionalError(res, err, "accumulation");
  }
});

app.get("/api/institutional/investors", async (req, res) => {
  try {
    const data = await getInstitutionalManagersDirectory({
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      period: typeof req.query.period === "string" ? req.query.period : undefined,
      force: req.query.force === "true",
    });
    return res.json({ success: true, provider: "3spread", ...data });
  } catch (err) {
    return handleInstitutionalError(res, err, "investors");
  }
});

app.get("/api/institutional/investor/:cik", async (req, res) => {
  try {
    const data = await getInstitutionalInvestorProfile({
      cik: req.params.cik,
      period: typeof req.query.period === "string" ? req.query.period : undefined,
      force: req.query.force === "true",
    });
    return res.json({ success: true, provider: "3spread", ...data });
  } catch (err) {
    return handleInstitutionalError(res, err, "investor-profile");
  }
});

app.get("/api/institutional/changes", async (req, res) => {
  try {
    const data = await getInstitutionalPositionChanges({
      category: typeof req.query.category === "string" ? req.query.category : "ALL",
      ticker: typeof req.query.ticker === "string" ? req.query.ticker : undefined,
      cusip: typeof req.query.cusip === "string" ? req.query.cusip : undefined,
      managerQuery: typeof req.query.managerQuery === "string" ? req.query.managerQuery : undefined,
      period: typeof req.query.period === "string" ? req.query.period : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      force: req.query.force === "true",
    });
    return res.json({ success: true, provider: "3spread", ...data });
  } catch (err) {
    return handleInstitutionalError(res, err, "changes");
  }
});

app.get("/api/institutional/sector-rotation", async (req, res) => {
  try {
    const data = await getSectorRotationData({
      period: typeof req.query.period === "string" ? req.query.period : undefined,
      windowDays: req.query.windowDays ? Number(req.query.windowDays) : 90,
      force: req.query.force === "true",
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    const safeMsg = redactErrorMessage(err, "Failed to load Sector Rotation data.");
    console.error("Institutional sector-rotation API error:", safeMsg);
    return res.status(500).json({
      success: false,
      error: safeMsg,
    });
  }
});

// INSIDER TRADING (SEC Form 3/4/5) — Powered by 3spread /v1/insiders + /v1/insiders/transactions
app.get("/api/insiders", async (req, res) => {
  const rawTicker = typeof req.query.ticker === "string" ? req.query.ticker.trim().toUpperCase() : "";
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const offset = req.query.offset ? Number(req.query.offset) : 0;
  const force = req.query.force === "true";

  if (!rawTicker) {
    return res.status(400).json({
      success: false,
      provider: "3spread",
      ticker: "",
      issuerName: null,
      records: [],
      limit: 20,
      offset: 0,
      hasMore: false,
      windowStart: null,
      windowEnd: null,
      dataMode: "transactions",
      fetchedAt: null,
      error: "Ticker symbol is required.",
    });
  }

  if (!isThreeSpreadConfigured()) {
    return res.status(503).json({
      success: false,
      provider: "3spread",
      requiresKey: true,
      ticker: rawTicker,
      issuerName: null,
      records: [],
      limit: Math.min(50, Math.max(1, Math.floor(limit) || 20)),
      offset: Math.max(0, Math.floor(offset) || 0),
      hasMore: false,
      windowStart: null,
      windowEnd: null,
      dataMode: "transactions",
      fetchedAt: null,
      error: "Insider trading data requires THREESPREAD_API_KEY configuration on the server.",
    });
  }

  try {
    const data = await getInsiderTradingByTicker({
      ticker: rawTicker,
      limit,
      offset,
      force,
    });
    return res.json(data);
  } catch (err) {
    if (err instanceof ThreeSpreadError) {
      const status = err.status;
      let userMessage = redactErrorMessage(err, "Unable to retrieve insider trading data.");
      if (status === 401 || status === 403) {
        userMessage = "3spread API authentication failed. Verify the configured THREESPREAD_API_KEY.";
      } else if (status === 429) {
        userMessage = "3spread API rate limit reached. Please wait a moment and retry.";
      } else if (status === 400 || status === 422) {
        userMessage = redactErrorMessage(err, "Invalid insider trading query parameters.");
      } else if (status >= 500) {
        userMessage = "Insider trading data is temporarily unavailable from 3spread.";
      }
      return res.status(status).json({
        success: false,
        provider: "3spread",
        requiresKey: Boolean(err.requiresKey),
        rateLimited: Boolean(err.rateLimited),
        ticker: rawTicker,
        issuerName: null,
        records: [],
        limit: Math.min(50, Math.max(1, Math.floor(limit) || 20)),
        offset: Math.max(0, Math.floor(offset) || 0),
        hasMore: false,
        windowStart: null,
        windowEnd: null,
        dataMode: "transactions",
        fetchedAt: null,
        error: userMessage,
      });
    }

    const safeMsg = redactErrorMessage(err, "Unable to retrieve insider trading data.");
    console.error("Insider trading API error:", safeMsg);
    return res.status(502).json({
      success: false,
      provider: "3spread",
      ticker: rawTicker,
      issuerName: null,
      records: [],
      limit: Math.min(50, Math.max(1, Math.floor(limit) || 20)),
      offset: Math.max(0, Math.floor(offset) || 0),
      hasMore: false,
      windowStart: null,
      windowEnd: null,
      dataMode: "transactions",
      fetchedAt: null,
      error: "Unable to retrieve insider trading data.",
    });
  }
});

// Congressional Trading Routes
app.get("/api/congress/status", async (req, res) => {
  try {
    const refresh = req.query.refresh === "true" || req.query.checkIndex === "true";
    if (refresh) {
      const result = await runIngestionBackfill({ forceCheckIndex: false });
      const status = getCongressTradingStatus();
      return res.json({
        ...status,
        indexCheckRan: result.indexCheckRan,
        newFilingsFound: result.newFilingsFound,
        cooldownActive: result.cooldownActive,
        cooldownRemainingSeconds: result.cooldownRemainingSeconds,
      });
    }

    const status = getCongressTradingStatus();
    return res.json(status);
  } catch (err) {
    console.error("Congress status endpoint error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve Congressional trading status.",
    });
  }
});

app.get("/api/congress/trades", (req, res) => {
  try {
    const party = typeof req.query.party === "string" ? req.query.party : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const owner = typeof req.query.owner === "string" ? req.query.owner : undefined;
    const ticker = typeof req.query.ticker === "string" ? req.query.ticker : undefined;
    const politician = typeof req.query.politician === "string" ? req.query.politician : undefined;
    const assetGroup = typeof req.query.assetGroup === "string" ? req.query.assetGroup : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
    const sortBy =
      req.query.sortBy === "transactionDate" || req.query.sortBy === "amount"
        ? req.query.sortBy
        : "disclosureDate";
    const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : 50;

    const data = queryCongressTrades({
      party,
      type,
      owner,
      ticker,
      politician,
      assetGroup,
      dateFrom,
      dateTo,
      sortBy,
      sortDir,
      page,
      pageSize,
    });

    return res.json(data);
  } catch (err) {
    console.error("Congress trades endpoint error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to query Congressional trades.",
      trades: [],
      totalTrades: 0,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      isStale: true,
      lastUpdated: null,
    });
  }
});

// Configure Vite integration for develop and static assets for build

async function startServer() {
  // Prevent unmatched or errored /api/* requests from falling through to SPA HTML
  app.use("/api", (_req, res) => {
    return res.status(404).json({
      success: false,
      error: "API route not found",
    });
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith("/api")) {
      const safeMsg = redactErrorMessage(err, "Internal server error");
      console.error("Unhandled API error:", safeMsg);
      return res.status(err?.status || 500).json({
        success: false,
        error: safeMsg,
      });
    }
    return next(err);
  });

  let vite: Awaited<ReturnType<typeof createViteServer>> | null = null;
  if (process.env.NODE_ENV !== "production") {
    const hmrDisabled = process.env.DISABLE_HMR === "true";
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        ...(hmrDisabled ? { hmr: false, ws: false, watch: null } : {}),
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`QUORIX server running on http://localhost:${PORT}`);
    // Initialize background congressional trading ingest
    initializeCongressionalTradingService();
  });

  const shutdown = () => {
    httpServer.close(() => {
      if (vite) {
        vite.close().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

const isDirectRun = Boolean(
  process.argv[1] &&
    (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.cjs") || process.argv[1].endsWith("server.js"))
);

if (isDirectRun && process.env.NODE_ENV !== "test") {
  startServer().catch((err) => {
    console.error("Failed to start QUORIX server:", err);
    process.exit(1);
  });
}

import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { enrichBarsWithStudies } from "./src/utils/technicalStudies";

// Load environment variables
dotenv.config();

// In-memory key store to allow dynamic configuration overrides via a Settings page
const customKeys = {
  ALPHA_VANTAGE_API_KEY: process.env.ALPHA_VANTAGE_API_KEY || "",
  NYT_API_KEY: process.env.NYT_API_KEY || "",
  NEWS_API_KEY: process.env.NEWS_API_KEY || "",
  NEWSDATA_API_KEY: process.env.NEWSDATA_API_KEY || "",
  FRED_API_KEY: process.env.FRED_API_KEY || "",
};

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
let fredEconomicsCache: { timestamp: number; data: any } | null = null;
let fredCurrenciesCache: { timestamp: number; data: any } | null = null;

function getFredApiKey(): string {
  return (customKeys.FRED_API_KEY || process.env.FRED_API_KEY || "").trim();
}

async function fetchFredObservations(
  seriesId: string,
  apiKey: string,
  options: { units?: "lin" | "pc1"; limit?: number } = {}
): Promise<Array<{ date: string; value: number }>> {
  const { units = "lin", limit = 6 } = options;
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
    seriesId
  )}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=${limit}&units=${units}`;

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

const PORT = 3000;

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

async function fetchYahooSearch(query: string, quotesCount = 5, newsCount = 6): Promise<{ quotes: any[]; news: any[] }> {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      query
    )}&quotesCount=${quotesCount}&newsCount=${newsCount}`;
    const res = await fetch(url, { headers: { "User-Agent": YAHOO_UA } });
    if (!res.ok) return { quotes: [], news: [] };
    const data = await res.json();
    return {
      quotes: Array.isArray(data?.quotes) ? data.quotes : [],
      news: Array.isArray(data?.news) ? data.news : [],
    };
  } catch {
    return { quotes: [], news: [] };
  }
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

const TICKER_STOP_WORDS = new Set([
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

function extractTickersFromCommand(command: string, fallbackTicker?: string): string[] {
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

  if (newsItems.length > 0) {
    lines.push("");
    lines.push(`RECENT HEADLINES (${sym})`);
    for (const item of newsItems.slice(0, 4)) {
      const ts = item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString().slice(0, 10)
        : "RECENT";
      lines.push(`  • [${ts}] ${item.publisher || "MarketWire"}: ${item.title}`);
      if (item.link) {
        links.push({ title: `${item.publisher || "News"}: ${item.title}`, url: item.link });
      }
    }
  }

  lines.push("");
  lines.push(`SOURCE: YAHOO FINANCE LIVE STREAM`);

  return { output: lines.join("\n"), links };
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
    `RECOMMENDATION : ${(fin.recommendationKey || "N/A").toUpperCase()}  |  ANALYST COUNT: ${fin.numberOfAnalystOpinions?.raw ?? "N/A"}`
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

async function runExistingApiFallback(params: {
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
    // General terminal prompt or conversation (BWRITE / HELP)
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
      } = 24
) {
  const opts =
    typeof maxBarsOrOpts === 'number'
      ? { maxBars: maxBarsOrOpts, evenlySample: false, todayOnly: false }
      : { maxBars: 36, evenlySample: false, todayOnly: false, ...maxBarsOrOpts };

  const timestamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const opens: any[] = Array.isArray(quote.open) ? quote.open : [];
  const highs: any[] = Array.isArray(quote.high) ? quote.high : [];
  const lows: any[] = Array.isArray(quote.low) ? quote.low : [];
  const closes: any[] = Array.isArray(quote.close) ? quote.close : [];
  const volumes: any[] = Array.isArray(quote.volume) ? quote.volume : [];

  let bars: Array<{
    date: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    [key: string]: any;
  }> = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (typeof ts === 'number' && typeof o === 'number' && typeof h === 'number' && typeof l === 'number' && typeof c === 'number') {
      bars.push({
        date: formatYahooTimestamp(ts, interval),
        timestamp: ts,
        open: parseFloat(o.toFixed(3)),
        high: parseFloat(h.toFixed(3)),
        low: parseFloat(l.toFixed(3)),
        close: parseFloat(c.toFixed(3)),
        volume: typeof volumes[i] === 'number' ? volumes[i] : 0
      });
    }
  }

  // Sort strictly chronologically (oldest first)
  bars.sort((a, b) => a.timestamp - b.timestamp);

  // Compute all technical studies over full continuous warmup series BEFORE window slicing
  const tz = result?.meta?.exchangeTimezoneName || 'America/New_York';
  if (bars.length > 0) {
    enrichBarsWithStudies(bars, tz);
  }

  if (bars.length > 0) {
    const latestTs = bars[bars.length - 1].timestamp;
    if (opts.todayOnly) {
      const tz = result?.meta?.exchangeTimezoneName || 'America/New_York';
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

    // --- STEP 1: Try Yahoo Finance First (Free, real-time, includes real hourly bars) ---
    try {
      const yfSymbol = mapToYahooSymbol(cacheKey);

      console.log(`Querying Yahoo Finance proxy for symbol: ${yfSymbol} (requested as: ${cacheKey})`);
      const yfUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?interval=1h&range=5d`;
      const yfResponse = await fetch(yfUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      if (yfResponse.ok) {
        const yfData = await yfResponse.json();
        const result = yfData?.chart?.result?.[0];
        if (result) {
          const meta = result.meta;
          const quote = result.indicators?.quote?.[0] || {};
          const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
          const price = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : 0;
          const prevClose =
            typeof meta.regularMarketPreviousClose === 'number'
              ? meta.regularMarketPreviousClose
              : typeof meta.previousClose === 'number'
              ? meta.previousClose
              : typeof meta.chartPreviousClose === 'number'
              ? meta.chartPreviousClose
              : price;
          const decimals = cacheKey === 'TNX' ? 3 : 2;
          const change = parseFloat((price - prevClose).toFixed(decimals));
          const changePercent = prevClose > 0 ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0;
          const history = extractYahooBars(result, '1h', 16);

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
            name: meta.longName || meta.shortName || `${cacheKey} Corp.`,
            exchange: formatExchangeName(meta),
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
      console.log("Yahoo Finance query failed or returned empty results, falling back to Alpha Vantage:", yfErr.message);
    }

    // --- STEP 2: Fallback to Alpha Vantage ---
    const apiKey = customKeys.ALPHA_VANTAGE_API_KEY || process.env.ALPHA_VANTAGE_API_KEY || "8GMTSP7LH2AGTJH4";
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(cacheKey)}&apikey=${apiKey}`;
    
    console.log(`Querying Alpha Vantage proxy for symbol: ${cacheKey}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Alpha Vantage returned status ${response.status}`);
    }
    const data = await response.json();
    
    // Check for rate limiting or information messages
    if (data.Note || data.Information) {
      console.log("Alpha Vantage notice:", data.Note || data.Information);
      
      // Fallback: If we have a previously fetched real cached quote, serve it with notice
      if (cached) {
        console.log(`Alpha Vantage rate-limited. Serving EXPIRED cached quote for: ${cacheKey}`);
        return res.json({
          success: true,
          quote: adjustQuoteForTradingHours(cached.quote),
          cachedAt: new Date(cached.timestamp).toLocaleTimeString(),
          isCached: true,
          warning: "API rate limit reached. Serving last known live quote.",
          isRateLimited: true
        });
      }

      return res.json({
        success: false,
        error: "Live market quote unavailable (rate limit reached).",
        isRateLimited: true
      });
    }

    if (data["Error Message"]) {
      return res.json({
        success: false,
        error: data["Error Message"]
      });
    }

    const quote = data["Global Quote"];
    if (!quote || Object.keys(quote).length === 0) {
      if (cached) {
        return res.json({
          success: true,
          quote: adjustQuoteForTradingHours(cached.quote),
          cachedAt: new Date(cached.timestamp).toLocaleTimeString(),
          isCached: true
        });
      }
      return res.json({
        success: false,
        error: "No quote data was found for symbol. Please check the ticker name."
      });
    }

    const parsedQuote = {
      symbol: (quote["01. symbol"] || cacheKey).toUpperCase(),
      open: parseFloat(quote["02. open"] || "0"),
      high: parseFloat(quote["03. high"] || "0"),
      low: parseFloat(quote["04. low"] || "0"),
      price: parseFloat(quote["05. price"] || "0"),
      volume: parseInt(quote["06. volume"] || "0"),
      latestTradingDay: quote["07. latest trading day"] || "",
      prevClose: parseFloat(quote["08. previous close"] || "0"),
      change: parseFloat(quote["09. change"] || "0"),
      changePercent: parseFloat((quote["10. change percent"] || "0%").replace("%", "")),
      name: `${(quote["01. symbol"] || cacheKey).toUpperCase()} Corp.`
    };

    // Save to in-memory cache
    quoteCache[cacheKey] = {
      timestamp: now,
      quote: parsedQuote
    };

    return res.json({
      success: true,
      quote: adjustQuoteForTradingHours(parsedQuote),
      isCached: false
    });
  } catch (err: any) {
    console.log("Quote endpoint handled gracefully:", err.message);
    return res.json({
      success: false,
      error: err.message,
    });
  }
});

// Real OHLCV history endpoint via Yahoo Finance for GP multi-interval charts
app.get("/api/market/history", async (req, res) => {
  try {
    const symbol = ((req.query.symbol as string) || "").toUpperCase().trim();
    const interval = ((req.query.interval as string) || "1h").trim();
    if (!symbol) {
      return res.status(400).json({ success: false, error: "Symbol is required" });
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

    // If Yahoo returned 404 (e.g. company name or alias), try resolving the exact Yahoo symbol via search
    if (yfResponse.status === 404) {
      const searchRes = await fetchYahooSearch(symbol, 3, 0);
      const resolved = searchRes.quotes.find(
        (q: any) =>
          q?.symbol &&
          ["EQUITY", "ETF", "INDEX", "CRYPTOCURRENCY", "FUTURE", "CURRENCY"].includes(q.quoteType)
      )?.symbol;
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
    console.log("History endpoint handled gracefully:", err.message);
    return res.json({ success: false, error: err.message, history: [] });
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
    console.error("FRED economics error:", err.message);
    return res.json({
      success: false,
      error: err.message,
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
          console.warn(`FRED FX ${seriesId} error:`, err.message);
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
    console.error("FRED currencies error:", err.message);
    return res.json({
      success: false,
      error: err.message,
      currencies: [],
    });
  }
});

// Proxy endpoint for Polymarket API focused on individual stocks, earnings, equities, and market catalysts
app.get("/api/polymarket/events", async (req, res) => {
  try {
    const search = ((req.query.search as string) || "").trim();
    const category = ((req.query.category as string) || "Stocks").trim();
    const limitNum = Math.min(50, Math.max(10, parseInt(String(req.query.limit || "30"), 10) || 30));

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

    if (search) {
      const searchUrl = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(search)}&events_status=active&limit_per_type=${limitNum}`;
      const r = await fetch(searchUrl);
      if (!r.ok) {
        throw new Error(`Polymarket search returned status ${r.status}`);
      }
      const json = await r.json();
      rawEvents = Array.isArray(json?.events) ? json.events : [];
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
      data: normalized,
    });
  } catch (err: any) {
    console.log("Polymarket events fetch handled gracefully:", err.message);
    return res.json({
      success: false,
      error: err.message,
      data: [],
    });
  }
});

// GET current keys status (masked values for privacy and security)
app.get("/api/settings/keys", (req, res) => {
  const mask = (val?: string) => {
    if (!val || val.trim() === "" || val === "MY_NYT_API_KEY" || val === "MY_NEWS_API_KEY" || val === "MY_NEWSDATA_API_KEY") return "";
    if (val.length <= 6) return "●●●●●●";
    return `${val.substring(0, 3)}●●●●●●${val.substring(val.length - 3)}`;
  };

  res.json({
    success: true,
    keys: {
      ALPHA_VANTAGE_API_KEY: customKeys.ALPHA_VANTAGE_API_KEY,
      NYT_API_KEY: customKeys.NYT_API_KEY,
      NEWS_API_KEY: customKeys.NEWS_API_KEY,
      NEWSDATA_API_KEY: customKeys.NEWSDATA_API_KEY,
      FRED_API_KEY: customKeys.FRED_API_KEY,
    },
    maskedKeys: {
      ALPHA_VANTAGE_API_KEY: mask(customKeys.ALPHA_VANTAGE_API_KEY),
      NYT_API_KEY: mask(customKeys.NYT_API_KEY),
      NEWS_API_KEY: mask(customKeys.NEWS_API_KEY),
      NEWSDATA_API_KEY: mask(customKeys.NEWSDATA_API_KEY),
      FRED_API_KEY: mask(customKeys.FRED_API_KEY),
    }
  });
});

// POST to update keys in-memory
app.post("/api/settings/keys", (req, res) => {
  const { ALPHA_VANTAGE_API_KEY, NYT_API_KEY, NEWS_API_KEY, NEWSDATA_API_KEY, FRED_API_KEY } = req.body;

  if (ALPHA_VANTAGE_API_KEY !== undefined) customKeys.ALPHA_VANTAGE_API_KEY = ALPHA_VANTAGE_API_KEY;
  if (NYT_API_KEY !== undefined) {
    customKeys.NYT_API_KEY = NYT_API_KEY;
    newsProviderCache.nyt = { timestamp: 0, items: [] };
    apiCooldowns.nyt = 0;
  }
  if (NEWS_API_KEY !== undefined) {
    customKeys.NEWS_API_KEY = NEWS_API_KEY;
    newsProviderCache.newsapi = { timestamp: 0, items: [] };
    apiCooldowns.newsapi = 0;
  }
  if (NEWSDATA_API_KEY !== undefined) {
    customKeys.NEWSDATA_API_KEY = NEWSDATA_API_KEY;
    newsProviderCache.newsdata = { timestamp: 0, items: [] };
    apiCooldowns.newsdata = 0;
  }
  if (FRED_API_KEY !== undefined) {
    customKeys.FRED_API_KEY = FRED_API_KEY;
    fredEconomicsCache = null;
    fredCurrenciesCache = null;
  }

  res.json({
    success: true,
    message: "API Keys updated in-memory successfully"
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
  const nytKey = customKeys.NYT_API_KEY;
  const newsApiKey = customKeys.NEWS_API_KEY;
  const newsdataKey = customKeys.NEWSDATA_API_KEY;
  const requestedTicker = ((req.query.ticker as string) || "").toUpperCase().trim();
  const forceRefresh = req.query.force === "true";
  const rotateMode = req.query.mode === "rotate";
  const parsedSlot = parseInt(String(req.query.slot ?? ""), 10);

  const hasNytKey = Boolean(nytKey && nytKey !== "MY_NYT_API_KEY" && nytKey.trim() !== "");
  const hasNewsApiKey = Boolean(newsApiKey && newsApiKey !== "MY_NEWS_API_KEY" && newsApiKey.trim() !== "");
  const hasNewsdataKey = Boolean(newsdataKey && newsdataKey !== "MY_NEWSDATA_API_KEY" && newsdataKey.trim() !== "");

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

  // 0. Yahoo Finance News (ONLY articles strictly related to the requested stock/asset ticker)
  if (requestedTicker) {
    const yfTicker = mapToYahooSymbol(requestedTicker);
    const yfUpper = yfTicker.toUpperCase();
    const baseTicker = yfUpper.split("-")[0].split("=")[0].replace(/^\^/, "");
    const tickerMatchSet = new Set([requestedTicker, yfUpper, baseTicker]);

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

    const aliasQuery = newsSearchAlias[requestedTicker] || newsSearchAlias[yfUpper];
    const primaryQuery = aliasQuery || yfTicker;
    const escapedBase = baseTicker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedAlias = aliasQuery ? aliasQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
    const titleTickerRegex = escapedAlias
      ? new RegExp(`(\\b${escapedBase}\\b|\\b${escapedAlias}\\b)`, "i")
      : new RegExp(`\\b${escapedBase}\\b`, "i");

    activeSources.push(`Yahoo Finance (${requestedTicker})`);
    fetchPromises.push(
      Promise.all([
        fetchYahooSearch(primaryQuery, 2, 15).then(async (resData) => {
          if (Array.isArray(resData?.news) && resData.news.length > 0) return resData;
          if (primaryQuery !== yfTicker) return fetchYahooSearch(yfTicker, 2, 15);
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
                id: `yf-${art.uuid || index}-${requestedTicker}`,
                title: art.title,
                source: publisher === "Yahoo Finance" ? "Yahoo Finance" : `${publisher} / Yahoo Finance`,
                time: formatNewsTime(publishedAt),
                symbol: requestedTicker,
                relatedTickers: Array.isArray(art.relatedTickers)
                  ? art.relatedTickers.filter((t: any) => typeof t === "string" && /^[A-Z0-9.-]{1,8}$/i.test(t))
                  : [requestedTicker],
                sentiment: analyzeNewsSentiment(`${art.title} ${intro}`),
                classification: `YAHOO FINANCE - ${requestedTicker}`,
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
            .slice(0, 10)
            .map((rssArt, index) => ({
              id: `yfrss-${rssArt.guid || index}-${requestedTicker}`,
              title: rssArt.title,
              source: "Yahoo Finance",
              time: formatNewsTime(rssArt.publishedAt),
              symbol: requestedTicker,
              relatedTickers: [requestedTicker],
              sentiment: analyzeNewsSentiment(`${rssArt.title} ${rssArt.intro}`),
              classification: `YAHOO FINANCE - ${requestedTicker}`,
              content: rssArt.intro,
              url: rssArt.link,
              publishedAt: rssArt.publishedAt,
            }));

          return [...fromSearch, ...fromRss];
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
      const r = await fetch(`https://api.nytimes.com/svc/topstories/v2/business.json?api-key=${nytKey}`);
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
        const filtered = mapped.filter((item: any) => isStockOrMarketRelated(item.title, item.content)).slice(0, 15);
        newsProviderCache.nyt = { timestamp: Date.now(), items: filtered };
        return filtered;
      }
      return newsProviderCache.nyt.items;
    } catch (err: any) {
      console.log("NYT API fetch handled gracefully:", err.message);
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
      const r = await fetch(`https://newsapi.org/v2/top-headlines?category=business&country=us&apiKey=${newsApiKey}`);
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
        const filtered = mapped.filter((item: any) => isStockOrMarketRelated(item.title, item.content)).slice(0, 15);
        newsProviderCache.newsapi = { timestamp: Date.now(), items: filtered };
        return filtered;
      }
      return newsProviderCache.newsapi.items;
    } catch (err: any) {
      console.log("News API fetch handled gracefully:", err.message);
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
      const r = await fetch(`https://newsdata.io/api/1/news?apikey=${newsdataKey}&category=business&language=en`);
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
        const filtered = mapped.filter((item: any) => isStockOrMarketRelated(item.title, item.content)).slice(0, 15);
        newsProviderCache.newsdata = { timestamp: Date.now(), items: filtered };
        return filtered;
      }
      return newsProviderCache.newsdata.items;
    } catch (err: any) {
      console.log("Newsdata.io API fetch handled gracefully:", err.message);
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
        if (parsedItems.length >= 15) break;
      }
      if (parsedItems.length > 0) {
        newsProviderCache.yahoo = { timestamp: Date.now(), items: parsedItems };
        return parsedItems;
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

    // Sort all real news by publication date descending (newest first)
    const sortedNews = [...newsItems].sort((a, b) => {
      const pubA = a.publishedAt || a.published_date || a.pubDate || '';
      const pubB = b.publishedAt || b.published_date || b.pubDate || '';
      if (!pubA) return 1;
      if (!pubB) return -1;
      return new Date(pubB).getTime() - new Date(pubA).getTime();
    });

    // Determine today's date in New York (ET), where the stock markets trade
    const nowETStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const nowET = new Date(nowETStr);
    const todayYear = nowET.getFullYear();
    const todayMonth = nowET.getMonth();
    const todayDate = nowET.getDate();

    // Filter for the current calendar date in ET (today)
    const filteredNews = sortedNews.filter(item => {
      const pubStr = item.publishedAt || item.published_date || item.pubDate;
      if (!pubStr) return false;
      try {
        const itemDate = new Date(pubStr);
        const itemETStr = itemDate.toLocaleString("en-US", { timeZone: "America/New_York" });
        const itemET = new Date(itemETStr);
        return itemET.getFullYear() === todayYear &&
               itemET.getMonth() === todayMonth &&
               itemET.getDate() === todayDate;
      } catch {
        return false;
      }
    });

    const finalNewsPool = filteredNews.length > 0 ? filteredNews : sortedNews;

    // Deduplicate headlines for the same topic (using keyword overlap)
    const deduplicatedNews: any[] = [];
    for (const art of finalNewsPool) {
      let isDup = false;
      for (const existing of deduplicatedNews) {
        const getWords = (t: string) => t.toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 3 && !['with', 'that', 'from', 'this', 'have', 'been', 'about', 'will', 'after', 'over', 'amid', 'says', 'near', 'under', 'into'].includes(w));
        
        const w1 = getWords(art.title);
        const w2 = getWords(existing.title);
        
        if (w1.length > 0 && w2.length > 0) {
          const common = w1.filter(w => w2.includes(w));
          const overlap = common.length / Math.min(w1.length, w2.length);
          if (overlap > 0.5) {
            isDup = true;
            break;
          }
        }
      }
      if (!isDup) {
        deduplicatedNews.push(art);
      }
    }

    const finalNewsSlice = deduplicatedNews.slice(0, 40);

    return res.json({
      success: true,
      sources: activeSources,
      configuredSources,
      activeSource: chosenRotationSource,
      isSimulated: false,
      data: finalNewsSlice
    });

  } catch (err: any) {
    console.error("News aggregation error:", err);
    return res.json({
      success: false,
      sources: activeSources,
      configuredSources,
      error: err.message,
      data: []
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
      console.error("Unhandled API error:", err);
      return res.status(err?.status || 500).json({
        success: false,
        error: err?.message || "Internal server error",
      });
    }
    return next(err);
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`QUORIX server running on http://localhost:${PORT}`);
  });
}

startServer();

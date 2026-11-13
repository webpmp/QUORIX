import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

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

// In-memory cooldowns to avoid spamming APIs after they report rate limits or errors
const apiCooldowns = {
  nyt: 0,
  newsapi: 0,
  newsdata: 0,
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

async function fetchFredReleaseDates(apiKey: string, limit = 25) {
  const url = `https://api.stlouisfed.org/fred/releases/dates?api_key=${encodeURIComponent(
    apiKey
  )}&file_type=json&include_release_dates_with_no_data=false&sort_order=desc&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FRED releases/dates returned status ${res.status}`);
  }
  const data = await res.json();
  const dates = Array.isArray(data?.release_dates) ? data.release_dates : [];
  return dates.map((r: any) => ({
    releaseId: r.release_id,
    releaseName: r.release_name,
    date: r.date,
  }));
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
    fetchFredReleaseDates(apiKey, 25).catch((err) => {
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

// Lazy initialize Gemini API client to prevent startup failure
let aiClient: GoogleGenAI | null = null;
let isAiKeyInvalid = false;

function getAiClient(): GoogleGenAI | null {
  if (isAiKeyInvalid) {
    return null;
  }
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : "";
    if (key && key !== "MY_GEMINI_API_KEY" && key.startsWith("AIzaSy")) {
      try {
        aiClient = new GoogleGenAI({
          apiKey: key,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });
      } catch (err) {
        console.warn("Failed to initialize GoogleGenAI client:", err);
      }
    } else {
      if (key && key !== "MY_GEMINI_API_KEY") {
        console.warn("Gemini API: Invalid key structure detected (keys should start with AIzaSy).");
        isAiKeyInvalid = true;
      }
    }
  }
  return aiClient;
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
    Format as bullet points with absolute brevity.`;
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
        temperature: 0.3,
      };

      // Enable Google Search grounding for REAL-TIME market news
      if (screen === "NEWS" || command?.toLowerCase().includes("news") || command?.toLowerCase().includes("web")) {
        config.tools = [{ googleSearch: {} }];
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
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
        modelUsed: "gemini-3.5-flash",
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (errMsg.includes("API key not valid") || errMsg.includes("API_KEY_INVALID") || err?.status === 400) {
        console.warn("Gemini API key is invalid or inactive.");
        isAiKeyInvalid = true;
        aiClient = null;
      } else {
        console.warn("Gemini API call failed:", errMsg);
      }
      return res.json({
        success: false,
        output: `LIVE AI ANALYSIS UNAVAILABLE (${errMsg}). Check GEMINI_API_KEY configuration.`,
        links: [],
        modelUsed: "unavailable",
        timestamp: new Date().toISOString(),
      });
    }
  }

  return res.json({
    success: false,
    output: "LIVE AI ANALYSIS UNAVAILABLE: GEMINI_API_KEY is not configured in the server environment.",
    links: [],
    modelUsed: "unavailable",
    timestamp: new Date().toISOString(),
  });
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

  // Only apply real pre-market or after-hours prices when provided by Yahoo Finance
  if (et.isPreMarket && cloned.isRealYF && typeof cloned.preMarketPriceYF === 'number' && cloned.preMarketPriceYF > 0) {
    isPreMarket = true;
    preMarketPrice = cloned.preMarketPriceYF;
    cloned.price = preMarketPrice;
    cloned.change = parseFloat((preMarketPrice - cloned.prevClose).toFixed(2));
    cloned.changePercent = cloned.prevClose > 0 ? parseFloat(((cloned.change / cloned.prevClose) * 100).toFixed(2)) : 0;
  } else if (et.isAfterHours && cloned.isRealYF && typeof cloned.postMarketPriceYF === 'number' && cloned.postMarketPriceYF > 0) {
    isAfterHours = true;
    afterHoursPrice = cloned.postMarketPriceYF;
    cloned.price = afterHoursPrice;
    cloned.change = parseFloat((afterHoursPrice - cloned.prevClose).toFixed(2));
    cloned.changePercent = cloned.prevClose > 0 ? parseFloat(((cloned.change / cloned.prevClose) * 100).toFixed(2)) : 0;
  }

  return {
    ...cloned,
    isPreMarket,
    isAfterHours,
    isCoreHours,
    preMarketPrice,
    afterHoursPrice,
    originalPrice: basePrice
  };
}

function mapToYahooSymbol(cacheKey: string): string {
  if (cacheKey === 'SPX') return '^GSPC';
  if (cacheKey === 'DJI') return '^DJI';
  if (cacheKey === 'IXIC') return '^IXIC';
  if (cacheKey === 'GC') return 'GC=F';
  if (cacheKey === 'CL') return 'CL=F';
  if (cacheKey === 'TNX') return '^TNX';
  if (cacheKey === 'BTC') return 'BTC-USD';
  return cacheKey;
}

function formatYahooTimestamp(tsSeconds: number, interval: string): string {
  const date = new Date(tsSeconds * 1000);
  if (['5m', '15m', '30m', '1h'].includes(interval)) {
    return date.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
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

function extractYahooBars(result: any, interval: string, maxBars = 24) {
  const timestamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const opens: any[] = Array.isArray(quote.open) ? quote.open : [];
  const highs: any[] = Array.isArray(quote.high) ? quote.high : [];
  const lows: any[] = Array.isArray(quote.low) ? quote.low : [];
  const closes: any[] = Array.isArray(quote.close) ? quote.close : [];
  const volumes: any[] = Array.isArray(quote.volume) ? quote.volume : [];

  const bars: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (typeof o === 'number' && typeof h === 'number' && typeof l === 'number' && typeof c === 'number') {
      bars.push({
        date: formatYahooTimestamp(timestamps[i], interval),
        open: parseFloat(o.toFixed(3)),
        high: parseFloat(h.toFixed(3)),
        low: parseFloat(l.toFixed(3)),
        close: parseFloat(c.toFixed(3)),
        volume: typeof volumes[i] === 'number' ? volumes[i] : 0
      });
    }
  }
  // Return newest first, capped to maxBars
  return bars.reverse().slice(0, maxBars);
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
          const price = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : 0;
          const prevClose = typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose : price;
          const change = parseFloat((price - prevClose).toFixed(cacheKey === 'TNX' ? 3 : 2));
          const changePercent = prevClose > 0 ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0;
          const history = extractYahooBars(result, '1h', 16);

          const parsedQuote = {
            symbol: cacheKey,
            open: (Array.isArray(quote.open) && typeof quote.open[0] === 'number') ? quote.open[0] : prevClose,
            high: typeof meta.regularMarketDayHigh === 'number' ? meta.regularMarketDayHigh : price,
            low: typeof meta.regularMarketDayLow === 'number' ? meta.regularMarketDayLow : price,
            price: price,
            volume: typeof meta.regularMarketVolume === 'number' ? meta.regularMarketVolume : 0,
            latestTradingDay: new Date().toISOString().split('T')[0],
            prevClose: prevClose,
            change: change,
            changePercent: changePercent,
            name: meta.longName || meta.shortName || `${cacheKey} Corp.`,
            history,
            isRealYF: true,
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
      console.warn("Yahoo Finance query failed or returned empty results, falling back to Alpha Vantage:", yfErr.message);
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
      console.warn("Alpha Vantage warning message:", data.Note || data.Information);
      
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
    console.error("Quote endpoint error:", err.message);
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

    const intervalMap: Record<string, { yfInterval: string; yfRange: string }> = {
      "5m": { yfInterval: "5m", yfRange: "1d" },
      "15m": { yfInterval: "15m", yfRange: "5d" },
      "30m": { yfInterval: "30m", yfRange: "5d" },
      "1h": { yfInterval: "1h", yfRange: "5d" },
      "1D": { yfInterval: "1d", yfRange: "3mo" },
      "1W": { yfInterval: "1wk", yfRange: "1y" },
      "1M": { yfInterval: "1mo", yfRange: "5y" },
    };

    const cfg = intervalMap[interval] || intervalMap["1h"];
    const yfSymbol = mapToYahooSymbol(symbol);
    const yfUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?interval=${cfg.yfInterval}&range=${cfg.yfRange}`;
    const yfResponse = await fetch(yfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!yfResponse.ok) {
      throw new Error(`Yahoo Finance returned status ${yfResponse.status}`);
    }

    const yfData = await yfResponse.json();
    const result = yfData?.chart?.result?.[0];
    if (!result) {
      return res.json({ success: false, error: "No historical data returned.", history: [] });
    }

    const history = extractYahooBars(result, interval, 24);
    return res.json({ success: true, symbol, interval, history });
  } catch (err: any) {
    console.error("History endpoint error:", err.message);
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

// Proxy endpoint for Polymarket API to avoid CORS issues
app.get("/api/polymarket/events", async (req, res) => {
  try {
    const { search, category, limit = "25" } = req.query;
    let url = `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=${limit}&order=volume&ascending=false`;
    
    if (search) {
      url += `&search=${encodeURIComponent(search as string)}`;
    }
    if (category) {
      url += `&category=${encodeURIComponent(category as string)}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Polymarket API returned status ${response.status}`);
    }
    const data = await response.json();
    return res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    console.error("Polymarket events fetch error:", err.message);
    return res.json({
      success: false,
      error: err.message,
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
      ALPHA_VANTAGE_API_KEY: customKeys.ALPHA_VANTAGE_API_KEY || process.env.ALPHA_VANTAGE_API_KEY || "",
      NYT_API_KEY: customKeys.NYT_API_KEY || process.env.NYT_API_KEY || "",
      NEWS_API_KEY: customKeys.NEWS_API_KEY || process.env.NEWS_API_KEY || "",
      NEWSDATA_API_KEY: customKeys.NEWSDATA_API_KEY || process.env.NEWSDATA_API_KEY || "",
      FRED_API_KEY: customKeys.FRED_API_KEY || process.env.FRED_API_KEY || "",
    },
    maskedKeys: {
      ALPHA_VANTAGE_API_KEY: mask(customKeys.ALPHA_VANTAGE_API_KEY || process.env.ALPHA_VANTAGE_API_KEY),
      NYT_API_KEY: mask(customKeys.NYT_API_KEY || process.env.NYT_API_KEY),
      NEWS_API_KEY: mask(customKeys.NEWS_API_KEY || process.env.NEWS_API_KEY),
      NEWSDATA_API_KEY: mask(customKeys.NEWSDATA_API_KEY || process.env.NEWSDATA_API_KEY),
      FRED_API_KEY: mask(customKeys.FRED_API_KEY || process.env.FRED_API_KEY),
    }
  });
});

// POST to update keys in-memory
app.post("/api/settings/keys", (req, res) => {
  const { ALPHA_VANTAGE_API_KEY, NYT_API_KEY, NEWS_API_KEY, NEWSDATA_API_KEY, FRED_API_KEY } = req.body;

  if (ALPHA_VANTAGE_API_KEY !== undefined) customKeys.ALPHA_VANTAGE_API_KEY = ALPHA_VANTAGE_API_KEY;
  if (NYT_API_KEY !== undefined) customKeys.NYT_API_KEY = NYT_API_KEY;
  if (NEWS_API_KEY !== undefined) customKeys.NEWS_API_KEY = NEWS_API_KEY;
  if (NEWSDATA_API_KEY !== undefined) customKeys.NEWSDATA_API_KEY = NEWSDATA_API_KEY;
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

function isStockOrMarketRelated(title: string, content: string): boolean {
  const fullText = `${title} ${content}`.toLowerCase();
  
  // Strict blacklist to filter out lotto, recipes, local fluff, sports, lifestyle, crime obits
  const blacklist = [
    "lotto", "lottery", "jackpot", "powerball", "mega millions", "mega-millions", "scratch-off",
    "recipe", "recipes", "how to cook", "bake", "baking", "dessert", "culinary", "delicious", "chef", "cocktail",
    "obituary", "obituaries", "funeral", "neighborhood", "traffic accident", "car crash", "local resident",
    "high school", "sports scores", "horoscope", "dating tips", "relationship advice", "best books to read",
    "lucky winner", "drawn numbers", "soup", "salad", "sauce", "kitchen", "restaurant review"
  ];
  
  for (const word of blacklist) {
    if (fullText.includes(word)) {
      return false;
    }
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
    "apple", "microsoft", "nvidia", "amazon", "alphabet", "google", "meta", "tesla", "berkshire", "broadcom", "eli lilly", "jpmorgan", "visa", "walmart", "exxon", "chevron", "intel", "amd", "tsmc"
  ];

  const hasBusinessKeyword = businessKeywords.some(keyword => fullText.includes(keyword));
  return hasBusinessKeyword;
}

function analyzeNewsSentiment(text: string): "positive" | "negative" | "neutral" {
  const lower = text.toLowerCase();
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
  return "neutral";
}

// Proxy endpoint for news aggregation from NYT, News API, and Newsdata.io
app.get("/api/news/ticker", async (req, res) => {
  const nytKey = customKeys.NYT_API_KEY || process.env.NYT_API_KEY;
  const newsApiKey = customKeys.NEWS_API_KEY || process.env.NEWS_API_KEY;
  const newsdataKey = customKeys.NEWSDATA_API_KEY || process.env.NEWSDATA_API_KEY;

  const newsItems: any[] = [];
  const activeSources: string[] = [];
  const fetchPromises: Promise<any>[] = [];

  // 1. New York Times Business Top Stories
  if (nytKey && nytKey !== "MY_NYT_API_KEY" && nytKey.trim() !== "") {
    if (Date.now() < apiCooldowns.nyt) {
      console.log("NYT Business is in cooldown. Skipping fetch.");
    } else {
      activeSources.push("NYT Business");
      fetchPromises.push(
        fetch(`https://api.nytimes.com/svc/topstories/v2/business.json?api-key=${nytKey}`)
          .then(async (r) => {
            if (r.status === 429) {
              apiCooldowns.nyt = Date.now() + 5 * 60 * 1000; // 5 min cooldown
            }
            if (!r.ok) throw new Error(`NYT status ${r.status}`);
            return r.json();
          })
          .then(data => {
            if (data && Array.isArray(data.results)) {
              const mapped = data.results.map((art: any, index: number) => ({
                id: `nyt-${index}-${Date.now()}`,
                title: art.title || "NYT Market Update",
                source: "New York Times Business",
                time: formatNewsTime(art.published_date || art.created_date),
                sentiment: analyzeNewsSentiment((art.title || "") + " " + (art.abstract || "")),
                classification: "NYT - BUSINESS",
                content: art.abstract || "",
                url: art.url || "https://www.nytimes.com/section/business",
                publishedAt: art.published_date || art.created_date || new Date().toISOString()
              }));
              // Filter strictly for stocks and market relevance
              return mapped.filter((item: any) => isStockOrMarketRelated(item.title, item.content)).slice(0, 15);
            }
            return [];
          })
          .catch(err => {
            console.warn("NYT API fetch handled gracefully:", err.message);
            return [];
          })
      );
    }
  }

  // 2. News API Top Headlines for Business
  if (newsApiKey && newsApiKey !== "MY_NEWS_API_KEY" && newsApiKey.trim() !== "") {
    if (Date.now() < apiCooldowns.newsapi) {
      console.log("News API is in cooldown. Skipping fetch.");
    } else {
      activeSources.push("News API");
      fetchPromises.push(
        fetch(`https://newsapi.org/v2/top-headlines?category=business&country=us&apiKey=${newsApiKey}`)
          .then(async (r) => {
            if (r.status === 429) {
              apiCooldowns.newsapi = Date.now() + 5 * 60 * 1000; // 5 min cooldown
            }
            if (!r.ok) throw new Error(`News API status ${r.status}`);
            return r.json();
          })
          .then(data => {
            if (data && Array.isArray(data.articles)) {
              const mapped = data.articles.map((art: any, index: number) => ({
                id: `newsapi-${index}-${Date.now()}`,
                title: art.title || "Corporate Headline",
                source: art.source?.name || "News API Business",
                time: formatNewsTime(art.publishedAt),
                sentiment: analyzeNewsSentiment((art.title || "") + " " + (art.description || "")),
                classification: "NEWSAPI - CORP",
                content: art.description || art.content || "",
                url: art.url || "https://newsapi.org",
                publishedAt: art.publishedAt || new Date().toISOString()
              }));
              // Filter strictly for stocks and market relevance
              return mapped.filter((item: any) => isStockOrMarketRelated(item.title, item.content)).slice(0, 15);
            }
            return [];
          })
          .catch(err => {
            console.warn("News API fetch handled gracefully:", err.message);
            return [];
          })
      );
    }
  }

  // 3. Newsdata.io Business News
  if (newsdataKey && newsdataKey !== "MY_NEWSDATA_API_KEY" && newsdataKey.trim() !== "") {
    if (Date.now() < apiCooldowns.newsdata) {
      console.log("Newsdata.io is in cooldown. Skipping fetch.");
    } else {
      activeSources.push("Newsdata.io");
      fetchPromises.push(
        fetch(`https://newsdata.io/api/1/news?apikey=${newsdataKey}&category=business&language=en`)
          .then(async (r) => {
            if (r.status === 429) {
              apiCooldowns.newsdata = Date.now() + 5 * 60 * 1000; // 5 min cooldown
            }
            if (!r.ok) throw new Error(`Newsdata.io status ${r.status}`);
            return r.json();
          })
          .then(data => {
            if (data && Array.isArray(data.results)) {
              const mapped = data.results.map((art: any, index: number) => ({
                id: `newsdata-${index}-${Date.now()}`,
                title: art.title || "Market Pulse",
                source: art.source_id || "Newsdata.io",
                time: formatNewsTime(art.pubDate),
                sentiment: analyzeNewsSentiment((art.title || "") + " " + (art.description || "")),
                classification: "NEWSDATA - MARKET",
                content: art.description || "",
                url: art.link || "https://newsdata.io",
                publishedAt: art.pubDate || new Date().toISOString()
              }));
              // Filter strictly for stocks and market relevance
              return mapped.filter((item: any) => isStockOrMarketRelated(item.title, item.content)).slice(0, 15);
            }
            return [];
          })
          .catch(err => {
            console.warn("Newsdata.io API fetch handled gracefully:", err.message);
            return [];
          })
      );
    }
  }

  try {
    const results = await Promise.all(fetchPromises);
    results.forEach(items => {
      if (Array.isArray(items)) {
        newsItems.push(...items);
      }
    });

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

    const finalNewsSlice = deduplicatedNews.slice(0, 30);

    return res.json({
      success: true,
      sources: activeSources,
      isSimulated: false,
      data: finalNewsSlice
    });

  } catch (err: any) {
    console.error("News aggregation error:", err);
    return res.json({
      success: false,
      error: err.message,
      data: []
    });
  }
});

// Configure Vite integration for develop and static assets for build

async function startServer() {
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

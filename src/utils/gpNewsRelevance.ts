export interface NewsItemLike {
  id?: string;
  title?: string;
  content?: string;
  source?: string;
  symbol?: string;
  relatedTickers?: string[];
  publishedAt?: string;
  url?: string;
  [key: string]: any;
}

export const GP_STRONG_ALIASES: Record<string, string[]> = {
  AAPL: ["APPLE", "TIM COOK"],
  NVDA: ["NVIDIA", "JENSEN HUANG", "JEN-HSUN HUANG", "JEN-HSUN"],
  TSLA: ["TESLA"],
  MSFT: ["MICROSOFT", "SATYA NADELLA", "SATYA"],
  GOOG: ["GOOGLE", "ALPHABET", "SUNDAR PICHAI", "PICHAI"],
  GOOGL: ["GOOGLE", "ALPHABET", "SUNDAR PICHAI", "PICHAI"],
  AMZN: ["AMAZON", "ANDY JASSY"],
  META: ["META PLATFORMS", "MARK ZUCKERBERG", "ZUCKERBERG"],
};

export const GP_WEAK_ALIASES: Record<string, string[]> = {
  AAPL: ["IPHONE", "IPAD", "MACBOOK"],
  NVDA: ["GEFORCE", "CUDA", "BLACKWELL"],
  TSLA: ["ELON MUSK", "MODEL S", "MODEL 3", "MODEL Y", "MODEL X", "CYBERTRUCK"],
  MSFT: ["WINDOWS", "AZURE", "COPILOT"],
  GOOG: ["ANDROID", "GEMINI"],
  GOOGL: ["ANDROID", "GEMINI"],
  AMZN: ["JEFF BEZOS", "AWS", "KINDLE"],
  META: ["INSTAGRAM", "WHATSAPP"],
};

// Common-word tickers that easily collide with everyday English words
export const COMMON_WORD_TICKERS = new Set([
  "A", "ALL", "AM", "AN", "AND", "ANY", "ARE", "AS", "AT", "BE", "BIG", "CAN", "CAT",
  "DO", "FOR", "GAP", "GO", "HAS", "HE", "IN", "IS", "IT", "ME", "NEW", "NO", "NOW",
  "ON", "ONE", "OR", "OUT", "SEE", "SO", "TAP", "TO", "TWO", "UP", "US", "WAS", "WE",
  "WELL", "WHO", "WHY", "YOU"
]);

// Ambiguous company names that easily false-match general nouns/verbs
export const AMBIGUOUS_COMPANY_NAMES = new Set([
  "TARGET", "BLOCK", "SNAP", "VISA", "GAP", "MATCH", "FORD", "SQUARE", "BEST", "BOX",
  "KEYS", "NEXT", "OPEN", "PLAY", "POOL", "REAL", "ROOT", "SEAT", "TRUE", "EVER"
]);

export function getActiveTickerGroup(ticker: string): string[] {
  const upper = (ticker || "").toUpperCase().trim();
  if (upper === "GOOG" || upper === "GOOGL") return ["GOOG", "GOOGL"];
  return [upper];
}

/**
 * Normalizes company name from quote data:
 * Strips Inc/Corp/Holdings/Ltd/plc/Co./Class X, punctuation, extra whitespace.
 * Returns null if the normalized name is in AMBIGUOUS_COMPANY_NAMES.
 */
export function normalizeCompanyName(rawName?: string): string | null {
  if (!rawName || typeof rawName !== "string") return null;
  let clean = rawName
    .replace(/[,.]/g, " ")
    .replace(/\b(Inc|Incorporated|Corp|Corporation|Holdings|Holding|Ltd|Limited|plc|PLC|Co|Company|Class\s+[A-Z]|Cl\s+[A-Z])\b/gi, " ")
    .replace(/^(The\s+)/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return null;
  const upper = clean.toUpperCase();
  if (AMBIGUOUS_COMPANY_NAMES.has(upper)) {
    return null;
  }
  return clean;
}

/**
 * Match ticker:
 * - If ticker length <= 2 or on COMMON_WORD_TICKERS list:
 *     Matches ONLY in $T, (T), or EXCHANGE:T form (e.g. NASDAQ:T, NYSE:T).
 * - Otherwise:
 *     Matches $T, (T), EXCHANGE:T, or uppercase standalone \bTICKER\b.
 */
export function matchTickerExact(text: string, ticker: string): boolean {
  if (!text || !ticker) return false;
  const upperT = ticker.toUpperCase().trim();
  const escaped = upperT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const isShortOrCommon = upperT.length <= 2 || COMMON_WORD_TICKERS.has(upperT);

  if (isShortOrCommon) {
    // Only $T, (T), or EXCHANGE:T (e.g., NASDAQ:T, NYSE:T)
    const strictPattern = new RegExp(`(\\$${escaped}\\b|\\(${escaped}\\)|[A-Z]{3,8}:${escaped}\\b)`);
    return strictPattern.test(text);
  }

  // General ticker: $T, (T), EXCHANGE:T, or standalone uppercase ticker
  const standardPattern = new RegExp(`(\\$${escaped}\\b|\\(${escaped}\\)|[A-Z]{3,8}:${escaped}\\b|(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9]))`);
  return standardPattern.test(text);
}

/**
 * Match tokens with word boundaries.
 * Case-sensitive match for "META" when used bare; case-insensitive for others.
 */
export function matchTokensWordBoundary(text: string, tokens: string[]): boolean {
  if (!text || !tokens || tokens.length === 0) return false;
  return tokens.some((tok) => {
    if (!tok) return false;
    const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (tok === "META") {
      // Case-sensitive for bare META so lowercase "meta" doesn't match
      const metaRegex = new RegExp(`\\b${escaped}\\b`);
      return metaRegex.test(text);
    }
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    return regex.test(text);
  });
}

/**
 * Syndicated market report drop rule:
 * Wire source (GlobeNewswire, PR Newswire, Business Wire, MarketWatch, etc.)
 * PLUS title containing market/report/forecast/CAGR/"USD X Billion".
 */
export function isSyndicatedMarketReport(title: string, source: string): boolean {
  const normSource = (source || "").toLowerCase();
  const isWire =
    normSource.includes("globenewswire") ||
    normSource.includes("pr newswire") ||
    normSource.includes("prnewswire") ||
    normSource.includes("business wire") ||
    normSource.includes("businesswire") ||
    normSource.includes("newsfile") ||
    normSource.includes("accesswire");

  if (!isWire) return false;

  const normTitle = (title || "").toLowerCase();
  const hasSpamKeyword =
    /\b(market\s+report|size,\s*share|trends,\s*and\s*forecast|cagr|forecast\s+to\s+20\d\d)\b/i.test(normTitle) ||
    /usd\s+\d+(\.\d+)?\s*(billion|million|trillion)/i.test(normTitle);

  return hasSpamKeyword;
}

export function scoreArticleForTicker(
  item: NewsItemLike,
  targetTicker: string,
  companyNameFromStock?: string
): 0 | 1 | 2 {
  const title = item.title || "";
  const content = item.content || "";
  const source = item.source || "";

  // 1. Drop syndicated market reports immediately
  if (isSyndicatedMarketReport(title, source)) {
    return 0;
  }

  const group = getActiveTickerGroup(targetTicker);

  // Strong aliases: ticker itself, company name, CEO, or curated strong aliases
  const strongTokens: string[] = [];
  group.forEach((t) => {
    if (GP_STRONG_ALIASES[t]) {
      strongTokens.push(...GP_STRONG_ALIASES[t]);
    }
  });

  const normCompanyName = normalizeCompanyName(companyNameFromStock);
  if (normCompanyName) {
    strongTokens.push(normCompanyName);
  }

  // Weak aliases: product words (Windows, Azure, Gemini, iPhone, etc.) and CEOs moved to weak (Elon Musk, Jeff Bezos)
  const weakTokens: string[] = [];
  group.forEach((t) => {
    if (GP_WEAK_ALIASES[t]) {
      weakTokens.push(...GP_WEAK_ALIASES[t]);
    }
  });

  // Check if ticker is in relatedTickers
  const hasTickerInRelated =
    Array.isArray(item.relatedTickers) &&
    item.relatedTickers.some((t) => group.includes(String(t).toUpperCase().trim()));

  // Check Title
  const tickerInTitle = group.some((t) => matchTickerExact(title, t));
  const strongInTitle = matchTokensWordBoundary(title, strongTokens);

  // Tier 1: Strong alias, company name, or exact ticker appears in Title
  if (tickerInTitle || strongInTitle) {
    return 1;
  }

  // Tier 2:
  // a) Strong alias or exact ticker appears in Content
  const tickerInContent = group.some((t) => matchTickerExact(content, t));
  const strongInContent = matchTokensWordBoundary(content, strongTokens);
  if (tickerInContent || strongInContent) {
    return 2;
  }

  // b) Weak alias in Title or Content ONLY WHEN ticker is also in relatedTickers
  if (hasTickerInRelated) {
    const weakInTitle = matchTokensWordBoundary(title, weakTokens);
    const weakInContent = matchTokensWordBoundary(content, weakTokens);
    if (weakInTitle || weakInContent) {
      return 2;
    }
  }

  return 0; // Drop everything else (tag-only relatedTickers dropped)
}

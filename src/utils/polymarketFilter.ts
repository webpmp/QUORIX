export interface PolymarketTagLike {
  slug?: string;
  label?: string;
}

export interface PolymarketMarketLike {
  id?: string;
  question?: string;
  title?: string;
  slug?: string;
  groupItemTitle?: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
}

export interface PolymarketEventLike<M extends PolymarketMarketLike = PolymarketMarketLike> {
  id?: string;
  title?: string;
  name?: string;
  slug?: string;
  description?: string;
  category?: string;
  volume?: number;
  active?: boolean;
  closed?: boolean;
  tags?: Array<PolymarketTagLike | string>;
  markets?: M[];
}

export interface TickerCompanyProfile {
  canonicalTicker: string;
  displayName?: string;
  tickerAliases: string[];
  tagSlugs: string[];
  searchQueries: string[];
  companyNames: string[];
  /** Terms that require capitalized or explicit company/equity context to avoid generic prose false positives. */
  caseSensitiveTerms?: string[];
  /** Explicit phrases/terms that must never be treated as a match for this company. */
  excludedTerms?: string[];
}

export const TICKER_COMPANY_PROFILES: Record<string, TickerCompanyProfile> = {
  META: {
    canonicalTicker: 'META',
    displayName: 'Meta Platforms, Inc.',
    tickerAliases: ['META'],
    tagSlugs: ['meta', 'meta-platforms', 'facebook'],
    searchQueries: ['META', 'Meta Platforms'],
    companyNames: [
      'Meta Platforms',
      'Meta Platforms, Inc.',
      'Meta Platforms Inc',
      'Facebook',
      'Instagram',
      'WhatsApp',
    ],
    caseSensitiveTerms: ['Meta', 'Llama'],
    excludedTerms: ['MetaMask', 'meta-analysis', 'meta analysis'],
  },
  NVDA: {
    canonicalTicker: 'NVDA',
    displayName: 'NVIDIA Corporation',
    tickerAliases: ['NVDA'],
    tagSlugs: ['nvda', 'nvidia'],
    searchQueries: ['NVDA', 'NVIDIA'],
    companyNames: ['NVIDIA', 'Nvidia', 'Nvidia Corporation', 'Nvidia Corp'],
  },
  GOOG: {
    canonicalTicker: 'GOOG',
    displayName: 'Alphabet Inc.',
    tickerAliases: ['GOOG', 'GOOGL'],
    tagSlugs: ['goog', 'googl', 'alphabet', 'google', 'deepmind', 'youtube', 'waymo'],
    searchQueries: ['GOOGL', 'Alphabet', 'GOOG'],
    companyNames: [
      'Alphabet',
      'Alphabet Inc',
      'Alphabet Inc.',
      'Google',
      'Google Cloud',
      'Google DeepMind',
      'DeepMind',
      'YouTube',
      'Waymo',
    ],
  },
  GOOGL: {
    canonicalTicker: 'GOOGL',
    displayName: 'Alphabet Inc.',
    tickerAliases: ['GOOGL', 'GOOG'],
    tagSlugs: ['googl', 'goog', 'alphabet', 'google', 'deepmind', 'youtube', 'waymo'],
    searchQueries: ['GOOGL', 'Alphabet', 'GOOG'],
    companyNames: [
      'Alphabet',
      'Alphabet Inc',
      'Alphabet Inc.',
      'Google',
      'Google Cloud',
      'Google DeepMind',
      'DeepMind',
      'YouTube',
      'Waymo',
    ],
  },
  MSFT: {
    canonicalTicker: 'MSFT',
    displayName: 'Microsoft Corporation',
    tickerAliases: ['MSFT'],
    tagSlugs: ['msft', 'microsoft'],
    searchQueries: ['MSFT', 'Microsoft'],
    companyNames: ['Microsoft', 'Microsoft Corporation', 'Microsoft Corp', 'Azure'],
  },
  AAPL: {
    canonicalTicker: 'AAPL',
    displayName: 'Apple Inc.',
    tickerAliases: ['AAPL'],
    tagSlugs: ['aapl', 'apple'],
    searchQueries: ['AAPL', 'Apple'],
    companyNames: ['Apple Inc', 'Apple Inc.', 'iPhone'],
    caseSensitiveTerms: ['Apple'],
  },
  AMZN: {
    canonicalTicker: 'AMZN',
    displayName: 'Amazon.com, Inc.',
    tickerAliases: ['AMZN'],
    tagSlugs: ['amzn', 'amazon', 'aws'],
    searchQueries: ['AMZN', 'Amazon'],
    companyNames: ['Amazon', 'Amazon.com', 'Amazon.com, Inc.', 'Amazon Web Services'],
    caseSensitiveTerms: ['AWS'],
  },
  TSLA: {
    canonicalTicker: 'TSLA',
    displayName: 'Tesla, Inc.',
    tickerAliases: ['TSLA'],
    tagSlugs: ['tsla', 'tesla'],
    searchQueries: ['TSLA', 'Tesla'],
    companyNames: ['Tesla', 'Tesla, Inc.', 'Tesla Inc', 'Tesla Motors', 'Cybertruck'],
  },
  CRWD: {
    canonicalTicker: 'CRWD',
    displayName: 'CrowdStrike Holdings Inc.',
    tickerAliases: ['CRWD'],
    tagSlugs: ['crwd', 'crowdstrike'],
    searchQueries: ['CRWD', 'CrowdStrike', 'CrowdStrike Holdings'],
    companyNames: [
      'CrowdStrike',
      'CrowdStrike Holdings',
      'CrowdStrike Holdings Inc',
      'CrowdStrike Holdings Inc.',
      'CrowdStrike Holdings, Inc.',
    ],
  },
  AMD: {
    canonicalTicker: 'AMD',
    displayName: 'Advanced Micro Devices, Inc.',
    tickerAliases: ['AMD'],
    tagSlugs: ['amd'],
    searchQueries: ['AMD', 'Advanced Micro Devices'],
    companyNames: ['Advanced Micro Devices'],
  },
  PLTR: {
    canonicalTicker: 'PLTR',
    displayName: 'Palantir Technologies Inc.',
    tickerAliases: ['PLTR'],
    tagSlugs: ['pltr', 'palantir'],
    searchQueries: ['PLTR', 'Palantir'],
    companyNames: ['Palantir', 'Palantir Technologies'],
  },
  NFLX: {
    canonicalTicker: 'NFLX',
    displayName: 'Netflix, Inc.',
    tickerAliases: ['NFLX'],
    tagSlugs: ['nflx', 'netflix'],
    searchQueries: ['NFLX', 'Netflix'],
    companyNames: ['Netflix'],
  },
  COIN: {
    canonicalTicker: 'COIN',
    displayName: 'Coinbase Global, Inc.',
    tickerAliases: ['COIN'],
    tagSlugs: ['coin', 'coinbase'],
    searchQueries: ['COIN', 'Coinbase'],
    companyNames: ['Coinbase', 'Coinbase Global'],
  },
  MSTR: {
    canonicalTicker: 'MSTR',
    displayName: 'MicroStrategy Incorporated',
    tickerAliases: ['MSTR'],
    tagSlugs: ['mstr', 'microstrategy', 'strategy'],
    searchQueries: ['MSTR', 'MicroStrategy'],
    companyNames: ['MicroStrategy'],
  },
  INTC: {
    canonicalTicker: 'INTC',
    displayName: 'Intel Corporation',
    tickerAliases: ['INTC'],
    tagSlugs: ['intc', 'intel'],
    searchQueries: ['INTC', 'Intel'],
    companyNames: ['Intel', 'Intel Corporation'],
  },
  ORCL: {
    canonicalTicker: 'ORCL',
    displayName: 'Oracle Corporation',
    tickerAliases: ['ORCL'],
    tagSlugs: ['orcl', 'oracle'],
    searchQueries: ['ORCL', 'Oracle'],
    companyNames: ['Oracle', 'Oracle Corporation'],
  },
  CRM: {
    canonicalTicker: 'CRM',
    displayName: 'Salesforce, Inc.',
    tickerAliases: ['CRM'],
    tagSlugs: ['crm', 'salesforce'],
    searchQueries: ['CRM', 'Salesforce'],
    companyNames: ['Salesforce'],
  },
  AVGO: {
    canonicalTicker: 'AVGO',
    displayName: 'Broadcom Inc.',
    tickerAliases: ['AVGO'],
    tagSlugs: ['avgo', 'broadcom'],
    searchQueries: ['AVGO', 'Broadcom'],
    companyNames: ['Broadcom'],
  },
  BABA: {
    canonicalTicker: 'BABA',
    displayName: 'Alibaba Group Holding Limited',
    tickerAliases: ['BABA'],
    tagSlugs: ['baba', 'alibaba'],
    searchQueries: ['BABA', 'Alibaba'],
    companyNames: ['Alibaba', 'Alibaba Group'],
  },
  TSM: {
    canonicalTicker: 'TSM',
    displayName: 'Taiwan Semiconductor Manufacturing Company',
    tickerAliases: ['TSM'],
    tagSlugs: ['tsm', 'tsmc'],
    searchQueries: ['TSM', 'TSMC'],
    companyNames: ['TSMC', 'Taiwan Semiconductor'],
  },
  UBER: {
    canonicalTicker: 'UBER',
    displayName: 'Uber Technologies, Inc.',
    tickerAliases: ['UBER'],
    tagSlugs: ['uber'],
    searchQueries: ['UBER', 'Uber'],
    companyNames: ['Uber', 'Uber Technologies'],
  },
  HOOD: {
    canonicalTicker: 'HOOD',
    displayName: 'Robinhood Markets, Inc.',
    tickerAliases: ['HOOD'],
    tagSlugs: ['hood', 'robinhood'],
    searchQueries: ['HOOD', 'Robinhood'],
    companyNames: ['Robinhood'],
  },
  WMT: {
    canonicalTicker: 'WMT',
    displayName: 'Walmart Inc.',
    tickerAliases: ['WMT'],
    tagSlugs: ['wmt', 'walmart'],
    searchQueries: ['WMT', 'Walmart'],
    companyNames: ['Walmart'],
  },
  DIS: {
    canonicalTicker: 'DIS',
    displayName: 'The Walt Disney Company',
    tickerAliases: ['DIS'],
    tagSlugs: ['dis', 'disney'],
    searchQueries: ['DIS', 'Disney'],
    companyNames: ['Disney', 'Walt Disney'],
  },
  JPM: {
    canonicalTicker: 'JPM',
    displayName: 'JPMorgan Chase & Co.',
    tickerAliases: ['JPM'],
    tagSlugs: ['jpm', 'jpmorgan'],
    searchQueries: ['JPM', 'JPMorgan'],
    companyNames: ['JPMorgan', 'JP Morgan', 'JPMorgan Chase'],
  },
  WULF: {
    canonicalTicker: 'WULF',
    displayName: 'TeraWulf Inc.',
    tickerAliases: ['WULF'],
    tagSlugs: ['wulf', 'terawulf'],
    searchQueries: ['WULF', 'TeraWulf'],
    companyNames: ['TeraWulf'],
  },
};

/**
 * Distinct public companies and private AI labs commonly listed as separate
 * contracts inside multi-company Polymarket race/leaderboard events.
 */
const DISTINCT_COMPANY_ENTITY_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'META', pattern: /(?<![A-Za-z0-9])(?:Meta Platforms|Meta|Facebook)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'NVDA', pattern: /(?<![A-Za-z0-9])(?:NVIDIA|NVDA)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'GOOG', pattern: /(?<![A-Za-z0-9])(?:Alphabet|Google|DeepMind|GOOGL|GOOG)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'MSFT', pattern: /(?<![A-Za-z0-9])(?:Microsoft|MSFT)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'AAPL', pattern: /(?<![A-Za-z0-9])(?:Apple|AAPL)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'AMZN', pattern: /(?<![A-Za-z0-9])(?:Amazon|AMZN)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'TSLA', pattern: /(?<![A-Za-z0-9])(?:Tesla|TSLA)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'OPENAI', pattern: /(?<![A-Za-z0-9])OpenAI(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'ANTHROPIC', pattern: /(?<![A-Za-z0-9])Anthropic(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'DEEPSEEK', pattern: /(?<![A-Za-z0-9])DeepSeek(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'XAI', pattern: /(?<![A-Za-z0-9])(?:xAI|SpaceXAI|Grok)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'ZAI', pattern: /(?<![A-Za-z0-9])Z\.ai(?![A-Za-z0-9])/i },
  { id: 'BABA', pattern: /(?<![A-Za-z0-9])(?:Alibaba|Qwen|BABA)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'MOONSHOT', pattern: /(?<![A-Za-z0-9])Moonshot(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'MISTRAL', pattern: /(?<![A-Za-z0-9])Mistral(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'COHERE', pattern: /(?<![A-Za-z0-9])Cohere(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'TENCENT', pattern: /(?<![A-Za-z0-9])Tencent(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'BAIDU', pattern: /(?<![A-Za-z0-9])Baidu(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'BYTEDANCE', pattern: /(?<![A-Za-z0-9])ByteDance(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'PERPLEXITY', pattern: /(?<![A-Za-z0-9])Perplexity(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'ARAMCO', pattern: /(?<![A-Za-z0-9])Saudi Aramco(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'AVGO', pattern: /(?<![A-Za-z0-9])(?:Broadcom|AVGO)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'TSM', pattern: /(?<![A-Za-z0-9])(?:TSMC|Taiwan Semiconductor)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'BRK', pattern: /(?<![A-Za-z0-9])Berkshire Hathaway(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'LLY', pattern: /(?<![A-Za-z0-9])Eli Lilly(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'WMT', pattern: /(?<![A-Za-z0-9])Walmart(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'AMD', pattern: /(?<![A-Za-z0-9])(?:AMD|Advanced Micro Devices)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'ORCL', pattern: /(?<![A-Za-z0-9])Oracle(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'NFLX', pattern: /(?<![A-Za-z0-9])Netflix(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'PLTR', pattern: /(?<![A-Za-z0-9])Palantir(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'CRWD', pattern: /(?<![A-Za-z0-9])(?:CrowdStrike|CRWD)(?:['’]s)?(?![A-Za-z0-9])/i },
  { id: 'MINIMAX', pattern: /(?<![A-Za-z0-9])MiniMax(?:['’]s)?(?![A-Za-z0-9])/i },
];

const MULTI_COMPANY_TITLE_REGEX =
  /\b(which company|largest company|2nd largest|3rd largest|second[- ]largest|third[- ]largest|most valuable company|biggest company|best ai model|best math ai|best text arena|ai agent lab|code arena|openrouter market share|ai lab by|top ai model|third-best .* ai)\b/i;

const GOOGLE_SEARCH_TRIVIA_TITLE_REGEX =
  /(?:#\d+|most|top)\s+searched\s+.+\bon\s+google\b/i;

const FINANCIAL_OR_CORPORATE_TAG_SLUGS = new Set([
  'stocks',
  'equities',
  'finance',
  'earnings',
  'market-cap',
  'hit-price',
  'multi-strikes',
  'ipos',
  'ipo',
  'acquisitions',
  'big-tech',
  'corporate-financials',
  'ai',
  'ai-rankings',
  'ai-releases',
  'ai-benchmarks',
  'stock-prices',
  'up-or-down',
]);

const NON_CORPORATE_TRIVIA_TAG_SLUGS = new Set([
  'pop-culture',
  'celebrities',
  'movies',
  'sports',
  'games',
  'google-search',
  'best-of-2026',
  'best-of-2025',
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanCompanyNameSuffixes(name: string): string {
  return name
    .replace(/\b(Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|PLC|N\.V\.|Holdings?|Group|Co\.?|Company|Class [A-Z])\b/gi, '')
    .replace(/[,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeFilterTicker(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().toUpperCase();
}

/**
 * Resolves a canonical ticker filter when either an explicit `ticker` param is supplied
 * or a user submits a known equity ticker symbol in the search input.
 */
export function resolveTickerFromQuery(
  explicitTicker?: string,
  searchQuery?: string,
): string {
  const cleanExplicit = normalizeFilterTicker(explicitTicker);
  if (cleanExplicit) return cleanExplicit;

  const cleanSearch = normalizeFilterTicker(searchQuery);
  if (cleanSearch && cleanSearch in TICKER_COMPANY_PROFILES) {
    return cleanSearch;
  }
  return '';
}

/**
 * Returns the structured company/ticker matching profile for a ticker symbol.
 * Supports built-in profiles and safe strict fallbacks for any user-added custom ticker.
 */
export function getTickerCompanyProfile(
  rawTicker: string,
  optionalCompanyName?: string,
): TickerCompanyProfile {
  const ticker = normalizeFilterTicker(rawTicker);
  const existing = TICKER_COMPANY_PROFILES[ticker];
  if (existing) {
    if (optionalCompanyName && !existing.displayName) {
      return { ...existing, displayName: optionalCompanyName.trim() };
    }
    return existing;
  }

  const trimmedName = typeof optionalCompanyName === 'string' ? optionalCompanyName.trim() : '';
  const cleanedName = trimmedName ? cleanCompanyNameSuffixes(trimmedName) : '';
  const companyNames = Array.from(
    new Set(
      [trimmedName, cleanedName].filter((n) => n && n.length >= 3 && n.toUpperCase() !== ticker),
    ),
  );
  const tagSlugs = Array.from(
    new Set(
      [
        ticker ? ticker.toLowerCase() : '',
        cleanedName && cleanedName.length >= 3
          ? cleanedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          : '',
      ].filter(Boolean),
    ),
  );
  const searchQueries = Array.from(
    new Set([ticker, cleanedName || trimmedName].filter((q) => q && q.length > 0)),
  );

  return {
    canonicalTicker: ticker,
    displayName: trimmedName || undefined,
    tickerAliases: ticker ? [ticker] : [],
    tagSlugs,
    searchQueries,
    companyNames,
  };
}

export function extractEventTagSlugs(ev?: PolymarketEventLike | null): string[] {
  if (!ev || !Array.isArray(ev.tags)) return [];
  return ev.tags
    .map((t) => {
      if (typeof t === 'string') return t.trim().toLowerCase();
      return String(t?.slug || t?.label || '').trim().toLowerCase();
    })
    .filter(Boolean);
}

function stripExcludedTerms(text: string, excludedTerms?: string[]): string {
  if (!text || !excludedTerms || excludedTerms.length === 0) return text;
  let cleaned = text;
  for (const term of excludedTerms) {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(term)}(?![A-Za-z0-9])`, 'gi');
    cleaned = cleaned.replace(re, ' ');
  }
  return cleaned;
}

function matchesWholeTerm(text: string, term: string, caseSensitive: boolean): boolean {
  if (!text || !term) return false;
  const escaped = escapeRegex(term);
  const re = new RegExp(
    `(?<![A-Za-z0-9])${escaped}(?:['’]s)?(?![A-Za-z0-9])`,
    caseSensitive ? '' : 'i',
  );
  return re.test(text);
}

function matchesTickerAlias(text: string, alias: string): boolean {
  if (!text || !alias) return false;
  const escaped = escapeRegex(alias);
  // 1. Explicit financial ticker notation (case-insensitive): "(META)", "$META", "(GOOGL)"
  const explicitNotation = new RegExp(
    `(?:\\(\\s*${escaped}\\s*\\)|\\$${escaped}(?![A-Za-z0-9]))`,
    'i',
  );
  if (explicitNotation.test(text)) return true;

  // 2. Standalone uppercase ticker token (case-sensitive to prevent matching lowercase English words)
  const exactUpperToken = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`);
  return exactUpperToken.test(text);
}

/**
 * Checks whether a single text string explicitly references the target ticker/company
 * using strict entity boundaries rather than loose substring matching.
 */
export function textMatchesTickerProfile(
  rawText: string,
  profile: TickerCompanyProfile,
): boolean {
  if (!rawText || typeof rawText !== 'string') return false;
  const text = stripExcludedTerms(rawText, profile.excludedTerms);

  for (const alias of profile.tickerAliases) {
    if (matchesTickerAlias(text, alias)) return true;
  }

  for (const name of profile.companyNames) {
    if (matchesWholeTerm(text, name, false)) return true;
  }

  if (profile.caseSensitiveTerms) {
    for (const term of profile.caseSensitiveTerms) {
      if (matchesWholeTerm(text, term, true)) return true;
    }
  }

  return false;
}

function getTargetCanonicalGroup(profile: TickerCompanyProfile): string {
  if (profile.canonicalTicker === 'GOOGL') return 'GOOG';
  return profile.canonicalTicker;
}

/**
 * Extracts all distinct known company/lab entity IDs referenced in a text string.
 */
function detectEntityIdsInText(text: string): Set<string> {
  const ids = new Set<string>();
  if (!text) return ids;
  const cleaned = text.replace(/(?<![A-Za-z0-9])MetaMask(?![A-Za-z0-9])/gi, ' ');
  for (const entry of DISTINCT_COMPANY_ENTITY_PATTERNS) {
    if (entry.pattern.test(cleaned)) {
      ids.add(entry.id);
    }
  }
  return ids;
}

/**
 * Determines whether an event is a multi-company comparison/race/leaderboard event
 * (e.g., "Which company has best AI model?" or "Largest Company end of November?")
 * whose individual contracts each belong to different companies.
 */
export function isMultiCompanyPolymarketEvent(ev: PolymarketEventLike): boolean {
  const title = String(ev?.title || ev?.name || '');
  if (MULTI_COMPANY_TITLE_REGEX.test(title)) {
    return true;
  }

  const markets = Array.isArray(ev?.markets) ? ev.markets : [];
  if (markets.length < 2) return false;

  const distinctEntitiesAcrossContracts = new Set<string>();
  for (const m of markets) {
    const contractText = `${m?.groupItemTitle || ''} ${m?.question || m?.title || ''}`;
    const entities = detectEntityIdsInText(contractText);
    for (const id of entities) {
      distinctEntitiesAcrossContracts.add(id);
      if (distinctEntitiesAcrossContracts.size >= 2) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks whether an individual contract/market explicitly references the target ticker/company.
 */
export function doesContractMatchTickerProfile(
  market: PolymarketMarketLike,
  profile: TickerCompanyProfile,
  allowSlugFallback = false,
): boolean {
  const question = String(market?.question || market?.title || '');
  const groupItem = String(market?.groupItemTitle || '');

  if (textMatchesTickerProfile(groupItem, profile)) return true;
  if (textMatchesTickerProfile(question, profile)) return true;

  // Only check lowercase hyphen-delimited ticker tokens in slug when event has equity/corporate/AI context
  if (allowSlugFallback) {
    const slug = String(market?.slug || '').toLowerCase();
    if (slug) {
      for (const alias of profile.tickerAliases) {
        const aliasLower = alias.toLowerCase();
        if (aliasLower.length >= 3) {
          const slugTokenRe = new RegExp(`(?:^|-)${escapeRegex(aliasLower)}(?:-|$)`);
          if (slugTokenRe.test(slug)) {
            const excludedHit = (profile.excludedTerms || []).some((ex) =>
              slug.includes(ex.toLowerCase()),
            );
            if (!excludedHit) return true;
          }
        }
      }
    }
  }

  return false;
}

function doesContractNameCompetingEntityOnly(
  market: PolymarketMarketLike,
  profile: TickerCompanyProfile,
): boolean {
  if (doesContractMatchTickerProfile(market, profile)) return false;
  const contractText = `${market?.groupItemTitle || ''} ${market?.question || market?.title || ''}`;
  const entities = detectEntityIdsInText(contractText);
  const targetId = getTargetCanonicalGroup(profile);
  for (const id of entities) {
    if (id !== targetId) return true;
  }
  return false;
}

function isNonCompanyPopCultureTrivia(ev: PolymarketEventLike): boolean {
  const title = String(ev?.title || ev?.name || '');
  const slugs = extractEventTagSlugs(ev);
  const hasFinancialOrAiTag = slugs.some((s) => FINANCIAL_OR_CORPORATE_TAG_SLUGS.has(s));
  const hasTriviaTag = slugs.some((s) => NON_CORPORATE_TRIVIA_TAG_SLUGS.has(s));

  if (GOOGLE_SEARCH_TRIVIA_TITLE_REGEX.test(title) && !hasFinancialOrAiTag) {
    return true;
  }
  if (hasTriviaTag && !hasFinancialOrAiTag && /\bsearched\b.*\bgoogle\b/i.test(title)) {
    return true;
  }
  return false;
}

function hasCorporateOrMarketContext(ev: PolymarketEventLike): boolean {
  const slugs = extractEventTagSlugs(ev);
  return slugs.some((s) => FINANCIAL_OR_CORPORATE_TAG_SLUGS.has(s) || s === 'tech' || s === 'business');
}

function doesEventDirectlyMatchProfile(
  ev: PolymarketEventLike,
  profile: TickerCompanyProfile,
): boolean {
  const title = String(ev?.title || ev?.name || '');
  if (textMatchesTickerProfile(title, profile)) return true;

  // Structured tag and slug matching requires corporate/equity/tech/AI context
  // so common English words (e.g. weather "snow" for ticker SNOW) cannot false-match.
  if (!hasCorporateOrMarketContext(ev)) return false;

  const slugs = extractEventTagSlugs(ev);
  if (slugs.some((slug) => profile.tagSlugs.includes(slug))) {
    return true;
  }

  const evSlug = String(ev?.slug || '').toLowerCase();
  if (evSlug) {
    for (const tagSlug of profile.tagSlugs) {
      if (tagSlug.length >= 3) {
        const re = new RegExp(`(?:^|-)${escapeRegex(tagSlug)}(?:-|$)`);
        if (re.test(evSlug)) return true;
      }
    }
  }

  return false;
}

export interface FilterByTickerOptions {
  companyName?: string;
}

/**
 * Strictly filters Polymarket events and their individual contracts to only those
 * genuinely associated with the selected ticker/company.
 *
 * - Single-company events dedicated to the target retain their strike/date contracts
 *   (excluding any contract that explicitly names an unrelated competing company).
 * - Multi-company events (e.g. "Which company has best AI model?", "Largest Company?")
 *   are filtered at the individual contract level so ONLY contracts belonging to the
 *   selected company remain.
 * - Events with zero matching contracts are excluded completely.
 */
export function filterPolymarketEventsByTicker<
  M extends PolymarketMarketLike,
  E extends PolymarketEventLike<M>,
>(
  events: E[],
  rawTicker: string,
  options?: FilterByTickerOptions,
): E[] {
  const ticker = normalizeFilterTicker(rawTicker);
  if (!ticker || !Array.isArray(events)) {
    return Array.isArray(events) ? events : [];
  }

  const profile = getTickerCompanyProfile(ticker, options?.companyName);
  const filteredEvents: E[] = [];

  for (const ev of events) {
    if (!ev || ev.closed === true) continue;
    if (isNonCompanyPopCultureTrivia(ev)) continue;

    const markets = Array.isArray(ev.markets) ? ev.markets : [];
    if (markets.length === 0) continue;

    const multiCompany = isMultiCompanyPolymarketEvent(ev);
    const corporateContext = hasCorporateOrMarketContext(ev);
    const eventDedicatedMatch = !multiCompany && doesEventDirectlyMatchProfile(ev, profile);

    const matchingMarkets = markets.filter((market) => {
      if (!market) return false;
      if (doesContractMatchTickerProfile(market, profile, corporateContext)) {
        return true;
      }
      if (eventDedicatedMatch && !doesContractNameCompetingEntityOnly(market, profile)) {
        return true;
      }
      return false;
    });

    if (matchingMarkets.length === 0) continue;

    filteredEvents.push({
      ...ev,
      markets: matchingMarkets,
    });
  }

  return filteredEvents;
}

export interface LatestRequestGuard {
  next(): { requestId: number; signal: AbortSignal };
  isCurrent(requestId: number): boolean;
  abortAll(): void;
}

/**
 * Coordinates request sequence numbers and AbortControllers so stale or slower
 * asynchronous responses can never overwrite results for a newer ticker selection.
 */
export function createLatestRequestGuard(): LatestRequestGuard {
  let seq = 0;
  let activeController: AbortController | null = null;

  return {
    next() {
      seq += 1;
      if (activeController) {
        activeController.abort();
      }
      activeController = new AbortController();
      return { requestId: seq, signal: activeController.signal };
    },
    isCurrent(requestId: number) {
      return requestId === seq;
    },
    abortAll() {
      seq += 1;
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
    },
  };
}

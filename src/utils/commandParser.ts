export interface CommandDefinition {
  code: string;
  name: string;
  desc: string;
  category: 'Tools' | 'Information' | 'Equities' | 'Macro';
  aliases?: string[];
}

export const COMMAND_DEFINITIONS: CommandDefinition[] = [
  { code: 'ASK', name: 'ASK QUORIX', desc: 'Consult AI analyst', category: 'Tools', aliases: ['BWRITE', 'AI', 'QI'] },
  { code: 'NEWS', name: 'NEWS HUB', desc: 'Real-time grounding', category: 'Information', aliases: ['NEWS'] },
  { code: 'GP', name: 'GRAPH PRICE', desc: 'Candlestick / Vol Chart', category: 'Equities', aliases: ['CHART'] },
  { code: 'CORR', name: 'CORRELATION ANALYZER', desc: 'Correlation & portfolio analysis', category: 'Equities', aliases: ['CORRELATION'] },
  { code: 'PRM', name: 'PORTFOLIO RISK MONITOR', desc: 'Exposure, risk & stress tests', category: 'Equities', aliases: ['RISK'] },
  { code: 'HP', name: 'HISTORICAL PRICING', desc: 'Price Archive table', category: 'Equities', aliases: ['HISTORICAL', 'PRICING'] },
  { code: 'DES', name: 'SECURITY ANALYTICS', desc: 'Core Info & Bio', category: 'Equities', aliases: ['ANALYTICS', 'SECURITY'] },
  { code: 'ANR', name: 'ANALYST RECS', desc: 'Consensus estimates', category: 'Equities', aliases: ['ANALYST', 'RECS', 'RECOMMENDATIONS'] },
  { code: 'INST', name: 'INSTITUTIONAL ACTIVITY', desc: '13F Holdings & Accumulation', category: 'Equities', aliases: ['13F', 'INSTITUTIONAL', 'ACTIVITY'] },
  { code: 'CRNC', name: 'CURRENCIES (FX)', desc: 'Foreign Exchange Rates', category: 'Macro', aliases: ['CURRENCIES', 'FX', 'FOREX'] },
  { code: 'ECO', name: 'ECONOMIC INDICATOR', desc: 'FRED Macro & Calendar', category: 'Macro', aliases: ['ECONOMIC', 'INDICATOR', 'MACRO', 'FRED'] },
  { code: 'POLY', name: 'POLYMARKET SCREENER', desc: 'Predictive market arbitrage', category: 'Macro', aliases: ['POLYMARKET', 'PREDICTIONS', 'PREDICTION'] },
  { code: 'SETT', name: 'SYSTEM SETTINGS', desc: 'Configure API Keys', category: 'Tools', aliases: ['SETTINGS', 'CONFIG', 'KEYS'] },
  { code: 'HELP', name: 'USER MANUAL', desc: 'Syntax reference guide', category: 'Tools', aliases: ['HLP', 'MANUAL'] }
];

export function normalizeCommandLookupKey(str: string): string {
  return str
    .toUpperCase()
    .replace(/[()]/g, ' ')
    .replace(/[^A-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Map of normalized phrase -> screen code (e.g. "GRAPH PRICE" -> "GP")
export const COMMAND_ALIAS_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const cmd of COMMAND_DEFINITIONS) {
    const code = cmd.code;
    map[normalizeCommandLookupKey(code)] = code;
    map[normalizeCommandLookupKey(cmd.name)] = code;

    // Also strip parentheses from name if any (e.g. "CURRENCIES (FX)" -> "CURRENCIES FX" and "CURRENCIES")
    const cleanName = cmd.name.replace(/\(.*?\)/g, '').trim();
    if (cleanName) {
      map[normalizeCommandLookupKey(cleanName)] = code;
    }

    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        map[normalizeCommandLookupKey(alias)] = code;
      }
    }
  }
  return map;
})();

export const SORTED_ALIAS_KEYS: string[] = Object.keys(COMMAND_ALIAS_MAP).sort(
  (a, b) => b.length - a.length
);

export type ParsedCommandResult =
  | { type: 'SCREEN'; screen: string; ticker?: undefined; prompt?: undefined }
  | { type: 'TICKER_SCREEN'; screen: string; ticker: string; prompt?: undefined }
  | { type: 'AI_QUERY'; prompt: string; screen?: undefined; ticker?: undefined };

const TICKER_CMD_RE = /^(?:[A-Z]{1,5}(?:[.-][A-Z0-9]{1,4})?|[0-9]{3,5}\.[A-Z]{1,3})$/;

export function parseCommandLineInput(rawInput: string): ParsedCommandResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { type: 'SCREEN', screen: 'GP' };
  }

  const normalized = normalizeCommandLookupKey(trimmed);

  // 1. Direct match for multi-word or single-word command names/aliases (e.g. "GRAPH PRICE", "PORTFOLIO RISK MONITOR", "ASK")
  if (COMMAND_ALIAS_MAP[normalized]) {
    return {
      type: 'SCREEN',
      screen: COMMAND_ALIAS_MAP[normalized],
    };
  }

  // 2. Multi-word and single-word command matching with ticker:
  // Check if phrase matches `<TICKER> <COMMAND>` or `<COMMAND> <TICKER>`
  for (const alias of SORTED_ALIAS_KEYS) {
    const screen = COMMAND_ALIAS_MAP[alias];
    const wordsInAlias = alias.split(' ').length;

    // Pattern 1: `<TICKER> <ALIAS>` (e.g., "AAPL GRAPH PRICE", "AAPL GP", "AAPL ASK")
    if (normalized.endsWith(' ' + alias)) {
      const remainder = normalized.slice(0, normalized.length - alias.length - 1).trim();
      // Ensure remainder is a single token formatted like a ticker
      if (remainder && remainder.split(' ').length === 1 && TICKER_CMD_RE.test(remainder)) {
        return {
          type: 'TICKER_SCREEN',
          ticker: remainder,
          screen,
        };
      }
    }

    // Pattern 2: `<ALIAS> <TICKER>` (e.g., "GRAPH PRICE AAPL", "GP AAPL", "ASK AAPL")
    if (normalized.startsWith(alias + ' ')) {
      const remainder = normalized.slice(alias.length + 1).trim();
      if (remainder && remainder.split(' ').length === 1 && TICKER_CMD_RE.test(remainder)) {
        return {
          type: 'TICKER_SCREEN',
          ticker: remainder,
          screen,
        };
      }
    }
  }

  // 3. Fallback: Check if input is a single ticker alone (e.g. "AAPL")
  const tokens = normalized.split(/\s+/);
  if (tokens.length === 1 && TICKER_CMD_RE.test(tokens[0])) {
    return {
      type: 'TICKER_SCREEN',
      ticker: tokens[0],
      screen: 'GP',
    };
  }

  // 4. Default: Conversational AI analyst prompt
  return {
    type: 'AI_QUERY',
    prompt: trimmed,
  };
}

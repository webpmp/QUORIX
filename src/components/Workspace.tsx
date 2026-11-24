import React, { useState, useEffect, useRef } from 'react';
import {
  StockData,
  EconomicIndicator,
  CurrencyPair,
  FredMacroMetric,
  FredReleaseDate,
} from '../types';
import { FredFeedStatus } from '../App';
import ChartWidget from './ChartWidget';
import ErrorBoundary from './ErrorBoundary';
import CorrelationAnalyzerScreen from './CorrelationAnalyzerScreen';
import { CurrenciesScreen } from './CurrenciesScreen';
import { InsiderTradingPanel } from './InsiderTradingPanel';
import PolymarketScreen from './PolymarketScreen';
import InstitutionalActivityScreen from './InstitutionalActivityScreen';
import PortfolioRiskMonitorScreen from './PortfolioRiskMonitorScreen';
import {
  countDistinctTradingDays,
  deduplicateAndSortHistoricalBars,
  isClosingPriceSnapshotBar,
  selectBestHistoricalBars,
  type HistoricalPriceBar,
} from '../utils/historicalPricing';
import { Send, AlertCircle, RefreshCw, Search, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';

interface WorkspaceProps {
  activeScreen: string;
  selectedTicker: string;
  stocks: Record<string, StockData>;
  trackedTickers?: string[];
  corrSeedTicker?: { id: number; symbol: string } | null;
  currencies: CurrencyPair[];
  economics: EconomicIndicator[];
  fredMacroMetrics?: FredMacroMetric[];
  fredReleases?: FredReleaseDate[];
  fredEconomicsStatus?: FredFeedStatus;
  fredCurrenciesStatus?: FredFeedStatus;
  onRefreshEconomics?: () => void;
  onRefreshCurrencies?: () => void;
  onExecuteCommand: (cmd: string) => void;
  onSelectScreen?: (screenCode: string) => void;
  onSelectTicker?: (ticker: string) => void;
  pendingAiQuery?: { id: number; text: string } | null;
  onClearPendingAiQuery?: () => void;
  askPrefillPrompt?: { id: number; text: string } | null;
  onClearAskPrefillPrompt?: () => void;
  focusAskQuorixSignal?: number;
  onTickTimeChange?: (val: string) => void;
}

type DiagnosticProviderId = 'ALPHA_VANTAGE' | 'NYT' | 'NEWS_API' | 'NEWSDATA' | 'FRED' | '3SPREAD';
type DiagnosticStatus = 'READY' | 'TESTING' | 'CONNECTED' | 'FAILED';

interface DiagnosticPipelineRow {
  id: DiagnosticProviderId;
  label: string;
  description: string;
}

interface DiagnosticStatusEntry {
  status: DiagnosticStatus;
  message: string;
  latencyMs?: number;
}

const DIAGNOSTIC_PIPELINES: readonly DiagnosticPipelineRow[] = [
  {
    id: 'ALPHA_VANTAGE',
    label: 'ALPHA VANTAGE',
    description: 'Executes a lightweight $AAPL quote lookup to verify Alpha Vantage authentication and market data connectivity.',
  },
  {
    id: 'NYT',
    label: 'NEW YORK TIMES BUSINESS',
    description: 'Checks authentication and reachability against the NY Times Business Top Stories API.',
  },
  {
    id: 'NEWS_API',
    label: 'NEWS API',
    description: 'Runs a minimal single-headline US business query to verify News API credentials and quota access.',
  },
  {
    id: 'NEWSDATA',
    label: 'NEWSDATA.IO',
    description: 'Executes a minimal business news probe to validate Newsdata.io authentication and feed availability.',
  },
  {
    id: 'FRED',
    label: 'FRED (ST. LOUIS FED)',
    description: 'Fetches the latest Fed Funds (DFF) observation to verify St. Louis Fed FRED API authentication.',
  },
  {
    id: '3SPREAD',
    label: '3SPREAD',
    description: 'Queries the lightweight 3spread data-as-of metadata endpoint to confirm Form 13F API authentication.',
  },
];

function createInitialDiagnosticsState(): Record<DiagnosticProviderId, DiagnosticStatusEntry> {
  return {
    ALPHA_VANTAGE: { status: 'READY', message: '' },
    NYT: { status: 'READY', message: '' },
    NEWS_API: { status: 'READY', message: '' },
    NEWSDATA: { status: 'READY', message: '' },
    FRED: { status: 'READY', message: '' },
    '3SPREAD': { status: 'READY', message: '' },
  };
}

function getMarketTimeDetails(): { isPreMarket: boolean; isCoreHours: boolean; isAfterHours: boolean; isWeekend: boolean } {
  try {
    const etString = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const etDate = new Date(etString);
    const day = etDate.getDay();
    const hours = etDate.getHours();
    const minutes = etDate.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    const isWeekend = day === 0 || day === 6;
    
    // Pre-market: 4:00 AM to 9:30 AM ET -> 240 mins to 570 mins
    const isPreMarket = !isWeekend && (totalMinutes >= 4 * 60) && (totalMinutes < 9 * 60 + 30);
    
    // Core: 9:30 AM to 4:00 PM ET -> 570 mins to 960 mins
    const isCoreHours = !isWeekend && (totalMinutes >= 9 * 60 + 30) && (totalMinutes < 16 * 60);
    
    // After hours: 4:00 PM to 8:00 PM ET -> 960 mins to 1200 mins
    const isAfterHours = !isWeekend && (totalMinutes >= 16 * 60) && (totalMinutes < 20 * 60);

    return { isPreMarket, isCoreHours, isAfterHours, isWeekend };
  } catch (err) {
    const date = new Date();
    const day = date.getDay();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    const isWeekend = day === 0 || day === 6;
    
    const isPreMarket = !isWeekend && (totalMinutes >= 4 * 60) && (totalMinutes < 9 * 60 + 30);
    const isCoreHours = !isWeekend && (totalMinutes >= 9 * 60 + 30) && (totalMinutes < 16 * 60);
    const isAfterHours = !isWeekend && (totalMinutes >= 16 * 60) && (totalMinutes < 20 * 60);

    return { isPreMarket, isCoreHours, isAfterHours, isWeekend };
  }
}

function getAnrConsensusRating(reportText: string): { label: string; colorClass: string } {
  if (!reportText) {
    return { label: '', colorClass: 'text-zinc-300' };
  }

  let raw = '';
  const recLineMatch = reportText.match(/RECOMMENDATION\s*:\s*([A-Z_ -]+?)(?:\s*\||\r?\n|$)/i);
  if (recLineMatch?.[1]) {
    raw = recLineMatch[1].replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  } else {
    const fallbackMatch = reportText.match(
      /\b(STRONG[\s_]+BUY|STRONG[\s_]+SELL|OUTPERFORM|UNDERPERFORM|BUY|HOLD|SELL)\b/i
    );
    if (fallbackMatch?.[1]) {
      raw = fallbackMatch[1].replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
    }
  }

  if (!raw || raw === 'NONE' || raw === 'N/A') {
    return { label: 'N/A', colorClass: 'text-zinc-300' };
  }

  let colorClass = 'text-zinc-300';
  if (raw.includes('BUY') || raw === 'OUTPERFORM') {
    colorClass = 'text-[#00ff00]';
  } else if (raw.includes('SELL') || raw === 'UNDERPERFORM') {
    colorClass = 'text-[#ff4444]';
  } else if (raw === 'HOLD' || raw === 'NEUTRAL') {
    colorClass = 'text-[#ff9900]';
  }

  return { label: raw, colorClass };
}

function findMentionedTickers(title: string, stocks: Record<string, any>): string[] {
  const text = title.toUpperCase();
  const tickerList = Object.keys(stocks);
  const found: string[] = [];
  tickerList.forEach(ticker => {
    const regex = new RegExp(`\\b${ticker}\\b`, 'i');
    if (regex.test(text)) {
      found.push(ticker);
    }
  });
  return found;
}

function formatDisplayTime(dateStr?: string) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr;
  }
}

function cleanHeadline(title: string): string {
  if (!title) return '';
  // Clean off trailing sources like: " - Al Jazeera", " - Reuters", " - WSJ", " | Associated Press", etc.
  let cleaned = title.replace(/\s*[-|]\s*[^-|]+$/, '').trim();
  if (cleaned.length < 10) {
    return title;
  }
  return cleaned;
}

function getRelatedTickers(title: string, content: string, stocks: Record<string, any>): string[] {
  const text = ((title || '') + ' ' + (content || '')).toUpperCase();
  const found = new Set<string>();

  // 1. Scan for exact match of any existing tracked stock ticker
  const tickerList = Object.keys(stocks);
  tickerList.forEach(ticker => {
    const regex = new RegExp(`\\b${ticker}\\b`, 'i');
    if (regex.test(text)) {
      found.add(ticker);
    }
  });

  // Check company & asset names
  const companyKeywords: Record<string, string[]> = {
    AAPL: ['APPLE', 'IPHONE', 'IPAD', 'MACBOOK', 'IOS'],
    NVDA: ['NVIDIA', 'GEFORCE', 'AI CHIP', 'CUDA', 'BLACKWELL', 'H100', 'JEN-HSUN'],
    TSLA: ['TESLA', 'ELON MUSK', 'MODEL S', 'MODEL 3', 'MODEL Y', 'MODEL X', 'CYBERTRUCK'],
    MSFT: ['MICROSOFT', 'WINDOWS', 'AZURE', 'COPILOT', 'SATYA'],
    GOOG: ['GOOGLE', 'ALPHABET', 'ANDROID', 'GEMINI', 'PICHAI'],
    AMZN: ['AMAZON', 'AWS', 'BEZOS', 'KINDLE'],
    META: ['META', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'ZUCKERBERG'],
    BTC: ['BITCOIN', 'BTC-USD', 'IBIT'],
    ETH: ['ETHEREUM', 'ETH-USD'],
    SOL: ['SOLANA', 'SOL-USD'],
    GC: ['GOLD FUTURES', 'GOLD PRICE', 'BULLION'],
    CL: ['CRUDE OIL', 'WTI CRUDE', 'BRENT CRUDE'],
    SPX: ['S&P 500', 'S&P500'],
    DJI: ['DOW JONES'],
    IXIC: ['NASDAQ'],
  };

  Object.entries(companyKeywords).forEach(([ticker, keywords]) => {
    keywords.forEach(keyword => {
      if (text.includes(keyword)) {
        found.add(ticker);
      }
    });
  });

  // 2. Scan for industry/thematic keywords and map to industry tickers
  const categoryKeywords: Array<{ keywords: string[], tickers: string[] }> = [
    {
      keywords: ['OIL', 'BRENT', 'CRUDE', 'ENERGY', 'GAS', 'OPEC', 'PETROLEUM', 'STRAIT OF HORMUZ', 'SAUDI', 'DRILLING', 'MIDDLE EAST', 'IRAN', 'ATTACKS', 'STRAIT'],
      tickers: ['COP', 'XOM', 'CVX', 'FANG', 'VLO']
    },
    {
      keywords: ['CHIP', 'SEMICONDUCTOR', 'GPU', 'FOUNDRY', 'TSMC', 'AMD', 'INTEL', 'ASML', 'NVIDIA'],
      tickers: ['NVDA', 'AMD', 'TSM', 'AVGO', 'QCOM', 'INTC', 'ASML']
    },
    {
      keywords: ['RETAIL', 'COMMERCE', 'SHOP', 'CONSUMER', 'STORE', 'WALMART', 'AMAZON', 'COSTCO'],
      tickers: ['AMZN', 'WMT', 'TGT', 'COST', 'HD']
    },
    {
      keywords: ['FED', 'INTEREST', 'RATE', 'INFLATION', 'TREASURY', 'YIELD', 'BANK', 'FINANCE', 'FEDERAL RESERVE', 'WALL STREET'],
      tickers: ['JPM', 'BAC', 'MS', 'GS', 'C', 'WFC']
    },
    {
      keywords: ['PHARMA', 'DRUG', 'VACCINE', 'HEALTHCARE', 'BIOTECH', 'MEDICINE', 'CANCER', 'GLP-1'],
      tickers: ['LLY', 'JNJ', 'PFE', 'MRK', 'ABBV', 'AMGN']
    },
    {
      keywords: ['DEFENSE', 'MILITARY', 'PENTAGON', 'AEROSPACE', 'WEAPON', 'WAR', 'CONFLICT', 'MISSILE'],
      tickers: ['LMT', 'RTX', 'GD', 'NOC', 'BA']
    }
  ];

  categoryKeywords.forEach(({ keywords, tickers }) => {
    const matches = keywords.some(kw => text.includes(kw));
    if (matches) {
      tickers.forEach(t => found.add(t));
    }
  });

  // Ensure if we have NO tickers found, we provide a clean, realistic set of tickers like the stock indexes/major tickers
  if (found.size === 0) {
    return ['AAPL', 'MSFT', 'NVDA'];
  }

  return Array.from(found);
}

export default function Workspace({
  activeScreen,
  selectedTicker,
  stocks,
  trackedTickers = [],
  corrSeedTicker = null,
  currencies,
  economics,
  fredMacroMetrics = [],
  fredReleases = [],
  fredEconomicsStatus,
  fredCurrenciesStatus,
  onRefreshEconomics,
  onRefreshCurrencies,
  onExecuteCommand,
  onSelectScreen,
  onSelectTicker,
  pendingAiQuery,
  onClearPendingAiQuery,
  askPrefillPrompt,
  onClearAskPrefillPrompt,
  focusAskQuorixSignal = 0,
  onTickTimeChange
}: WorkspaceProps) {
  // AI assistant conversational state (ASK)
  const [messages, setMessages] = useState<Array<{ sender: 'user' | 'terminal'; text: string; links?: any[] }>>([]);
  const [userInput, setUserInput] = useState(() => askPrefillPrompt?.text || '');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [examplesExpanded, setExamplesExpanded] = useState(true);
  const [releaseSearch, setReleaseSearch] = useState('');
  const [pressReleasesOnly, setPressReleasesOnly] = useState(false);
  const [bwriteFontIdx, setBwriteFontIdx] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('quorix_ask_font_size_idx') || localStorage.getItem('quorix_bwrite_font_size_idx');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 5) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return 1;
  });
  const lastProcessedQueryIdRef = useRef<number | null>(null);
  const lastProcessedPrefillIdRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const bwriteInputRef = useRef<HTMLInputElement | null>(null);

  const BWRITE_FONT_SCALES = [
    { label: '10PX', body: 'text-xs', heading: 'text-xs', badge: 'text-xs', input: 'text-xs' },
    { label: '12PX', body: 'text-xs', heading: 'text-xs', badge: 'text-xs', input: 'text-xs' },
    { label: '14PX', body: 'text-sm', heading: 'text-xs', badge: 'text-xs', input: 'text-sm' },
    { label: '16PX', body: 'text-base', heading: 'text-sm', badge: 'text-xs', input: 'text-base' },
    { label: '18PX', body: 'text-lg', heading: 'text-base', badge: 'text-xs', input: 'text-lg' },
    { label: '20PX', body: 'text-xl', heading: 'text-lg', badge: 'text-sm', input: 'text-xl' },
  ] as const;
  const activeBwriteFont = BWRITE_FONT_SCALES[bwriteFontIdx] || BWRITE_FONT_SCALES[1];

  const renderTextSizeControl = () => (
    <div className="flex items-center gap-1.5 font-mono select-none shrink-0">
      <span className="hidden sm:inline-flex items-center text-xs leading-none text-zinc-300 uppercase tracking-wider mr-0.5">
        TEXT SIZE
      </span>
      <button
        type="button"
        onClick={() => setBwriteFontIdx((prev) => Math.max(0, prev - 1))}
        disabled={bwriteFontIdx === 0}
        title="Decrease text size"
        aria-label="Decrease text size"
        className="inline-flex items-center justify-center px-2 py-1 rounded border border-[#333] bg-[#0d0d0d] text-zinc-300 hover:border-[#ff9900] hover:text-[#ff9900] disabled:opacity-35 disabled:hover:border-[#333] disabled:hover:text-zinc-300 disabled:cursor-not-allowed text-xs leading-none font-bold transition-colors cursor-pointer"
      >
        A-
      </button>
      <span className="inline-flex items-center justify-center text-xs leading-none text-[#ff9900] font-bold min-w-[34px] text-center">
        {activeBwriteFont.label}
      </span>
      <button
        type="button"
        onClick={() => setBwriteFontIdx((prev) => Math.min(BWRITE_FONT_SCALES.length - 1, prev + 1))}
        disabled={bwriteFontIdx === BWRITE_FONT_SCALES.length - 1}
        title="Increase text size"
        aria-label="Increase text size"
        className="inline-flex items-center justify-center px-2 py-1 rounded border border-[#333] bg-[#0d0d0d] text-zinc-300 hover:border-[#ff9900] hover:text-[#ff9900] disabled:opacity-35 disabled:hover:border-[#333] disabled:hover:text-zinc-300 disabled:cursor-not-allowed text-xs leading-none font-bold transition-colors cursor-pointer"
      >
        A+
      </button>
    </div>
  );

  useEffect(() => {
    try {
      localStorage.setItem('quorix_ask_font_size_idx', String(bwriteFontIdx));
    } catch {
      // ignore storage errors
    }
  }, [bwriteFontIdx]);

  // Screen-specific loading states for server-side AI contents
  const [desData, setDesData] = useState<string>('');
  const [anrData, setAnrData] = useState<string>('');
  const [desLoading, setDesLoading] = useState(false);
  const [anrLoading, setAnrLoading] = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsArticles, setNewsArticles] = useState<any[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<number>(0);
  const lastNewsTickerRef = useRef<string>('');

  // Historical Price (HP) expanded hourly history state & per-symbol client cache (5-minute TTL)
  interface HpCacheEntry {
    symbol: string;
    bars: HistoricalPriceBar[];
    tradingDays: number;
    fetchedAt: number;
    warning: string | null;
  }
  const hpCacheRef = useRef<Map<string, HpCacheEntry>>(new Map());
  const [hpSymbolData, setHpSymbolData] = useState<HpCacheEntry | null>(null);
  const [hpLoading, setHpLoading] = useState<boolean>(false);
  const [hpError, setHpError] = useState<string | null>(null);

  // Settings Screen States
  type SettingsKeyId =
    | 'ALPHA_VANTAGE_API_KEY'
    | 'NYT_API_KEY'
    | 'NEWS_API_KEY'
    | 'NEWSDATA_API_KEY'
    | 'FRED_API_KEY'
    | '3SPREAD_API_KEY';
  type CredentialSource = 'environment' | 'runtime' | 'none';
  interface CredentialMetaEntry {
    configured: boolean;
    source: CredentialSource;
    maskedValue: string;
  }

  const createEmptyCredentialMeta = (): Record<SettingsKeyId, CredentialMetaEntry> => ({
    ALPHA_VANTAGE_API_KEY: { configured: false, source: 'none', maskedValue: '' },
    NYT_API_KEY: { configured: false, source: 'none', maskedValue: '' },
    NEWS_API_KEY: { configured: false, source: 'none', maskedValue: '' },
    NEWSDATA_API_KEY: { configured: false, source: 'none', maskedValue: '' },
    FRED_API_KEY: { configured: false, source: 'none', maskedValue: '' },
    '3SPREAD_API_KEY': { configured: false, source: 'none', maskedValue: '' },
  });

  const [alphaVantageKey, setAlphaVantageKey] = useState('');
  const [nytKey, setNytKey] = useState('');
  const [newsApiKey, setNewsApiKey] = useState('');
  const [newsdataKey, setNewsdataKey] = useState('');
  const [fredKey, setFredKey] = useState('');
  const [threeSpreadKey, setThreeSpreadKey] = useState('');
  const [savedKeysSnapshot, setSavedKeysSnapshot] = useState<Record<SettingsKeyId, string>>({
    ALPHA_VANTAGE_API_KEY: '',
    NYT_API_KEY: '',
    NEWS_API_KEY: '',
    NEWSDATA_API_KEY: '',
    FRED_API_KEY: '',
    '3SPREAD_API_KEY': '',
  });
  const [credentialMeta, setCredentialMeta] = useState<Record<SettingsKeyId, CredentialMetaEntry>>(
    createEmptyCredentialMeta
  );
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysSaving, setKeysSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [cancelNotice, setCancelNotice] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Record<DiagnosticProviderId, DiagnosticStatusEntry>>(
    createInitialDiagnosticsState
  );
  const testingProvidersRef = useRef<Set<DiagnosticProviderId>>(new Set());

  const isMaskedPlaceholder = (value: string) =>
    value.includes('••••') || value.includes('●●●●');

  const applyServerKeyStatus = (
    maskedSource?: Partial<Record<SettingsKeyId, string>>,
    credentialsSource?: Partial<Record<SettingsKeyId, CredentialMetaEntry>>
  ) => {
    const keys: SettingsKeyId[] = [
      'ALPHA_VANTAGE_API_KEY',
      'NYT_API_KEY',
      'NEWS_API_KEY',
      'NEWSDATA_API_KEY',
      'FRED_API_KEY',
      '3SPREAD_API_KEY',
    ];
    const nextSnapshot = {} as Record<SettingsKeyId, string>;
    const nextMeta = createEmptyCredentialMeta();

    for (const id of keys) {
      const meta = credentialsSource?.[id];
      const masked =
        typeof meta?.maskedValue === 'string'
          ? meta.maskedValue
          : typeof maskedSource?.[id] === 'string'
          ? maskedSource[id] || ''
          : '';
      nextSnapshot[id] = masked;
      nextMeta[id] = meta
        ? {
            configured: Boolean(meta.configured),
            source: meta.source || (masked ? 'runtime' : 'none'),
            maskedValue: masked,
          }
        : {
            configured: Boolean(masked),
            source: masked ? 'runtime' : 'none',
            maskedValue: masked,
          };
    }

    setAlphaVantageKey(nextSnapshot.ALPHA_VANTAGE_API_KEY);
    setNytKey(nextSnapshot.NYT_API_KEY);
    setNewsApiKey(nextSnapshot.NEWS_API_KEY);
    setNewsdataKey(nextSnapshot.NEWSDATA_API_KEY);
    setFredKey(nextSnapshot.FRED_API_KEY);
    setThreeSpreadKey(nextSnapshot['3SPREAD_API_KEY']);
    setSavedKeysSnapshot(nextSnapshot);
    setCredentialMeta(nextMeta);
  };

  const fetchCurrentKeys = async () => {
    setKeysLoading(true);
    try {
      const response = await fetch('/api/settings/keys');
      const data = await response.json();
      const keySource = data.maskedKeys || data.keys;
      if (data.success && (keySource || data.credentials)) {
        applyServerKeyStatus(keySource, data.credentials);
      }
    } catch (err) {
      console.error('Failed to fetch current keys:', err);
    } finally {
      setKeysLoading(false);
    }
  };

  useEffect(() => {
    if (activeScreen === 'SETT' || activeScreen === 'SETTINGS') {
      fetchCurrentKeys();
    }
  }, [activeScreen]);

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeysSaving(true);
    setSaveSuccess(false);
    setSaveError('');
    setCancelNotice(false);
    try {
      const currentValues: Record<SettingsKeyId, string> = {
        ALPHA_VANTAGE_API_KEY: alphaVantageKey,
        NYT_API_KEY: nytKey,
        NEWS_API_KEY: newsApiKey,
        NEWSDATA_API_KEY: newsdataKey,
        FRED_API_KEY: fredKey,
        '3SPREAD_API_KEY': threeSpreadKey,
      };

      // Never submit unchanged masked placeholders or environment-managed credentials
      const payload: Partial<Record<SettingsKeyId, string>> = {};
      (Object.keys(currentValues) as SettingsKeyId[]).forEach((id) => {
        if (credentialMeta[id]?.source === 'environment') return;
        const val = currentValues[id];
        if (val === savedKeysSnapshot[id]) return;
        if (isMaskedPlaceholder(val)) return;
        payload[id] = val;
      });

      const response = await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        if (data.maskedKeys || data.credentials) {
          applyServerKeyStatus(data.maskedKeys, data.credentials);
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        window.dispatchEvent(new Event('quorix-settings-updated'));
        onRefreshEconomics?.();
        onRefreshCurrencies?.();
      } else {
        setSaveError(
          typeof data?.error === 'string' && data.error.trim()
            ? data.error
            : 'Unable to save API configuration. Verify the entered values.'
        );
      }
    } catch (err) {
      console.error('Failed to save API keys:', err);
      setSaveError('Unable to reach server to save API configuration.');
    } finally {
      setKeysSaving(false);
    }
  };

  const handleCancelKeys = () => {
    setAlphaVantageKey(savedKeysSnapshot.ALPHA_VANTAGE_API_KEY);
    setNytKey(savedKeysSnapshot.NYT_API_KEY);
    setNewsApiKey(savedKeysSnapshot.NEWS_API_KEY);
    setNewsdataKey(savedKeysSnapshot.NEWSDATA_API_KEY);
    setFredKey(savedKeysSnapshot.FRED_API_KEY);
    setThreeSpreadKey(savedKeysSnapshot['3SPREAD_API_KEY']);
    setSaveSuccess(false);
    setSaveError('');
    setCancelNotice(true);
    setTimeout(() => setCancelNotice(false), 3000);
  };

  const runDiagnosticTest = async (providerId: DiagnosticProviderId) => {
    if (testingProvidersRef.current.has(providerId)) return;
    testingProvidersRef.current.add(providerId);

    setDiagnostics((prev) => ({
      ...prev,
      [providerId]: { status: 'TESTING', message: '' },
    }));

    const providerKeyIdMap: Record<DiagnosticProviderId, SettingsKeyId> = {
      ALPHA_VANTAGE: 'ALPHA_VANTAGE_API_KEY',
      NYT: 'NYT_API_KEY',
      NEWS_API: 'NEWS_API_KEY',
      NEWSDATA: 'NEWSDATA_API_KEY',
      FRED: 'FRED_API_KEY',
      '3SPREAD': '3SPREAD_API_KEY',
    };
    const providerValueMap: Record<DiagnosticProviderId, string> = {
      ALPHA_VANTAGE: alphaVantageKey,
      NYT: nytKey,
      NEWS_API: newsApiKey,
      NEWSDATA: newsdataKey,
      FRED: fredKey,
      '3SPREAD': threeSpreadKey,
    };

    const keyId = providerKeyIdMap[providerId];
    const currentVal = providerValueMap[providerId];
    const isEnvManaged = credentialMeta[keyId]?.source === 'environment';
    const hasUnsavedCandidate =
      !isEnvManaged &&
      currentVal !== savedKeysSnapshot[keyId] &&
      currentVal.trim() !== '' &&
      !isMaskedPlaceholder(currentVal);

    try {
      const response = await fetch('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          hasUnsavedCandidate
            ? { provider: providerId, apiKey: currentVal }
            : { provider: providerId }
        ),
      });
      const data = await response.json();
      const connected = Boolean(response.ok && data?.success && data?.status === 'CONNECTED');
      setDiagnostics((prev) => ({
        ...prev,
        [providerId]: {
          status: connected ? 'CONNECTED' : 'FAILED',
          message:
            typeof data?.message === 'string' && data.message.trim()
              ? data.message
              : connected
              ? 'Connection verified successfully.'
              : 'Connection test failed. Verify the configured API key.',
          latencyMs: typeof data?.latencyMs === 'number' ? data.latencyMs : undefined,
        },
      }));
    } catch {
      setDiagnostics((prev) => ({
        ...prev,
        [providerId]: {
          status: 'FAILED',
          message: 'Unable to reach diagnostic endpoint. Verify server connectivity and retry.',
        },
      }));
    } finally {
      testingProvidersRef.current.delete(providerId);
    }
  };

  const currentStock = stocks[selectedTicker] || {
    symbol: selectedTicker,
    name: selectedTicker,
    price: 0,
    change: 0,
    changePercent: 0,
    high: 0,
    low: 0,
    open: 0,
    prevClose: 0,
    volume: 0,
    marketCap: '—',
    peRatio: 0,
    beta: 0,
    history: [],
  };

  // Fetch or simulate server-side description on ticker search, and fetch initial/ticker news
  useEffect(() => {
    if (lastRefreshed === 0) {
      fetchAggregatedNews(selectedTicker);
    } else if ((activeScreen === 'GP' || activeScreen === 'NEWS') && lastNewsTickerRef.current !== selectedTicker) {
      fetchAggregatedNews(selectedTicker);
    }

    if (activeScreen === 'DES') {
      fetchScreenData('DES', selectedTicker, setDesData, setDesLoading);
    } else if (activeScreen === 'ANR') {
      fetchScreenData('ANR', selectedTicker, setAnrData, setAnrLoading);
    } else if (activeScreen === 'NEWS') {
      const details = getMarketTimeDetails();
      const isMarketActive = details.isPreMarket || details.isCoreHours || details.isAfterHours;
      const oneHourInMs = 60 * 60 * 1000;

      if (lastRefreshed > 0 && isMarketActive && Date.now() - lastRefreshed >= oneHourInMs) {
        fetchAggregatedNews(selectedTicker);
      }
    }
  }, [selectedTicker, activeScreen, lastRefreshed]);

  // Load expanded hourly Historical Price archive on demand when HP screen is active (per-symbol cached)
  useEffect(() => {
    if (activeScreen !== 'HP') return;
    const sym = (selectedTicker || '').trim().toUpperCase();
    if (!sym) return;

    const HP_CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
    const cached = hpCacheRef.current.get(sym);
    if (cached && cached.bars.length > 0) {
      setHpSymbolData(cached);
      setHpError(null);
      if (Date.now() - cached.fetchedAt < HP_CLIENT_CACHE_TTL_MS) {
        setHpLoading(false);
        return;
      }
    } else {
      setHpSymbolData(null);
    }

    const controller = new AbortController();
    let cancelled = false;
    setHpLoading(true);
    setHpError(null);

    fetch(`/api/market/history?symbol=${encodeURIComponent(sym)}&interval=hp`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const incoming: HistoricalPriceBar[] =
          data?.success && Array.isArray(data.history) ? data.history : [];
        const prevBars = hpCacheRef.current.get(sym)?.bars || [];
        const bestBars = selectBestHistoricalBars(incoming, prevBars);

        if (bestBars.length > 0) {
          const entry: HpCacheEntry = {
            symbol: sym,
            bars: bestBars,
            tradingDays:
              typeof data?.tradingDays === 'number' && incoming.length === bestBars.length
                ? data.tradingDays
                : countDistinctTradingDays(bestBars),
            fetchedAt: Date.now(),
            warning: typeof data?.warning === 'string' ? data.warning : null,
          };
          hpCacheRef.current.set(sym, entry);
          setHpSymbolData(entry);
          setHpError(null);
        } else {
          setHpError(
            typeof data?.error === 'string' && data.error
              ? data.error
              : `Unable to load expanded historical prices for ${sym}.`
          );
        }
      })
      .catch((err: any) => {
        if (cancelled || err?.name === 'AbortError') return;
        setHpError(err?.message || `Network error loading historical prices for ${sym}.`);
      })
      .finally(() => {
        if (!cancelled) setHpLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeScreen, selectedTicker]);

  // Set up periodic check (every 60 seconds) to auto-update once an hour during market hours
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeScreen === 'NEWS') {
        const details = getMarketTimeDetails();
        const isMarketActive = details.isPreMarket || details.isCoreHours || details.isAfterHours;
        const oneHourInMs = 60 * 60 * 1000;
        
        if (isMarketActive && Date.now() - lastRefreshed >= oneHourInMs) {
          fetchAggregatedNews(selectedTicker);
        }
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [activeScreen, lastRefreshed, selectedTicker]);

  useEffect(() => {
    const handleForceNewsRefresh = () => {
      fetchAggregatedNews(selectedTicker, true);
    };
    window.addEventListener('quorix-news-refresh', handleForceNewsRefresh);
    return () => window.removeEventListener('quorix-news-refresh', handleForceNewsRefresh);
  }, [selectedTicker]);

  const fetchScreenData = async (
    screenKey: string,
    ticker: string,
    setDataFn: (val: string) => void,
    setLoadingFn: (val: boolean) => void
  ) => {
    setLoadingFn(true);
    try {
      const response = await fetch('/api/terminal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: `${ticker} ${screenKey}`,
          ticker,
          screen: screenKey
        })
      });
      const data = await response.json();
      if (data.success) {
        setDataFn(data.output);
      } else {
        setDataFn(data.output || 'LIVE AI ANALYSIS UNAVAILABLE. CHECK GEMINI_API_KEY.');
      }
    } catch {
      setDataFn('UNABLE TO REACH LIVE TERMINAL ANALYSIS SERVICE.');
    } finally {
      setLoadingFn(false);
    }
  };

  const fetchAggregatedNews = async (targetTicker = selectedTicker, force = false) => {
    lastNewsTickerRef.current = targetTicker;
    setNewsLoading(true);
    try {
      const params = new URLSearchParams();
      if (targetTicker) params.set('ticker', targetTicker);
      if (force) params.set('force', 'true');
      const query = params.toString() ? `?${params.toString()}` : '';
      const response = await fetch(`/api/news/ticker${query}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const rawText = await response.text();
      if (!response.ok || !contentType.includes('application/json') || rawText.trimStart().startsWith('<')) {
        throw new Error(!response.ok ? `HTTP ${response.status}` : 'Non-JSON response from news endpoint');
      }
      const data = JSON.parse(rawText);
      if (data.success && Array.isArray(data.data)) {
        // Map missing fields and ensure ISO publishedAt timestamp exists
        const processed = data.data.map((item: any, idx: number) => {
          let publishedAt = item.publishedAt;
          if (!publishedAt) {
            // Calculate relative offset to keep correct order if timestamp is missing
            publishedAt = new Date(Date.now() - idx * 15 * 60 * 1000).toISOString();
          }
          return { ...item, publishedAt };
        });

        const combined = [...processed];

        // Sort descending by publishedAt (most recent first)
        combined.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

        // Filter strictly for current date (today) in user's local timezone or New York (ET) timezone
        const filtered = combined.filter(item => {
          const pubStr = item.publishedAt;
          if (!pubStr) return false;
          try {
            const itemDate = new Date(pubStr);
            if (isNaN(itemDate.getTime())) return false;

            const today = new Date();
            
            // Same calendar day in local timezone
            const isLocalToday = itemDate.getDate() === today.getDate() &&
                                 itemDate.getMonth() === today.getMonth() &&
                                 itemDate.getFullYear() === today.getFullYear();
            
            // Same calendar day in America/New_York (ET) timezone
            const itemETStr = itemDate.toLocaleString("en-US", { timeZone: "America/New_York" });
            const itemET = new Date(itemETStr);
            const todayETStr = today.toLocaleString("en-US", { timeZone: "America/New_York" });
            const todayET = new Date(todayETStr);
            
            const isNewYorkToday = itemET.getDate() === todayET.getDate() &&
                                   itemET.getMonth() === todayET.getMonth() &&
                                   itemET.getFullYear() === todayET.getFullYear();

            // Strictly must be today in either user's local timezone or New York time
            return isLocalToday || isNewYorkToday;
          } catch {
            return false;
          }
        });

        // Deduplicate headlines by topic (word overlap)
        const uniqueArticles: any[] = [];
        for (const art of filtered) {
          let isDup = false;
          for (const existing of uniqueArticles) {
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
            uniqueArticles.push(art);
          }
        }

        setNewsArticles(uniqueArticles);
        setLastRefreshed(Date.now());
      } else {
        setNewsArticles([]);
      }
    } catch (err) {
      console.error('Failed to load aggregated news:', err);
      setNewsArticles([]);
    } finally {
      setNewsLoading(false);
    }
  };

  const submitAiPrompt = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed) return;

    setExamplesExpanded(false);
    setMessages((prev) => [...prev, { sender: 'user', text: trimmed }]);
    setIsAiLoading(true);

    // Analysing input
    try {
      const response = await fetch('/api/terminal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: trimmed,
          context: { currentTicker: selectedTicker }
        })
      });
      const data = await response.json();
      
      setMessages((prev) => [
        ...prev,
        {
          sender: 'terminal',
          text: data.output || 'NO CORRESPONDING CORE METRICS RETURNED.',
          links: data.links
        }
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'terminal',
          text: 'UNABLE TO REACH LIVE TERMINAL ANALYSIS SERVICE. Check GEMINI_API_KEY configuration.'
        }
      ]);
    } finally {
      setIsAiLoading(false);
    }
  };

  useEffect(() => {
    if (
      (activeScreen === 'ASK' || activeScreen === 'BWRITE') &&
      pendingAiQuery &&
      pendingAiQuery.text.trim() &&
      lastProcessedQueryIdRef.current !== pendingAiQuery.id
    ) {
      lastProcessedQueryIdRef.current = pendingAiQuery.id;
      submitAiPrompt(pendingAiQuery.text);
      onClearPendingAiQuery?.();
    }
  }, [activeScreen, pendingAiQuery]);

  useEffect(() => {
    if (
      (activeScreen === 'ASK' || activeScreen === 'BWRITE') &&
      askPrefillPrompt &&
      askPrefillPrompt.text &&
      lastProcessedPrefillIdRef.current !== askPrefillPrompt.id
    ) {
      lastProcessedPrefillIdRef.current = askPrefillPrompt.id;
      setUserInput(askPrefillPrompt.text);
      onClearAskPrefillPrompt?.();
      const id = requestAnimationFrame(() => {
        if (bwriteInputRef.current) {
          bwriteInputRef.current.focus();
          const len = askPrefillPrompt.text.length;
          bwriteInputRef.current.setSelectionRange(len, len);
        }
      });
      return () => cancelAnimationFrame(id);
    }
  }, [activeScreen, askPrefillPrompt]);

  useEffect(() => {
    if (activeScreen === 'ASK' || activeScreen === 'BWRITE') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isAiLoading, activeScreen]);

  useEffect(() => {
    if (activeScreen === 'ASK' || activeScreen === 'BWRITE') {
      const id = requestAnimationFrame(() => {
        if (bwriteInputRef.current) {
          bwriteInputRef.current.focus();
          const len = bwriteInputRef.current.value.length;
          bwriteInputRef.current.setSelectionRange(len, len);
        }
      });
      return () => cancelAnimationFrame(id);
    }
  }, [activeScreen, focusAskQuorixSignal]);

  // Submit AI prompt from follow-up input
  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isAiLoading) return;

    const userMsg = userInput;
    setUserInput('');
    await submitAiPrompt(userMsg);
  };

  const getTickerNews = () => {
    const pool = newsArticles.length > 0 ? newsArticles : [];
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    const filtered = pool.filter((item) => {
      const related = getRelatedTickers(item.title, item.content || '', stocks);
      const upperTicker = selectedTicker.toUpperCase();
      const hasApiTicker = Array.isArray(item.relatedTickers) &&
                           item.relatedTickers.some((t: string) => t.toUpperCase() === upperTicker);
      const isForTicker = hasApiTicker ||
                          related.includes(selectedTicker) ||
                          (item.symbol && item.symbol.toUpperCase() === upperTicker) ||
                          (item.title && item.title.toUpperCase().includes(upperTicker));

      if (!isForTicker) return false;

      if (!item.publishedAt) return false;
      try {
        const pubTime = new Date(item.publishedAt).getTime();
        return pubTime >= twentyFourHoursAgo && pubTime <= now + 5 * 60 * 1000;
      } catch {
        return false;
      }
    });

    return filtered.slice(0, 4);
  };

  return (
    <div className={`flex-1 bg-[#010101] p-4 font-mono text-zinc-300 relative select-text ${
      activeScreen === 'ASK' || activeScreen === 'BWRITE' || activeScreen === 'ECO' || activeScreen === 'PRM'
        ? 'flex flex-col overflow-hidden min-h-0'
        : activeScreen === 'POLY'
        ? 'flex flex-col overflow-y-auto lg:overflow-hidden min-h-0'
        : 'overflow-y-auto'
    }`}>
      
      {/* 1. GP: CHART GRAPH SCREEN */}
      {activeScreen === 'GP' && (
        <div className="space-y-4 animate-fade-in">
          <ErrorBoundary
            compact
            fallbackTitle="PRICE CHART RENDER ERROR"
            resetKey={selectedTicker}
          >
            <ChartWidget stock={currentStock} onTickTimeChange={onTickTimeChange} />
          </ErrorBoundary>

          {/* Ticker Headlines */}
          <div className="bg-[#050505] border border-[#333] p-3 rounded">
            <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider block border-b border-[#333] pb-1.5 mb-2 select-none">
              {selectedTicker} Headlines
            </span>
            {newsLoading ? (
              <div className="flex items-center gap-1.5 py-3 text-xs text-zinc-300 font-mono">
                <RefreshCw size={10} className="animate-spin text-[#ff9900]" />
                <span>REFRESHING FEEDS...</span>
              </div>
            ) : (() => {
              const tickerNews = getTickerNews();
              if (tickerNews.length === 0) {
                return (
                  <div className="text-center py-4 text-zinc-300 text-xs uppercase font-bold tracking-wider">
                    no recent headlines
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {tickerNews.map((item, idx) => {
                    const displayTime = formatDisplayTime(item.publishedAt || item.time);
                    const cleanedTitle = cleanHeadline(item.title);
                    return (
                      <div key={item.id || idx} className="bg-[#010101] border border-[#3a3a3a] hover:border-[#333] p-2.5 rounded flex flex-col text-xs/relaxed transition-all">
                        <div className="flex justify-between items-center text-xs text-zinc-300 mb-1.5 font-mono uppercase">
                          <span className="text-[#3498db] font-bold">
                            {item.source.replace(' Business', '').toUpperCase()}
                          </span>
                          <span>{displayTime}</span>
                        </div>
                        <a
                          href={item.url || 'https://www.reuters.com'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-100 hover:text-[#00ff00] text-sm md:text-base font-bold leading-snug hover:underline block"
                        >
                          {cleanedTitle}
                        </a>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Insider Trading (3spread SEC Form 3/4/5) */}
          <InsiderTradingPanel ticker={selectedTicker} />
        </div>
      )}

      {/* 1B. CORR: CORRELATION ANALYZER SCREEN */}
      {activeScreen === 'CORR' && (
        <CorrelationAnalyzerScreen
          stocks={stocks}
          trackedTickers={trackedTickers}
          seedTicker={corrSeedTicker}
          onExecuteCommand={onExecuteCommand}
        />
      )}

      {/* 1C. PRM: PORTFOLIO RISK MONITOR SCREEN */}
      {activeScreen === 'PRM' && (
        <PortfolioRiskMonitorScreen
          stocks={stocks}
          trackedTickers={trackedTickers}
          onSelectTicker={onSelectTicker}
          onExecuteCommand={onExecuteCommand}
          onOpenCorrWorkspace={() => {
            if (onSelectScreen) {
              onSelectScreen('CORR');
            } else {
              onExecuteCommand('CORR');
            }
          }}
        />
      )}

      {/* 2. HP: HISTORICAL PRICING TABLE */}
      {activeScreen === 'HP' && (() => {
        const activeHpSym = (currentStock.symbol || selectedTicker || '').toUpperCase();
        const expandedBars =
          hpSymbolData && hpSymbolData.symbol === activeHpSym ? hpSymbolData.bars : [];
        const fallbackBars: HistoricalPriceBar[] = Array.isArray(currentStock.history)
          ? currentStock.history
          : [];
        const displayBars =
          expandedBars.length > 0
            ? expandedBars
            : deduplicateAndSortHistoricalBars(fallbackBars);
        const tradingDaysCount =
          hpSymbolData && hpSymbolData.symbol === activeHpSym && expandedBars.length > 0
            ? hpSymbolData.tradingDays
            : countDistinctTradingDays(displayBars);
        const hpWarningMsg =
          hpSymbolData && hpSymbolData.symbol === activeHpSym ? hpSymbolData.warning : null;

        return (
          <div className="bg-[#050505] border border-[#333] rounded p-4 animate-fade-in shadow-lg">
            <div className="border-b border-[#333] pb-2 mb-4 flex flex-wrap justify-between items-center gap-2 select-none">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-white text-md font-bold uppercase tracking-wider">
                  {currentStock.symbol} Historical Price Log System
                </span>
                {displayBars.length > 0 && (
                  <span className="text-xs text-zinc-300 font-mono uppercase tabular-nums">
                    {displayBars.length.toLocaleString()} BARS • {tradingDaysCount}{' '}
                    {tradingDaysCount === 1 ? 'DAY' : 'TRADING DAYS'} • 60M
                  </span>
                )}
                {hpLoading && (
                  <span className="inline-flex items-center gap-1 text-xs text-[#ff9900] font-mono uppercase">
                    <RefreshCw size={10} className="animate-spin" />
                    <span>LOADING ARCHIVE...</span>
                  </span>
                )}
              </div>
              {renderTextSizeControl()}
            </div>

            {hpWarningMsg && (
              <div className="mb-3 px-3 py-2 rounded bg-amber-950/25 border border-amber-600/40 text-amber-300 text-xs font-mono flex items-center gap-2">
                <AlertCircle size={12} className="shrink-0 text-amber-400" />
                <span>{hpWarningMsg}</span>
              </div>
            )}

            {hpError && displayBars.length === 0 && !hpLoading && (
              <div className="mb-3 px-3 py-2 rounded bg-red-950/25 border border-red-800/40 text-red-300 text-xs font-mono flex items-center gap-2">
                <AlertCircle size={12} className="shrink-0 text-[#ff4444]" />
                <span>{hpError}</span>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className={`w-full text-left ${activeBwriteFont.body} text-[#d4d4d4] border-collapse`}>
                <thead>
                  <tr className={`border-b border-[#333] text-zinc-300 ${activeBwriteFont.heading} uppercase font-bold`}>
                    <th className="py-2.5 pr-3 whitespace-nowrap">TIME</th>
                    <th className="text-right px-3 whitespace-nowrap">OPEN VALUE</th>
                    <th className="text-right px-3 whitespace-nowrap">HIGH VALUE</th>
                    <th className="text-right px-3 whitespace-nowrap">LOW VALUE</th>
                    <th className="text-right px-3 whitespace-nowrap">CLOSE VALUE</th>
                    <th className="text-right px-3 whitespace-nowrap">INTERVAL VOLUME</th>
                    <th className="text-right pl-3 whitespace-nowrap">DIFFERENTIAL</th>
                  </tr>
                </thead>
                <tbody>
                  {displayBars.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-300 font-mono uppercase tracking-wider">
                        {hpLoading
                          ? `LOADING HISTORICAL HOURLY SESSIONS FOR ${currentStock.symbol}...`
                          : `NO HISTORICAL TICK SESSIONS RECOVERED FROM ARCHIVE FOR ${currentStock.symbol}.`}
                      </td>
                    </tr>
                  ) : (
                    displayBars.map((h, i) => {
                      const isUp = h.close >= h.open;
                      const diffRatio = h.open > 0 ? (((h.close - h.open) / h.open) * 100) : 0;
                      const isCloseSnapshot =
                        h.isMarketCloseSnapshot ?? isClosingPriceSnapshotBar(h);
                      return (
                        <tr key={`${h.timestamp || h.date}-${i}`} className={`border-b border-[#3a3a3a] hover:bg-[#111] ${activeBwriteFont.body} font-mono`}>
                          <td className="py-2.5 pr-3 text-[#3498db] font-bold font-mono whitespace-nowrap">
                            {h.date} {isCloseSnapshot ? '(Market Close)' : '(Intraday)'}
                          </td>
                          <td className="text-right px-3 font-mono whitespace-nowrap">${h.open.toFixed(2)}</td>
                          <td className="text-right px-3 font-mono text-[#00ff00] whitespace-nowrap">${h.high.toFixed(2)}</td>
                          <td className="text-right px-3 font-mono text-[#ff4444] whitespace-nowrap">${h.low.toFixed(2)}</td>
                          <td className="text-right px-3 font-mono text-zinc-150 font-bold whitespace-nowrap">${h.close.toFixed(2)}</td>
                          <td className="text-right px-3 text-zinc-300 font-mono whitespace-nowrap">{h.volume.toLocaleString()}</td>
                          <td className={`text-right pl-3 font-bold font-mono whitespace-nowrap ${isUp ? 'text-[#00ff00]' : 'text-[#ff4444]'}`}>
                            {isUp ? '+' : ''}{diffRatio.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* 3. DES: INTEL BIOGRAPHY AND DESCRIPTION OVERVIEWS */}
      {activeScreen === 'DES' && (
        <div className="bg-[#050505] border border-[#333] rounded p-4 animate-fade-in shadow-xl">
          <div className="border-b border-[#333] pb-2 mb-4 flex flex-wrap justify-between items-center gap-2">
            <span className="text-white text-md font-bold uppercase tracking-wider">
              Description Summary
            </span>
            {renderTextSizeControl()}
          </div>

          {desLoading ? (
            <div className="flex flex-col items-center py-12 space-y-2 text-zinc-300 text-xs">
              <RefreshCw className="animate-spin text-[#3498db]" size={20} />
              <span>COUPLING DIRECTLY WITH AI DECODER STACKS...</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className={`bg-black border border-[#333] p-4 rounded text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed ${activeBwriteFont.body}`}>
                {desData}
              </div>

              {/* Live quote matrix */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[#050505] border border-[#333] p-3 rounded">
                  <span className="text-zinc-300 block text-xs font-bold uppercase">Last Price</span>
                  <span className="text-white font-extrabold text-sm">
                    {currentStock.price > 0 ? `$${currentStock.price.toFixed(2)}` : '--'}
                  </span>
                </div>
                <div className="bg-[#050505] border border-[#333] p-3 rounded">
                  <span className="text-zinc-300 block text-xs font-bold uppercase">Day Range</span>
                  <span className="text-white font-extrabold text-sm">
                    {currentStock.low > 0 && currentStock.high > 0
                      ? `$${currentStock.low.toFixed(2)} - $${currentStock.high.toFixed(2)}`
                      : '--'}
                  </span>
                </div>
                <div className="bg-[#050505] border border-[#333] p-3 rounded">
                  <span className="text-zinc-300 block text-xs font-bold uppercase">Previous Close</span>
                  <span className="text-white font-extrabold text-sm">
                    {currentStock.prevClose > 0 ? `$${currentStock.prevClose.toFixed(2)}` : '--'}
                  </span>
                </div>
                <div className="bg-[#050505] border border-[#333] p-3 rounded">
                  <span className="text-zinc-300 block text-xs font-bold uppercase">Trading Volume</span>
                  <span className="text-[#3498db] font-extrabold text-sm">
                    {currentStock.volume > 0 ? currentStock.volume.toLocaleString() : '--'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. ANR: RECOMMENDATIONS CONSENSUS REPORT VIEW */}
      {activeScreen === 'ANR' && (() => {
        const anrConsensus = getAnrConsensusRating(anrData);
        return (
        <div className="bg-[#050505] border border-[#333] rounded p-4 animate-fade-in shadow-xl">
          <div className="border-b border-[#333] pb-2 mb-4 flex flex-wrap justify-between items-center gap-2">
            <span className="text-white text-md font-bold uppercase tracking-wider">
              Analyst Consensus Rating
            </span>
            {renderTextSizeControl()}
          </div>

          {anrLoading ? (
            <div className="flex flex-col items-center py-12 space-y-2 text-zinc-300 text-xs">
              <RefreshCw className="animate-spin text-[#ff9900]" size={20} />
              <span>COLLECTING BUY/SELL CONSENSUS CHANNELS...</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className={`bg-black border border-[#333] p-4 rounded text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed ${activeBwriteFont.body}`}>
                {anrData.split('\n').map((line, lineIdx, arr) => {
                  const recMatch = line.match(/^(RECOMMENDATION\s*:\s*)([A-Z0-9_/ -]+?)(\s*\|\s*.*|$)/i);
                  return (
                    <React.Fragment key={lineIdx}>
                      {recMatch && anrConsensus.label ? (
                        <>
                          {recMatch[1]}
                          <span className={`font-bold uppercase font-mono tracking-wider ${anrConsensus.colorClass}`}>
                            {anrConsensus.label}
                          </span>
                          {recMatch[3]}
                        </>
                      ) : (
                        line
                      )}
                      {lineIdx < arr.length - 1 ? '\n' : ''}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* 5. NEWS: CENTRAL SECURITIES NEWS GROUND-TRUTH FEED */}
      {activeScreen === 'NEWS' && (
        <div className="bg-[#050505] border border-[#333] rounded p-4 animate-fade-in shadow-xl">
          <div className="border-b border-[#333] pb-2 mb-4 flex justify-between items-center">
            <span className="text-white text-md font-bold uppercase tracking-wider">
              NEWS HUB
            </span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-300 font-mono">
                LAST REFRESHED: {lastRefreshed > 0 ? new Date(lastRefreshed).toLocaleTimeString() : 'NEVER'}
              </span>
              <button 
                onClick={() => fetchAggregatedNews(selectedTicker, true)} 
                disabled={newsLoading}
                className="text-zinc-300 hover:text-[#00ff00] disabled:text-zinc-700 transition-colors cursor-pointer"
                title="Refresh news"
              >
                <RefreshCw size={12} className={newsLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {newsLoading ? (
              <div className="flex flex-col items-center py-12 space-y-2 text-zinc-300 text-xs bg-black border border-[#333] rounded">
                <RefreshCw className="animate-spin text-[#3498db]" size={20} />
                <span>SYNCING WITH REAL-TIME WEB GROUNDING ENGINE...</span>
              </div>
            ) : newsArticles.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {newsArticles.map((item, idx) => {
                  const displayTime = formatDisplayTime(item.publishedAt || item.time);
                  const cleanedTitle = cleanHeadline(item.title);
                  const apiTickers: string[] = Array.isArray(item.relatedTickers)
                    ? item.relatedTickers.filter((t: string) => /^[A-Z0-9-]{1,6}$/.test(t) && !t.includes('.'))
                    : [];
                  const relatedTickers = apiTickers.length > 0
                    ? Array.from(new Set(apiTickers))
                    : getRelatedTickers(item.title, item.content || '', stocks);

                  return (
                    <div key={item.id || idx} className="bg-black border border-[#151515] hover:border-[#333] p-4 rounded transition-all flex flex-col justify-between font-mono">
                      <div>
                        {/* Linked headline and source attribution on first line, timestamp on second line */}
                        <div className="mb-2 leading-snug break-words">
                          <a 
                            href={item.url || 'https://www.reuters.com'} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-white hover:text-[#00ff00] text-sm md:text-base font-bold leading-snug hover:underline break-words"
                          >
                            {cleanedTitle}
                          </a>
                          {item.source && (
                            <>
                              {' '}
                              <span className="text-xs text-[#ff9900] font-extrabold uppercase ml-1.5 select-none">—{' '}</span>
                              <a 
                                href={item.url || 'https://www.reuters.com'} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-[#ff9900] font-extrabold uppercase hover:text-[#00ff00] hover:underline select-none"
                              >
                                [{item.source.replace(' Business', '').toUpperCase()}]
                              </a>
                            </>
                          )}
                          {displayTime && (
                            <div className="text-xs text-zinc-300 font-mono mt-1">
                              {displayTime}
                            </div>
                          )}
                        </div>
                        {item.content && (
                          <p className="text-xs md:text-sm text-zinc-300 font-normal font-sans mb-3 line-clamp-3">
                            {item.content}
                          </p>
                        )}
                      </div>
                      
                      {/* Tickers, Sentiment below the content */}
                      <div className="space-y-1.5 mt-2 pt-2 border-t border-[#151515] text-xs">
                        {/* Related Tickers row */}
                        <div className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-300">
                          {relatedTickers.map((t, tIdx) => (
                            <React.Fragment key={t}>
                              {tIdx > 0 && <span className="text-zinc-300">, </span>}
                              <span
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (onSelectTicker) {
                                    onSelectTicker(t);
                                  }
                                }}
                                className="text-[#3498db] hover:text-[#00ff00] hover:underline cursor-pointer font-bold"
                              >
                                {t}
                              </span>
                            </React.Fragment>
                          ))}
                        </div>

                        {/* Sentiment temporarily disabled until accuracy is improved
                        <div className={item.sentiment === 'positive' ? 'text-[#00ff00] font-bold' : item.sentiment === 'negative' ? 'text-[#ff4444] font-bold' : 'text-zinc-300 font-bold'}>
                          {item.sentiment ? item.sentiment.toUpperCase() : 'NEUTRAL'}
                        </div>
                        */}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-300 text-xs bg-black border border-[#333] rounded font-mono">
                NO RECENT WORLD OR BUSINESS NEWS POPULATED.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. CRNC: FX MARKET INTELLIGENCE WORKSPACE (FRED H.10 + BIS) */}
      {activeScreen === 'CRNC' && (
        <CurrenciesScreen
          currencies={currencies}
          fredCurrenciesStatus={fredCurrenciesStatus}
          onRefreshCurrencies={onRefreshCurrencies}
        />
      )}

      {/* 7. ECO: ECONOMIC INDICATORS & CALENDAR (FRED) */}
      {activeScreen === 'ECO' && (
        <div className="flex-1 min-h-0 flex flex-col animate-fade-in select-none">
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#050505] border border-[#333] rounded p-4 shadow-xl">
            <div className="shrink-0 border-b border-[#333] pb-2 mb-4 flex justify-between items-center">
              <span className="text-white text-md font-bold uppercase tracking-wider">
                Global Economic Calendar (FRED)
              </span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-300 font-mono">
                  {fredEconomicsStatus?.fetchedAt
                    ? `SYNCED ${new Date(fredEconomicsStatus.fetchedAt).toLocaleTimeString()}`
                    : 'ST. LOUIS FED FRED API'}
                </span>
                {onRefreshEconomics && (
                  <button
                    onClick={onRefreshEconomics}
                    disabled={fredEconomicsStatus?.loading}
                    className="text-zinc-300 hover:text-[#00ff00] disabled:text-zinc-700 transition-colors cursor-pointer"
                    title="Refresh FRED economic indicators & calendar"
                  >
                    <RefreshCw size={12} className={fredEconomicsStatus?.loading ? 'animate-spin' : ''} />
                  </button>
                )}
              </div>
            </div>

            {fredEconomicsStatus?.requiresKey ? (
              <div className="bg-black border border-[#ff9900]/40 p-4 rounded text-xs text-zinc-300 space-y-2">
                <div className="flex items-center gap-2 text-[#ff9900] font-bold uppercase">
                  <AlertCircle size={14} />
                  <span>FRED_API_KEY Required</span>
                </div>
                <p className="text-zinc-300 leading-relaxed">
                  Add <span className="text-white font-bold">FRED_API_KEY</span> in AI Studio Secrets (or <span className="text-white font-bold">.env</span>) to load live St. Louis Fed FRED macroeconomic indicators, US Treasury yields, and official economic release dates.
                </p>
              </div>
            ) : fredEconomicsStatus?.loading && economics.length === 0 ? (
              <div className="flex flex-col items-center py-12 space-y-2 text-zinc-300 text-xs bg-black border border-[#333] rounded">
                <RefreshCw className="animate-spin text-[#3498db]" size={20} />
                <span>SYNCING ST. LOUIS FED FRED MACRO &amp; RELEASE CALENDAR...</span>
              </div>
            ) : fredEconomicsStatus?.error ? (
              <div className="bg-black border border-[#ff4444]/40 p-4 rounded text-xs text-[#ff4444] flex items-center gap-2">
                <AlertCircle size={14} />
                <span>{fredEconomicsStatus.error}</span>
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col gap-6">
                {/* US Macro & Treasury Rates Snapshot */}
                {fredMacroMetrics.length > 0 && (
                  <div className="shrink-0">
                    <div className="mb-2">
                      <div className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                        US Macro &amp; Treasury Benchmarks (FRED)
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {fredMacroMetrics.map((metric) => (
                        <div key={metric.id} className="bg-black border border-[#3a3a3a] p-3 rounded">
                          <span className="text-zinc-300 block text-xs font-bold uppercase truncate">
                            {metric.label}
                          </span>
                          <span className="text-white font-extrabold text-sm block mt-1">
                            {metric.value}
                          </span>
                          <span className="text-xs text-zinc-300 font-mono block mt-1">
                            {metric.id}{metric.date ? ` • ${metric.date}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Global Macro Indicators Table */}
                <div className="shrink-0">
                  <div className="mb-2">
                    <div className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                      Global Macroeconomic Indicators
                    </div>
                  </div>
                  <table className="w-full text-left text-xs text-zinc-300 font-mono">
                    <thead>
                      <tr className="border-b border-[#333] text-zinc-300 text-xs uppercase font-bold text-left">
                        <th className="py-2.5">NATION/REGION</th>
                        <th className="text-right">GDP GROWTH</th>
                        <th className="text-right">UNEMPLOYMENT</th>
                        <th className="text-right">CPI INFLATION (YOY)</th>
                        <th className="text-right">POLICY RATE</th>
                        <th className="text-right">LATEST OBS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {economics.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-zinc-300">
                            NO FRED MACRO INDICATORS LOADED.
                          </td>
                        </tr>
                      ) : (
                        economics.map((eco, idx) => (
                          <tr key={idx} className="border-b border-[#3a3a3a] hover:bg-[#111] text-xs font-mono">
                            <td className="py-3 text-[#3498db] font-bold flex items-center space-x-2 font-mono">
                              <span>{eco.flag}</span>
                              <span>{eco.country}</span>
                            </td>
                            <td className="text-right font-bold text-[#00ff00] font-mono">{eco.gdpGrow}</td>
                            <td className="text-right font-mono text-zinc-300">{eco.unemployment}</td>
                            <td className="text-right font-mono text-zinc-300">{eco.inflation}</td>
                            <td className="text-right text-white font-bold font-mono">{eco.rate}</td>
                            <td className="text-right font-mono text-xs text-zinc-300">
                              {eco.updatedAt || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* FRED Release Calendar */}
                {(() => {
                  const normalizedQuery = releaseSearch.trim().toLowerCase();
                  const filteredReleases = fredReleases.filter((rel) => {
                    if (pressReleasesOnly && !rel.pressRelease) return false;
                    if (!normalizedQuery) return true;
                    return (
                      rel.releaseName.toLowerCase().includes(normalizedQuery) ||
                      rel.date.includes(normalizedQuery) ||
                      String(rel.releaseId).includes(normalizedQuery)
                    );
                  });

                  return (
                    <div className="flex-1 min-h-0 flex flex-col">
                      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                          FRED Economic Release Calendar (Last 30 Days)
                        </div>
                        <div className="flex items-center gap-2 font-mono">
                          <div className="relative flex items-center">
                            <Search size={11} className="text-zinc-300 absolute left-2 pointer-events-none" />
                            <input
                              type="text"
                              value={releaseSearch}
                              onChange={(e) => setReleaseSearch(e.target.value)}
                              placeholder="FILTER RELEASES (CPI, FOMC, GDP...)"
                              className="bg-black border border-[#333] focus:border-[#ff9900] rounded pl-6 pr-2 py-1 text-xs text-white placeholder-zinc-600 focus:outline-none w-52 sm:w-64 uppercase"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setPressReleasesOnly((prev) => !prev)}
                            className={`px-2 py-1 rounded border text-xs font-bold uppercase transition-colors cursor-pointer ${
                              pressReleasesOnly
                                ? 'border-[#ff9900] bg-[#ff9900]/15 text-[#ff9900]'
                                : 'border-[#333] bg-black text-zinc-300 hover:border-zinc-500 hover:text-white'
                            }`}
                          >
                            {pressReleasesOnly ? 'PRESS RELEASES' : 'ALL RELEASES'}
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto border border-[#3a3a3a] rounded bg-black">
                        <table className="w-full text-left text-xs text-zinc-300 font-mono">
                          <thead className="sticky top-0 bg-[#0a0a0a] z-10">
                            <tr className="border-b border-[#333] text-zinc-300 text-xs uppercase font-bold">
                              <th className="py-2 px-3 whitespace-nowrap">RELEASE DATE</th>
                              <th className="py-2 px-3 whitespace-nowrap">RELEASE ID</th>
                              <th className="py-2 px-3 whitespace-nowrap">ECONOMIC RELEASE</th>
                              <th className="py-2 px-3 text-right whitespace-nowrap">{filteredReleases.length} REPORTS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredReleases.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="py-6 text-center text-zinc-300">
                                  {fredReleases.length === 0
                                    ? 'NO RELEASE CALENDAR DATES RETURNED.'
                                    : 'NO RELEASES MATCH CURRENT FILTER.'}
                                </td>
                              </tr>
                            ) : (
                              filteredReleases.map((rel, idx) => {
                                const fredUrl = rel.fredUrl || `https://fred.stlouisfed.org/release?rid=${rel.releaseId}`;
                                const primaryUrl = rel.sourceUrl || fredUrl;

                                return (
                                  <tr key={`${rel.releaseId}-${rel.date}-${idx}`} className="border-b border-[#3a3a3a]/60 hover:bg-[#111] text-xs">
                                    <td className="py-2 px-3 text-[#00ff00] font-bold whitespace-nowrap">{rel.date}</td>
                                    <td className="py-2 px-3 text-zinc-300 whitespace-nowrap">#{rel.releaseId}</td>
                                    <td className="py-2 px-3 text-zinc-200">
                                      <a
                                        href={primaryUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:text-[#ff9900] hover:underline inline-flex items-center gap-1.5 transition-colors"
                                        title={rel.sourceUrl ? `Open official report: ${rel.sourceUrl}` : `Open FRED release #${rel.releaseId}`}
                                      >
                                        <span>{rel.releaseName}</span>
                                        <ExternalLink size={10} className="text-zinc-300 shrink-0" />
                                      </a>
                                      {rel.pressRelease && (
                                        <span className="ml-2 text-xs text-[#ff9900] border border-[#ff9900]/40 bg-[#ff9900]/10 px-1 py-0.2 rounded uppercase">
                                          PRESS
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-right whitespace-nowrap">
                                      <div className="inline-flex items-center gap-2">
                                        {rel.sourceUrl && (
                                          <a
                                            href={rel.sourceUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs font-bold text-[#ff9900] hover:text-white border border-[#ff9900]/40 hover:border-[#ff9900] bg-[#ff9900]/10 px-1.5 py-0.5 rounded inline-flex items-center gap-1 transition-colors"
                                            title="Open official agency press release / report"
                                          >
                                            <span>SOURCE</span>
                                            <ExternalLink size={9} />
                                          </a>
                                        )}
                                        <a
                                          href={fredUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs font-bold text-[#3498db] hover:text-white border border-[#3498db]/40 hover:border-[#3498db] bg-[#3498db]/10 px-1.5 py-0.5 rounded inline-flex items-center gap-1 transition-colors"
                                          title={`Open FRED Release #${rel.releaseId} data & series`}
                                        >
                                          <span>FRED</span>
                                          <ExternalLink size={9} />
                                        </a>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}


      {/* 9. ASK: DIALOGING CHAT AND RESEARCH CONVERTER (formerly BWRITE) */}
      {(activeScreen === 'ASK' || activeScreen === 'BWRITE') && (
        <div className="bg-[#050505] border border-[#333] rounded flex flex-col flex-1 min-h-0 animate-fade-in shadow-xl overflow-hidden">
          
          <div className="border-b border-[#333] p-3 bg-black flex justify-between items-center select-none">
            <span className="text-white text-md font-bold uppercase tracking-wider flex items-center">
              QUORIX INTELLIGENCE
            </span>
            {renderTextSizeControl()}
          </div>

          {/* Messages window area */}
          <div className="flex-1 p-3 overflow-y-auto space-y-4 bg-black/95">
            <div className={`w-full rounded border border-[#333] bg-black text-zinc-300 ${activeBwriteFont.body} font-mono shadow-sm text-left overflow-hidden`}>
              <button
                type="button"
                onClick={() => setExamplesExpanded((prev) => !prev)}
                className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-[#0c0c0c] transition-colors cursor-pointer select-none"
                aria-expanded={examplesExpanded}
              >
                <span className={`${activeBwriteFont.badge} text-zinc-300 font-bold uppercase tracking-wider flex items-center gap-1.5`}>
                  {examplesExpanded ? (
                    <ChevronDown size={13} className="text-[#ff9900]" />
                  ) : (
                    <ChevronRight size={13} className="text-[#ff9900]" />
                  )}
                  QI — ASK COMMAND EXAMPLES
                </span>
                <span className={`${activeBwriteFont.badge} text-zinc-300 font-bold uppercase tracking-wider`}>
                  {examplesExpanded ? 'COLLAPSE' : 'EXPAND'}
                </span>
              </button>

              {examplesExpanded && (
                <div className="p-4 pt-3 border-t border-[#3a3a3a] grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Left Column */}
                  <div className="space-y-4">
                    <div>
                      <div className={`text-[#ff9900] font-bold ${activeBwriteFont.heading} uppercase tracking-wider border-b border-[#3a3a3a] pb-1 mb-2`}>
                        Company &amp; Stock Deep-Dives
                      </div>
                      <div className="space-y-1">
                        {[
                          'Describe NVDA',
                          "Summarize Apple's business segments and valuation",
                          'What are the main bull and bear risks for TSLA?',
                          'Analyze MSFT free cash flow and margin trends'
                        ].map((cmd) => (
                          <button
                            key={cmd}
                            type="button"
                            onClick={() => submitAiPrompt(cmd)}
                            className="block w-full text-left text-zinc-300 hover:text-[#00ff00] hover:bg-[#111] px-2 py-1 rounded transition-colors cursor-pointer"
                          >
                            {cmd}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className={`text-[#ff9900] font-bold ${activeBwriteFont.heading} uppercase tracking-wider border-b border-[#3a3a3a] pb-1 mb-2`}>
                        Stock Comparisons
                      </div>
                      <div className="space-y-1">
                        {[
                          'Compare NVDA and AMD metrics',
                          'Compare AAPL vs MSFT P/E, beta, and growth outlook'
                        ].map((cmd) => (
                          <button
                            key={cmd}
                            type="button"
                            onClick={() => submitAiPrompt(cmd)}
                            className="block w-full text-left text-zinc-300 hover:text-[#00ff00] hover:bg-[#111] px-2 py-1 rounded transition-colors cursor-pointer"
                          >
                            {cmd}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-4">
                    <div>
                      <div className={`text-[#ff9900] font-bold ${activeBwriteFont.heading} uppercase tracking-wider border-b border-[#3a3a3a] pb-1 mb-2`}>
                        Live News &amp; Web-Grounded Queries
                      </div>
                      <div className="space-y-1">
                        {[
                          'Latest news on AAPL',
                          "Search the web for today's semiconductor market movers",
                          'Recent Fed news affecting Treasury yields'
                        ].map((cmd) => (
                          <button
                            key={cmd}
                            type="button"
                            onClick={() => submitAiPrompt(cmd)}
                            className="block w-full text-left text-zinc-300 hover:text-[#00ff00] hover:bg-[#111] px-2 py-1 rounded transition-colors cursor-pointer"
                          >
                            {cmd}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className={`text-[#ff9900] font-bold ${activeBwriteFont.heading} uppercase tracking-wider border-b border-[#3a3a3a] pb-1 mb-2`}>
                        Macro, Rates &amp; Commodities
                      </div>
                      <div className="space-y-1">
                        {[
                          'Explain inflation logic and how CPI impacts 10Y yields',
                          'Summarize recent crude oil and gold price trends',
                          'How do Fed rate cuts affect high-beta tech stocks?'
                        ].map((cmd) => (
                          <button
                            key={cmd}
                            type="button"
                            onClick={() => submitAiPrompt(cmd)}
                            className="block w-full text-left text-zinc-300 hover:text-[#00ff00] hover:bg-[#111] px-2 py-1 rounded transition-colors cursor-pointer"
                          >
                            {cmd}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {(() => {
              type DisplayEntry =
                | { type: 'standalone-terminal'; message: { sender: 'user' | 'terminal'; text: string; links?: any[] } }
                | { type: 'qa'; question: { text: string }; answer?: { text: string; links?: any[] }; isPending?: boolean };

              const entries: DisplayEntry[] = [];
              for (let i = 0; i < messages.length; i++) {
                const curr = messages[i];
                if (curr.sender === 'user') {
                  const next = messages[i + 1];
                  if (next && next.sender === 'terminal') {
                    entries.push({ type: 'qa', question: curr, answer: next });
                    i++;
                  } else {
                    entries.push({
                      type: 'qa',
                      question: curr,
                      isPending: isAiLoading && i === messages.length - 1
                    });
                  }
                } else {
                  entries.push({ type: 'standalone-terminal', message: curr });
                }
              }

              return entries.map((entry, idx) => {
                if (entry.type === 'standalone-terminal') {
                  return (
                    <div
                      key={idx}
                      className={`w-full rounded border border-[#333] bg-black text-zinc-300 p-3 ${activeBwriteFont.body} font-mono shadow-sm text-left`}
                    >
                      <span className={`${activeBwriteFont.badge} block text-zinc-300 font-bold mb-1 uppercase tracking-wider`}>
                        QI
                      </span>
                      <div className="whitespace-pre-wrap leading-relaxed select-text font-mono">
                        {entry.message.text}
                      </div>
                      {entry.message.links && entry.message.links.length > 0 && (
                        <div className="mt-3 border-t border-[#111] pt-2">
                          <span className={`${activeBwriteFont.badge} text-zinc-300 font-bold block mb-1 uppercase tracking-widest`}>GROUNDING SOURCED LINKS:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {entry.message.links.map((link: any, lIdx: number) => (
                              <a
                                key={lIdx}
                                href={link.url}
                                target="_blank"
                                rel="noreferrer referrer"
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#333] bg-black text-[#3498db] hover:border-[#3498db] ${activeBwriteFont.badge}`}
                              >
                                <Search size={8} />
                                <span>{link.title || 'Source'}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={idx}
                    className={`w-full rounded border border-[#333] overflow-hidden ${activeBwriteFont.body} font-mono shadow-sm text-left`}
                  >
                    {/* Client Question (Top) */}
                    <div className="bg-[#222] text-[#ff9900] p-3 border-b border-[#ff9900]/30">
                      <span className={`${activeBwriteFont.badge} block text-zinc-300 font-bold mb-1 uppercase tracking-wider`}>
                        USER
                      </span>
                      <div className="whitespace-pre-wrap leading-relaxed select-text font-mono">
                        {entry.question.text}
                      </div>
                    </div>

                    {/* AI Response (Bottom) */}
                    <div className="bg-black text-zinc-300 p-3">
                      <span className={`${activeBwriteFont.badge} block text-zinc-300 font-bold mb-1 uppercase tracking-wider`}>
                        QI
                      </span>
                      {entry.isPending ? (
                        <div className="text-zinc-300 flex items-center space-x-2 py-1">
                          <RefreshCw className="animate-spin text-[#3498db]" size={12} />
                          <span>AI TERMINAL ANALYSING SEC &amp; BOND ARBITRAGE FILINGS...</span>
                        </div>
                      ) : entry.answer ? (
                        <>
                          <div className="whitespace-pre-wrap leading-relaxed select-text font-mono">
                            {entry.answer.text}
                          </div>
                          {entry.answer.links && entry.answer.links.length > 0 && (
                            <div className="mt-3 border-t border-[#111] pt-2">
                              <span className={`${activeBwriteFont.badge} text-zinc-300 font-bold block mb-1 uppercase tracking-widest`}>GROUNDING SOURCED LINKS:</span>
                              <div className="flex flex-wrap gap-1.5">
                                {entry.answer.links.map((link: any, lIdx: number) => (
                                  <a
                                    key={lIdx}
                                    href={link.url}
                                    target="_blank"
                                    rel="noreferrer referrer"
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#333] bg-black text-[#3498db] hover:border-[#3498db] ${activeBwriteFont.badge}`}
                                  >
                                    <Search size={8} />
                                    <span>{link.title || 'Source'}</span>
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              });
            })()}
            <div ref={messagesEndRef} />
          </div>

          {/* Dialog prompt submit form */}
          <form onSubmit={handleAiSubmit} className="p-2 border-t border-[#333] bg-[#0c0c0c] flex items-center gap-2">
            <input
              ref={bwriteInputRef}
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Ask QUORIX AI (e.g., Explain inflation logic, summarize oil trends, compare NVDA and AAPL metrics...)"
              className={`flex-1 bg-black border border-[#333] focus:border-[#3498db] rounded p-2 ${activeBwriteFont.input} font-mono text-[#00ff00] outline-none placeholder-zinc-700`}
              disabled={isAiLoading}
            />
            <button
              type="submit"
              disabled={isAiLoading}
              className="px-4 py-2 bg-[#ff9900] text-black font-extrabold rounded text-xs select-none hover:bg-amber-500 transition-colors flex items-center gap-1.5 h-full cursor-pointer"
            >
              <Send size={12} />
              <span>SEND</span>
            </button>
          </form>
        </div>
      )}

      {/* 9.5 POLY: POLYMARKET SYSTEM SCREEN */}
      {activeScreen === 'POLY' && (
        <PolymarketScreen 
          stocks={stocks}
        />
      )}

      {/* 9.6 INST: INSTITUTIONAL ACTIVITY MONITOR (3SPREAD 13F) */}
      {activeScreen === 'INST' && (
        <InstitutionalActivityScreen
          selectedTicker={selectedTicker}
          stocks={stocks}
          onSelectTicker={onSelectTicker}
        />
      )}

      {/* 9.8 SETT: API SETTINGS PAGE */}
      {(activeScreen === 'SETT' || activeScreen === 'SETTINGS') && (
        <div className="bg-[#050505] border border-[#333] rounded p-5 animate-fade-in font-mono text-zinc-300">
          <div className="border-b border-[#333] pb-2 mb-4 flex justify-between items-center select-none">
            <span className="text-white text-md font-bold uppercase tracking-wider">
              SYSTEM SETTINGS
            </span>
          </div>

          <div className="text-xs">
          <p className="mb-4 leading-relaxed text-zinc-300">
            Configure third-party API connectivity keys in server memory for this session. Environment-provided credentials always take precedence and cannot be overwritten from this panel.
          </p>

          <form onSubmit={handleSaveKeys} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Alpha Vantage */}
              <div className="bg-black/40 border border-[#3a3a3a] p-3 rounded hover:border-zinc-800 transition-all">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-[#3498db] font-bold uppercase text-xs">ALPHA VANTAGE API KEY</label>
                  {credentialMeta.ALPHA_VANTAGE_API_KEY.source === 'environment' && (
                    <span className="text-xs font-bold uppercase text-emerald-400" title="Managed by server environment variable (takes precedence over runtime settings)">
                      ENV MANAGED
                    </span>
                  )}
                  {credentialMeta.ALPHA_VANTAGE_API_KEY.source === 'runtime' && (
                    <span className="text-xs font-bold uppercase text-zinc-300" title="Stored in server memory for the active session">
                      RUNTIME
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-300 block mb-2 leading-snug">Used for accurate real-time stock quote lookups and volume tracking.</span>
                <input
                  type="password"
                  value={alphaVantageKey}
                  onChange={(e) => setAlphaVantageKey(e.target.value)}
                  readOnly={credentialMeta.ALPHA_VANTAGE_API_KEY.source === 'environment'}
                  title={credentialMeta.ALPHA_VANTAGE_API_KEY.source === 'environment' ? 'Configured via ALPHA_VANTAGE_API_KEY environment variable' : undefined}
                  placeholder="Enter Alpha Vantage API Key"
                  className={`w-full bg-black border border-[#333] rounded p-2 text-xs font-mono text-[#00ff00] outline-none focus:border-[#3498db] ${credentialMeta.ALPHA_VANTAGE_API_KEY.source === 'environment' ? 'opacity-75 cursor-not-allowed' : ''}`}
                />
              </div>

              {/* NYT Business */}
              <div className="bg-black/40 border border-[#3a3a3a] p-3 rounded hover:border-zinc-800 transition-all">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-[#3498db] font-bold uppercase text-xs">NY TIMES BUSINESS API KEY</label>
                  {credentialMeta.NYT_API_KEY.source === 'environment' && (
                    <span className="text-xs font-bold uppercase text-emerald-400" title="Managed by server environment variable (takes precedence over runtime settings)">
                      ENV MANAGED
                    </span>
                  )}
                  {credentialMeta.NYT_API_KEY.source === 'runtime' && (
                    <span className="text-xs font-bold uppercase text-zinc-300" title="Stored in server memory for the active session">
                      RUNTIME
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-300 block mb-2 leading-snug">Used for fetching business top stories from New York Times.</span>
                <input
                  type="password"
                  value={nytKey}
                  onChange={(e) => setNytKey(e.target.value)}
                  readOnly={credentialMeta.NYT_API_KEY.source === 'environment'}
                  title={credentialMeta.NYT_API_KEY.source === 'environment' ? 'Configured via NYT_API_KEY environment variable' : undefined}
                  placeholder="Enter New York Times API Key"
                  className={`w-full bg-black border border-[#333] rounded p-2 text-xs font-mono text-[#00ff00] outline-none focus:border-[#3498db] ${credentialMeta.NYT_API_KEY.source === 'environment' ? 'opacity-75 cursor-not-allowed' : ''}`}
                />
              </div>

              {/* News API */}
              <div className="bg-black/40 border border-[#3a3a3a] p-3 rounded hover:border-zinc-800 transition-all">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-[#3498db] font-bold uppercase text-xs">NEWS API KEY</label>
                  {credentialMeta.NEWS_API_KEY.source === 'environment' && (
                    <span className="text-xs font-bold uppercase text-emerald-400" title="Managed by server environment variable (takes precedence over runtime settings)">
                      ENV MANAGED
                    </span>
                  )}
                  {credentialMeta.NEWS_API_KEY.source === 'runtime' && (
                    <span className="text-xs font-bold uppercase text-zinc-300" title="Stored in server memory for the active session">
                      RUNTIME
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-300 block mb-2 leading-snug">Used for retrieving global corporate news headlines and media tickers.</span>
                <input
                  type="password"
                  value={newsApiKey}
                  onChange={(e) => setNewsApiKey(e.target.value)}
                  readOnly={credentialMeta.NEWS_API_KEY.source === 'environment'}
                  title={credentialMeta.NEWS_API_KEY.source === 'environment' ? 'Configured via NEWS_API_KEY environment variable' : undefined}
                  placeholder="Enter News API Key"
                  className={`w-full bg-black border border-[#333] rounded p-2 text-xs font-mono text-[#00ff00] outline-none focus:border-[#3498db] ${credentialMeta.NEWS_API_KEY.source === 'environment' ? 'opacity-75 cursor-not-allowed' : ''}`}
                />
              </div>

              {/* Newsdata.io */}
              <div className="bg-black/40 border border-[#3a3a3a] p-3 rounded hover:border-zinc-800 transition-all">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-[#3498db] font-bold uppercase text-xs">NEWSDATA.IO API KEY</label>
                  {credentialMeta.NEWSDATA_API_KEY.source === 'environment' && (
                    <span className="text-xs font-bold uppercase text-emerald-400" title="Managed by server environment variable (takes precedence over runtime settings)">
                      ENV MANAGED
                    </span>
                  )}
                  {credentialMeta.NEWSDATA_API_KEY.source === 'runtime' && (
                    <span className="text-xs font-bold uppercase text-zinc-300" title="Stored in server memory for the active session">
                      RUNTIME
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-300 block mb-2 leading-snug">Used for real-time market event feeds and business data syndication.</span>
                <input
                  type="password"
                  value={newsdataKey}
                  onChange={(e) => setNewsdataKey(e.target.value)}
                  readOnly={credentialMeta.NEWSDATA_API_KEY.source === 'environment'}
                  title={credentialMeta.NEWSDATA_API_KEY.source === 'environment' ? 'Configured via NEWSDATA_API_KEY environment variable' : undefined}
                  placeholder="Enter Newsdata.io API Key"
                  className={`w-full bg-black border border-[#333] rounded p-2 text-xs font-mono text-[#00ff00] outline-none focus:border-[#3498db] ${credentialMeta.NEWSDATA_API_KEY.source === 'environment' ? 'opacity-75 cursor-not-allowed' : ''}`}
                />
              </div>

              {/* FRED API */}
              <div className="bg-black/40 border border-[#3a3a3a] p-3 rounded hover:border-zinc-800 transition-all">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-[#3498db] font-bold uppercase text-xs">FRED API KEY (ST. LOUIS FED)</label>
                  {credentialMeta.FRED_API_KEY.source === 'environment' && (
                    <span className="text-xs font-bold uppercase text-emerald-400" title="Managed by server environment variable (takes precedence over runtime settings)">
                      ENV MANAGED
                    </span>
                  )}
                  {credentialMeta.FRED_API_KEY.source === 'runtime' && (
                    <span className="text-xs font-bold uppercase text-zinc-300" title="Stored in server memory for the active session">
                      RUNTIME
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-300 block mb-2 leading-snug">Used for live US Treasury yields, global macroeconomic indicators, economic release calendar, and H.10 FX rates.</span>
                <input
                  type="password"
                  value={fredKey}
                  onChange={(e) => setFredKey(e.target.value)}
                  readOnly={credentialMeta.FRED_API_KEY.source === 'environment'}
                  title={credentialMeta.FRED_API_KEY.source === 'environment' ? 'Configured via FRED_API_KEY environment variable' : undefined}
                  placeholder="Enter FRED API Key"
                  className={`w-full bg-black border border-[#333] rounded p-2 text-xs font-mono text-[#00ff00] outline-none focus:border-[#3498db] ${credentialMeta.FRED_API_KEY.source === 'environment' ? 'opacity-75 cursor-not-allowed' : ''}`}
                />
              </div>

              {/* 3SPREAD API */}
              <div className="bg-black/40 border border-[#3a3a3a] p-3 rounded hover:border-zinc-800 transition-all">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-[#3498db] font-bold uppercase text-xs">3SPREAD API KEY</label>
                  {credentialMeta['3SPREAD_API_KEY'].source === 'environment' && (
                    <span className="text-xs font-bold uppercase text-emerald-400" title="Managed by server environment variable (takes precedence over runtime settings)">
                      ENV MANAGED
                    </span>
                  )}
                  {credentialMeta['3SPREAD_API_KEY'].source === 'runtime' && (
                    <span className="text-xs font-bold uppercase text-zinc-300" title="Stored in server memory for the active session">
                      RUNTIME
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-300 block mb-2 leading-snug">Used for retrieving institutional ownership data, institutional manager activity, and 13F filing information.</span>
                <input
                  type="password"
                  value={threeSpreadKey}
                  onChange={(e) => setThreeSpreadKey(e.target.value)}
                  readOnly={credentialMeta['3SPREAD_API_KEY'].source === 'environment'}
                  title={credentialMeta['3SPREAD_API_KEY'].source === 'environment' ? 'Configured via 3SPREAD_API_KEY / THREESPREAD_API_KEY environment variable' : undefined}
                  placeholder="Enter 3SPREAD API Key"
                  className={`w-full bg-black border border-[#333] rounded p-2 text-xs font-mono text-[#00ff00] outline-none focus:border-[#3498db] ${credentialMeta['3SPREAD_API_KEY'].source === 'environment' ? 'opacity-75 cursor-not-allowed' : ''}`}
                />
              </div>
            </div>

            {/* Form actions */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2 select-none border-t border-[#3a3a3a]">
              <button
                type="submit"
                disabled={keysSaving || keysLoading}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#ff9900] text-black font-extrabold rounded text-xs select-none hover:bg-amber-500 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {keysSaving ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" />
                    <span>SAVING CONFIG...</span>
                  </>
                ) : (
                  <span>SAVE API CONFIGURATION</span>
                )}
              </button>

              <button
                type="button"
                onClick={handleCancelKeys}
                disabled={keysSaving || keysLoading}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#111] hover:bg-[#222] border border-[#333] hover:border-zinc-500 text-zinc-300 hover:text-white font-extrabold rounded text-xs select-none transition-colors flex items-center justify-center cursor-pointer"
              >
                <span>CANCEL</span>
              </button>

              {saveSuccess && (
                <span className="text-[#00ff00] font-bold text-xs">
                  ● CREDENTIALS STORED SAFELY IN SERVER MEMORY
                </span>
              )}

              {saveError && (
                <span className="text-[#ff4444] font-bold text-xs">
                  ● {saveError}
                </span>
              )}

              {cancelNotice && (
                <span className="text-zinc-300 font-bold text-xs">
                  ● CHANGES DISCARDED
                </span>
              )}
            </div>
          </form>

          {/* Connection Test / Diagnostic Panel */}
          <div className="mt-5 border-t border-[#333] pt-4">
            <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider block mb-2.5">DIAGNOSTIC & TEST PIPELINES</span>
            <div className="space-y-2.5">
              {DIAGNOSTIC_PIPELINES.map((pipeline) => {
                const diag = diagnostics[pipeline.id];
                const isTesting = diag.status === 'TESTING';
                const statusClass =
                  diag.status === 'CONNECTED'
                    ? 'text-[#00ff00] border-emerald-900/60 bg-emerald-950/30'
                    : diag.status === 'FAILED'
                    ? 'text-[#ff4444] border-red-900/60 bg-red-950/30'
                    : diag.status === 'TESTING'
                    ? 'text-[#ff9900] border-[#ff9900]/40 bg-[#ff9900]/10'
                    : 'text-zinc-300 border-zinc-800 bg-zinc-950';

                return (
                  <div key={pipeline.id} className="bg-black p-3.5 border border-[#3a3a3a] rounded">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[#ff9900] font-bold text-xs uppercase">
                            {pipeline.label}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded border text-xs font-bold uppercase tracking-wider leading-none ${statusClass}`}
                          >
                            {diag.status}
                          </span>
                        </div>
                        <span className="text-xs text-zinc-300 block leading-snug mt-0.5">
                          {pipeline.description}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => runDiagnosticTest(pipeline.id)}
                        disabled={isTesting}
                        className="w-full md:w-auto shrink-0 bg-[#111] hover:bg-[#222] active:bg-[#333] border border-[#333] hover:border-zinc-500 text-zinc-300 hover:text-white font-extrabold py-2 px-3 rounded uppercase text-xs text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isTesting ? (
                          <>
                            <RefreshCw size={11} className="animate-spin text-[#ff9900]" />
                            <span>TESTING...</span>
                          </>
                        ) : (
                          <span>TEST CONNECTION</span>
                        )}
                      </button>
                    </div>

                    {(diag.status === 'CONNECTED' || diag.status === 'FAILED') && diag.message && (
                      <div
                        className={`mt-2.5 px-3 py-2 border text-xs rounded leading-relaxed break-words font-mono flex flex-wrap items-start justify-between gap-2 ${
                          diag.status === 'CONNECTED'
                            ? 'bg-emerald-950/20 text-[#00ff00] border-emerald-900/40'
                            : 'bg-red-950/20 text-[#ff4444] border-red-900/40'
                        }`}
                      >
                        <span>
                          <span className="font-bold">{diag.status}:</span> {diag.message}
                        </span>
                        {typeof diag.latencyMs === 'number' && (
                          <span className="text-zinc-300 tabular-nums shrink-0">{diag.latencyMs}ms</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 bg-[#050505] border border-[#333] p-3 rounded text-xs text-zinc-300/90 leading-relaxed select-none">
            <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider block mb-1">
              SYSTEM ARCHITECTURE &amp; DATA ROUTING
            </span>
            Quorix routes external market data, economic indicators, foreign exchange rates, news, and AI requests through server-side API endpoints. This architecture centralizes external service integrations and helps protect API credentials from exposure in the browser.
          </div>
          </div>
        </div>
      )}

      {/* 10. HELP: INSTRUCTIONS DIRECTORY */}
      {activeScreen === 'HELP' && (
        <div className="bg-[#050505] border border-[#333] rounded p-4 animate-fade-in font-mono text-zinc-300">
          <div className="border-b border-[#333] pb-2 mb-4 flex justify-between items-center select-none">
            <span className="text-white text-md font-bold uppercase tracking-wider">
              Reference &amp; User Manual
            </span>
            <span className="text-xs text-zinc-300 font-mono">HLP CENTRAL REPOSITORIES</span>
          </div>

          <div className="text-xs">
          <p className="mb-4 leading-relaxed text-zinc-300">
            Welcome to the QUORIX Reference &amp; User Manual. This section provides guidance on navigating the terminal, understanding its features, working with market data and research tools, and configuring system settings. Use these resources to learn how each workspace functions, understand available capabilities, and get the most out of the QUORIX financial terminal.
          </p>

          <h3 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider border-b border-[#3a3a3a] pb-1 mb-2 select-none">Command Execution syntax</h3>
          <div className="space-y-2 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 py-1 border-b border-[#3a3a3a]/35">
              <span className="text-[#3498db] font-bold">TICKER_SYMBOL &lt;EQUITY&gt; SCREEN</span>
              <span className="text-zinc-200">GP, HP, DES, ANR, INST, NEWS</span>
              <span className="text-zinc-300">e.g. typing "NVDA DES" or "AAPL INST" inside the input bar.</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 py-1 border-b border-[#3a3a3a]/35">
              <span className="text-[#3498db] font-bold">DIRECTORY_CODES</span>
              <span className="text-zinc-200">CORR, PRM, INST, CRNC, ECO, POLY, ASK, HELP</span>
              <span className="text-zinc-300">Instant directory modules access directly.</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 py-1">
              <span className="text-[#3498db] font-bold">CONVERSATIONAL_PROMPTING</span>
              <span className="text-zinc-200">ASK AI Helper</span>
              <span className="text-zinc-300">Ask any custom finance questions in standard natural English!</span>
            </div>
          </div>

          <h3 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider border-b border-[#3a3a3a] pb-1 mb-2 select-none">
            Terminal Commands Reference
          </h3>
          <p className="text-zinc-300 mb-3">
            Type any command into the top <span className="text-[#ff9900] font-bold">&gt;</span> prompt and press{' '}
            <span className="text-zinc-200 font-bold">Enter</span> or click{' '}
            <span className="text-zinc-200 font-bold">EXEC</span>:
          </p>

          <div className="overflow-x-auto border border-[#3a3a3a] rounded mb-3 bg-black">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#0c0c0c] border-b border-[#333] text-xs uppercase tracking-wider text-zinc-300 select-none">
                  <th className="py-2 px-3 font-bold">Command</th>
                  <th className="py-2 px-3 font-bold">Module</th>
                  <th className="py-2 px-3 font-bold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a1a1a]">
                {[
                  {
                    command: 'ASK',
                    module: 'Ask QUORIX',
                    description: 'AI financial & macro analyst with Search Grounding',
                  },
                  {
                    command: 'NEWS',
                    module: 'News Hub',
                    description: 'Live multi-source financial news feed',
                  },
                  {
                    command: 'GP',
                    module: 'Graph Price',
                    description: 'Interactive OHLCV candlestick/line/area + Volume & RSI charts',
                  },
                  {
                    command: 'CORR',
                    module: 'Correlation Analyzer',
                    description: 'Security correlation & portfolio analysis',
                  },
                  {
                    command: 'PRM',
                    module: 'Portfolio Risk Monitor',
                    description: 'Personal portfolio exposure, concentration, volatility, correlation & downside stress testing',
                  },
                  {
                    command: 'HP',
                    module: 'Historical Pricing',
                    description: 'Tabular OHLCV historical price archive',
                  },
                  {
                    command: 'DES',
                    module: 'Security Analytics',
                    description: 'Core company overview, valuation metrics & bio',
                  },
                  {
                    command: 'ANR',
                    module: 'Analyst Recs',
                    description: 'Street consensus estimates & rating breakdown',
                  },
                  {
                    command: 'CRNC',
                    module: 'Currencies (FX)',
                    description: 'Live foreign exchange rates via FRED',
                  },
                  {
                    command: 'ECO',
                    module: 'Economic Indicator',
                    description: 'Macroeconomic dashboard & release calendar via FRED',
                  },
                  {
                    command: 'POLY',
                    module: 'Polymarket Screener',
                    description: 'Real-time prediction market odds & spreads',
                  },
                  {
                    command: 'INST',
                    module: 'Institutional Activity Monitor',
                    description: 'Institutional holdings, 13F position changes, accumulation screening & investor profiles',
                  },
                  {
                    command: 'SETT',
                    module: 'System Settings',
                    description: 'Configure API keys at runtime',
                  },
                  {
                    command: 'HELP',
                    module: 'User Manuals',
                    description: 'Command syntax & shortcut guide',
                  },
                ].map((row) => (
                  <tr key={row.command} className="hover:bg-[#0b0b0b] transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onExecuteCommand(row.command)}
                        className="text-[#3498db] hover:text-[#ff9900] font-bold cursor-pointer transition-colors"
                      >
                        {row.command}
                      </button>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-zinc-200 font-semibold">
                      {row.module}
                    </td>
                    <td className="py-2 px-3 text-zinc-300">{row.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-zinc-300 leading-relaxed">
            <span className="text-zinc-200 font-bold">Chained Commands:</span> Prefix a ticker symbol with a screen command, e.g.{' '}
            <button
              type="button"
              onClick={() => onExecuteCommand('NVDA GP')}
              className="text-[#3498db] hover:text-[#ff9900] font-bold cursor-pointer transition-colors"
            >
              NVDA GP
            </button>
            ,{' '}
            <button
              type="button"
              onClick={() => onExecuteCommand('TSLA DES')}
              className="text-[#3498db] hover:text-[#ff9900] font-bold cursor-pointer transition-colors"
            >
              TSLA DES
            </button>
            ,{' '}
            <button
              type="button"
              onClick={() => onExecuteCommand('BTC HP')}
              className="text-[#3498db] hover:text-[#ff9900] font-bold cursor-pointer transition-colors"
            >
              BTC HP
            </button>
            , or type a ticker symbol (
            <button
              type="button"
              onClick={() => onExecuteCommand('AAPL')}
              className="text-[#3498db] hover:text-[#ff9900] font-bold cursor-pointer transition-colors"
            >
              AAPL
            </button>
            ) to switch the active security.
          </p>
          </div>
        </div>
      )}
    </div>
  );
}

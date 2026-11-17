export interface StockData {
  symbol: string;
  name: string;
  exchange?: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  volume: number;
  marketCap: string;
  peRatio: number;
  beta: number;
  history: Array<{
    date: string;
    timestamp?: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    rsi?: number;
    ma3?: number;
    ema9?: number;
    ema20?: number;
    sma50?: number;
    vwap?: number;
    bbUpper?: number;
    bbMid?: number;
    bbLower?: number;
    psar?: number;
    psarUp?: boolean;
    volMa?: number;
    atr?: number;
    obv?: number;
    macd?: number;
    macdSignal?: number;
    macdHist?: number;
    stochK?: number;
    stochD?: number;
    cci?: number;
    adx?: number;
    plusDi?: number;
    minusDi?: number;
    roc?: number;
  }>;
  isRealTime?: boolean;
  isPreMarket?: boolean;
  isAfterHours?: boolean;
  preMarketPrice?: number;
  afterHoursPrice?: number;
  isCoreHours?: boolean;
  lastTickTime?: number;
  lastTickDirection?: 'up' | 'down';
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  time: string;
  symbol?: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  classification?: string;
  content?: string;
}

export interface EconomicIndicator {
  country: string;
  flag: string;
  gdpGrow: string;
  unemployment: string;
  inflation: string;
  rate: string;
  updatedAt?: string;
}

export interface FredMacroMetric {
  id: string;
  label: string;
  value: string;
  date: string;
  unit?: string;
}

export interface FredReleaseDate {
  releaseId: number;
  releaseName: string;
  date: string;
  fredUrl?: string;
  sourceUrl?: string | null;
  pressRelease?: boolean;
}

export interface CurrencyPair {
  pair: string;
  seriesId?: string;
  rate: number;
  prevRate?: number;
  change: number;
  date?: string;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  slug?: string;
  resolutionSource?: string;
  outcomes: string[];
  outcomePrices: string[];
  clobTokenIds?: string[];
  active: boolean;
  closed: boolean;
}

export interface PolymarketEvent {
  id: string;
  title: string;
  category?: string;
  volume?: number;
  markets: PolymarketMarket[];
  image?: string;
  slug?: string;
  resolutionSource?: string;
}

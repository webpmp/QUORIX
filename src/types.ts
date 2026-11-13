export interface StockData {
  symbol: string;
  name: string;
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
  markets: PolymarketMarket[];
  image?: string;
  slug?: string;
}

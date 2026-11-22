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
  preMarketPrice?: number | null;
  afterHoursPrice?: number | null;
  extHoursPrice?: number | null;
  extHoursChange?: number | null;
  extHoursChangePercent?: number | null;
  extHoursSession?: 'PRE' | 'POST' | null;
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

export type InstitutionalPositionStatus =
  | 'NEW'
  | 'INCREASED'
  | 'DECREASED'
  | 'EXITED'
  | 'UNCHANGED'
  | 'NO_PRIOR_DATA';

export interface InstitutionalHoldingRow {
  id: string;
  ticker: string | null;
  issuerName: string;
  cusip: string;
  figi: string | null;
  titleOfClass: string | null;
  managerCik: string;
  managerName: string;
  shares: number;
  sharesType: string;
  valueUsd: number;
  portfolioPct: number | null;
  previousShares: number | null;
  previousValueUsd: number | null;
  shareChange: number | null;
  percentChange: number | null;
  status: InstitutionalPositionStatus;
  reportingPeriod: string;
  previousPeriod: string | null;
  filingDate: string | null;
  filingId: string | null;
  sourceUrl: string | null;
  investmentDiscretion: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
}

export interface InstitutionalHoldingsSummary {
  totalReportedShares: number;
  totalReportedValueUsd: number;
  activeInstitutions: number;
  institutionsIncreasing: number;
  institutionsDecreasing: number;
  newPositions: number;
  exitedPositions: number;
  unchangedPositions: number;
  noPriorDataCount: number;
  netShareChange: number;
  netPercentChange: number | null;
}

export interface InstitutionalAccumulationRow {
  cusip: string;
  ticker: string | null;
  issuerName: string;
  titleOfClass: string | null;
  institutionsIncreasing: number;
  institutionsDecreasing: number;
  newPositions: number;
  exitedPositions: number;
  unchangedPositions: number;
  totalInstitutions: number;
  netShareChange: number;
  priorTotalShares: number;
  currentTotalShares: number;
  netPercentChange: number | null;
  totalValueUsd: number;
  reportingPeriod: string;
  previousPeriod: string;
  isAccumulating: boolean;
}

export interface InstitutionalManagerDirectoryItem {
  cik: string;
  name: string;
  latestFilingId: string;
  latestPeriod: string;
  latestFilingDate: string | null;
  tableEntryTotal: number | null;
  tableValueTotalUsd: number | null;
  formType: string;
  sourceUrl: string | null;
}

export interface InstitutionalInvestorProfile {
  managerCik: string;
  managerName: string;
  location: string | null;
  reportingPeriod: string;
  previousPeriod: string | null;
  filingDate: string | null;
  priorFilingDate: string | null;
  filingId: string;
  priorFilingId: string | null;
  sourceUrl: string | null;
  isConfidentialOmitted: boolean;
  totalValueUsd: number;
  priorTotalValueUsd: number | null;
  totalValueChangeUsd: number | null;
  totalValueChangePct: number | null;
  positionsCount: number;
  priorPositionsCount: number | null;
  newCount: number;
  increasedCount: number;
  decreasedCount: number;
  exitedCount: number;
  unchangedCount: number;
  largestHoldings: InstitutionalHoldingRow[];
  holdings: InstitutionalHoldingRow[];
  holdingsTruncated: boolean;
}

export interface InstitutionalPositionChangeRow {
  id: string;
  category: 'NEW' | 'INCREASED' | 'DECREASED' | 'EXITED';
  ticker: string | null;
  issuerName: string;
  cusip: string;
  managerCik: string;
  managerName: string;
  previousShares: number;
  currentShares: number;
  shareChange: number;
  percentChange: number | null;
  currentValueUsd: number;
  previousValueUsd: number;
  previousPeriod: string;
  currentPeriod: string;
  filingDate: string | null;
  sourceUrl: string | null;
}

export interface InstitutionalDataFreshness {
  provider: '3spread';
  latestAcceptedTime: string | null;
  latestPeriodOfReport: string | null;
  totalFilingsCount: number | null;
  fetchedAt: string;
}

export type SectorPerformancePeriod = '1W' | '1M' | '3M' | '6M';

export type SectorId =
  | 'TECHNOLOGY'
  | 'FINANCIALS'
  | 'HEALTHCARE'
  | 'CONSUMER_DISCRETIONARY'
  | 'CONSUMER_STAPLES'
  | 'ENERGY'
  | 'INDUSTRIALS'
  | 'MATERIALS'
  | 'UTILITIES'
  | 'REAL_ESTATE'
  | 'COMMUNICATION_SERVICES';

export type SectorRotationStatus =
  | 'LEADING'
  | 'IMPROVING'
  | 'WEAKENING'
  | 'LAGGING'
  | 'INSUFFICIENT_DATA';

export type SectorInstitutionalTrend =
  | 'ACCUMULATING'
  | 'DISTRIBUTING'
  | 'NEUTRAL'
  | 'INSUFFICIENT_DATA';

export type SectorInsiderSentimentStatus =
  | 'NET_BUYING'
  | 'BALANCED'
  | 'NET_SELLING'
  | 'UNAVAILABLE';

export interface SectorPeriodReturnPoint {
  returnPct: number | null;
  startDate: string | null;
  endDate: string | null;
  startPrice: number | null;
  endPrice: number | null;
}

export interface SectorPriceHistoryPoint {
  date: string;
  close: number;
}

export interface SectorMarketPerformance {
  etfTicker: string;
  etfName: string;
  latestPrice: number | null;
  latestDate: string | null;
  returns: Record<SectorPerformancePeriod, SectorPeriodReturnPoint>;
  relativeStrength: Record<SectorPerformancePeriod, number | null>;
  relativeStrengthRank: Record<SectorPerformancePeriod, number | null>;
  rotationStatus: Record<SectorPerformancePeriod, SectorRotationStatus>;
  history: SectorPriceHistoryPoint[];
  unavailableReason: string | null;
}

export interface SectorInstitutionalSummary {
  available: boolean;
  reportingPeriod: string | null;
  previousPeriod: string | null;
  comparableManagersTotal: number;
  activeManagersCount: number;
  managersIncreasing: number;
  managersDecreasing: number;
  managersUnchanged: number;
  newPositions: number;
  exitedPositions: number;
  increasedPositions: number;
  decreasedPositions: number;
  classifiedSecuritiesCount: number;
  priorTotalShares: number;
  currentTotalShares: number;
  netShareChange: number;
  netPercentChange: number | null;
  aggregateValueUsd: number;
  priorAggregateValueUsd: number;
  valueChangePct: number | null;
  trend: SectorInstitutionalTrend;
  topSecurities: InstitutionalAccumulationRow[];
  largestIncreases: InstitutionalPositionChangeRow[];
  largestDecreases: InstitutionalPositionChangeRow[];
  recentNewPositions: InstitutionalPositionChangeRow[];
  recentExits: InstitutionalPositionChangeRow[];
}

export interface SectorInsiderSentiment {
  available: boolean;
  buysDollars: number | null;
  sellsDollars: number | null;
  buysCount: number | null;
  sellsCount: number | null;
  buySellRatio: number | null;
  since: string | null;
  until: string | null;
  windowDays: number;
  sicCodesQueried: string[];
  sicCodesWithActivity: number;
  sentiment: SectorInsiderSentimentStatus;
  unavailableReason: string | null;
}

export interface SectorRotationItem {
  id: SectorId;
  name: string;
  shortName: string;
  etfTicker: string;
  etfName: string;
  market: SectorMarketPerformance;
  institutional: SectorInstitutionalSummary;
  insider: SectorInsiderSentiment;
}

export interface SectorClassificationCoverage {
  totalSecuritiesInCohort: number;
  classifiedSecuritiesCount: number;
  unclassifiedSecuritiesCount: number;
  unclassifiedFundOrEtfCount: number;
  unclassifiedUnknownCount: number;
  classifiedValueUsd: number;
  unclassifiedValueUsd: number;
  classifiedValuePct: number | null;
  threeSpreadSicMatchedCount: number;
  marketSectorMatchedCount: number;
  directSectorEtfMatchedCount: number;
}

export interface SectorRotationOverviewByPeriod {
  strongestSector: { id: SectorId; name: string; etfTicker: string; returnPct: number; relativeStrengthPct: number | null } | null;
  weakestSector: { id: SectorId; name: string; etfTicker: string; returnPct: number; relativeStrengthPct: number | null } | null;
  outperformingCount: number;
  underperformingCount: number;
  improvingSectors: Array<{ id: SectorId; name: string; etfTicker: string }>;
  weakeningSectors: Array<{ id: SectorId; name: string; etfTicker: string }>;
}

export interface SectorRotationResponse {
  success: boolean;
  fetchedAt: string;
  benchmark: {
    ticker: string;
    name: string;
    latestPrice: number | null;
    latestDate: string | null;
    returns: Record<SectorPerformancePeriod, SectorPeriodReturnPoint>;
    history: SectorPriceHistoryPoint[];
    unavailableReason: string | null;
  };
  overviewByPeriod: Record<SectorPerformancePeriod, SectorRotationOverviewByPeriod>;
  sectors: SectorRotationItem[];
  institutionalMeta: {
    available: boolean;
    requiresKey: boolean;
    rateLimited: boolean;
    error: string | null;
    reportingPeriod: string | null;
    previousPeriod: string | null;
    availablePeriods: string[];
    managersAnalyzed: number;
    freshness: InstitutionalDataFreshness | null;
    coverage: SectorClassificationCoverage;
  };
  insiderMeta: {
    available: boolean;
    windowDays: number;
    since: string | null;
    until: string | null;
    note: string;
  };
  methodology: {
    marketPerformance: string;
    rotationClassification: string;
    institutionalPositioning: string;
    insiderSentiment: string;
  };
}



import type {
  PortfolioAccount,
  PortfolioHolding,
  PortfolioRiskThresholds,
  PortfolioSecurityMetadata,
  SectorId,
  StockData,
} from '../types';
import {
  MIN_PAIRWISE_OBSERVATIONS,
  alignSecurityReturns,
  buildCorrelationMatrix,
  computeDailyReturns,
  computePearsonCorrelation,
  formatCorrelationValue,
  getLookbackConfig,
  interpretCorrelation,
  shiftIsoDate,
  type CorrelationMatrixResult,
  type LookbackPeriodId,
  type SecurityHistorySeries,
} from './correlation';
import {
  SECTOR_BY_ID,
  isBroadMarketOrMultiSectorFund,
  mapMarketSectorToGicsSector,
  matchDirectSectorEtf,
} from './sectorRotation';
import { DEFAULT_PORTFOLIO_THRESHOLDS } from './portfolioStorage';

const TRADING_DAYS_PER_YEAR = 252;
const EPSILON = 1e-18;

export interface EnrichedPortfolioPosition {
  id: string;
  ticker: string;
  name: string;
  exchange: string;
  instrumentType: string;
  isEtfOrFund: boolean;
  shares: number;
  currentPrice: number | null;
  priceSource: 'metadata' | 'quote' | 'history' | 'unavailable';
  priceUnavailable: boolean;
  marketValue: number | null;
  weightPct: number | null;
  equityWeightPct: number | null;
  avgCostBasis: number | null;
  costValue: number | null;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
  positionRank: number | null;
  isOversized: boolean;
  isUnderallocated: boolean;
  sector: string;
  gicsSectorId: SectorId | null;
  sectorClassified: boolean;
  industry: string;
  industryClassified: boolean;
  classificationMethod: string;
  annualizedVolatilityPct: number | null;
  betaVsSpy: number | null;
  maxDrawdownPct: number | null;
  riskContributionPct: number | null;
  componentVolContributionPct: number | null;
  marginalRiskPct: number | null;
  weightedAvgCorrWithPortfolio: number | null;
  limitedDiversificationBenefit: boolean;
  historyObservationCount: number;
  historyWarning: string | null;
  source: PortfolioHolding['source'];
}

export interface ConcentrationWarning {
  id: string;
  severity: 'high' | 'moderate';
  title: string;
  detail: string;
  tickers?: string[];
}

export interface ConcentrationAnalysis {
  largestPosition: { ticker: string; name: string; weightPct: number; marketValue: number } | null;
  top5WeightPct: number;
  top10WeightPct: number;
  singleStockWeightPct: number;
  etfFundWeightPct: number;
  cashWeightPct: number;
  hhi: number | null;
  effectivePositions: number | null;
  concentrationLabel: 'Low' | 'Moderate' | 'High' | 'Very High' | 'Unavailable';
  oversizedPositions: EnrichedPortfolioPosition[];
  underallocatedPositions: EnrichedPortfolioPosition[];
  distributionAssessment: string;
  warnings: ConcentrationWarning[];
}

export interface SectorAllocationRow {
  sector: string;
  gicsSectorId: SectorId | null;
  isClassified: boolean;
  marketValue: number;
  portfolioWeightPct: number;
  equityWeightPct: number;
  holdingCount: number;
  largestHoldings: Array<{ ticker: string; weightPct: number; marketValue: number }>;
  riskContributionPct: number | null;
  status: 'overweight' | 'underweight' | 'balanced' | 'unclassified';
  benchmarkWeightPct: number | null;
  activeWeightDeltaPct: number | null;
}

export interface IndustryAllocationRow {
  industry: string;
  sector: string;
  isClassified: boolean;
  marketValue: number;
  portfolioWeightPct: number;
  holdingCount: number;
  tickers: string[];
}

export interface SectorExposureAnalysis {
  sectors: SectorAllocationRow[];
  industries: IndustryAllocationRow[];
  classifiedEquityValue: number;
  classifiedEquityPct: number;
  unclassifiedEquityValue: number;
  unclassifiedEquityPct: number;
  unclassifiedHoldings: Array<{ ticker: string; reason: string; weightPct: number | null }>;
  overweightSectors: SectorAllocationRow[];
  underweightSectors: SectorAllocationRow[];
  benchmarkAvailable: boolean;
  benchmarkUnavailableReason: string | null;
}

export interface DrawdownCurvePoint {
  date: string;
  indexedValue: number;
  drawdownPct: number;
}

export interface VolatilityRiskAnalysis {
  lookbackPeriod: LookbackPeriodId;
  lookbackLabel: string;
  startDate: string | null;
  endDate: string | null;
  alignedSessionCount: number;
  coveredEquityWeightPct: number;
  coveredTotalWeightPct: number;
  portfolioVolatilityPct: number | null;
  weightedAvgHoldingVolPct: number | null;
  diversificationRatio: number | null;
  portfolioBetaVsSpy: number | null;
  betaObservationCount: number;
  maxDrawdownPct: number | null;
  maxDrawdownPeakDate: string | null;
  maxDrawdownTroughDate: string | null;
  drawdownCurve: DrawdownCurvePoint[];
  largestVolContributors: EnrichedPortfolioPosition[];
  riskBySector: Array<{
    sector: string;
    portfolioWeightPct: number;
    riskContributionPct: number;
  }>;
  excludedFromRiskModel: Array<{ ticker: string; reason: string; weightPct: number | null }>;
  unavailableReason: string | null;
  methodologySummary: string;
}

export interface CorrelatedPairItem {
  symbolA: string;
  symbolB: string;
  correlation: number;
  observationCount: number;
  combinedWeightPct: number;
  sameSector: boolean;
  sharedSector: string | null;
  bandLabel: string;
}

export interface CorrelationCluster {
  id: string;
  tickers: string[];
  combinedWeightPct: number;
  avgCorrelation: number;
  maxCorrelation: number;
  sectors: string[];
  isSameSectorCluster: boolean;
}

export interface DiversificationAnalysis {
  matrix: CorrelationMatrixResult;
  highCorrelationThreshold: number;
  highlyCorrelatedPairs: CorrelatedPairItem[];
  clusters: CorrelationCluster[];
  sectorOverlapPairs: CorrelatedPairItem[];
  concentratedCorrelatedWeightPct: number;
  weightedAvgPairwiseCorrelation: number | null;
  limitedDiversificationHoldings: EnrichedPortfolioPosition[];
  assessmentLabel:
    | 'Well Diversified'
    | 'Moderately Diversified'
    | 'Correlated / Concentrated'
    | 'Highly Concentrated'
    | 'Insufficient Data';
  assessmentTone: 'positive' | 'neutral' | 'warning' | 'negative';
  assessmentSummary: string;
  assessmentDrivers: string[];
}

export interface RiskAssessmentSummary {
  level: 'Low' | 'Moderate' | 'Elevated' | 'High' | 'Unavailable';
  tone: 'positive' | 'neutral' | 'warning' | 'negative';
  drivers: string[];
}

export interface ScenarioContributor {
  ticker: string;
  name: string;
  sector: string;
  marketValue: number;
  weightPct: number;
  appliedShockPct: number;
  betaUsed: number | null;
  usedFallbackBeta: boolean;
  dollarImpact: number;
  portfolioImpactPct: number;
}

export interface DownsideScenarioResult {
  id: string;
  name: string;
  category: 'market_spy' | 'sector' | 'position' | 'concentrated_stress';
  description: string;
  methodologyNote: string;
  baselinePortfolioValue: number;
  estimatedLossDollars: number; // Negative for loss, positive for gain
  estimatedLossPct: number; // Negative % for loss
  remainingPortfolioValue: number;
  cashBufferValue: number;
  usedFallbackBetaTickers: string[];
  unpricedTickers: string[];
  contributors: ScenarioContributor[];
}

export interface PortfolioRiskAnalysis {
  portfolioId: string;
  portfolioName: string;
  totalPortfolioValue: number;
  totalEquityValue: number;
  cashBalance: number;
  cashWeightPct: number;
  holdingCount: number;
  pricedHoldingCount: number;
  unpricedHoldings: EnrichedPortfolioPosition[];
  totalCostValue: number | null;
  totalUnrealizedGain: number | null;
  totalUnrealizedGainPct: number | null;
  costBasisCoverageCount: number;
  positions: EnrichedPortfolioPosition[];
  concentration: ConcentrationAnalysis;
  sectorExposure: SectorExposureAnalysis;
  volatilityRisk: VolatilityRiskAnalysis;
  diversification: DiversificationAnalysis;
  marketScenarios: DownsideScenarioResult[];
  concentratedStressScenarios: DownsideScenarioResult[];
  overallRisk: RiskAssessmentSummary;
  dataWarnings: string[];
}

export interface ComputePortfolioRiskInput {
  portfolio: PortfolioAccount;
  metadataMap: Record<string, PortfolioSecurityMetadata | undefined>;
  stocksMap?: Record<string, StockData | undefined>;
  historyMap: Record<string, SecurityHistorySeries | undefined>;
  spySeries?: SecurityHistorySeries | null;
  lookbackPeriod: LookbackPeriodId;
  thresholds?: Partial<PortfolioRiskThresholds>;
  benchmarkSectorWeights?: Record<string, number> | null;
}

function sampleMean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function sampleVariance(values: readonly number[], mean?: number): number | null {
  if (values.length < 2) return null;
  const m = mean !== undefined ? mean : sampleMean(values);
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - m;
    sumSq += d * d;
  }
  return sumSq / (values.length - 1);
}

function sampleCovariance(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const meanX = sampleMean(xs.slice(0, n));
  const meanY = sampleMean(ys.slice(0, n));
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (xs[i] - meanX) * (ys[i] - meanY);
  }
  return sum / (n - 1);
}

function computeSeriesMaxDrawdown(returns: readonly { date: string; ret: number }[]): {
  maxDrawdownPct: number | null;
  peakDate: string | null;
  troughDate: string | null;
  curve: DrawdownCurvePoint[];
} {
  if (returns.length < 2) {
    return { maxDrawdownPct: null, peakDate: null, troughDate: null, curve: [] };
  }

  let equity = 100;
  let peak = 100;
  let peakDate = returns[0].date;
  let maxDd = 0;
  let maxPeakDate: string | null = returns[0].date;
  let maxTroughDate: string | null = returns[0].date;
  const curve: DrawdownCurvePoint[] = [];

  for (const pt of returns) {
    equity = equity * (1 + pt.ret);
    if (equity > peak) {
      peak = equity;
      peakDate = pt.date;
    }
    const ddPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    if (ddPct < maxDd) {
      maxDd = ddPct;
      maxPeakDate = peakDate;
      maxTroughDate = pt.date;
    }
    curve.push({
      date: pt.date,
      indexedValue: Number(equity.toFixed(4)),
      drawdownPct: Number(ddPct.toFixed(4)),
    });
  }

  return {
    maxDrawdownPct: maxDd,
    peakDate: maxPeakDate,
    troughDate: maxTroughDate,
    curve,
  };
}

function resolveClassification(
  ticker: string,
  meta: PortfolioSecurityMetadata | undefined,
  fallbackName: string,
  fallbackInstrumentType: string
): {
  sector: string;
  gicsSectorId: SectorId | null;
  sectorClassified: boolean;
  industry: string;
  industryClassified: boolean;
  isEtfOrFund: boolean;
  classificationMethod: string;
} {
  const instType = (meta?.instrumentType || fallbackInstrumentType || 'EQUITY').toUpperCase();
  const name = meta?.name || fallbackName || ticker;
  const isEtfOrFund =
    instType === 'ETF' ||
    instType === 'MUTUALFUND' ||
    instType === 'INDEX' ||
    instType === 'CLOSEDENDFUND' ||
    isBroadMarketOrMultiSectorFund(name);

  // 1. Direct single-sector SPDR ETF match
  const directSectorId = meta?.gicsSectorId || matchDirectSectorEtf(name, ticker);
  if (directSectorId && SECTOR_BY_ID[directSectorId]) {
    const sectorName = SECTOR_BY_ID[directSectorId].name;
    const rawIndustry = meta?.industry?.trim() || null;
    return {
      sector: sectorName,
      gicsSectorId: directSectorId,
      sectorClassified: true,
      industry: rawIndustry || (isEtfOrFund ? `${sectorName} Sector ETF` : 'Unclassified'),
      industryClassified: Boolean(rawIndustry || isEtfOrFund),
      isEtfOrFund,
      classificationMethod: meta?.classificationMethod || 'sector_etf',
    };
  }

  // 2. Verified market sector from metadata (Yahoo Search)
  const rawSector = meta?.sector?.trim() || '';
  if (rawSector && !isEtfOrFund) {
    const mappedGics = mapMarketSectorToGicsSector(rawSector);
    const displaySector = mappedGics ? SECTOR_BY_ID[mappedGics].name : rawSector;
    const rawIndustry = meta?.industry?.trim() || '';
    return {
      sector: displaySector,
      gicsSectorId: mappedGics,
      sectorClassified: true,
      industry: rawIndustry || 'Unclassified',
      industryClassified: Boolean(rawIndustry),
      isEtfOrFund: false,
      classificationMethod: meta?.classificationMethod || 'yahoo_search',
    };
  }

  // 3. Explicitly unclassified (never invent missing classifications)
  return {
    sector: isEtfOrFund ? 'Unclassified (Broad ETF / Fund)' : 'Unclassified',
    gicsSectorId: null,
    sectorClassified: false,
    industry: isEtfOrFund ? 'Broad Market / Multi-Sector Fund' : 'Unclassified',
    industryClassified: false,
    isEtfOrFund,
    classificationMethod: isEtfOrFund ? 'unclassified_fund' : 'unavailable',
  };
}

/**
 * Computes a hypothetical downside risk scenario using actual portfolio weights and
 * either beta-scaled SPY shocks, sector-specific shocks, or explicit per-ticker shocks.
 */
export function computeDownsideScenario(params: {
  id: string;
  name: string;
  category: DownsideScenarioResult['category'];
  description: string;
  methodologyNote: string;
  positions: readonly EnrichedPortfolioPosition[];
  cashBalance: number;
  totalPortfolioValue: number;
  spyShockPct?: number; // e.g. -10 for -10%
  sectorShock?: { sector: string; shockPct: number };
  positionShocks?: Record<string, number>; // ticker -> shockPct (e.g. -20)
}): DownsideScenarioResult {
  const {
    id,
    name,
    category,
    description,
    methodologyNote,
    positions,
    cashBalance,
    totalPortfolioValue,
    spyShockPct,
    sectorShock,
    positionShocks,
  } = params;

  const contributors: ScenarioContributor[] = [];
  const usedFallbackBetaTickers: string[] = [];
  const unpricedTickers: string[] = [];
  let totalDollarImpact = 0;

  for (const pos of positions) {
    if (pos.marketValue === null || pos.weightPct === null) {
      unpricedTickers.push(pos.ticker);
      continue;
    }

    let appliedShockPct = 0;
    let betaUsed: number | null = null;
    let usedFallbackBeta = false;

    if (spyShockPct !== undefined) {
      if (pos.betaVsSpy !== null && Number.isFinite(pos.betaVsSpy)) {
        betaUsed = pos.betaVsSpy;
        appliedShockPct = Math.max(-100, pos.betaVsSpy * spyShockPct);
      } else {
        // Explicit 1.0x fallback disclosed transparently when a holding lacks SPY beta history
        betaUsed = 1.0;
        usedFallbackBeta = true;
        usedFallbackBetaTickers.push(pos.ticker);
        appliedShockPct = Math.max(-100, spyShockPct);
      }
    } else if (sectorShock) {
      if (pos.sector === sectorShock.sector) {
        appliedShockPct = Math.max(-100, sectorShock.shockPct);
      }
    } else if (positionShocks) {
      const custom = positionShocks[pos.ticker];
      if (typeof custom === 'number' && Number.isFinite(custom)) {
        appliedShockPct = Math.max(-100, custom);
      }
    }

    const dollarImpact = pos.marketValue * (appliedShockPct / 100);
    const portfolioImpactPct =
      totalPortfolioValue > 0 ? (dollarImpact / totalPortfolioValue) * 100 : 0;
    totalDollarImpact += dollarImpact;

    if (Math.abs(appliedShockPct) > 0 || spyShockPct !== undefined) {
      contributors.push({
        ticker: pos.ticker,
        name: pos.name,
        sector: pos.sector,
        marketValue: pos.marketValue,
        weightPct: pos.weightPct,
        appliedShockPct,
        betaUsed,
        usedFallbackBeta,
        dollarImpact,
        portfolioImpactPct,
      });
    }
  }

  // Sort by largest downside loss first (most negative dollarImpact first)
  contributors.sort((a, b) => a.dollarImpact - b.dollarImpact);

  const estimatedLossPct =
    totalPortfolioValue > 0 ? (totalDollarImpact / totalPortfolioValue) * 100 : 0;
  const remainingPortfolioValue = Math.max(0, totalPortfolioValue + totalDollarImpact);

  return {
    id,
    name,
    category,
    description,
    methodologyNote,
    baselinePortfolioValue: totalPortfolioValue,
    estimatedLossDollars: totalDollarImpact,
    estimatedLossPct,
    remainingPortfolioValue,
    cashBufferValue: cashBalance,
    usedFallbackBetaTickers,
    unpricedTickers,
    contributors,
  };
}

/**
 * Main Portfolio Risk Analytics Engine.
 * Agnostic to holding origin (manual, CSV, or tracked watchlist).
 * Reuses CORR's correlation matrix and daily return alignment directly.
 */
export function computePortfolioRiskAnalysis(
  input: ComputePortfolioRiskInput
): PortfolioRiskAnalysis {
  const {
    portfolio,
    metadataMap,
    stocksMap = {},
    historyMap,
    spySeries,
    lookbackPeriod,
    benchmarkSectorWeights = null,
  } = input;

  const thresholds: PortfolioRiskThresholds = {
    ...DEFAULT_PORTFOLIO_THRESHOLDS,
    ...(input.thresholds || {}),
  };

  const cfg = getLookbackConfig(lookbackPeriod);
  const cashBalance = Number.isFinite(portfolio.cashBalance) && portfolio.cashBalance >= 0
    ? portfolio.cashBalance
    : 0;

  const dataWarnings: string[] = [];

  // 1. Price and value each holding
  const preliminary = portfolio.holdings.map((h) => {
    const meta = metadataMap[h.ticker];
    const quote = stocksMap[h.ticker];
    const hist = historyMap[h.ticker];

    let currentPrice: number | null = null;
    let priceSource: EnrichedPortfolioPosition['priceSource'] = 'unavailable';

    if (meta && typeof meta.price === 'number' && Number.isFinite(meta.price) && meta.price > 0) {
      currentPrice = meta.price;
      priceSource = 'metadata';
    } else if (quote && typeof quote.price === 'number' && Number.isFinite(quote.price) && quote.price > 0) {
      currentPrice = quote.price;
      priceSource = 'quote';
    } else if (hist && hist.bars.length > 0) {
      const lastBar = hist.bars[hist.bars.length - 1];
      const lastPrice = lastBar.close > 0 ? lastBar.close : lastBar.adjClose;
      if (Number.isFinite(lastPrice) && lastPrice > 0) {
        currentPrice = lastPrice;
        priceSource = 'history';
      }
    }

    const marketValue = currentPrice !== null ? h.shares * currentPrice : null;
    const costValue =
      h.avgCostBasis !== null && Number.isFinite(h.avgCostBasis) && h.avgCostBasis > 0
        ? h.shares * h.avgCostBasis
        : null;
    const unrealizedGain =
      marketValue !== null && costValue !== null ? marketValue - costValue : null;
    const unrealizedGainPct =
      unrealizedGain !== null && costValue !== null && costValue > 0
        ? (unrealizedGain / costValue) * 100
        : null;

    const fallbackName = quote?.name || hist?.name || h.ticker;
    const fallbackInst = hist?.instrumentType || 'EQUITY';
    const classification = resolveClassification(h.ticker, meta, fallbackName, fallbackInst);

    return {
      holding: h,
      name: meta?.name || fallbackName,
      exchange: meta?.exchange || quote?.exchange || hist?.exchange || '',
      instrumentType: meta?.instrumentType || fallbackInst,
      currentPrice,
      priceSource,
      marketValue,
      costValue,
      unrealizedGain,
      unrealizedGainPct,
      classification,
    };
  });

  const totalEquityValue = preliminary.reduce(
    (sum, item) => sum + (item.marketValue !== null ? item.marketValue : 0),
    0
  );
  const totalPortfolioValue = totalEquityValue + cashBalance;
  const cashWeightPct =
    totalPortfolioValue > 0 ? (cashBalance / totalPortfolioValue) * 100 : 0;

  let costBasisCoverageCount = 0;
  let totalCostSum = 0;
  let totalCostMatchedMarketSum = 0;

  // Build position records with weights
  const positions: EnrichedPortfolioPosition[] = preliminary.map((item) => {
    const weightPct =
      item.marketValue !== null && totalPortfolioValue > 0
        ? (item.marketValue / totalPortfolioValue) * 100
        : null;
    const equityWeightPct =
      item.marketValue !== null && totalEquityValue > 0
        ? (item.marketValue / totalEquityValue) * 100
        : null;

    if (item.costValue !== null && item.marketValue !== null) {
      costBasisCoverageCount++;
      totalCostSum += item.costValue;
      totalCostMatchedMarketSum += item.marketValue;
    }

    return {
      id: item.holding.id,
      ticker: item.holding.ticker,
      name: item.name,
      exchange: item.exchange,
      instrumentType: item.instrumentType,
      isEtfOrFund: item.classification.isEtfOrFund,
      shares: item.holding.shares,
      currentPrice: item.currentPrice,
      priceSource: item.priceSource,
      priceUnavailable: item.currentPrice === null,
      marketValue: item.marketValue,
      weightPct,
      equityWeightPct,
      avgCostBasis: item.holding.avgCostBasis,
      costValue: item.costValue,
      unrealizedGain: item.unrealizedGain,
      unrealizedGainPct: item.unrealizedGainPct,
      positionRank: null,
      isOversized: weightPct !== null && weightPct > thresholds.maxSinglePositionPct,
      isUnderallocated: weightPct !== null && weightPct < thresholds.minPositionPct,
      sector: item.classification.sector,
      gicsSectorId: item.classification.gicsSectorId,
      sectorClassified: item.classification.sectorClassified,
      industry: item.classification.industry,
      industryClassified: item.classification.industryClassified,
      classificationMethod: item.classification.classificationMethod,
      annualizedVolatilityPct: null,
      betaVsSpy: null,
      maxDrawdownPct: null,
      riskContributionPct: null,
      componentVolContributionPct: null,
      marginalRiskPct: null,
      weightedAvgCorrWithPortfolio: null,
      limitedDiversificationBenefit: false,
      historyObservationCount: 0,
      historyWarning: null,
      source: item.holding.source,
    };
  });

  // Sort by weight descending to assign ranks
  const sortedByWeight = [...positions].sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1));
  let rankCursor = 1;
  for (const pos of sortedByWeight) {
    if (pos.weightPct !== null) {
      pos.positionRank = rankCursor++;
    }
  }

  const pricedPositions = sortedByWeight.filter((p) => p.marketValue !== null && p.weightPct !== null);
  const unpricedHoldings = sortedByWeight.filter((p) => p.priceUnavailable);
  if (unpricedHoldings.length > 0) {
    dataWarnings.push(
      `Market price unavailable for ${unpricedHoldings.map((u) => u.ticker).join(', ')} — excluded from value-weighted totals.`
    );
  }

  const totalCostValue = costBasisCoverageCount > 0 ? totalCostSum : null;
  const totalUnrealizedGain =
    costBasisCoverageCount > 0 ? totalCostMatchedMarketSum - totalCostSum : null;
  const totalUnrealizedGainPct =
    totalUnrealizedGain !== null && totalCostSum > 0
      ? (totalUnrealizedGain / totalCostSum) * 100
      : null;

  // 2. Individual & Portfolio Volatility, Covariance, Risk Contribution, Beta & Max Drawdown
  const spyReturns = spySeries && spySeries.bars.length >= 2 ? computeDailyReturns(spySeries.bars) : [];
  const spyReturnMap = new Map<string, number>();
  for (const pt of spyReturns) spyReturnMap.set(pt.date, pt.ret);

  // Per-holding returns within lookback window
  const holdingReturnMaps = new Map<string, Map<string, number>>();
  const holdingSeriesList: SecurityHistorySeries[] = [];
  const excludedFromRiskModel: Array<{ ticker: string; reason: string; weightPct: number | null }> = [];

  for (const pos of pricedPositions) {
    const series = historyMap[pos.ticker];
    if (!series || series.bars.length < 2) {
      pos.historyWarning = series?.error || 'Historical adjusted daily prices unavailable.';
      excludedFromRiskModel.push({
        ticker: pos.ticker,
        reason: pos.historyWarning,
        weightPct: pos.weightPct,
      });
      continue;
    }

    holdingSeriesList.push(series);
    const allReturns = computeDailyReturns(series.bars);
    if (allReturns.length === 0) {
      pos.historyWarning = 'No valid daily return observations.';
      excludedFromRiskModel.push({
        ticker: pos.ticker,
        reason: pos.historyWarning,
        weightPct: pos.weightPct,
      });
      continue;
    }

    const latestDate = allReturns[allReturns.length - 1].date;
    const cutoffDate = shiftIsoDate(latestDate, -cfg.calendarDays);
    const windowReturns = allReturns.filter((r) => r.date >= cutoffDate);
    pos.historyObservationCount = windowReturns.length;

    if (windowReturns.length < MIN_PAIRWISE_OBSERVATIONS) {
      pos.historyWarning = `Only ${windowReturns.length} daily observations in ${cfg.label} window (${MIN_PAIRWISE_OBSERVATIONS} required).`;
      excludedFromRiskModel.push({
        ticker: pos.ticker,
        reason: pos.historyWarning,
        weightPct: pos.weightPct,
      });
      continue;
    }

    const rMap = new Map<string, number>();
    for (const r of windowReturns) rMap.set(r.date, r.ret);
    holdingReturnMaps.set(pos.ticker, rMap);

    // Individual annualized volatility
    const vals = windowReturns.map((r) => r.ret);
    const variance = sampleVariance(vals);
    if (variance !== null && variance >= 0) {
      pos.annualizedVolatilityPct = Math.sqrt(variance * TRADING_DAYS_PER_YEAR) * 100;
    }

    // Individual max drawdown
    const dd = computeSeriesMaxDrawdown(windowReturns);
    pos.maxDrawdownPct = dd.maxDrawdownPct;

    // Individual beta vs SPY
    if (spySeries && spySeries.bars.length >= 2) {
      const alignedSpy = alignSecurityReturns(series.bars, spySeries.bars);
      if (alignedSpy.length > 0) {
        const latestSpyDate = alignedSpy[alignedSpy.length - 1].date;
        const spyCutoff = shiftIsoDate(latestSpyDate, -cfg.calendarDays);
        const winSpy = alignedSpy.filter((o) => o.date >= spyCutoff);
        if (winSpy.length >= MIN_PAIRWISE_OBSERVATIONS) {
          const xs = winSpy.map((o) => o.retA);
          const ys = winSpy.map((o) => o.retB);
          const varSpy = sampleVariance(ys);
          const cov = sampleCovariance(xs, ys);
          if (varSpy !== null && varSpy > EPSILON && cov !== null) {
            pos.betaVsSpy = cov / varSpy;
          }
        }
      }
    }
  }

  // Find common aligned dates across eligible risk-model holdings
  // If a tiny/short-history holding collapses the common intersection below MIN_PAIRWISE_OBSERVATIONS,
  // drop the shortest-coverage holding iteratively so core portfolio analytics remain computable.
  let modeledPositions = pricedPositions.filter((p) => holdingReturnMaps.has(p.ticker));

  const getCommonDates = (subset: readonly EnrichedPortfolioPosition[]): string[] => {
    if (subset.length === 0) return [];
    const firstMap = holdingReturnMaps.get(subset[0].ticker);
    if (!firstMap) return [];
    let common = Array.from(firstMap.keys());
    for (let i = 1; i < subset.length; i++) {
      const nextMap = holdingReturnMaps.get(subset[i].ticker);
      if (!nextMap) return [];
      common = common.filter((d) => nextMap.has(d));
    }
    return common.sort((a, b) => a.localeCompare(b));
  };

  let commonDates = getCommonDates(modeledPositions);
  while (modeledPositions.length > 1 && commonDates.length < MIN_PAIRWISE_OBSERVATIONS) {
    // Drop the holding with the fewest observations
    let worstIdx = 0;
    for (let i = 1; i < modeledPositions.length; i++) {
      if (modeledPositions[i].historyObservationCount < modeledPositions[worstIdx].historyObservationCount) {
        worstIdx = i;
      }
    }
    const [dropped] = modeledPositions.splice(worstIdx, 1);
    const reason = `Insufficient overlapping dates with the rest of the portfolio in ${cfg.label} lookback.`;
    dropped.historyWarning = reason;
    excludedFromRiskModel.push({ ticker: dropped.ticker, reason, weightPct: dropped.weightPct });
    commonDates = getCommonDates(modeledPositions);
  }

  const coveredEquityValue = modeledPositions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const coveredEquityWeightPct =
    totalEquityValue > 0 ? (coveredEquityValue / totalEquityValue) * 100 : 0;
  const coveredTotalWeightPct =
    totalPortfolioValue > 0 ? ((coveredEquityValue + cashBalance) / totalPortfolioValue) * 100 : 0;

  let portfolioVolatilityPct: number | null = null;
  let weightedAvgHoldingVolPct: number | null = null;
  let diversificationRatio: number | null = null;
  let portfolioBetaVsSpy: number | null = null;
  let betaObservationCount = 0;
  let maxDrawdownPct: number | null = null;
  let maxDrawdownPeakDate: string | null = null;
  let maxDrawdownTroughDate: string | null = null;
  let drawdownCurve: DrawdownCurvePoint[] = [];
  let volatilityUnavailableReason: string | null = null;

  if (modeledPositions.length === 0 || commonDates.length < MIN_PAIRWISE_OBSERVATIONS) {
    volatilityUnavailableReason =
      pricedPositions.length === 0
        ? 'Add priced holdings to calculate historical portfolio volatility, beta, and drawdown.'
        : `Insufficient aligned historical daily returns (${commonDates.length} common sessions; at least ${MIN_PAIRWISE_OBSERVATIONS} required over ${cfg.label}).`;
  } else {
    const m = modeledPositions.length;
    const T = commonDates.length;

    // Actual total-portfolio weights (cash naturally enters as weight w_cash with 0 return variance)
    const weights = modeledPositions.map((p) =>
      totalPortfolioValue > 0 && p.marketValue !== null ? p.marketValue / totalPortfolioValue : 0
    );

    // Build T x m return matrix
    const returnMatrix: number[][] = modeledPositions.map((p) => {
      const rMap = holdingReturnMaps.get(p.ticker)!;
      return commonDates.map((d) => rMap.get(d)!);
    });

    const means = returnMatrix.map((series) => sampleMean(series));

    // Full m x m sample covariance matrix Σ (ddof = 1)
    const covMatrix: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    for (let i = 0; i < m; i++) {
      for (let j = i; j < m; j++) {
        let sum = 0;
        for (let t = 0; t < T; t++) {
          sum += (returnMatrix[i][t] - means[i]) * (returnMatrix[j][t] - means[j]);
        }
        const cov = sum / (T - 1);
        covMatrix[i][j] = cov;
        covMatrix[j][i] = cov;
      }
    }

    // Σw vector
    const sigmaW = new Array<number>(m).fill(0);
    for (let i = 0; i < m; i++) {
      let acc = 0;
      for (let j = 0; j < m; j++) {
        acc += covMatrix[i][j] * weights[j];
      }
      sigmaW[i] = acc;
    }

    // Portfolio daily variance = w^T Σ w
    let portDailyVar = 0;
    for (let i = 0; i < m; i++) {
      portDailyVar += weights[i] * sigmaW[i];
    }

    if (portDailyVar > EPSILON) {
      const portDailyStd = Math.sqrt(portDailyVar);
      portfolioVolatilityPct = portDailyStd * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;

      // Euler risk contribution decomposition (sums to 100% across risky assets)
      let weightedVolSum = 0;
      for (let i = 0; i < m; i++) {
        const pos = modeledPositions[i];
        const holdingDailyStd = Math.sqrt(Math.max(0, covMatrix[i][i]));
        const holdingAnnVolPct = holdingDailyStd * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
        // Align per-holding vol to the exact common window when computed
        pos.annualizedVolatilityPct = holdingAnnVolPct;
        weightedVolSum += weights[i] * holdingAnnVolPct;

        const mcrAnnPct = (sigmaW[i] / portDailyStd) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
        const rcPct = ((weights[i] * sigmaW[i]) / portDailyVar) * 100;
        const compVolPct = (rcPct / 100) * portfolioVolatilityPct;

        pos.marginalRiskPct = mcrAnnPct;
        pos.riskContributionPct = rcPct;
        pos.componentVolContributionPct = compVolPct;
      }

      weightedAvgHoldingVolPct = weightedVolSum;
      if (portfolioVolatilityPct > EPSILON) {
        diversificationRatio = weightedVolSum / portfolioVolatilityPct;
      }
    } else {
      volatilityUnavailableReason = 'Portfolio return variance is zero over the selected period.';
    }

    // Daily weighted portfolio return series (constant current weights; cash earns 0%)
    const portDailyReturns = commonDates.map((date, t) => {
      let r = 0;
      for (let i = 0; i < m; i++) {
        r += weights[i] * returnMatrix[i][t];
      }
      return { date, ret: r };
    });

    // Historical max drawdown
    const portDd = computeSeriesMaxDrawdown(portDailyReturns);
    maxDrawdownPct = portDd.maxDrawdownPct;
    maxDrawdownPeakDate = portDd.peakDate;
    maxDrawdownTroughDate = portDd.troughDate;
    drawdownCurve = portDd.curve;

    // Portfolio beta vs SPY over exact common dates with SPY
    const spyAlignedPort: number[] = [];
    const spyAlignedBench: number[] = [];
    for (const pt of portDailyReturns) {
      const spyRet = spyReturnMap.get(pt.date);
      if (spyRet !== undefined && Number.isFinite(spyRet)) {
        spyAlignedPort.push(pt.ret);
        spyAlignedBench.push(spyRet);
      }
    }
    betaObservationCount = spyAlignedPort.length;
    if (spyAlignedPort.length >= MIN_PAIRWISE_OBSERVATIONS) {
      const varSpy = sampleVariance(spyAlignedBench);
      const covPortSpy = sampleCovariance(spyAlignedPort, spyAlignedBench);
      if (varSpy !== null && varSpy > EPSILON && covPortSpy !== null) {
        portfolioBetaVsSpy = covPortSpy / varSpy;
      }
    }
  }

  // 3. Sector & Industry Exposure (using actual portfolio weights + risk contributions)
  const sectorMap = new Map<
    string,
    {
      sector: string;
      gicsSectorId: SectorId | null;
      isClassified: boolean;
      marketValue: number;
      riskContributionSum: number;
      hasRiskData: boolean;
      holdings: EnrichedPortfolioPosition[];
    }
  >();

  const industryMap = new Map<
    string,
    {
      industry: string;
      sector: string;
      isClassified: boolean;
      marketValue: number;
      tickers: string[];
    }
  >();

  let classifiedEquityValue = 0;
  let unclassifiedEquityValue = 0;
  const unclassifiedHoldings: Array<{ ticker: string; reason: string; weightPct: number | null }> = [];

  for (const pos of pricedPositions) {
    const mv = pos.marketValue ?? 0;
    if (pos.sectorClassified) {
      classifiedEquityValue += mv;
    } else {
      unclassifiedEquityValue += mv;
      unclassifiedHoldings.push({
        ticker: pos.ticker,
        reason: pos.isEtfOrFund
          ? 'Broad-market or multi-sector ETF/fund (no single GICS sector).'
          : 'Sector classification unavailable from market data provider.',
        weightPct: pos.weightPct,
      });
    }

    const sEntry = sectorMap.get(pos.sector) || {
      sector: pos.sector,
      gicsSectorId: pos.gicsSectorId,
      isClassified: pos.sectorClassified,
      marketValue: 0,
      riskContributionSum: 0,
      hasRiskData: false,
      holdings: [],
    };
    sEntry.marketValue += mv;
    sEntry.holdings.push(pos);
    if (pos.riskContributionPct !== null) {
      sEntry.riskContributionSum += pos.riskContributionPct;
      sEntry.hasRiskData = true;
    }
    sectorMap.set(pos.sector, sEntry);

    const indKey = `${pos.sector}::${pos.industry}`;
    const iEntry = industryMap.get(indKey) || {
      industry: pos.industry,
      sector: pos.sector,
      isClassified: pos.industryClassified,
      marketValue: 0,
      tickers: [],
    };
    iEntry.marketValue += mv;
    iEntry.tickers.push(pos.ticker);
    industryMap.set(indKey, iEntry);
  }

  const benchmarkAvailable = Boolean(
    benchmarkSectorWeights && Object.keys(benchmarkSectorWeights).length > 0
  );

  const sectors: SectorAllocationRow[] = Array.from(sectorMap.values())
    .map((entry) => {
      const portfolioWeightPct =
        totalPortfolioValue > 0 ? (entry.marketValue / totalPortfolioValue) * 100 : 0;
      const equityWeightPct =
        totalEquityValue > 0 ? (entry.marketValue / totalEquityValue) * 100 : 0;
      const sortedHoldings = [...entry.holdings].sort(
        (a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)
      );
      const benchWeight =
        benchmarkAvailable && benchmarkSectorWeights
          ? benchmarkSectorWeights[entry.sector] ??
            (entry.gicsSectorId ? benchmarkSectorWeights[entry.gicsSectorId] ?? null : null)
          : null;
      const activeDelta = benchWeight !== null ? equityWeightPct - benchWeight : null;

      let status: SectorAllocationRow['status'] = 'balanced';
      if (!entry.isClassified) {
        status = 'unclassified';
      } else if (
        portfolioWeightPct > thresholds.maxSectorPct ||
        (activeDelta !== null && activeDelta > 5)
      ) {
        status = 'overweight';
      } else if (
        (activeDelta !== null && activeDelta < -5) ||
        (activeDelta === null && portfolioWeightPct > 0 && portfolioWeightPct < 5)
      ) {
        status = 'underweight';
      }

      return {
        sector: entry.sector,
        gicsSectorId: entry.gicsSectorId,
        isClassified: entry.isClassified,
        marketValue: entry.marketValue,
        portfolioWeightPct,
        equityWeightPct,
        holdingCount: entry.holdings.length,
        largestHoldings: sortedHoldings.slice(0, 3).map((h) => ({
          ticker: h.ticker,
          weightPct: h.weightPct ?? 0,
          marketValue: h.marketValue ?? 0,
        })),
        riskContributionPct: entry.hasRiskData ? entry.riskContributionSum : null,
        status,
        benchmarkWeightPct: benchWeight,
        activeWeightDeltaPct: activeDelta,
      };
    })
    .sort((a, b) => b.portfolioWeightPct - a.portfolioWeightPct);

  const industries: IndustryAllocationRow[] = Array.from(industryMap.values())
    .map((entry) => ({
      industry: entry.industry,
      sector: entry.sector,
      isClassified: entry.isClassified,
      marketValue: entry.marketValue,
      portfolioWeightPct:
        totalPortfolioValue > 0 ? (entry.marketValue / totalPortfolioValue) * 100 : 0,
      holdingCount: entry.tickers.length,
      tickers: entry.tickers,
    }))
    .sort((a, b) => b.portfolioWeightPct - a.portfolioWeightPct);

  const sectorExposure: SectorExposureAnalysis = {
    sectors,
    industries,
    classifiedEquityValue,
    classifiedEquityPct: totalEquityValue > 0 ? (classifiedEquityValue / totalEquityValue) * 100 : 0,
    unclassifiedEquityValue,
    unclassifiedEquityPct:
      totalEquityValue > 0 ? (unclassifiedEquityValue / totalEquityValue) * 100 : 0,
    unclassifiedHoldings,
    overweightSectors: sectors.filter((s) => s.status === 'overweight'),
    underweightSectors: sectors.filter((s) => s.status === 'underweight'),
    benchmarkAvailable,
    benchmarkUnavailableReason: benchmarkAvailable
      ? null
      : 'Live S&P 500 GICS sector benchmark weights are unavailable from the configured market data providers; overweight/underweight flags use portfolio weight thresholds instead of fabricated index weights.',
  };

  // 4. Concentration Analysis
  const largestPos = pricedPositions[0] || null;
  const top5WeightPct = pricedPositions
    .slice(0, 5)
    .reduce((sum, p) => sum + (p.weightPct ?? 0), 0);
  const top10WeightPct = pricedPositions
    .slice(0, 10)
    .reduce((sum, p) => sum + (p.weightPct ?? 0), 0);
  const singleStockWeightPct = pricedPositions
    .filter((p) => !p.isEtfOrFund)
    .reduce((sum, p) => sum + (p.weightPct ?? 0), 0);
  const etfFundWeightPct = pricedPositions
    .filter((p) => p.isEtfOrFund)
    .reduce((sum, p) => sum + (p.weightPct ?? 0), 0);

  let hhi: number | null = null;
  let effectivePositions: number | null = null;
  if (totalPortfolioValue > 0 && (pricedPositions.length > 0 || cashBalance > 0)) {
    let sumSqPct = 0;
    for (const p of pricedPositions) {
      const w = p.weightPct ?? 0;
      sumSqPct += w * w;
    }
    if (cashWeightPct > 0) {
      sumSqPct += cashWeightPct * cashWeightPct;
    }
    hhi = sumSqPct;
    const sumSqDec = sumSqPct / 10_000;
    effectivePositions = sumSqDec > EPSILON ? 1 / sumSqDec : null;
  }

  let concentrationLabel: ConcentrationAnalysis['concentrationLabel'] = 'Unavailable';
  if (hhi !== null) {
    if (hhi >= 2500 || (largestPos && (largestPos.weightPct ?? 0) >= 35)) {
      concentrationLabel = 'Very High';
    } else if (hhi >= 1500 || (largestPos && (largestPos.weightPct ?? 0) >= thresholds.maxSinglePositionPct)) {
      concentrationLabel = 'High';
    } else if (hhi >= 800 || top5WeightPct >= thresholds.maxTop5Pct) {
      concentrationLabel = 'Moderate';
    } else {
      concentrationLabel = 'Low';
    }
  }

  const oversizedPositions = pricedPositions.filter((p) => p.isOversized);
  const underallocatedPositions = pricedPositions.filter((p) => p.isUnderallocated);

  const concentrationWarnings: ConcentrationWarning[] = [];
  for (const pos of oversizedPositions) {
    concentrationWarnings.push({
      id: `oversized-${pos.ticker}`,
      severity: (pos.weightPct ?? 0) >= thresholds.maxSinglePositionPct * 1.5 ? 'high' : 'moderate',
      title: `Oversized Position: ${pos.ticker}`,
      detail: `${pos.ticker} represents ${(pos.weightPct ?? 0).toFixed(1)}% of total portfolio value, exceeding the ${thresholds.maxSinglePositionPct.toFixed(0)}% single-position threshold.`,
      tickers: [pos.ticker],
    });
  }

  if (pricedPositions.length >= 2 && top5WeightPct > thresholds.maxTop5Pct) {
    concentrationWarnings.push({
      id: 'top5-concentration',
      severity: top5WeightPct >= 80 ? 'high' : 'moderate',
      title: 'Top-5 Concentration Alert',
      detail: `Top ${Math.min(5, pricedPositions.length)} holdings account for ${top5WeightPct.toFixed(1)}% of total portfolio value (threshold: ${thresholds.maxTop5Pct.toFixed(0)}%).`,
      tickers: pricedPositions.slice(0, 5).map((p) => p.ticker),
    });
  }

  for (const sec of sectorExposure.overweightSectors) {
    concentrationWarnings.push({
      id: `sector-overweight-${sec.sector}`,
      severity: sec.portfolioWeightPct >= thresholds.maxSectorPct + 15 ? 'high' : 'moderate',
      title: `Sector Concentration: ${sec.sector}`,
      detail: `${sec.sector} represents ${sec.portfolioWeightPct.toFixed(1)}% of total portfolio value, exceeding the ${thresholds.maxSectorPct.toFixed(0)}% sector limit.`,
      tickers: sec.largestHoldings.map((h) => h.ticker),
    });
  }

  let distributionAssessment = 'Add priced holdings to evaluate portfolio allocation balance.';
  if (pricedPositions.length === 1) {
    distributionAssessment = 'Single-position portfolio — all equity exposure is concentrated in one security.';
  } else if (pricedPositions.length > 1 && effectivePositions !== null) {
    const ratio = effectivePositions / pricedPositions.length;
    if (ratio >= 0.75) {
      distributionAssessment = `Relatively balanced sizing across ${pricedPositions.length} holdings (${effectivePositions.toFixed(1)} effective equal-weight positions).`;
    } else if (ratio >= 0.45) {
      distributionAssessment = `Moderately uneven sizing — ${pricedPositions.length} holdings behave like ${effectivePositions.toFixed(1)} equal-weight positions.`;
    } else {
      distributionAssessment = `Heavily top-heavy distribution — ${pricedPositions.length} holdings behave like only ${effectivePositions.toFixed(1)} equal-weight positions.`;
    }
  }

  const concentration: ConcentrationAnalysis = {
    largestPosition:
      largestPos && largestPos.weightPct !== null && largestPos.marketValue !== null
        ? {
            ticker: largestPos.ticker,
            name: largestPos.name,
            weightPct: largestPos.weightPct,
            marketValue: largestPos.marketValue,
          }
        : null,
    top5WeightPct,
    top10WeightPct,
    singleStockWeightPct,
    etfFundWeightPct,
    cashWeightPct,
    hhi,
    effectivePositions,
    concentrationLabel,
    oversizedPositions,
    underallocatedPositions,
    distributionAssessment,
    warnings: concentrationWarnings,
  };

  // 5. Diversification & CORR Integration (directly reuses buildCorrelationMatrix from correlation.ts)
  const matrix = buildCorrelationMatrix(holdingSeriesList, lookbackPeriod);
  const posByTicker = new Map<string, EnrichedPortfolioPosition>();
  for (const p of pricedPositions) posByTicker.set(p.ticker, p);

  const highThreshold = thresholds.highCorrelationThreshold;
  const highlyCorrelatedPairs: CorrelatedPairItem[] = [];
  const sectorOverlapPairs: CorrelatedPairItem[] = [];

  let weightedCorrNum = 0;
  let weightedCorrDen = 0;

  // Build adjacency for correlation clusters (edges with r >= highThreshold)
  const adj = new Map<string, Set<string>>();
  for (const sym of matrix.symbols) adj.set(sym, new Set());

  for (let i = 0; i < matrix.symbols.length; i++) {
    const symA = matrix.symbols[i];
    const posA = posByTicker.get(symA);
    const wA = (posA?.weightPct ?? 0) / 100;

    // Per-holding weighted average correlation with the rest of the portfolio
    let peerCorrNum = 0;
    let peerCorrDen = 0;

    for (let j = 0; j < matrix.symbols.length; j++) {
      if (i === j) continue;
      const cell = matrix.cells[i]?.[j];
      const symB = matrix.symbols[j];
      const posB = posByTicker.get(symB);
      const wB = (posB?.weightPct ?? 0) / 100;

      if (cell && cell.correlation !== null && Number.isFinite(cell.correlation)) {
        peerCorrNum += wB * cell.correlation;
        peerCorrDen += wB;

        if (j > i) {
          const pairWeightProduct = wA * wB;
          weightedCorrNum += pairWeightProduct * cell.correlation;
          weightedCorrDen += pairWeightProduct;

          const sameSector = Boolean(
            posA?.sectorClassified && posB?.sectorClassified && posA.sector === posB.sector
          );
          const pairItem: CorrelatedPairItem = {
            symbolA: symA,
            symbolB: symB,
            correlation: cell.correlation,
            observationCount: cell.observationCount,
            combinedWeightPct: (posA?.weightPct ?? 0) + (posB?.weightPct ?? 0),
            sameSector,
            sharedSector: sameSector && posA ? posA.sector : null,
            bandLabel: interpretCorrelation(cell.correlation).label,
          };

          if (cell.correlation >= highThreshold) {
            highlyCorrelatedPairs.push(pairItem);
            adj.get(symA)?.add(symB);
            adj.get(symB)?.add(symA);
          }
          if (sameSector && cell.correlation >= Math.max(0.55, highThreshold - 0.1)) {
            sectorOverlapPairs.push(pairItem);
          }
        }
      }
    }

    if (posA && peerCorrDen > EPSILON) {
      posA.weightedAvgCorrWithPortfolio = peerCorrNum / peerCorrDen;
      const riskOverWeight =
        posA.riskContributionPct !== null && posA.weightPct !== null && posA.weightPct > 0
          ? posA.riskContributionPct / posA.weightPct
          : null;
      posA.limitedDiversificationBenefit =
        posA.weightedAvgCorrWithPortfolio >= highThreshold ||
        (posA.weightedAvgCorrWithPortfolio >= 0.6 && riskOverWeight !== null && riskOverWeight >= 1.25);
    }
  }

  highlyCorrelatedPairs.sort((a, b) => b.correlation - a.correlation);
  sectorOverlapPairs.sort((a, b) => b.combinedWeightPct - a.combinedWeightPct);

  // Connected components for correlation clusters (size >= 2)
  const visited = new Set<string>();
  const clusters: CorrelationCluster[] = [];
  for (const sym of matrix.symbols) {
    if (visited.has(sym)) continue;
    const neighbors = adj.get(sym);
    if (!neighbors || neighbors.size === 0) continue;

    const queue = [sym];
    const comp: string[] = [];
    visited.add(sym);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(curr);
      for (const nxt of adj.get(curr) || []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }

    if (comp.length >= 2) {
      // Compute intra-cluster avg & max correlation
      let sumR = 0;
      let countR = 0;
      let maxR = -1;
      for (let a = 0; a < comp.length; a++) {
        const idxA = matrix.symbols.indexOf(comp[a]);
        for (let b = a + 1; b < comp.length; b++) {
          const idxB = matrix.symbols.indexOf(comp[b]);
          const r = matrix.cells[idxA]?.[idxB]?.correlation;
          if (r !== null && r !== undefined && Number.isFinite(r)) {
            sumR += r;
            countR++;
            if (r > maxR) maxR = r;
          }
        }
      }
      const combinedWeightPct = comp.reduce(
        (sum, t) => sum + (posByTicker.get(t)?.weightPct ?? 0),
        0
      );
      const clusterSectors = Array.from(
        new Set(comp.map((t) => posByTicker.get(t)?.sector || 'Unclassified'))
      );
      clusters.push({
        id: `cluster-${comp.join('-')}`,
        tickers: comp.sort((a, b) => (posByTicker.get(b)?.weightPct ?? 0) - (posByTicker.get(a)?.weightPct ?? 0)),
        combinedWeightPct,
        avgCorrelation: countR > 0 ? sumR / countR : 0,
        maxCorrelation: maxR >= -1 ? maxR : 0,
        sectors: clusterSectors,
        isSameSectorCluster: clusterSectors.length === 1 && !clusterSectors[0].startsWith('Unclassified'),
      });
    }
  }
  clusters.sort((a, b) => b.combinedWeightPct - a.combinedWeightPct);

  const clusteredTickers = new Set(clusters.flatMap((c) => c.tickers));
  const concentratedCorrelatedWeightPct = Array.from(clusteredTickers).reduce(
    (sum, t) => sum + (posByTicker.get(t)?.weightPct ?? 0),
    0
  );
  const weightedAvgPairwiseCorrelation =
    weightedCorrDen > EPSILON ? weightedCorrNum / weightedCorrDen : null;

  const limitedDiversificationHoldings = pricedPositions
    .filter((p) => p.limitedDiversificationBenefit)
    .sort((a, b) => (b.weightedAvgCorrWithPortfolio ?? 0) - (a.weightedAvgCorrWithPortfolio ?? 0));

  // Rule-based diversification assessment
  let divLabel: DiversificationAnalysis['assessmentLabel'] = 'Insufficient Data';
  let divTone: DiversificationAnalysis['assessmentTone'] = 'neutral';
  const divDrivers: string[] = [];
  let divSummary = 'At least two priced holdings with overlapping daily history are required to assess correlation-based diversification.';

  if (pricedPositions.length === 1) {
    divLabel = 'Highly Concentrated';
    divTone = 'negative';
    divSummary = 'Single-security equity portfolio provides no cross-asset diversification.';
    divDrivers.push('Only 1 equity position held.');
  } else if (weightedAvgPairwiseCorrelation !== null) {
    divDrivers.push(
      `Weight-adjusted average pairwise correlation: ${formatCorrelationValue(weightedAvgPairwiseCorrelation)} (${cfg.label}).`
    );
    if (diversificationRatio !== null) {
      divDrivers.push(`Volatility diversification ratio: ${diversificationRatio.toFixed(2)}x.`);
    }
    if (clusters.length > 0) {
      divDrivers.push(
        `${clusters.length} correlated cluster${clusters.length === 1 ? '' : 's'} (r ≥ ${highThreshold.toFixed(2)}) covering ${concentratedCorrelatedWeightPct.toFixed(1)}% of total portfolio.`
      );
    }

    if (
      weightedAvgPairwiseCorrelation >= 0.72 ||
      concentratedCorrelatedWeightPct >= 70 ||
      (effectivePositions !== null && effectivePositions < 2.5)
    ) {
      divLabel = 'Highly Concentrated';
      divTone = 'negative';
      divSummary =
        'Holdings exhibit strong historical co-movement or heavy weight concentration, offering limited risk reduction across positions.';
    } else if (
      weightedAvgPairwiseCorrelation >= 0.55 ||
      concentratedCorrelatedWeightPct >= 45 ||
      (effectivePositions !== null && effectivePositions < 4.5)
    ) {
      divLabel = 'Correlated / Concentrated';
      divTone = 'warning';
      divSummary =
        'Noticeable correlation clustering or sector overlap limits effective diversification during broad drawdowns.';
    } else if (weightedAvgPairwiseCorrelation >= 0.35 || pricedPositions.length < 6) {
      divLabel = 'Moderately Diversified';
      divTone = 'neutral';
      divSummary =
        'Portfolio shows moderate cross-holding correlation with measurable volatility reduction relative to individual holdings.';
    } else {
      divLabel = 'Well Diversified';
      divTone = 'positive';
      divSummary =
        'Holdings display lower historical co-movement and broad weight dispersion over the selected lookback period.';
    }
  }

  const diversification: DiversificationAnalysis = {
    matrix,
    highCorrelationThreshold: highThreshold,
    highlyCorrelatedPairs,
    clusters,
    sectorOverlapPairs,
    concentratedCorrelatedWeightPct,
    weightedAvgPairwiseCorrelation,
    limitedDiversificationHoldings,
    assessmentLabel: divLabel,
    assessmentTone: divTone,
    assessmentSummary: divSummary,
    assessmentDrivers: divDrivers,
  };

  // Risk concentration by sector (sorted descending)
  const riskBySector = sectors
    .filter((s) => s.riskContributionPct !== null)
    .map((s) => ({
      sector: s.sector,
      portfolioWeightPct: s.portfolioWeightPct,
      riskContributionPct: s.riskContributionPct as number,
    }))
    .sort((a, b) => b.riskContributionPct - a.riskContributionPct);

  const largestVolContributors = [...pricedPositions]
    .filter((p) => p.riskContributionPct !== null)
    .sort((a, b) => (b.riskContributionPct ?? 0) - (a.riskContributionPct ?? 0));

  const volatilityRisk: VolatilityRiskAnalysis = {
    lookbackPeriod,
    lookbackLabel: cfg.label,
    startDate: commonDates.length > 0 ? commonDates[0] : null,
    endDate: commonDates.length > 0 ? commonDates[commonDates.length - 1] : null,
    alignedSessionCount: commonDates.length,
    coveredEquityWeightPct,
    coveredTotalWeightPct,
    portfolioVolatilityPct,
    weightedAvgHoldingVolPct,
    diversificationRatio,
    portfolioBetaVsSpy,
    betaObservationCount,
    maxDrawdownPct,
    maxDrawdownPeakDate,
    maxDrawdownTroughDate,
    drawdownCurve,
    largestVolContributors,
    riskBySector,
    excludedFromRiskModel,
    unavailableReason: volatilityUnavailableReason,
    methodologySummary:
      commonDates.length >= MIN_PAIRWISE_OBSERVATIONS
        ? `Sample covariance matrix (ddof=1) of daily adjusted-close returns weighted by current total portfolio allocations (cash = 0% vol), annualized by √252 across ${commonDates.length} aligned sessions (${commonDates[0]} to ${commonDates[commonDates.length - 1]}).`
        : `Requires at least ${MIN_PAIRWISE_OBSERVATIONS} overlapping daily adjusted-close sessions across holdings in the ${cfg.label} lookback.`,
  };

  // 6. Overall Transparent Rule-Based Risk Assessment (Section 1)
  const overallRisk = deriveOverallRiskAssessment({
    portfolioVolatilityPct,
    portfolioBetaVsSpy,
    concentrationLabel,
    largestPositionPct: largestPos?.weightPct ?? null,
    weightedAvgPairwiseCorrelation,
    thresholds,
    pricedHoldingCount: pricedPositions.length,
    cashBalance,
  });

  // 7. Standard Market-Wide SPY Downside Scenarios (-5%, -10%, -15%, -20%) & Concentrated Stress Tests
  const spyShocks = [-5, -10, -15, -20] as const;
  const marketScenarios: DownsideScenarioResult[] = spyShocks.map((shock) =>
    computeDownsideScenario({
      id: `spy-${Math.abs(shock)}`,
      name: `SPY ${shock}% Market Decline`,
      category: 'market_spy',
      description: `Hypothetical broad market drop of ${shock}% scaled by each holding's historical beta to SPY.`,
      methodologyNote:
        'Hypothetical beta-scaled stress test (holding shock = β_SPY × SPY move, floored at -100%; cash shock = 0%). Not a statistical forecast.',
      positions: pricedPositions,
      cashBalance,
      totalPortfolioValue,
      spyShockPct: shock,
    })
  );

  const concentratedStressScenarios: DownsideScenarioResult[] = [];
  if (largestPos) {
    concentratedStressScenarios.push(
      computeDownsideScenario({
        id: 'stress-top1-25',
        name: `Largest Holding (${largestPos.ticker}) -25%`,
        category: 'concentrated_stress',
        description: `Idiosyncratic -25% drawdown in your single largest position (${largestPos.ticker}).`,
        methodologyNote: 'Hypothetical single-position shock holding all other positions constant.',
        positions: pricedPositions,
        cashBalance,
        totalPortfolioValue,
        positionShocks: { [largestPos.ticker]: -25 },
      })
    );
  }
  if (pricedPositions.length >= 2) {
    const top3 = pricedPositions.slice(0, Math.min(3, pricedPositions.length));
    const shockMap: Record<string, number> = {};
    top3.forEach((p) => {
      shockMap[p.ticker] = -20;
    });
    concentratedStressScenarios.push(
      computeDownsideScenario({
        id: 'stress-top3-20',
        name: `Top ${top3.length} Holdings (${top3.map((p) => p.ticker).join(', ')}) -20%`,
        category: 'concentrated_stress',
        description: `Simultaneous -20% decline across your top ${top3.length} positions by portfolio weight.`,
        methodologyNote: 'Hypothetical concentrated multi-position stress test using actual weights.',
        positions: pricedPositions,
        cashBalance,
        totalPortfolioValue,
        positionShocks: shockMap,
      })
    );
  }
  const topSector = sectors.find((s) => s.isClassified) || sectors[0];
  if (topSector) {
    concentratedStressScenarios.push(
      computeDownsideScenario({
        id: `stress-sector-${topSector.sector}`,
        name: `Largest Sector (${topSector.sector}) -20%`,
        category: 'sector',
        description: `Uniform -20% sector shock applied to all ${topSector.holdingCount} holding${topSector.holdingCount === 1 ? '' : 's'} in ${topSector.sector}.`,
        methodologyNote: 'Hypothetical sector-specific stress test; non-sector holdings and cash unchanged.',
        positions: pricedPositions,
        cashBalance,
        totalPortfolioValue,
        sectorShock: { sector: topSector.sector, shockPct: -20 },
      })
    );
  }
  if (clusters.length > 0) {
    const topCluster = clusters[0];
    const clusterShocks: Record<string, number> = {};
    topCluster.tickers.forEach((t) => {
      clusterShocks[t] = -20;
    });
    concentratedStressScenarios.push(
      computeDownsideScenario({
        id: 'stress-top-cluster-20',
        name: `Correlated Cluster (${topCluster.tickers.slice(0, 4).join(', ')}${topCluster.tickers.length > 4 ? '…' : ''}) -20%`,
        category: 'concentrated_stress',
        description: `Simultaneous -20% drop across your largest correlated cluster (${topCluster.combinedWeightPct.toFixed(1)}% weight, avg r ${formatCorrelationValue(topCluster.avgCorrelation)}).`,
        methodologyNote: 'Hypothetical correlated-cluster drawdown stress test based on observed CORR clusters.',
        positions: pricedPositions,
        cashBalance,
        totalPortfolioValue,
        positionShocks: clusterShocks,
      })
    );
  }

  return {
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    totalPortfolioValue,
    totalEquityValue,
    cashBalance,
    cashWeightPct,
    holdingCount: portfolio.holdings.length,
    pricedHoldingCount: pricedPositions.length,
    unpricedHoldings,
    totalCostValue,
    totalUnrealizedGain,
    totalUnrealizedGainPct,
    costBasisCoverageCount,
    positions: sortedByWeight,
    concentration,
    sectorExposure,
    volatilityRisk,
    diversification,
    marketScenarios,
    concentratedStressScenarios,
    overallRisk,
    dataWarnings,
  };
}

function deriveOverallRiskAssessment(params: {
  portfolioVolatilityPct: number | null;
  portfolioBetaVsSpy: number | null;
  concentrationLabel: ConcentrationAnalysis['concentrationLabel'];
  largestPositionPct: number | null;
  weightedAvgPairwiseCorrelation: number | null;
  thresholds: PortfolioRiskThresholds;
  pricedHoldingCount: number;
  cashBalance: number;
}): RiskAssessmentSummary {
  const {
    portfolioVolatilityPct,
    portfolioBetaVsSpy,
    concentrationLabel,
    largestPositionPct,
    weightedAvgPairwiseCorrelation,
    thresholds,
    pricedHoldingCount,
    cashBalance,
  } = params;

  if (pricedHoldingCount === 0 && cashBalance > 0) {
    return {
      level: 'Low',
      tone: 'positive',
      drivers: ['Portfolio is 100% allocated to cash (zero equity market risk).'],
    };
  }

  if (pricedHoldingCount === 0 || (portfolioVolatilityPct === null && largestPositionPct === null)) {
    return {
      level: 'Unavailable',
      tone: 'neutral',
      drivers: ['Insufficient market price or historical return data to evaluate overall risk.'],
    };
  }

  let score = 0;
  const drivers: string[] = [];

  if (portfolioVolatilityPct !== null) {
    if (portfolioVolatilityPct >= 30) {
      score += 3;
      drivers.push(`High annualized volatility (${portfolioVolatilityPct.toFixed(1)}% ≥ 30%).`);
    } else if (portfolioVolatilityPct >= 20) {
      score += 2;
      drivers.push(`Elevated annualized volatility (${portfolioVolatilityPct.toFixed(1)}% in 20–30% band).`);
    } else if (portfolioVolatilityPct >= 12) {
      score += 1;
      drivers.push(`Moderate annualized volatility (${portfolioVolatilityPct.toFixed(1)}%).`);
    } else {
      drivers.push(`Lower annualized volatility (${portfolioVolatilityPct.toFixed(1)}% < 12%).`);
    }
  }

  if (portfolioBetaVsSpy !== null) {
    if (portfolioBetaVsSpy >= 1.35) {
      score += 2;
      drivers.push(`High market sensitivity (SPY beta ${portfolioBetaVsSpy.toFixed(2)} ≥ 1.35).`);
    } else if (portfolioBetaVsSpy >= 1.1) {
      score += 1;
      drivers.push(`Above-market beta vs SPY (${portfolioBetaVsSpy.toFixed(2)}).`);
    } else {
      drivers.push(`Moderate/defensive beta vs SPY (${portfolioBetaVsSpy.toFixed(2)}).`);
    }
  }

  if (concentrationLabel === 'Very High') {
    score += 3;
    drivers.push(
      `Very high position concentration${largestPositionPct !== null ? ` (largest holding ${largestPositionPct.toFixed(1)}%)` : ''}.`
    );
  } else if (concentrationLabel === 'High') {
    score += 2;
    drivers.push(
      `High position concentration${largestPositionPct !== null ? ` (largest holding ${largestPositionPct.toFixed(1)}% vs ${thresholds.maxSinglePositionPct}% threshold)` : ''}.`
    );
  } else if (concentrationLabel === 'Moderate') {
    score += 1;
    drivers.push('Moderate position concentration.');
  }

  if (weightedAvgPairwiseCorrelation !== null && weightedAvgPairwiseCorrelation >= thresholds.highCorrelationThreshold) {
    score += 1;
    drivers.push(
      `High internal return correlation (weighted avg r ${formatCorrelationValue(weightedAvgPairwiseCorrelation)}).`
    );
  }

  if (score >= 6) {
    return { level: 'High', tone: 'negative', drivers };
  }
  if (score >= 4) {
    return { level: 'Elevated', tone: 'warning', drivers };
  }
  if (score >= 2) {
    return { level: 'Moderate', tone: 'neutral', drivers };
  }
  return { level: 'Low', tone: 'positive', drivers };
}

/**
 * Re-export correlation helper so UI consumers can use a single consistent formatter.
 */
export { computePearsonCorrelation };

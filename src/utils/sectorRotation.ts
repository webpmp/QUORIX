import type {
  InstitutionalAccumulationRow,
  InstitutionalPositionChangeRow,
  SectorClassificationCoverage,
  SectorId,
  SectorInsiderSentimentStatus,
  SectorInstitutionalSummary,
  SectorInstitutionalTrend,
  SectorMarketPerformance,
  SectorPerformancePeriod,
  SectorPeriodReturnPoint,
  SectorPriceHistoryPoint,
  SectorRotationItem,
  SectorRotationOverviewByPeriod,
  SectorRotationStatus,
} from '../types';

export interface SectorDefinition {
  id: SectorId;
  name: string;
  shortName: string;
  etfTicker: string;
  etfName: string;
  /**
   * Representative 4-digit SEC Standard Industrial Classification (SIC) codes
   * used to query 3spread's GET /v1/insiders/buy-sell-ratio?sic=... endpoint.
   * Each SIC code belongs unambiguously to this GICS sector.
   */
  representativeSics: readonly string[];
}

export const BENCHMARK_ETF = {
  ticker: 'SPY',
  name: 'SPDR S&P 500 ETF Trust',
} as const;

export const PERFORMANCE_PERIODS: readonly SectorPerformancePeriod[] = [
  '1W',
  '1M',
  '3M',
  '6M',
] as const;

export const GICS_SECTORS: readonly SectorDefinition[] = [
  {
    id: 'TECHNOLOGY',
    name: 'Technology',
    shortName: 'Tech',
    etfTicker: 'XLK',
    etfName: 'Technology Select Sector SPDR Fund',
    representativeSics: ['7372', '3674', '3571', '7371'],
  },
  {
    id: 'FINANCIALS',
    name: 'Financials',
    shortName: 'Fin',
    etfTicker: 'XLF',
    etfName: 'Financial Select Sector SPDR Fund',
    representativeSics: ['6021', '6022', '6211', '6331'],
  },
  {
    id: 'HEALTHCARE',
    name: 'Healthcare',
    shortName: 'Health',
    etfTicker: 'XLV',
    etfName: 'Health Care Select Sector SPDR Fund',
    representativeSics: ['2834', '2836', '3841', '6324'],
  },
  {
    id: 'CONSUMER_DISCRETIONARY',
    name: 'Consumer Discretionary',
    shortName: 'Cons Disc',
    etfTicker: 'XLY',
    etfName: 'Consumer Discretionary Select Sector SPDR Fund',
    representativeSics: ['5961', '3711', '5812', '5331'],
  },
  {
    id: 'CONSUMER_STAPLES',
    name: 'Consumer Staples',
    shortName: 'Cons Stpl',
    etfTicker: 'XLP',
    etfName: 'Consumer Staples Select Sector SPDR Fund',
    representativeSics: ['2080', '2840', '5411', '2000'],
  },
  {
    id: 'ENERGY',
    name: 'Energy',
    shortName: 'Energy',
    etfTicker: 'XLE',
    etfName: 'Energy Select Sector SPDR Fund',
    representativeSics: ['1311', '2911', '1389', '4922'],
  },
  {
    id: 'INDUSTRIALS',
    name: 'Industrials',
    shortName: 'Ind',
    etfTicker: 'XLI',
    etfName: 'Industrial Select Sector SPDR Fund',
    representativeSics: ['3721', '3531', '4512', '4213'],
  },
  {
    id: 'MATERIALS',
    name: 'Materials',
    shortName: 'Mat',
    etfTicker: 'XLB',
    etfName: 'Materials Select Sector SPDR Fund',
    representativeSics: ['2821', '1040', '2810', '3312'],
  },
  {
    id: 'UTILITIES',
    name: 'Utilities',
    shortName: 'Util',
    etfTicker: 'XLU',
    etfName: 'Utilities Select Sector SPDR Fund',
    representativeSics: ['4911', '4931', '4924', '4941'],
  },
  {
    id: 'REAL_ESTATE',
    name: 'Real Estate',
    shortName: 'Real Est',
    etfTicker: 'XLRE',
    etfName: 'Real Estate Select Sector SPDR Fund',
    representativeSics: ['6798', '6512', '6510', '6531'],
  },
  {
    id: 'COMMUNICATION_SERVICES',
    name: 'Communication Services',
    shortName: 'Comm Svc',
    etfTicker: 'XLC',
    etfName: 'Communication Services Select Sector SPDR Fund',
    representativeSics: ['4813', '4812', '4841', '7812'],
  },
] as const;

export const SECTOR_BY_ID: Record<SectorId, SectorDefinition> = GICS_SECTORS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<SectorId, SectorDefinition>
);

const SECTOR_ETF_TICKER_TO_ID: Record<string, SectorId> = GICS_SECTORS.reduce(
  (acc, s) => {
    acc[s.etfTicker] = s.id;
    return acc;
  },
  {} as Record<string, SectorId>
);

const SECTOR_ETF_NAME_PATTERNS: Array<{ pattern: RegExp; sectorId: SectorId }> = [
  { pattern: /\bTECHNOLOGY\s+SELECT\s+SECTOR\b|\bXLK\b/i, sectorId: 'TECHNOLOGY' },
  { pattern: /\bFINANCIAL\s+SELECT\s+SECTOR\b|\bXLF\b/i, sectorId: 'FINANCIALS' },
  { pattern: /\bHEALTH\s*CARE\s+SELECT\s+SECTOR\b|\bXLV\b/i, sectorId: 'HEALTHCARE' },
  { pattern: /\bCONSUMER\s+DISCRETIONARY\s+SELECT\s+SECTOR\b|\bXLY\b/i, sectorId: 'CONSUMER_DISCRETIONARY' },
  { pattern: /\bCONSUMER\s+STAPLES\s+SELECT\s+SECTOR\b|\bXLP\b/i, sectorId: 'CONSUMER_STAPLES' },
  { pattern: /\bENERGY\s+SELECT\s+SECTOR\b|\bXLE\b/i, sectorId: 'ENERGY' },
  { pattern: /\bINDUSTRIAL\s+SELECT\s+SECTOR\b|\bXLI\b/i, sectorId: 'INDUSTRIALS' },
  { pattern: /\bMATERIALS\s+SELECT\s+SECTOR\b|\bXLB\b/i, sectorId: 'MATERIALS' },
  { pattern: /\bUTILITIES\s+SELECT\s+SECTOR\b|\bXLU\b/i, sectorId: 'UTILITIES' },
  { pattern: /\bREAL\s+ESTATE\s+SELECT\s+SECTOR\b|\bXLRE\b/i, sectorId: 'REAL_ESTATE' },
  { pattern: /\bCOMMUNICATION\s+SERVICES\s+SELECT\s+SECTOR\b|\bXLC\b/i, sectorId: 'COMMUNICATION_SERVICES' },
];

// Explicit GICS Communication Services operating issuers whose SEC SIC code (e.g. 7370/7372/7374)
// predates the 2018 GICS Communication Services reclassification.
const COMMUNICATION_SERVICES_ISSUER_OVERRIDES: RegExp[] = [
  /\bALPHABET\b/i,
  /\bMETA\s+PLATFORMS\b/i,
  /\bNETFLIX\b/i,
  /\bWALT\s+DISNEY\b|\bDISNEY\b/i,
  /\bSPOTIFY\b/i,
  /\bELECTRONIC\s+ARTS\b/i,
  /\bTAKE[- ]TWO\b/i,
  /\bROBLOX\b/i,
  /\bPINTEREST\b/i,
  /\bSNAP\s+INC\b/i,
  /\bREDDIT\b/i,
  /\bMATCH\s+GROUP\b/i,
  /\bWARNER\s+BROS\b/i,
  /\bPARAMOUNT\b/i,
  /\bCOMCAST\b/i,
  /\bCHARTER\s+COMM/i,
  /\bT[- ]MOBILE\b/i,
  /\bVERIZON\b/i,
  /\bAT&T\b/i,
  /\bTRADE\s+DESK\b/i,
  /\bOMNICOM\b/i,
  /\bINTERPUBLIC\b/i,
  /\bLIVE\s+NATION\b/i,
  /\bFOXA?\s+CORP\b|\bNEWS\s+CORP\b/i,
];

// Explicit multi-sector / broad-market ETF, index trust, and fund patterns that must NOT
// be misclassified into Financials or any single equity sector.
const BROAD_FUND_OR_ETF_PATTERNS: RegExp[] = [
  /\bSPDR\b/i,
  /\bISHARES\b/i,
  /\bVANGUARD\b/i,
  /\bINVESCO\b/i,
  /\bPROSHARES\b/i,
  /\bDIREXION\b/i,
  /\bSCHWAB\s+STRATEGIC\b/i,
  /\bFIRST\s+TRUST\b/i,
  /\bWISDOMTREE\b/i,
  /\bVANECK\b/i,
  /\bGLOBAL\s+X\b/i,
  /\bARK\s+ETF\b/i,
  /\bSELECT\s+SECTOR\b/i,
  /\bS&P\s*500\b/i,
  /\bRUSSELL\s*(1000|2000|3000)\b/i,
  /\bNASDAQ\s*100\b|\bQQQ\b/i,
  /\bETF\b/i,
  /\bINDEX\s+FD\b|\bINDEX\s+FUND\b|\bINDEX\s+TR\b/i,
  /\bEXCHANGE\s+TRADED\b/i,
  /\bTRUST\s+UNIT\b|\bUNIT\s+TR\b/i,
  /\bBOND\s+FD\b|\bTREASURY\b|\bMUNICIPAL\b/i,
];

/**
 * Normalizes an issuer/company name for matching between Form 13F issuer names
 * and 3spread SEC filing registry names.
 */
export function normalizeCompanyMatchKey(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[.,/\\'"()\-]/g, ' ')
    .replace(
      /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|PLC|LP|LLC|NV|SA|AG|SE|HOLDINGS?|HLDGS?|GROUP|GRP|DELAWARE|DEL|NEW|CLASS\s+[A-Z]|CL\s+[A-Z]|COM|SHS|ORD|ADS|ADR|THE)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchDirectSectorEtf(
  issuerName: string | null | undefined,
  ticker?: string | null
): SectorId | null {
  if (ticker) {
    const cleanTicker = ticker.trim().toUpperCase();
    if (SECTOR_ETF_TICKER_TO_ID[cleanTicker]) {
      return SECTOR_ETF_TICKER_TO_ID[cleanTicker];
    }
  }
  if (!issuerName) return null;
  for (const entry of SECTOR_ETF_NAME_PATTERNS) {
    if (entry.pattern.test(issuerName)) return entry.sectorId;
  }
  return null;
}

export function isBroadMarketOrMultiSectorFund(
  issuerName: string | null | undefined,
  titleOfClass?: string | null
): boolean {
  if (matchDirectSectorEtf(issuerName)) return false;
  const combined = `${issuerName || ''} ${titleOfClass || ''}`.trim();
  if (!combined) return false;
  if (/\b(ETF|ETN|FUND|TR\s+UNIT|UNIT\s+BEN\s+INT)\b/i.test(titleOfClass || '')) {
    return true;
  }
  return BROAD_FUND_OR_ETF_PATTERNS.some((p) => p.test(combined));
}

/**
 * Documented mapping from 4-digit SEC Standard Industrial Classification (SIC) code
 * to the 11 GICS market sectors.
 *
 * Returns `null` for non-operating investment offices/funds (6722, 6726), blank-check
 * SPACs (6770), non-classifiable establishments (9995), or invalid codes so they are
 * disclosed as Unclassified instead of being misassigned.
 */
export function mapSicToGicsSector(
  rawSic: string | number | null | undefined,
  issuerName?: string | null
): SectorId | null {
  if (issuerName && COMMUNICATION_SERVICES_ISSUER_OVERRIDES.some((p) => p.test(issuerName))) {
    return 'COMMUNICATION_SERVICES';
  }

  if (rawSic === null || rawSic === undefined) return null;
  const digits = String(rawSic).replace(/\D/g, '');
  if (!digits) return null;
  const sic = Number(digits);
  if (!Number.isInteger(sic) || sic < 100 || sic > 9999) return null;

  // Explicitly unassignable SEC SIC codes (investment companies, funds, SPACs, non-classifiable)
  if (sic === 6722 || sic === 6726 || sic === 6770 || sic === 8880 || sic === 8888 || sic >= 9900) {
    return null;
  }

  // Real Estate (REITs + Real Estate Operators/Developers/Agents)
  if (sic === 6798 || (sic >= 6500 && sic <= 6553)) {
    return 'REAL_ESTATE';
  }

  // Financials (Depository, Credit, Brokers, Insurance, Holding/Investment Cos excluding REITs & funds)
  if (sic >= 6000 && sic <= 6799) {
    // Health Insurance / Hospital & Medical Service Plans (6324) are GICS Healthcare
    if (sic === 6324) return 'HEALTHCARE';
    return 'FINANCIALS';
  }

  // Energy (Oil & Gas Extraction, Refining, Pipelines, Coal)
  if (
    (sic >= 1200 && sic <= 1389) ||
    (sic >= 2900 && sic <= 2999) ||
    sic === 3533 ||
    sic === 4610 ||
    sic === 4922 ||
    sic === 5171 ||
    sic === 5172
  ) {
    return 'ENERGY';
  }

  // Utilities (Electric, Natural Gas Distribution, Water Supply)
  if (sic >= 4900 && sic <= 4949) {
    return 'UTILITIES';
  }

  // Communication Services (Telecom, Broadcasting, Cable, Motion Pictures, Advertising, Publishing)
  if (
    (sic >= 4800 && sic <= 4899) ||
    (sic >= 7800 && sic <= 7841) ||
    sic === 7310 ||
    sic === 7311 ||
    sic === 2711 ||
    sic === 2721 ||
    sic === 2731 ||
    sic === 2741
  ) {
    return 'COMMUNICATION_SERVICES';
  }

  // Healthcare (Pharma, Biotech, Medical Devices, Health Services, Drug Stores)
  if (
    (sic >= 2830 && sic <= 2836) ||
    (sic >= 3841 && sic <= 3851) ||
    (sic >= 8000 && sic <= 8099) ||
    sic === 5047 ||
    sic === 5122
  ) {
    return 'HEALTHCARE';
  }

  // Technology (Computers, Semiconductors, Electronic Components, Instruments, Software/IT Services)
  if (
    (sic >= 3570 && sic <= 3579) ||
    (sic >= 3660 && sic <= 3679) ||
    (sic >= 3812 && sic <= 3829) ||
    (sic >= 7370 && sic <= 7379) ||
    sic === 3695 ||
    sic === 3559 ||
    sic === 5045
  ) {
    return 'TECHNOLOGY';
  }

  // Materials (Metals/Mining, Industrial Chemicals, Plastics, Paper, Glass/Cement, Steel)
  if (
    (sic >= 1000 && sic <= 1099) ||
    (sic >= 1400 && sic <= 1499) ||
    (sic >= 2600 && sic <= 2679) ||
    (sic >= 2800 && sic <= 2829) ||
    (sic >= 2850 && sic <= 2899) ||
    (sic >= 3200 && sic <= 3399)
  ) {
    return 'MATERIALS';
  }

  // Consumer Staples (Food, Beverages, Tobacco, Household/Personal Care, Grocery, Drug Retail)
  if (
    (sic >= 100 && sic <= 299) ||
    (sic >= 2000 && sic <= 2199) ||
    (sic >= 2840 && sic <= 2844) ||
    (sic >= 5140 && sic <= 5159) ||
    (sic >= 5180 && sic <= 5182) ||
    (sic >= 5400 && sic <= 5499) ||
    sic === 5912 ||
    sic === 5331
  ) {
    return 'CONSUMER_STAPLES';
  }

  // Consumer Discretionary (Apparel, Autos, Homebuilders, Furniture, Retail, Restaurants, Hotels, Leisure)
  if (
    (sic >= 1520 && sic <= 1531) ||
    (sic >= 2200 && sic <= 2399) ||
    (sic >= 2500 && sic <= 2599) ||
    (sic >= 3021 && sic <= 3199) ||
    (sic >= 3630 && sic <= 3652) ||
    (sic >= 3711 && sic <= 3716) ||
    (sic >= 3751 && sic <= 3792) ||
    (sic >= 3942 && sic <= 3949) ||
    (sic >= 5200 && sic <= 5399) ||
    (sic >= 5500 && sic <= 5999) ||
    (sic >= 7000 && sic <= 7041) ||
    (sic >= 7500 && sic <= 7519) ||
    (sic >= 7900 && sic <= 7999)
  ) {
    return 'CONSUMER_DISCRETIONARY';
  }

  // Industrials (Construction, Aerospace/Defense, Machinery, Electrical Equip, Transport, Logistics, Waste, Commercial Services)
  if (
    (sic >= 1500 && sic <= 1799) ||
    (sic >= 3400 && sic <= 3599) ||
    (sic >= 3600 && sic <= 3699) ||
    (sic >= 3700 && sic <= 3799) ||
    (sic >= 4000 && sic <= 4799) ||
    (sic >= 4950 && sic <= 4999) ||
    (sic >= 5000 && sic <= 5199) ||
    (sic >= 7300 && sic <= 7399) ||
    (sic >= 8700 && sic <= 8748)
  ) {
    return 'INDUSTRIALS';
  }

  return null;
}

/**
 * Maps Yahoo Finance canonical equity sector labels onto the 11 GICS sector IDs.
 */
export function mapMarketSectorToGicsSector(rawSector: string | null | undefined): SectorId | null {
  if (!rawSector || typeof rawSector !== 'string') return null;
  const s = rawSector.trim().toLowerCase();
  if (!s) return null;
  if (s === 'technology' || s === 'information technology') return 'TECHNOLOGY';
  if (s === 'financial services' || s === 'financials') return 'FINANCIALS';
  if (s === 'healthcare' || s === 'health care') return 'HEALTHCARE';
  if (s === 'consumer cyclical' || s === 'consumer discretionary') return 'CONSUMER_DISCRETIONARY';
  if (s === 'consumer defensive' || s === 'consumer staples') return 'CONSUMER_STAPLES';
  if (s === 'energy') return 'ENERGY';
  if (s === 'industrials') return 'INDUSTRIALS';
  if (s === 'basic materials' || s === 'materials') return 'MATERIALS';
  if (s === 'utilities') return 'UTILITIES';
  if (s === 'real estate') return 'REAL_ESTATE';
  if (s === 'communication services' || s === 'telecommunication services') {
    return 'COMMUNICATION_SERVICES';
  }
  return null;
}

function subtractPeriodFromIsoDate(isoDate: string, period: SectorPerformancePeriod): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month, day));

  if (period === '1W') {
    dt.setUTCDate(dt.getUTCDate() - 7);
  } else if (period === '1M') {
    dt.setUTCMonth(dt.getUTCMonth() - 1);
  } else if (period === '3M') {
    dt.setUTCMonth(dt.getUTCMonth() - 3);
  } else if (period === '6M') {
    dt.setUTCMonth(dt.getUTCMonth() - 6);
  }
  return dt.toISOString().slice(0, 10);
}

/**
 * Computes exact historical return for a lookback period from sorted daily closing bars.
 * Selects the latest trading bar on or before the target calendar lookback date
 * so weekends and market holidays never cause off-by-one distortions.
 * Returns nulls rather than fabricated figures when history does not reach the lookback anchor.
 */
export function computePeriodReturn(
  sortedBars: SectorPriceHistoryPoint[],
  period: SectorPerformancePeriod
): SectorPeriodReturnPoint {
  if (!Array.isArray(sortedBars) || sortedBars.length < 2) {
    return {
      returnPct: null,
      startDate: null,
      endDate: null,
      startPrice: null,
      endPrice: null,
    };
  }

  const latest = sortedBars[sortedBars.length - 1];
  if (!latest || !Number.isFinite(latest.close) || latest.close <= 0) {
    return {
      returnPct: null,
      startDate: null,
      endDate: null,
      startPrice: null,
      endPrice: null,
    };
  }

  const targetAnchorDate = subtractPeriodFromIsoDate(latest.date, period);

  // Require bars to actually span back to within 5 days of targetAnchorDate so short histories
  // are never misrepresented as 3M or 6M returns.
  const earliest = sortedBars[0];
  const maxAllowedGapMs = 7 * 24 * 60 * 60 * 1000;
  const earliestMs = Date.parse(`${earliest.date}T00:00:00Z`);
  const targetMs = Date.parse(`${targetAnchorDate}T00:00:00Z`);
  if (!Number.isFinite(earliestMs) || !Number.isFinite(targetMs) || earliestMs - targetMs > maxAllowedGapMs) {
    return {
      returnPct: null,
      startDate: null,
      endDate: latest.date,
      startPrice: null,
      endPrice: latest.close,
    };
  }

  // Find the latest bar whose date <= targetAnchorDate; if earliest is slightly after (within tolerance), use earliest
  let anchor: SectorPriceHistoryPoint | null = null;
  for (let i = sortedBars.length - 2; i >= 0; i--) {
    if (sortedBars[i].date <= targetAnchorDate) {
      anchor = sortedBars[i];
      break;
    }
  }
  if (!anchor) {
    anchor = earliest;
  }

  if (!anchor || anchor.date === latest.date || !Number.isFinite(anchor.close) || anchor.close <= 0) {
    return {
      returnPct: null,
      startDate: null,
      endDate: latest.date,
      startPrice: null,
      endPrice: latest.close,
    };
  }

  const returnPct = ((latest.close - anchor.close) / anchor.close) * 100;
  return {
    returnPct,
    startDate: anchor.date,
    endDate: latest.date,
    startPrice: anchor.close,
    endPrice: latest.close,
  };
}

/**
 * Transparent quadrant classification derived strictly from historical relative performance
 * vs the broad-market benchmark (SPY) and near-term relative momentum:
 *
 * - For 1M, 3M, 6M:
 *   - Selected Relative Strength (RS) = Sector Return - SPY Return for the selected period.
 *   - Near-Term Momentum RS = 1W RS (when 1M is selected) or 1M RS (when 3M or 6M is selected).
 *   - Leading:   RS >= 0 and Near-Term RS >= 0 (outperforming with positive near-term relative strength)
 *   - Weakening: RS >= 0 and Near-Term RS <  0 (outperforming overall, losing near-term relative strength)
 *   - Improving: RS <  0 and Near-Term RS >= 0 (underperforming overall, gaining near-term relative strength)
 *   - Lagging:   RS <  0 and Near-Term RS <  0 (sustained underperformance)
 * - For 1W:
 *   - Compares 1W RS (near-term) against 1M RS (baseline):
 *     Leading (1W >= 0, 1M >= 0), Improving (1W >= 0, 1M < 0),
 *     Weakening (1W < 0, 1M >= 0), Lagging (1W < 0, 1M < 0).
 */
export function classifySectorRotation(
  period: SectorPerformancePeriod,
  relativeStrength: Record<SectorPerformancePeriod, number | null>
): SectorRotationStatus {
  const rsSelected = relativeStrength[period];
  if (rsSelected === null || !Number.isFinite(rsSelected)) {
    return 'INSUFFICIENT_DATA';
  }

  if (period === '1W') {
    const rsBaseline = relativeStrength['1M'];
    if (rsBaseline === null || !Number.isFinite(rsBaseline)) {
      return 'INSUFFICIENT_DATA';
    }
    if (rsSelected >= 0 && rsBaseline >= 0) return 'LEADING';
    if (rsSelected >= 0 && rsBaseline < 0) return 'IMPROVING';
    if (rsSelected < 0 && rsBaseline >= 0) return 'WEAKENING';
    return 'LAGGING';
  }

  const nearTermPeriod: SectorPerformancePeriod = period === '1M' ? '1W' : '1M';
  const rsNearTerm = relativeStrength[nearTermPeriod];
  if (rsNearTerm === null || !Number.isFinite(rsNearTerm)) {
    return 'INSUFFICIENT_DATA';
  }

  if (rsSelected >= 0 && rsNearTerm >= 0) return 'LEADING';
  if (rsSelected >= 0 && rsNearTerm < 0) return 'WEAKENING';
  if (rsSelected < 0 && rsNearTerm >= 0) return 'IMPROVING';
  return 'LAGGING';
}

/**
 * Classifies insider buy/sell ratio from 3spread's Form 4 ratio (buys_dollars / (buys_dollars + sells_dollars)).
 * Because executive compensation sales typically dominate open-market dollar volumes on Form 4,
 * requires at least 3 total transactions before assigning a directional sentiment label:
 * - NET_BUYING:  buySellRatio >= 0.40
 * - BALANCED:    0.15 <= buySellRatio < 0.40
 * - NET_SELLING: buySellRatio < 0.15
 */
export function classifyInsiderSentiment(params: {
  buySellRatio: number | null;
  buysCount: number | null;
  sellsCount: number | null;
}): SectorInsiderSentimentStatus {
  const totalTx = (params.buysCount ?? 0) + (params.sellsCount ?? 0);
  if (params.buySellRatio === null || !Number.isFinite(params.buySellRatio) || totalTx < 3) {
    return 'UNAVAILABLE';
  }
  if (params.buySellRatio >= 0.4) return 'NET_BUYING';
  if (params.buySellRatio >= 0.15) return 'BALANCED';
  return 'NET_SELLING';
}

export interface ClassifiedSecurityMeta {
  sectorId: SectorId | null;
  method: '3SPREAD_SIC' | 'MARKET_SECTOR' | 'SECTOR_ETF' | 'UNCLASSIFIED_FUND' | 'UNCLASSIFIED_UNKNOWN';
  sic?: string | null;
  ticker?: string | null;
}

export function createEmptyInstitutionalSummary(params: {
  available: boolean;
  reportingPeriod: string | null;
  previousPeriod: string | null;
  comparableManagersTotal: number;
}): SectorInstitutionalSummary {
  return {
    available: params.available,
    reportingPeriod: params.reportingPeriod,
    previousPeriod: params.previousPeriod,
    comparableManagersTotal: params.comparableManagersTotal,
    activeManagersCount: 0,
    managersIncreasing: 0,
    managersDecreasing: 0,
    managersUnchanged: 0,
    newPositions: 0,
    exitedPositions: 0,
    increasedPositions: 0,
    decreasedPositions: 0,
    classifiedSecuritiesCount: 0,
    priorTotalShares: 0,
    currentTotalShares: 0,
    netShareChange: 0,
    netPercentChange: null,
    aggregateValueUsd: 0,
    priorAggregateValueUsd: 0,
    valueChangePct: null,
    trend: 'INSUFFICIENT_DATA',
    topSecurities: [],
    largestIncreases: [],
    largestDecreases: [],
    recentNewPositions: [],
    recentExits: [],
  };
}

/**
 * Aggregates verified comparable-period institutional 13F cohort positions and changes by GICS sector.
 *
 * Anti-double-counting guarantees:
 * - Each unique CUSIP is assigned to at most one GICS sector (or tracked as Unclassified).
 * - Institutional manager counts per sector (managersIncreasing / managersDecreasing / activeManagersCount)
 *   are computed by distinct `managerCik` net share change across that sector so a manager holding multiple
 *   stocks in the same sector is NEVER counted twice.
 * - Unclassified securities and broad-market ETFs are excluded from sector totals and explicitly reported
 *   in `coverage`.
 */
export function aggregateInstitutionalBySector(params: {
  accumulation: InstitutionalAccumulationRow[];
  changes: InstitutionalPositionChangeRow[];
  classificationByCusip: Map<string, ClassifiedSecurityMeta>;
  reportingPeriod: string | null;
  previousPeriod: string | null;
  comparableManagersTotal: number;
  available: boolean;
}): {
  bySector: Record<SectorId, SectorInstitutionalSummary>;
  coverage: SectorClassificationCoverage;
} {
  const {
    accumulation,
    changes,
    classificationByCusip,
    reportingPeriod,
    previousPeriod,
    comparableManagersTotal,
    available,
  } = params;

  const bySector = {} as Record<SectorId, SectorInstitutionalSummary>;
  const sectorManagerNetShares = new Map<SectorId, Map<string, number>>();
  const sectorActiveManagers = new Map<SectorId, Set<string>>();
  const sectorSecurities = new Map<SectorId, InstitutionalAccumulationRow[]>();
  const sectorChanges = new Map<SectorId, InstitutionalPositionChangeRow[]>();

  for (const s of GICS_SECTORS) {
    bySector[s.id] = createEmptyInstitutionalSummary({
      available,
      reportingPeriod,
      previousPeriod,
      comparableManagersTotal,
    });
    sectorManagerNetShares.set(s.id, new Map());
    sectorActiveManagers.set(s.id, new Set());
    sectorSecurities.set(s.id, []);
    sectorChanges.set(s.id, []);
  }

  const coverage: SectorClassificationCoverage = {
    totalSecuritiesInCohort: 0,
    classifiedSecuritiesCount: 0,
    unclassifiedSecuritiesCount: 0,
    unclassifiedFundOrEtfCount: 0,
    unclassifiedUnknownCount: 0,
    classifiedValueUsd: 0,
    unclassifiedValueUsd: 0,
    classifiedValuePct: null,
    threeSpreadSicMatchedCount: 0,
    marketSectorMatchedCount: 0,
    directSectorEtfMatchedCount: 0,
  };

  // Deduplicate accumulation rows by CUSIP defensively
  const seenCusips = new Set<string>();
  for (const sec of accumulation) {
    if (!sec.cusip || seenCusips.has(sec.cusip)) continue;
    seenCusips.add(sec.cusip);
    coverage.totalSecuritiesInCohort += 1;

    const meta = classificationByCusip.get(sec.cusip) || {
      sectorId: null,
      method: 'UNCLASSIFIED_UNKNOWN',
    };

    if (!meta.sectorId) {
      coverage.unclassifiedSecuritiesCount += 1;
      coverage.unclassifiedValueUsd += sec.totalValueUsd;
      if (meta.method === 'UNCLASSIFIED_FUND') {
        coverage.unclassifiedFundOrEtfCount += 1;
      } else {
        coverage.unclassifiedUnknownCount += 1;
      }
      continue;
    }

    coverage.classifiedSecuritiesCount += 1;
    coverage.classifiedValueUsd += sec.totalValueUsd;
    if (meta.method === '3SPREAD_SIC') coverage.threeSpreadSicMatchedCount += 1;
    else if (meta.method === 'MARKET_SECTOR') coverage.marketSectorMatchedCount += 1;
    else if (meta.method === 'SECTOR_ETF') coverage.directSectorEtfMatchedCount += 1;

    const enrichedSec: InstitutionalAccumulationRow = {
      ...sec,
      ticker: sec.ticker || meta.ticker || null,
    };
    const summary = bySector[meta.sectorId];
    summary.classifiedSecuritiesCount += 1;
    summary.priorTotalShares += sec.priorTotalShares;
    summary.currentTotalShares += sec.currentTotalShares;
    summary.netShareChange += sec.netShareChange;
    summary.aggregateValueUsd += sec.totalValueUsd;
    summary.newPositions += sec.newPositions;
    summary.exitedPositions += sec.exitedPositions;
    summary.increasedPositions += sec.institutionsIncreasing;
    summary.decreasedPositions += sec.institutionsDecreasing;
    sectorSecurities.get(meta.sectorId)!.push(enrichedSec);
  }

  const totalValueAll = coverage.classifiedValueUsd + coverage.unclassifiedValueUsd;
  coverage.classifiedValuePct =
    totalValueAll > 0 ? (coverage.classifiedValueUsd / totalValueAll) * 100 : null;

  // Deduplicate position change events by (managerCik::cusip) to prevent double-counting
  const seenChangePairs = new Set<string>();
  for (const ch of changes) {
    const pairKey = `${ch.managerCik}::${ch.cusip}`;
    if (!ch.managerCik || !ch.cusip || seenChangePairs.has(pairKey)) continue;
    seenChangePairs.add(pairKey);

    const meta = classificationByCusip.get(ch.cusip);
    if (!meta?.sectorId) continue;

    const sectorId = meta.sectorId;
    const summary = bySector[sectorId];
    summary.priorAggregateValueUsd += ch.previousValueUsd;

    const managerNetMap = sectorManagerNetShares.get(sectorId)!;
    managerNetMap.set(ch.managerCik, (managerNetMap.get(ch.managerCik) || 0) + ch.shareChange);

    if (ch.currentShares > 0) {
      sectorActiveManagers.get(sectorId)!.add(ch.managerCik);
    }

    sectorChanges.get(sectorId)!.push({
      ...ch,
      ticker: ch.ticker || meta.ticker || null,
    });
  }

  // Finalize distinct-manager counts, percentages, trends, and top drill-down lists
  for (const s of GICS_SECTORS) {
    const summary = bySector[s.id];
    const managerNetMap = sectorManagerNetShares.get(s.id)!;
    const activeSet = sectorActiveManagers.get(s.id)!;

    let managersIncreasing = 0;
    let managersDecreasing = 0;
    let managersUnchanged = 0;

    for (const netShares of managerNetMap.values()) {
      if (netShares > 0) managersIncreasing += 1;
      else if (netShares < 0) managersDecreasing += 1;
      else managersUnchanged += 1;
    }

    summary.activeManagersCount = activeSet.size;
    summary.managersIncreasing = managersIncreasing;
    summary.managersDecreasing = managersDecreasing;
    summary.managersUnchanged = managersUnchanged;

    summary.netPercentChange =
      summary.priorTotalShares > 0
        ? (summary.netShareChange / summary.priorTotalShares) * 100
        : null;
    summary.valueChangePct =
      summary.priorAggregateValueUsd > 0
        ? ((summary.aggregateValueUsd - summary.priorAggregateValueUsd) /
            summary.priorAggregateValueUsd) *
          100
        : null;

    const participatingManagers = managersIncreasing + managersDecreasing + managersUnchanged;
    summary.trend = classifyInstitutionalTrend({
      available,
      participatingManagers,
      managersIncreasing,
      managersDecreasing,
      netShareChange: summary.netShareChange,
    });

    const secList = sectorSecurities.get(s.id)!;
    secList.sort((a, b) => b.totalValueUsd - a.totalValueUsd || b.netShareChange - a.netShareChange);
    summary.topSecurities = secList.slice(0, 12);

    const chList = sectorChanges.get(s.id)!;
    summary.largestIncreases = chList
      .filter((c) => c.category === 'INCREASED')
      .sort(
        (a, b) =>
          Math.abs(b.currentValueUsd - b.previousValueUsd) -
            Math.abs(a.currentValueUsd - a.previousValueUsd) ||
          b.shareChange - a.shareChange
      )
      .slice(0, 12);

    summary.largestDecreases = chList
      .filter((c) => c.category === 'DECREASED')
      .sort(
        (a, b) =>
          Math.abs(b.previousValueUsd - b.currentValueUsd) -
            Math.abs(a.previousValueUsd - a.currentValueUsd) ||
          a.shareChange - b.shareChange
      )
      .slice(0, 12);

    summary.recentNewPositions = chList
      .filter((c) => c.category === 'NEW')
      .sort((a, b) => b.currentValueUsd - a.currentValueUsd || b.currentShares - a.currentShares)
      .slice(0, 12);

    summary.recentExits = chList
      .filter((c) => c.category === 'EXITED')
      .sort((a, b) => b.previousValueUsd - a.previousValueUsd || b.previousShares - a.previousShares)
      .slice(0, 12);
  }

  return { bySector, coverage };
}

export function classifyInstitutionalTrend(params: {
  available: boolean;
  participatingManagers: number;
  managersIncreasing: number;
  managersDecreasing: number;
  netShareChange: number;
}): SectorInstitutionalTrend {
  if (!params.available || params.participatingManagers < 2) {
    return 'INSUFFICIENT_DATA';
  }
  if (params.managersIncreasing > params.managersDecreasing && params.netShareChange > 0) {
    return 'ACCUMULATING';
  }
  if (params.managersDecreasing > params.managersIncreasing && params.netShareChange < 0) {
    return 'DISTRIBUTING';
  }
  return 'NEUTRAL';
}

/**
 * Computes relative strength rankings (1 = strongest) across all sectors with valid returns
 * and builds the responsive period overview summary.
 */
export function finalizeMarketRankingsAndOverview(
  sectors: SectorRotationItem[]
): Record<SectorPerformancePeriod, SectorRotationOverviewByPeriod> {
  const overviewByPeriod = {} as Record<SectorPerformancePeriod, SectorRotationOverviewByPeriod>;

  for (const period of PERFORMANCE_PERIODS) {
    const valid = sectors
      .filter((s) => s.market.returns[period].returnPct !== null)
      .sort((a, b) => {
        const rsA = a.market.relativeStrength[period];
        const rsB = b.market.relativeStrength[period];
        if (rsA !== null && rsB !== null) return rsB - rsA;
        return (b.market.returns[period].returnPct ?? -Infinity) - (a.market.returns[period].returnPct ?? -Infinity);
      });

    valid.forEach((item, index) => {
      item.market.relativeStrengthRank[period] = index + 1;
    });

    const strongest = valid[0] || null;
    const weakest = valid.length > 0 ? valid[valid.length - 1] : null;

    let outperformingCount = 0;
    let underperformingCount = 0;
    const improvingSectors: Array<{ id: SectorId; name: string; etfTicker: string }> = [];
    const weakeningSectors: Array<{ id: SectorId; name: string; etfTicker: string }> = [];

    for (const s of sectors) {
      const rs = s.market.relativeStrength[period];
      if (rs !== null) {
        if (rs >= 0) outperformingCount += 1;
        else underperformingCount += 1;
      }
      const status = s.market.rotationStatus[period];
      if (status === 'IMPROVING') {
        improvingSectors.push({ id: s.id, name: s.name, etfTicker: s.etfTicker });
      } else if (status === 'WEAKENING') {
        weakeningSectors.push({ id: s.id, name: s.name, etfTicker: s.etfTicker });
      }
    }

    overviewByPeriod[period] = {
      strongestSector: strongest
        ? {
            id: strongest.id,
            name: strongest.name,
            etfTicker: strongest.etfTicker,
            returnPct: strongest.market.returns[period].returnPct!,
            relativeStrengthPct: strongest.market.relativeStrength[period],
          }
        : null,
      weakestSector: weakest
        ? {
            id: weakest.id,
            name: weakest.name,
            etfTicker: weakest.etfTicker,
            returnPct: weakest.market.returns[period].returnPct!,
            relativeStrengthPct: weakest.market.relativeStrength[period],
          }
        : null,
      outperformingCount,
      underperformingCount,
      improvingSectors,
      weakeningSectors,
    };
  }

  return overviewByPeriod;
}

export function buildSectorMarketPerformance(params: {
  sector: SectorDefinition;
  bars: SectorPriceHistoryPoint[];
  benchmarkReturns: Record<SectorPerformancePeriod, SectorPeriodReturnPoint>;
  unavailableReason?: string | null;
}): SectorMarketPerformance {
  const { sector, bars, benchmarkReturns, unavailableReason = null } = params;
  const returns = {} as Record<SectorPerformancePeriod, SectorPeriodReturnPoint>;
  const relativeStrength = {} as Record<SectorPerformancePeriod, number | null>;
  const relativeStrengthRank = {} as Record<SectorPerformancePeriod, number | null>;
  const rotationStatus = {} as Record<SectorPerformancePeriod, SectorRotationStatus>;

  for (const period of PERFORMANCE_PERIODS) {
    const r = computePeriodReturn(bars, period);
    returns[period] = r;
    const benchR = benchmarkReturns[period]?.returnPct;
    relativeStrength[period] =
      r.returnPct !== null && benchR !== null && benchR !== undefined
        ? r.returnPct - benchR
        : null;
    relativeStrengthRank[period] = null;
  }

  for (const period of PERFORMANCE_PERIODS) {
    rotationStatus[period] = classifySectorRotation(period, relativeStrength);
  }

  const latest = bars.length > 0 ? bars[bars.length - 1] : null;
  return {
    etfTicker: sector.etfTicker,
    etfName: sector.etfName,
    latestPrice: latest ? latest.close : null,
    latestDate: latest ? latest.date : null,
    returns,
    relativeStrength,
    relativeStrengthRank,
    rotationStatus,
    history: bars,
    unavailableReason: bars.length === 0 ? unavailableReason || 'Market price history unavailable.' : null,
  };
}

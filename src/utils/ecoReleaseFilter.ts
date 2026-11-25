import type { FredReleaseDate } from '../types';

export type EcoReleaseCategory =
  | 'CPI'
  | 'PPI'
  | 'PCE'
  | 'FOMC'
  | 'GDP'
  | 'NFP'
  | 'CLAIMS'
  | 'JOLTS'
  | 'RETAIL'
  | 'DURABLE'
  | 'INDPRO'
  | 'HOUSING'
  | 'SOFR'
  | 'RATES'
  | 'VIX';

export interface EcoCategoryMeta {
  code: EcoReleaseCategory;
  name: string;
  releaseIds: number[];
  terms: string[];
}

export const ECO_RELEASE_CATEGORIES: Record<EcoReleaseCategory, EcoCategoryMeta> = {
  CPI: {
    code: 'CPI',
    name: 'Consumer Price Index',
    releaseIds: [10],
    terms: ['consumer price index', 'cpi'],
  },
  PPI: {
    code: 'PPI',
    name: 'Producer Price Index',
    releaseIds: [44],
    terms: ['producer price index', 'ppi'],
  },
  PCE: {
    code: 'PCE',
    name: 'Personal Consumption Expenditures',
    releaseIds: [54],
    terms: ['personal income and outlays', 'personal consumption expenditures', 'pce'],
  },
  FOMC: {
    code: 'FOMC',
    name: 'FOMC Policy & Statements',
    releaseIds: [25, 413],
    terms: ['fomc', 'federal open market committee', 'summary of economic projections'],
  },
  GDP: {
    code: 'GDP',
    name: 'Gross Domestic Product',
    releaseIds: [53],
    terms: ['gross domestic product', 'gdp'],
  },
  NFP: {
    code: 'NFP',
    name: 'Nonfarm Payrolls & Employment',
    releaseIds: [50],
    terms: ['employment situation', 'nonfarm payroll', 'unemployment rate', 'nfp'],
  },
  CLAIMS: {
    code: 'CLAIMS',
    name: 'Jobless Claims',
    releaseIds: [248, 298],
    terms: ['weekly claims', 'initial claims', 'jobless claims', 'unemployment insurance'],
  },
  JOLTS: {
    code: 'JOLTS',
    name: 'Job Openings & Labor Turnover',
    releaseIds: [52],
    terms: ['job openings and labor turnover', 'jolts'],
  },
  RETAIL: {
    code: 'RETAIL',
    name: 'Retail Sales',
    releaseIds: [9],
    terms: ['retail and food services', 'retail trade', 'retail sales'],
  },
  DURABLE: {
    code: 'DURABLE',
    name: 'Durable Goods Orders',
    releaseIds: [45, 126],
    terms: ['manufacturers\' shipments, inventories, and orders', 'durable goods', 'advance report on durable goods'],
  },
  INDPRO: {
    code: 'INDPRO',
    name: 'Industrial Production',
    releaseIds: [13],
    terms: ['industrial production and capacity utilization', 'g.17', 'industrial production'],
  },
  HOUSING: {
    code: 'HOUSING',
    name: 'Housing & Construction',
    releaseIds: [26, 27, 28, 41, 102],
    terms: ['new residential construction', 'housing starts', 'building permits', 'new home sales', 'existing home sales'],
  },
  SOFR: {
    code: 'SOFR',
    name: 'Secured Overnight Financing Rate',
    releaseIds: [433],
    terms: ['secured overnight financing rate', 'sofr'],
  },
  RATES: {
    code: 'RATES',
    name: 'H.15 Selected Interest Rates',
    releaseIds: [18],
    terms: ['selected interest rates', 'h.15', 'treasury yields'],
  },
  VIX: {
    code: 'VIX',
    name: 'CBOE Volatility Index',
    releaseIds: [204],
    terms: ['cboe', 'volatility index', 'vix'],
  },
};

export const SUPPORTED_ECO_CATEGORIES = Object.keys(
  ECO_RELEASE_CATEGORIES
) as EcoReleaseCategory[];

const ECO_ALIASES_MAP: Record<string, EcoReleaseCategory> = {
  PAYROLL: 'NFP',
  PAYROLLS: 'NFP',
  NONFARM: 'NFP',
  JOBS: 'NFP',
  EMPLOYMENT: 'NFP',
  UNEMPLOYMENT: 'NFP',
  'JOBLESS CLAIMS': 'CLAIMS',
  'INITIAL CLAIMS': 'CLAIMS',
  H15: 'RATES',
  'H.15': 'RATES',
  TREASURY: 'RATES',
  YIELDS: 'RATES',
  INTEREST: 'RATES',
  INFLATION: 'CPI',
};

export function normalizeEcoCategory(input: string): EcoReleaseCategory | null {
  const trimmed = input.trim().toUpperCase();
  if (trimmed in ECO_RELEASE_CATEGORIES) {
    return trimmed as EcoReleaseCategory;
  }
  if (trimmed in ECO_ALIASES_MAP) {
    return ECO_ALIASES_MAP[trimmed];
  }
  return null;
}

export function filterFredReleasesByCategory(
  releases: FredReleaseDate[],
  category: EcoReleaseCategory | null | string
): FredReleaseDate[] {
  if (!category) return releases;
  const normalized = normalizeEcoCategory(category);
  if (!normalized) return releases;

  const meta = ECO_RELEASE_CATEGORIES[normalized];
  const idSet = new Set(meta.releaseIds);

  return releases.filter((rel) => {
    if (idSet.has(rel.releaseId)) {
      return true;
    }
    const lowerName = rel.releaseName.toLowerCase();
    return meta.terms.some((term) => lowerName.includes(term));
  });
}

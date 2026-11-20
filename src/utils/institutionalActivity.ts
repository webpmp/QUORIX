import type {
  InstitutionalAccumulationRow,
  InstitutionalHoldingRow,
  InstitutionalInvestorProfile,
  InstitutionalPositionChangeRow,
  InstitutionalPositionStatus,
  InstitutionalHoldingsSummary,
} from '../types';

/**
 * Raw 3spread Form 13F holding record shape from GET /v1/institutional-holdings/holdings
 * Verified against https://api.3spread.com/openapi.json (InstitutionalHoldingResponse)
 */
export interface ThreeSpreadHoldingRecord {
  filing_id: string;
  record_index: number;
  period_of_report: string | null;
  filing_manager_cik: string | null;
  filing_manager_name: string | null;
  name_of_issuer: string | null;
  title_of_class: string | null;
  cusip: string | null;
  figi: string | null;
  value: string | null;
  value_usd: string | null;
  value_multiple: number | null;
  ssh_prnamt: string | null;
  ssh_prnamt_type: string | null;
  investment_discretion: string | null;
  voting_sole: string | null;
  voting_shared: string | null;
  voting_none: string | null;
}

/**
 * Raw 3spread Form 13F filing summary shape from GET /v1/institutional-holdings
 * Verified against https://api.3spread.com/openapi.json (InstitutionalFilingSummary)
 */
export interface ThreeSpreadFilingSummary {
  filing_id: string;
  cik: string;
  form_type: string;
  period_of_report: string | null;
  accepted_time: string | null;
  is_valid?: boolean | null;
  is_amendment?: boolean | null;
  amends_filing_id?: string | null;
  amendment_filing_ids?: string[] | null;
  filer_name?: string | null;
  filer_tickers?: string[] | null;
  filing_manager_cik?: string | null;
  filing_manager_name?: string | null;
  report_type?: string | null;
  amendment_no?: number | null;
  table_entry_total?: number | null;
  table_value_total?: string | null;
  table_value_total_usd?: string | null;
  accession_num?: string | null;
  source_url?: string | null;
  filing_manager_city?: string | null;
  filing_manager_state_or_country?: string | null;
  is_confidential_omitted?: boolean | null;
}

export interface AggregatedPosition {
  managerCik: string;
  managerName: string;
  cusip: string;
  figi: string | null;
  issuerName: string;
  titleOfClass: string | null;
  shares: number;
  sharesType: string;
  valueUsd: number;
  reportingPeriod: string;
  filingId: string;
  investmentDiscretion: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
}

export function normalizeCik(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+/, '') || '0';
}

export function normalizeCusip(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9);
}

export function parseNumericField(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== 'string') return 0;
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNullableNumericField(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = parseNumericField(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePeriodDate(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const usMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (usMatch) return `${usMatch[3]}-${usMatch[1]}-${usMatch[2]}`;
  return null;
}

/**
 * Given a calendar quarter-end reporting period (YYYY-MM-DD), returns the immediately
 * preceding calendar quarter-end date so period-over-period comparisons only match
 * equivalent consecutive 13F reporting periods.
 */
export function getPreviousQuarterEnd(periodDate: string): string | null {
  const norm = normalizePeriodDate(periodDate);
  if (!norm) return null;
  const [yStr, mStr] = norm.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;

  if (month <= 3) return `${year - 1}-12-31`;
  if (month <= 6) return `${year}-03-31`;
  if (month <= 9) return `${year}-06-30`;
  return `${year}-09-30`;
}

export function formatQuarterLabel(periodDate: string | null | undefined): string {
  const norm = normalizePeriodDate(periodDate);
  if (!norm) return '—';
  const [yStr, mStr] = norm.split('-');
  const month = Number(mStr);
  const quarter = month <= 3 ? 'Q1' : month <= 6 ? 'Q2' : month <= 9 ? 'Q3' : 'Q4';
  return `${quarter} ${yStr} (${norm})`;
}

export function calculateShareChange(currentShares: number, previousShares: number): number {
  return currentShares - previousShares;
}

export function calculatePercentChange(currentShares: number, previousShares: number): number | null {
  if (!Number.isFinite(currentShares) || !Number.isFinite(previousShares)) return null;
  if (previousShares <= 0) return null;
  return ((currentShares - previousShares) / previousShares) * 100;
}

/**
 * Classifies a position change across two equivalent reporting periods while
 * strictly distinguishing missing historical records from confirmed zero-share positions.
 */
export function classifyPositionChange(params: {
  currentShares: number;
  previousShares: number | null;
  hasConfirmedPriorFiling: boolean;
  hasConfirmedCurrentFiling: boolean;
}): InstitutionalPositionStatus {
  const { currentShares, previousShares, hasConfirmedPriorFiling, hasConfirmedCurrentFiling } = params;

  if (currentShares > 0) {
    if (previousShares !== null && previousShares > 0) {
      if (currentShares > previousShares) return 'INCREASED';
      if (currentShares < previousShares) return 'DECREASED';
      return 'UNCHANGED';
    }
    // currentShares > 0 and previousShares is 0 or absent
    if (previousShares === 0 || hasConfirmedPriorFiling) {
      return 'NEW';
    }
    return 'NO_PRIOR_DATA';
  }

  // currentShares === 0
  if (previousShares !== null && previousShares > 0 && hasConfirmedCurrentFiling) {
    return 'EXITED';
  }

  return 'NO_PRIOR_DATA';
}

/**
 * Selects the canonical non-notice 13F filing for each (managerCik, period_of_report).
 * Prefers full holdings reports over notices and picks the latest accepted non-amendment
 * (or latest accepted filing if only amendments exist) to avoid double-counting.
 */
export function selectCanonicalFilings(
  filings: ThreeSpreadFilingSummary[]
): Map<string, ThreeSpreadFilingSummary> {
  const grouped = new Map<string, ThreeSpreadFilingSummary[]>();

  for (const f of filings) {
    const period = normalizePeriodDate(f.period_of_report);
    const managerCik = normalizeCik(f.filing_manager_cik || f.cik);
    if (!period || !managerCik) continue;
    const reportType = (f.report_type || '').toUpperCase();
    const formType = (f.form_type || '').toUpperCase();
    if (reportType.includes('NOTICE') || formType.includes('13F-NT')) continue;

    const key = `${managerCik}::${period}`;
    const list = grouped.get(key) || [];
    list.push(f);
    grouped.set(key, list);
  }

  const canonical = new Map<string, ThreeSpreadFilingSummary>();
  for (const [key, list] of grouped.entries()) {
    // Prefer original 13F-HR filings (complete table); if an amendment explicitly replaces it with higher entry total, pick carefully.
    const originals = list.filter((f) => !f.is_amendment && !(f.form_type || '').includes('/A'));
    const pool = originals.length > 0 ? originals : list;
    pool.sort((a, b) => {
      const entriesDiff = (b.table_entry_total || 0) - (a.table_entry_total || 0);
      if (entriesDiff !== 0) return entriesDiff;
      return String(b.accepted_time || '').localeCompare(String(a.accepted_time || ''));
    });
    canonical.set(key, pool[0]);
  }

  return canonical;
}

/**
 * Aggregates raw 3spread holding rows per (managerCik, cusip, reportingPeriod).
 * Uses `value_usd` (normalized whole USD) and sums `SH` share rows across sub-manager
 * discretion buckets within the same filing so positions are never double-counted or split.
 */
export function aggregateHoldingsByManagerAndSecurity(
  records: ThreeSpreadHoldingRecord[],
  options: { allowedFilingIds?: Set<string>; equitySharesOnly?: boolean } = {}
): Map<string, AggregatedPosition> {
  const { allowedFilingIds, equitySharesOnly = true } = options;
  const map = new Map<string, AggregatedPosition>();

  // Track which filing_id was first accepted for each (managerCik, period) so we don't sum
  // across duplicate/amended filings for the same manager & period if allowedFilingIds wasn't passed.
  const chosenFilingByManagerPeriod = new Map<string, string>();

  for (const row of records) {
    if (allowedFilingIds && !allowedFilingIds.has(row.filing_id)) continue;

    const sharesType = (row.ssh_prnamt_type || 'SH').trim().toUpperCase();
    if (equitySharesOnly && sharesType !== 'SH') continue;

    const period = normalizePeriodDate(row.period_of_report);
    const managerCik = normalizeCik(row.filing_manager_cik);
    const cusip = normalizeCusip(row.cusip);
    if (!period || !managerCik || !cusip) continue;

    const mpKey = `${managerCik}::${period}`;
    const existingFiling = chosenFilingByManagerPeriod.get(mpKey);
    if (!existingFiling) {
      chosenFilingByManagerPeriod.set(mpKey, row.filing_id);
    } else if (existingFiling !== row.filing_id) {
      // Prevent summing rows from two different filings (e.g. original + amendment) for the same manager/quarter
      continue;
    }

    const shares = parseNumericField(row.ssh_prnamt);
    const valueUsd = parseNumericField(row.value_usd);
    if (shares <= 0 && valueUsd <= 0) continue;

    const key = `${managerCik}::${cusip}::${period}`;
    const existing = map.get(key);
    const sole = parseNullableNumericField(row.voting_sole);
    const shared = parseNullableNumericField(row.voting_shared);
    const none = parseNullableNumericField(row.voting_none);

    if (!existing) {
      map.set(key, {
        managerCik,
        managerName: (row.filing_manager_name || `CIK ${managerCik}`).trim(),
        cusip,
        figi: row.figi ? row.figi.trim() : null,
        issuerName: (row.name_of_issuer || cusip).trim(),
        titleOfClass: row.title_of_class ? row.title_of_class.trim() : null,
        shares,
        sharesType,
        valueUsd,
        reportingPeriod: period,
        filingId: row.filing_id,
        investmentDiscretion: row.investment_discretion ? row.investment_discretion.trim() : null,
        votingSole: sole,
        votingShared: shared,
        votingNone: none,
      });
    } else {
      existing.shares += shares;
      existing.valueUsd += valueUsd;
      if (sole !== null) existing.votingSole = (existing.votingSole ?? 0) + sole;
      if (shared !== null) existing.votingShared = (existing.votingShared ?? 0) + shared;
      if (none !== null) existing.votingNone = (existing.votingNone ?? 0) + none;
    }
  }

  return map;
}

export interface BuildHoldingsViewInput {
  currentRecords: ThreeSpreadHoldingRecord[];
  previousRecords: ThreeSpreadHoldingRecord[];
  reportingPeriod: string;
  previousPeriod: string | null;
  ticker: string | null;
  filingMetaById?: Map<string, ThreeSpreadFilingSummary>;
  confirmedPriorFilingManagerCiks?: Set<string>;
  confirmedCurrentFilingManagerCiks?: Set<string>;
}

/**
 * Builds Section A (Institutional Holdings) rows and summary aggregates by comparing
 * a reporting period against the immediately preceding comparable reporting period.
 */
export function buildInstitutionalHoldingsView(input: BuildHoldingsViewInput): {
  rows: InstitutionalHoldingRow[];
  summary: InstitutionalHoldingsSummary;
} {
  const {
    currentRecords,
    previousRecords,
    reportingPeriod,
    previousPeriod,
    ticker,
    filingMetaById = new Map(),
    confirmedPriorFilingManagerCiks = new Set(),
    confirmedCurrentFilingManagerCiks = new Set(),
  } = input;

  const currentMap = aggregateHoldingsByManagerAndSecurity(currentRecords);
  const priorMap = aggregateHoldingsByManagerAndSecurity(previousRecords);

  // Index by (managerCik::cusip) for fast period-over-period matching
  const currentByPair = new Map<string, AggregatedPosition>();
  for (const pos of currentMap.values()) {
    if (pos.reportingPeriod !== reportingPeriod) continue;
    currentByPair.set(`${pos.managerCik}::${pos.cusip}`, pos);
  }

  const priorByPair = new Map<string, AggregatedPosition>();
  for (const pos of priorMap.values()) {
    if (previousPeriod && pos.reportingPeriod !== previousPeriod) continue;
    priorByPair.set(`${pos.managerCik}::${pos.cusip}`, pos);
  }

  const allPairs = new Set<string>([...currentByPair.keys(), ...priorByPair.keys()]);
  const rows: InstitutionalHoldingRow[] = [];

  for (const pairKey of allPairs) {
    const curr = currentByPair.get(pairKey) || null;
    const prev = priorByPair.get(pairKey) || null;

    if (!curr && !prev) continue;

    const managerCik = curr ? curr.managerCik : prev!.managerCik;
    const hasConfirmedPriorFiling = Boolean(prev) || confirmedPriorFilingManagerCiks.has(managerCik);
    const hasConfirmedCurrentFiling = Boolean(curr) || confirmedCurrentFilingManagerCiks.has(managerCik);

    // Do NOT emit a false EXITED position if the manager hasn't confirmed a filing for currentPeriod
    if (!curr && prev && !hasConfirmedCurrentFiling) {
      continue;
    }

    const currentShares = curr ? curr.shares : 0;
    const previousShares = prev ? prev.shares : hasConfirmedPriorFiling ? 0 : null;
    const currentValueUsd = curr ? curr.valueUsd : 0;
    const previousValueUsd = prev ? prev.valueUsd : hasConfirmedPriorFiling ? 0 : null;

    const status = classifyPositionChange({
      currentShares,
      previousShares,
      hasConfirmedPriorFiling,
      hasConfirmedCurrentFiling,
    });

    const shareChange =
      previousShares !== null ? calculateShareChange(currentShares, previousShares) : null;
    const percentChange =
      previousShares !== null && previousShares > 0
        ? calculatePercentChange(currentShares, previousShares)
        : null;

    const filingMeta = curr ? filingMetaById.get(curr.filingId) : prev ? filingMetaById.get(prev.filingId) : undefined;
    const totalPortfolioUsd = filingMeta ? parseNumericField(filingMeta.table_value_total_usd) : 0;
    const portfolioPct =
      curr && totalPortfolioUsd > 0 && currentValueUsd > 0
        ? (currentValueUsd / totalPortfolioUsd) * 100
        : null;

    rows.push({
      id: `${managerCik}-${(curr || prev)!.cusip}-${reportingPeriod}`,
      ticker: ticker ? ticker.toUpperCase() : null,
      issuerName: (curr || prev)!.issuerName,
      cusip: (curr || prev)!.cusip,
      figi: (curr || prev)!.figi,
      titleOfClass: (curr || prev)!.titleOfClass,
      managerCik,
      managerName: (curr || prev)!.managerName,
      shares: currentShares,
      sharesType: (curr || prev)!.sharesType,
      valueUsd: currentValueUsd,
      portfolioPct,
      previousShares,
      previousValueUsd,
      shareChange,
      percentChange,
      status,
      reportingPeriod,
      previousPeriod,
      filingDate: filingMeta?.accepted_time || null,
      filingId: curr?.filingId || null,
      sourceUrl: filingMeta?.source_url || null,
      investmentDiscretion: curr?.investmentDiscretion || null,
      votingSole: curr?.votingSole ?? null,
      votingShared: curr?.votingShared ?? null,
      votingNone: curr?.votingNone ?? null,
    });
  }

  rows.sort((a, b) => b.valueUsd - a.valueUsd || b.shares - a.shares);

  let totalReportedShares = 0;
  let totalReportedValueUsd = 0;
  let activeInstitutions = 0;
  let institutionsIncreasing = 0;
  let institutionsDecreasing = 0;
  let newPositions = 0;
  let exitedPositions = 0;
  let unchangedPositions = 0;
  let noPriorDataCount = 0;
  let netShareChange = 0;
  let comparablePriorShares = 0;

  for (const r of rows) {
    totalReportedShares += r.shares;
    totalReportedValueUsd += r.valueUsd;
    if (r.shares > 0) activeInstitutions += 1;

    if (r.status === 'INCREASED') institutionsIncreasing += 1;
    else if (r.status === 'DECREASED') institutionsDecreasing += 1;
    else if (r.status === 'NEW') newPositions += 1;
    else if (r.status === 'EXITED') exitedPositions += 1;
    else if (r.status === 'UNCHANGED') unchangedPositions += 1;
    else noPriorDataCount += 1;

    if (r.shareChange !== null) {
      netShareChange += r.shareChange;
    }
    if (r.previousShares !== null && r.previousShares > 0) {
      comparablePriorShares += r.previousShares;
    }
  }

  return {
    rows,
    summary: {
      totalReportedShares,
      totalReportedValueUsd,
      activeInstitutions,
      institutionsIncreasing,
      institutionsDecreasing,
      newPositions,
      exitedPositions,
      unchangedPositions,
      noPriorDataCount,
      netShareChange,
      netPercentChange: comparablePriorShares > 0 ? (netShareChange / comparablePriorShares) * 100 : null,
    },
  };
}

export interface ManagerPeriodComparisonPair {
  managerCik: string;
  managerName: string;
  currentFiling: ThreeSpreadFilingSummary;
  previousFiling: ThreeSpreadFilingSummary;
  currentHoldings: ThreeSpreadHoldingRecord[];
  previousHoldings: ThreeSpreadHoldingRecord[];
}

/**
 * Builds Section B (Institutional Accumulation Screener) and Section D (Position Changes Feed)
 * from a cohort of institutional managers with complete filings in BOTH consecutive comparable
 * reporting periods. Because every manager in the cohort has confirmed filings in both periods,
 * NEW and EXITED positions are 100% verified (never inferred from missing filings).
 */
export function buildCohortAccumulationAndChanges(params: {
  managerPairs: ManagerPeriodComparisonPair[];
  reportingPeriod: string;
  previousPeriod: string;
  cusipToTicker?: Map<string, string>;
}): {
  accumulation: InstitutionalAccumulationRow[];
  changes: InstitutionalPositionChangeRow[];
} {
  const { managerPairs, reportingPeriod, previousPeriod, cusipToTicker = new Map() } = params;

  const bySecurity = new Map<
    string,
    {
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
      totalValueUsd: number;
    }
  >();

  const changes: InstitutionalPositionChangeRow[] = [];

  for (const pair of managerPairs) {
    const currAllowed = new Set([pair.currentFiling.filing_id]);
    const prevAllowed = new Set([pair.previousFiling.filing_id]);

    const currAgg = aggregateHoldingsByManagerAndSecurity(pair.currentHoldings, {
      allowedFilingIds: currAllowed,
      equitySharesOnly: true,
    });
    const prevAgg = aggregateHoldingsByManagerAndSecurity(pair.previousHoldings, {
      allowedFilingIds: prevAllowed,
      equitySharesOnly: true,
    });

    const currByCusip = new Map<string, AggregatedPosition>();
    for (const pos of currAgg.values()) {
      currByCusip.set(pos.cusip, pos);
    }

    const prevByCusip = new Map<string, AggregatedPosition>();
    for (const pos of prevAgg.values()) {
      prevByCusip.set(pos.cusip, pos);
    }

    const allCusips = new Set<string>([...currByCusip.keys(), ...prevByCusip.keys()]);

    for (const cusip of allCusips) {
      const curr = currByCusip.get(cusip) || null;
      const prev = prevByCusip.get(cusip) || null;
      const currentShares = curr ? curr.shares : 0;
      const previousShares = prev ? prev.shares : 0;
      const currentValueUsd = curr ? curr.valueUsd : 0;
      const previousValueUsd = prev ? prev.valueUsd : 0;

      const status = classifyPositionChange({
        currentShares,
        previousShares,
        hasConfirmedPriorFiling: true,
        hasConfirmedCurrentFiling: true,
      });

      const shareChange = calculateShareChange(currentShares, previousShares);
      const percentChange = calculatePercentChange(currentShares, previousShares);
      const issuerName = (curr || prev)!.issuerName;
      const titleOfClass = (curr || prev)!.titleOfClass;
      const ticker = cusipToTicker.get(cusip) || null;

      let acc = bySecurity.get(cusip);
      if (!acc) {
        acc = {
          cusip,
          ticker,
          issuerName,
          titleOfClass,
          institutionsIncreasing: 0,
          institutionsDecreasing: 0,
          newPositions: 0,
          exitedPositions: 0,
          unchangedPositions: 0,
          totalInstitutions: 0,
          netShareChange: 0,
          priorTotalShares: 0,
          currentTotalShares: 0,
          totalValueUsd: 0,
        };
        bySecurity.set(cusip, acc);
      }

      if (currentShares > 0) acc.totalInstitutions += 1;
      acc.priorTotalShares += previousShares;
      acc.currentTotalShares += currentShares;
      acc.netShareChange += shareChange;
      acc.totalValueUsd += currentValueUsd;

      if (status === 'INCREASED') acc.institutionsIncreasing += 1;
      else if (status === 'DECREASED') acc.institutionsDecreasing += 1;
      else if (status === 'NEW') acc.newPositions += 1;
      else if (status === 'EXITED') acc.exitedPositions += 1;
      else if (status === 'UNCHANGED') acc.unchangedPositions += 1;

      if (status === 'NEW' || status === 'INCREASED' || status === 'DECREASED' || status === 'EXITED') {
        changes.push({
          id: `${pair.managerCik}-${cusip}-${reportingPeriod}-${status}`,
          category: status,
          ticker,
          issuerName,
          cusip,
          managerCik: pair.managerCik,
          managerName: pair.managerName,
          previousShares,
          currentShares,
          shareChange,
          percentChange,
          currentValueUsd,
          previousValueUsd,
          previousPeriod,
          currentPeriod: reportingPeriod,
          filingDate: pair.currentFiling.accepted_time || null,
          sourceUrl: pair.currentFiling.source_url || null,
        });
      }
    }
  }

  const accumulation: InstitutionalAccumulationRow[] = Array.from(bySecurity.values()).map((item) => {
    const netPercentChange =
      item.priorTotalShares > 0 ? (item.netShareChange / item.priorTotalShares) * 100 : null;
    // Accumulation requires MULTIPLE institutions increasing or initiating positions with positive net share change.
    const positiveInstitutions = item.institutionsIncreasing + item.newPositions;
    const isAccumulating = positiveInstitutions >= 2 && item.netShareChange > 0;

    return {
      ...item,
      netPercentChange,
      reportingPeriod,
      previousPeriod,
      isAccumulating,
    };
  });

  accumulation.sort(
    (a, b) =>
      (b.institutionsIncreasing + b.newPositions) - (a.institutionsIncreasing + a.newPositions) ||
      b.netShareChange - a.netShareChange ||
      b.totalValueUsd - a.totalValueUsd
  );

  changes.sort(
    (a, b) =>
      Math.max(b.currentValueUsd, b.previousValueUsd) - Math.max(a.currentValueUsd, a.previousValueUsd) ||
      Math.abs(b.shareChange) - Math.abs(a.shareChange)
  );

  return { accumulation, changes };
}

/**
 * Builds Section C (Institutional Investor Profile) for a single manager by comparing
 * its current 13F filing against its immediately preceding comparable reporting period filing.
 */
export function buildInvestorProfile(params: {
  currentFiling: ThreeSpreadFilingSummary;
  previousFiling: ThreeSpreadFilingSummary | null;
  currentHoldings: ThreeSpreadHoldingRecord[];
  previousHoldings: ThreeSpreadHoldingRecord[];
  holdingsTruncated?: boolean;
  cusipToTicker?: Map<string, string>;
}): InstitutionalInvestorProfile {
  const {
    currentFiling,
    previousFiling,
    currentHoldings,
    previousHoldings,
    holdingsTruncated = false,
    cusipToTicker = new Map(),
  } = params;

  const reportingPeriod = normalizePeriodDate(currentFiling.period_of_report) || '';
  const previousPeriod = previousFiling ? normalizePeriodDate(previousFiling.period_of_report) : null;
  const managerCik = normalizeCik(currentFiling.filing_manager_cik || currentFiling.cik);
  const managerName = (currentFiling.filing_manager_name || currentFiling.filer_name || `CIK ${managerCik}`).trim();

  const currAgg = aggregateHoldingsByManagerAndSecurity(currentHoldings, {
    allowedFilingIds: new Set([currentFiling.filing_id]),
    equitySharesOnly: true,
  });

  const prevAgg = previousFiling
    ? aggregateHoldingsByManagerAndSecurity(previousHoldings, {
        allowedFilingIds: new Set([previousFiling.filing_id]),
        equitySharesOnly: true,
      })
    : new Map<string, AggregatedPosition>();

  const currByCusip = new Map<string, AggregatedPosition>();
  for (const pos of currAgg.values()) currByCusip.set(pos.cusip, pos);

  const prevByCusip = new Map<string, AggregatedPosition>();
  for (const pos of prevAgg.values()) prevByCusip.set(pos.cusip, pos);

  const computedCurrentTotal = Array.from(currByCusip.values()).reduce((sum, p) => sum + p.valueUsd, 0);
  const filingTotalUsd = parseNumericField(currentFiling.table_value_total_usd);
  const totalValueUsd = filingTotalUsd > 0 ? filingTotalUsd : computedCurrentTotal;

  const filingPriorTotalUsd = previousFiling ? parseNumericField(previousFiling.table_value_total_usd) : 0;
  const computedPriorTotal = Array.from(prevByCusip.values()).reduce((sum, p) => sum + p.valueUsd, 0);
  const priorTotalValueUsd = previousFiling
    ? filingPriorTotalUsd > 0
      ? filingPriorTotalUsd
      : computedPriorTotal
    : null;

  const totalValueChangeUsd = priorTotalValueUsd !== null ? totalValueUsd - priorTotalValueUsd : null;
  const totalValueChangePct =
    priorTotalValueUsd !== null && priorTotalValueUsd > 0
      ? ((totalValueUsd - priorTotalValueUsd) / priorTotalValueUsd) * 100
      : null;

  const hasConfirmedPriorFiling = Boolean(previousFiling);
  const allCusips = new Set<string>([...currByCusip.keys(), ...prevByCusip.keys()]);

  const holdings: InstitutionalHoldingRow[] = [];
  let newCount = 0;
  let increasedCount = 0;
  let decreasedCount = 0;
  let exitedCount = 0;
  let unchangedCount = 0;

  for (const cusip of allCusips) {
    const curr = currByCusip.get(cusip) || null;
    const prev = prevByCusip.get(cusip) || null;
    const currentShares = curr ? curr.shares : 0;
    const previousShares = prev ? prev.shares : hasConfirmedPriorFiling ? 0 : null;
    const currentValueUsd = curr ? curr.valueUsd : 0;
    const previousValueUsd = prev ? prev.valueUsd : hasConfirmedPriorFiling ? 0 : null;

    const status = classifyPositionChange({
      currentShares,
      previousShares,
      hasConfirmedPriorFiling,
      hasConfirmedCurrentFiling: true,
    });

    if (status === 'NEW') newCount += 1;
    else if (status === 'INCREASED') increasedCount += 1;
    else if (status === 'DECREASED') decreasedCount += 1;
    else if (status === 'EXITED') exitedCount += 1;
    else if (status === 'UNCHANGED') unchangedCount += 1;

    const shareChange =
      previousShares !== null ? calculateShareChange(currentShares, previousShares) : null;
    const percentChange =
      previousShares !== null && previousShares > 0
        ? calculatePercentChange(currentShares, previousShares)
        : null;

    const portfolioPct =
      curr && totalValueUsd > 0 && currentValueUsd > 0 ? (currentValueUsd / totalValueUsd) * 100 : null;

    holdings.push({
      id: `${managerCik}-${cusip}-${reportingPeriod}`,
      ticker: cusipToTicker.get(cusip) || null,
      issuerName: (curr || prev)!.issuerName,
      cusip,
      figi: (curr || prev)!.figi,
      titleOfClass: (curr || prev)!.titleOfClass,
      managerCik,
      managerName,
      shares: currentShares,
      sharesType: (curr || prev)!.sharesType,
      valueUsd: currentValueUsd,
      portfolioPct,
      previousShares,
      previousValueUsd,
      shareChange,
      percentChange,
      status,
      reportingPeriod,
      previousPeriod,
      filingDate: currentFiling.accepted_time || null,
      filingId: curr ? currentFiling.filing_id : null,
      sourceUrl: currentFiling.source_url || null,
      investmentDiscretion: curr?.investmentDiscretion || null,
      votingSole: curr?.votingSole ?? null,
      votingShared: curr?.votingShared ?? null,
      votingNone: curr?.votingNone ?? null,
    });
  }

  holdings.sort(
    (a, b) =>
      b.valueUsd - a.valueUsd ||
      (b.previousValueUsd ?? 0) - (a.previousValueUsd ?? 0) ||
      b.shares - a.shares
  );

  const locationParts = [
    currentFiling.filing_manager_city?.trim(),
    currentFiling.filing_manager_state_or_country?.trim(),
  ].filter(Boolean);

  return {
    managerCik,
    managerName,
    location: locationParts.length > 0 ? locationParts.join(', ') : null,
    reportingPeriod,
    previousPeriod,
    filingDate: currentFiling.accepted_time || null,
    priorFilingDate: previousFiling?.accepted_time || null,
    filingId: currentFiling.filing_id,
    priorFilingId: previousFiling?.filing_id || null,
    sourceUrl: currentFiling.source_url || null,
    isConfidentialOmitted: Boolean(currentFiling.is_confidential_omitted),
    totalValueUsd,
    priorTotalValueUsd,
    totalValueChangeUsd,
    totalValueChangePct,
    positionsCount: currentFiling.table_entry_total ?? currByCusip.size,
    priorPositionsCount: previousFiling ? previousFiling.table_entry_total ?? prevByCusip.size : null,
    newCount,
    increasedCount,
    decreasedCount,
    exitedCount,
    unchangedCount,
    largestHoldings: holdings.filter((h) => h.shares > 0).slice(0, 10),
    holdings,
    holdingsTruncated,
  };
}

export function formatCompactUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

export function formatCompactShares(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
}

export function formatSignedPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatIsoDateShort(raw: string | null | undefined): string {
  if (!raw) return '—';
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : raw;
}

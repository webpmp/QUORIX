import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import InstitutionalActivityScreen, {
  formatHoldingsLimitationsNotice,
} from '../src/components/InstitutionalActivityScreen';
import {
  aggregateHoldingsByManagerAndSecurity,
  buildCohortAccumulationAndChanges,
  buildInstitutionalHoldingsView,
  buildInvestorProfile,
  calculatePercentChange,
  calculateShareChange,
  classifyPositionChange,
  getPreviousQuarterEnd,
  selectCanonicalFilings,
  type ThreeSpreadFilingSummary,
  type ThreeSpreadHoldingRecord,
} from '../src/utils/institutionalActivity';
import {
  sanitizeCikInput,
  sanitizeCusipInput,
  sanitizePeriodInput,
  sanitizeTickerInput,
} from '../src/server/threeSpreadService';

function makeHolding(overrides: Partial<ThreeSpreadHoldingRecord>): ThreeSpreadHoldingRecord {
  return {
    filing_id: 'f-curr-1',
    record_index: 0,
    period_of_report: '2025-12-31',
    filing_manager_cik: '1067983',
    filing_manager_name: 'BERKSHIRE HATHAWAY INC',
    name_of_issuer: 'APPLE INC',
    title_of_class: 'COM',
    cusip: '037833100',
    figi: 'BBG000B9XRY4',
    value: '10000000',
    value_usd: '10000000',
    value_multiple: 1,
    ssh_prnamt: '50000',
    ssh_prnamt_type: 'SH',
    investment_discretion: 'SOLE',
    voting_sole: '50000',
    voting_shared: '0',
    voting_none: '0',
    ...overrides,
  };
}

function makeFiling(overrides: Partial<ThreeSpreadFilingSummary>): ThreeSpreadFilingSummary {
  return {
    filing_id: 'f-curr-1',
    cik: '1067983',
    form_type: '13F-HR',
    period_of_report: '2025-12-31',
    accepted_time: '2026-02-14T16:30:00Z',
    is_amendment: false,
    filing_manager_cik: '1067983',
    filing_manager_name: 'BERKSHIRE HATHAWAY INC',
    report_type: '13F HOLDINGS REPORT',
    table_entry_total: 40,
    table_value_total_usd: '100000000',
    source_url: 'https://www.sec.gov/Archives/edgar/data/1067983/example-index.htm',
    ...overrides,
  };
}

test('share change and percentage change calculations follow exact definitions', () => {
  assert.equal(calculateShareChange(150, 100), 50);
  assert.equal(calculateShareChange(80, 100), -20);
  assert.equal(calculateShareChange(0, 100), -100);
  assert.equal(calculatePercentChange(150, 100), 50);
  assert.equal(calculatePercentChange(80, 100), -20);
  assert.equal(calculatePercentChange(0, 100), -100);
  assert.equal(calculatePercentChange(100, 0), null);
});

test('getPreviousQuarterEnd maps calendar quarter ends strictly to prior quarter end', () => {
  assert.equal(getPreviousQuarterEnd('2026-03-31'), '2025-12-31');
  assert.equal(getPreviousQuarterEnd('2025-12-31'), '2025-09-30');
  assert.equal(getPreviousQuarterEnd('2025-09-30'), '2025-06-30');
  assert.equal(getPreviousQuarterEnd('2025-06-30'), '2025-03-31');
});

test('classifyPositionChange distinguishes missing prior records from confirmed NEW and EXITED positions', () => {
  assert.equal(
    classifyPositionChange({
      currentShares: 1000,
      previousShares: 0,
      hasConfirmedPriorFiling: true,
      hasConfirmedCurrentFiling: true,
    }),
    'NEW'
  );
  assert.equal(
    classifyPositionChange({
      currentShares: 1000,
      previousShares: null,
      hasConfirmedPriorFiling: false,
      hasConfirmedCurrentFiling: true,
    }),
    'NO_PRIOR_DATA'
  );
  assert.equal(
    classifyPositionChange({
      currentShares: 0,
      previousShares: 1000,
      hasConfirmedPriorFiling: true,
      hasConfirmedCurrentFiling: true,
    }),
    'EXITED'
  );
  assert.equal(
    classifyPositionChange({
      currentShares: 0,
      previousShares: 1000,
      hasConfirmedPriorFiling: true,
      hasConfirmedCurrentFiling: false,
    }),
    'NO_PRIOR_DATA'
  );
  assert.equal(
    classifyPositionChange({
      currentShares: 1250,
      previousShares: 1000,
      hasConfirmedPriorFiling: true,
      hasConfirmedCurrentFiling: true,
    }),
    'INCREASED'
  );
  assert.equal(
    classifyPositionChange({
      currentShares: 750,
      previousShares: 1000,
      hasConfirmedPriorFiling: true,
      hasConfirmedCurrentFiling: true,
    }),
    'DECREASED'
  );
});

test('aggregateHoldingsByManagerAndSecurity sums split discretion buckets and ignores PRN debt & duplicate filings', () => {
  const rows: ThreeSpreadHoldingRecord[] = [
    makeHolding({ filing_id: 'f1', record_index: 0, ssh_prnamt: '10000', value_usd: '2000000' }),
    makeHolding({ filing_id: 'f1', record_index: 1, ssh_prnamt: '5000', value_usd: '1000000', investment_discretion: 'DFND' }),
    // Debt principal line should not be mixed into equity share counts
    makeHolding({ filing_id: 'f1', record_index: 2, ssh_prnamt: '999999', ssh_prnamt_type: 'PRN', value_usd: '999999' }),
    // Second filing for same manager & quarter (e.g. amendment) should not be double-counted
    makeHolding({ filing_id: 'f1-amend', record_index: 0, ssh_prnamt: '15000', value_usd: '3000000' }),
  ];

  const agg = aggregateHoldingsByManagerAndSecurity(rows);
  assert.equal(agg.size, 1);
  const pos = agg.get('1067983::037833100::2025-12-31');
  assert.ok(pos);
  assert.equal(pos.shares, 15000);
  assert.equal(pos.valueUsd, 3000000);
});

test('buildInstitutionalHoldingsView computes accurate deltas, portfolio %, and never fabricates exits for unfiled managers', () => {
  const filingCurrM1 = makeFiling({
    filing_id: 'm1-q4',
    cik: '100',
    filing_manager_cik: '100',
    filing_manager_name: 'ALPHA CAPITAL',
    table_value_total_usd: '200000000',
  });
  const filingCurrM2 = makeFiling({
    filing_id: 'm2-q4',
    cik: '200',
    filing_manager_cik: '200',
    filing_manager_name: 'BETA PARTNERS',
    table_value_total_usd: '100000000',
  });
  const filingCurrM3 = makeFiling({
    filing_id: 'm3-q4',
    cik: '300',
    filing_manager_cik: '300',
    filing_manager_name: 'GAMMA FUND',
    table_value_total_usd: '50000000',
  });

  const filingMetaById = new Map<string, ThreeSpreadFilingSummary>([
    [filingCurrM1.filing_id, filingCurrM1],
    [filingCurrM2.filing_id, filingCurrM2],
    [filingCurrM3.filing_id, filingCurrM3],
  ]);

  const currentRecords = [
    // M1 increased from 100k to 150k (+50%)
    makeHolding({
      filing_id: 'm1-q4',
      filing_manager_cik: '100',
      filing_manager_name: 'ALPHA CAPITAL',
      ssh_prnamt: '150000',
      value_usd: '30000000',
    }),
    // M2 new position (confirmed filed in Q3 without AAPL)
    makeHolding({
      filing_id: 'm2-q4',
      filing_manager_cik: '200',
      filing_manager_name: 'BETA PARTNERS',
      ssh_prnamt: '40000',
      value_usd: '8000000',
    }),
    // M5 held in Q4, but NO confirmed prior Q3 filing -> NO_PRIOR_DATA
    makeHolding({
      filing_id: 'm5-q4',
      filing_manager_cik: '500',
      filing_manager_name: 'NEW FILER LP',
      ssh_prnamt: '10000',
      value_usd: '2000000',
    }),
  ];

  const previousRecords = [
    makeHolding({
      filing_id: 'm1-q3',
      period_of_report: '2025-09-30',
      filing_manager_cik: '100',
      filing_manager_name: 'ALPHA CAPITAL',
      ssh_prnamt: '100000',
      value_usd: '20000000',
    }),
    // M3 held in Q3 and confirmed filed in Q4 without AAPL -> EXITED
    makeHolding({
      filing_id: 'm3-q3',
      period_of_report: '2025-09-30',
      filing_manager_cik: '300',
      filing_manager_name: 'GAMMA FUND',
      ssh_prnamt: '25000',
      value_usd: '5000000',
    }),
    // M4 held in Q3, has NOT filed Q4 yet -> must NOT be falsely flagged EXITED
    makeHolding({
      filing_id: 'm4-q3',
      period_of_report: '2025-09-30',
      filing_manager_cik: '400',
      filing_manager_name: 'LATE FILER LLC',
      ssh_prnamt: '60000',
      value_usd: '12000000',
    }),
  ];

  const { rows, summary } = buildInstitutionalHoldingsView({
    currentRecords,
    previousRecords,
    reportingPeriod: '2025-12-31',
    previousPeriod: '2025-09-30',
    ticker: 'AAPL',
    filingMetaById,
    confirmedPriorFilingManagerCiks: new Set(['100', '200', '300', '400']),
    confirmedCurrentFilingManagerCiks: new Set(['100', '200', '300', '500']),
  });

  const byCik = new Map(rows.map((r) => [r.managerCik, r]));
  assert.equal(byCik.get('100')?.status, 'INCREASED');
  assert.equal(byCik.get('100')?.shareChange, 50000);
  assert.equal(byCik.get('100')?.percentChange, 50);
  assert.equal(byCik.get('100')?.portfolioPct, 15);

  assert.equal(byCik.get('200')?.status, 'NEW');
  assert.equal(byCik.get('200')?.shareChange, 40000);
  assert.equal(byCik.get('200')?.percentChange, null);

  assert.equal(byCik.get('300')?.status, 'EXITED');
  assert.equal(byCik.get('300')?.shareChange, -25000);
  assert.equal(byCik.get('300')?.percentChange, -100);

  assert.equal(byCik.has('400'), false);
  assert.equal(byCik.get('500')?.status, 'NO_PRIOR_DATA');
  assert.equal(byCik.get('500')?.shareChange, null);

  // Net share change = +50,000 + 40,000 - 25,000 = +65,000
  assert.equal(summary.netShareChange, 65000);
  assert.equal(summary.institutionsIncreasing, 1);
  assert.equal(summary.newPositions, 1);
  assert.equal(summary.exitedPositions, 1);
  assert.equal(summary.noPriorDataCount, 1);
});

test('buildCohortAccumulationAndChanges requires multiple institutions for accumulation and categorizes changes accurately', () => {
  const f1Curr = makeFiling({ filing_id: 'f1-q4', cik: '1', filing_manager_cik: '1', filing_manager_name: 'FUND ONE' });
  const f1Prev = makeFiling({ filing_id: 'f1-q3', cik: '1', filing_manager_cik: '1', filing_manager_name: 'FUND ONE', period_of_report: '2025-09-30' });
  const f2Curr = makeFiling({ filing_id: 'f2-q4', cik: '2', filing_manager_cik: '2', filing_manager_name: 'FUND TWO' });
  const f2Prev = makeFiling({ filing_id: 'f2-q3', cik: '2', filing_manager_cik: '2', filing_manager_name: 'FUND TWO', period_of_report: '2025-09-30' });

  const { accumulation, changes } = buildCohortAccumulationAndChanges({
    reportingPeriod: '2025-12-31',
    previousPeriod: '2025-09-30',
    managerPairs: [
      {
        managerCik: '1',
        managerName: 'FUND ONE',
        currentFiling: f1Curr,
        previousFiling: f1Prev,
        currentHoldings: [
          // NVDA increased by Fund One
          makeHolding({ filing_id: 'f1-q4', filing_manager_cik: '1', filing_manager_name: 'FUND ONE', cusip: '67066G104', name_of_issuer: 'NVIDIA CORP', ssh_prnamt: '2000', value_usd: '250000' }),
          // SOLO stock bought by only Fund One (single institution must NOT flag accumulation)
          makeHolding({ filing_id: 'f1-q4', filing_manager_cik: '1', filing_manager_name: 'FUND ONE', cusip: '999999100', name_of_issuer: 'SOLO CORP', ssh_prnamt: '5000', value_usd: '500000' }),
        ],
        previousHoldings: [
          makeHolding({ filing_id: 'f1-q3', period_of_report: '2025-09-30', filing_manager_cik: '1', filing_manager_name: 'FUND ONE', cusip: '67066G104', name_of_issuer: 'NVIDIA CORP', ssh_prnamt: '1000', value_usd: '120000' }),
        ],
      },
      {
        managerCik: '2',
        managerName: 'FUND TWO',
        currentFiling: f2Curr,
        previousFiling: f2Prev,
        currentHoldings: [
          // NVDA newly initiated by Fund Two -> 2 managers accumulating NVDA!
          makeHolding({ filing_id: 'f2-q4', filing_manager_cik: '2', filing_manager_name: 'FUND TWO', cusip: '67066G104', name_of_issuer: 'NVIDIA CORP', ssh_prnamt: '1500', value_usd: '187500' }),
        ],
        previousHoldings: [
          // Fund Two exited MSFT
          makeHolding({ filing_id: 'f2-q3', period_of_report: '2025-09-30', filing_manager_cik: '2', filing_manager_name: 'FUND TWO', cusip: '594918104', name_of_issuer: 'MICROSOFT CORP', ssh_prnamt: '800', value_usd: '320000' }),
        ],
      },
    ],
  });

  const nvda = accumulation.find((r) => r.cusip === '67066G104');
  const solo = accumulation.find((r) => r.cusip === '999999100');
  assert.ok(nvda);
  assert.equal(nvda.institutionsIncreasing, 1);
  assert.equal(nvda.newPositions, 1);
  assert.equal(nvda.netShareChange, 2500);
  assert.equal(nvda.isAccumulating, true);

  assert.ok(solo);
  assert.equal(solo.newPositions, 1);
  assert.equal(solo.isAccumulating, false);

  assert.equal(changes.filter((c) => c.category === 'NEW').length, 2);
  assert.equal(changes.filter((c) => c.category === 'INCREASED').length, 1);
  assert.equal(changes.filter((c) => c.category === 'EXITED').length, 1);
});

test('buildInvestorProfile summarizes portfolio value changes and categorizes all manager positions', () => {
  const currFiling = makeFiling({
    filing_id: 'curr-1',
    period_of_report: '2025-12-31',
    table_value_total_usd: '120000000',
    table_entry_total: 2,
    filing_manager_city: 'OMAHA',
    filing_manager_state_or_country: 'NE',
  });
  const prevFiling = makeFiling({
    filing_id: 'prev-1',
    period_of_report: '2025-09-30',
    table_value_total_usd: '100000000',
    table_entry_total: 2,
  });

  const profile = buildInvestorProfile({
    currentFiling: currFiling,
    previousFiling: prevFiling,
    currentHoldings: [
      makeHolding({ filing_id: 'curr-1', cusip: '037833100', name_of_issuer: 'APPLE INC', ssh_prnamt: '60000', value_usd: '90000000' }),
      makeHolding({ filing_id: 'curr-1', cusip: '67066G104', name_of_issuer: 'NVIDIA CORP', ssh_prnamt: '20000', value_usd: '30000000' }),
    ],
    previousHoldings: [
      makeHolding({ filing_id: 'prev-1', period_of_report: '2025-09-30', cusip: '037833100', name_of_issuer: 'APPLE INC', ssh_prnamt: '50000', value_usd: '75000000' }),
      makeHolding({ filing_id: 'prev-1', period_of_report: '2025-09-30', cusip: '594918104', name_of_issuer: 'MICROSOFT CORP', ssh_prnamt: '10000', value_usd: '25000000' }),
    ],
  });

  assert.equal(profile.location, 'OMAHA, NE');
  assert.equal(profile.totalValueChangeUsd, 20000000);
  assert.equal(profile.totalValueChangePct, 20);
  assert.equal(profile.increasedCount, 1);
  assert.equal(profile.newCount, 1);
  assert.equal(profile.exitedCount, 1);
  assert.equal(profile.largestHoldings[0].cusip, '037833100');
  assert.equal(profile.largestHoldings[0].portfolioPct, 75);
});

test('selectCanonicalFilings excludes 13F-NT notices and prefers complete 13F-HR originals', () => {
  const canonical = selectCanonicalFilings([
    makeFiling({ filing_id: 'notice', form_type: '13F-NT', report_type: '13F NOTICE', table_entry_total: 0 }),
    makeFiling({ filing_id: 'orig', form_type: '13F-HR', report_type: '13F HOLDINGS REPORT', is_amendment: false, table_entry_total: 42 }),
    makeFiling({ filing_id: 'amend', form_type: '13F-HR/A', report_type: '13F HOLDINGS REPORT', is_amendment: true, table_entry_total: 3 }),
  ]);

  assert.equal(canonical.size, 1);
  assert.equal(canonical.get('1067983::2025-12-31')?.filing_id, 'orig');
});

test('threeSpreadService input sanitizers reject malformed identifiers', () => {
  assert.equal(sanitizeTickerInput(' aapl '), 'AAPL');
  assert.equal(sanitizeTickerInput('BRK.B'), 'BRK.B');
  assert.equal(sanitizeTickerInput('../../etc/passwd'), '');
  assert.equal(sanitizeCusipInput('037833100'), '037833100');
  assert.equal(sanitizeCusipInput('bad'), '');
  assert.equal(sanitizeCikInput('0001067983'), '1067983');
  assert.equal(sanitizeCikInput('abc'), '');
  assert.equal(sanitizePeriodInput('2025-12-31'), '2025-12-31');
  assert.equal(sanitizePeriodInput('not-a-date'), '');
});

test('InstitutionalActivityScreen places DELAYED 13F DISCLOSURE next to PROVIDER: 3SPREAD and hides disclosure copy until tooltip opens', () => {
  const html = renderToStaticMarkup(
    React.createElement(InstitutionalActivityScreen, {
      selectedTicker: 'AAPL',
      stocks: {},
    })
  );

  assert.match(html, /INST - INSTITUTIONAL ACTIVITY MONITOR/);
  assert.match(html, /PROVIDER: 3SPREAD/);
  assert.match(
    html,
    /PROVIDER: 3SPREAD<\/span><span[^>]*>\|<\/span><button[^>]*type="button"[^>]*aria-expanded="false"[^>]*>.*?DELAYED 13F DISCLOSURE<\/span><\/button>/
  );
  // Explanatory disclosure copy must not be permanently visible in the workspace
  assert.doesNotMatch(
    html,
    /Institutional holdings reflect quarterly SEC Form 13F filings via 3spread/
  );
  // Metadata/Refresh row remains preserved separately
  assert.match(html, /REFRESH<\/span><\/button>/);
});

test('formatHoldingsLimitationsNotice simplifies top-500 notice and removes prior-period explanatory text', () => {
  const simplified = formatHoldingsLimitationsNotice([
    'Showing top 500 reported institutional positions by USD value for this period (3spread single-page holdings cap).',
    '57 holder(s) had no confirmed prior-period filing in the current filing index and are marked NO PRIOR DATA instead of NEW.',
  ]);
  assert.equal(
    simplified,
    'Showing top 500 reported institutional positions by USD value for this period.'
  );
  assert.equal(
    formatHoldingsLimitationsNotice([
      '12 holder(s) had no confirmed prior-period filing in the current filing index and are marked NO PRIOR DATA instead of NEW.',
    ]),
    ''
  );
});



import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  matchLegislator,
  queryCongressTrades,
  getCongressTradingStatus,
  normalizeName,
  runIngestionBackfill,
} from '../src/server/congressionalTradingService';
import { XMLParser } from 'fast-xml-parser';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CongressionalTradingPanel from '../src/components/CongressionalTradingPanel';

// 1. Legislator matching tests
test('matchLegislator matches House members accurately by state, district, and last name', () => {
  // Alford (MO04)
  const leg1 = matchLegislator('MO04', 'Alford');
  assert.equal(leg1.party, 'Republican');
  assert.equal(leg1.district, 4);
  assert.ok(leg1.fullName?.includes('Alford'));
  assert.ok(leg1.bioguideId);

  // Wasserman Schultz (FL25)
  const leg2 = matchLegislator('FL25', 'Wasserman Schultz');
  assert.equal(leg2.party, 'Democrat');
  assert.equal(leg2.district, 25);
  assert.ok(leg2.fullName?.includes('Debbie Wasserman Schultz'));

  // Unknown state/district falls back safely without guessing
  const legUnknown = matchLegislator('ZZ99', 'NonexistentPerson');
  assert.equal(legUnknown.party, 'Unknown');
  assert.equal(legUnknown.bioguideId, undefined);
});

// 2. XML Index Parsing and "P" filter tests
test('XML Index parser isolates FilingType P and skips A filings', () => {
  const xmlSample = `<?xml version="1.0" encoding="utf-8"?>
  <FinancialDisclosure>
    <Member>
      <DocID>20033779</DocID>
      <FilingDate>8/13/2026</FilingDate>
      <FilingType>P</FilingType>
      <Prefix>Hon.</Prefix>
      <First>Carol Devine</First>
      <Last>Miller</Last>
      <StateDst>WV01</StateDst>
      <Year>2026</Year>
    </Member>
    <Member>
      <DocID>10081499</DocID>
      <FilingDate>8/7/2026</FilingDate>
      <FilingType>A</FilingType>
      <Prefix>Hon.</Prefix>
      <First>Alexandria</First>
      <Last>Ocasio-Cortez</Last>
      <StateDst>NY14</StateDst>
      <Year>2025</Year>
    </Member>
    <Member>
      <DocID>10078016</DocID>
      <FilingDate>5/13/2026</FilingDate>
      <FilingType>C</FilingType>
      <Last>Abel</Last>
      <First>William P.</First>
      <StateDst>TX31</StateDst>
      <Year>2026</Year>
    </Member>
  </FinancialDisclosure>`;

  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xmlSample);
  const members = parsed.FinancialDisclosure.Member;

  const ptrs = members.filter((m: any) => m.FilingType === 'P');
  const amendments = members.filter((m: any) => m.FilingType === 'A');

  assert.equal(ptrs.length, 1);
  assert.equal(ptrs[0].DocID, 20033779);
  assert.equal(amendments.length, 1);
  assert.equal(amendments[0].DocID, 10081499);
});

// 3. Fixture data validation
test('JSON fixtures accurately reflect sample files and coordinate structures', () => {
  const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/congress_sample_fixtures.json');
  assert.ok(fs.existsSync(fixturePath), 'congress_sample_fixtures.json must exist');

  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const filenames = Object.keys(fixtures);

  assert.equal(filenames.length, 12);
  assert.ok(fixtures['2026_20033779.pdf']); // Carol Miller
  assert.ok(fixtures['2026_20033815.pdf']); // Scott Peters
  assert.ok(fixtures['2026_20033751.pdf']); // Richard Allen
  assert.ok(fixtures['2026_20034044.pdf']); // Rob Bresnahan
  assert.ok(fixtures['2026_20034999.pdf']); // Debbie Wasserman Schultz
  assert.ok(fixtures['2026_9115809.pdf']);  // Scanned filing
  assert.ok(fixtures['2025_10081499.pdf']); // AOC Amendment
  assert.ok(fixtures['2026_20033744.pdf']); // Dingell
  assert.ok(fixtures['2026_20033856.pdf']); // Moore
  assert.ok(fixtures['2026_20033814.pdf']); // Larsen
  assert.ok(fixtures['2026_20033725.pdf']); // Pelosi
  assert.ok(fixtures['2026_20034224.pdf']); // Torres

  // Check scanned fixture has fewer than 15 items
  const scannedItemsCount = fixtures['2026_9115809.pdf'].pages.reduce(
    (acc: number, p: any) => acc + p.items.length,
    0
  );
  assert.ok(scannedItemsCount < 15, 'Scanned fixture must have fewer than 15 text items');

  // Check digital fixture has abundant items
  const digitalItemsCount = fixtures['2026_20033779.pdf'].pages.reduce(
    (acc: number, p: any) => acc + p.items.length,
    0
  );
  assert.ok(digitalItemsCount > 50, 'Digital fixture must have > 50 text items');
});

// 4. API Query, Filtering, and Pagination tests
test('queryCongressTrades supports party, type, owner, assetGroup, and ticker filtering with max page size 100', () => {
  const allRes = queryCongressTrades({ pageSize: 100 });
  assert.ok(allRes.success);
  assert.ok(allRes.trades.length > 0);
  assert.ok(allRes.totalTrades > 0);

  // Filter by party
  const demRes = queryCongressTrades({ party: 'Democrat', pageSize: 10 });
  assert.ok(demRes.trades.every((t) => t.party === 'Democrat'));

  const repRes = queryCongressTrades({ party: 'Republican', pageSize: 10 });
  assert.ok(repRes.trades.every((t) => t.party === 'Republican'));

  // Filter by assetGroup: EQUITIES vs FIXED_INCOME_OTHER
  const eqRes = queryCongressTrades({ assetGroup: 'EQUITIES', pageSize: 20 });
  assert.ok(eqRes.trades.every((t) => t.assetGroup === 'EQUITIES' && Boolean(t.ticker)));

  const fixedRes = queryCongressTrades({ assetGroup: 'FIXED_INCOME_OTHER', pageSize: 20 });
  assert.ok(fixedRes.trades.every((t) => t.assetGroup === 'FIXED_INCOME_OTHER' && t.ticker === null));

  // Pagination bounds check
  const cappedRes = queryCongressTrades({ pageSize: 500 });
  assert.equal(cappedRes.pageSize, 100, 'Page size must be capped at 100');
});

// 5. Status endpoint test
test('getCongressTradingStatus returns valid ingestion progress and counts', () => {
  const status = getCongressTradingStatus();
  assert.ok(status.success);
  assert.equal(typeof status.isBackfilling, 'boolean');
  assert.equal(typeof status.totalParsedFilings, 'number');
  assert.equal(typeof status.totalScannedFilings, 'number');
  assert.equal(typeof status.totalTransactions, 'number');
  assert.ok(status.totalParsedFilings >= 400);
  assert.ok(status.totalScannedFilings >= 50);
});

// 6. Strict Guardrail Test: amountMin/amountMax must NEVER be displayed as exact amounts
test('amountMin and amountMax are numeric sort keys and never displayed in place of amountRange', () => {
  const res = queryCongressTrades({ pageSize: 50 });
  for (const t of res.trades) {
    assert.equal(typeof t.amountMin, 'number');
    assert.equal(typeof t.amountMax, 'number');
    assert.equal(typeof t.amountRange, 'string');
    assert.ok(t.amountRange.length > 0);

    // Ensure amountRange contains standard statutory ranges or exact formatting with "$"
    assert.ok(t.amountRange.startsWith('$') || t.amountRange === 'Undetermined');
  }

  // Verify UI source code does NOT display amountMin or amountMax anywhere in JSX
  const panelCode = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/CongressionalTradingPanel.tsx'),
    'utf-8'
  );
  assert.ok(!panelCode.includes('{t.amountMin}'), 'Must not display amountMin in JSX');
  assert.ok(!panelCode.includes('{t.amountMax}'), 'Must not display amountMax in JSX');
  assert.ok(panelCode.includes('{t.amountRange}'), 'Must display amountRange in JSX');
});

// 8. Regression tests for specific filings: Pelosi, Torres, Dingell, Moore, Larsen
test('Pelosi (20033725) asset name terminates at [XX] and preserves full description sentence', () => {
  const res = queryCongressTrades({ politician: 'Pelosi', pageSize: 100 });
  const pelosiTrades = res.trades.filter((t) => t.docId === '20033725');
  assert.ok(pelosiTrades.length > 0, 'Must have Pelosi trades');

  const vsnt = pelosiTrades.find((t) => t.ticker === 'VSNT');
  assert.ok(vsnt, 'Must find VSNT trade');
  assert.equal(vsnt.rawAssetDescription, 'Versant Media Group, Inc. - Class A Common Stock (VSNT) [ST]');
  assert.equal(
    vsnt.description,
    '776 shares and cash in lieu received as a result of spinoff from Comcast Corporation. No shares of Comcast were surrendered as a result of the spinoff.'
  );
  assert.equal(vsnt.amountRange, '$15.00');
  assert.equal(vsnt.isExactAmount, true);
});

test('Torres (20034224) full comment paragraph is preserved and trade preserves original dates', () => {
  const res = queryCongressTrades({ politician: 'Torres', pageSize: 100 });
  const torres = res.trades.find((t) => t.docId === '20034224');
  assert.ok(torres, 'Must find Torres trade');
  assert.equal(torres.rawAssetDescription, 'McKesson Corporation Common Stock (MCK) [ST]');
  assert.equal(torres.transactionDate, '2025-01-07');
  assert.equal(torres.disclosureDate, '2025-08-01');
  assert.ok(
    torres.comment?.includes(
      'This investment is held within a publicly available, widely held independently managed portfolio'
    )
  );
  assert.ok(torres.comment?.includes('without my input or direction.'));
});

test('Zero signature-line bleed in Dingell (20033744), Moore (20033856), Larsen (20033814), and across all trades', () => {
  const dingellRes = queryCongressTrades({ politician: 'Dingell', pageSize: 100 });
  const mooreRes = queryCongressTrades({ politician: 'Moore', pageSize: 100 });
  const larsenRes = queryCongressTrades({ politician: 'Larsen', pageSize: 100 });
  const targetTrades = [...dingellRes.trades, ...mooreRes.trades, ...larsenRes.trades];
  assert.ok(targetTrades.length > 0, 'Must have target trades');

  for (const t of targetTrades) {
    const combined = `${t.rawAssetDescription || ''} ${t.description || ''} ${t.comment || ''}`;
    assert.ok(!combined.includes('Hon.'), `Trade ${t.id} must not contain Hon. signature pattern`);
    assert.ok(!combined.includes('Digitally Signed'), `Trade ${t.id} must not contain Digitally Signed`);
    assert.ok(!combined.includes('I CERTIFY'), `Trade ${t.id} must not contain I CERTIFY`);
  }
});

test('Moore (20033856) includes 2025-12-31 purchase visible and correctly date sorted', () => {
  const res = queryCongressTrades({ politician: 'Moore', pageSize: 100 });
  const mooreDec = res.trades.find(
    (t) => t.docId === '20033856' && t.transactionDate === '2025-12-31'
  );
  assert.ok(mooreDec, 'Must find Moore 2025-12-31 trade');
  assert.equal(mooreDec.txType, 'BUY');
  assert.equal(mooreDec.ticker, 'HY');
});

test('Sorting across year boundary correctly compares ISO YYYY-MM-DD dates in both directions', () => {
  const descRes = queryCongressTrades({ sortBy: 'transactionDate', sortDir: 'desc', pageSize: 100 });
  for (let i = 0; i < descRes.trades.length - 1; i++) {
    const cur = descRes.trades[i].transactionDate;
    const next = descRes.trades[i + 1].transactionDate;
    assert.ok(cur >= next, `Expected ${cur} >= ${next} in desc sort`);
  }

  const ascRes = queryCongressTrades({ sortBy: 'transactionDate', sortDir: 'asc', pageSize: 100 });
  for (let i = 0; i < ascRes.trades.length - 1; i++) {
    const cur = ascRes.trades[i].transactionDate;
    const next = ascRes.trades[i + 1].transactionDate;
    assert.ok(cur <= next, `Expected ${cur} <= ${next} in asc sort`);
  }
});

// 9. Item A & B: Date Anomaly and Default Sort Tests
test('Date anomaly flags future trade dates, future notification dates, and reversed dates without hiding them', () => {
  // Hageman PSA row with 2029 date
  const hagemanAnomaly = queryCongressTrades({ politician: 'Hageman', ticker: 'PSA', pageSize: 50 }).trades.find(
    (t) => t.docId === '20035776'
  );
  assert.ok(hagemanAnomaly, 'Must find Hageman PSA trade');
  assert.equal(hagemanAnomaly.dateAnomaly, true);
  assert.equal(hagemanAnomaly.disclosureDate, '2029-04-29');
  assert.equal(hagemanAnomaly.transactionDate, '2026-04-29');

  // Steve Cohen 2026-12 trade date
  const cohenAnomaly = queryCongressTrades({ politician: 'Cohen', pageSize: 100 }).trades.find(
    (t) => t.docId === '20033889'
  );
  assert.ok(cohenAnomaly, 'Must find Cohen trade');
  assert.equal(cohenAnomaly.dateAnomaly, true);
  assert.equal(cohenAnomaly.transactionDate, '2026-12-26');

  // Default query sorting is by filingDate descending
  const defaultRes = queryCongressTrades({ pageSize: 50 });
  for (let i = 0; i < defaultRes.trades.length - 1; i++) {
    const cur = defaultRes.trades[i].filingDate;
    const next = defaultRes.trades[i + 1].filingDate;
    assert.ok(cur >= next, `Expected filing date ${cur} >= ${next} in default sort`);
  }
});

// 10. Item C: Legislator matching normalization tests
test('matchLegislator handles multi-word last names, suffixes, and hyphenated names', () => {
  // Debbie Wasserman Schultz (multi-word last name)
  const leg1 = matchLegislator('FL25', 'Debbie Wasserman Schultz');
  assert.equal(leg1.party, 'Democrat');
  assert.equal(leg1.district, 25);
  assert.ok(leg1.fullName?.includes('Wasserman Schultz'));

  // Gilbert Ray Cisneros, Jr. (suffix and middle names)
  const leg2 = matchLegislator('CA31', 'Gilbert Ray Cisneros, Jr.');
  assert.equal(leg2.party, 'Democrat');
  assert.equal(leg2.district, 31);
  assert.ok(leg2.fullName?.includes('Cisneros'));

  // Hyphenated name: Mario Diaz-Balart
  const leg3 = matchLegislator('FL26', 'Mario Diaz-Balart');
  assert.equal(leg3.party, 'Republican');
  assert.ok(leg3.fullName?.includes('Diaz-Balart'));

  // Suffix: Rudy Yakym III
  const leg4 = matchLegislator('IN02', 'Rudy Yakym III');
  assert.equal(leg4.party, 'Republican');
  assert.ok(leg4.fullName?.includes('Yakym'));
});

// 11. Item E: 2023 Old Trade check
test('2023 trade row matches Pramila Jayapal late filing', () => {
  const res = queryCongressTrades({ politician: 'Jayapal', pageSize: 50 });
  const oldTrade = res.trades.find((t) => t.transactionDate === '2023-10-31');
  assert.ok(oldTrade, 'Must find Jayapal 2023 trade');
  assert.equal(oldTrade.docId, '20034160');
  assert.equal(oldTrade.ticker, 'NWL');
  assert.equal(oldTrade.filingDate, '2026-03-15');
});

// 12. Date Anomaly Icon and Tooltip UI Rendering tests
test('CongressionalTradingPanel renders warning icon in specific date cell with tooltip and eliminates long badge text', () => {
  const hagemanTrade = queryCongressTrades({ politician: 'Hageman', ticker: 'PSA', pageSize: 50 }).trades[0];
  const cohenTrade = queryCongressTrades({ politician: 'Cohen', pageSize: 50 }).trades.find((t) => t.docId === '20033889')!;

  assert.ok(hagemanTrade, 'Hageman PSA trade must exist');
  assert.ok(cohenTrade, 'Cohen trade must exist');

  // Render panel with both anomaly trades
  const html = renderToStaticMarkup(
    React.createElement(CongressionalTradingPanel, {
      selectedTicker: 'AAPL',
      initialTrades: [hagemanTrade, cohenTrade],
    })
  );

  // 1. Assert that the old long badge text is completely gone from the markup
  assert.ok(
    !html.includes('DATE AS FILED, LIKELY TYPO'),
    'The long text "DATE AS FILED, LIKELY TYPO" must NOT be rendered in table cells'
  );

  // 2. Assert that lucide-triangle-alert icon is rendered
  assert.ok(
    html.includes('lucide-triangle-alert'),
    'Warning icon lucide-triangle-alert must be rendered for anomalous dates'
  );

  // 3. Assert that Hageman notification anomaly renders in NOTIFIED column cell
  // Hageman notification date is 2029-04-29. The tooltip text contains the date as filed and explanation
  assert.ok(
    html.includes('2029-04-29'),
    'Hageman notification date 2029-04-29 must be rendered as filed'
  );
  assert.ok(
    html.includes('Notification date (2029-04-29) is in the future'),
    'Tooltip/aria-label must include explanation with notification date as filed'
  );

  // 4. Assert that Cohen trade date anomaly renders in TX DATE column cell
  // Cohen trade date is 2026-12-26. Tooltip contains the date as filed and explanation
  assert.ok(
    html.includes('2026-12-26'),
    'Cohen trade date 2026-12-26 must be rendered as filed'
  );
  assert.ok(
    html.includes('Trade date (2026-12-26) is likely a typo in the original filing'),
    'Tooltip/aria-label must include explanation with trade date as filed'
  );

  // 5. Assert keyboard accessibility: single focusable element (TerminalTooltip trigger has tabIndex="0")
  assert.ok(
    html.includes('tabindex="0"'),
    'Warning icon container must be focusable with tabIndex="0"'
  );
  assert.ok(
    html.includes('role="note"'),
    'Warning icon element must have role="note"'
  );

  // Assert single focusable element (no nested tabindex="0" inside the tooltip trigger)
  assert.ok(
    !html.includes('<span tabindex="0" class="terminal-tooltip-trigger"><span tabindex="0"'),
    'Warning icon container must not have nested tabindex="0"'
  );
});

// 13. UI Markup Verification: No top banner notice, footer notices present, no tab-level SYNC button
test('CongressionalTradingPanel UI layout matches Phase 1 refinements', () => {
  const sampleTrade = queryCongressTrades({ pageSize: 5 }).trades[0];
  const html = renderToStaticMarkup(
    React.createElement(CongressionalTradingPanel, {
      selectedTicker: 'AAPL',
      initialTrades: [sampleTrade],
    })
  );

  // 1. Top banner notice removed
  assert.ok(
    !html.includes('bg-black/60 border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-300 leading-relaxed'),
    'Top banner notice must be removed'
  );

  // 2. Tab-level SYNC button removed (refresh is now in header)
  assert.ok(
    !html.includes('<span>SYNC</span>'),
    'Tab-level SYNC button must be removed'
  );

  // 3. House Clerk statutory notice in footer with exact text
  const expectedNotice =
    'NOTICE: Financial Disclosure Statements and Periodic Transaction Reports are made available under Title I of the Ethics in Government Act (5 U.S.C. app. § 105). It is unlawful to use information contained in these reports for (A) any unlawful purpose, (B) any commercial purpose, other than by news and communications media for dissemination to the general public, (C) determining or establishing credit ratings, or (D) direct or indirect solicitation of money for political, charitable, or other purposes. Disclosed amounts are statutory ranges or exact cash receipts as filed.';
  assert.ok(
    html.includes(expectedNotice),
    'Footer must contain exact House Clerk statutory notice'
  );

  // 4. Senate eFD exclusion sentence and link in footer
  assert.ok(
    html.includes('U.S. Senate disclosures are not included'),
    'Footer must contain Senate eFD exclusion statement'
  );
  assert.ok(
    html.includes('OFFICIAL SENATE eFD SEARCH'),
    'Footer must contain official Senate search link'
  );

  // 5. Header tooltips on FILED and GAP columns
  assert.ok(
    html.includes('Members must report within 30 days of being notified of a trade, and no later than 45 days after the trade.'),
    'FILED and GAP headers must include deadline tooltip'
  );
});

// 14. Refresh logic: UP TO DATE vs CHECKED <time> AGO rate-limiting tests
test('runIngestionBackfill respects rate-limiting and returns appropriate check results', async () => {
  // Case 1: First check runs or was recently checked; testing cooldown enforcement
  const result1 = await runIngestionBackfill({ forceCheckIndex: false });

  if (result1.cooldownActive) {
    // Cooldown is active because an index check ran recently
    assert.equal(result1.indexCheckRan, false, 'Index check must NOT run when cooldown is active');
    assert.ok(
      typeof result1.cooldownRemainingSeconds === 'number' && result1.cooldownRemainingSeconds > 0,
      'Cooldown remaining seconds must be reported'
    );
  } else {
    // Index check ran
    assert.equal(result1.indexCheckRan, true, 'Index check ran');
    assert.equal(result1.newFilingsFound, 0, 'No new filings in already up-to-date cache');
  }

  // Case 2: Immediate second check without forceCheckIndex must be throttled with cooldown
  const result2 = await runIngestionBackfill({ forceCheckIndex: false });
  assert.equal(result2.indexCheckRan, false, 'Rapid repeated check must be blocked by rate limiter');
  assert.equal(result2.cooldownActive, true, 'Cooldown must be active on rapid repeated check');
  assert.ok(
    result2.cooldownRemainingSeconds! > 0,
    'Cooldown remaining seconds must be positive'
  );

  // Status payload reports lastIndexCheck and cooldown info
  const status = getCongressTradingStatus();
  assert.ok(status.lastIndexCheck, 'lastIndexCheck timestamp must be present');
  assert.equal(status.cooldownActive, true, 'cooldownActive must be reflected in status endpoint');
});

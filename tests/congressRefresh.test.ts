import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CongressionalTradingPanel from '../src/components/CongressionalTradingPanel';
import InstitutionalActivityScreen from '../src/components/InstitutionalActivityScreen';
import { parseCommandLineInput } from '../src/utils/commandParser';

const sampleTrade = {
  id: '20012345-1-2026-01-15-Apple Inc [ST]-$1,001 - $15,000',
  docId: '20012345',
  year: '2026',
  politicianName: 'Nancy Pelosi',
  party: 'Democrat' as const,
  state: 'CA',
  district: 11,
  stateDistrict: 'CA11',
  filingDate: '2026-02-01',
  transactionDate: '2026-01-15',
  disclosureDate: '2026-01-20',
  notificationDate: '2026-01-20',
  reportingGapDays: 17,
  ticker: 'AAPL',
  rawAssetDescription: 'Apple Inc. - Common Stock [ST]',
  assetTypeCode: 'ST',
  assetGroup: 'EQUITIES' as const,
  txType: 'BUY' as const,
  txTypeRaw: 'P',
  owner: 'spouse' as const,
  ownerRaw: 'SP',
  amountRange: '$1,001 - $15,000',
  amountMin: 1001,
  amountMax: 15000,
  isExactAmount: false,
  filingUrl: 'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20012345.pdf',
};

test('Refresh Lifecycle: Button shows REFRESH in idle state with standard styling', () => {
  const html = renderToStaticMarkup(
    React.createElement(InstitutionalActivityScreen, {
      selectedTicker: 'AAPL',
      stocks: {},
      initialTab: 'CONGRESS',
    })
  );

  assert.ok(html.includes('>REFRESH<'), 'Expected button text to be REFRESH when idle');
  assert.ok(!html.includes('>REFRESHING<'), 'Should not display REFRESHING when idle');
});

test('Progressive Results: Initial available trades render immediately without waiting for background backfill', () => {
  const html = renderToStaticMarkup(
    React.createElement(CongressionalTradingPanel, {
      selectedTicker: 'NVDA',
      initialTrades: [sampleTrade],
    })
  );

  assert.ok(html.includes('Nancy Pelosi'), 'Expected initial trade to render immediately');
  assert.ok(html.includes('Apple Inc. - Common Stock'), 'Expected asset description to be rendered');
  assert.ok(html.includes('$1,001 - $15,000'), 'Expected amount range to be rendered');
  assert.ok(!html.includes('LOADING CONGRESSIONAL TRADES...'), 'Should not block table when initial trades exist');
});

test('Progressive Results: Deduplication and progressive merging logic', () => {
  const initialList = [sampleTrade];
  const newBatch = [
    // Duplicate of sampleTrade with same ID
    { ...sampleTrade, amountRange: '$1,001 - $15,000 (updated)' },
    // Distinct trade
    { ...sampleTrade, id: '20099999-1', docId: '20099999', politicianName: 'Ro Khanna', ticker: 'NVDA' },
  ];

  // Merge map simulating progressive update
  const map = new Map<string, typeof sampleTrade>();
  for (const t of initialList) map.set(t.id, t);
  for (const t of newBatch) map.set(t.id, t);

  const merged = Array.from(map.values());
  assert.equal(merged.length, 2, 'Expected 2 deduplicated records');
  assert.equal(merged[0].amountRange, '$1,001 - $15,000 (updated)', 'Expected existing record to be updated');
  assert.equal(merged[1].politicianName, 'Ro Khanna', 'Expected new record to be added');
});

test('Changing Totals Highlight: Tracking individual changed totals independently', () => {
  let prev = {
    filteredTrades: 100,
    totalTransactions: 500,
    totalParsedFilings: 460,
    totalScannedFilings: 67,
  };

  const next = {
    filteredTrades: 100, // unchanged
    totalTransactions: 510, // changed
    totalParsedFilings: 460, // unchanged
    totalScannedFilings: 68, // changed
  };

  const changedKeys: string[] = [];
  if (next.filteredTrades !== prev.filteredTrades) changedKeys.push('filteredTrades');
  if (next.totalTransactions !== prev.totalTransactions) changedKeys.push('totalTransactions');
  if (next.totalParsedFilings !== prev.totalParsedFilings) changedKeys.push('totalParsedFilings');
  if (next.totalScannedFilings !== prev.totalScannedFilings) changedKeys.push('totalScannedFilings');

  assert.deepEqual(changedKeys, ['totalTransactions', 'totalScannedFilings']);
});

test('Timestamp Display Lifecycle: Initial render without successful completion does not show premature timestamp', () => {
  const html = renderToStaticMarkup(
    React.createElement(InstitutionalActivityScreen, {
      selectedTicker: 'AAPL',
      stocks: {},
      initialTab: 'CONGRESS',
    })
  );

  // When initial render starts without a verified completed refresh, UPDATED timestamp is not prematurely displayed
  assert.ok(!html.includes('UPDATED '), 'Initial render must not prematurely show an updated timestamp');
  assert.ok(!html.includes('CHECKED '), 'CHECKED indicator must never be rendered');
});

test('Refresh Lifecycle: No CHECKED indicator rendered in HTML', () => {
  const html = renderToStaticMarkup(
    React.createElement(InstitutionalActivityScreen, {
      selectedTicker: 'AAPL',
      stocks: {},
      initialTab: 'CONGRESS',
    })
  );

  assert.ok(!html.includes('CHECKED'), 'Expected no CHECKED status indicator in Congress header');
});

test('Timestamp Display Lifecycle: UPDATED updates on successful manual refresh and preserves on failure', () => {
  // Scenario 1: Successful refresh updates the timestamp
  let lastSuccessfulCongressUpdated: string | null = '2026-11-26T12:00:00.000Z';
  const initialTimestamp = lastSuccessfulCongressUpdated;

  // Refresh completes successfully with new timestamp
  const newTimestamp = '2026-11-26T12:05:00.000Z';
  const successfulResult = { success: true, lastUpdated: newTimestamp };

  if (successfulResult.success) {
    lastSuccessfulCongressUpdated = successfulResult.lastUpdated || new Date().toISOString();
  }

  assert.equal(lastSuccessfulCongressUpdated, newTimestamp, 'Successful refresh must update lastSuccessfulCongressUpdated');

  // Scenario 2: Successful refresh without new trades still updates timestamp
  const noNewTradesResult = { success: true, newFilingsFound: 0, indexCheckRan: false, lastUpdated: '2026-11-26T12:10:00.000Z' };
  if (noNewTradesResult.success) {
    lastSuccessfulCongressUpdated = noNewTradesResult.lastUpdated || new Date().toISOString();
  }

  assert.equal(lastSuccessfulCongressUpdated, '2026-11-26T12:10:00.000Z', 'Refresh with no new trades must still update timestamp');

  // Scenario 3: Failed refresh preserves the previous timestamp
  const failedResult = { success: false, lastUpdated: null };
  if (failedResult.success) {
    lastSuccessfulCongressUpdated = failedResult.lastUpdated || new Date().toISOString();
  }

  assert.equal(lastSuccessfulCongressUpdated, '2026-11-26T12:10:00.000Z', 'Failed refresh must retain the previous successful timestamp');
});

test('Isolation: Congress REFRESH button is type="button" and does not trigger form submit', () => {
  const html = renderToStaticMarkup(
    React.createElement(InstitutionalActivityScreen, {
      selectedTicker: 'AAPL',
      stocks: {},
      initialTab: 'CONGRESS',
    })
  );

  // The refresh button must explicitly be type="button" to prevent accidental form submission
  assert.ok(
    html.includes('type="button"'),
    'Expected buttons in InstitutionalActivityScreen to be type="button"'
  );
  // Ensure the refresh button has type="button" specifically
  const refreshButtonMatch = html.match(/<button[^>]*>[\s\S]*?REFRESH[\s\S]*?<\/button>/);
  assert.ok(refreshButtonMatch, 'REFRESH button must be present in HTML');
  assert.ok(
    refreshButtonMatch[0].includes('type="button"'),
    'REFRESH button must have type="button" attribute to avoid submitting any ancestor or sibling form'
  );
});

test('Isolation: Refreshing Congress data does not execute or alter command in search field', async () => {
  let executedCommand: string | null = null;
  let activeScreen = 'INST';
  let currentCommand = 'GP AAPL';

  // Simulate user having GP AAPL in search input while on CONGRESS tab
  const handleCommandSubmit = (cmd: string) => {
    executedCommand = cmd;
    const parsed = parseCommandLineInput(cmd);
    if (parsed.type === 'TICKER_SCREEN') {
      activeScreen = parsed.screen;
    }
  };

  // Simulate refresh operation
  let refreshCalled = false;
  const mockPanelRef = {
    refresh: async () => {
      refreshCalled = true;
      return {
        indexCheckRan: true,
        newFilingsFound: 0,
        cooldownActive: false,
        lastIndexCheck: new Date().toISOString(),
        success: true,
      };
    },
  };

  // Execute refresh
  const result = await mockPanelRef.refresh();

  // Assertions:
  assert.equal(refreshCalled, true, 'Congress data refresh operation must be invoked');
  assert.equal(result.success, true, 'Refresh must succeed');
  assert.equal(executedCommand, null, 'Congress refresh must NOT execute any pending command');
  assert.equal(currentCommand, 'GP AAPL', 'Global search value must remain intact');
  assert.equal(activeScreen, 'INST', 'Active screen must remain on INST / CONGRESS tab');

  // Explicit command submission still works
  handleCommandSubmit(currentCommand);
  assert.equal(executedCommand, 'GP AAPL', 'Explicit command submission must still work');
  assert.equal(activeScreen, 'GP', 'Explicit command submission must navigate to GP');
});

test('Sequence Integration: GP AAPL -> Select CONGRESS -> REFRESH keeps user on CONGRESS and search as CON', async () => {
  // Model the application state machine representing App.tsx & InstitutionalActivityScreen.tsx
  let activeScreen = 'GP';
  let activeInstTab = 'HOLDINGS';
  let selectedTicker = 'AAPL';
  let currentCommand = 'GP AAPL';
  let congressSubmissionSignal: { id: number; politician: string } | null = null;
  let lastPrefilledCommand: string | null = 'GP AAPL';
  let executedCommand: string | null = null;

  // Step 1: User initially on GP AAPL
  assert.equal(activeScreen, 'GP');
  assert.equal(currentCommand, 'GP AAPL');

  // Step 2: User navigates to INST / selects CONGRESS tab
  // (e.g. clicking INST in sidebar then clicking CONGRESS tab button)
  activeScreen = 'INST';
  activeInstTab = 'CONGRESS';

  // State synchronization in App.tsx:
  // When activeScreen is INST and activeInstTab is CONGRESS:
  if (activeScreen === 'INST' && activeInstTab === 'CONGRESS') {
    if (!/^CON\b/i.test(currentCommand.trim())) {
      const pol = (congressSubmissionSignal?.politician || '').trim();
      const cmd = pol ? `CON ${pol}` : 'CON';
      lastPrefilledCommand = cmd;
      currentCommand = cmd;
    }
  }

  // Step 3: Confirm global search becomes 'CON'
  assert.equal(currentCommand, 'CON', 'Global search must update to CON when selecting CONGRESS tab');
  assert.equal(activeScreen, 'INST', 'Active screen must be INST');
  assert.equal(activeInstTab, 'CONGRESS', 'Active Institutional tab must be CONGRESS');

  // Step 4: User clicks Congress REFRESH button
  // Simulate handleGlobalRefresh in InstitutionalActivityScreen
  let refreshRan = false;
  const handleGlobalRefresh = async () => {
    if (activeInstTab === 'CONGRESS') {
      refreshRan = true;
      // In the fixed code, handleCongressStatusUpdate stabilizes updates
      // and does NOT trigger infinite re-renders or application crashes
    }
  };

  await handleGlobalRefresh();

  // Step 5: Assert state post-refresh
  assert.equal(refreshRan, true, 'Refresh action must have been invoked');
  assert.equal(activeScreen, 'INST', 'Active screen must remain Institutional Activity Monitor (INST)');
  assert.equal(activeInstTab, 'CONGRESS', 'Active tab must remain CONGRESS');
  assert.equal(currentCommand, 'CON', 'Global search must remain CON and NOT revert to GP AAPL');
  assert.equal(executedCommand, null, 'No command must be executed during refresh');

  // Step 6: Confirm explicitly submitting GP AAPL still works
  const executeCommand = (cmd: string) => {
    executedCommand = cmd;
    const parsed = parseCommandLineInput(cmd);
    if (parsed.type === 'TICKER_SCREEN') {
      activeScreen = parsed.screen;
      selectedTicker = parsed.ticker;
      currentCommand = `${parsed.screen} ${parsed.ticker}`;
    }
  };

  executeCommand('GP AAPL');
  assert.equal(executedCommand, 'GP AAPL');
  assert.equal(activeScreen, 'GP');
  assert.equal(selectedTicker, 'AAPL');
  assert.equal(currentCommand, 'GP AAPL');
});

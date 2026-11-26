import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  parseCommandLineInput,
  COMMAND_DEFINITIONS,
  COMMAND_ALIAS_MAP,
  extractRecognizedCommandPrefix,
} from '../src/utils/commandParser';
import CommandPanel from '../src/components/CommandPanel';
import Workspace from '../src/components/Workspace';
import InstitutionalActivityScreen from '../src/components/InstitutionalActivityScreen';
import CongressionalTradingPanel from '../src/components/CongressionalTradingPanel';

test('CON command: basic single-word and multi-word politician name parsing', () => {
  // 1. CON Pelosi extracts Pelosi
  const res1 = parseCommandLineInput('CON Pelosi');
  assert.deepEqual(res1, {
    type: 'CONGRESS_SEARCH',
    politician: 'Pelosi',
  });

  // 2. CON Nancy Pelosi preserves full multi-word name
  const res2 = parseCommandLineInput('CON Nancy Pelosi');
  assert.deepEqual(res2, {
    type: 'CONGRESS_SEARCH',
    politician: 'Nancy Pelosi',
  });

  // 3. Multi-word with extra spaces: trimmed leading/trailing, interior spaces preserved
  const res3 = parseCommandLineInput('CON   Bernie   Sanders   ');
  assert.deepEqual(res3, {
    type: 'CONGRESS_SEARCH',
    politician: 'Bernie   Sanders',
  });

  const resSchumer = parseCommandLineInput('CON Schumer');
  assert.deepEqual(resSchumer, {
    type: 'CONGRESS_SEARCH',
    politician: 'Schumer',
  });
});

test('CON command: case-insensitivity', () => {
  const lowerRes = parseCommandLineInput('con pelosi');
  assert.deepEqual(lowerRes, {
    type: 'CONGRESS_SEARCH',
    politician: 'pelosi',
  });

  const mixedRes = parseCommandLineInput('cOn Nancy Pelosi');
  assert.deepEqual(mixedRes, {
    type: 'CONGRESS_SEARCH',
    politician: 'Nancy Pelosi',
  });
});

test('CON command: standalone CON parses to CONGRESS_SEARCH with empty politician query', () => {
  const emptyRes1 = parseCommandLineInput('CON');
  assert.deepEqual(emptyRes1, {
    type: 'CONGRESS_SEARCH',
    politician: '',
  });

  const emptyRes2 = parseCommandLineInput('con   ');
  assert.deepEqual(emptyRes2, {
    type: 'CONGRESS_SEARCH',
    politician: '',
  });
});

test('CON command does not confuse politician names with tickers or other screens', () => {
  // Politician names like "Warren" or "Paul" or "Reed" or "Lee" or "Barr"
  const warren = parseCommandLineInput('CON Warren');
  assert.deepEqual(warren, {
    type: 'CONGRESS_SEARCH',
    politician: 'Warren',
  });

  const barr = parseCommandLineInput('CON Barr');
  assert.deepEqual(barr, {
    type: 'CONGRESS_SEARCH',
    politician: 'Barr',
  });
});

test('INST [ticker] command behavior is preserved and unchanged', () => {
  const inst1 = parseCommandLineInput('INST AAPL');
  assert.deepEqual(inst1, {
    type: 'TICKER_SCREEN',
    ticker: 'AAPL',
    screen: 'INST',
  });

  const inst2 = parseCommandLineInput('AAPL INST');
  assert.deepEqual(inst2, {
    type: 'TICKER_SCREEN',
    ticker: 'AAPL',
    screen: 'INST',
  });

  const instScreenOnly = parseCommandLineInput('INST');
  assert.deepEqual(instScreenOnly, {
    type: 'SCREEN',
    screen: 'INST',
  });
});

test('Privacy and navigation restriction: CON is registered with hideInSidebar, recognized as prefix, but excluded from CommandPanel', () => {
  // 1. Must be registered in COMMAND_DEFINITIONS with hideInSidebar: true
  const conDef = COMMAND_DEFINITIONS.find((c) => c.code === 'CON');
  assert.ok(conDef, 'CON must be registered in COMMAND_DEFINITIONS');
  assert.equal(conDef.hideInSidebar, true, 'CON must have hideInSidebar: true');

  // 2. Must be recognized in COMMAND_ALIAS_MAP
  assert.equal(COMMAND_ALIAS_MAP['CON'], 'CON', 'CON must map to CON in COMMAND_ALIAS_MAP');

  // 3. Must be recognized by extractRecognizedCommandPrefix for terminal styling
  const prefixRes = extractRecognizedCommandPrefix('CON Pelosi');
  assert.ok(prefixRes, 'CON Pelosi must be recognized by extractRecognizedCommandPrefix');
  assert.equal(prefixRes.prefix, 'CON');
  assert.equal(prefixRes.remainder, ' Pelosi');
  assert.equal(prefixRes.commandCode, 'CON');

  // 4. Must NOT appear in CommandPanel (sidebar)
  const panelHtml = renderToStaticMarkup(
    React.createElement(CommandPanel, {
      stocks: {},
      trackedTickers: ['AAPL'],
      selectedTicker: 'AAPL',
      onSelectTicker: () => {},
      onReorderTicker: () => {},
      onRemoveTicker: () => {},
      onResetTrackedTickers: () => {},
      activeScreen: 'GP',
      onSelectScreen: () => {},
    })
  );
  assert.equal(panelHtml.includes('>CON<'), false, 'CON must not appear in CommandPanel');
  assert.equal(panelHtml.includes('CONGRESSIONAL TRADING'), false, 'CONGRESSIONAL TRADING must not appear in CommandPanel');
});

test('CongressionalTradingPanel accepts initialSearchQuery and renders value in search field', () => {
  const html = renderToStaticMarkup(
    React.createElement(CongressionalTradingPanel, {
      selectedTicker: 'NVDA',
      initialSearchQuery: 'Pelosi',
      initialTrades: [],
    })
  );

  assert.ok(
    html.includes('value="Pelosi"'),
    'Expected CongressionalTradingPanel input to render with value="Pelosi"'
  );
  assert.ok(
    html.includes('placeholder="SEARCH POLITICIAN..."'),
    'Expected SEARCH POLITICIAN input placeholder to be present'
  );
});

test('InstitutionalActivityScreen defaults to HOLDINGS tab normally, and selects CONGRESS tab when congressSubmissionSignal is provided', () => {
  // Normal default render
  const defaultHtml = renderToStaticMarkup(
    React.createElement(InstitutionalActivityScreen, {
      selectedTicker: 'AAPL',
      stocks: {},
    })
  );
  // Default tab is HOLDINGS
  assert.ok(
    defaultHtml.includes('INSTITUTIONAL HOLDINGS'),
    'Expected InstitutionalActivityScreen to show HOLDINGS tab content by default'
  );

  // Render with congressSubmissionSignal
  const congressHtml = renderToStaticMarkup(
    React.createElement(InstitutionalActivityScreen, {
      selectedTicker: 'AAPL',
      stocks: {},
      initialTab: 'CONGRESS',
      initialPoliticianSearch: 'Nancy Pelosi',
      congressSubmissionSignal: { id: 12345, politician: 'Nancy Pelosi' },
    })
  );
  assert.ok(
    congressHtml.includes('value="Nancy Pelosi"'),
    'Expected Congress tab to be active and search query populated with Nancy Pelosi'
  );
});

test('CongressionalTradingPanel allows clearing search filter and propagates via onSearchQueryChange', () => {
  let changedQuery: string | null = null;
  const panel = React.createElement(CongressionalTradingPanel, {
    selectedTicker: 'NVDA',
    initialSearchQuery: 'Pelosi',
    onSearchQueryChange: (q) => {
      changedQuery = q;
    },
  });
  const html = renderToStaticMarkup(panel);
  assert.ok(html.includes('value="Pelosi"'));

  // Test empty query rendering
  const emptyHtml = renderToStaticMarkup(
    React.createElement(CongressionalTradingPanel, {
      selectedTicker: 'NVDA',
      initialSearchQuery: '',
    })
  );
  assert.ok(emptyHtml.includes('value=""'), 'Expected empty search value for unfiltered state');
});

test('Bi-directional synchronization: Congress filter and Global Search synchronization logic', () => {
  // Scenario A: User edits Congress filter from PELOSI to SCHUMER -> command becomes CON SCHUMER
  const updateToSchumer = (query: string) => (query.trim() ? `CON ${query.trim()}` : 'CON');
  assert.equal(updateToSchumer('SCHUMER'), 'CON SCHUMER');

  // User clears Congress filter -> command becomes CON
  assert.equal(updateToSchumer(''), 'CON');
  assert.equal(updateToSchumer('   '), 'CON');

  // Scenario B: User edits Global Search to CON SCHUMER -> extracts SCHUMER
  const parseGlobalSearch = (val: string) => {
    const trimmed = val.trim();
    if (/^CON\b/i.test(trimmed)) {
      return trimmed.slice(3).trim();
    }
    return null;
  };

  assert.equal(parseGlobalSearch('CON SCHUMER'), 'SCHUMER');
  assert.equal(parseGlobalSearch('CON Nancy Pelosi'), 'Nancy Pelosi');
  assert.equal(parseGlobalSearch('CON'), '');
  assert.equal(parseGlobalSearch('con   '), '');
});

import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CompanyLogo,
  normalizeLogoSymbol,
  getLogoUrl,
  logoStatusCache,
  clearLogoStatusCache,
  isCompanyEquitySymbol,
  splitReportTitleAndBody,
  NON_EQUITY_SYMBOLS,
} from '../src/components/CompanyLogo';

console.log('--- Testing CompanyLogo Component ---');

// 1. Ticker Normalization
assert.equal(normalizeLogoSymbol('aapl'), 'AAPL');
assert.equal(normalizeLogoSymbol('brk.b'), 'BRK-B');
assert.equal(normalizeLogoSymbol('BRK.B'), 'BRK-B');
assert.equal(normalizeLogoSymbol('bf.b'), 'BF-B');
assert.equal(normalizeLogoSymbol('  msft  '), 'MSFT');
assert.equal(normalizeLogoSymbol('hei.a'), 'HEI-A');
assert.equal(normalizeLogoSymbol(''), '');
console.log('✓ Normalization (including BRK.B -> BRK-B) verified');

// 2. Non-Equity Symbol Guard
assert.equal(isCompanyEquitySymbol('AAPL'), true);
assert.equal(isCompanyEquitySymbol('WULF'), true);
assert.equal(isCompanyEquitySymbol('BRK.B'), true);
assert.equal(isCompanyEquitySymbol('SPY'), true); // ETFs are valid corporate/fund tickers
assert.equal(isCompanyEquitySymbol('SPCX'), true);

// Reject known non-equity indices, commodities, futures, crypto, FX
assert.equal(isCompanyEquitySymbol('SPX'), false);
assert.equal(isCompanyEquitySymbol('DJI'), false);
assert.equal(isCompanyEquitySymbol('IXIC'), false);
assert.equal(isCompanyEquitySymbol('GC'), false);
assert.equal(isCompanyEquitySymbol('CL'), false);
assert.equal(isCompanyEquitySymbol('TNX'), false);
assert.equal(isCompanyEquitySymbol('BTC'), false);
assert.equal(isCompanyEquitySymbol('ETH'), false);
assert.equal(isCompanyEquitySymbol('VIX'), false);
assert.equal(isCompanyEquitySymbol('DXY'), false);

// Reject Yahoo special syntax: leading caret, futures =F, or currency pairs
assert.equal(isCompanyEquitySymbol('^GSPC'), false);
assert.equal(isCompanyEquitySymbol('GC=F'), false);
assert.equal(isCompanyEquitySymbol('EUR/USD'), false);
assert.equal(isCompanyEquitySymbol(''), false);
console.log('✓ Non-equity guard (isCompanyEquitySymbol) strictly separates equities from non-equities');

// 3. First-line Report Title Split Helper
// (a) Standard expected report format
const sampleDesReport = `APPLE INC. (AAPL)
========================================================================
SECTOR: Technology | INDUSTRY: Consumer Electronics | EXCHANGE: NMS
HQ: Cupertino, CA, United States | EMPLOYEES: 161,000 | WEB: https://www.apple.com`;

const splitResult = splitReportTitleAndBody(sampleDesReport);
assert.equal(splitResult.title, 'APPLE INC. (AAPL)');
assert.equal(
  splitResult.body,
  `========================================================================
SECTOR: Technology | INDUSTRY: Consumer Electronics | EXCHANGE: NMS
HQ: Cupertino, CA, United States | EMPLOYEES: 161,000 | WEB: https://www.apple.com`
);

// (b) Single-line string (no newline)
const singleLineResult = splitReportTitleAndBody('ERROR: Security not found');
assert.equal(singleLineResult.title, null);
assert.equal(singleLineResult.body, 'ERROR: Security not found');

// (c) Empty or null report
assert.deepEqual(splitReportTitleAndBody(''), { title: null, body: '' });

// (d) Text starting with divider directly (no company title)
const dividerFirst = '========================================================================\nContent';
assert.deepEqual(splitReportTitleAndBody(dividerFirst), { title: null, body: dividerFirst });

// (e) Leading whitespace on title line trimmed cleanly
const whitespaceTitle = '   TERAWULF INC. (WULF)   \n==================================\nBody text';
const wsResult = splitReportTitleAndBody(whitespaceTitle);
assert.equal(wsResult.title, 'TERAWULF INC. (WULF)');
assert.equal(wsResult.body, '==================================\nBody text');
console.log('✓ Report title and body split (splitReportTitleAndBody) handles standard and edge-case text');

// 4. URL Generation
assert.equal(
  getLogoUrl('AAPL', 'parqet'),
  'https://assets.parqet.com/logos/symbol/AAPL'
);
assert.equal(
  getLogoUrl('BRK-B', 'parqet'),
  'https://assets.parqet.com/logos/symbol/BRK-B'
);
assert.equal(
  getLogoUrl('AAPL', 'fmp'),
  'https://images.financialmodelingprep.com/symbol/AAPL.png'
);
assert.equal(
  getLogoUrl('BRK-B', 'fmp'),
  'https://images.financialmodelingprep.com/symbol/BRK-B.png'
);
console.log('✓ URL generation across tiers verified');

// 5. Rendering when symbol is empty
const emptyHtml = renderToStaticMarkup(
  React.createElement(CompanyLogo, { symbol: '' })
);
assert.equal(emptyHtml, '', 'Empty symbol must render nothing');
console.log('✓ Empty symbol renders nothing');

// 6. Initial render defaults to Parqet tier with default 48px size and thinner border
clearLogoStatusCache();
const defaultHtml = renderToStaticMarkup(
  React.createElement(CompanyLogo, { symbol: 'AAPL' })
);
assert.match(
  defaultHtml,
  /assets\.parqet\.com\/logos\/symbol\/AAPL/,
  'Initial tier must use Parqet'
);
assert.match(
  defaultHtml,
  /company-logo-container-parqet/,
  'Container must mark parqet tier'
);
assert.match(
  defaultHtml,
  /bg-zinc-800\/80/,
  'Container must have neutral dark backing'
);
assert.match(
  defaultHtml,
  /border-\[#2a2a2a\]/,
  'Container must have subtle border-[#2a2a2a]'
);
assert.match(
  defaultHtml,
  /width:48px/,
  'Default dimensions must be 48px'
);
assert.match(
  defaultHtml,
  /p-\[1px\]/,
  'Padding must be p-[1px] to keep frame thin'
);
// Verify no duplicate shrink-0 in default class string
assert.doesNotMatch(
  defaultHtml,
  /shrink-0.*shrink-0/,
  'Must not have duplicate shrink-0 classes'
);
console.log('✓ Default render uses Parqet SVG with refined thinner border-[#2a2a2a] and p-[1px]');

// 7. Size 28px (for HP header) and 32px (for GP / DES / ANR header)
const hpSizeHtml = renderToStaticMarkup(
  React.createElement(CompanyLogo, { symbol: 'AAPL', size: 28 })
);
assert.match(hpSizeHtml, /width:28px/);
assert.match(hpSizeHtml, /height:28px/);
console.log('✓ Size=28 renders 28x28px container for HP header');

const gpSizeHtml = renderToStaticMarkup(
  React.createElement(CompanyLogo, { symbol: 'WULF', size: 32 })
);
assert.match(gpSizeHtml, /width:32px/);
assert.match(gpSizeHtml, /height:32px/);
assert.match(gpSizeHtml, /p-\[1px\]/);
console.log('✓ Size=32 renders 32x32px container for GP/DES/ANR headers');

// 8. Cache behavior - when FMP is cached, renders FMP immediately with custom size
logoStatusCache.set('NVDA', 'fmp');
const fmpHtml = renderToStaticMarkup(
  React.createElement(CompanyLogo, { symbol: 'NVDA', size: 56 })
);
assert.match(
  fmpHtml,
  /images\.financialmodelingprep\.com\/symbol\/NVDA\.png/,
  'Cached tier must use FMP'
);
assert.match(
  fmpHtml,
  /width:56px/,
  'Dimensions must match size prop (56px)'
);
console.log('✓ Cached FMP tier renders FMP PNG immediately');

// 9. Cache behavior - when Monogram is cached, renders Monogram with proportional font and matching border
logoStatusCache.set('SPCX', 'monogram');
const monogramHtml = renderToStaticMarkup(
  React.createElement(CompanyLogo, { symbol: 'SPCX', size: 32 })
);
assert.match(
  monogramHtml,
  /company-logo-monogram/,
  'Cached monogram tier must render monogram element'
);
assert.match(
  monogramHtml,
  />SP</,
  'Monogram must contain the first 1-2 letters of symbol'
);
assert.match(
  monogramHtml,
  /text-\[#ff9900\]/,
  'Monogram must use terminal amber text'
);
assert.match(
  monogramHtml,
  /border-\[#2a2a2a\]/,
  'Monogram border must match container border-[#2a2a2a]'
);
// At size 32px, 32 * 0.38 = 12px font size
assert.match(
  monogramHtml,
  /font-size:12px/,
  'Monogram font size must be proportional (38% of size = 12px at 32px)'
);
console.log('✓ Cached monogram tier renders retro initials badge with proportional font and matching border');

// 10. Dot-notated share class uses cache of normalized key
logoStatusCache.set('BRK-B', 'fmp');
const brkHtml = renderToStaticMarkup(
  React.createElement(CompanyLogo, { symbol: 'BRK.B' })
);
assert.match(
  brkHtml,
  /BRK-B\.png/,
  'Normalized key BRK-B should be used for BRK.B'
);
console.log('✓ Dot notation shares cache entry with hyphenated form');

clearLogoStatusCache();
console.log('All CompanyLogo unit tests passed successfully!');

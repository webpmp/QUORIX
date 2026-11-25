import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMetricPair,
  isDividerLine,
  isSectionHeading,
  parseAnrTable,
} from '../src/utils/reportFormatting';

test('parseMetricPair parses single and pipe-separated key-value pairs', () => {
  const line1 = '  LAST PRICE   : $355.58 (+1.23 / +0.35%)';
  const res1 = parseMetricPair(line1);
  assert.equal(res1.length, 1);
  assert.equal(res1[0].label, 'LAST PRICE');
  assert.equal(res1[0].value, '$355.58 (+1.23 / +0.35%)');

  const line2 = '  MARKET CAP   : 5.17T    |  BETA         : 1.09';
  const res2 = parseMetricPair(line2);
  assert.equal(res2.length, 2);
  assert.equal(res2[0].label, 'MARKET CAP');
  assert.equal(res2[0].value, '5.17T');
  assert.equal(res2[1].label, 'BETA');
  assert.equal(res2[1].value, '1.09');

  const line3 = '  CONSENSUS    : BUY (45 analysts) | MEAN TARGET: $260.00';
  const res3 = parseMetricPair(line3);
  assert.equal(res3.length, 2);
  assert.equal(res3[0].label, 'CONSENSUS');
  assert.equal(res3[0].value, 'BUY (45 analysts)');
  assert.equal(res3[1].label, 'MEAN TARGET');
  assert.equal(res3[1].value, '$260.00');
});

test('isDividerLine detects divider lines and ignores standard content', () => {
  assert.equal(isDividerLine('========================================================================'), true);
  assert.equal(isDividerLine('====='), true);
  assert.equal(isDividerLine('MARKET & VALUATION METRICS'), false);
  assert.equal(isDividerLine(''), false);
});

test('isSectionHeading detects known headings in DES and ANR reports', () => {
  assert.equal(isSectionHeading('MARKET & VALUATION METRICS'), true);
  assert.equal(isSectionHeading('FINANCIAL HEALTH & CASH FLOW'), true);
  assert.equal(isSectionHeading('BUSINESS OVERVIEW'), true);
  assert.equal(isSectionHeading('KEY EXECUTIVES'), true);
  assert.equal(isSectionHeading('RECENT HEADLINES (AAPL)'), true);
  assert.equal(isSectionHeading('RATING BREAKDOWN (BY PERIOD)'), true);
  assert.equal(isSectionHeading('KEY FUNDAMENTAL DRIVERS'), true);
  assert.equal(isSectionHeading('SOMETHING ELSE'), false);
});

test('parseAnrTable extracts breakdown rows and handles dashes and empty lines', () => {
  const sampleLines = [
    'RECOMMENDATION : BUY  |  ANALYST COUNT: 45',
    '',
    'RATING BREAKDOWN (BY PERIOD)',
    '  PERIOD   STRONG BUY   BUY   HOLD   SELL   STRONG SELL',
    '  ------   ----------   ---   ----   ----   -----------',
    '  0m               15    22      8      1             0',
    '  -1m              14    23      8      1             0',
    '  -2m              14    22      9      1             0',
    '',
    'KEY FUNDAMENTAL DRIVERS',
    '  • Revenue Growth (YoY) : 8.5%',
  ];

  const { tableRows, remainingLines } = parseAnrTable(sampleLines);
  assert.equal(tableRows.length, 3);
  assert.deepEqual(tableRows[0], {
    period: '0m',
    strongBuy: '15',
    buy: '22',
    hold: '8',
    sell: '1',
    strongSell: '0',
  });
  assert.deepEqual(tableRows[1], {
    period: '-1m',
    strongBuy: '14',
    buy: '23',
    hold: '8',
    sell: '1',
    strongSell: '0',
  });

  // Table header, separator, and data rows are removed from remainingLines (only the section heading remains in remainingLines)
  assert.equal(remainingLines.some((l) => l.includes('STRONG BUY')), false);
  assert.equal(remainingLines.some((l) => l.includes('KEY FUNDAMENTAL DRIVERS')), true);
});

test('parseAnrTable gracefully handles missing or malformed tables', () => {
  const sampleLines = ['NO TABLE HERE', 'JUST SOME TEXT'];
  const { tableRows, remainingLines } = parseAnrTable(sampleLines);
  assert.equal(tableRows.length, 0);
  assert.deepEqual(remainingLines, sampleLines);
});

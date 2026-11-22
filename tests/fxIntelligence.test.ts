import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CENTRAL_BANK_DIRECTORY,
  MAJOR_CURRENCIES,
  buildCurrencyCrossRates,
  buildCurrencyPerformanceRows,
  computeCurrencyPeriodChanges,
  computeHistoricalFxTrend,
  deriveCentralBankPolicySummary,
  parseBisPolicyCsv,
} from '../src/utils/fxAnalytics';
import { CurrenciesScreen } from '../src/components/CurrenciesScreen';
import type { FxIntelligencePayload, FxPairHistory } from '../src/types';

function makeSamplePairHistories(): FxPairHistory[] {
  return [
    {
      pair: 'EUR/USD',
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      seriesId: 'DEXUSEU',
      title: 'U.S. Dollars to One Euro',
      isDirectUsdQuote: true,
      observations: [
        { date: '2026-10-01', value: 1.0600 },
        { date: '2026-10-15', value: 1.0700 },
        { date: '2026-11-06', value: 1.0800 },
        { date: '2026-11-12', value: 1.0900 },
        { date: '2026-11-13', value: 1.1000 },
      ],
    },
    {
      pair: 'USD/JPY',
      baseCurrency: 'USD',
      quoteCurrency: 'JPY',
      seriesId: 'DEXJPUS',
      title: 'Japanese Yen to One U.S. Dollar',
      isDirectUsdQuote: false,
      observations: [
        { date: '2026-10-01', value: 145.00 },
        { date: '2026-11-06', value: 150.00 },
        { date: '2026-11-12', value: 152.00 },
        { date: '2026-11-13', value: 155.00 },
      ],
    },
    {
      pair: 'GBP/USD',
      baseCurrency: 'GBP',
      quoteCurrency: 'USD',
      seriesId: 'DEXUSUK',
      title: 'U.S. Dollars to One U.K. Pound',
      isDirectUsdQuote: true,
      observations: [
        { date: '2026-10-01', value: 1.2500 },
        { date: '2026-11-06', value: 1.2600 },
        { date: '2026-11-12', value: 1.2700 },
        { date: '2026-11-13', value: 1.2800 },
      ],
    },
    {
      pair: 'AUD/USD',
      baseCurrency: 'AUD',
      quoteCurrency: 'USD',
      seriesId: 'DEXUSAL',
      title: 'U.S. Dollars to One Australian Dollar',
      isDirectUsdQuote: true,
      observations: [
        { date: '2026-10-01', value: 0.6500 },
        { date: '2026-11-06', value: 0.6600 },
        { date: '2026-11-12', value: 0.6550 },
        { date: '2026-11-13', value: 0.6650 },
      ],
    },
    {
      pair: 'USD/CAD',
      baseCurrency: 'USD',
      quoteCurrency: 'CAD',
      seriesId: 'DEXCAUS',
      title: 'Canadian Dollars to One U.S. Dollar',
      isDirectUsdQuote: false,
      observations: [
        { date: '2026-10-01', value: 1.3800 },
        { date: '2026-11-06', value: 1.3900 },
        { date: '2026-11-12', value: 1.4000 },
        { date: '2026-11-13', value: 1.3860 },
      ],
    },
  ];
}

describe('FX Analytics Calculations', () => {
  it('computes direct vs inverse USD-relative performance accurately without interpolation', () => {
    // Direct quote (EUR/USD): 1.09 -> 1.10 is EUR strengthening (+)
    const eurStats = computeCurrencyPeriodChanges(
      [
        { date: '2026-10-12', value: 1.05 },
        { date: '2026-11-05', value: 1.08 },
        { date: '2026-11-12', value: 1.09 },
        { date: '2026-11-13', value: 1.10 },
      ],
      true
    );
    assert.ok(eurStats.dailyPct !== null && eurStats.dailyPct > 0);
    assert.ok(Math.abs(eurStats.dailyPct - ((1.10 - 1.09) / 1.09) * 100) < 1e-6);
    assert.ok(eurStats.weeklyPct !== null);
    assert.ok(Math.abs(eurStats.weeklyPct - ((1.10 - 1.08) / 1.08) * 100) < 1e-6);
    assert.ok(eurStats.monthlyPct !== null);
    assert.ok(Math.abs(eurStats.monthlyPct - ((1.10 - 1.05) / 1.05) * 100) < 1e-6);

    // Inverse quote (USD/JPY): 150 -> 153 means USD strengthened / JPY weakened (-)
    const jpyStats = computeCurrencyPeriodChanges(
      [
        { date: '2026-10-10', value: 145 },
        { date: '2026-11-06', value: 150 },
        { date: '2026-11-12', value: 150 },
        { date: '2026-11-13', value: 153 },
      ],
      false
    );
    assert.ok(jpyStats.dailyPct !== null && jpyStats.dailyPct < 0);
    // 1/153 vs 1/150 => (150/153 - 1) * 100 = -1.960784%
    assert.ok(Math.abs(jpyStats.dailyPct - ((150 / 153 - 1) * 100)) < 1e-6);
    assert.ok(jpyStats.monthlyPct !== null && jpyStats.monthlyPct < 0);
  });

  it('builds 6-currency performance rows with Broad USD Index for USD', () => {
    const histories = makeSamplePairHistories();
    const rows = buildCurrencyPerformanceRows(histories, {
      seriesId: 'DTWEXBGS',
      name: 'Nominal Broad U.S. Dollar Index',
      observations: [
        { date: '2026-10-10', value: 122.0 },
        { date: '2026-11-06', value: 123.5 },
        { date: '2026-11-12', value: 124.0 },
        { date: '2026-11-13', value: 125.0 },
      ],
    });
    assert.equal(rows.length, 6);
    const usd = rows.find((r) => r.code === 'USD');
    assert.ok(usd);
    assert.equal(usd.seriesId, 'DTWEXBGS');
    assert.equal(usd.latestQuotedRate, 125.0);
    assert.ok(usd.dailyPct !== null && usd.dailyPct > 0);
  });

  it('filters historical FX observations cleanly across timeframes and computes exact OHLC-style stats', () => {
    const obs = [
      { date: '2024-01-05', value: 1.04 },
      { date: '2026-09-01', value: 1.07 },
      { date: '2026-11-06', value: 1.08 },
      { date: '2026-11-09', value: 1.12 },
      { date: '2026-11-10', value: 1.06 },
      { date: '2026-11-13', value: 1.10 },
    ];
    const week = computeHistoricalFxTrend(obs, '1W');
    assert.equal(week.observationCount, 4);
    assert.equal(week.periodOpen, 1.08);
    assert.equal(week.periodClose, 1.10);
    assert.equal(week.periodHigh, 1.12);
    assert.equal(week.periodHighDate, '2026-11-09');
    assert.equal(week.periodLow, 1.06);
    assert.equal(week.periodLowDate, '2026-11-10');
    assert.ok(week.periodChangePct !== null);
    assert.ok(Math.abs(week.periodChangePct - ((1.10 - 1.08) / 1.08) * 100) < 1e-6);

    const fiveYr = computeHistoricalFxTrend(obs, '5Y');
    assert.equal(fiveYr.observationCount, 6);
    assert.equal(fiveYr.periodOpen, 1.04);
  });

  it('derives mathematically consistent 6x6 currency cross-rate matrix with 1.00 diagonal and exact reciprocals', () => {
    const matrix = buildCurrencyCrossRates(makeSamplePairHistories());
    assert.equal(matrix.availableCount, 30);
    assert.equal(matrix.latestObservationDate, '2026-11-13');

    for (const a of MAJOR_CURRENCIES) {
      assert.equal(matrix.rows[a][a].rate, 1);
      assert.equal(matrix.rows[a][a].isDiagonal, true);
      for (const b of MAJOR_CURRENCIES) {
        if (a === b) continue;
        const ab = matrix.rows[a][b].rate;
        const ba = matrix.rows[b][a].rate;
        assert.ok(ab !== null && ba !== null);
        assert.ok(Math.abs(ab * ba - 1) < 1e-9, `Reciprocal mismatch for ${a}/${b}`);
      }
    }

    // Spot check EUR/JPY = EUR/USD (1.10) * USD/JPY (155.00) = 170.50
    const eurJpy = matrix.rows.EUR.JPY.rate;
    assert.ok(eurJpy !== null && Math.abs(eurJpy - 170.5) < 1e-9);
    assert.equal(matrix.rows.EUR.JPY.decimals, 2);
    assert.equal(matrix.rows.JPY.EUR.decimals, 5);
  });

  it('parses BIS WS_CBPOL CSV and derives rate decision, date, and policy direction accurately', () => {
    const csv = [
      'FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE',
      'D,US,2026-08-01,4.375',
      'D,US,2026-09-18,4.125',
      'D,US,2026-11-05,3.875',
      'D,US,2026-11-17,3.875',
      'D,JP,2026-07-01,0.5',
      'D,JP,2026-09-20,0.75',
      'D,JP,2026-11-17,0.75',
      'D,CA,2025-01-01,3.0',
      'D,CA,2025-02-01,2.5',
      'D,CA,2026-11-16,2.5',
    ].join('\n');

    const parsed = parseBisPolicyCsv(csv);
    const fed = deriveCentralBankPolicySummary(
      parsed.US,
      CENTRAL_BANK_DIRECTORY[0],
      'BIS WS_CBPOL',
      'D.US'
    );
    assert.equal(fed.currentRate, 3.875);
    assert.equal(fed.lastDecisionBps, -25);
    assert.equal(fed.lastDecisionLabel, 'Cut -25 bps');
    assert.equal(fed.lastDecisionDate, '2026-11-05');
    assert.equal(fed.direction, 'Decreasing');
    assert.equal(fed.nextMeetingDate, null);

    const boj = deriveCentralBankPolicySummary(
      parsed.JP,
      CENTRAL_BANK_DIRECTORY[3],
      'BIS WS_CBPOL',
      'D.JP'
    );
    assert.equal(boj.currentRate, 0.75);
    assert.equal(boj.lastDecisionBps, 25);
    assert.equal(boj.lastDecisionLabel, 'Hike +25 bps');
    assert.equal(boj.direction, 'Increasing');

    // BoC last changed > 180 days before latest observation => Unchanged
    const boc = deriveCentralBankPolicySummary(
      parsed.CA,
      CENTRAL_BANK_DIRECTORY[5],
      'BIS WS_CBPOL',
      'D.CA'
    );
    assert.equal(boc.currentRate, 2.5);
    assert.equal(boc.direction, 'Unchanged');
  });
});

describe('CurrenciesScreen SSR Rendering', () => {
  it('renders all 6 FX Market Intelligence sections in required order when populated', () => {
    const histories = makeSamplePairHistories();
    const payload: FxIntelligencePayload = {
      success: true,
      fetchedAt: '2026-11-17T16:00:00.000Z',
      currencies: [
        { pair: 'EUR/USD', seriesId: 'DEXUSEU', rate: 1.1, prevRate: 1.09, change: 0.01, date: '2026-11-13' },
        { pair: 'USD/JPY', seriesId: 'DEXJPUS', rate: 155, prevRate: 152, change: 3, date: '2026-11-13' },
      ],
      pairHistories: histories,
      usdIndex: {
        seriesId: 'DTWEXBGS',
        name: 'Nominal Broad U.S. Dollar Index',
        observations: [
          { date: '2026-10-10', value: 122 },
          { date: '2026-11-12', value: 124 },
          { date: '2026-11-13', value: 125 },
        ],
      },
      centralBanks: CENTRAL_BANK_DIRECTORY.map((meta) =>
        deriveCentralBankPolicySummary(
          [
            { date: '2026-10-01', value: 4.0 },
            { date: '2026-11-01', value: 3.75 },
            { date: '2026-11-17', value: 3.75 },
          ],
          meta,
          'BIS WS_CBPOL',
          `D.${meta.bisArea}`
        )
      ),
      centralBanksFetchedAt: '2026-11-17T16:00:00.000Z',
      centralBanksSource: 'BIS WS_CBPOL',
    };

    const html = renderToStaticMarkup(
      React.createElement(CurrenciesScreen, {
        currencies: payload.currencies,
        initialIntelligence: payload,
        disableAutoFetch: true,
      })
    );

    const idx1 = html.indexOf('>FX MARKET OVERVIEW<');
    const idx2 = html.indexOf('>CURRENCY PERFORMANCE<');
    const idx3 = html.indexOf('>HISTORICAL FX TRENDS<');
    const idx4 = html.indexOf('>FOREIGN EXCHANGE RATES MATRIX<');
    const idx5 = html.indexOf('>CURRENCY CROSS RATES<');
    const idx6 = html.indexOf('>CENTRAL BANK &amp; INTEREST RATES<');

    assert.ok(html.includes('text-white text-md font-bold uppercase tracking-wider block">CURRENCIES (FX)</span>'));
    assert.ok(!html.includes('CRNC · FX MARKET INTELLIGENCE'));
    assert.ok(idx1 > 0 && idx2 > idx1 && idx3 > idx2 && idx4 > idx3 && idx5 > idx4 && idx6 > idx5);
    assert.ok(!html.includes('1. FX MARKET OVERVIEW'));
    assert.ok(!html.includes('CLICK CARD TO CHART'));
    assert.ok(!html.includes('CLICK COLUMN HEADER TO SORT'));
    assert.ok(html.includes('6 MAJOR CURRENCIES · USD-RELATIVE STRENGTH'));
    assert.ok(html.includes('+ STRENGTHENING · − WEAKENING'));
    assert.ok(html.includes('whitespace-nowrap">BASE \\ QUOTE</th>'));
    assert.ok(html.includes('170.50')); // EUR/JPY derived cross rate
    assert.ok(html.includes('Federal Reserve'));
    assert.ok(html.includes('European Central Bank'));
    assert.ok(html.includes('Bank of England'));
    assert.ok(html.includes('Bank of Japan'));
    assert.ok(html.includes('Reserve Bank of Australia'));
    assert.ok(html.includes('Bank of Canada'));
    assert.ok(html.includes('Unavailable')); // Next meeting honestly marked unavailable
  });

  it('handles FRED_API_KEY missing state gracefully while preserving BIS central bank section', () => {
    const payload: FxIntelligencePayload = {
      success: false,
      requiresKey: true,
      error: 'FRED_API_KEY is not configured.',
      fetchedAt: null,
      currencies: [],
      pairHistories: [],
      usdIndex: null,
      centralBanks: [
        deriveCentralBankPolicySummary(
          [{ date: '2026-11-17', value: 3.875 }],
          CENTRAL_BANK_DIRECTORY[0],
          'BIS WS_CBPOL',
          'D.US'
        ),
      ],
      centralBanksFetchedAt: '2026-11-17T16:00:00.000Z',
      centralBanksSource: 'BIS WS_CBPOL',
    };

    const html = renderToStaticMarkup(
      React.createElement(CurrenciesScreen, {
        currencies: [],
        initialIntelligence: payload,
        disableAutoFetch: true,
      })
    );

    assert.ok(html.includes('FRED_API_KEY Required'));
    assert.ok(html.includes('3.875%'));
    assert.ok(html.includes('BIS WS_CBPOL'));
  });
});

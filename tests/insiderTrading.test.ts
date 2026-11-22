import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  classifyInsiderTransaction,
  formatInsiderPrice,
  formatInsiderShares,
  formatInsiderValue,
  mergeInsiderTransactionsWithFilings,
  sanitizeSecSourceUrl,
} from '../src/utils/insiderTrading';
import { InsiderTradingPanel } from '../src/components/InsiderTradingPanel';
import type { InsiderTradingResponse } from '../src/types';

describe('Insider Trading Utilities', () => {
  it('classifies documented SEC Form 4 transaction codes without guessing unknown codes', () => {
    assert.deepEqual(classifyInsiderTransaction('P', 'A'), {
      code: 'P',
      label: 'Purchase',
      category: 'purchase',
    });
    assert.deepEqual(classifyInsiderTransaction('S', 'D'), {
      code: 'S',
      label: 'Sale',
      category: 'sale',
    });
    assert.deepEqual(classifyInsiderTransaction('A', 'A'), {
      code: 'A',
      label: 'Grant / Award',
      category: 'grant',
    });
    assert.deepEqual(classifyInsiderTransaction('M', 'A'), {
      code: 'M',
      label: 'Option Exercise',
      category: 'exercise',
    });
    assert.deepEqual(classifyInsiderTransaction('F', 'D'), {
      code: 'F',
      label: 'Tax Withholding',
      category: 'tax',
    });
    assert.deepEqual(classifyInsiderTransaction('G', 'D'), {
      code: 'G',
      label: 'Gift',
      category: 'gift',
    });
    assert.deepEqual(classifyInsiderTransaction('Q', null), {
      code: 'Q',
      label: 'Code Q',
      category: 'other',
    });
  });

  it('sanitizes API-provided SEC source_url values and rejects unsafe schemes', () => {
    const valid =
      'https://www.sec.gov/Archives/edgar/data/320193/000112760224031337/0001127602-24-031337-index.htm';
    assert.equal(sanitizeSecSourceUrl(valid), valid);
    assert.equal(sanitizeSecSourceUrl('javascript:alert(1)'), null);
    assert.equal(sanitizeSecSourceUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(sanitizeSecSourceUrl(''), null);
    assert.equal(sanitizeSecSourceUrl(null), null);
  });

  it('joins /v1/insiders/transactions rows with /v1/insiders filings by filing_id and sorts newest first', () => {
    const filings = [
      {
        filing_id: '0000320193_0001127602-24-031337',
        form_type: '4',
        period_of_report: '2024-03-15',
        accepted_time: '2024-03-17T16:30:00',
        filer_name: 'Cook Timothy D.',
        issuer_name: 'Apple Inc.',
        accession_num: '0001127602-24-031337',
        source_url:
          'https://www.sec.gov/Archives/edgar/data/320193/000112760224031337/0001127602-24-031337-index.htm',
      },
      {
        filing_id: '0000320193_0001127602-24-039999',
        form_type: '4',
        period_of_report: '2024-05-02',
        accepted_time: '2024-05-03T18:05:00',
        filer_name: 'Maestri Luca',
        issuer_name: 'Apple Inc.',
        accession_num: '0001127602-24-039999',
        source_url:
          'https://www.sec.gov/Archives/edgar/data/320193/000112760224039999/0001127602-24-039999-index.htm',
      },
    ];

    const transactions = [
      {
        transaction_kind: 'nonderiv',
        filing_id: '0000320193_0001127602-24-031337',
        record_index: 0,
        security_title: 'Common Stock',
        transaction_date: '2024-03-15',
        transaction_code: 'S',
        transaction_acquired_disposed_code: 'D',
        transaction_shares: '12000',
        transaction_price_per_share: '172.50',
        transaction_total_value: '2070000.00',
        filer_name: 'Cook Timothy D.',
      },
      {
        transaction_kind: 'nonderiv',
        filing_id: '0000320193_0001127602-24-039999',
        record_index: 0,
        security_title: 'Common Stock',
        transaction_date: '2024-05-02',
        transaction_code: 'P',
        transaction_acquired_disposed_code: 'A',
        transaction_shares: '5000',
        transaction_price_per_share: '180.00',
        transaction_total_value: '900000.00',
        filer_name: 'Maestri Luca',
      },
    ];

    const merged = mergeInsiderTransactionsWithFilings(transactions, filings);
    assert.equal(merged.dataMode, 'transactions');
    assert.equal(merged.issuerName, 'Apple Inc.');
    assert.equal(merged.records.length, 2);
    // Newest transaction date first
    assert.equal(merged.records[0].insiderName, 'Maestri Luca');
    assert.equal(merged.records[0].transactionCategory, 'purchase');
    assert.equal(merged.records[0].formType, '4');
    assert.equal(
      merged.records[0].sourceUrl,
      'https://www.sec.gov/Archives/edgar/data/320193/000112760224039999/0001127602-24-039999-index.htm'
    );
    assert.equal(merged.records[1].insiderName, 'Cook Timothy D.');
    assert.equal(merged.records[1].transactionCategory, 'sale');
    assert.equal(formatInsiderShares(merged.records[1].shares), '12,000');
    assert.equal(formatInsiderPrice(merged.records[1].price), '$172.50');
    assert.equal(formatInsiderValue(merged.records[1].totalValue), '$2.07M');
  });

  it('deduplicates dual-CIK EDGAR copies sharing the same accession number and record_index', () => {
    const filings = [
      {
        filing_id: '1780525_0001140361-26-044952',
        form_type: '4',
        accepted_time: '2026-11-18T18:30:00',
        accession_num: '0001140361-26-044952',
        source_url: 'https://www.sec.gov/Archives/edgar/data/1780525/000114036126044952/0001140361-26-044952-index.htm',
      },
    ];
    const transactions = [
      {
        filing_id: '1780525_0001140361-26-044952',
        record_index: 0,
        transaction_date: '2026-11-17',
        transaction_code: 'S',
        transaction_shares: '2398',
        transaction_price_per_share: '352.77',
        filer_name: 'Newstead Jennifer',
      },
      {
        filing_id: '320193_0001140361-26-044952',
        record_index: 0,
        transaction_date: '2026-11-17',
        transaction_code: 'S',
        transaction_shares: '2398',
        transaction_price_per_share: '352.77',
        filer_name: 'Newstead Jennifer',
      },
      {
        filing_id: '1780525_0001140361-26-044952',
        record_index: 1,
        transaction_date: '2026-11-17',
        transaction_code: 'G',
        transaction_shares: '500',
        transaction_price_per_share: '0',
        filer_name: 'Newstead Jennifer',
      },
    ];
    const merged = mergeInsiderTransactionsWithFilings(transactions, filings);
    assert.equal(merged.records.length, 2);
    assert.equal(merged.records[0].recordIndex, 0);
    assert.equal(merged.records[1].recordIndex, 1);
  });

  it('falls back cleanly to filing-summary records when no transaction rows are present', () => {
    const merged = mergeInsiderTransactionsWithFilings([], [
      {
        filing_id: '0001750001_0001750001-24-009912',
        form_type: '3',
        period_of_report: '2024-03-15',
        accepted_time: '2024-03-17T16:30:00',
        filer_name: 'Jane Doe',
        issuer_name: 'Nova Robotics Inc.',
        accession_num: '0001750001-24-009912',
        source_url:
          'https://www.sec.gov/Archives/edgar/data/1750001/000175000124009912/0001750001-24-009912-index.htm',
      },
    ]);
    assert.equal(merged.dataMode, 'filings');
    assert.equal(merged.records.length, 1);
    assert.equal(merged.records[0].transactionLabel, 'Form 3 Filing');
    assert.equal(merged.records[0].shares, null);
  });
});

describe('InsiderTradingPanel SSR States', () => {
  it('renders populated insider trading table with clickable SEC source_url links opening in new tab', () => {
    const payload: InsiderTradingResponse = {
      success: true,
      provider: '3spread',
      ticker: 'AAPL',
      issuerName: 'Apple Inc.',
      limit: 20,
      offset: 0,
      hasMore: true,
      windowStart: '2024-11-22',
      windowEnd: '2026-11-22',
      dataMode: 'transactions',
      fetchedAt: '2026-11-22T12:00:00.000Z',
      records: [
        {
          id: 'f1:0',
          filingId: 'f1',
          recordIndex: 0,
          date: '2026-10-02',
          filingDate: '2026-10-03',
          insiderName: 'Cook Timothy D.',
          transactionCode: 'S',
          transactionLabel: 'Sale',
          transactionCategory: 'sale',
          acquiredDisposed: 'D',
          securityTitle: 'Common Stock',
          shares: 12000,
          price: 172.5,
          totalValue: 2070000,
          sharesFollowing: 248500,
          directOrIndirect: 'D',
          formType: '4',
          accessionNum: '0001127602-26-031337',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/320193/000112760226031337/0001127602-26-031337-index.htm',
          isAmendment: false,
        },
        {
          id: 'f2:0',
          filingId: 'f2',
          recordIndex: 0,
          date: '2026-09-15',
          filingDate: '2026-09-16',
          insiderName: 'Arthur D. Levinson',
          transactionCode: 'P',
          transactionLabel: 'Purchase',
          transactionCategory: 'purchase',
          acquiredDisposed: 'A',
          securityTitle: 'Common Stock',
          shares: 5000,
          price: 180,
          totalValue: 900000,
          sharesFollowing: 4500000,
          directOrIndirect: 'D',
          formType: '4',
          accessionNum: '0001127602-26-021111',
          sourceUrl: null,
          isAmendment: false,
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(InsiderTradingPanel, {
        ticker: 'AAPL',
        initialResponse: payload,
        disableAutoFetch: true,
      })
    );

    assert.ok(html.includes('INSIDER TRADING'));
    assert.ok(html.includes('Cook Timothy D.'));
    assert.ok(html.includes('Arthur D. Levinson'));
    assert.ok(html.includes('$2.07M'));
    assert.ok(html.includes('target="_blank"'));
    assert.ok(html.includes('rel="noopener noreferrer"'));
    assert.ok(
      html.includes(
        'https://www.sec.gov/Archives/edgar/data/320193/000112760226031337/0001127602-26-031337-index.htm'
      )
    );
    assert.ok(html.includes('NEXT'));
  });

  it('renders exact empty-state message when ticker has no insider trading records', () => {
    const emptyPayload: InsiderTradingResponse = {
      success: true,
      provider: '3spread',
      ticker: 'BTC',
      issuerName: null,
      records: [],
      limit: 20,
      offset: 0,
      hasMore: false,
      windowStart: '2024-11-22',
      windowEnd: '2026-11-22',
      dataMode: 'transactions',
      fetchedAt: '2026-11-22T12:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      React.createElement(InsiderTradingPanel, {
        ticker: 'BTC',
        initialResponse: emptyPayload,
        disableAutoFetch: true,
      })
    );
    assert.ok(html.includes('No insider trading records available for this ticker.'));
  });

  it('renders loading, missing-key, and API error states cleanly without leaking secrets', () => {
    const loadingHtml = renderToStaticMarkup(
      React.createElement(InsiderTradingPanel, {
        ticker: 'NVDA',
        initialLoading: true,
        disableAutoFetch: true,
      })
    );
    assert.ok(loadingHtml.includes('RETRIEVING INSIDER TRADING RECORDS FOR NVDA'));

    const missingKeyHtml = renderToStaticMarkup(
      React.createElement(InsiderTradingPanel, {
        ticker: 'NVDA',
        initialResponse: {
          success: false,
          provider: '3spread',
          requiresKey: true,
          ticker: 'NVDA',
          issuerName: null,
          records: [],
          limit: 20,
          offset: 0,
          hasMore: false,
          windowStart: null,
          windowEnd: null,
          dataMode: 'transactions',
          fetchedAt: null,
          error: 'THREESPREAD_API_KEY required',
        },
        disableAutoFetch: true,
      })
    );
    assert.ok(missingKeyHtml.includes('3spread API Configuration Required'));
    assert.ok(missingKeyHtml.includes('THREESPREAD_API_KEY'));

    const errorHtml = renderToStaticMarkup(
      React.createElement(InsiderTradingPanel, {
        ticker: 'NVDA',
        initialResponse: {
          success: false,
          provider: '3spread',
          ticker: 'NVDA',
          issuerName: null,
          records: [],
          limit: 20,
          offset: 0,
          hasMore: false,
          windowStart: null,
          windowEnd: null,
          dataMode: 'transactions',
          fetchedAt: null,
          error: '3spread API rate limit reached. Please wait a moment and retry.',
        },
        disableAutoFetch: true,
      })
    );
    assert.ok(errorHtml.includes('3spread API rate limit reached'));
  });

  it('never displays stale records from a previously selected ticker', () => {
    const aaplPayload: InsiderTradingResponse = {
      success: true,
      provider: '3spread',
      ticker: 'AAPL',
      issuerName: 'Apple Inc.',
      records: [
        {
          id: 'f1:0',
          filingId: 'f1',
          recordIndex: 0,
          date: '2026-10-02',
          filingDate: '2026-10-03',
          insiderName: 'Cook Timothy D.',
          transactionCode: 'S',
          transactionLabel: 'Sale',
          transactionCategory: 'sale',
          acquiredDisposed: 'D',
          securityTitle: 'Common Stock',
          shares: 12000,
          price: 172.5,
          totalValue: 2070000,
          sharesFollowing: 248500,
          directOrIndirect: 'D',
          formType: '4',
          accessionNum: '0001127602-26-031337',
          sourceUrl: null,
          isAmendment: false,
        },
      ],
      limit: 20,
      offset: 0,
      hasMore: false,
      windowStart: '2024-11-22',
      windowEnd: '2026-11-22',
      dataMode: 'transactions',
      fetchedAt: '2026-11-22T12:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      React.createElement(InsiderTradingPanel, {
        ticker: 'MSFT',
        initialResponse: aaplPayload,
        disableAutoFetch: true,
      })
    );
    assert.ok(!html.includes('Cook Timothy D.'));
    assert.ok(html.includes('No insider trading records available for this ticker.'));
  });
});

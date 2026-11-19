import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKED_TICKERS_STORAGE_KEY,
  buildStockDataFromQuote,
  findValidYahooSearchEquity,
  isValidQuotePayload,
  isValidYahooChartMeta,
  loadPersistedTrackedTickers,
  resolveEquitySearch,
  savePersistedTrackedTickers,
  type StorageLike,
} from '../src/utils/equityValidation.ts';
import type { StockData } from '../src/types.ts';

const TAPE_SYMBOLS = ['SPX', 'DJI', 'IXIC', 'GC', 'CL', 'TNX', 'BTC'];
const DEFAULT_TRACKED = ['NVDA', 'TSLA', 'MSFT'];

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & { store: Record<string, string> } {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
  };
}

/**
 * Simulates the App.tsx tracked-equities state + persistence workflow around `resolveEquitySearch`.
 */
function createTrackedEquitiesHarness(
  fetchImpl: typeof fetch,
  storage = createMemoryStorage({
    [TRACKED_TICKERS_STORAGE_KEY]: JSON.stringify(DEFAULT_TRACKED),
  })
) {
  let trackedTickers = loadPersistedTrackedTickers(storage, DEFAULT_TRACKED, TAPE_SYMBOLS);
  let stocks: Record<string, StockData> = {};
  let selectedTicker = trackedTickers[0] || 'AAPL';

  const persist = () => savePersistedTrackedTickers(storage, trackedTickers);

  const searchAndAdd = async (ticker: string) => {
    const sym = ticker.toUpperCase().trim();
    const res = await resolveEquitySearch(sym, fetchImpl, stocks[sym]);
    if (!res.accepted || !res.stock) {
      return res;
    }
    stocks = {
      ...stocks,
      [res.symbol]: buildStockDataFromQuote(res.stock, stocks[res.symbol]),
    };
    if (!TAPE_SYMBOLS.includes(res.symbol) && !trackedTickers.includes(res.symbol)) {
      trackedTickers = [...trackedTickers, res.symbol];
      persist();
    }
    selectedTicker = res.symbol;
    return res;
  };

  const simulateRefresh = () => {
    return loadPersistedTrackedTickers(storage, DEFAULT_TRACKED, TAPE_SYMBOLS);
  };

  return {
    searchAndAdd,
    simulateRefresh,
    getTrackedTickers: () => trackedTickers,
    getStocks: () => stocks,
    getSelectedTicker: () => selectedTicker,
    getStorage: () => storage,
  };
}

function mockJsonFetch(
  handler: (url: string) => { status?: number; body: unknown }
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const { status = 200, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

test('search provider metadata validator rejects TAKE, YHOO, and empty/placeholder results', () => {
  // Real Yahoo Search for TAKE suggests TTWO and TAK, not TAKE
  assert.equal(
    findValidYahooSearchEquity(
      [
        { symbol: 'TTWO', quoteType: 'EQUITY', exchange: 'NMS', shortname: 'Take-Two Interactive', isYahooFinance: true },
        { symbol: 'TAK', quoteType: 'EQUITY', exchange: 'NYQ', shortname: 'Takeda Pharmaceutical', isYahooFinance: true },
      ],
      'TAKE'
    ),
    null
  );

  // Real Yahoo Search for YHOO suggests YHOO.L (LSE ETP), not YHOO
  assert.equal(
    findValidYahooSearchEquity(
      [
        { symbol: 'YHOO.L', quoteType: 'ETF', exchange: 'LSE', shortname: 'Leverage Shares ETP', isYahooFinance: true },
      ],
      'YHOO'
    ),
    null
  );

  // Empty search results
  assert.equal(findValidYahooSearchEquity([], 'NONEXISTENT'), null);

  // Empty/unusable placeholder item lacking security metadata
  assert.equal(
    findValidYahooSearchEquity([{ symbol: 'TAKE' }], 'TAKE'),
    null
  );
  assert.equal(
    findValidYahooSearchEquity(
      [{ symbol: 'TAKE', quoteType: 'EQUITY', shortname: 'Fake', isYahooFinance: false }],
      'TAKE'
    ),
    null
  );

  // Empty chart meta placeholder
  assert.equal(isValidYahooChartMeta({}), false);
  assert.equal(isValidYahooChartMeta({ symbol: 'TAKE' }), false);
});

test('search provider metadata validator accepts AAPL and valid securities missing price or volume', () => {
  const aaplMatch = findValidYahooSearchEquity(
    [
      { symbol: 'AAPL', quoteType: 'EQUITY', exchange: 'NMS', shortname: 'Apple Inc.', isYahooFinance: true },
    ],
    'AAPL'
  );
  assert.ok(aaplMatch);
  assert.equal(aaplMatch.symbol, 'AAPL');

  // Valid chart metadata with missing/null price and missing/null volume
  assert.equal(
    isValidYahooChartMeta({
      symbol: 'HALT',
      instrumentType: 'EQUITY',
      exchangeName: 'NMS',
      shortName: 'Halted Biotech Inc.',
      regularMarketPrice: null,
      regularMarketVolume: null,
    }),
    true
  );

  // Valid quote payload without price or volume
  assert.equal(
    isValidQuotePayload(
      {
        success: true,
        quote: {
          symbol: 'NOPRC',
          name: 'Valid Equity Holdings Inc.',
          exchange: 'NASDAQ',
          instrumentType: 'EQUITY',
          price: 0,
          volume: 0,
          isValidSecurity: true,
        },
      },
      'NOPRC'
    ),
    true
  );

  // Placeholder quote payload with zero metadata & zero price must be rejected
  assert.equal(
    isValidQuotePayload(
      {
        success: true,
        quote: {
          symbol: 'TAKE',
          name: 'TAKE',
          exchange: '',
          price: 0,
          volume: 0,
        },
      },
      'TAKE'
    ),
    false
  );
});

test('search for TAKE is rejected and not added to tracked state or localStorage', async () => {
  const harness = createTrackedEquitiesHarness(
    mockJsonFetch(() => ({
      body: {
        success: false,
        isInvalidTicker: true,
        error: 'No valid equity or security found for ticker "TAKE".',
      },
    }))
  );

  const res = await harness.searchAndAdd('TAKE');
  assert.equal(res.accepted, false);
  assert.deepEqual(harness.getTrackedTickers(), DEFAULT_TRACKED);
  assert.equal(harness.getTrackedTickers().includes('TAKE'), false);
  assert.equal(harness.getStocks().TAKE, undefined);
  assert.equal(
    JSON.parse(harness.getStorage().store[TRACKED_TICKERS_STORAGE_KEY]).includes('TAKE'),
    false
  );
});

test('search for YHOO is rejected and not added to tracked state or localStorage', async () => {
  const harness = createTrackedEquitiesHarness(
    mockJsonFetch(() => ({
      body: {
        success: false,
        isInvalidTicker: true,
        error: 'No valid equity or security found for ticker "YHOO".',
      },
    }))
  );

  const res = await harness.searchAndAdd('YHOO');
  assert.equal(res.accepted, false);
  assert.deepEqual(harness.getTrackedTickers(), DEFAULT_TRACKED);
  assert.equal(harness.getTrackedTickers().includes('YHOO'), false);
  assert.equal(
    JSON.parse(harness.getStorage().store[TRACKED_TICKERS_STORAGE_KEY]).includes('YHOO'),
    false
  );
});

test('search for a nonexistent ticker or unusable placeholder is not added', async () => {
  const harness = createTrackedEquitiesHarness(
    mockJsonFetch(() => ({
      body: {
        success: true,
        quote: {
          symbol: 'ZZZZ',
          name: 'ZZZZ Corp.',
          exchange: '',
          price: 0,
          volume: 0,
        },
      },
    }))
  );

  const res = await harness.searchAndAdd('ZZZZ');
  assert.equal(res.accepted, false);
  assert.deepEqual(harness.getTrackedTickers(), DEFAULT_TRACKED);
});

test('search for AAPL adds valid equity to tracked state and storage', async () => {
  const harness = createTrackedEquitiesHarness(
    mockJsonFetch(() => ({
      body: {
        success: true,
        quote: {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          exchange: 'NASDAQ',
          instrumentType: 'EQUITY',
          price: 231.45,
          change: 2.15,
          changePercent: 0.94,
          open: 229.5,
          high: 232.1,
          low: 228.9,
          prevClose: 229.3,
          volume: 44120000,
          isValidSecurity: true,
        },
      },
    }))
  );

  const res = await harness.searchAndAdd('AAPL');
  assert.equal(res.accepted, true);
  assert.deepEqual(harness.getTrackedTickers(), [...DEFAULT_TRACKED, 'AAPL']);
  assert.equal(harness.getStocks().AAPL.price, 231.45);
  assert.equal(harness.getSelectedTicker(), 'AAPL');
  assert.deepEqual(
    JSON.parse(harness.getStorage().store[TRACKED_TICKERS_STORAGE_KEY]),
    [...DEFAULT_TRACKED, 'AAPL']
  );
});

test('valid equity with missing price can still be added', async () => {
  const harness = createTrackedEquitiesHarness(
    mockJsonFetch(() => ({
      body: {
        success: true,
        quote: {
          symbol: 'BRKA',
          name: 'Example Industrials Inc.',
          exchange: 'NYSE',
          instrumentType: 'EQUITY',
          price: null,
          change: null,
          changePercent: null,
          volume: 15200,
          isValidSecurity: true,
          quoteUnavailable: true,
        },
      },
    }))
  );

  const res = await harness.searchAndAdd('BRKA');
  assert.equal(res.accepted, true);
  assert.ok(harness.getTrackedTickers().includes('BRKA'));
  assert.equal(harness.getStocks().BRKA.name, 'Example Industrials Inc.');
  assert.equal(harness.getStocks().BRKA.price, 0);
  assert.equal(harness.getStocks().BRKA.volume, 15200);
});

test('valid equity with missing volume can still be added', async () => {
  const harness = createTrackedEquitiesHarness(
    mockJsonFetch(() => ({
      body: {
        success: true,
        quote: {
          symbol: 'SEB',
          name: 'Seaboard Corporation',
          exchange: 'NYSE AMERICAN',
          instrumentType: 'EQUITY',
          price: 2450.0,
          change: 12.5,
          changePercent: 0.51,
          volume: null,
          isValidSecurity: true,
        },
      },
    }))
  );

  const res = await harness.searchAndAdd('SEB');
  assert.equal(res.accepted, true);
  assert.ok(harness.getTrackedTickers().includes('SEB'));
  assert.equal(harness.getStocks().SEB.price, 2450.0);
  assert.equal(harness.getStocks().SEB.volume, 0);
});

test('invalid search followed by valid search excludes invalid query and adds valid ticker; refresh keeps invalid ticker excluded', async () => {
  const harness = createTrackedEquitiesHarness(
    mockJsonFetch((url) => {
      if (url.includes('symbol=TAKE')) {
        return {
          body: {
            success: false,
            isInvalidTicker: true,
            error: 'No valid equity or security found for ticker "TAKE".',
          },
        };
      }
      return {
        body: {
          success: true,
          quote: {
            symbol: 'AAPL',
            name: 'Apple Inc.',
            exchange: 'NASDAQ',
            instrumentType: 'EQUITY',
            price: 230.0,
            volume: 30000000,
            isValidSecurity: true,
          },
        },
      };
    })
  );

  const invalidRes = await harness.searchAndAdd('TAKE');
  assert.equal(invalidRes.accepted, false);

  const validRes = await harness.searchAndAdd('AAPL');
  assert.equal(validRes.accepted, true);

  assert.deepEqual(harness.getTrackedTickers(), [...DEFAULT_TRACKED, 'AAPL']);
  assert.equal(harness.getTrackedTickers().includes('TAKE'), false);

  // Simulate full app reload from persisted storage
  const reloadedTickers = harness.simulateRefresh();
  assert.deepEqual(reloadedTickers, [...DEFAULT_TRACKED, 'AAPL']);
  assert.equal(reloadedTickers.includes('TAKE'), false);
});

test('browser Window.fetch strict receiver binding prevents Illegal invocation regression', async () => {
  async function strictWindowFetch(this: unknown, input: RequestInfo | URL) {
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    const url = String(input);
    assert.match(url, /\/api\/alpha-vantage\/quote\?symbol=PLTR&force=true$/);
    return new Response(
      JSON.stringify({
        success: true,
        quote: {
          symbol: 'PLTR',
          name: 'Palantir Technologies Inc.',
          exchange: 'NASDAQ',
          instrumentType: 'EQUITY',
          price: '156.67',
          volume: 14770291,
          isValidSecurity: true,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Simulate calling resolveEquitySearch with detached fetchFn (exact pattern that failed in Chrome)
  const resWithFn = await resolveEquitySearch('PLTR', strictWindowFetch as typeof fetch);
  assert.equal(resWithFn.accepted, true);
  assert.equal(resWithFn.symbol, 'PLTR');
  assert.equal(resWithFn.stock?.price, 156.67);

  // Also test default globalThis.fetch path when fetchFn is omitted
  const origFetch = globalThis.fetch;
  globalThis.fetch = strictWindowFetch as typeof fetch;
  try {
    const resDefault = await resolveEquitySearch('PLTR');
    assert.equal(resDefault.accepted, true);
    assert.equal(resDefault.symbol, 'PLTR');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('accepts class shares, crypto pairs, and international tickers like BRK.B, BTC-USD, and 0700.HK', () => {
  assert.equal(
    isValidQuotePayload(
      {
        success: true,
        quote: {
          symbol: 'BRK-B',
          name: 'Berkshire Hathaway Inc.',
          exchange: 'NYSE',
          instrumentType: 'EQUITY',
          price: 574.62,
          volume: 5406581,
          isValidSecurity: true,
        },
      },
      'BRK.B'
    ),
    true
  );

  assert.equal(
    isValidQuotePayload(
      {
        success: true,
        quote: {
          symbol: 'BTC-USD',
          name: 'Bitcoin USD',
          exchange: 'CRYPTO',
          instrumentType: 'CRYPTOCURRENCY',
          price: 63411.44,
          volume: 31438972928,
          isValidSecurity: true,
        },
      },
      'BTC-USD'
    ),
    true
  );

  assert.equal(
    isValidQuotePayload(
      {
        success: true,
        quote: {
          symbol: '0700.HK',
          name: 'Tencent Holdings Limited',
          exchange: 'HKG',
          instrumentType: 'EQUITY',
          price: 347.4,
          volume: 12000000,
          isValidSecurity: true,
        },
      },
      '0700.HK'
    ),
    true
  );
});

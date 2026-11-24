import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_POLYMARKET_TICKERS,
  MAX_POLYMARKET_TICKERS,
  POLYMARKET_TICKERS_STORAGE_KEY,
  addPolymarketTicker,
  loadPolymarketTickers,
  normalizePolymarketTicker,
  removePolymarketTicker,
  sanitizePolymarketTickerList,
  savePolymarketTickers,
} from '../src/utils/polymarketTickers';
import PolymarketScreen from '../src/components/PolymarketScreen';
import { INITIAL_STOCKS } from '../src/data';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

test('default Polymarket ticker list matches specification and excludes WULF', () => {
  assert.deepEqual(DEFAULT_POLYMARKET_TICKERS, [
    'AAPL',
    'NVDA',
    'TSLA',
    'MSFT',
    'GOOG',
    'AMZN',
    'META',
  ]);
  assert.ok(!DEFAULT_POLYMARKET_TICKERS.includes('WULF'));

  const freshStorage = createMemoryStorage();
  const loaded = loadPolymarketTickers(freshStorage);
  assert.deepEqual(loaded, ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'GOOG', 'AMZN', 'META']);
  assert.ok(!loaded.includes('WULF'));
});

test('addPolymarketTicker trims whitespace, normalizes to uppercase, prevents empties and duplicates', () => {
  assert.equal(normalizePolymarketTicker('  pltr  '), 'PLTR');

  const added = addPolymarketTicker([...DEFAULT_POLYMARKET_TICKERS], '  amd  ');
  assert.equal(added.error, null);
  assert.equal(added.added, 'AMD');
  assert.deepEqual(added.tickers, [
    'AAPL',
    'NVDA',
    'TSLA',
    'MSFT',
    'GOOG',
    'AMZN',
    'META',
    'AMD',
  ]);

  // Empty / whitespace-only rejected
  const emptyRes = addPolymarketTicker(added.tickers, '   ');
  assert.ok(emptyRes.error);
  assert.deepEqual(emptyRes.tickers, added.tickers);

  // Duplicate rejected regardless of casing or whitespace
  const dupRes = addPolymarketTicker(added.tickers, '  nvda ');
  assert.ok(dupRes.error);
  assert.match(dupRes.error!, /already in the list/i);
  assert.deepEqual(dupRes.tickers, added.tickers);
});

test('removePolymarketTicker removes an existing ticker without mutating original array', () => {
  const initial = [...DEFAULT_POLYMARKET_TICKERS];
  const updated = removePolymarketTicker(initial, 'tsla');
  assert.deepEqual(updated, ['AAPL', 'NVDA', 'MSFT', 'GOOG', 'AMZN', 'META']);
  // Original untouched (supports canceling edits cleanly)
  assert.deepEqual(initial, [...DEFAULT_POLYMARKET_TICKERS]);
});

test('10-ticker maximum is strictly enforced on add and sanitization', () => {
  let list = [...DEFAULT_POLYMARKET_TICKERS]; // 7
  for (const sym of ['AMD', 'PLTR', 'NFLX']) {
    const res = addPolymarketTicker(list, sym);
    assert.equal(res.error, null);
    list = res.tickers;
  }
  assert.equal(list.length, MAX_POLYMARKET_TICKERS);

  // Attempting to add an 11th ticker fails cleanly
  const eleventh = addPolymarketTicker(list, 'COIN');
  assert.ok(eleventh.error);
  assert.match(eleventh.error!, /Maximum of 10 tickers reached/i);
  assert.equal(eleventh.tickers.length, 10);
  assert.ok(!eleventh.tickers.includes('COIN'));

  // Sanitization also caps at 10
  const oversized = sanitizePolymarketTickerList([
    'aapl', 'nvda', 'tsla', 'msft', 'goog', 'amzn', 'meta', 'amd', 'pltr', 'nflx', 'coin', 'spy',
  ]);
  assert.equal(oversized.length, 10);
  assert.ok(!oversized.includes('COIN'));
});

test('localStorage persistence retains customized lists across refreshes and ignores corrupted data', () => {
  const storage = createMemoryStorage();
  const custom = ['NVDA', 'AMD', 'PLTR', 'COIN'];

  const saved = savePolymarketTickers(storage, custom);
  assert.deepEqual(saved, custom);
  assert.equal(storage.getItem(POLYMARKET_TICKERS_STORAGE_KEY), JSON.stringify(custom));

  // Simulated page reload reads persisted custom list
  const reloaded = loadPolymarketTickers(storage);
  assert.deepEqual(reloaded, custom);

  // Corrupted storage falls back gracefully to default list (without WULF)
  storage.setItem(POLYMARKET_TICKERS_STORAGE_KEY, '{broken json');
  assert.deepEqual(loadPolymarketTickers(storage), [...DEFAULT_POLYMARKET_TICKERS]);
});

test('PolymarketScreen renders default ticker filter without WULF, keeps compact edit button, and hides editor inputs by default', () => {
  // Even when stocks prop contains WULF (from INITIAL_STOCKS), default ticker filter must exclude WULF
  assert.ok('WULF' in INITIAL_STOCKS);

  const html = renderToStaticMarkup(
    React.createElement(PolymarketScreen, { stocks: INITIAL_STOCKS }),
  );

  assert.ok(html.includes('TICKER FILTER:'));
  assert.ok(html.includes('Edit ticker filter list'));
  for (const sym of DEFAULT_POLYMARKET_TICKERS) {
    assert.ok(html.includes(`>${sym}<`), `Expected default ticker ${sym} to render`);
  }
  assert.ok(!html.includes('>WULF<'), 'WULF must not appear in default TICKER FILTER');
  // Editor input is not permanently rendered in the ticker row
  assert.ok(!html.includes('Add ticker symbol'));
});

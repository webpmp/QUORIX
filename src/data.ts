import { StockData } from './types';

function createInitialStock(symbol: string, name: string, exchange = 'US'): StockData {
  return {
    symbol,
    name,
    exchange,
    price: 0,
    change: 0,
    changePercent: 0,
    high: 0,
    low: 0,
    open: 0,
    prevClose: 0,
    volume: 0,
    marketCap: '—',
    peRatio: 0,
    beta: 0,
    history: []
  };
}

// Tracked equities & index tape symbols populated via live market quotes on startup
export const INITIAL_STOCKS: Record<string, StockData> = {
  AAPL: createInitialStock('AAPL', 'Apple Inc.', 'NASDAQ'),
  NVDA: createInitialStock('NVDA', 'NVIDIA Corporation', 'NASDAQ'),
  TSLA: createInitialStock('TSLA', 'Tesla, Inc.', 'NASDAQ'),
  MSFT: createInitialStock('MSFT', 'Microsoft Corporation', 'NASDAQ'),
  GOOG: createInitialStock('GOOG', 'Alphabet Inc.', 'NASDAQ'),
  AMZN: createInitialStock('AMZN', 'Amazon.com, Inc.', 'NASDAQ'),
  META: createInitialStock('META', 'Meta Platforms, Inc.', 'NASDAQ'),
  WULF: createInitialStock('WULF', 'TeraWulf Inc.', 'NASDAQ'),
  SPX: createInitialStock('SPX', 'S&P 500 Index', 'S&P INDEX'),
  DJI: createInitialStock('DJI', 'Dow Jones Industrial', 'DOW JONES'),
  IXIC: createInitialStock('IXIC', 'Nasdaq Composite', 'NASDAQ'),
  GC: createInitialStock('GC', 'Gold Spot (oz)', 'COMEX'),
  CL: createInitialStock('CL', 'Crude Oil', 'NYMEX'),
  TNX: createInitialStock('TNX', 'US 10Y Treasury Yield', 'US TREASURY'),
  BTC: createInitialStock('BTC', 'Bitcoin USD', 'CRYPTO')
};

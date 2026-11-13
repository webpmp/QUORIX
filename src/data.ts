import { StockData } from './types';

function createInitialStock(symbol: string, name: string): StockData {
  return {
    symbol,
    name,
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
  AAPL: createInitialStock('AAPL', 'Apple Inc.'),
  NVDA: createInitialStock('NVDA', 'NVIDIA Corp.'),
  TSLA: createInitialStock('TSLA', 'Tesla Inc.'),
  MSFT: createInitialStock('MSFT', 'Microsoft Corp.'),
  GOOG: createInitialStock('GOOG', 'Alphabet Inc.'),
  AMZN: createInitialStock('AMZN', 'Amazon.com Inc.'),
  META: createInitialStock('META', 'Meta Platforms Inc.'),
  WULF: createInitialStock('WULF', 'TeraWulf Inc.'),
  SPX: createInitialStock('SPX', 'S&P 500 Index'),
  DJI: createInitialStock('DJI', 'Dow Jones Industrial'),
  IXIC: createInitialStock('IXIC', 'Nasdaq Composite'),
  GC: createInitialStock('GC', 'Gold Spot (oz)'),
  CL: createInitialStock('CL', 'Crude Oil'),
  TNX: createInitialStock('TNX', 'US 10Y Treasury Yield'),
  BTC: createInitialStock('BTC', 'Bitcoin')
};

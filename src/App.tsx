import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import TickerTape from './components/TickerTape';
import CommandPanel from './components/CommandPanel';
import Workspace from './components/Workspace';
import NewsTicker from './components/NewsTicker';
import { INITIAL_STOCKS } from './data';
import {
  StockData,
  CurrencyPair,
  EconomicIndicator,
  FredMacroMetric,
  FredReleaseDate,
} from './types';

export interface FredFeedStatus {
  loading: boolean;
  error: string | null;
  requiresKey: boolean;
  fetchedAt: string | null;
}

const TAPE_SYMBOLS = ['SPX', 'DJI', 'IXIC', 'GC', 'CL', 'TNX', 'BTC'];
const DEFAULT_TRACKED_TICKERS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'GOOG', 'AMZN', 'META', 'WULF'];
const TRACKED_TICKERS_STORAGE_KEY = 'quorix_tracked_equities_v1';

export default function App() {
  const [trackedTickers, setTrackedTickers] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(TRACKED_TICKERS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            .map((t) => t.toUpperCase().trim())
            .filter((t) => !TAPE_SYMBOLS.includes(t));
        }
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_TRACKED_TICKERS;
  });
  const [stocks, setStocks] = useState<Record<string, StockData>>(() => {
    const initial = { ...INITIAL_STOCKS };
    try {
      const saved = localStorage.getItem(TRACKED_TICKERS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          for (const raw of parsed) {
            const sym = typeof raw === 'string' ? raw.toUpperCase().trim() : '';
            if (sym && !initial[sym]) {
              initial[sym] = {
                symbol: sym,
                name: sym,
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
                history: [],
              };
            }
          }
        }
      }
    } catch {
      // ignore storage errors
    }
    return initial;
  });
  const [currencies, setCurrencies] = useState<CurrencyPair[]>([]);
  const [economics, setEconomics] = useState<EconomicIndicator[]>([]);
  const [fredMacroMetrics, setFredMacroMetrics] = useState<FredMacroMetric[]>([]);
  const [fredReleases, setFredReleases] = useState<FredReleaseDate[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string>('AAPL');
  const [activeScreen, setActiveScreen] = useState<string>('GP');

  const [fredEconomicsStatus, setFredEconomicsStatus] = useState<FredFeedStatus>({
    loading: false,
    error: null,
    requiresKey: false,
    fetchedAt: null,
  });

  const [fredCurrenciesStatus, setFredCurrenciesStatus] = useState<FredFeedStatus>({
    loading: false,
    error: null,
    requiresKey: false,
    fetchedAt: null,
  });

  // Custom global command input state
  const [currentCommand, setCurrentCommand] = useState<string>('');
  const [pendingAiQuery, setPendingAiQuery] = useState<{ id: number; text: string } | null>(null);
  const [focusAskQuorixSignal, setFocusAskQuorixSignal] = useState<number>(0);
  const [tickTime, setTickTime] = useState<string>('');

  const fetchLiveQuote = useCallback(async (ticker: string, isBatch = false, force = false) => {
    try {
      const response = await fetch(
        `/api/alpha-vantage/quote?symbol=${encodeURIComponent(ticker)}${force ? '&force=true' : ''}`
      );
      const data = await response.json();
      if (data.success && data.quote) {
        const q = data.quote;
        setStocks((prev) => {
          const existing = prev[q.symbol];
          const prevPrice = existing?.price || 0;
          const nextHistory =
            Array.isArray(q.history) && q.history.length > 0
              ? q.history
              : existing?.history || [];

          const direction =
            prevPrice > 0 && q.price !== prevPrice
              ? q.price > prevPrice
                ? 'up'
                : 'down'
              : undefined;

          return {
            ...prev,
            [q.symbol]: {
              symbol: q.symbol,
              name: q.name || existing?.name || q.symbol,
              exchange: q.exchange || existing?.exchange,
              price: q.price,
              change: q.change,
              changePercent: q.changePercent,
              open: q.open,
              high: q.high,
              low: q.low,
              prevClose: q.prevClose,
              volume: q.volume,
              marketCap: existing?.marketCap || '—',
              peRatio: existing?.peRatio || 0,
              beta: existing?.beta || 0,
              history: nextHistory,
              isRealTime: true,
              isPreMarket: q.isPreMarket,
              isAfterHours: q.isAfterHours,
              preMarketPrice: q.preMarketPrice,
              afterHoursPrice: q.afterHoursPrice,
              isCoreHours: q.isCoreHours,
              lastTickTime: direction ? Date.now() : existing?.lastTickTime,
              lastTickDirection: direction || existing?.lastTickDirection,
            },
          };
        });
      }
    } catch (err) {
      if (!isBatch) {
        console.error(`Failed to fetch quote for ${ticker}:`, err);
      }
    }
  }, []);

  const fetchFredEconomics = useCallback(async (force = false) => {
    setFredEconomicsStatus((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`/api/fred/economics${force ? '?force=true' : ''}`);
      const data = await res.json();
      if (data.success) {
        setEconomics(Array.isArray(data.indicators) ? data.indicators : []);
        setFredMacroMetrics(Array.isArray(data.macroMetrics) ? data.macroMetrics : []);
        setFredReleases(Array.isArray(data.releases) ? data.releases : []);
        setFredEconomicsStatus({
          loading: false,
          error: null,
          requiresKey: false,
          fetchedAt: data.fetchedAt || new Date().toISOString(),
        });
      } else {
        setFredEconomicsStatus({
          loading: false,
          error: data.error || 'Failed to load FRED economic data.',
          requiresKey: Boolean(data.requiresKey),
          fetchedAt: null,
        });
      }
    } catch (err: any) {
      setFredEconomicsStatus({
        loading: false,
        error: err.message || 'Network error loading FRED economic data.',
        requiresKey: false,
        fetchedAt: null,
      });
    }
  }, []);

  const fetchFredCurrencies = useCallback(async (force = false) => {
    setFredCurrenciesStatus((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`/api/fred/currencies${force ? '?force=true' : ''}`);
      const data = await res.json();
      if (data.success) {
        setCurrencies(Array.isArray(data.currencies) ? data.currencies : []);
        setFredCurrenciesStatus({
          loading: false,
          error: null,
          requiresKey: false,
          fetchedAt: data.fetchedAt || new Date().toISOString(),
        });
      } else {
        setFredCurrenciesStatus({
          loading: false,
          error: data.error || 'Failed to load FRED FX rates.',
          requiresKey: Boolean(data.requiresKey),
          fetchedAt: null,
        });
      }
    } catch (err: any) {
      setFredCurrenciesStatus({
        loading: false,
        error: err.message || 'Network error loading FRED FX rates.',
        requiresKey: false,
        fetchedAt: null,
      });
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(TRACKED_TICKERS_STORAGE_KEY, JSON.stringify(trackedTickers));
    } catch {
      // ignore storage errors
    }
  }, [trackedTickers]);

  // Fetch initial live quotes and FRED macro/FX data on mount
  useEffect(() => {
    const allTickers = Array.from(new Set([...trackedTickers, ...TAPE_SYMBOLS]));
    Promise.allSettled(allTickers.map((ticker) => fetchLiveQuote(ticker, true, false)));
    fetchFredEconomics(false);
    fetchFredCurrencies(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchLiveQuote, fetchFredEconomics, fetchFredCurrencies]);

  // Poll live market quotes every 60 seconds
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      const tracked = Array.from(new Set([selectedTicker, ...trackedTickers, ...TAPE_SYMBOLS]));
      Promise.allSettled(tracked.map((ticker) => fetchLiveQuote(ticker, true, true)));
    }, 60000);

    return () => clearInterval(refreshInterval);
  }, [selectedTicker, trackedTickers, fetchLiveQuote]);

  const ensureTickerSlot = (ticker: string, addToTracked = false) => {
    const sym = ticker.toUpperCase().trim();
    if (addToTracked && !TAPE_SYMBOLS.includes(sym)) {
      setTrackedTickers((prev) => (prev.includes(sym) ? prev : [...prev, sym]));
    }
    setStocks((prev) => {
      if (prev[sym]) return prev;
      return {
        ...prev,
        [sym]: {
          symbol: sym,
          name: sym,
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
          history: [],
        },
      };
    });
  };

  const handleReorderTicker = (fromIndex: number, toIndex: number) => {
    setTrackedTickers((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleRemoveTicker = (ticker: string) => {
    const sym = ticker.toUpperCase().trim();
    setTrackedTickers((prev) => prev.filter((t) => t !== sym));
  };

  const handleResetTrackedTickers = () => {
    setTrackedTickers(DEFAULT_TRACKED_TICKERS);
    DEFAULT_TRACKED_TICKERS.forEach((sym) => fetchLiveQuote(sym, true, false));
  };

  // Submit terminal CLI input parser
  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCommand.trim()) return;

    const commandStr = currentCommand.toUpperCase().trim();
    const rawCommand = currentCommand.trim();
    setCurrentCommand('');

    const parts = commandStr.split(/\s+/);
    const primary = parts[0];
    const secondary = parts.length > 1 ? parts[1] : null;

    const directScreens = ['GP', 'HP', 'DES', 'ANR', 'NEWS', 'CRNC', 'ECO', 'POLY', 'BWRITE', 'HELP', 'HLP', 'SETT', 'SETTINGS'];

    if (directScreens.includes(primary) && !secondary) {
      if (primary === 'SETTINGS' || primary === 'SETT') {
        setActiveScreen('SETT');
      } else if (primary === 'HLP') {
        setActiveScreen('HELP');
      } else {
        setActiveScreen(primary);
      }
      return;
    }

    const isTickerPattern = /^[A-Z]{1,5}$/.test(primary);
    const isSecondaryTickerPattern = secondary ? /^[A-Z]{1,5}$/.test(secondary) : false;

    if (secondary && (stocks[secondary] || isSecondaryTickerPattern) && directScreens.includes(primary)) {
      const ticker = secondary.toUpperCase();
      ensureTickerSlot(ticker, true);
      setSelectedTicker(ticker);
      setActiveScreen(primary);
      fetchLiveQuote(ticker, false, true);
      return;
    }

    if (parts.length <= 2 && isTickerPattern && !directScreens.includes(primary)) {
      const ticker = primary;
      ensureTickerSlot(ticker, true);
      setSelectedTicker(ticker);

      if (secondary && directScreens.includes(secondary)) {
        setActiveScreen(secondary);
      } else if (!secondary) {
        setActiveScreen('GP');
      }
      fetchLiveQuote(ticker, false, true);
      return;
    }

    setActiveScreen('BWRITE');
    setPendingAiQuery({ id: Date.now(), text: rawCommand });
  };

  const handleSelectScreen = (screenCode: string) => {
    setActiveScreen(screenCode);
    if (screenCode === 'BWRITE') {
      setFocusAskQuorixSignal((n) => n + 1);
    }
  };

  const handleSelectTicker = (ticker: string) => {
    ensureTickerSlot(ticker, false);
    setSelectedTicker(ticker);
    fetchLiveQuote(ticker, false, true);
    if (!['GP', 'HP', 'DES', 'ANR', 'NEWS'].includes(activeScreen)) {
      setActiveScreen('GP');
    }
  };

  return (
    <div className="terminal-crt h-screen max-h-screen overflow-hidden bg-[#010101] text-zinc-200 font-mono flex flex-col antialiased">
      {/* Dynamic index tape scrolling */}
      <TickerTape
        stocks={stocks}
        onSelectTicker={(ticker) => {
          handleSelectTicker(ticker);
          setActiveScreen('GP');
        }}
      />

      {/* Retro Header bar with dynamic input bar */}
      <Header
        currentCommand={currentCommand}
        onCommandChange={setCurrentCommand}
        onCommandSubmit={handleCommandSubmit}
        activeScreen={activeScreen}
        tickTime={tickTime}
      />

      {/* Main dashboard space structure */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden border-t border-[#333]">
        {/* Left Hand selection console for stocks and shortcuts */}
        <CommandPanel
          stocks={stocks}
          trackedTickers={trackedTickers}
          selectedTicker={selectedTicker}
          onSelectTicker={handleSelectTicker}
          onReorderTicker={handleReorderTicker}
          onRemoveTicker={handleRemoveTicker}
          onResetTrackedTickers={handleResetTrackedTickers}
          activeScreen={activeScreen}
          onSelectScreen={handleSelectScreen}
        />

        {/* Central view active workspace */}
        <Workspace
          activeScreen={activeScreen}
          selectedTicker={selectedTicker}
          stocks={stocks}
          currencies={currencies}
          economics={economics}
          fredMacroMetrics={fredMacroMetrics}
          fredReleases={fredReleases}
          fredEconomicsStatus={fredEconomicsStatus}
          fredCurrenciesStatus={fredCurrenciesStatus}
          onRefreshEconomics={() => fetchFredEconomics(true)}
          onRefreshCurrencies={() => fetchFredCurrencies(true)}
          onExecuteCommand={(cmd) => {
            setCurrentCommand(cmd);
          }}
          onSelectTicker={(ticker) => {
            handleSelectTicker(ticker);
            setActiveScreen('GP');
          }}
          pendingAiQuery={pendingAiQuery}
          onClearPendingAiQuery={() => setPendingAiQuery(null)}
          focusAskQuorixSignal={focusAskQuorixSignal}
          onTickTimeChange={setTickTime}
        />
      </div>

      {/* Scrolling News Headline Ticker */}
      <NewsTicker />

      {/* Bottom status boundary line */}
      <footer className="bg-black text-[10px] text-zinc-500 border-t border-[#333] px-3 py-1.5 flex justify-center items-center select-none font-mono">
        <span>Quorix © 2026 Chris Adkins</span>
      </footer>
    </div>
  );
}


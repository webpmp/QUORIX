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

export default function App() {
  const [stocks, setStocks] = useState<Record<string, StockData>>(INITIAL_STOCKS);
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

  // Fetch initial live quotes and FRED macro/FX data on mount
  useEffect(() => {
    const allTickers = Object.keys(INITIAL_STOCKS);
    Promise.allSettled(allTickers.map((ticker) => fetchLiveQuote(ticker, true, false)));
    fetchFredEconomics(false);
    fetchFredCurrencies(false);
  }, [fetchLiveQuote, fetchFredEconomics, fetchFredCurrencies]);

  // Poll live market quotes every 60 seconds
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      const tracked = Array.from(new Set([selectedTicker, ...Object.keys(INITIAL_STOCKS)]));
      Promise.allSettled(tracked.map((ticker) => fetchLiveQuote(ticker, true, true)));
    }, 60000);

    return () => clearInterval(refreshInterval);
  }, [selectedTicker, fetchLiveQuote]);

  const ensureTickerSlot = (ticker: string) => {
    setStocks((prev) => {
      if (prev[ticker]) return prev;
      return {
        ...prev,
        [ticker]: {
          symbol: ticker,
          name: ticker,
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
      ensureTickerSlot(ticker);
      setSelectedTicker(ticker);
      setActiveScreen(primary);
      fetchLiveQuote(ticker, false, true);
      return;
    }

    if (parts.length <= 2 && isTickerPattern && !directScreens.includes(primary)) {
      const ticker = primary;
      ensureTickerSlot(ticker);
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
    ensureTickerSlot(ticker);
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
      />

      {/* Main dashboard space structure */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden border-t border-[#333]">
        {/* Left Hand selection console for stocks and shortcuts */}
        <CommandPanel
          stocks={stocks}
          selectedTicker={selectedTicker}
          onSelectTicker={handleSelectTicker}
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
        />
      </div>

      {/* Scrolling News Headline Ticker */}
      <NewsTicker />

      {/* Bottom status boundary line */}
      <footer className="bg-black text-[9px] text-zinc-600 border-t border-[#333] px-3 py-1.5 flex flex-col sm:flex-row justify-between items-center select-none font-mono">
        <div>
          CONSOLE TERMINAL CODES: AAPL GP - DRAW GRAPH | POLY - POLYMARKET SCREENER | ECO - ECONOMIC CALENDAR | NEWS - CENTRAL FEED
        </div>
        <div className="mt-1 sm:mt-0 text-[10px] text-zinc-500 font-semibold uppercase">
          SEC-PROT: 256B ENCRYPTED COUPLING ● ON
        </div>
      </footer>
    </div>
  );
}


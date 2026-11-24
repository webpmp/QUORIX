import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import {
  buildStockDataFromQuote,
  isValidQuotePayload,
  loadPersistedTrackedTickers,
  normalizeTickerSymbol,
  resolveEquitySearch,
  savePersistedTrackedTickers,
} from './utils/equityValidation';
import { parseCommandLineInput } from './utils/commandParser';

export interface FredFeedStatus {
  loading: boolean;
  error: string | null;
  requiresKey: boolean;
  fetchedAt: string | null;
}

const TAPE_SYMBOLS = ['SPX', 'DJI', 'IXIC', 'GC', 'CL', 'TNX', 'BTC'];
const DEFAULT_TRACKED_TICKERS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'GOOG', 'AMZN', 'META', 'WULF'];

export default function App() {
  const [trackedTickers, setTrackedTickers] = useState<string[]>(() =>
    loadPersistedTrackedTickers(
      typeof window !== 'undefined' ? window.localStorage : null,
      DEFAULT_TRACKED_TICKERS,
      TAPE_SYMBOLS
    )
  );
  const [stocks, setStocks] = useState<Record<string, StockData>>(() => {
    const initial = { ...INITIAL_STOCKS };
    const persisted = loadPersistedTrackedTickers(
      typeof window !== 'undefined' ? window.localStorage : null,
      DEFAULT_TRACKED_TICKERS,
      TAPE_SYMBOLS
    );
    for (const sym of persisted) {
      if (!initial[sym]) {
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
  const [askPrefillPrompt, setAskPrefillPrompt] = useState<{ id: number; text: string } | null>(null);
  const [corrSeedTicker, setCorrSeedTicker] = useState<{ id: number; symbol: string } | null>(null);
  const [focusAskQuorixSignal, setFocusAskQuorixSignal] = useState<number>(0);
  const [tickTime, setTickTime] = useState<string>('');
  const [commandError, setCommandError] = useState<string | null>(null);
  const activeValidationTokenRef = useRef<number>(0);
  const [quoteLoadState, setQuoteLoadState] = useState<
    Record<string, 'loading' | 'ready' | 'unavailable' | 'invalid'>
  >({});

  const fetchLiveQuote = useCallback(async (ticker: string, isBatch = false, force = false) => {
    const sym = normalizeTickerSymbol(ticker);
    if (!sym) return;
    try {
      const response = await fetch(
        `/api/alpha-vantage/quote?symbol=${encodeURIComponent(sym)}${force ? '&force=true' : ''}`
      );
      const data = await response.json();
      if (isValidQuotePayload(data, sym)) {
        const q = data.quote;
        const resolvedSym = normalizeTickerSymbol(q.symbol) || sym;
        setStocks((prev) => ({
          ...prev,
          [resolvedSym]: buildStockDataFromQuote(q, prev[resolvedSym]),
        }));
        setQuoteLoadState((prev) => ({
          ...prev,
          [sym]: 'ready',
          [resolvedSym]: 'ready',
        }));
      } else if (data?.isInvalidTicker === true && !TAPE_SYMBOLS.includes(sym)) {
        // Remove stale persisted invalid tickers without affecting valid equities during transient outages
        setTrackedTickers((prev) => (prev.includes(sym) ? prev.filter((t) => t !== sym) : prev));
        setQuoteLoadState((prev) => ({ ...prev, [sym]: 'invalid' }));
      } else {
        setQuoteLoadState((prev) => (prev[sym] === 'loading' ? { ...prev, [sym]: 'unavailable' } : prev));
      }
    } catch (err) {
      if (!isBatch) {
        console.error(`Failed to fetch quote for ${sym}:`, err);
      }
      setQuoteLoadState((prev) => (prev[sym] === 'loading' ? { ...prev, [sym]: 'unavailable' } : prev));
    }
  }, []);

  const searchAndAddTrackedEquity = useCallback(async (ticker: string) => {
    const sym = normalizeTickerSymbol(ticker);
    if (!sym) return;

    setQuoteLoadState((prev) => (prev[sym] === 'ready' ? prev : { ...prev, [sym]: 'loading' }));

    const resolution = await resolveEquitySearch(sym);
    if (!resolution.accepted || !resolution.stock) {
      setQuoteLoadState((prev) => ({
        ...prev,
        [sym]: resolution.isInvalidTicker ? 'invalid' : 'unavailable',
      }));
      return resolution;
    }

    const resolvedStock = resolution.stock;
    const resolvedSym = resolvedStock.symbol;

    setStocks((prev) => ({
      ...prev,
      [resolvedSym]: buildStockDataFromQuote(
        resolution.quote || resolvedStock,
        prev[resolvedSym]
      ),
    }));

    setQuoteLoadState((prev) => ({
      ...prev,
      [sym]: 'ready',
      [resolvedSym]: 'ready',
    }));

    if (!TAPE_SYMBOLS.includes(resolvedSym)) {
      setTrackedTickers((prev) => (prev.includes(resolvedSym) ? prev : [...prev, resolvedSym]));
    }

    if (resolvedSym !== sym) {
      setSelectedTicker((prev) => (prev === sym ? resolvedSym : prev));
    }
    return resolution;
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
    savePersistedTrackedTickers(
      typeof window !== 'undefined' ? window.localStorage : null,
      trackedTickers
    );
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

    const rawCommand = currentCommand.trim();
    setCurrentCommand('');
    setCommandError(null);

    const parsed = parseCommandLineInput(rawCommand);
    const executionToken = ++activeValidationTokenRef.current;

    if (parsed.type === 'SCREEN') {
      setActiveScreen(parsed.screen);
      if (parsed.screen === 'ASK') {
        setFocusAskQuorixSignal((n) => n + 1);
      }
      return;
    }

    if (parsed.type === 'TICKER_SCREEN') {
      const ticker = parsed.ticker.toUpperCase();
      const targetScreen = parsed.screen;

      // If ticker is already validly tracked or in tape, navigate immediately
      if (trackedTickers.includes(ticker) || TAPE_SYMBOLS.includes(ticker) || stocks[ticker]) {
        setSelectedTicker(ticker);
        setActiveScreen(targetScreen);
        if (targetScreen === 'CORR') {
          setCorrSeedTicker({ id: Date.now(), symbol: ticker });
        }
        if (targetScreen === 'ASK') {
          setAskPrefillPrompt({ id: Date.now(), text: `Give me a brief analysis of ${ticker}` });
          setFocusAskQuorixSignal((n) => n + 1);
        }
        ensureTickerSlot(ticker, false);
        fetchLiveQuote(ticker, false, true);
        return;
      }

      // Untracked/unverified ticker: validate FIRST before changing screen or selected ticker
      void searchAndAddTrackedEquity(ticker).then((res) => {
        // Discard stale response if a newer command has already run
        if (executionToken !== activeValidationTokenRef.current) {
          return;
        }

        if (res?.accepted && res.stock) {
          const resolvedSym = res.stock.symbol || ticker;
          setSelectedTicker(resolvedSym);
          setActiveScreen(targetScreen);
          if (targetScreen === 'CORR') {
            setCorrSeedTicker({ id: Date.now(), symbol: resolvedSym });
          }
          if (targetScreen === 'ASK') {
            setAskPrefillPrompt({ id: Date.now(), text: `Give me a brief analysis of ${resolvedSym}` });
            setFocusAskQuorixSignal((n) => n + 1);
          }
        } else {
          // Validation failed: stay on current screen and selected ticker, show visible feedback
          setCommandError(`${ticker}: ticker not found`);
        }
      });
      return;
    }

    // Default: Conversational AI prompt
    setActiveScreen('ASK');
    setPendingAiQuery({ id: Date.now(), text: rawCommand });
  };

  const handleSelectScreen = (screenCode: string) => {
    setActiveScreen(screenCode);
    if (screenCode === 'ASK' || screenCode === 'BWRITE') {
      setFocusAskQuorixSignal((n) => n + 1);
    }
  };

  const handleSelectTicker = (ticker: string) => {
    const sym = normalizeTickerSymbol(ticker);
    if (!sym) return;
    if (!stocks[sym] && quoteLoadState[sym] !== 'loading') {
      setQuoteLoadState((prev) => ({ ...prev, [sym]: 'loading' }));
    } else if (stocks[sym]) {
      ensureTickerSlot(sym, false);
    }
    setSelectedTicker(sym);
    fetchLiveQuote(sym, false, true);
    if (!['GP', 'HP', 'DES', 'ANR', 'INST', 'NEWS'].includes(activeScreen)) {
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
        onCommandChange={(val) => {
          setCurrentCommand(val);
          if (commandError) {
            setCommandError(null);
          }
        }}
        onCommandSubmit={handleCommandSubmit}
        activeScreen={activeScreen}
        tickTime={tickTime}
        errorMessage={commandError}
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
          trackedTickers={trackedTickers}
          corrSeedTicker={corrSeedTicker}
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
          onSelectScreen={handleSelectScreen}
          onSelectTicker={(ticker) => {
            handleSelectTicker(ticker);
            setActiveScreen('GP');
          }}
          pendingAiQuery={pendingAiQuery}
          onClearPendingAiQuery={() => setPendingAiQuery(null)}
          askPrefillPrompt={askPrefillPrompt}
          onClearAskPrefillPrompt={() => setAskPrefillPrompt(null)}
          focusAskQuorixSignal={focusAskQuorixSignal}
          onTickTimeChange={setTickTime}
        />
      </div>

      {/* Scrolling News Headline Ticker */}
      <NewsTicker />

      {/* Bottom status boundary line */}
      <footer className="bg-black text-xs text-zinc-300 border-t border-[#333] px-3 py-1.5 flex justify-center items-center select-none font-mono">
        <span>QUORIX © 2026 Chris Adkins</span>
      </footer>
    </div>
  );
}


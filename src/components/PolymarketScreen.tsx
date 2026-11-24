import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  RefreshCw,
  Database,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  Pencil,
  X,
  Plus,
} from 'lucide-react';
import { PolymarketEvent, StockData } from '../types';
import {
  MAX_POLYMARKET_TICKERS,
  addPolymarketTicker,
  loadPolymarketTickers,
  removePolymarketTicker,
  savePolymarketTickers,
} from '../utils/polymarketTickers';
import {
  createLatestRequestGuard,
  filterPolymarketEventsByTicker,
  resolveTickerFromQuery,
  type LatestRequestGuard,
} from '../utils/polymarketFilter';

interface PolymarketScreenProps {
  stocks: Record<string, StockData>;
}

const POLYMARKET_DEPARTMENTS = [
  'Stocks',
  'Earnings',
  'Big Tech & AI',
  'IPOs & M&A',
  'Fed & Macro',
] as const;

function formatUsdVolume(vol?: number): string {
  if (!vol || vol <= 0) return '$0';
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
  return `$${Math.round(vol)}`;
}

function getSafeHttpUrl(raw?: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // not a valid URL
  }
  return null;
}

function formatSourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toUpperCase();
  } catch {
    return 'SOURCE';
  }
}

export default function PolymarketScreen({ stocks }: PolymarketScreenProps) {
  const [events, setEvents] = useState<PolymarketEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [resolvedCompanyName, setResolvedCompanyName] = useState<string | null>(null);
  const [resultStatus, setResultStatus] = useState<
    'idle' | 'ok' | 'no_matching_markets' | 'unrecognized_ticker' | 'provider_error'
  >('idle');
  const [selectedCategory, setSelectedCategory] = useState<string>('Stocks');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const requestGuardRef = useRef<LatestRequestGuard | null>(null);
  if (!requestGuardRef.current) {
    requestGuardRef.current = createLatestRequestGuard();
  }

  const [quickTickers, setQuickTickers] = useState<string[]>(() =>
    loadPolymarketTickers(typeof window !== 'undefined' ? window.localStorage : null),
  );
  const [isEditingTickers, setIsEditingTickers] = useState<boolean>(false);
  const [draftTickers, setDraftTickers] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState<string>('');
  const [tickerEditError, setTickerEditError] = useState<string | null>(null);
  const tickerInputRef = useRef<HTMLInputElement | null>(null);

  const isAtTickerLimit = draftTickers.length >= MAX_POLYMARKET_TICKERS;

  const openTickerEditor = () => {
    setDraftTickers([...quickTickers]);
    setTickerInput('');
    setTickerEditError(null);
    setIsEditingTickers(true);
  };

  const cancelTickerEditor = () => {
    setDraftTickers([]);
    setTickerInput('');
    setTickerEditError(null);
    setIsEditingTickers(false);
  };

  const handleAddDraftTicker = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const result = addPolymarketTicker(draftTickers, tickerInput);
    if (result.error) {
      setTickerEditError(result.error);
      return;
    }
    setDraftTickers(result.tickers);
    setTickerInput('');
    setTickerEditError(null);
  };

  const handleRemoveDraftTicker = (sym: string) => {
    setDraftTickers((prev) => removePolymarketTicker(prev, sym));
    setTickerEditError(null);
  };

  const handleSaveTickerEdits = () => {
    const persisted = savePolymarketTickers(
      typeof window !== 'undefined' ? window.localStorage : null,
      draftTickers,
    );
    setQuickTickers(persisted);
    setTickerInput('');
    setTickerEditError(null);
    setIsEditingTickers(false);
  };

  useEffect(() => {
    if (isEditingTickers && !isAtTickerLimit) {
      tickerInputRef.current?.focus();
    }
  }, [isEditingTickers, isAtTickerLimit]);

  // Fetch from the server-side API proxy with request sequencing + abort to prevent stale overwrites
  const fetchActivePolymarketEvents = async (
    searchStr = '',
    catStr = 'Stocks',
    tickerStr = '',
  ) => {
    const guard = requestGuardRef.current!;
    const { requestId, signal } = guard.next();

    setLoading(true);
    setError(null);
    setResultStatus('idle');
    setResolvedCompanyName(null);
    setEvents([]);
    setSelectedEventId('');
    try {
      const trimmedSearch = searchStr.trim();
      const effectiveTicker = resolveTickerFromQuery(tickerStr, trimmedSearch);
      const companyHint = effectiveTicker ? stocks?.[effectiveTicker]?.name : undefined;

      const params = new URLSearchParams({ limit: '30' });
      if (effectiveTicker) params.set('ticker', effectiveTicker);
      if (companyHint) params.set('companyName', companyHint);
      if (trimmedSearch) params.set('search', trimmedSearch);
      if (catStr) params.set('category', catStr);

      const res = await fetch(`/api/polymarket/events?${params.toString()}`, {
        signal,
      });
      if (!res.ok) {
        throw new Error(`Market data service returned HTTP ${res.status}`);
      }
      const data = await res.json();

      if (!guard.isCurrent(requestId)) {
        return;
      }

      if (data.status === 'unrecognized_ticker') {
        setEvents([]);
        setSelectedEventId('');
        setResolvedCompanyName(null);
        setResultStatus('unrecognized_ticker');
        setError(
          data.error ||
            `Ticker "${effectiveTicker || trimmedSearch}" is not recognized as a valid stock symbol.`,
        );
        return;
      }

      if (data.success && Array.isArray(data.data)) {
        const resolvedName =
          typeof data.resolvedCompanyName === 'string' && data.resolvedCompanyName.trim()
            ? data.resolvedCompanyName.trim()
            : companyHint || null;
        setResolvedCompanyName(resolvedName);

        const parsed: PolymarketEvent[] = data.data.map((item: any) => ({
          id: String(item.id || item.event_id || item.slug || item.title),
          title: item.title || item.name || 'Markets Event',
          category: item.category || 'Stocks',
          volume: typeof item.volume === 'number' ? item.volume : Number(item.volume || 0),
          slug: item.slug || '',
          resolutionSource: typeof item.resolutionSource === 'string' ? item.resolutionSource.trim() : '',
          tags: Array.isArray(item.tags) ? item.tags : undefined,
          markets: (item.markets || []).map((m: any) => ({
            id: String(m.id || m.question),
            question: m.question || m.title || 'Will event occur?',
            slug: typeof m.slug === 'string' ? m.slug : '',
            groupItemTitle: typeof m.groupItemTitle === 'string' ? m.groupItemTitle : undefined,
            resolutionSource: typeof m.resolutionSource === 'string' ? m.resolutionSource.trim() : '',
            outcomes:
              typeof m.outcomes === 'string'
                ? JSON.parse(m.outcomes)
                : m.outcomes || ['Yes', 'No'],
            outcomePrices:
              typeof m.outcomePrices === 'string'
                ? JSON.parse(m.outcomePrices)
                : m.outcomePrices || ['0.50', '0.50'],
            clobTokenIds:
              typeof m.clobTokenIds === 'string'
                ? JSON.parse(m.clobTokenIds)
                : m.clobTokenIds,
            active: m.active !== undefined ? m.active : true,
            closed: m.closed !== undefined ? m.closed : false,
          })),
        }));

        const finalEvents = effectiveTicker
          ? filterPolymarketEventsByTicker(parsed, effectiveTicker, {
              companyName: resolvedName || undefined,
            })
          : parsed;

        setEvents(finalEvents);
        setResultStatus(finalEvents.length > 0 ? 'ok' : 'no_matching_markets');
        if (finalEvents.length > 0) {
          setSelectedEventId(finalEvents[0].id);
        } else {
          setSelectedEventId('');
        }
        setLastUpdated(new Date().toLocaleTimeString());
      } else {
        setEvents([]);
        setSelectedEventId('');
        setResultStatus('provider_error');
        setError(data.error || 'Unable to retrieve live Polymarket market data.');
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || !guard.isCurrent(requestId)) {
        return;
      }
      console.error('Polymarket proxy fetch failure:', e);
      setEvents([]);
      setSelectedEventId('');
      setResultStatus('provider_error');
      setError(e.message || 'Unable to retrieve live Polymarket market data.');
    } finally {
      if (guard.isCurrent(requestId)) {
        setLoading(false);
      }
    }
  };

  // Initial load (defaults to individual stocks & equities)
  useEffect(() => {
    fetchActivePolymarketEvents('', 'Stocks', '');
    return () => {
      requestGuardRef.current?.abortAll();
    };
  }, []);

  const clobSubscriptionKey = useMemo(() => {
    const tokenIds: string[] = [];
    for (const ev of events) {
      for (const m of ev.markets) {
        if (m.clobTokenIds && m.clobTokenIds.length > 0) {
          tokenIds.push(m.clobTokenIds[0]);
        }
      }
    }
    return tokenIds.join(',');
  }, [events]);

  // Direct WebSocket to Polymarket CLOB for live trade updates
  useEffect(() => {
    if (!clobSubscriptionKey) return;
    const tokensToSubscribe = clobSubscriptionKey.split(',').filter(Boolean);
    if (tokensToSubscribe.length === 0) return;

    const wsUrl = 'wss://clob.polymarket.com/ws';
    let socket: WebSocket | null = null;

    try {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (tokensToSubscribe.length > 0 && socket) {
          socket.send(
            JSON.stringify({
              type: 'subscribe',
              assets_ids: tokensToSubscribe,
              channels: ['trades'],
            })
          );
        }
      };

      socket.onmessage = (msgEvent) => {
        try {
          const parsedData = JSON.parse(msgEvent.data);
          const assetId = parsedData.asset_id || parsedData.token_id;
          const price = parsedData.price;

          if (assetId && price) {
            const yesPriceVal = parseFloat(price);
            if (!isNaN(yesPriceVal)) {
              setEvents((prev) =>
                prev.map((ev) => ({
                  ...ev,
                  markets: ev.markets.map((m) => {
                    if (m.clobTokenIds && m.clobTokenIds[0] === assetId) {
                      return {
                        ...m,
                        outcomePrices: [yesPriceVal.toFixed(2), (1 - yesPriceVal).toFixed(2)],
                      };
                    }
                    return m;
                  }),
                }))
              );

              setLastUpdated(new Date().toLocaleTimeString());
            }
          }
        } catch {
          // ignore non-JSON or unrelated frames
        }
      };

    } catch {
      // ignore WebSocket initialization errors
    }

    return () => {
      if (socket) socket.close();
    };
  }, [clobSubscriptionKey]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchTerm.trim();
    const upper = trimmed.toUpperCase();
    const matchedTicker = quickTickers.includes(upper)
      ? upper
      : resolveTickerFromQuery('', trimmed);
    setSelectedTicker(matchedTicker);
    fetchActivePolymarketEvents(trimmed, selectedCategory, matchedTicker);
  };

  const handleCategorySwitch = (cat: string) => {
    setSelectedCategory(cat);
    setSelectedTicker('');
    setSearchTerm('');
    fetchActivePolymarketEvents('', cat, '');
  };

  const handleQuickTickerClick = (ticker: string) => {
    setSelectedTicker(ticker);
    setSearchTerm(ticker);
    fetchActivePolymarketEvents(ticker, selectedCategory, ticker);
  };

  const activeEvent = useMemo(() => {
    return events.find((ev) => ev.id === selectedEventId) || events[0] || null;
  }, [events, selectedEventId]);

  return (
    <div className="bg-[#050505] border border-[#333] rounded p-4 animate-fade-in shadow-xl select-text flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden">
      {/* 1. HEADER SECTION */}
      <div className="border-b border-[#333] pb-3 mb-3 flex flex-col md:flex-row justify-between items-start md:items-center select-none gap-2 shrink-0">
        <div>
          <span className="text-white text-md font-bold uppercase tracking-wider block">
            POLYMARKET SCREENER
          </span>
          <span className="text-xs text-zinc-300 block">
            LIVE INDIVIDUAL STOCK TARGETS, EARNINGS BEATS &amp; CORPORATE CATALYSTS
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-300 font-mono">
          <Database size={10} className="text-[#3498db] self-center align-middle shrink-0" />
          <span className="relative group/gamma-tip inline-flex items-center">
            <span
              tabIndex={0}
              aria-describedby="polymarket-gamma-tooltip"
              className="cursor-help hover:text-zinc-200 focus:text-zinc-200 focus:outline-none transition-colors"
            >
              GAMMA EQUITIES FEED
            </span>
            <div
              id="polymarket-gamma-tooltip"
              role="tooltip"
              className="hidden group-hover/gamma-tip:block group-focus-within/gamma-tip:block absolute left-0 md:left-auto md:right-0 top-full mt-2 w-[260px] md:w-[360px] max-w-[calc(100vw-2.5rem)] z-50 bg-[#0a0a0a] border border-[#444] rounded p-3 shadow-2xl shadow-black/95 normal-case tracking-normal font-mono font-normal text-xs leading-relaxed text-zinc-300 select-text text-left"
            >
              <div className="text-xs font-bold uppercase tracking-wider text-[#3498db] border-b border-[#3a3a3a] pb-1 mb-2">
                Gamma Equities Feed
              </div>
              <div className="space-y-1.5">
                <p>
                  Proxies <span className="text-zinc-100 font-bold">Polymarket&apos;s Gamma Markets API</span> to discover active, open prediction events filtered for stocks, earnings, tech, IPOs/M&amp;A, and macro catalysts.
                </p>
                <p>
                  Provides event titles, categories, USD volume, contract questions, initial outcome prices, CLOB token IDs, and resolution sources displayed in the markets list and strike breakdown.
                </p>
                <p>
                  <span className="text-zinc-100 font-bold">Cadence:</span> Retrieved on demand when loading this screen, switching Focus tabs, picking a ticker filter, searching, or clicking Reset.
                </p>
              </div>
            </div>
          </span>
          <span className="text-zinc-300 font-bold">|</span>
          <ShieldCheck size={10} className="text-[#00ff00] self-center align-middle shrink-0" />
          <span className="relative group/clob-tip inline-flex items-center">
            <span
              tabIndex={0}
              aria-describedby="polymarket-clob-tooltip"
              className="cursor-help hover:text-zinc-200 focus:text-zinc-200 focus:outline-none transition-colors"
            >
              CLOB LIVE ODDS
            </span>
            <div
              id="polymarket-clob-tooltip"
              role="tooltip"
              className="hidden group-hover/clob-tip:block group-focus-within/clob-tip:block absolute right-0 top-full mt-2 w-[250px] md:w-[360px] max-w-[calc(100vw-2.5rem)] z-50 bg-[#0a0a0a] border border-[#444] rounded p-3 shadow-2xl shadow-black/95 normal-case tracking-normal font-mono font-normal text-xs leading-relaxed text-zinc-300 select-text text-left"
            >
              <div className="text-xs font-bold uppercase tracking-wider text-[#00ff00] border-b border-[#3a3a3a] pb-1 mb-2">
                CLOB Live Odds (Central Limit Order Book)
              </div>
              <div className="space-y-1.5">
                <p>
                  Streams live trade updates from <span className="text-zinc-100 font-bold">Polymarket&apos;s Central Limit Order Book</span> WebSocket for the loaded contracts&apos; YES tokens, updating YES/NO prices in real time (retaining the latest Gamma snapshot if disconnected).
                </p>
                <p>
                  <span className="text-zinc-100 font-bold">How to read:</span> Figures represent actual Polymarket contract share prices ($0.00–$1.00) alongside implied market probabilities (e.g., $0.65 = 65% YES probability, with NO as 1 − YES).
                </p>
              </div>
            </div>
          </span>
        </div>
      </div>

      {/* 2. SEARCH, QUICK TICKERS & DEPARTMENT FILTERS */}
      <div className="space-y-2.5 mb-3 select-none shrink-0">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Search Input bar */}
          <form
            onSubmit={handleSearchSubmit}
            className="lg:col-span-5 flex items-center bg-black border border-[#333] focus-within:border-[#ff9900] rounded overflow-hidden p-1 transition-colors"
          >
            <Search size={12} className="text-zinc-300 mx-2 shrink-0" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search stocks or tickers (e.g. NVDA, AAPL, TSLA, earnings)..."
              className="flex-1 bg-transparent text-xs text-zinc-200 outline-none p-1 font-mono"
            />
            <button
              type="submit"
              className="px-2.5 py-1 bg-[#ff9900] hover:bg-amber-500 text-black text-xs uppercase font-extrabold rounded cursor-pointer transition-colors"
            >
              SEARCH
            </button>
          </form>

          {/* Categories toggler */}
          <div className="lg:col-span-7 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
            <span className="text-zinc-300 font-bold uppercase shrink-0">FOCUS:</span>
            {POLYMARKET_DEPARTMENTS.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => handleCategorySwitch(cat)}
                className={`px-2.5 py-1 rounded font-bold uppercase transition-all shrink-0 border cursor-pointer ${
                  selectedCategory === cat && !searchTerm && !selectedTicker
                    ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                    : 'bg-black border-[#3a3a3a] text-zinc-300 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                {cat}
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                setSelectedTicker('');
                setSearchTerm('');
                setSelectedCategory('Stocks');
                fetchActivePolymarketEvents('', 'Stocks', '');
              }}
              className="ml-auto px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors shrink-0 cursor-pointer"
            >
              <RefreshCw size={10} className={`inline mr-1 ${loading ? 'animate-spin' : ''}`} />
              RESET
            </button>
          </div>
        </div>

        {/* Quick Stock Filter Bar */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
            <div className="inline-flex items-center gap-1.5 mr-1">
              <span className="text-zinc-300 font-bold uppercase">TICKER FILTER:</span>
              <button
                type="button"
                onClick={() => (isEditingTickers ? cancelTickerEditor() : openTickerEditor())}
                aria-expanded={isEditingTickers}
                aria-label={isEditingTickers ? 'Close ticker filter editor' : 'Edit ticker filter list'}
                title={isEditingTickers ? 'Cancel editing ticker list' : 'Edit ticker filter list'}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-bold uppercase transition-colors cursor-pointer ${
                  isEditingTickers
                    ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8]'
                    : 'bg-transparent border-[#3a3a3a] text-zinc-400 hover:border-[#38bdf8] hover:text-[#38bdf8]'
                }`}
              >
                <Pencil size={10} />
                <span>EDIT</span>
              </button>
            </div>
            {quickTickers.map((sym) => {
              const isActiveTicker = selectedTicker === sym;
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => handleQuickTickerClick(sym)}
                  className={`px-2 py-0.5 rounded border font-bold transition-colors cursor-pointer ${
                    isActiveTicker
                      ? 'bg-[#3498db]/20 border-[#3498db] text-[#3498db]'
                      : 'bg-black border-[#3a3a3a] text-zinc-300 hover:border-[#3498db] hover:text-white'
                  }`}
                >
                  {sym}
                </button>
              );
            })}
            {quickTickers.length === 0 && !isEditingTickers && (
              <span className="text-zinc-400 text-xs">No saved tickers — click EDIT to add symbols.</span>
            )}
          </div>

          {isEditingTickers && (
            <div
              className="bg-[#0a0a0a] border border-[#3a3a3a] rounded p-2.5 space-y-2 text-xs font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  cancelTickerEditor();
                }
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[#38bdf8] font-bold uppercase tracking-wider">
                    EDIT TICKER LIST
                  </span>
                  <span
                    className={`tabular-nums font-bold ${
                      isAtTickerLimit ? 'text-[#ff9900]' : 'text-zinc-400'
                    }`}
                  >
                    ({draftTickers.length}/{MAX_POLYMARKET_TICKERS})
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={cancelTickerEditor}
                    className="px-2 py-0.5 rounded border border-[#3a3a3a] bg-black text-zinc-300 hover:text-white hover:border-zinc-400 font-bold uppercase transition-colors cursor-pointer"
                  >
                    CANCEL
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTickerEdits}
                    className="px-2.5 py-0.5 rounded border border-[#38bdf8] bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 text-[#38bdf8] font-bold uppercase transition-colors cursor-pointer"
                  >
                    SAVE
                  </button>
                </div>
              </div>

              {/* Editable ticker chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {draftTickers.length > 0 ? (
                  draftTickers.map((sym) => (
                    <span
                      key={sym}
                      className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded border border-[#38bdf8]/50 bg-black text-zinc-100 font-bold"
                    >
                      <span>{sym}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveDraftTicker(sym)}
                        aria-label={`Remove ${sym}`}
                        title={`Remove ${sym}`}
                        className="p-0.5 rounded text-zinc-400 hover:text-[#ff4444] transition-colors cursor-pointer"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-zinc-400">No tickers in list. Add symbols below or save empty.</span>
                )}
              </div>

              {/* Add ticker input + limit/error notice */}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <form onSubmit={handleAddDraftTicker} className="inline-flex items-center gap-1.5">
                  <input
                    ref={tickerInputRef}
                    type="text"
                    value={tickerInput}
                    onChange={(e) => {
                      setTickerInput(e.target.value.toUpperCase());
                      if (tickerEditError) setTickerEditError(null);
                    }}
                    disabled={isAtTickerLimit}
                    maxLength={12}
                    placeholder={isAtTickerLimit ? 'Limit reached (10 max)' : 'Add ticker (e.g. AMD)'}
                    aria-label="Add ticker symbol"
                    className="w-40 bg-black border border-[#3a3a3a] focus:border-[#38bdf8] disabled:opacity-50 disabled:cursor-not-allowed rounded px-2 py-0.5 text-xs text-zinc-100 placeholder:text-zinc-400 outline-none uppercase font-mono transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isAtTickerLimit || !tickerInput.trim()}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#38bdf8] bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 text-[#38bdf8] disabled:opacity-40 disabled:border-[#3a3a3a] disabled:bg-black disabled:text-zinc-400 disabled:cursor-not-allowed font-bold uppercase transition-colors cursor-pointer"
                  >
                    <Plus size={11} />
                    <span>ADD</span>
                  </button>
                </form>

                {isAtTickerLimit && (
                  <span className="text-[#ff9900] text-xs font-bold" role="status">
                    Maximum of {MAX_POLYMARKET_TICKERS} tickers reached. Remove a ticker to add another.
                  </span>
                )}
                {!isAtTickerLimit && tickerEditError && (
                  <span className="text-[#ff4444] text-xs font-bold" role="alert">
                    {tickerEditError}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. CORE SUBSTRUCTURE LAYOUT - TWO COLS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:flex-1 lg:min-h-0 lg:overflow-hidden">
        {/* LEFT COLUMN: EVENTS BROWSER LIST */}
        <div className="lg:col-span-5 border border-[#333] bg-black rounded flex flex-col min-h-[320px] lg:min-h-0 lg:h-full overflow-hidden">
          <div className="bg-[#0c0c0c] border-[#333] border-b p-2 flex justify-between items-center select-none shrink-0">
            <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
              {selectedTicker || searchTerm
                ? `QUERY "${(selectedTicker || searchTerm).toUpperCase()}" (${events.length})`
                : `${selectedCategory.toUpperCase()} MARKETS (${events.length})`}
            </span>
            {lastUpdated && <span className="text-zinc-300 text-xs tabular-nums">TICK: {lastUpdated}</span>}
          </div>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-2 text-zinc-300 text-xs py-10 font-mono">
              <RefreshCw className="animate-spin text-[#3498db]" size={18} />
              <span>LOADING STOCK PREDICTION MARKETS...</span>
            </div>
          ) : resultStatus === 'unrecognized_ticker' ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-[#ff9900] text-center text-xs py-10 gap-2 font-mono">
              <AlertCircle size={18} />
              <span>
                {error ||
                  `Ticker "${selectedTicker || searchTerm}" is not recognized as a valid stock symbol.`}
              </span>
              <span className="text-zinc-300">
                Verify the ticker symbol or click RESET to return to active markets.
              </span>
            </div>
          ) : error || resultStatus === 'provider_error' ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-[#ff4444] text-center text-xs py-10 gap-2 font-mono">
              <AlertCircle size={18} />
              <span>Unable to retrieve Polymarket market data: {error || 'Provider error.'}</span>
            </div>
          ) : events.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6 text-zinc-300 text-center text-xs py-10 font-mono">
              {selectedTicker
                ? `No active stock markets matched ${selectedTicker}${
                    resolvedCompanyName ? ` (${resolvedCompanyName})` : ''
                  }. Click RESET or try another ticker.`
                : `No active stock markets matched "${searchTerm || selectedCategory}". Click RESET or try another ticker.`}
            </div>
          ) : (
            <div className="divide-y divide-[#222] overflow-y-auto flex-1 min-h-0">
              {events.map((ev) => {
                const isSelected = selectedEventId === ev.id;
                const primaryYesProb = ev.markets[0]
                  ? Math.round(parseFloat(ev.markets[0].outcomePrices[0] || '0.50') * 100)
                  : 50;

                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => {
                      setSelectedEventId(ev.id);
                    }}
                    className={`w-full text-left p-2.5 transition-all block cursor-pointer border-l-2 border-t border-r border-b ${
                      isSelected
                        ? 'bg-[#1a1308] text-white border-[#ff9900]'
                        : 'hover:bg-[#070707] text-zinc-300 border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-baseline mb-1 gap-2">
                      <span className="text-zinc-300 font-bold text-xs uppercase tracking-wide truncate">
                        {ev.category || 'Stocks'} · VOL {formatUsdVolume(ev.volume)}
                      </span>
                      <span
                        className={`text-xs font-bold font-mono tabular-nums shrink-0 ${
                          primaryYesProb > 60
                            ? 'text-[#00ff00]'
                            : primaryYesProb < 40
                            ? 'text-[#ff4444]'
                            : 'text-[#ff9900]'
                        }`}
                      >
                        YES: {primaryYesProb}%
                      </span>
                    </div>
                    <span className="font-bold text-xs block text-zinc-100 line-clamp-1 truncate">
                      {ev.title}
                    </span>
                    <span className="text-xs text-zinc-300 line-clamp-1 mt-0.5 block truncate">
                      {ev.markets[0]?.question || 'N/A'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: IMPLIED PROBABILITIES DETAIL VIEW */}
        <div className="lg:col-span-7 flex flex-col bg-black border border-[#333] rounded min-h-[360px] lg:min-h-0 lg:h-full overflow-hidden">
          {activeEvent ? (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {/* Event Header Panel */}
              <div className="bg-[#0c0c0c] border-[#333] border-b p-2 select-none shrink-0 flex justify-between items-center gap-2">
                <span className="text-[#3498db] text-xs font-bold uppercase tracking-wider">
                  IMPLIED PROBABILITY &amp; STRIKE BREAKDOWN
                </span>
                {activeEvent.slug ? (
                  <a
                    href={`https://polymarket.com/event/${activeEvent.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-bold text-[#ff9900] hover:underline flex items-center gap-1"
                  >
                    <span>POLYMARKET</span>
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-zinc-300 text-xs font-mono">ID: {activeEvent.id}</span>
                )}
              </div>

              <div className="p-3 flex-1 min-h-0 overflow-y-auto space-y-4">
                {/* Event Summary Title */}
                <div>
                  <h3 className="text-white font-extrabold text-sm select-text block">
                    {activeEvent.title}
                  </h3>
                  <div className="text-xs text-zinc-300 mt-1 uppercase tracking-wide flex flex-wrap items-center gap-2">
                    <span className="text-[#ff9900] font-bold">
                      {activeEvent.category || 'Stocks'}
                    </span>
                    <span className="text-zinc-300">·</span>
                    <span className="tabular-nums">VOLUME: {formatUsdVolume(activeEvent.volume)}</span>
                    <span className="text-zinc-300">·</span>
                    <span className="tabular-nums">{activeEvent.markets.length} CONTRACTS</span>
                    {(() => {
                      const rawEventSource =
                        activeEvent.resolutionSource ||
                        activeEvent.markets.find((m) => m.resolutionSource)?.resolutionSource ||
                        '';
                      const eventSourceUrl = getSafeHttpUrl(rawEventSource);
                      if (eventSourceUrl) {
                        return (
                          <>
                            <span className="text-zinc-300">·</span>
                            <a
                              href={eventSourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#3498db] hover:text-[#00ff00] hover:underline inline-flex items-center gap-1 font-bold"
                              title={`Resolution source: ${eventSourceUrl}`}
                            >
                              <span>SOURCE: {formatSourceHost(eventSourceUrl)}</span>
                              <ExternalLink size={9} />
                            </a>
                          </>
                        );
                      }
                      if (rawEventSource) {
                        return (
                          <>
                            <span className="text-zinc-300">·</span>
                            <span className="text-zinc-300">SOURCE: {rawEventSource}</span>
                          </>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>

                {/* Markets details showing Outcome values & Live Probabilities */}
                <div className="space-y-3 border-t border-b border-[#3a3a3a] py-3.5">
                  <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider block select-none">
                    Contract Strikes &amp; Implied Probabilities (CLOB Prices)
                  </span>

                  {activeEvent.markets.map((market, idx) => {
                    const yesVal = parseFloat(market.outcomePrices[0] || '0.50');
                    const noVal = parseFloat(market.outcomePrices[1] || '0.50');
                    const yesPct = Math.round(yesVal * 100);
                    const noPct = Math.round(noVal * 100);
                    const contractUrl =
                      activeEvent.slug && market.slug && activeEvent.slug !== market.slug
                        ? `https://polymarket.com/event/${activeEvent.slug}/${market.slug}`
                        : activeEvent.slug
                        ? `https://polymarket.com/event/${activeEvent.slug}`
                        : market.slug
                        ? `https://polymarket.com/market/${market.slug}`
                        : '';
                    const marketResolutionUrl = getSafeHttpUrl(market.resolutionSource);

                    return (
                      <div key={market.id || idx} className="bg-[#050505] border border-[#3a3a3a] rounded p-2.5">
                        <div className="flex items-start gap-2 justify-between mb-2 select-text">
                          <span className="text-zinc-200 font-bold text-xs leading-snug">
                            {idx + 1}. {market.question}
                          </span>
                          {contractUrl && (
                            <a
                              href={contractUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-xs font-bold text-[#ff9900] hover:text-amber-400 hover:underline inline-flex items-center gap-1 select-none"
                              title="Open contract on Polymarket"
                            >
                              <span>POLYMARKET</span>
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </div>

                        {/* Implied Probabilities dual Dial bar display */}
                        <div className="space-y-1.5 select-none">
                          <div className="flex justify-between items-center text-xs font-mono tabular-nums">
                            <span className="text-[#00ff00] font-bold">
                              YES: ${yesVal.toFixed(2)} ({yesPct}%)
                            </span>
                            <span className="text-[#ff4444] font-bold">
                              NO: ${noVal.toFixed(2)} ({noPct}%)
                            </span>
                          </div>

                          <div className="h-2 w-full bg-zinc-900 rounded overflow-hidden flex">
                            <div
                              className="bg-emerald-500 hover:bg-emerald-400 transition-all h-full"
                              style={{ width: `${yesPct}%` }}
                              title={`YES Probability: ${yesPct}%`}
                            />
                            <div
                              className="bg-red-500 hover:bg-red-400 transition-all h-full"
                              style={{ width: `${noPct}%` }}
                              title={`NO Probability: ${noPct}%`}
                            />
                          </div>
                        </div>

                        {( (market.clobTokenIds && market.clobTokenIds.length > 0) || marketResolutionUrl || market.resolutionSource ) && (
                          <div className="mt-2 text-xs text-zinc-300 font-mono flex flex-wrap items-center justify-between gap-2">
                            {market.clobTokenIds && market.clobTokenIds.length > 0 && (
                              <div className="flex gap-3">
                                <span>YES_TOKEN: {market.clobTokenIds[0].slice(0, 10)}...</span>
                                <span>
                                  NO_TOKEN: {market.clobTokenIds[1] ? market.clobTokenIds[1].slice(0, 10) : 'N/A'}...
                                </span>
                              </div>
                            )}
                            {marketResolutionUrl ? (
                              <a
                                href={marketResolutionUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#3498db] hover:text-[#00ff00] hover:underline inline-flex items-center gap-1 ml-auto"
                                title={`Resolution source: ${marketResolutionUrl}`}
                              >
                                <span>SOURCE: {formatSourceHost(marketResolutionUrl)}</span>
                                <ExternalLink size={9} />
                              </a>
                            ) : market.resolutionSource ? (
                              <span className="text-zinc-300 ml-auto truncate max-w-[220px]" title={market.resolutionSource}>
                                SOURCE: {market.resolutionSource}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="m-auto text-zinc-300 text-xs py-10 font-mono text-center">
              Select a stock prediction market from the left column to inspect strike odds.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

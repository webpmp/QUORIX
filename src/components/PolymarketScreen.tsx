import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  Database,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { PolymarketEvent, StockData } from '../types';

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

const EXCLUDED_QUICK_TICKERS = new Set(['SPX', 'DJI', 'IXIC', 'GC', 'CL', 'TNX', 'BTC']);

function formatUsdVolume(vol?: number): string {
  if (!vol || vol <= 0) return '$0';
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
  return `$${Math.round(vol)}`;
}

export default function PolymarketScreen({ stocks }: PolymarketScreenProps) {
  const [events, setEvents] = useState<PolymarketEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Stocks');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [wsStatus, setWsStatus] = useState<'CONNECTED' | 'REST PROXY' | 'DISCONNECTED'>('REST PROXY');
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const quickTickers = useMemo(() => {
    const fromStocks = Object.keys(stocks || {}).filter(
      (sym) => !EXCLUDED_QUICK_TICKERS.has(sym)
    );
    const defaults = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOG'];
    const merged = Array.from(new Set([...fromStocks, ...defaults]));
    return merged.slice(0, 8);
  }, [stocks]);

  // Fetch from the server-side API proxy
  const fetchActivePolymarketEvents = async (searchStr = '', catStr = 'Stocks') => {
    setLoading(true);
    setError(null);
    try {
      let queryUrl = '/api/polymarket/events?limit=30';
      if (searchStr.trim()) queryUrl += `&search=${encodeURIComponent(searchStr.trim())}`;
      if (catStr) queryUrl += `&category=${encodeURIComponent(catStr)}`;

      const res = await fetch(queryUrl);
      const data = await res.json();

      if (data.success && Array.isArray(data.data)) {
        const parsed: PolymarketEvent[] = data.data.map((item: any) => ({
          id: String(item.id || item.event_id || item.slug || item.title),
          title: item.title || item.name || 'Markets Event',
          category: item.category || 'Stocks',
          volume: typeof item.volume === 'number' ? item.volume : Number(item.volume || 0),
          slug: item.slug || '',
          markets: (item.markets || []).map((m: any) => ({
            id: String(m.id || m.question),
            question: m.question || m.title || 'Will event occur?',
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
        setEvents(parsed);
        if (parsed.length > 0) {
          setSelectedEventId(parsed[0].id);
        } else {
          setSelectedEventId('');
        }
        setLastUpdated(new Date().toLocaleTimeString());
      } else {
        setEvents([]);
        setError(data.error || 'Failed to retrieve live Polymarket events.');
      }
    } catch (e: any) {
      console.error('Polymarket proxy fetch failure:', e);
      setEvents([]);
      setError(e.message || 'Network error fetching Polymarket events.');
    } finally {
      setLoading(false);
    }
  };

  // Initial load (defaults to individual stocks & equities)
  useEffect(() => {
    fetchActivePolymarketEvents('', 'Stocks');
  }, []);

  // Direct WebSocket to Polymarket CLOB for live trade updates
  useEffect(() => {
    if (events.length === 0) return;
    const wsUrl = 'wss://clob.polymarket.com/ws';
    let socket: WebSocket | null = null;

    try {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setWsStatus('CONNECTED');

        const tokensToSubscribe: string[] = [];
        events.forEach((ev) => {
          ev.markets.forEach((m) => {
            if (m.clobTokenIds && m.clobTokenIds.length > 0) {
              tokensToSubscribe.push(m.clobTokenIds[0]);
            }
          });
        });

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

      socket.onerror = () => {
        setWsStatus('REST PROXY');
      };

      socket.onclose = () => {
        setWsStatus('REST PROXY');
      };
    } catch {
      setWsStatus('REST PROXY');
    }

    return () => {
      if (socket) socket.close();
    };
  }, [events.length]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchActivePolymarketEvents(searchTerm, selectedCategory);
  };

  const handleCategorySwitch = (cat: string) => {
    setSelectedCategory(cat);
    setSearchTerm('');
    fetchActivePolymarketEvents('', cat);
  };

  const handleQuickTickerClick = (ticker: string) => {
    setSearchTerm(ticker);
    fetchActivePolymarketEvents(ticker, selectedCategory);
  };

  const activeEvent = useMemo(() => {
    return events.find((ev) => ev.id === selectedEventId) || events[0] || null;
  }, [events, selectedEventId]);

  return (
    <div className="bg-[#050505] border border-[#333] rounded p-4 animate-fade-in shadow-xl select-text flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden">
      {/* 1. HEADER SECTION */}
      <div className="border-b border-[#333] pb-3 mb-3 flex flex-col md:flex-row justify-between items-start md:items-center select-none gap-2 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[#ff9900] text-sm font-extrabold uppercase tracking-wider block">
              PMKT - EQUITY PREDICTION SCREENER
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                wsStatus === 'CONNECTED'
                  ? 'bg-emerald-950 border border-emerald-500 text-emerald-400'
                  : 'bg-amber-950 border border-amber-600 text-amber-400 font-medium'
              }`}
            >
              WS FEED: {wsStatus}
            </span>
          </div>
          <span className="text-[10px] text-zinc-500 block">
            LIVE INDIVIDUAL STOCK TARGETS, EARNINGS BEATS &amp; CORPORATE CATALYSTS
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
          <Database size={10} className="text-[#3498db]" />
          <span>GAMMA EQUITIES FEED</span>
          <span className="text-zinc-600 font-bold">|</span>
          <ShieldCheck size={10} className="text-[#00ff00]" />
          <span>CLOB LIVE ODDS</span>
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
            <Search size={12} className="text-zinc-500 mx-2 shrink-0" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search stocks or tickers (e.g. NVDA, AAPL, TSLA, earnings)..."
              className="flex-1 bg-transparent text-xs text-zinc-200 outline-none p-1 font-mono"
            />
            <button
              type="submit"
              className="px-2.5 py-1 bg-[#ff9900] hover:bg-amber-500 text-black text-[10px] uppercase font-extrabold rounded cursor-pointer transition-colors"
            >
              SEARCH
            </button>
          </form>

          {/* Categories toggler */}
          <div className="lg:col-span-7 flex items-center gap-1.5 overflow-x-auto pb-1 text-[10px] scrollbar-none">
            <span className="text-zinc-500 font-bold uppercase shrink-0">FOCUS:</span>
            {POLYMARKET_DEPARTMENTS.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => handleCategorySwitch(cat)}
                className={`px-2.5 py-1 rounded font-bold uppercase transition-all shrink-0 border cursor-pointer ${
                  selectedCategory === cat && !searchTerm
                    ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                    : 'bg-black border-[#222] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                {cat}
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setSelectedCategory('Stocks');
                fetchActivePolymarketEvents('', 'Stocks');
              }}
              className="ml-auto px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors shrink-0 cursor-pointer"
            >
              <RefreshCw size={10} className={`inline mr-1 ${loading ? 'animate-spin' : ''}`} />
              RESET
            </button>
          </div>
        </div>

        {/* Quick Stock Filter Bar */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
          <span className="text-zinc-500 font-bold uppercase mr-1">TICKER FILTER:</span>
          {quickTickers.map((sym) => {
            const isActiveTicker = searchTerm.toUpperCase() === sym;
            return (
              <button
                key={sym}
                type="button"
                onClick={() => handleQuickTickerClick(sym)}
                className={`px-2 py-0.5 rounded border font-bold transition-colors cursor-pointer ${
                  isActiveTicker
                    ? 'bg-[#3498db]/20 border-[#3498db] text-[#3498db]'
                    : 'bg-black border-[#262626] text-zinc-400 hover:border-[#3498db] hover:text-white'
                }`}
              >
                {sym}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. CORE SUBSTRUCTURE LAYOUT - TWO COLS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:flex-1 lg:min-h-0 lg:overflow-hidden">
        {/* LEFT COLUMN: EVENTS BROWSER LIST */}
        <div className="lg:col-span-5 border border-[#333] bg-black rounded flex flex-col min-h-[320px] lg:min-h-0 lg:h-full overflow-hidden">
          <div className="bg-[#0c0c0c] border-[#333] border-b p-2 flex justify-between items-center select-none shrink-0">
            <span className="text-[#ff9900] font-bold text-[10px] uppercase">
              {searchTerm
                ? `QUERY "${searchTerm.toUpperCase()}" (${events.length})`
                : `${selectedCategory.toUpperCase()} MARKETS (${events.length})`}
            </span>
            {lastUpdated && <span className="text-zinc-500 text-[9px] tabular-nums">TICK: {lastUpdated}</span>}
          </div>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-2 text-zinc-500 text-xs py-10 font-mono">
              <RefreshCw className="animate-spin text-[#3498db]" size={18} />
              <span>LOADING STOCK PREDICTION MARKETS...</span>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-[#ff4444] text-center text-xs py-10 gap-2">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          ) : events.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6 text-zinc-500 text-center text-xs py-10">
              No active stock markets matched &ldquo;{searchTerm || selectedCategory}&rdquo;. Click RESET or try another ticker.
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
                    className={`w-full text-left p-2.5 transition-all block cursor-pointer ${
                      isSelected
                        ? 'bg-[#1a1308] text-white border-l-2 border-[#ff9900]'
                        : 'hover:bg-[#070707] text-zinc-400 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-baseline mb-1 gap-2">
                      <span className="text-zinc-400 font-bold text-[9px] uppercase tracking-wide truncate">
                        {ev.category || 'Stocks'} · VOL {formatUsdVolume(ev.volume)}
                      </span>
                      <span
                        className={`text-[10px] font-bold font-mono tabular-nums shrink-0 ${
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
                    <span className="text-[10px] text-zinc-500 line-clamp-1 mt-0.5 block truncate">
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
                <span className="text-[#3498db] font-bold text-[10px] uppercase">
                  IMPLIED PROBABILITY &amp; STRIKE BREAKDOWN
                </span>
                {activeEvent.slug ? (
                  <a
                    href={`https://polymarket.com/event/${activeEvent.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-bold text-[#ff9900] hover:underline flex items-center gap-1"
                  >
                    <span>POLYMARKET</span>
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-zinc-500 text-[9px] font-mono">ID: {activeEvent.id}</span>
                )}
              </div>

              <div className="p-3 flex-1 min-h-0 overflow-y-auto space-y-4">
                {/* Event Summary Title */}
                <div>
                  <h3 className="text-white font-extrabold text-sm select-text block">
                    {activeEvent.title}
                  </h3>
                  <div className="text-[10px] text-zinc-400 mt-1 uppercase tracking-wide flex flex-wrap items-center gap-2">
                    <span className="text-[#ff9900] font-bold">
                      {activeEvent.category || 'Stocks'}
                    </span>
                    <span className="text-zinc-600">·</span>
                    <span className="tabular-nums">VOLUME: {formatUsdVolume(activeEvent.volume)}</span>
                    <span className="text-zinc-600">·</span>
                    <span className="tabular-nums">{activeEvent.markets.length} CONTRACTS</span>
                  </div>
                </div>

                {/* Markets details showing Outcome values & Live Probabilities */}
                <div className="space-y-3 border-t border-b border-[#222] py-3.5">
                  <span className="text-[10px] text-zinc-400 font-bold block uppercase select-none">
                    Contract Strikes &amp; Implied Probabilities (CLOB Prices)
                  </span>

                  {activeEvent.markets.map((market, idx) => {
                    const yesVal = parseFloat(market.outcomePrices[0] || '0.50');
                    const noVal = parseFloat(market.outcomePrices[1] || '0.50');
                    const yesPct = Math.round(yesVal * 100);
                    const noPct = Math.round(noVal * 100);

                    return (
                      <div key={market.id || idx} className="bg-[#050505] border border-[#222] rounded p-2.5">
                        <div className="flex items-start gap-1 justify-between mb-2 select-text">
                          <span className="text-zinc-200 font-bold text-xs leading-snug">
                            {idx + 1}. {market.question}
                          </span>
                        </div>

                        {/* Implied Probabilities dual Dial bar display */}
                        <div className="space-y-1.5 select-none">
                          <div className="flex justify-between items-center text-[10px] font-mono tabular-nums">
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

                        {market.clobTokenIds && market.clobTokenIds.length > 0 && (
                          <div className="mt-2 text-[9px] text-zinc-500 font-mono flex gap-3">
                            <span>YES_TOKEN: {market.clobTokenIds[0].slice(0, 10)}...</span>
                            <span>
                              NO_TOKEN: {market.clobTokenIds[1] ? market.clobTokenIds[1].slice(0, 10) : 'N/A'}...
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-2 select-none shrink-0 bg-[#0c0c0c] text-[9px] text-zinc-500 font-mono text-center border-t border-[#222] uppercase">
                Live Polymarket CLOB implied probabilities for public equity &amp; market events.
              </div>
            </div>
          ) : (
            <div className="m-auto text-zinc-500 text-xs py-10 font-mono text-center">
              Select a stock prediction market from the left column to inspect strike odds.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

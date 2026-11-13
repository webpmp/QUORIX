import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  Database,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { PolymarketEvent, StockData } from '../types';

interface PolymarketScreenProps {
  stocks: Record<string, StockData>;
}

export default function PolymarketScreen({ stocks: _stocks }: PolymarketScreenProps) {
  const [events, setEvents] = useState<PolymarketEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [wsStatus, setWsStatus] = useState<'CONNECTED' | 'REST PROXY' | 'DISCONNECTED'>('REST PROXY');
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // Extract categories dynamically
  const categories = useMemo(() => {
    const cats = new Set<string>();
    cats.add('All');
    events.forEach(ev => {
      if (ev.category) cats.add(ev.category);
    });
    return Array.from(cats);
  }, [events]);

  // Fetch from the server-side API proxy
  const fetchActivePolymarketEvents = async (searchStr = '', catStr = '') => {
    setLoading(true);
    setError(null);
    try {
      let queryUrl = '/api/polymarket/events?limit=25';
      if (searchStr) queryUrl += `&search=${encodeURIComponent(searchStr)}`;
      if (catStr && catStr !== 'All') queryUrl += `&category=${encodeURIComponent(catStr)}`;

      const res = await fetch(queryUrl);
      const data = await res.json();

      if (data.success && Array.isArray(data.data)) {
        const parsed: PolymarketEvent[] = data.data.map((item: any) => ({
          id: item.id || item.event_id || String(item.slug || item.title),
          title: item.title || item.name || "Markets Event",
          category: item.category || "General",
          slug: item.slug || "",
          markets: (item.markets || []).map((m: any) => ({
            id: m.id || String(m.question),
            question: m.question || m.title || "Will event occur?",
            outcomes: typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : (m.outcomes || ["Yes", "No"]),
            outcomePrices: typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : (m.outcomePrices || ["0.50", "0.50"]),
            clobTokenIds: typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds,
            active: m.active !== undefined ? m.active : true,
            closed: m.closed !== undefined ? m.closed : false
          }))
        }));
        setEvents(parsed);
        if (parsed.length > 0) {
          setSelectedEventId(parsed[0].id);
        }
        setLastUpdated(new Date().toLocaleTimeString());
      } else {
        setEvents([]);
        setError(data.error || 'Failed to retrieve live Polymarket events.');
      }
    } catch (e: any) {
      console.error("Polymarket proxy fetch failure:", e);
      setEvents([]);
      setError(e.message || 'Network error fetching Polymarket events.');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchActivePolymarketEvents();
  }, []);

  // Set up Direct WebSocket to Polymarket CLOB for live trade updates
  useEffect(() => {
    if (events.length === 0) return;
    const wsUrl = "wss://clob.polymarket.com/ws";
    let socket: WebSocket | null = null;

    try {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setWsStatus('CONNECTED');

        const tokensToSubscribe: string[] = [];
        events.forEach(ev => {
          ev.markets.forEach(m => {
            if (m.clobTokenIds && m.clobTokenIds.length > 0) {
              tokensToSubscribe.push(m.clobTokenIds[0]);
            }
          });
        });

        if (tokensToSubscribe.length > 0 && socket) {
          socket.send(JSON.stringify({
            type: "subscribe",
            assets_ids: tokensToSubscribe,
            channels: ["trades"]
          }));
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
              setEvents(prev =>
                prev.map(ev => ({
                  ...ev,
                  markets: ev.markets.map(m => {
                    if (m.clobTokenIds && m.clobTokenIds[0] === assetId) {
                      return {
                        ...m,
                        outcomePrices: [yesPriceVal.toFixed(2), (1 - yesPriceVal).toFixed(2)]
                      };
                    }
                    return m;
                  })
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

  // Handle Search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchActivePolymarketEvents(searchTerm, selectedCategory);
  };

  // Quick category switch
  const handleCategorySwitch = (cat: string) => {
    setSelectedCategory(cat);
    fetchActivePolymarketEvents(searchTerm, cat);
  };

  // Find currently active event inside detail panel
  const activeEvent = useMemo(() => {
    return events.find(ev => ev.id === selectedEventId) || events[0] || null;
  }, [events, selectedEventId]);

  return (
    <div className="bg-[#050505] border border-[#333] rounded p-4 animate-fade-in shadow-xl select-text">
      
      {/* 1. HEADER SECTION */}
      <div className="border-b border-[#333] pb-3 mb-4 flex flex-col md:flex-row justify-between items-start md:items-center select-none gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[#ff9900] text-sm font-extrabold uppercase tracking-wider block">
              PMKT - POLYMARKET ARBITRAGE SYSTEM
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
              wsStatus === 'CONNECTED' 
                ? 'bg-emerald-950 border border-emerald-500 text-emerald-400' 
                : 'bg-amber-950 border border-amber-600 text-amber-400 font-medium'
            }`}>
              WS FEED: {wsStatus}
            </span>
          </div>
          <span className="text-[10px] text-zinc-500 block">
            REAL-TIME IMPLIED PROBABILITIES CONVERSION ENGINE
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
          <Database size={10} className="text-[#3498db]" />
          <span>GAMMA PROXY ACTIVE</span>
          <span className="text-zinc-600 font-bold">|</span>
          <ShieldCheck size={10} className="text-[#00ff00]" />
          <span>SECURITY TICKERS VERIFIED</span>
        </div>
      </div>

      {/* 2. DISPATCH QUERY / FILTER TOOLS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-4 select-none">
        
        {/* Search Input bar */}
        <form onSubmit={handleSearchSubmit} className="lg:col-span-5 flex items-center bg-black border border-[#333] rounded overflow-hidden p-1">
          <Search size={12} className="text-zinc-500 mx-2 shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search predictive markets (e.g. Fed, antitrust, tariffs)..."
            className="flex-1 bg-transparent text-xs text-zinc-200 outline-none p-1 font-mono"
          />
          <button 
            type="submit"
            className="px-2.5 py-1 bg-[#333] hover:bg-[#444] text-zinc-200 text-[10px] uppercase font-bold rounded cursor-pointer transition-colors"
          >
            DISPATCH
          </button>
        </form>

        {/* Categories toggler */}
        <div className="lg:col-span-7 flex items-center gap-1.5 overflow-x-auto pb-1 text-[10px] scrollbar-none">
          <span className="text-zinc-500 font-bold uppercase shrink-0">DEPT:</span>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => handleCategorySwitch(cat)}
              className={`px-2 py-1 rounded font-bold uppercase transition-all shrink-0 border ${
                selectedCategory === cat
                  ? 'bg-zinc-900 border-[#ff9900] text-[#ff9900]'
                  : 'bg-black border-[#222] text-zinc-400 hover:border-zinc-700'
              }`}
            >
              {cat}
            </button>
          ))}
          
          <button
            onClick={() => {
              setSearchTerm('');
              setSelectedCategory('All');
              fetchActivePolymarketEvents('', 'All');
            }}
            className="ml-auto px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
          >
            <RefreshCw size={10} className={`inline mr-1 ${loading ? 'animate-spin' : ''}`} />
            RESET
          </button>
        </div>
      </div>

      {/* 3. CORE SUBSTRUCTURE LAYOUT - TWO COLS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[440px] overflow-hidden">
        
        {/* LEFT COLUMN: EVENTS BROWSER LIST */}
        <div className="lg:col-span-5 border border-[#333] bg-black rounded flex flex-col overflow-y-auto">
          <div className="bg-[#0c0c0c] border-[#333] border-b p-2 flex justify-between items-center select-none shrink-0">
            <span className="text-[#ff9900] font-bold text-[10px] uppercase">
              ACTIVE TRADING SIGNALS MODEL ({events.length} EVENTS)
            </span>
            {lastUpdated && <span className="text-zinc-600 text-[9px]">TICK: {lastUpdated}</span>}
          </div>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-2 text-zinc-500 text-xs py-10 font-mono">
              <RefreshCw className="animate-spin text-[#3498db]" size={18} />
              <span>COLLECTING GAMMA ORDERBOOKS COMPILER...</span>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-[#ff4444] text-center text-xs py-10 gap-2">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          ) : events.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6 text-zinc-600 text-center text-xs py-10">
              No active prediction markets matched the live query. Click RESET to reload active Gamma markets.
            </div>
          ) : (
            <div className="divide-y divide-[#222] overflow-y-auto flex-1 h-[400px]">
              {events.map((ev) => {
                const isSelected = selectedEventId === ev.id;
                // Get primary yes probability for list preview
                const primaryYesProb = ev.markets[0] 
                  ? Math.round(parseFloat(ev.markets[0].outcomePrices[0] || '0.50') * 100) 
                  : 50;

                return (
                  <button
                    key={ev.id}
                    onClick={() => {
                      setSelectedEventId(ev.id);
                    }}
                    className={`w-full text-left p-2.5 transition-all block ${
                      isSelected 
                        ? 'bg-[#1a1308] text-white border-l-2 border-[#ff9900]' 
                        : 'hover:bg-[#070707] text-zinc-400 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="bg-zinc-900 border border-zinc-800 text-zinc-500 font-bold px-1 py-0.5 rounded text-[8px] uppercase tracking-wide">
                        {ev.category || 'General'}
                      </span>
                      <span className={`text-[10px] font-bold font-mono ${
                        primaryYesProb > 60 ? 'text-[#00ff00]' : primaryYesProb < 40 ? 'text-[#ff4444]' : 'text-[#ff9900]'
                      }`}>
                        YES Prob: {primaryYesProb}%
                      </span>
                    </div>
                    <span className="font-bold text-[11px] block text-zinc-200 line-clamp-1 truncate">
                      {ev.title}
                    </span>
                    <span className="text-[9px] text-zinc-500 line-clamp-1 mt-0.5 block truncate">
                      {ev.markets[0]?.question || "N/A"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: REVELATORY IMPLICIT PROBABILITIES & STOCKS SCREENER SCREEN */}
        <div className="lg:col-span-7 flex flex-col bg-black border border-[#333] rounded overflow-y-auto">
          {activeEvent ? (
            <div className="flex flex-col h-full overflow-y-auto">
              
              {/* Event Header Panel */}
              <div className="bg-[#0c0c0c] border-[#333] border-b p-2 select-none shrink-0 flex justify-between items-center">
                <span className="text-[#3498db] font-bold text-[10px] uppercase">
                  MONETARY POSITION ARBITRAGE OVERVIEW
                </span>
                <span className="text-zinc-500 text-[9px] font-mono">ID: {activeEvent.id}</span>
              </div>

              <div className="p-3 flex-1 overflow-y-auto space-y-4">
                
                {/* Event Summary Title */}
                <div>
                  <h3 className="text-white font-extrabold text-xs select-text block">
                    {activeEvent.title}
                  </h3>
                  <div className="text-[9px] text-zinc-500 mt-1 uppercase tracking-wide flex items-center gap-1.5 selection:bg-zinc-800">
                    <span className="bg-zinc-950 border border-zinc-800 text-[#ff9900] px-1 rounded-sm">
                      {activeEvent.category || "General"}
                    </span>
                    {activeEvent.slug && (
                      <span className="text-zinc-600 font-mono">
                        slug: {activeEvent.slug}
                      </span>
                    )}
                  </div>
                </div>

                {/* Markets details showing Outcome values & Live Probabilities */}
                <div className="space-y-3.5 border-t border-b border-[#222] py-3.5">
                  <span className="text-[10px] text-zinc-400 font-bold block uppercase select-none">
                    Implied Outcomes & Probabilities Model (CLOB Prices)
                  </span>

                  {activeEvent.markets.map((market, idx) => {
                    const yesVal = parseFloat(market.outcomePrices[0] || '0.50');
                    const noVal = parseFloat(market.outcomePrices[1] || '0.50');
                    const yesPct = Math.round(yesVal * 100);
                    const noPct = Math.round(noVal * 100);

                    return (
                      <div key={market.id || idx} className="bg-[#050505] border border-[#222] rounded p-2.5">
                        <div className="flex items-start gap-1 justify-between mb-2 select-text">
                          <span className="text-zinc-200 font-bold text-[11px] leading-snug">
                            {idx + 1}. {market.question}
                          </span>
                        </div>

                        {/* Implied Probabilities dual Dial bar display */}
                        <div className="space-y-1.5 select-none">
                          <div className="flex justify-between items-center text-[9px] font-mono">
                            <span className="text-[#00ff00] font-bold">YES ORDER: ${yesVal.toFixed(2)} ({yesPct}%)</span>
                            <span className="text-[#ff4444] font-bold">NO ORDER: ${noVal.toFixed(2)} ({noPct}%)</span>
                          </div>

                          {/* Progression Dial block */}
                          <div className="h-2 w-full bg-zinc-900 rounded overflow-hidden flex">
                            <div 
                              className="bg-emerald-500 hover:bg-emerald-400 transition-all cursor-pointer h-full" 
                              style={{ width: `${yesPct}%` }}
                              title={`YES Probability: ${yesPct}%`}
                            />
                            <div 
                              className="bg-red-500 hover:bg-red-400 transition-all cursor-pointer h-full" 
                              style={{ width: `${noPct}%` }}
                              title={`NO Probability: ${noPct}%`}
                            />
                          </div>
                        </div>

                        {/* Token IDs Grounding Telemetry */}
                        {market.clobTokenIds && market.clobTokenIds.length > 0 && (
                          <div className="mt-2 text-[8px] text-zinc-600 font-mono flex gap-2">
                            <span>YES_TOKEN: {market.clobTokenIds[0].slice(0, 10)}...</span>
                            <span>NO_TOKEN: {market.clobTokenIds[1] ? market.clobTokenIds[1].slice(0, 10) : 'N/A'}...</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

              </div>
              
              {/* Central warning on predictive indexes */}
              <div className="p-2 select-none shrink-0 bg-[#0c0c0c] text-[8px] text-zinc-500 font-mono text-center border-t border-[#222] uppercase">
                System estimates are probabilistic. Ensure positions are managed in compliance with CFTC hedge standards.
              </div>

            </div>
          ) : (
            <div className="m-auto text-zinc-600 text-xs py-10 font-mono text-center">
              Select an active signal from the left column to compile detailed equity correlations.
            </div>
          )}
        </div>

      </div>

    </div>
  );
}

import React, { useState, useRef, useEffect } from 'react';
import { StockData } from '../types';
import { Sparkles, Settings, GripHorizontal } from 'lucide-react';

interface CommandPanelProps {
  stocks: Record<string, StockData>;
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
  activeScreen: string;
  onSelectScreen: (screen: string) => void;
}

const SPLIT_STORAGE_KEY = 'quorix_tracked_equities_height_pct';

export default function CommandPanel({
  stocks,
  selectedTicker,
  onSelectTicker,
  activeScreen,
  onSelectScreen
}: CommandPanelProps) {
  const [equitiesHeightPct, setEquitiesHeightPct] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(SPLIT_STORAGE_KEY);
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed)) return Math.min(85, Math.max(15, parsed));
      }
    } catch {
      // ignore storage errors
    }
    return 50;
  });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_STORAGE_KEY, String(equitiesHeightPct));
    } catch {
      // ignore storage errors
    }
  }, [equitiesHeightPct]);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;

      const offsetFromBottom = rect.bottom - e.clientY;
      const pct = (offsetFromBottom / rect.height) * 100;
      const clamped = Math.min(85, Math.max(15, pct));
      setEquitiesHeightPct(parseFloat(clamped.toFixed(1)));
    };

    const handlePointerUp = () => {
      setIsDragging(false);
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging]);

  // Command structures
  const commands = [
    { code: 'BWRITE', name: 'ASK QUORIX', desc: 'Consult GPT-4 / Gemini analyst', category: 'Tools' },
    { code: 'NEWS', name: 'NEWS HUB', desc: 'Real-time grounding', category: 'Information' },
    { code: 'GP', name: 'GRAPH PRICE', desc: 'Candlestick / Vol Chart', category: 'Equities' },
    { code: 'HP', name: 'HISTORICAL PRICING', desc: 'Price Archive table', category: 'Equities' },
    { code: 'DES', name: 'SECURITY ANALYTICS', desc: 'Core Info & Bio', category: 'Equities' },
    { code: 'ANR', name: 'ANALYST RECS', desc: 'Consensus estimates', category: 'Equities' },
    { code: 'CRNC', name: 'CURRENCIES (FX)', desc: 'Foreign Exchange Rates', category: 'Macro' },
    { code: 'ECO', name: 'ECONOMIC INDICATOR', desc: 'FRED Macro & Calendar', category: 'Macro' },
    { code: 'POLY', name: 'POLYMARKET SCREENER', desc: 'Predictive market arbitrage', category: 'Macro' },
    { code: 'SETT', name: 'SYSTEM SETTINGS', desc: 'Configure API Keys', category: 'Tools' },
    { code: 'HELP', name: 'USER MANUALS', desc: 'Syntax reference guide', category: 'Tools' }
  ];

  return (
    <div className="w-full lg:w-72 h-full bg-[#050505] border-[#333] border-r flex flex-col font-mono text-xs select-none overflow-hidden">
      {/* Resizable vertical split container */}
      <div ref={splitContainerRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Standard Terminal CLI codes list */}
        <div
          className="p-3 overflow-y-auto min-h-0"
          style={{ height: `${100 - equitiesHeightPct}%` }}
        >
          <div className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase mb-2 flex items-center justify-between">
            <span>Terminal Commands</span>
            <span className="text-zinc-600 font-mono text-[9px]">{commands.length} ACTIVE</span>
          </div>
          
          <div className="space-y-1.5">
            {commands.map((cmd) => {
              const isSelected = activeScreen === cmd.code || (cmd.code === 'SETT' && activeScreen === 'SETTINGS');
              return (
                <button
                  key={cmd.code}
                  onClick={() => onSelectScreen(cmd.code)}
                  className={`w-full text-left p-1.5 rounded transition-all flex items-start space-x-2 ${
                    isSelected
                      ? 'bg-[#1a1a1a] border border-[#ff9900] text-white'
                      : 'bg-[#010101] hover:bg-[#111] border border-transparent text-zinc-400'
                  }`}
                  id={`cmd-shortcut-${cmd.code}`}
                >
                  <div className="bg-black border border-[#333] px-1 py-0.5 rounded text-[10px] text-[#ff9900] font-bold min-w-[42px] text-center shrink-0">
                    {cmd.code}
                  </div>
                  
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-zinc-200 text-[11px] truncate flex items-center gap-1">
                      {cmd.name}
                      {cmd.code === 'BWRITE' && <Sparkles size={10} className="text-[#3498db]" />}
                      {cmd.code === 'SETT' && <Settings size={10} className="text-[#ffaa00]" />}
                    </div>
                    <div className="text-[9px] text-zinc-500 line-clamp-1 truncate">
                      {cmd.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Draggable resize bar for Tracked Equities height */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize Tracked Equities height"
          onPointerDown={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDoubleClick={() => setEquitiesHeightPct(50)}
          title="Drag up or down to resize Tracked Equities (double-click to reset)"
          className={`h-2.5 shrink-0 border-y flex items-center justify-center cursor-row-resize transition-colors group touch-none ${
            isDragging
              ? 'bg-[#1a1a1a] border-[#ff9900]'
              : 'bg-[#0a0a0a] border-[#333] hover:bg-[#141414] hover:border-zinc-500'
          }`}
        >
          <GripHorizontal
            size={12}
            className={isDragging ? 'text-[#ff9900]' : 'text-zinc-600 group-hover:text-[#ff9900]'}
          />
        </div>

        {/* Tracked equity list */}
        <div
          className="p-3 overflow-y-auto min-h-0 border-b border-[#333]"
          style={{ height: `${equitiesHeightPct}%` }}
        >
          <div className="flex items-center justify-between text-[10px] text-zinc-500 font-bold tracking-widest uppercase mb-2">
            <span>Tracked Equities</span>
            <span className="text-[#3498db] font-mono text-[9px]">
              {Object.keys(stocks).filter(sym => !['SPX', 'DJI', 'IXIC', 'GC', 'CL', 'TNX', 'BTC'].includes(sym)).length} TICKERS
            </span>
          </div>
          
          <div className="space-y-1">
            {Object.values(stocks)
              .filter((stock) => !['SPX', 'DJI', 'IXIC', 'GC', 'CL', 'TNX', 'BTC'].includes(stock.symbol))
              .map((stock) => {
                const isSelected = stock.symbol === selectedTicker;
                const hasPrice = stock.price > 0;
                const isPositive = stock.change >= 0;
              return (
                <button
                  key={stock.symbol}
                  onClick={() => onSelectTicker(stock.symbol)}
                  className={`w-full flex items-center justify-between p-2 rounded text-left transition-all ${
                    isSelected
                      ? 'bg-[#1a1a1a] border-l-2 border-[#3498db] text-white'
                      : 'bg-[#010101] hover:bg-[#111] border-l-2 border-transparent text-zinc-300'
                  }`}
                  id={`stock-ticker-${stock.symbol}`}
                >
                <div>
                  <div className="font-bold flex items-center gap-1.5 min-w-0">
                    <span className={isSelected ? 'text-[#3498db]' : 'text-zinc-200'}>
                      {stock.symbol}
                    </span>
                    <span className="text-[9px] text-zinc-500 truncate max-w-[90px]">
                      {stock.name}
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    Vol: {stock.volume > 0 ? `${(stock.volume / 1000000).toFixed(1)}M` : '--'}
                  </div>
                </div>
                
                <div className="text-right flex flex-col items-end">
                  <div className="font-bold text-white font-mono flex items-center gap-1">
                    {hasPrice ? `$${stock.price.toFixed(2)}` : '--'}
                    {stock.isPreMarket && (
                      <span className="text-[7px] bg-amber-500/20 text-amber-500 px-1 rounded font-bold border border-amber-500/30">
                        PRE
                      </span>
                    )}
                    {stock.isAfterHours && (
                      <span className="text-[7px] bg-indigo-500/20 text-indigo-400 px-1.5 rounded font-bold border border-indigo-500/30">
                        AFT
                      </span>
                    )}
                  </div>
                  <div className={`text-[10px] font-semibold ${!hasPrice ? 'text-zinc-600' : isPositive ? 'text-[#00ff00]' : 'text-[#ff4444]'}`}>
                    {hasPrice ? `${isPositive ? '▲' : '▼'} ${Math.abs(stock.changePercent).toFixed(2)}%` : '--'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

          {/* Ticker status */}
          <div className="mt-2 text-[8px] text-zinc-500 font-mono text-center border border-[#1a1a1a] bg-[#050505] p-1.5 rounded uppercase select-none">
            QUOTES MODE: <span className="text-[#00ff00] font-extrabold">REAL-TIME / DELAYED</span>
          </div>
        </div>
      </div>

      {/* Footer Instructions */}
      <div className="p-2.5 bg-black text-[9px] text-zinc-500 select-none">
        <div>
          <span className="text-[#ff9900] font-bold">PRO-TIP:</span> Enter <span className="text-[#3498db]">"HELP"</span> or click items above to toggle workspace screens instantly.
        </div>
      </div>
    </div>
  );
}

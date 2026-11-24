import React, { useState, useRef, useEffect } from 'react';
import { StockData } from '../types';
import { GripHorizontal, ChevronUp, ChevronDown, X, GripVertical, RotateCcw } from 'lucide-react';

interface CommandPanelProps {
  stocks: Record<string, StockData>;
  trackedTickers: string[];
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
  onReorderTicker: (fromIndex: number, toIndex: number) => void;
  onRemoveTicker: (ticker: string) => void;
  onResetTrackedTickers: () => void;
  activeScreen: string;
  onSelectScreen: (screen: string) => void;
}

const SPLIT_STORAGE_KEY = 'quorix_tracked_equities_height_pct';

export default function CommandPanel({
  stocks,
  trackedTickers,
  selectedTicker,
  onSelectTicker,
  onReorderTicker,
  onRemoveTicker,
  onResetTrackedTickers,
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
  const [isEditingEquities, setIsEditingEquities] = useState<boolean>(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
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
    { code: 'ASK', name: 'ASK QUORIX', desc: 'Consult AI analyst', category: 'Tools' },
    { code: 'NEWS', name: 'NEWS HUB', desc: 'Real-time grounding', category: 'Information' },
    { code: 'GP', name: 'GRAPH PRICE', desc: 'Candlestick / Vol Chart', category: 'Equities' },
    { code: 'CORR', name: 'CORRELATION ANALYZER', desc: 'Correlation & portfolio analysis', category: 'Equities' },
    { code: 'PRM', name: 'PORTFOLIO RISK MONITOR', desc: 'Exposure, risk & stress tests', category: 'Equities' },
    { code: 'HP', name: 'HISTORICAL PRICING', desc: 'Price Archive table', category: 'Equities' },
    { code: 'DES', name: 'SECURITY ANALYTICS', desc: 'Core Info & Bio', category: 'Equities' },
    { code: 'ANR', name: 'ANALYST RECS', desc: 'Consensus estimates', category: 'Equities' },
    { code: 'INST', name: 'INSTITUTIONAL ACTIVITY', desc: '13F Holdings & Accumulation', category: 'Equities' },
    { code: 'CRNC', name: 'CURRENCIES (FX)', desc: 'Foreign Exchange Rates', category: 'Macro' },
    { code: 'ECO', name: 'ECONOMIC INDICATOR', desc: 'FRED Macro & Calendar', category: 'Macro' },
    { code: 'POLY', name: 'POLYMARKET SCREENER', desc: 'Predictive market arbitrage', category: 'Macro' },
    { code: 'SETT', name: 'SYSTEM SETTINGS', desc: 'Configure API Keys', category: 'Tools' },
    { code: 'HELP', name: 'USER MANUAL', desc: 'Syntax reference guide', category: 'Tools' }
  ];

  return (
    <div className="w-full lg:w-72 h-full bg-[#050505] border-[#333] border-r flex flex-col font-mono text-xs select-none overflow-hidden">
      {/* Resizable vertical split container */}
      <div ref={splitContainerRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Standard Terminal CLI codes list */}
        <div
          className="flex flex-col min-h-0"
          style={{ height: `${100 - equitiesHeightPct}%` }}
        >
          <div className="px-3 pt-3 pb-2 shrink-0 text-xs text-zinc-300 font-bold tracking-widest uppercase">
            <span>Terminal Commands</span>
          </div>
          
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1">
            {commands.map((cmd) => {
              const isSelected = activeScreen === cmd.code || (cmd.code === 'SETT' && activeScreen === 'SETTINGS');
              return (
                <button
                  key={cmd.code}
                  onClick={() => onSelectScreen(cmd.code)}
                  title={`${cmd.name}: ${cmd.desc}`}
                  className={`w-full text-left min-h-8 px-2 py-1.5 rounded transition-all flex items-center space-x-2.5 ${
                    isSelected
                      ? 'bg-[#1a1a1a] border border-[#ff9900] text-white'
                      : 'bg-[#010101] hover:bg-[#111] border border-transparent text-zinc-300'
                  }`}
                  id={`cmd-shortcut-${cmd.code}`}
                >
                  <div className="bg-black border border-[#3a3a3a] px-1.5 py-0.5 rounded text-xs text-[#ff9900] font-bold w-16 text-center shrink-0">
                    {cmd.code}
                  </div>
                  
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-zinc-200 text-xs truncate">
                      {cmd.name}
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
            className={isDragging ? 'text-[#ff9900]' : 'text-zinc-300 group-hover:text-[#ff9900]'}
          />
        </div>

        {/* Tracked equity list */}
        <div
          className="flex flex-col min-h-0 border-b border-[#333]"
          style={{ height: `${equitiesHeightPct}%` }}
        >
          <div className="px-3 pt-3 pb-2 shrink-0 flex items-center justify-between text-xs text-zinc-300 font-bold tracking-wider uppercase gap-2">
            <span className="whitespace-nowrap shrink-0">Tracked Equities</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {isEditingEquities && (
                <button
                  type="button"
                  onClick={onResetTrackedTickers}
                  title="Restore default watchlist"
                  className="text-xs text-zinc-300 hover:text-[#ff9900] border border-[#3a3a3a] hover:border-[#ff9900] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <RotateCcw size={10} />
                  <span>RESET</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsEditingEquities((prev) => !prev)}
                title={isEditingEquities ? 'Finish editing watchlist' : 'Rearrange or remove tracked equities'}
                className={`text-xs font-mono font-bold px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                  isEditingEquities
                    ? 'border-[#ff9900] bg-[#ff9900]/15 text-[#ff9900]'
                    : 'border-[#3a3a3a] text-zinc-300 hover:border-[#3498db] hover:text-[#3498db]'
                }`}
              >
                {isEditingEquities ? 'DONE' : 'EDIT'}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 space-y-1">
            {trackedTickers.length === 0 ? (
              <div className="text-center py-6 px-2 border border-dashed border-[#3a3a3a] rounded text-xs text-zinc-300 space-y-2">
                <div>NO TRACKED EQUITIES IN LIST.</div>
                <button
                  type="button"
                  onClick={onResetTrackedTickers}
                  className="px-2 py-1 rounded border border-[#333] text-[#ff9900] hover:border-[#ff9900] font-bold uppercase cursor-pointer"
                >
                  RESTORE DEFAULTS
                </button>
              </div>
            ) : (
              trackedTickers.map((sym, idx) => {
                const stock: Pick<
                  StockData,
                  'symbol' | 'name' | 'price' | 'change' | 'changePercent' | 'volume' | 'isPreMarket' | 'isAfterHours'
                > = stocks[sym] || {
                  symbol: sym,
                  name: sym,
                  price: 0,
                  change: 0,
                  changePercent: 0,
                  volume: 0,
                  isPreMarket: false,
                  isAfterHours: false,
                };
                const isSelected = stock.symbol === selectedTicker;
                const hasPrice = stock.price > 0;
                const isPositive = stock.change >= 0;
                const isDragTarget = dragOverIdx === idx && draggedIdx !== null && draggedIdx !== idx;

                return (
                  <div
                    key={stock.symbol}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => {
                      setDraggedIdx(idx);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', stock.symbol);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverIdx !== idx) setDragOverIdx(idx);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedIdx !== null && draggedIdx !== idx) {
                        onReorderTicker(draggedIdx, idx);
                      }
                      setDraggedIdx(null);
                      setDragOverIdx(null);
                    }}
                    onDragEnd={() => {
                      setDraggedIdx(null);
                      setDragOverIdx(null);
                    }}
                    onClick={() => onSelectTicker(stock.symbol)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectTicker(stock.symbol);
                      }
                    }}
                    className={`group w-full flex items-center justify-between gap-1.5 p-2 rounded text-left transition-all cursor-pointer ${
                      isDragTarget
                        ? 'border border-[#ff9900] bg-[#1a1205]'
                        : isSelected
                        ? 'bg-[#1a1a1a] border-l-2 border-[#3498db] text-white'
                        : 'bg-[#010101] hover:bg-[#111] border-l-2 border-transparent text-zinc-300'
                    } ${draggedIdx === idx ? 'opacity-50' : ''}`}
                    id={`stock-ticker-${stock.symbol}`}
                    title={isEditingEquities ? 'Drag or use arrows to reorder / X to remove' : `Click to view ${stock.symbol} (drag to reorder)`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <GripVertical
                        size={11}
                        className={`shrink-0 cursor-grab active:cursor-grabbing ${
                          isEditingEquities ? 'text-zinc-300' : 'text-zinc-700 group-hover:text-zinc-300'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-bold flex items-center gap-1.5 min-w-0">
                          <span className={isSelected ? 'text-[#3498db]' : 'text-zinc-200'}>
                            {stock.symbol}
                          </span>
                          <span className="text-xs text-zinc-300 truncate">
                            {stock.name}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-300 mt-0.5">
                          Vol: {stock.volume > 0 ? `${(stock.volume / 1000000).toFixed(1)}M` : '--'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isEditingEquities && (
                        <div className="text-right flex flex-col items-end">
                          <div className="font-bold text-white font-mono flex items-center gap-1">
                            {hasPrice ? `$${stock.price.toFixed(2)}` : '--'}
                            {stock.isPreMarket && (
                              <span className="text-[10px] leading-tight bg-amber-500/20 text-amber-500 px-1 rounded font-bold border border-amber-500/30">
                                PRE
                              </span>
                            )}
                          </div>
                          <div className={`text-xs font-semibold ${!hasPrice ? 'text-zinc-300' : isPositive ? 'text-[#00ff00]' : 'text-[#ff4444]'}`}>
                            {hasPrice ? `${isPositive ? '▲' : '▼'} ${Math.abs(stock.changePercent).toFixed(2)}%` : '--'}
                          </div>
                        </div>
                      )}

                      {isEditingEquities && (
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onReorderTicker(idx, idx - 1);
                            }}
                            disabled={idx === 0}
                            title={`Move ${stock.symbol} up`}
                            aria-label={`Move ${stock.symbol} up`}
                            className="p-0.5 rounded border border-[#333] bg-black text-zinc-300 hover:text-[#ff9900] hover:border-[#ff9900] disabled:opacity-25 disabled:hover:text-zinc-300 disabled:hover:border-[#333] cursor-pointer disabled:cursor-not-allowed"
                          >
                            <ChevronUp size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onReorderTicker(idx, idx + 1);
                            }}
                            disabled={idx === trackedTickers.length - 1}
                            title={`Move ${stock.symbol} down`}
                            aria-label={`Move ${stock.symbol} down`}
                            className="p-0.5 rounded border border-[#333] bg-black text-zinc-300 hover:text-[#ff9900] hover:border-[#ff9900] disabled:opacity-25 disabled:hover:text-zinc-300 disabled:hover:border-[#333] cursor-pointer disabled:cursor-not-allowed"
                          >
                            <ChevronDown size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveTicker(stock.symbol);
                            }}
                            title={`Remove ${stock.symbol} from list`}
                            aria-label={`Remove ${stock.symbol} from list`}
                            className="p-0.5 rounded border border-[#333] bg-black text-zinc-300 hover:text-[#ff4444] hover:border-[#ff4444] cursor-pointer"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Ticker status */}
          <div className="px-3 pt-2 pb-3 shrink-0">
            <div
              className="text-xs text-zinc-300 font-mono text-center border border-[#1a1a1a] bg-[#050505] p-1.5 rounded uppercase select-none"
              title="Equity prices poll via HTTP every 60 seconds (1 min). There is no live WebSocket tick stream."
            >
              QUOTES MODE: <span className="text-[#00ff00] font-extrabold">DELAYED 1 MIN</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

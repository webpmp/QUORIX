import { useState, useEffect, useRef } from 'react';
import { StockData } from '../types';
import { Activity, RefreshCw } from 'lucide-react';

interface ChartWidgetProps {
  stock: StockData;
}

type ChartType = 'candle' | 'line' | 'area';
type IntervalType = '5m' | '15m' | '30m' | '1h' | '1D' | '1W' | '1M';

type HistoryBar = StockData['history'][number];

function calculateRSI(data: { close: number }[], period = 6): number[] {
  const rsiValues: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < 1) {
      rsiValues.push(50); // baseline
      continue;
    }
    
    let gains = 0;
    let losses = 0;
    const actualPeriod = Math.min(i, period);
    
    for (let j = i - actualPeriod + 1; j <= i; j++) {
      const change = data[j].close - data[j - 1].close;
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }
    
    const avgGain = gains / actualPeriod;
    const avgLoss = losses / actualPeriod;
    
    if (avgLoss === 0) {
      rsiValues.push(avgGain > 0 ? 100 : 50);
    } else {
      const rs = avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      rsiValues.push(rsi);
    }
  }
  return rsiValues;
}

export default function ChartWidget({ stock }: ChartWidgetProps) {
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showIndicator, setShowIndicator] = useState<boolean>(true);
  const [showVolumeStudy, setShowVolumeStudy] = useState<boolean>(true);
  const [showRsiStudy, setShowRsiStudy] = useState<boolean>(true);
  const [interval, setInterval] = useState<IntervalType>('1h');
  const [fetchedHistory, setFetchedHistory] = useState<HistoryBar[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const chartPanelRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(600);

  useEffect(() => {
    if (!stock?.symbol) return;
    let cancelled = false;
    setHoverIndex(null);

    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const res = await fetch(
          `/api/market/history?symbol=${encodeURIComponent(stock.symbol)}&interval=${encodeURIComponent(interval)}`
        );
        const data = await res.json();
        if (!cancelled) {
          if (data.success && Array.isArray(data.history)) {
            setFetchedHistory(data.history);
          } else {
            setFetchedHistory([]);
          }
        }
      } catch {
        if (!cancelled) {
          setFetchedHistory([]);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [stock?.symbol, interval]);

  const activeBars =
    fetchedHistory.length > 0
      ? fetchedHistory
      : interval === '1h' && stock?.history && stock.history.length > 0
      ? stock.history
      : [];

  useEffect(() => {
    const el = chartPanelRef.current;
    if (!el) return;

    const updateWidth = () => {
      const nextWidth = Math.floor(el.getBoundingClientRect().width);
      if (nextWidth > 0) {
        setChartWidth((prev) => (prev !== nextWidth ? nextWidth : prev));
      }
    };

    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const nextWidth = Math.floor(entry.contentRect.width);
          if (nextWidth > 0) {
            setChartWidth((prev) => (prev !== nextWidth ? nextWidth : prev));
          }
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [activeBars.length]);

  if (!stock || activeBars.length === 0) {
    return (
      <div className="bg-[#010101] border border-[#333] rounded p-6 text-center text-zinc-500 font-mono select-none">
        <div className="text-[#ff9900] font-bold text-sm mb-2 flex items-center justify-center gap-2">
          {historyLoading && <RefreshCw size={13} className="animate-spin text-[#ff9900]" />}
          <span>GRAPH PRICE (GP) COUPLING...</span>
        </div>
        <p className="text-xs text-zinc-400 mb-4">
          {historyLoading
            ? 'LOADING LIVE MARKET OHLCV BARS FOR '
            : 'NO HISTORICAL OHLCV BARS AVAILABLE FOR '}
          <span className="text-white font-extrabold">{stock ? stock.symbol : 'UNKNOWN'}</span> ({interval.toUpperCase()})
        </p>
        <div className="text-[10px] text-zinc-600">
          LIVE YAHOO FINANCE / ALPHA VANTAGE STREAM
        </div>
      </div>
    );
  }

  const history = [...activeBars].reverse(); // oldest first for chronological chart
  const rsiList = calculateRSI(history, 6);

  // Layout & Coordinate constants (1:1 pixel-matched to container width)
  const width = Math.max(320, chartWidth);
  const paddingLeft = 58;
  const paddingRight = 24;
  const adjWidth = Math.max(100, width - paddingLeft - paddingRight);

  // 1. Price Chart Dimensions
  const priceHeight = 184;
  const pricePaddingTop = 15;
  const pricePaddingBottom = 18;
  const priceAdjHeight = priceHeight - pricePaddingTop - pricePaddingBottom;

  const barStep = adjWidth / Math.max(history.length, 1);
  const candleWidth = Math.max(4, Math.min(14, Math.floor(barStep * 0.55)));
  const volBarWidth = Math.max(3, Math.min(12, Math.floor(barStep * 0.5)));

  const maxLabels = Math.max(4, Math.floor(adjWidth / 76));
  const labelStep = Math.max(1, Math.ceil(history.length / maxLabels));
  const lastRegularTick = Math.floor((history.length - 1) / labelStep) * labelStep;

  const formatAxisPrice = (val: number) =>
    val >= 1000 ? val.toFixed(1) : val >= 10 ? val.toFixed(2) : val.toFixed(3);

  const formatAxisVolume = (vol: number) => {
    if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(0)}K`;
    return `${Math.round(vol)}`;
  };

  // 2. Volume Study Dimensions
  const volHeight = 65;
  const volPaddingTop = 10;
  const volPaddingBottom = 10;
  const volAdjHeight = volHeight - volPaddingTop - volPaddingBottom;

  // 3. RSI Study Dimensions
  const rsiHeight = 65;
  const rsiPaddingTop = 10;
  const rsiPaddingBottom = 10;
  const rsiAdjHeight = rsiHeight - rsiPaddingTop - rsiPaddingBottom;

  // Price boundaries
  const prices = history.flatMap((h) => [h.high, h.low, h.close, h.open]);
  const maxPrice = Math.max(...prices) * 1.01;
  const minPrice = Math.min(...prices) * 0.99;
  const priceRange = Math.max(maxPrice - minPrice, 0.0001);

  // Volume boundaries
  const volumes = history.map((h) => h.volume);
  const maxVolume = Math.max(...volumes);

  // Shared Horizontal Scale Getter
  const getX = (index: number) => {
    if (history.length <= 1) return paddingLeft + adjWidth / 2;
    return paddingLeft + (index / (history.length - 1)) * adjWidth;
  };

  // Price Y coordinates
  const getY = (price: number) => {
    return pricePaddingTop + priceAdjHeight - ((price - minPrice) / priceRange) * priceAdjHeight;
  };

  // Volume Y coordinates
  const getVolY = (volume: number) => {
    const denom = maxVolume || 1;
    return volPaddingTop + volAdjHeight - (volume / denom) * volAdjHeight;
  };

  // RSI Y coordinates
  const getRsiY = (rsiVal: number) => {
    return rsiPaddingTop + rsiAdjHeight - (rsiVal / 100) * rsiAdjHeight;
  };

  // Line & Area Path generators
  const generateLinePath = () => {
    return history
      .map((h, i) => `${i === 0 ? 'M' : 'L'}${getX(i)},${getY(h.close)}`)
      .join(' ');
  };

  const generateAreaPath = () => {
    const linePath = generateLinePath();
    return `${linePath} L${getX(history.length - 1)},${getY(minPrice)} L${getX(0)},${getY(minPrice)} Z`;
  };

  // 3-Period Moving Average helper overlay
  const getMA = (index: number) => {
    if (index < 2) return null;
    const p1 = history[index].close;
    const p2 = history[index - 1].close;
    const p3 = history[index - 2].close;
    return (p1 + p2 + p3) / 3;
  };

  const generateMAPath = () => {
    const points: string[] = [];
    for (let i = 2; i < history.length; i++) {
      const ma = getMA(i);
      if (ma !== null) {
        points.push(`${points.length === 0 ? 'M' : 'L'}${getX(i)},${getY(ma)}`);
      }
    }
    return points.join(' ');
  };

  const activeIndex = hoverIndex !== null ? hoverIndex : history.length - 1;
  const hoveredData = history[activeIndex];
  const displayData = hoverIndex !== null ? {
    date: hoveredData.date,
    open: hoveredData.open,
    high: hoveredData.high,
    low: hoveredData.low,
    close: hoveredData.close,
    volume: hoveredData.volume
  } : {
    date: hoveredData.date,
    open: typeof stock.open === 'number' && stock.open > 0 ? stock.open : hoveredData.open,
    high: typeof stock.high === 'number' && stock.high > 0 ? stock.high : hoveredData.high,
    low: typeof stock.low === 'number' && stock.low > 0 ? stock.low : hoveredData.low,
    close: typeof stock.price === 'number' && stock.price > 0 ? stock.price : hoveredData.close,
    volume: typeof stock.volume === 'number' && stock.volume > 0 ? stock.volume : hoveredData.volume
  };
  const currentRsi = rsiList[activeIndex];

  // Helper for grid column classes depending on active studies
  const gridColsCount = 5 + (showVolumeStudy ? 1 : 0) + (showRsiStudy ? 1 : 0);

  return (
    <div className="bg-[#010101] border border-[#333] rounded p-3.5 text-xs font-mono select-none">
      {/* Chart Headers */}
      <div className="flex flex-col sm:flex-row items-baseline sm:items-center justify-between border-b border-[#333] pb-2 mb-3">
        <div className="flex items-start space-x-3">
          <Activity size={14} className="text-[#00ff00] mt-1" />
          <div className="flex flex-col">
            <span className="text-white text-base font-extrabold flex items-center gap-1.5 leading-tight">
              <span className="text-[#ff9900]">{stock.symbol}</span>
              {stock.isPreMarket && (
                <span className="text-[9px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded font-extrabold border border-amber-500/30 ml-1.5">
                  PRE-MARKET ACTIVE
                </span>
              )}
              {stock.isAfterHours && (
                <span className="text-[9px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded font-extrabold border border-indigo-500/30 ml-1.5">
                  AFTER HOURS ACTIVE
                </span>
              )}
            </span>
            <span className="text-zinc-500 text-[9px] font-bold uppercase tracking-wider mt-0.5">
              US EQUITY
            </span>
          </div>
          <div className="flex flex-col border-l border-[#222] pl-3 self-center">
            <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">{stock.name}</span>
          </div>
        </div>

        {/* Options Row */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2 sm:mt-0">
          <div className="flex rounded bg-black border border-[#333] overflow-hidden mr-1">
            {(['5m', '15m', '30m', '1h', '1D', '1W', '1M'] as IntervalType[]).map((int) => (
              <button
                key={int}
                onClick={() => setInterval(int)}
                className={`px-2 py-0.5 text-[8px] sm:text-[9px] font-bold transition-all cursor-pointer border-r border-[#222] last:border-0 ${
                  interval === int 
                    ? 'bg-[#00ff00] text-black font-extrabold' 
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                }`}
                title={
                  int === '5m' ? '5-Minute' :
                  int === '15m' ? '15-Minute' :
                  int === '30m' ? '30-Minute' :
                  int === '1h' ? '1-Hour' :
                  int === '1D' ? 'Daily' :
                  int === '1W' ? 'Weekly' : 'Monthly'
                }
              >
                {int.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex rounded bg-black border border-[#333] overflow-hidden mr-1">
            <button
              onClick={() => setChartType('candle')}
              className={`px-2 py-0.5 text-[8px] sm:text-[9px] font-bold transition-colors cursor-pointer ${chartType === 'candle' ? 'bg-[#ff9900] text-black' : 'text-zinc-400 hover:text-white'}`}
            >
              CANDLES
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`px-2 py-0.5 text-[8px] sm:text-[9px] font-bold transition-colors cursor-pointer ${chartType === 'line' ? 'bg-[#ff9900] text-black' : 'text-zinc-400 hover:text-white'}`}
            >
              LINE
            </button>
            <button
              onClick={() => setChartType('area')}
              className={`px-2 py-0.5 text-[8px] sm:text-[9px] font-bold transition-colors cursor-pointer ${chartType === 'area' ? 'bg-[#ff9900] text-black' : 'text-zinc-400 hover:text-white'}`}
            >
              AREA
            </button>
          </div>

          <button
            onClick={() => setShowIndicator(!showIndicator)}
            className={`px-2 py-0.5 rounded border text-[8px] sm:text-[9px] font-bold transition-all cursor-pointer ${
              showIndicator
                ? 'border-[#3498db] bg-[rgba(52,152,219,0.06)] text-[#3498db]'
                : 'border-[#333] bg-transparent text-zinc-500'
            }`}
          >
            3MA
          </button>
          <button
            onClick={() => setShowVolumeStudy(!showVolumeStudy)}
            className={`px-2 py-0.5 rounded border text-[8px] sm:text-[9px] font-bold transition-all cursor-pointer ${
              showVolumeStudy
                ? 'border-[#00ff00] bg-[rgba(0,255,0,0.06)] text-[#00ff00]'
                : 'border-[#333] bg-transparent text-zinc-500'
            }`}
          >
            VOLUME
          </button>
          <button
            onClick={() => setShowRsiStudy(!showRsiStudy)}
            className={`px-2 py-0.5 rounded border text-[8px] sm:text-[9px] font-bold transition-all cursor-pointer ${
              showRsiStudy
                ? 'border-[#9b59b6] bg-[rgba(155,89,182,0.06)] text-[#9b59b6]'
                : 'border-[#333] bg-transparent text-zinc-500'
            }`}
          >
            RSI
          </button>
        </div>
      </div>

      {/* Top statistics summary (Interactive hover feedback) */}
      <div 
        className="grid gap-2 bg-[#050505] border border-[#333] p-2 rounded mb-3 text-[10px]"
        style={{ gridTemplateColumns: `repeat(${gridColsCount}, minmax(0, 1fr))` }}
      >
        <div>
          <span className="text-zinc-300 font-bold block">TICK/TIME</span>
          <span className="text-white font-black">{displayData.date}</span>
        </div>
        <div className="bg-[#0a1931] border border-[#3498db]/50 p-1 px-2 rounded -my-1 flex flex-col justify-center shadow-lg shadow-[#3498db]/10 min-w-0 overflow-hidden">
          <span className="text-[#3498db] block text-[8px] font-extrabold tracking-wider truncate">
            {hoverIndex !== null 
              ? "LAST PRICE" 
              : stock.isPreMarket 
              ? "PRE-MARKET" 
              : stock.isAfterHours 
              ? "AFTER-HOURS" 
              : "LAST PRICE"}
          </span>
          <span className="text-[#3498db] text-xs sm:text-sm md:text-base font-black block tracking-tight leading-tight mt-0.5 truncate">
            ${displayData.close.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-zinc-300 font-bold block">OPEN</span>
          <span className="text-[#ff9900] font-black">${displayData.open.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-zinc-300 font-bold block">HIGH</span>
          <span className="text-[#00ff00] font-black">${displayData.high.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-zinc-300 font-bold block">LOW</span>
          <span className="text-[#ff4444] font-black">${displayData.low.toFixed(2)}</span>
        </div>
        {showVolumeStudy && (
          <div>
            <span className="text-zinc-300 font-bold block">VOLUME</span>
            <span className="text-white font-black">{displayData.volume.toLocaleString()}</span>
          </div>
        )}
        {showRsiStudy && (
          <div>
            <span className="text-zinc-300 font-bold block">RSI (6)</span>
            <span className={`font-black ${
              currentRsi >= 80 ? 'text-[#ff4444]' : currentRsi <= 20 ? 'text-[#00ff00]' : 'text-[#9b59b6]'
            }`}>
              {currentRsi.toFixed(1)} {currentRsi >= 80 ? 'OB' : currentRsi <= 20 ? 'OS' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Primary SVG Stack Wrapper */}
      <div className="flex flex-col gap-2 relative bg-black rounded p-1.5 border border-[#222]">
        
        {/* PANEL 1: Main Price Chart */}
        <div ref={chartPanelRef} className="relative">
          <svg
            width={width}
            height={priceHeight}
            viewBox={`0 0 ${width} ${priceHeight}`}
            className="block w-full overflow-visible"
          >
            {/* Horizontal Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
              const hVal = pricePaddingTop + pct * priceAdjHeight;
              const priceVal = maxPrice - pct * priceRange;
              return (
                <g key={i}>
                  <line
                    x1={paddingLeft}
                    y1={hVal}
                    x2={width - paddingRight}
                    y2={hVal}
                    stroke="#222"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <text
                    x={paddingLeft - 6}
                    y={hVal + 3}
                    textAnchor="end"
                    fill="#e4e4e7"
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {formatAxisPrice(priceVal)}
                  </text>
                </g>
              );
            })}

            {/* Area & Line Charts */}
            {chartType === 'area' && (
              <path
                d={generateAreaPath()}
                fill="url(#grad-chart)"
                stroke="#00ff00"
                strokeWidth="1.5"
              />
            )}

            {chartType === 'line' && (
              <path
                d={generateLinePath()}
                fill="none"
                stroke="#00ff00"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            )}

            {/* Candlesticks layout */}
            {chartType === 'candle' &&
              history.map((h, i) => {
                const xPos = getX(i);
                const openY = getY(h.open);
                const closeY = getY(h.close);
                const highY = getY(h.high);
                const lowY = getY(h.low);

                const isUp = h.close >= h.open;
                const color = isUp ? '#00ff00' : '#ff4444';
                
                const topCandle = Math.min(openY, closeY);
                const botCandle = Math.max(openY, closeY);
                const candleHeight = Math.max(2, botCandle - topCandle);

                return (
                  <g key={`candle-${i}`}>
                    {/* High/Low wick line */}
                    <line
                      x1={xPos}
                      y1={highY}
                      x2={xPos}
                      y2={lowY}
                      stroke={color}
                      strokeWidth="1.2"
                    />
                    {/* Candle physical box */}
                    <rect
                      x={xPos - candleWidth / 2}
                      y={topCandle}
                      width={candleWidth}
                      height={candleHeight}
                      fill={isUp ? 'black' : color}
                      stroke={color}
                      strokeWidth="1.5"
                      className="cursor-crosshair"
                    />
                  </g>
                );
              })}

            {/* 3MA Indicator overlay */}
            {showIndicator && (
              <path
                d={generateMAPath()}
                fill="none"
                stroke="#ff9900"
                strokeWidth="1.5"
                strokeDasharray="4,2"
                opacity="0.8"
              />
            )}

            {/* Vertical Time Axis ticks */}
            {history.map((h, i) => {
              const showTick =
                i % labelStep === 0 ||
                (i === history.length - 1 &&
                  history.length - 1 - lastRegularTick >= Math.max(2, Math.ceil(labelStep * 0.6)));
              if (showTick) {
                return (
                  <g key={`text-${i}`}>
                    <line
                      x1={getX(i)}
                      y1={pricePaddingTop + priceAdjHeight}
                      x2={getX(i)}
                      y2={pricePaddingTop + priceAdjHeight + 3}
                      stroke="#444"
                    />
                    <text
                      x={getX(i)}
                      y={pricePaddingTop + priceAdjHeight + 13}
                      textAnchor="middle"
                      fill="#e4e4e7"
                      fontSize="9"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {h.date}
                    </text>
                  </g>
                );
              }
              return null;
            })}

            {/* Interactive hover detection vertical stripes */}
            {history.map((h, i) => (
              <rect
                key={`detect-${i}`}
                x={getX(i) - (adjWidth / history.length) / 2}
                y={pricePaddingTop}
                width={adjWidth / history.length}
                height={priceAdjHeight}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            ))}

            {/* Target Vertical Crosshair */}
            {hoverIndex !== null && (
              <g>
                <line
                  x1={getX(hoverIndex)}
                  y1={pricePaddingTop}
                  x2={getX(hoverIndex)}
                  y2={pricePaddingTop + priceAdjHeight}
                  stroke="#ff9900"
                  strokeWidth="0.8"
                  strokeDasharray="2,2"
                />
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY(history[hoverIndex].close)}
                  r="4"
                  fill="#ff9900"
                  stroke="black"
                  strokeWidth="1.5"
                />
              </g>
            )}

            {/* Color gradients */}
            <defs>
              <linearGradient id="grad-chart" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00ff00" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.0" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute top-1 left-[64px] text-[7px] text-zinc-500 font-bold uppercase select-none pointer-events-none">
            PRICE CHART
          </div>
        </div>

        {/* PANEL 2: Volume Study */}
        {showVolumeStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={volHeight}
              viewBox={`0 0 ${width} ${volHeight}`}
              className="block w-full overflow-visible"
            >
              {/* Multiple horizontal grid lines */}
              {[0.25, 0.5, 0.75].map((pct, idx) => {
                const yVal = volPaddingTop + pct * volAdjHeight;
                return (
                  <line
                    key={`vol-grid-${idx}`}
                    x1={paddingLeft}
                    y1={yVal}
                    x2={width - paddingRight}
                    y2={yVal}
                    stroke="#222"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                );
              })}

              {/* Volume Axis Labels */}
              <text
                x={paddingLeft - 6}
                y={volPaddingTop + 6}
                textAnchor="end"
                fill="#e4e4e7"
                fontSize="9.5"
                fontFamily="monospace"
                fontWeight="bold"
              >
                {formatAxisVolume(maxVolume)}
              </text>
              <text
                x={paddingLeft - 6}
                y={volPaddingTop + volAdjHeight + 3}
                textAnchor="end"
                fill="#e4e4e7"
                fontSize="9.5"
                fontFamily="monospace"
                fontWeight="bold"
              >
                0
              </text>

              {/* Volume bars */}
              {history.map((h, i) => {
                const barX = getX(i) - volBarWidth / 2;
                const barY = getVolY(h.volume);
                const barH = volPaddingTop + volAdjHeight - barY;
                const isGreen = h.close >= h.open;
                return (
                  <rect
                    key={`vol-bar-${i}`}
                    x={barX}
                    y={barY}
                    width={volBarWidth}
                    height={Math.max(2, barH)}
                    fill={isGreen ? 'rgba(0, 255, 0, 0.15)' : 'rgba(255, 68, 68, 0.15)'}
                    stroke={isGreen ? '#00ff00' : '#ff4444'}
                    strokeWidth="0.8"
                  />
                );
              })}

              {/* Hover detection for Volume */}
              {history.map((h, i) => (
                <rect
                  key={`vol-detect-${i}`}
                  x={getX(i) - (adjWidth / history.length) / 2}
                  y={volPaddingTop}
                  width={adjWidth / history.length}
                  height={volAdjHeight}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                />
              ))}

              {/* Hover crosshair */}
              {hoverIndex !== null && (
                <line
                  x1={getX(hoverIndex)}
                  y1={volPaddingTop}
                  x2={getX(hoverIndex)}
                  y2={volPaddingTop + volAdjHeight}
                  stroke="#ff9900"
                  strokeWidth="0.8"
                  strokeDasharray="2,2"
                />
              )}
            </svg>
            <div className="absolute top-1 left-[64px] text-[7px] text-zinc-500 font-bold uppercase select-none pointer-events-none">
              VOLUME STUDY
            </div>
          </div>
        )}

        {/* PANEL 3: RSI Study */}
        {showRsiStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={rsiHeight}
              viewBox={`0 0 ${width} ${rsiHeight}`}
              className="block w-full overflow-visible"
            >
              {/* Overbought region band (80 and above) */}
              <rect
                x={paddingLeft}
                y={getRsiY(100)}
                width={width - paddingLeft - paddingRight}
                height={getRsiY(80) - getRsiY(100)}
                fill="rgba(239, 68, 68, 0.08)"
              />
              {/* Oversold region band (20 and below) */}
              <rect
                x={paddingLeft}
                y={getRsiY(20)}
                width={width - paddingLeft - paddingRight}
                height={getRsiY(0) - getRsiY(20)}
                fill="rgba(34, 197, 94, 0.08)"
              />

              {/* Guidelines at 80 (Overbought), 50 (Neutral), and 20 (Oversold) */}
              {[20, 50, 80].map((level) => {
                const yVal = getRsiY(level);
                const strokeColor = level === 50 ? "#333" : level === 80 ? "rgba(239, 68, 68, 0.5)" : "rgba(34, 197, 94, 0.5)";
                const textColor = level === 50 ? "#a1a1aa" : level === 80 ? "#ef4444" : "#22c55e";
                const labelText = level === 80 ? "80 OB" : level === 20 ? "20 OS" : "50";
                return (
                  <g key={`rsi-lvl-${level}`}>
                    <line
                      x1={paddingLeft}
                      y1={yVal}
                      x2={width - paddingRight}
                      y2={yVal}
                      stroke={strokeColor}
                      strokeWidth="1"
                      strokeDasharray="2,2"
                    />
                    <text
                      x={paddingLeft - 6}
                      y={yVal + 3}
                      textAnchor="end"
                      fill={textColor}
                      fontSize="8.5"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {labelText}
                    </text>
                  </g>
                );
              })}

              {/* RSI oscillator path */}
              <path
                d={rsiList
                  .map((val, i) => `${i === 0 ? 'M' : 'L'}${getX(i)},${getRsiY(val)}`)
                  .join(' ')}
                fill="none"
                stroke="#9b59b6"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />

              {/* Hover detection for RSI */}
              {history.map((h, i) => (
                <rect
                  key={`rsi-detect-${i}`}
                  x={getX(i) - (adjWidth / history.length) / 2}
                  y={rsiPaddingTop}
                  width={adjWidth / history.length}
                  height={rsiAdjHeight}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                />
              ))}

              {/* Hover highlight dot and crosshair line */}
              {hoverIndex !== null && (
                <g>
                  <line
                    x1={getX(hoverIndex)}
                    y1={rsiPaddingTop}
                    x2={getX(hoverIndex)}
                    y2={rsiPaddingTop + rsiAdjHeight}
                    stroke="#ff9900"
                    strokeWidth="0.8"
                    strokeDasharray="2,2"
                  />
                  <circle
                    cx={getX(hoverIndex)}
                    cy={getRsiY(rsiList[hoverIndex])}
                    r="3"
                    fill="#ff9900"
                    stroke="black"
                    strokeWidth="1"
                  />
                </g>
              )}
            </svg>
            <div className="absolute top-1 left-[64px] text-[7px] text-zinc-500 font-bold uppercase select-none pointer-events-none">
              RSI OSCILLATOR (6)
            </div>
          </div>
        )}

      </div>

      <div className="flex justify-between items-center text-[9px] text-[#ff9900] mt-3 font-semibold select-none border-t border-[#333] pt-2">
        <span className="flex items-center gap-1.5">
          {historyLoading ? (
            <RefreshCw size={10} className="animate-spin text-[#ff9900]" />
          ) : (
            <Activity size={10} className="text-[#00ff00]" />
          )}
          <span>INTERVAL: {interval.toUpperCase()} ({history.length} LIVE BARS)</span>
        </span>
        <span className="text-zinc-500">
          STUDIES ACTIVE: {showVolumeStudy ? "VOL " : ""}{showRsiStudy ? "RSI " : ""}{showIndicator ? "3MA " : ""}
        </span>
      </div>
    </div>
  );
}

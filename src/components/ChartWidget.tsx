import { useState, useEffect, useRef } from 'react';
import { StockData } from '../types';
import { Activity, RefreshCw, X } from 'lucide-react';
import StudiesModal from './StudiesModal';
import {
  DEFAULT_STUDY_IDS,
  STUDIES_STORAGE_KEY,
  STUDY_CATALOG,
  StudyId,
  computeWilderRSIArray,
} from '../utils/technicalStudies';

interface ChartWidgetProps {
  stock: StockData;
  onTickTimeChange?: (val: string) => void;
}

type ChartType = 'candle' | 'line' | 'area';
type IntervalType = '5m' | '15m' | '30m' | '1h' | '1D' | '1W' | '1M';
type HistoryBar = StockData['history'][number];

const VALID_STUDY_IDS = new Set<string>(STUDY_CATALOG.map((s) => s.id));

function loadSavedStudies(): StudyId[] {
  try {
    const raw = localStorage.getItem(STUDIES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter(
          (id): id is StudyId => typeof id === 'string' && VALID_STUDY_IDS.has(id)
        );
        return Array.from(new Set(filtered));
      }
    }
  } catch {
    // ignore storage errors
  }
  return [...DEFAULT_STUDY_IDS];
}

export default function ChartWidget({ stock, onTickTimeChange }: ChartWidgetProps) {
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeStudies, setActiveStudies] = useState<StudyId[]>(loadSavedStudies);
  const [isStudiesModalOpen, setIsStudiesModalOpen] = useState<boolean>(false);
  const [interval, setInterval] = useState<IntervalType>('1h');
  const [fetchedHistory, setFetchedHistory] = useState<{
    symbol: string;
    interval: IntervalType;
    bars: HistoryBar[];
  } | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const chartPanelRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(600);

  useEffect(() => {
    try {
      localStorage.setItem(STUDIES_STORAGE_KEY, JSON.stringify(activeStudies));
    } catch {
      // ignore storage errors
    }
  }, [activeStudies]);

  const toggleStudy = (id: StudyId) => {
    setActiveStudies((prev) => {
      const exists = prev.includes(id);
      if (exists) {
        return prev.filter((item) => item !== id);
      }
      // If user turns on Volume MA, ensure Volume panel is visible too
      if (id === 'volMa' && !prev.includes('volume')) {
        return [...prev, 'volume', 'volMa'];
      }
      return [...prev, id];
    });
  };

  const handleResetStudies = () => {
    setActiveStudies([...DEFAULT_STUDY_IDS]);
  };

  const handleClearStudies = () => {
    setActiveStudies([]);
  };

  const hasStudy = (id: StudyId) => activeStudies.includes(id);

  useEffect(() => {
    if (!stock?.symbol) return;
    const sym = stock.symbol;
    const activeInt = interval;
    let cancelled = false;
    setHoverIndex(null);

    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const res = await fetch(
          `/api/market/history?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(activeInt)}`
        );
        const data = await res.json();
        if (!cancelled) {
          if (data.success && Array.isArray(data.history)) {
            setFetchedHistory({ symbol: sym, interval: activeInt, bars: data.history });
          } else {
            setFetchedHistory({ symbol: sym, interval: activeInt, bars: [] });
          }
        }
      } catch {
        if (!cancelled) {
          setFetchedHistory({ symbol: sym, interval: activeInt, bars: [] });
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

  const matchingFetched =
    fetchedHistory &&
    fetchedHistory.symbol === stock?.symbol &&
    fetchedHistory.interval === interval
      ? fetchedHistory.bars
      : [];

  const activeBars = matchingFetched;

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

  const showMa3 = hasStudy('ma3');
  const showEma9 = hasStudy('ema9');
  const showEma20 = hasStudy('ema20');
  const showSma50 = hasStudy('sma50');
  const showVwap = hasStudy('vwap');
  const showBb = hasStudy('bb');
  const showPsar = hasStudy('psar');
  const showLevels = hasStudy('levels');

  const showVolumeStudy = hasStudy('volume');
  const showVolMaStudy = hasStudy('volMa') && showVolumeStudy;
  const showAtrStudy = hasStudy('atr');
  const showObvStudy = hasStudy('obv');
  const showRsiStudy = hasStudy('rsi');
  const showMacdStudy = hasStudy('macd');
  const showStochStudy = hasStudy('stoch');
  const showCciStudy = hasStudy('cci');
  const showAdxStudy = hasStudy('adx');
  const showRocStudy = hasStudy('roc');

  const hasTimestamps = activeBars.every((b) => typeof b.timestamp === 'number');
  const history = activeBars.length > 0
    ? (hasTimestamps
        ? [...activeBars].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
        : [...activeBars].reverse())
    : [];

  const firstTs = history[0]?.timestamp;
  const lastTs = history[history.length - 1]?.timestamp;
  const spansMultipleDays =
    typeof firstTs === 'number' &&
    typeof lastTs === 'number' &&
    new Date(firstTs * 1000).toLocaleDateString() !== new Date(lastTs * 1000).toLocaleDateString();

  const formatBarLabel = (bar: HistoryBar, includeDateForIntraday = spansMultipleDays): string => {
    if (typeof bar.timestamp !== 'number') return bar.date;
    const d = new Date(bar.timestamp * 1000);
    if (['5m', '15m', '30m', '1h', '1D', '1W'].includes(interval)) {
      const hm = d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
      if (includeDateForIntraday || interval === '1W') {
        const md = d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
        return `${md} ${hm}`;
      }
      return hm;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const activeIndex = history.length > 0 ? (hoverIndex !== null ? hoverIndex : history.length - 1) : -1;
  const hoveredData = activeIndex >= 0 ? history[activeIndex] : undefined;
  const formattedHoveredDate = hoveredData ? formatBarLabel(hoveredData, true) : '';

  useEffect(() => {
    onTickTimeChange?.(formattedHoveredDate);
  }, [formattedHoveredDate, onTickTimeChange]);

  if (!stock || activeBars.length === 0 || !hoveredData) {
    return (
      <>
        <div className="bg-[#010101] border border-[#333] rounded p-6 text-center text-zinc-500 font-mono select-none">
          <div className="text-[#ff9900] font-bold text-sm mb-2 flex items-center justify-center gap-2">
            {historyLoading && <RefreshCw size={13} className="animate-spin text-[#ff9900]" />}
            <span>GRAPH PRICE (GP) COUPLING...</span>
          </div>
          <p className="text-xs text-zinc-400 mb-4">
            {historyLoading
              ? 'LOADING LIVE MARKET OHLCV BARS FOR '
              : 'NO HISTORICAL OHLCV BARS AVAILABLE FOR '}
            <span className="text-white font-extrabold">{stock ? stock.symbol : 'UNKNOWN'}</span> (
            {interval.toUpperCase()})
          </p>
          <div className="text-[10px] text-zinc-600">
            LIVE YAHOO FINANCE / ALPHA VANTAGE STREAM
          </div>
        </div>
        <StudiesModal
          isOpen={isStudiesModalOpen}
          onClose={() => setIsStudiesModalOpen(false)}
          activeStudies={activeStudies}
          onToggleStudy={toggleStudy}
          onResetDefaults={handleResetStudies}
          onClearAll={handleClearStudies}
        />
      </>
    );
  }

  // Chronological order & formatting already computed above for header tick sync
  const fallbackRsiList = computeWilderRSIArray(
    history.map((b) => b.close),
    14
  );
  const rsiList = history.map((b, i) =>
    typeof b.rsi === 'number' && !isNaN(b.rsi) ? b.rsi : fallbackRsiList[i]
  );

  // Layout & Coordinate constants
  const width = Math.max(320, chartWidth);
  const paddingLeft = 58;
  const paddingRight = 32;
  const adjWidth = Math.max(100, width - paddingLeft - paddingRight);

  const priceHeight = 184;
  const pricePaddingTop = 18;
  const pricePaddingBottom = 18;
  const priceAdjHeight = priceHeight - pricePaddingTop - pricePaddingBottom;

  const barStep = adjWidth / Math.max(history.length, 1);
  const candleWidth = Math.max(4, Math.min(14, Math.floor(barStep * 0.55)));
  const volBarWidth = Math.max(3, Math.min(12, Math.floor(barStep * 0.5)));

  const minLabelGapPx = (spansMultipleDays || interval === '1W') && interval !== '1M' ? 98 : 76;
  const maxLabels = Math.max(3, Math.floor(adjWidth / minLabelGapPx));
  const labelStep = Math.max(1, Math.ceil(history.length / maxLabels));
  const lastIdx = history.length - 1;

  const formatAxisPrice = (val: number) =>
    val >= 1000 ? val.toFixed(1) : val >= 10 ? val.toFixed(2) : val.toFixed(3);

  const formatAxisSigned = (val: number) => {
    if (Math.abs(val) >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
    return `${Math.round(val)}`;
  };

  const formatAxisVolume = (vol: number) => {
    if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(0)}K`;
    return `${Math.round(vol)}`;
  };

  const subPanelHeight = 68;
  const subPadTop = 12;
  const subPadBottom = 10;
  const subAdjHeight = subPanelHeight - subPadTop - subPadBottom;

  const volHeight = 65;
  const volPaddingTop = 10;
  const volPaddingBottom = 10;
  const volAdjHeight = volHeight - volPaddingTop - volPaddingBottom;

  const rsiHeight = 65;
  const rsiPaddingTop = 10;
  const rsiPaddingBottom = 10;
  const rsiAdjHeight = rsiHeight - rsiPaddingTop - rsiPaddingBottom;

  const windowHigh = Math.max(...history.map((h) => h.high));
  const windowLow = Math.min(...history.map((h) => h.low));
  const prevCloseRef =
    typeof stock.prevClose === 'number' && stock.prevClose > 0 ? stock.prevClose : null;

  // Price boundaries include all enabled overlays so nothing clips
  const overlayValues: number[] = [];
  history.forEach((h) => {
    if (showMa3 && typeof h.ma3 === 'number') overlayValues.push(h.ma3);
    if (showEma9 && typeof h.ema9 === 'number') overlayValues.push(h.ema9);
    if (showEma20 && typeof h.ema20 === 'number') overlayValues.push(h.ema20);
    if (showSma50 && typeof h.sma50 === 'number') overlayValues.push(h.sma50);
    if (showVwap && typeof h.vwap === 'number') overlayValues.push(h.vwap);
    if (showBb) {
      if (typeof h.bbUpper === 'number') overlayValues.push(h.bbUpper);
      if (typeof h.bbLower === 'number') overlayValues.push(h.bbLower);
    }
    if (showPsar && typeof h.psar === 'number') overlayValues.push(h.psar);
  });
  if (showLevels && prevCloseRef !== null) {
    overlayValues.push(prevCloseRef);
  }

  const prices = [
    ...history.flatMap((h) => [h.high, h.low, h.close, h.open]),
    ...overlayValues,
  ];
  const maxPrice = Math.max(...prices) * 1.008;
  const minPrice = Math.min(...prices) * 0.992;
  const priceRange = Math.max(maxPrice - minPrice, 0.0001);

  // Volume boundaries (include volMa if active)
  const volSeries = history.map((h) => h.volume);
  const volMaSeries = showVolMaStudy
    ? history.map((h) => h.volMa).filter((v): v is number => typeof v === 'number' && !isNaN(v))
    : [];
  const maxVolume = Math.max(...volSeries, ...volMaSeries, 1);

  const getX = (index: number) => {
    if (history.length <= 1) return paddingLeft + adjWidth / 2;
    return paddingLeft + (index / (history.length - 1)) * adjWidth;
  };

  const getY = (price: number) =>
    pricePaddingTop + priceAdjHeight - ((price - minPrice) / priceRange) * priceAdjHeight;

  const getVolY = (volume: number) =>
    volPaddingTop + volAdjHeight - (volume / maxVolume) * volAdjHeight;

  const getRsiY = (rsiVal: number) =>
    rsiPaddingTop + rsiAdjHeight - (rsiVal / 100) * rsiAdjHeight;

  const generateSeriesPath = (getter: (bar: HistoryBar, idx: number) => number | undefined, yMapper: (val: number) => number) => {
    const pts: string[] = [];
    for (let i = 0; i < history.length; i++) {
      const val = getter(history[i], i);
      if (typeof val === 'number' && !isNaN(val)) {
        pts.push(`${pts.length === 0 ? 'M' : 'L'}${getX(i)},${yMapper(val)}`);
      }
    }
    return pts.join(' ');
  };

  const generateLinePath = () =>
    history.map((h, i) => `${i === 0 ? 'M' : 'L'}${getX(i)},${getY(h.close)}`).join(' ');

  const generateAreaPath = () => {
    const linePath = generateLinePath();
    return `${linePath} L${getX(history.length - 1)},${getY(minPrice)} L${getX(0)},${getY(minPrice)} Z`;
  };

  const getMA3 = (bar: HistoryBar, index: number): number | undefined => {
    if (typeof bar.ma3 === 'number' && !isNaN(bar.ma3)) return bar.ma3;
    if (index < 2) return undefined;
    return (history[index].close + history[index - 1].close + history[index - 2].close) / 3;
  };

  // Bollinger Band polygon fill path
  const generateBollingerFillPath = () => {
    const upperPts: Array<{ x: number; y: number }> = [];
    const lowerPts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < history.length; i++) {
      const u = history[i].bbUpper;
      const l = history[i].bbLower;
      if (typeof u === 'number' && typeof l === 'number') {
        const x = getX(i);
        upperPts.push({ x, y: getY(u) });
        lowerPts.push({ x, y: getY(l) });
      }
    }
    if (upperPts.length < 2) return '';
    const topStr = upperPts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const botStr = [...lowerPts].reverse().map((p) => `L${p.x},${p.y}`).join(' ');
    return `${topStr} ${botStr} Z`;
  };

  const displayData =
    hoverIndex !== null
      ? {
          date: formattedHoveredDate,
          open: hoveredData.open,
          high: hoveredData.high,
          low: hoveredData.low,
          close: hoveredData.close,
          volume: hoveredData.volume,
        }
      : {
          date: formattedHoveredDate,
          open: typeof stock.open === 'number' && stock.open > 0 ? stock.open : hoveredData.open,
          high: typeof stock.high === 'number' && stock.high > 0 ? stock.high : hoveredData.high,
          low: typeof stock.low === 'number' && stock.low > 0 ? stock.low : hoveredData.low,
          close: typeof stock.price === 'number' && stock.price > 0 ? stock.price : hoveredData.close,
          volume: typeof stock.volume === 'number' && stock.volume > 0 ? stock.volume : hoveredData.volume,
        };
  const currentRsi = rsiList[activeIndex];

  const statsColClass =
    showVolumeStudy && showRsiStudy
      ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
      : showVolumeStudy || showRsiStudy
      ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
      : 'grid-cols-2 sm:grid-cols-4';

  // Active overlay readout legend items
  const activeOverlayItems = [
    showMa3 && { id: 'ma3' as StudyId, label: '3MA', val: getMA3(hoveredData, activeIndex), colorClass: 'text-[#ff9900]' },
    showEma9 && { id: 'ema9' as StudyId, label: '9EMA', val: hoveredData.ema9, colorClass: 'text-[#38bdf8]' },
    showEma20 && { id: 'ema20' as StudyId, label: '20EMA', val: hoveredData.ema20, colorClass: 'text-[#f472b6]' },
    showSma50 && { id: 'sma50' as StudyId, label: '50SMA', val: hoveredData.sma50, colorClass: 'text-[#eab308]' },
    showVwap && { id: 'vwap' as StudyId, label: 'VWAP', val: hoveredData.vwap, colorClass: 'text-[#2dd4bf]' },
    showBb && { id: 'bb' as StudyId, label: 'BB(20,2)', val: hoveredData.bbMid, colorClass: 'text-[#60a5fa]' },
    showPsar && { id: 'psar' as StudyId, label: 'PSAR', val: hoveredData.psar, colorClass: 'text-[#fbbf24]' },
  ].filter((x): x is { id: StudyId; label: string; val: number | undefined; colorClass: string } => Boolean(x));

  const renderPanelHoverStripes = (keyPrefix: string) => (
    <>
      {history.map((_, i) => (
        <rect
          key={`${keyPrefix}-detect-${i}`}
          x={getX(i) - adjWidth / history.length / 2}
          y={subPadTop}
          width={adjWidth / history.length}
          height={subAdjHeight}
          fill="transparent"
          className="cursor-crosshair"
          onMouseEnter={() => setHoverIndex(i)}
          onMouseLeave={() => setHoverIndex(null)}
        />
      ))}
      {hoverIndex !== null && (
        <line
          x1={getX(hoverIndex)}
          y1={subPadTop}
          x2={getX(hoverIndex)}
          y2={subPadTop + subAdjHeight}
          stroke="#ff9900"
          strokeWidth="0.8"
          strokeDasharray="2,2"
        />
      )}
    </>
  );

  // Precompute sub-panel domains
  // 1. MACD
  const macdValues = history.flatMap((h) =>
    [h.macd, h.macdSignal, h.macdHist].filter((v): v is number => typeof v === 'number' && !isNaN(v))
  );
  const macdMaxAbs = Math.max(0.01, ...macdValues.map((v) => Math.abs(v))) * 1.15;
  const getMacdY = (v: number) =>
    subPadTop + subAdjHeight - ((v + macdMaxAbs) / (2 * macdMaxAbs)) * subAdjHeight;

  // 2. Stochastic (0..100)
  const getStochY = (v: number) => subPadTop + subAdjHeight - (v / 100) * subAdjHeight;

  // 3. CCI
  const cciVals = history.map((h) => h.cci).filter((v): v is number => typeof v === 'number' && !isNaN(v));
  const cciMax = Math.max(120, ...(cciVals.length ? cciVals : [120])) * 1.08;
  const cciMin = Math.min(-120, ...(cciVals.length ? cciVals : [-120])) * 1.08;
  const cciSpan = Math.max(cciMax - cciMin, 1);
  const getCciY = (v: number) => subPadTop + subAdjHeight - ((v - cciMin) / cciSpan) * subAdjHeight;

  // 4. ADX / DMI
  const adxVals = history.flatMap((h) =>
    [h.adx, h.plusDi, h.minusDi].filter((v): v is number => typeof v === 'number' && !isNaN(v))
  );
  const adxMax = Math.max(55, ...(adxVals.length ? adxVals : [55])) * 1.05;
  const getAdxY = (v: number) => subPadTop + subAdjHeight - (v / adxMax) * subAdjHeight;

  // 5. ATR
  const atrVals = history.map((h) => h.atr).filter((v): v is number => typeof v === 'number' && !isNaN(v));
  const atrMax = (atrVals.length ? Math.max(...atrVals) : 1) * 1.1;
  const atrMin = (atrVals.length ? Math.min(...atrVals) : 0) * 0.9;
  const atrSpan = Math.max(atrMax - atrMin, 0.0001);
  const getAtrY = (v: number) => subPadTop + subAdjHeight - ((v - atrMin) / atrSpan) * subAdjHeight;

  // 6. OBV
  const obvVals = history.map((h) => h.obv ?? 0);
  const obvMax = Math.max(...obvVals, 1);
  const obvMin = Math.min(...obvVals, 0);
  const obvSpan = Math.max(obvMax - obvMin, 1);
  const getObvY = (v: number) => subPadTop + subAdjHeight - ((v - obvMin) / obvSpan) * subAdjHeight;

  // 7. ROC
  const rocVals = history.map((h) => h.roc).filter((v): v is number => typeof v === 'number' && !isNaN(v));
  const rocMaxAbs = Math.max(0.5, ...rocVals.map((v) => Math.abs(v))) * 1.15;
  const getRocY = (v: number) =>
    subPadTop + subAdjHeight - ((v + rocMaxAbs) / (2 * rocMaxAbs)) * subAdjHeight;

  const activeStudyNames = activeStudies
    .map((id) => STUDY_CATALOG.find((s) => s.id === id)?.code || id.toUpperCase())
    .join(' ');

  return (
    <div className="bg-[#010101] border border-[#333] rounded p-3.5 text-xs font-mono select-none">
      {/* Chart Headers */}
      <div className="flex flex-col sm:flex-row items-baseline sm:items-center justify-between border-b border-[#333] pb-2 mb-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-extrabold uppercase tracking-wider leading-tight min-w-0">
            <span className="text-[#ff9900]">{stock.symbol}</span>
            <span className="text-zinc-600 font-normal">|</span>
            <span className="text-white truncate max-w-[260px] sm:max-w-none">{stock.name}</span>
            {stock.exchange && (
              <>
                <span className="text-zinc-600 font-normal">|</span>
                <span className="text-zinc-400 text-[11px] sm:text-xs font-bold">{stock.exchange}</span>
              </>
            )}
            {stock.isPreMarket && (
              <span className="text-[9px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded font-extrabold border border-amber-500/30 ml-1">
                PRE-MARKET ACTIVE
              </span>
            )}
            {stock.isAfterHours && (
              <span className="text-[9px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded font-extrabold border border-indigo-500/30 ml-1">
                AFTER HOURS ACTIVE
              </span>
            )}
          </div>
        </div>

        {/* Options Row */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2 sm:mt-0">
          <div className="flex rounded bg-black border border-[#333] overflow-hidden mr-1">
            {(['5m', '15m', '30m', '1h', '1D', '1W', '1M'] as IntervalType[]).map((int) => (
              <button
                key={int}
                type="button"
                onClick={() => setInterval(int)}
                className={`px-2.5 py-1 text-[11px] sm:text-xs font-bold transition-all cursor-pointer border-r border-[#222] last:border-0 ${
                  interval === int
                    ? 'bg-[#00ff00] text-black font-extrabold'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                }`}
                title={
                  int === '5m'
                    ? 'Last 5 Minutes (Today)'
                    : int === '15m'
                    ? 'Last 15 Minutes (Today)'
                    : int === '30m'
                    ? 'Last 30 Minutes (Today)'
                    : int === '1h'
                    ? 'Last 60 Minutes (Today)'
                    : int === '1D'
                    ? 'Current Day (Today)'
                    : int === '1W'
                    ? 'Last 7 Days'
                    : 'Last 30/31 Days'
                }
              >
                {int.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex rounded bg-black border border-[#333] overflow-hidden mr-1">
            <button
              type="button"
              onClick={() => setChartType('candle')}
              className={`px-2.5 py-1 text-[11px] sm:text-xs font-bold transition-colors cursor-pointer ${
                chartType === 'candle' ? 'bg-[#ff9900] text-black' : 'text-zinc-400 hover:text-white'
              }`}
            >
              CANDLES
            </button>
            <button
              type="button"
              onClick={() => setChartType('line')}
              className={`px-2.5 py-1 text-[11px] sm:text-xs font-bold transition-colors cursor-pointer ${
                chartType === 'line' ? 'bg-[#ff9900] text-black' : 'text-zinc-400 hover:text-white'
              }`}
            >
              LINE
            </button>
            <button
              type="button"
              onClick={() => setChartType('area')}
              className={`px-2.5 py-1 text-[11px] sm:text-xs font-bold transition-colors cursor-pointer ${
                chartType === 'area' ? 'bg-[#ff9900] text-black' : 'text-zinc-400 hover:text-white'
              }`}
            >
              AREA
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsStudiesModalOpen(true)}
            className="px-3 py-1 rounded border border-[#3498db] bg-[#0a1931]/60 hover:bg-[#3498db] text-[#3498db] hover:text-black text-[11px] sm:text-xs font-extrabold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Choose overlays, momentum oscillators, and volatility studies"
          >
            STUDIES ({activeStudies.length})
          </button>
        </div>
      </div>

      {/* Top statistics summary (Interactive hover feedback) */}
      <div className={`grid gap-2 bg-[#050505] border border-[#333] p-2 rounded mb-3 text-[10px] tabular-nums ${statsColClass}`}>
        <div className="bg-[#0a1931] border border-[#3498db]/50 p-1 px-2 rounded -my-1 flex flex-col justify-center shadow-lg shadow-[#3498db]/10 min-w-0 overflow-hidden">
          <span className="text-[#3498db] block text-[8px] font-extrabold tracking-wider truncate">
            {hoverIndex !== null
              ? 'LAST PRICE'
              : stock.isPreMarket
              ? 'PRE-MARKET'
              : stock.isAfterHours
              ? 'AFTER-HOURS'
              : 'LAST PRICE'}
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
            <span className="text-zinc-300 font-bold block">RSI (14)</span>
            <span
              className={`font-black ${
                currentRsi >= 70 ? 'text-[#ff4444]' : currentRsi <= 30 ? 'text-[#00ff00]' : 'text-[#9b59b6]'
              }`}
            >
              {currentRsi.toFixed(1)} {currentRsi >= 70 ? 'OB' : currentRsi <= 30 ? 'OS' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Primary SVG Stack Wrapper */}
      <div className="flex flex-col gap-2 relative bg-black rounded p-1.5 border border-[#222]">
        {/* PANEL 1: Main Price Chart */}
        <div ref={chartPanelRef} className="relative">
          <div className="px-1.5 pb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[8px] font-bold uppercase select-none">
            <span className="text-zinc-500">PRICE CHART</span>
            {activeOverlayItems.map((item) => (
              <span key={item.id} className={`${item.colorClass} tabular-nums`}>
                {item.label}: {typeof item.val === 'number' ? item.val.toFixed(2) : '--'}
              </span>
            ))}
          </div>
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

            {/* Support / Resistance Levels Overlay */}
            {showLevels && (
              <g>
                <line
                  x1={paddingLeft}
                  y1={getY(windowHigh)}
                  x2={width - paddingRight}
                  y2={getY(windowHigh)}
                  stroke="rgba(0, 255, 0, 0.45)"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                />
                <text
                  x={width - paddingRight + 3}
                  y={getY(windowHigh) + 3}
                  fill="#00ff00"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  HI
                </text>
                <line
                  x1={paddingLeft}
                  y1={getY(windowLow)}
                  x2={width - paddingRight}
                  y2={getY(windowLow)}
                  stroke="rgba(255, 68, 68, 0.45)"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                />
                <text
                  x={width - paddingRight + 3}
                  y={getY(windowLow) + 3}
                  fill="#ff4444"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  LO
                </text>
                {prevCloseRef !== null && (
                  <>
                    <line
                      x1={paddingLeft}
                      y1={getY(prevCloseRef)}
                      x2={width - paddingRight}
                      y2={getY(prevCloseRef)}
                      stroke="rgba(52, 152, 219, 0.65)"
                      strokeWidth="1"
                      strokeDasharray="4,3"
                    />
                    <text
                      x={width - paddingRight + 3}
                      y={getY(prevCloseRef) + 3}
                      fill="#3498db"
                      fontSize="8"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      PC
                    </text>
                  </>
                )}
              </g>
            )}

            {/* Bollinger Bands Envelope */}
            {showBb && (
              <g>
                <path d={generateBollingerFillPath()} fill="rgba(96, 165, 250, 0.08)" />
                <path
                  d={generateSeriesPath((b) => b.bbUpper, getY)}
                  fill="none"
                  stroke="#60a5fa"
                  strokeWidth="1.1"
                  opacity="0.85"
                />
                <path
                  d={generateSeriesPath((b) => b.bbMid, getY)}
                  fill="none"
                  stroke="#60a5fa"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                  opacity="0.65"
                />
                <path
                  d={generateSeriesPath((b) => b.bbLower, getY)}
                  fill="none"
                  stroke="#60a5fa"
                  strokeWidth="1.1"
                  opacity="0.85"
                />
              </g>
            )}

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
                    <line x1={xPos} y1={highY} x2={xPos} y2={lowY} stroke={color} strokeWidth="1.2" />
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

            {/* Moving Average & VWAP Overlays */}
            {showSma50 && (
              <path
                d={generateSeriesPath((b) => b.sma50, getY)}
                fill="none"
                stroke="#eab308"
                strokeWidth="1.4"
                opacity="0.9"
              />
            )}
            {showEma20 && (
              <path
                d={generateSeriesPath((b) => b.ema20, getY)}
                fill="none"
                stroke="#f472b6"
                strokeWidth="1.4"
                opacity="0.9"
              />
            )}
            {showEma9 && (
              <path
                d={generateSeriesPath((b) => b.ema9, getY)}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.4"
                opacity="0.9"
              />
            )}
            {showVwap && (
              <path
                d={generateSeriesPath((b) => b.vwap, getY)}
                fill="none"
                stroke="#2dd4bf"
                strokeWidth="1.5"
                strokeDasharray="5,2"
                opacity="0.9"
              />
            )}
            {showMa3 && (
              <path
                d={generateSeriesPath(getMA3, getY)}
                fill="none"
                stroke="#ff9900"
                strokeWidth="1.5"
                strokeDasharray="4,2"
                opacity="0.85"
              />
            )}

            {/* Parabolic SAR Dots */}
            {showPsar &&
              history.map((h, i) => {
                if (typeof h.psar !== 'number' || isNaN(h.psar)) return null;
                return (
                  <circle
                    key={`psar-${i}`}
                    cx={getX(i)}
                    cy={getY(h.psar)}
                    r="2"
                    fill={h.psarUp ? '#00ff00' : '#ff4444'}
                    opacity="0.9"
                  />
                );
              })}

            {/* Vertical Time Axis ticks */}
            {history.map((h, i) => {
              const showTick =
                i === lastIdx ||
                (i % labelStep === 0 && getX(lastIdx) - getX(i) >= minLabelGapPx * 0.78);
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
                      {formatBarLabel(h)}
                    </text>
                  </g>
                );
              }
              return null;
            })}

            {/* Interactive hover detection vertical stripes */}
            {history.map((_, i) => (
              <rect
                key={`detect-${i}`}
                x={getX(i) - adjWidth / history.length / 2}
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

            <defs>
              <linearGradient id="grad-chart" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00ff00" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.0" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* PANEL 2: Volume Study (+ Optional Vol MA 20) */}
        {showVolumeStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={volHeight}
              viewBox={`0 0 ${width} ${volHeight}`}
              className="block w-full overflow-visible"
            >
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

              {history.map((h, i) => {
                const barX = getX(i) - volBarWidth / 2;
                const rawBarY = getVolY(h.volume);
                const rawBarH = volPaddingTop + volAdjHeight - rawBarY;
                const barH = h.volume > 0 ? Math.max(2, rawBarH) : 1;
                const barY = volPaddingTop + volAdjHeight - barH;
                const isGreen = h.close >= h.open;
                return (
                  <rect
                    key={`vol-bar-${i}`}
                    x={barX}
                    y={barY}
                    width={volBarWidth}
                    height={barH}
                    fill={isGreen ? 'rgba(0, 255, 0, 0.15)' : 'rgba(255, 68, 68, 0.15)'}
                    stroke={isGreen ? '#00ff00' : '#ff4444'}
                    strokeWidth="0.8"
                  />
                );
              })}

              {showVolMaStudy && (
                <path
                  d={generateSeriesPath((b) => b.volMa, getVolY)}
                  fill="none"
                  stroke="#ff9900"
                  strokeWidth="1.4"
                  opacity="0.9"
                />
              )}

              {history.map((_, i) => (
                <rect
                  key={`vol-detect-${i}`}
                  x={getX(i) - adjWidth / history.length / 2}
                  y={volPaddingTop}
                  width={adjWidth / history.length}
                  height={volAdjHeight}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                />
              ))}

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
            <div className="absolute top-1 left-[64px] right-2 flex items-center justify-between text-[8px] font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-500 flex items-center gap-2">
                <span>VOLUME STUDY</span>
                {showVolMaStudy && (
                  <span className="text-[#ff9900] tabular-nums">
                    MA(20): {typeof hoveredData.volMa === 'number' ? formatAxisVolume(hoveredData.volMa) : '--'}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => toggleStudy('volume')}
                title="Hide Volume study"
                aria-label="Hide Volume study"
                className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
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
              <rect
                x={paddingLeft}
                y={getRsiY(100)}
                width={width - paddingLeft - paddingRight}
                height={getRsiY(70) - getRsiY(100)}
                fill="rgba(239, 68, 68, 0.08)"
              />
              <rect
                x={paddingLeft}
                y={getRsiY(30)}
                width={width - paddingLeft - paddingRight}
                height={getRsiY(0) - getRsiY(30)}
                fill="rgba(34, 197, 94, 0.08)"
              />

              {[30, 50, 70].map((level) => {
                const yVal = getRsiY(level);
                const strokeColor =
                  level === 50 ? '#333' : level === 70 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(34, 197, 94, 0.5)';
                const textColor = level === 50 ? '#a1a1aa' : level === 70 ? '#ef4444' : '#22c55e';
                const labelText = level === 70 ? '70 OB' : level === 30 ? '30 OS' : '50';
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

              <path
                d={rsiList.map((val, i) => `${i === 0 ? 'M' : 'L'}${getX(i)},${getRsiY(val)}`).join(' ')}
                fill="none"
                stroke="#9b59b6"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />

              {history.map((_, i) => (
                <rect
                  key={`rsi-detect-${i}`}
                  x={getX(i) - adjWidth / history.length / 2}
                  y={rsiPaddingTop}
                  width={adjWidth / history.length}
                  height={rsiAdjHeight}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                />
              ))}

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
            <div className="absolute top-1 left-[64px] right-2 flex items-center justify-between text-[8px] font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-500">
                RSI OSCILLATOR (14){' '}
                <span className="text-[#9b59b6] tabular-nums ml-1">{currentRsi.toFixed(1)}</span>
              </span>
              <button
                type="button"
                onClick={() => toggleStudy('rsi')}
                title="Hide RSI study"
                aria-label="Hide RSI study"
                className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* PANEL 4: MACD (12, 26, 9) */}
        {showMacdStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
            >
              {/* Zero line & bounds */}
              <line
                x1={paddingLeft}
                y1={getMacdY(0)}
                x2={width - paddingRight}
                y2={getMacdY(0)}
                stroke="#333"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              {[macdMaxAbs, 0, -macdMaxAbs].map((lvl, idx) => (
                <text
                  key={`macd-lbl-${idx}`}
                  x={paddingLeft - 6}
                  y={getMacdY(lvl) + 3}
                  textAnchor="end"
                  fill="#a1a1aa"
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {lvl === 0 ? '0' : lvl.toFixed(2)}
                </text>
              ))}

              {/* Histogram bars */}
              {history.map((h, i) => {
                if (typeof h.macdHist !== 'number' || isNaN(h.macdHist)) return null;
                const yZero = getMacdY(0);
                const yVal = getMacdY(h.macdHist);
                const barTop = Math.min(yZero, yVal);
                const barH = Math.max(1, Math.abs(yVal - yZero));
                const pos = h.macdHist >= 0;
                return (
                  <rect
                    key={`macd-hist-${i}`}
                    x={getX(i) - volBarWidth / 2}
                    y={barTop}
                    width={volBarWidth}
                    height={barH}
                    fill={pos ? 'rgba(0, 255, 0, 0.35)' : 'rgba(255, 68, 68, 0.35)'}
                  />
                );
              })}

              <path
                d={generateSeriesPath((b) => b.macd, getMacdY)}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.4"
              />
              <path
                d={generateSeriesPath((b) => b.macdSignal, getMacdY)}
                fill="none"
                stroke="#ff9900"
                strokeWidth="1.3"
              />

              {renderPanelHoverStripes('macd')}
            </svg>
            <div className="absolute top-1 left-[64px] right-2 flex items-center justify-between text-[8px] font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-500 flex items-center gap-2 tabular-nums">
                <span>MACD (12,26,9)</span>
                <span className="text-[#38bdf8]">
                  M: {typeof hoveredData.macd === 'number' ? hoveredData.macd.toFixed(2) : '--'}
                </span>
                <span className="text-[#ff9900]">
                  S: {typeof hoveredData.macdSignal === 'number' ? hoveredData.macdSignal.toFixed(2) : '--'}
                </span>
                <span className={(hoveredData.macdHist ?? 0) >= 0 ? 'text-[#00ff00]' : 'text-[#ff4444]'}>
                  H: {typeof hoveredData.macdHist === 'number' ? hoveredData.macdHist.toFixed(2) : '--'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggleStudy('macd')}
                title="Hide MACD study"
                aria-label="Hide MACD study"
                className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* PANEL 5: Slow Stochastic (14, 3, 3) */}
        {showStochStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
            >
              <rect
                x={paddingLeft}
                y={getStochY(100)}
                width={width - paddingLeft - paddingRight}
                height={getStochY(80) - getStochY(100)}
                fill="rgba(239, 68, 68, 0.08)"
              />
              <rect
                x={paddingLeft}
                y={getStochY(20)}
                width={width - paddingLeft - paddingRight}
                height={getStochY(0) - getStochY(20)}
                fill="rgba(34, 197, 94, 0.08)"
              />
              {[20, 50, 80].map((lvl) => (
                <g key={`stoch-lvl-${lvl}`}>
                  <line
                    x1={paddingLeft}
                    y1={getStochY(lvl)}
                    x2={width - paddingRight}
                    y2={getStochY(lvl)}
                    stroke={lvl === 50 ? '#333' : lvl === 80 ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.5)'}
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <text
                    x={paddingLeft - 6}
                    y={getStochY(lvl) + 3}
                    textAnchor="end"
                    fill={lvl === 50 ? '#a1a1aa' : lvl === 80 ? '#ef4444' : '#22c55e'}
                    fontSize="8.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {lvl}
                  </text>
                </g>
              ))}
              <path
                d={generateSeriesPath((b) => b.stochK, getStochY)}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="1.4"
              />
              <path
                d={generateSeriesPath((b) => b.stochD, getStochY)}
                fill="none"
                stroke="#f97316"
                strokeWidth="1.2"
                strokeDasharray="3,2"
              />
              {renderPanelHoverStripes('stoch')}
            </svg>
            <div className="absolute top-1 left-[64px] right-2 flex items-center justify-between text-[8px] font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-500 flex items-center gap-2 tabular-nums">
                <span>STOCH (14,3,3)</span>
                <span className="text-[#22d3ee]">
                  %K: {typeof hoveredData.stochK === 'number' ? hoveredData.stochK.toFixed(1) : '--'}
                </span>
                <span className="text-[#f97316]">
                  %D: {typeof hoveredData.stochD === 'number' ? hoveredData.stochD.toFixed(1) : '--'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggleStudy('stoch')}
                title="Hide Stochastic study"
                aria-label="Hide Stochastic study"
                className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* PANEL 6: CCI (20) */}
        {showCciStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
            >
              {[100, 0, -100].map((lvl) => (
                <g key={`cci-lvl-${lvl}`}>
                  <line
                    x1={paddingLeft}
                    y1={getCciY(lvl)}
                    x2={width - paddingRight}
                    y2={getCciY(lvl)}
                    stroke={lvl === 0 ? '#333' : lvl === 100 ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.45)'}
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <text
                    x={paddingLeft - 6}
                    y={getCciY(lvl) + 3}
                    textAnchor="end"
                    fill={lvl === 0 ? '#a1a1aa' : lvl === 100 ? '#ef4444' : '#22c55e'}
                    fontSize="8.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {lvl > 0 ? `+${lvl}` : lvl}
                  </text>
                </g>
              ))}
              <path
                d={generateSeriesPath((b) => b.cci, getCciY)}
                fill="none"
                stroke="#a3e635"
                strokeWidth="1.4"
              />
              {renderPanelHoverStripes('cci')}
            </svg>
            <div className="absolute top-1 left-[64px] right-2 flex items-center justify-between text-[8px] font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-500 flex items-center gap-2 tabular-nums">
                <span>CCI (20)</span>
                <span className="text-[#a3e635]">
                  {typeof hoveredData.cci === 'number' ? hoveredData.cci.toFixed(1) : '--'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggleStudy('cci')}
                title="Hide CCI study"
                aria-label="Hide CCI study"
                className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* PANEL 7: ADX / DMI (14) */}
        {showAdxStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
            >
              {[25, Math.round(adxMax)].map((lvl, idx) => (
                <g key={`adx-lvl-${idx}`}>
                  <line
                    x1={paddingLeft}
                    y1={getAdxY(lvl)}
                    x2={width - paddingRight}
                    y2={getAdxY(lvl)}
                    stroke={lvl === 25 ? '#444' : '#222'}
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <text
                    x={paddingLeft - 6}
                    y={getAdxY(lvl) + 3}
                    textAnchor="end"
                    fill="#a1a1aa"
                    fontSize="8.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {lvl}
                  </text>
                </g>
              ))}
              <path
                d={generateSeriesPath((b) => b.plusDi, getAdxY)}
                fill="none"
                stroke="#00ff00"
                strokeWidth="1.1"
                opacity="0.8"
              />
              <path
                d={generateSeriesPath((b) => b.minusDi, getAdxY)}
                fill="none"
                stroke="#ff4444"
                strokeWidth="1.1"
                opacity="0.8"
              />
              <path
                d={generateSeriesPath((b) => b.adx, getAdxY)}
                fill="none"
                stroke="#e4e4e7"
                strokeWidth="1.5"
              />
              {renderPanelHoverStripes('adx')}
            </svg>
            <div className="absolute top-1 left-[64px] right-2 flex items-center justify-between text-[8px] font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-500 flex items-center gap-2 tabular-nums">
                <span>ADX / DMI (14)</span>
                <span className="text-zinc-200">
                  ADX: {typeof hoveredData.adx === 'number' ? hoveredData.adx.toFixed(1) : '--'}
                </span>
                <span className="text-[#00ff00]">
                  +DI: {typeof hoveredData.plusDi === 'number' ? hoveredData.plusDi.toFixed(1) : '--'}
                </span>
                <span className="text-[#ff4444]">
                  -DI: {typeof hoveredData.minusDi === 'number' ? hoveredData.minusDi.toFixed(1) : '--'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggleStudy('adx')}
                title="Hide ADX / DMI study"
                aria-label="Hide ADX / DMI study"
                className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* PANEL 8: ATR (14) */}
        {showAtrStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
            >
              {[atrMax, (atrMax + atrMin) / 2, atrMin].map((lvl, idx) => (
                <g key={`atr-lvl-${idx}`}>
                  <line
                    x1={paddingLeft}
                    y1={getAtrY(lvl)}
                    x2={width - paddingRight}
                    y2={getAtrY(lvl)}
                    stroke="#222"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <text
                    x={paddingLeft - 6}
                    y={getAtrY(lvl) + 3}
                    textAnchor="end"
                    fill="#a1a1aa"
                    fontSize="8.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {lvl.toFixed(2)}
                  </text>
                </g>
              ))}
              <path
                d={generateSeriesPath((b) => b.atr, getAtrY)}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="1.5"
              />
              {renderPanelHoverStripes('atr')}
            </svg>
            <div className="absolute top-1 left-[64px] right-2 flex items-center justify-between text-[8px] font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-500 flex items-center gap-2 tabular-nums">
                <span>ATR (14)</span>
                <span className="text-[#f59e0b]">
                  ${typeof hoveredData.atr === 'number' ? hoveredData.atr.toFixed(3) : '--'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggleStudy('atr')}
                title="Hide ATR study"
                aria-label="Hide ATR study"
                className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* PANEL 9: OBV (On-Balance Volume) */}
        {showObvStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
            >
              {[obvMax, obvMin].map((lvl, idx) => (
                <g key={`obv-lvl-${idx}`}>
                  <line
                    x1={paddingLeft}
                    y1={getObvY(lvl)}
                    x2={width - paddingRight}
                    y2={getObvY(lvl)}
                    stroke="#222"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <text
                    x={paddingLeft - 6}
                    y={getObvY(lvl) + 3}
                    textAnchor="end"
                    fill="#a1a1aa"
                    fontSize="8.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {formatAxisSigned(lvl)}
                  </text>
                </g>
              ))}
              <path
                d={generateSeriesPath((b) => b.obv, getObvY)}
                fill="none"
                stroke="#06b6d4"
                strokeWidth="1.5"
              />
              {renderPanelHoverStripes('obv')}
            </svg>
            <div className="absolute top-1 left-[64px] right-2 flex items-center justify-between text-[8px] font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-500 flex items-center gap-2 tabular-nums">
                <span>OBV</span>
                <span className="text-[#06b6d4]">
                  {typeof hoveredData.obv === 'number' ? formatAxisSigned(hoveredData.obv) : '--'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggleStudy('obv')}
                title="Hide OBV study"
                aria-label="Hide OBV study"
                className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* PANEL 10: ROC (12) */}
        {showRocStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
            >
              <line
                x1={paddingLeft}
                y1={getRocY(0)}
                x2={width - paddingRight}
                y2={getRocY(0)}
                stroke="#333"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              {[rocMaxAbs, 0, -rocMaxAbs].map((lvl, idx) => (
                <text
                  key={`roc-lvl-${idx}`}
                  x={paddingLeft - 6}
                  y={getRocY(lvl) + 3}
                  textAnchor="end"
                  fill="#a1a1aa"
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {lvl === 0 ? '0%' : `${lvl.toFixed(1)}%`}
                </text>
              ))}
              <path
                d={generateSeriesPath((b) => b.roc, getRocY)}
                fill="none"
                stroke="#ec4899"
                strokeWidth="1.5"
              />
              {renderPanelHoverStripes('roc')}
            </svg>
            <div className="absolute top-1 left-[64px] right-2 flex items-center justify-between text-[8px] font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-500 flex items-center gap-2 tabular-nums">
                <span>ROC (12)</span>
                <span className="text-[#ec4899]">
                  {typeof hoveredData.roc === 'number' ? `${hoveredData.roc >= 0 ? '+' : ''}${hoveredData.roc.toFixed(2)}%` : '--'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggleStudy('roc')}
                title="Hide ROC study"
                aria-label="Hide ROC study"
                className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap justify-between items-center gap-2 text-[9px] text-[#ff9900] mt-3 font-semibold select-none border-t border-[#333] pt-2">
        <span className="flex items-center gap-1.5">
          {historyLoading ? (
            <RefreshCw size={10} className="animate-spin text-[#ff9900]" />
          ) : (
            <Activity size={10} className="text-[#00ff00]" />
          )}
          <span>
            RANGE:{' '}
            {interval === '5m'
              ? '5M (LAST 5 MIN)'
              : interval === '15m'
              ? '15M (LAST 15 MIN)'
              : interval === '30m'
              ? '30M (LAST 30 MIN)'
              : interval === '1h'
              ? '1H (LAST 60 MIN)'
              : interval === '1D'
              ? '1D (TODAY)'
              : interval === '1W'
              ? '1W (LAST 7 DAYS)'
              : '1M (LAST 30/31 DAYS)'}{' '}
            ({history.length} LIVE BARS)
          </span>
        </span>
        <span className="text-zinc-500 truncate max-w-full">
          STUDIES ACTIVE: {activeStudyNames || 'NONE'}
        </span>
      </div>

      <StudiesModal
        isOpen={isStudiesModalOpen}
        onClose={() => setIsStudiesModalOpen(false)}
        activeStudies={activeStudies}
        onToggleStudy={toggleStudy}
        onResetDefaults={handleResetStudies}
        onClearAll={handleClearStudies}
      />
    </div>
  );
}

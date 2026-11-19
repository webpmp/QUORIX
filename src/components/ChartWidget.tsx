import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { StockData } from '../types';
import { Info, X } from 'lucide-react';
import StudiesModal from './StudiesModal';
import {
  DEFAULT_STUDY_IDS,
  STUDIES_STORAGE_KEY,
  STUDY_CATALOG,
  StudyId,
  computeWilderRSIArray,
} from '../utils/technicalStudies';
import {
  deriveChartDataPhase,
  getCachedMarketHistory,
  getHistoryCacheKey,
  isCachedHistoryFresh,
  setCachedMarketHistory,
} from '../utils/marketHistoryCache';
import {
  RSI_NATURAL_MAX,
  RSI_NATURAL_MIN,
  computeScaledBoundedRange,
  computeScaledRsiRange,
  computeScaledVolumeMax,
  computeVolumePanelLayout,
  dragDeltaToZoomFactor,
  wheelDeltaToZoomFactor,
  type YRange,
} from '../utils/yAxisZoom';

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

export default function ChartWidget({
  stock,
  onTickTimeChange,
}: ChartWidgetProps) {
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeStudies, setActiveStudies] = useState<StudyId[]>(loadSavedStudies);
  const [isStudiesModalOpen, setIsStudiesModalOpen] = useState<boolean>(false);
  const [interval, setInterval] = useState<IntervalType>('1h');
  const [historyState, setHistoryState] = useState<{
    key: string;
    bars: HistoryBar[];
  } | null>(null);
  const [resolvedEmptyKey, setResolvedEmptyKey] = useState<string | null>(null);
  const [historyLoadingKey, setHistoryLoadingKey] = useState<string | null>(null);
  const chartPanelRef = useRef<HTMLDivElement | null>(null);
  const yAxisHitRef = useRef<SVGRectElement | null>(null);
  const volYAxisHitRef = useRef<SVGRectElement | null>(null);
  const rsiYAxisHitRef = useRef<SVGRectElement | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(600);
  const [customYRange, setCustomYRange] = useState<YRange | null>(null);
  const [isYAxisHovered, setIsYAxisHovered] = useState<boolean>(false);
  const [isYAxisDragging, setIsYAxisDragging] = useState<boolean>(false);
  const dragStateRef = useRef<{ startY: number; startMin: number; startMax: number } | null>(null);
  const scaleContextRef = useRef<{
    minPrice: number;
    maxPrice: number;
    computeScaledYRange: (baseMin: number, baseMax: number, factor: number) => YRange;
    isModalOpen: boolean;
  } | null>(null);

  // Independent Volume Study Y-axis zoom state
  const [customVolMax, setCustomVolMax] = useState<number | null>(null);
  const [isVolYAxisHovered, setIsVolYAxisHovered] = useState<boolean>(false);
  const [isVolYAxisDragging, setIsVolYAxisDragging] = useState<boolean>(false);
  const volDragStateRef = useRef<{ startY: number; startMax: number } | null>(null);
  const volScaleContextRef = useRef<{
    visibleMaxVolume: number;
    computeScaledVolMax: (baseMax: number, factor: number) => number;
    isModalOpen: boolean;
  } | null>(null);

  // Independent RSI Study Y-axis zoom state
  const [customRsiRange, setCustomRsiRange] = useState<YRange | null>(null);
  const [isRsiYAxisHovered, setIsRsiYAxisHovered] = useState<boolean>(false);
  const [isRsiYAxisDragging, setIsRsiYAxisDragging] = useState<boolean>(false);
  const rsiDragStateRef = useRef<{ startY: number; startMin: number; startMax: number } | null>(null);
  const rsiScaleContextRef = useRef<{
    minRsi: number;
    maxRsi: number;
    computeScaledRsiYRange: (baseMin: number, baseMax: number, factor: number) => YRange;
    isModalOpen: boolean;
  } | null>(null);

  const isVolYAxisActiveRef = useRef<boolean>(false);
  isVolYAxisActiveRef.current = isVolYAxisHovered || isVolYAxisDragging;
  const isRsiYAxisActiveRef = useRef<boolean>(false);
  isRsiYAxisActiveRef.current = isRsiYAxisHovered || isRsiYAxisDragging;

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

  const sym = stock?.symbol ? stock.symbol.toUpperCase().trim() : '';
  const currentKey = sym ? getHistoryCacheKey(sym, interval) : '';
  const cachedEntry = sym ? getCachedMarketHistory(sym, interval) : null;

  useEffect(() => {
    if (!sym) return;
    const activeInt = interval;
    const key = getHistoryCacheKey(sym, activeInt);
    let cancelled = false;
    setHoverIndex(null);
    setCustomYRange(null);
    setCustomVolMax(null);
    setCustomRsiRange(null);

    const existingCached = getCachedMarketHistory(sym, activeInt);
    if (existingCached) {
      setHistoryState({ key, bars: existingCached.bars });
      setResolvedEmptyKey(null);
      if (isCachedHistoryFresh(existingCached)) {
        setHistoryLoadingKey((prev) => (prev === key ? null : prev));
        return;
      }
    }

    const controller = new AbortController();

    const loadHistory = async () => {
      setHistoryLoadingKey(key);
      try {
        const res = await fetch(
          `/api/market/history?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(activeInt)}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (!cancelled) {
          const bars: HistoryBar[] =
            data.success && Array.isArray(data.history) ? data.history : [];
          if (bars.length > 0) {
            setCachedMarketHistory(sym, activeInt, bars);
            setHistoryState({ key, bars });
            setResolvedEmptyKey(null);
          } else if (!existingCached) {
            setCachedMarketHistory(sym, activeInt, []);
            setHistoryState({ key, bars: [] });
            setResolvedEmptyKey(key);
          }
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          return;
        }
        if (!cancelled && !existingCached) {
          setHistoryState({ key, bars: [] });
          setResolvedEmptyKey(key);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoadingKey((prev) => (prev === key ? null : prev));
        }
      }
    };

    loadHistory();
    return () => {
      cancelled = true;
      controller.abort();
      setHistoryLoadingKey((prev) => (prev === key ? null : prev));
    };
  }, [sym, interval]);

  const activeBars =
    historyState && historyState.key === currentKey
      ? historyState.bars
      : cachedEntry?.bars || [];

  const hasUsableBars = activeBars.length > 0;
  const hasResolvedHistoryAttempt =
    hasUsableBars ||
    (historyState !== null && historyState.key === currentKey) ||
    resolvedEmptyKey === currentKey;
  const isHistoryFetching = Boolean(currentKey) && historyLoadingKey === currentKey;

  const chartDataPhase = deriveChartDataPhase({
    hasStock: Boolean(stock),
    hasUsableBars,
    hasResolvedHistoryAttempt,
    isHistoryFetching,
  });

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
  }, [sym, chartDataPhase, activeBars.length]);

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

  const isChartReady = Boolean(stock && chartDataPhase === 'ready' && activeBars.length > 0 && hoveredData);

  useEffect(() => {
    onTickTimeChange?.(isChartReady ? formattedHoveredDate : '');
  }, [isChartReady, formattedHoveredDate, onTickTimeChange]);

  const hasChartData = isChartReady;

  // Clear transient hover/drag flags if Volume or RSI study is hidden
  useEffect(() => {
    if (!showVolumeStudy) {
      volDragStateRef.current = null;
      setIsVolYAxisDragging(false);
      setIsVolYAxisHovered(false);
    }
  }, [showVolumeStudy]);

  useEffect(() => {
    if (!showRsiStudy) {
      rsiDragStateRef.current = null;
      setIsRsiYAxisDragging(false);
      setIsRsiYAxisHovered(false);
    }
  }, [showRsiStudy]);

  // Attach non-passive wheel listener on Price Chart left Y-axis area to zoom without scrolling page
  useEffect(() => {
    if (!hasChartData) return;
    const hitEl = yAxisHitRef.current;
    if (!hitEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const ctx = scaleContextRef.current;
      if (!ctx) return;

      // Wheel up (deltaY < 0) => zoom in; wheel down (deltaY > 0) => zoom out
      const factor = wheelDeltaToZoomFactor(e.deltaY);
      setCustomYRange((prev) => {
        const curMin = prev ? prev.min : ctx.minPrice;
        const curMax = prev ? prev.max : ctx.maxPrice;
        return ctx.computeScaledYRange(curMin, curMax, factor);
      });
    };

    hitEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      hitEl.removeEventListener('wheel', handleWheel);
    };
  }, [hasChartData]);

  // Attach non-passive wheel listener on Volume Study left Y-axis area
  useEffect(() => {
    if (!hasChartData || !showVolumeStudy) return;
    const hitEl = volYAxisHitRef.current;
    if (!hitEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const ctx = volScaleContextRef.current;
      if (!ctx) return;

      const factor = wheelDeltaToZoomFactor(e.deltaY);
      setCustomVolMax((prev) => {
        const curMax = prev !== null ? prev : ctx.visibleMaxVolume;
        return ctx.computeScaledVolMax(curMax, factor);
      });
    };

    hitEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      hitEl.removeEventListener('wheel', handleWheel);
    };
  }, [hasChartData, showVolumeStudy]);

  // Attach non-passive wheel listener on RSI Oscillator left Y-axis area
  useEffect(() => {
    if (!hasChartData || !showRsiStudy) return;
    const hitEl = rsiYAxisHitRef.current;
    if (!hitEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const ctx = rsiScaleContextRef.current;
      if (!ctx) return;

      const factor = wheelDeltaToZoomFactor(e.deltaY);
      setCustomRsiRange((prev) => {
        const curMin = prev ? prev.min : ctx.minRsi;
        const curMax = prev ? prev.max : ctx.maxRsi;
        return ctx.computeScaledRsiYRange(curMin, curMax, factor);
      });
    };

    hitEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      hitEl.removeEventListener('wheel', handleWheel);
    };
  }, [hasChartData, showRsiStudy]);

  // Smooth vertical Y-axis drag handling for Price Chart
  useEffect(() => {
    if (!isYAxisDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      const ctx = scaleContextRef.current;
      if (!drag || !ctx) return;
      const dy = e.clientY - drag.startY;
      // Dragging up (dy < 0) expands vertical scale (zoom in); dragging down zooms out
      const factor = dragDeltaToZoomFactor(dy);
      setCustomYRange(ctx.computeScaledYRange(drag.startMin, drag.startMax, factor));
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
      setIsYAxisDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isYAxisDragging]);

  // Smooth vertical Y-axis drag handling for Volume Study
  useEffect(() => {
    if (!isVolYAxisDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const drag = volDragStateRef.current;
      const ctx = volScaleContextRef.current;
      if (!drag || !ctx) return;
      const dy = e.clientY - drag.startY;
      const factor = dragDeltaToZoomFactor(dy);
      setCustomVolMax(ctx.computeScaledVolMax(drag.startMax, factor));
    };

    const handleMouseUp = () => {
      volDragStateRef.current = null;
      setIsVolYAxisDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isVolYAxisDragging]);

  // Smooth vertical Y-axis drag handling for RSI Study
  useEffect(() => {
    if (!isRsiYAxisDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const drag = rsiDragStateRef.current;
      const ctx = rsiScaleContextRef.current;
      if (!drag || !ctx) return;
      const dy = e.clientY - drag.startY;
      const factor = dragDeltaToZoomFactor(dy);
      setCustomRsiRange(ctx.computeScaledRsiYRange(drag.startMin, drag.startMax, factor));
    };

    const handleMouseUp = () => {
      rsiDragStateRef.current = null;
      setIsRsiYAxisDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isRsiYAxisDragging]);

  // Keyboard zoom shortcuts (+ / =, - / _, 0) scoped to hovered/active study Y-axis or Price Chart by default
  useEffect(() => {
    if (!hasChartData) return;

    const isEditableElement = (el: EventTarget | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const priceCtx = scaleContextRef.current;
      if (!priceCtx || priceCtx.isModalOpen) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableElement(e.target) || isEditableElement(document.activeElement)) return;

      const isZoomIn = e.key === '+' || e.key === '=';
      const isZoomOut = e.key === '-' || e.key === '_';
      const isReset = e.key === '0';
      if (!isZoomIn && !isZoomOut && !isReset) return;

      if (isVolYAxisActiveRef.current) {
        const volCtx = volScaleContextRef.current;
        if (!volCtx) return;
        e.preventDefault();
        if (isZoomIn) {
          setCustomVolMax((prev) =>
            volCtx.computeScaledVolMax(prev !== null ? prev : volCtx.visibleMaxVolume, 1.2)
          );
        } else if (isZoomOut) {
          setCustomVolMax((prev) =>
            volCtx.computeScaledVolMax(prev !== null ? prev : volCtx.visibleMaxVolume, 1 / 1.2)
          );
        } else if (isReset) {
          setCustomVolMax(null);
        }
        return;
      }

      if (isRsiYAxisActiveRef.current) {
        const rsiCtx = rsiScaleContextRef.current;
        if (!rsiCtx) return;
        e.preventDefault();
        if (isZoomIn) {
          setCustomRsiRange((prev) => {
            const curMin = prev ? prev.min : rsiCtx.minRsi;
            const curMax = prev ? prev.max : rsiCtx.maxRsi;
            return rsiCtx.computeScaledRsiYRange(curMin, curMax, 1.2);
          });
        } else if (isZoomOut) {
          setCustomRsiRange((prev) => {
            const curMin = prev ? prev.min : rsiCtx.minRsi;
            const curMax = prev ? prev.max : rsiCtx.maxRsi;
            return rsiCtx.computeScaledRsiYRange(curMin, curMax, 1 / 1.2);
          });
        } else if (isReset) {
          setCustomRsiRange(null);
        }
        return;
      }

      if (isZoomIn) {
        e.preventDefault();
        setCustomYRange((prev) => {
          const curMin = prev ? prev.min : priceCtx.minPrice;
          const curMax = prev ? prev.max : priceCtx.maxPrice;
          return priceCtx.computeScaledYRange(curMin, curMax, 1.2);
        });
      } else if (isZoomOut) {
        e.preventDefault();
        setCustomYRange((prev) => {
          const curMin = prev ? prev.min : priceCtx.minPrice;
          const curMax = prev ? prev.max : priceCtx.maxPrice;
          return priceCtx.computeScaledYRange(curMin, curMax, 1 / 1.2);
        });
      } else if (isReset) {
        e.preventDefault();
        setCustomYRange(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasChartData]);

  if (!stock) {
    return null;
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
  const PRICE_VOL_PLOT_GUTTER_GAP = 16;
  const priceVolPaddingLeft = paddingLeft + PRICE_VOL_PLOT_GUTTER_GAP;
  const paddingRight = 32;
  const adjWidth = Math.max(100, width - paddingLeft - paddingRight);
  const priceVolAdjWidth = Math.max(100, width - priceVolPaddingLeft - paddingRight);

  const BASE_PRICE_HEIGHT = 184;
  const MAX_PRICE_EXPANSION_PX = 50;
  const pricePaddingTop = 18;
  const pricePaddingBottom = 18;

  const barStep = adjWidth / Math.max(history.length, 1);
  const priceVolBarStep = priceVolAdjWidth / Math.max(history.length, 1);
  const candleWidth = Math.max(4, Math.min(14, Math.floor(priceVolBarStep * 0.55)));
  const volBarWidth = Math.max(3, Math.min(12, Math.floor(barStep * 0.5)));
  const priceVolBarWidth = Math.max(3, Math.min(12, Math.floor(priceVolBarStep * 0.5)));

  const minLabelGapPx = (spansMultipleDays || interval === '1W') && interval !== '1M' ? 98 : 76;
  const maxLabels = Math.max(3, Math.floor(adjWidth / minLabelGapPx));
  const labelStep = Math.max(1, Math.ceil(history.length / maxLabels));
  const priceVolMaxLabels = Math.max(3, Math.floor(priceVolAdjWidth / minLabelGapPx));
  const priceVolLabelStep = Math.max(1, Math.ceil(history.length / priceVolMaxLabels));
  const lastIdx = history.length - 1;

  const formatAxisSigned = (val: number) => {
    if (Math.abs(val) >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
    return `${Math.round(val)}`;
  };

  const formatAxisVolume = (vol: number) => {
    if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 10_000) return `${(vol / 1_000).toFixed(0)}K`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
    return `${Math.round(vol)}`;
  };

  const subPanelHeight = 68;
  const subPadTop = 12;
  const subPadBottom = 10;
  const subAdjHeight = subPanelHeight - subPadTop - subPadBottom;

  const rsiHeight = 116;
  const rsiPaddingTop = 22;
  const rsiPaddingBottom = 12;
  const rsiAdjHeight = rsiHeight - rsiPaddingTop - rsiPaddingBottom;

  const windowHigh = history.length > 0 ? Math.max(...history.map((h) => h.high)) : 0;
  const windowLow = history.length > 0 ? Math.min(...history.map((h) => h.low)) : 0;
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

  const prices = history.length > 0
    ? [
        ...history.flatMap((h) => [h.high, h.low, h.close, h.open]),
        ...overlayValues,
      ]
    : [1];
  const autoMaxPrice = Math.max(...prices) * 1.008;
  const autoMinPrice = Math.min(...prices) * 0.992;
  const autoPriceRange = Math.max(autoMaxPrice - autoMinPrice, 0.0001);
  const autoMid = (autoMinPrice + autoMaxPrice) / 2;

  const latestBarClose = history[history.length - 1]?.close ?? autoMid;
  const anchorPrice =
    typeof stock.price === 'number' &&
    stock.price > 0 &&
    stock.price >= autoMinPrice * 0.5 &&
    stock.price <= autoMaxPrice * 1.5
      ? stock.price
      : latestBarClose;

  const minVisibleRange = Math.max(autoPriceRange * 0.15, Math.abs(autoMid) * 0.002, 0.02);
  const maxVisibleRange = Math.max(autoPriceRange * 4, Math.abs(autoMid) * 0.4, minVisibleRange * 2);

  const computeScaledYRange = (
    baseMin: number,
    baseMax: number,
    factor: number
  ): YRange =>
    computeScaledBoundedRange({
      baseMin,
      baseMax,
      factor,
      minVisibleSpan: minVisibleRange,
      maxVisibleSpan: maxVisibleRange,
      anchorValue: anchorPrice,
      boundMin: autoMinPrice >= 0 ? 0 : undefined,
    });

  const minPrice = customYRange ? customYRange.min : autoMinPrice;
  const maxPrice = customYRange ? customYRange.max : autoMaxPrice;
  const priceRange = Math.max(maxPrice - minPrice, 0.0001);
  const isYZoomed = customYRange !== null;
  const yZoomFactor = autoPriceRange / priceRange;
  const priceExtraHeight =
    isYZoomed && yZoomFactor > 1
      ? Math.min(
          MAX_PRICE_EXPANSION_PX,
          Math.max(0, Math.round((Math.log(yZoomFactor) / Math.log(4)) * MAX_PRICE_EXPANSION_PX))
        )
      : 0;
  const priceHeight = BASE_PRICE_HEIGHT + priceExtraHeight;
  const priceAdjHeight = priceHeight - pricePaddingTop - pricePaddingBottom;

  scaleContextRef.current = {
    minPrice,
    maxPrice,
    computeScaledYRange,
    isModalOpen: isStudiesModalOpen,
  };

  const handleYAxisMouseDown = (e: ReactMouseEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setHoverIndex(null);
    dragStateRef.current = {
      startY: e.clientY,
      startMin: minPrice,
      startMax: maxPrice,
    };
    setIsYAxisDragging(true);
  };

  const priceTickStep = priceRange / 4;
  const formatAxisPrice = (val: number) => {
    if (priceTickStep < 0.01) return val.toFixed(4);
    if (priceTickStep < 0.1) return val.toFixed(3);
    if (val >= 1000 && priceTickStep >= 0.5) return val.toFixed(1);
    if (val >= 10) return val.toFixed(2);
    return val.toFixed(3);
  };

  // Volume boundaries (include volMa if active) & independent Y-axis zoom against [0, visibleMaxVolume]
  // with capped 0..50px headroom above the plotting scale so taller bars stay visible where possible
  const volSeries = history.map((h) => h.volume);
  const volMaSeries = showVolMaStudy
    ? history.map((h) => h.volMa).filter((v): v is number => typeof v === 'number' && !isNaN(v))
    : [];
  const peakRenderedVolume = Math.max(...volSeries, ...volMaSeries, 0);
  const autoMaxVolume = Math.max(peakRenderedVolume, 1);
  const sortedPositiveVols = volSeries.filter((v) => v > 0).sort((a, b) => a - b);
  const lowPositiveVolume =
    sortedPositiveVols.length > 0
      ? sortedPositiveVols[Math.floor(sortedPositiveVols.length * 0.1)]
      : undefined;
  const visibleMaxVolume = customVolMax !== null ? customVolMax : autoMaxVolume;
  const isVolYZoomed = customVolMax !== null;
  const volYZoomFactor = autoMaxVolume / Math.max(visibleMaxVolume, 1);
  const {
    volHeight,
    volPaddingTop,
    volScaleHeight,
    volPlotHeight,
    volBaselineY,
    extraHeight: volExtraHeight,
    topBoundaryVolume,
  } = computeVolumePanelLayout({
    visibleMaxVolume,
    peakRenderedVolume,
    isZoomed: isVolYZoomed,
  });
  const computeScaledVolMax = (baseMax: number, factor: number) =>
    computeScaledVolumeMax(baseMax, autoMaxVolume, factor, lowPositiveVolume);

  volScaleContextRef.current = {
    visibleMaxVolume,
    computeScaledVolMax,
    isModalOpen: isStudiesModalOpen,
  };

  const handleVolYAxisMouseDown = (e: ReactMouseEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setHoverIndex(null);
    volDragStateRef.current = {
      startY: e.clientY,
      startMax: visibleMaxVolume,
    };
    setIsVolYAxisDragging(true);
  };

  // RSI independent Y-axis zoom bounded within [0, 100]
  const latestRsiAnchor =
    activeIndex >= 0 && typeof rsiList[activeIndex] === 'number' && !isNaN(rsiList[activeIndex])
      ? rsiList[activeIndex]
      : 50;
  const minRsi = customRsiRange ? customRsiRange.min : RSI_NATURAL_MIN;
  const maxRsi = customRsiRange ? customRsiRange.max : RSI_NATURAL_MAX;
  const rsiRange = Math.max(maxRsi - minRsi, 1);
  const isRsiYZoomed = customRsiRange !== null;
  const rsiYZoomFactor = (RSI_NATURAL_MAX - RSI_NATURAL_MIN) / rsiRange;
  const computeScaledRsiYRange = (baseMin: number, baseMax: number, factor: number) =>
    computeScaledRsiRange(baseMin, baseMax, factor, latestRsiAnchor);

  rsiScaleContextRef.current = {
    minRsi,
    maxRsi,
    computeScaledRsiYRange,
    isModalOpen: isStudiesModalOpen,
  };

  const handleRsiYAxisMouseDown = (e: ReactMouseEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setHoverIndex(null);
    rsiDragStateRef.current = {
      startY: e.clientY,
      startMin: minRsi,
      startMax: maxRsi,
    };
    setIsRsiYAxisDragging(true);
  };

  const getX = (index: number) => {
    if (history.length <= 1) return paddingLeft + adjWidth / 2;
    return paddingLeft + (index / (history.length - 1)) * adjWidth;
  };

  const getPriceVolX = (index: number) => {
    if (history.length <= 1) return priceVolPaddingLeft + priceVolAdjWidth / 2;
    return priceVolPaddingLeft + (index / (history.length - 1)) * priceVolAdjWidth;
  };

  const getHoverStripeBounds = (index: number) => {
    if (history.length <= 1) {
      return { x: paddingLeft, stripeWidth: adjWidth };
    }
    const left = index === 0 ? paddingLeft : (getX(index - 1) + getX(index)) / 2;
    const right =
      index === history.length - 1 ? paddingLeft + adjWidth : (getX(index) + getX(index + 1)) / 2;
    return { x: left, stripeWidth: Math.max(1, right - left) };
  };

  const getPriceVolHoverStripeBounds = (index: number) => {
    if (history.length <= 1) {
      return { x: priceVolPaddingLeft, stripeWidth: priceVolAdjWidth };
    }
    const left = index === 0 ? priceVolPaddingLeft : (getPriceVolX(index - 1) + getPriceVolX(index)) / 2;
    const right =
      index === history.length - 1
        ? priceVolPaddingLeft + priceVolAdjWidth
        : (getPriceVolX(index) + getPriceVolX(index + 1)) / 2;
    return { x: left, stripeWidth: Math.max(1, right - left) };
  };

  const getY = (price: number) =>
    pricePaddingTop + priceAdjHeight - ((price - minPrice) / priceRange) * priceAdjHeight;

  const getVolY = (volume: number) =>
    volBaselineY -
    (Math.max(0, volume) / Math.max(visibleMaxVolume, 1)) * volScaleHeight;

  const getRsiY = (rsiVal: number) =>
    rsiPaddingTop + rsiAdjHeight - ((rsiVal - minRsi) / rsiRange) * rsiAdjHeight;

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

  const generatePriceVolSeriesPath = (
    getter: (bar: HistoryBar, idx: number) => number | undefined,
    yMapper: (val: number) => number
  ) => {
    const pts: string[] = [];
    for (let i = 0; i < history.length; i++) {
      const val = getter(history[i], i);
      if (typeof val === 'number' && !isNaN(val)) {
        pts.push(`${pts.length === 0 ? 'M' : 'L'}${getPriceVolX(i)},${yMapper(val)}`);
      }
    }
    return pts.join(' ');
  };

  const generateLinePath = () =>
    history.map((h, i) => `${i === 0 ? 'M' : 'L'}${getPriceVolX(i)},${getY(h.close)}`).join(' ');

  const generateAreaPath = () => {
    const linePath = generateLinePath();
    return `${linePath} L${getPriceVolX(history.length - 1)},${getY(minPrice)} L${getPriceVolX(0)},${getY(minPrice)} Z`;
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
        const x = getPriceVolX(i);
        upperPts.push({ x, y: getY(u) });
        lowerPts.push({ x, y: getY(l) });
      }
    }
    if (upperPts.length < 2) return '';
    const topStr = upperPts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const botStr = [...lowerPts].reverse().map((p) => `L${p.x},${p.y}`).join(' ');
    return `${topStr} ${botStr} Z`;
  };

  const liveOpen = typeof stock.open === 'number' && stock.open > 0 ? stock.open : undefined;
  const liveHigh = typeof stock.high === 'number' && stock.high > 0 ? stock.high : undefined;
  const liveLow = typeof stock.low === 'number' && stock.low > 0 ? stock.low : undefined;
  const livePrice = typeof stock.price === 'number' && stock.price > 0 ? stock.price : undefined;

  const displayData =
    hoverIndex !== null && hoveredData
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
          open: liveOpen ?? hoveredData?.open,
          high: liveHigh ?? hoveredData?.high,
          low: liveLow ?? hoveredData?.low,
          close: livePrice ?? hoveredData?.close,
          volume: hoveredData?.volume,
        };
  const currentRsi = activeIndex >= 0 ? rsiList[activeIndex] : undefined;

  const statsColClass =
    showVolumeStudy && showRsiStudy
      ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'
      : showVolumeStudy || showRsiStudy
      ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
      : 'grid-cols-2 sm:grid-cols-5';

  // Active overlay readout legend items
  const activeOverlayItems = hoveredData
    ? [
        showMa3 && { id: 'ma3' as StudyId, label: '3MA', val: getMA3(hoveredData, activeIndex), colorClass: 'text-[#ff9900]' },
        showEma9 && { id: 'ema9' as StudyId, label: '9EMA', val: hoveredData.ema9, colorClass: 'text-[#38bdf8]' },
        showEma20 && { id: 'ema20' as StudyId, label: '20EMA', val: hoveredData.ema20, colorClass: 'text-[#f472b6]' },
        showSma50 && { id: 'sma50' as StudyId, label: '50SMA', val: hoveredData.sma50, colorClass: 'text-[#eab308]' },
        showVwap && { id: 'vwap' as StudyId, label: 'VWAP', val: hoveredData.vwap, colorClass: 'text-[#2dd4bf]' },
        showBb && { id: 'bb' as StudyId, label: 'BB(20,2)', val: hoveredData.bbMid, colorClass: 'text-[#60a5fa]' },
        showPsar && { id: 'psar' as StudyId, label: 'PSAR', val: hoveredData.psar, colorClass: 'text-[#fbbf24]' },
      ].filter((x): x is { id: StudyId; label: string; val: number | undefined; colorClass: string } => Boolean(x))
    : [];

  const renderPanelHoverStripes = (keyPrefix: string) => (
    <>
      {history.map((_, i) => {
        const { x, stripeWidth } = getHoverStripeBounds(i);
        return (
          <rect
            key={`${keyPrefix}-detect-${i}`}
            x={x}
            y={subPadTop}
            width={stripeWidth}
            height={subAdjHeight}
            fill="transparent"
            className="cursor-crosshair"
            onMouseEnter={() => setHoverIndex(i)}
          />
        );
      })}
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

  const CHART_PANEL_HEADER_CLASS =
    'absolute top-1 left-[64px] right-2 flex items-center justify-between gap-2 text-[11px] leading-tight font-bold uppercase select-none pointer-events-none';
  const PRICE_VOL_PANEL_HEADER_CLASS =
    'absolute top-1 left-[74px] right-2 flex items-center justify-between gap-2 text-[11px] leading-tight font-bold uppercase select-none pointer-events-none';

  return (
    <div
      tabIndex={0}
      className="bg-[#010101] border border-[#333] rounded p-3.5 text-xs font-mono select-none focus:outline-none"
    >
      {/* Chart Headers */}
      <div className="flex flex-col sm:flex-row items-baseline sm:items-center justify-between border-b border-[#333] pb-2 mb-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-extrabold uppercase tracking-wider leading-tight min-w-0">
            <span className="text-[#ff9900]">{stock.symbol}</span>
            {stock.name && stock.name !== stock.symbol && (
              <>
                <span className="text-zinc-600 font-normal">|</span>
                <span className="text-white truncate max-w-[260px] sm:max-w-none">{stock.name}</span>
              </>
            )}
            {stock.exchange && (
              <>
                <span className="text-zinc-600 font-normal">|</span>
                <span className="text-zinc-400 text-[11px] sm:text-xs font-bold">{stock.exchange}</span>
              </>
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
        <div className="min-w-0">
          <span className="text-zinc-300 font-bold block truncate">
            LAST PRICE
          </span>
          <span className="text-[#3498db] text-xs sm:text-sm md:text-base font-black block tracking-tight leading-tight mt-0.5 truncate">
            {typeof displayData.close === 'number' ? `$${displayData.close.toFixed(2)}` : '--'}
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-zinc-300 font-bold block truncate">
            EXT HOURS
          </span>
          {typeof stock.extHoursPrice === 'number' && stock.extHoursPrice > 0 ? (
            <>
              <span className="text-white text-xs sm:text-sm md:text-base font-black block tracking-tight leading-tight mt-0.5 truncate">
                ${stock.extHoursPrice.toFixed(2)}
              </span>
              {typeof stock.extHoursChange === 'number' &&
                typeof stock.extHoursChangePercent === 'number' && (
                  <span
                    className={`text-[10px] font-bold block truncate ${
                      stock.extHoursChange > 0
                        ? 'text-[#00ff00]'
                        : stock.extHoursChange < 0
                        ? 'text-[#ff4444]'
                        : 'text-zinc-400'
                    }`}
                  >
                    {stock.extHoursChange > 0 ? '+' : ''}
                    {stock.extHoursChange.toFixed(2)} ({stock.extHoursChangePercent > 0 ? '+' : ''}
                    {stock.extHoursChangePercent.toFixed(2)}%)
                  </span>
                )}
            </>
          ) : (
            <span className="text-zinc-500 text-xs sm:text-sm md:text-base font-black block tracking-tight leading-tight mt-0.5">--</span>
          )}
        </div>
        <div className="min-w-0">
          <span className="text-zinc-300 font-bold block truncate">OPEN</span>
          <span className="text-[#ff9900] text-xs sm:text-sm md:text-base font-black block tracking-tight leading-tight mt-0.5 truncate">
            {typeof displayData.open === 'number' ? `$${displayData.open.toFixed(2)}` : '--'}
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-zinc-300 font-bold block truncate">HIGH</span>
          <span className="text-[#00ff00] text-xs sm:text-sm md:text-base font-black block tracking-tight leading-tight mt-0.5 truncate">
            {typeof displayData.high === 'number' ? `$${displayData.high.toFixed(2)}` : '--'}
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-zinc-300 font-bold block truncate">LOW</span>
          <span className="text-[#ff4444] text-xs sm:text-sm md:text-base font-black block tracking-tight leading-tight mt-0.5 truncate">
            {typeof displayData.low === 'number' ? `$${displayData.low.toFixed(2)}` : '--'}
          </span>
        </div>
        {showVolumeStudy && (
          <div className="min-w-0">
            <span className="text-zinc-300 font-bold block truncate">DAY TOTAL</span>
            <span className="text-white text-xs sm:text-sm md:text-base font-black block tracking-tight leading-tight mt-0.5 truncate">
              {typeof stock.volume === 'number' && stock.volume > 0 ? stock.volume.toLocaleString() : '--'}
            </span>
            <span className="text-[10px] text-zinc-500 font-bold block truncate">
              BAR VOLUME: {typeof displayData.volume === 'number' ? displayData.volume.toLocaleString() : '--'}
            </span>
          </div>
        )}
        {showRsiStudy && (
          <div className="min-w-0">
            <span className="text-zinc-300 font-bold block truncate">RSI (14)</span>
            <span
              className={`text-xs sm:text-sm md:text-base font-black block tracking-tight leading-tight mt-0.5 truncate ${
                typeof currentRsi === 'number' && !isNaN(currentRsi)
                  ? currentRsi >= 70
                    ? 'text-[#ff4444]'
                    : currentRsi <= 30
                    ? 'text-[#00ff00]'
                    : 'text-[#9b59b6]'
                  : 'text-zinc-500'
              }`}
            >
              {typeof currentRsi === 'number' && !isNaN(currentRsi)
                ? `${currentRsi.toFixed(1)} ${currentRsi >= 70 ? 'OB' : currentRsi <= 30 ? 'OS' : ''}`
                : '--'}
            </span>
          </div>
        )}
      </div>

      {/* Primary SVG Stack Wrapper */}
      <div className="flex flex-col gap-2 relative bg-black rounded p-1.5 border border-[#222]">
        {/* PANEL 1: Main Price Chart */}
        <div ref={chartPanelRef} className="relative pt-[6px]">
          {isChartReady && hoveredData ? (
            <>
              <svg
                width={width}
                height={priceHeight}
                viewBox={`0 0 ${width} ${priceHeight}`}
                className="block w-full overflow-visible"
                onMouseLeave={() => setHoverIndex(null)}
              >
            {/* Subtle interactive backdrop for left Y-axis scale */}
            <rect
              x={2}
              y={pricePaddingTop - 6}
              width={paddingLeft - 6}
              height={priceAdjHeight + 12}
              rx="2"
              fill={
                isYAxisDragging
                  ? 'rgba(255, 153, 0, 0.12)'
                  : isYAxisHovered
                  ? 'rgba(255, 153, 0, 0.06)'
                  : 'transparent'
              }
              stroke={
                isYAxisDragging
                  ? 'rgba(255, 153, 0, 0.45)'
                  : isYAxisHovered || isYZoomed
                  ? 'rgba(255, 153, 0, 0.22)'
                  : 'transparent'
              }
              strokeWidth="1"
            />

            {/* Horizontal Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
              const hVal = pricePaddingTop + pct * priceAdjHeight;
              const priceVal = maxPrice - pct * priceRange;
              return (
                <g key={i}>
                  <line
                    x1={priceVolPaddingLeft}
                    y1={hVal}
                    x2={width - paddingRight}
                    y2={hVal}
                    stroke="#222"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <text
                    x={paddingLeft - 12}
                    y={hVal + 3}
                    textAnchor="end"
                    fill={isYAxisHovered || isYAxisDragging ? '#ff9900' : '#e4e4e7'}
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                    className="pointer-events-none"
                  >
                    {formatAxisPrice(priceVal)}
                  </text>
                </g>
              );
            })}

            {/* Support / Resistance Levels Overlay */}
            {showLevels && (
              <g>
                {getY(windowHigh) >= pricePaddingTop - 2 &&
                  getY(windowHigh) <= pricePaddingTop + priceAdjHeight + 2 && (
                    <>
                      <line
                        x1={priceVolPaddingLeft}
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
                    </>
                  )}
                {getY(windowLow) >= pricePaddingTop - 2 &&
                  getY(windowLow) <= pricePaddingTop + priceAdjHeight + 2 && (
                    <>
                      <line
                        x1={priceVolPaddingLeft}
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
                    </>
                  )}
                {prevCloseRef !== null &&
                  getY(prevCloseRef) >= pricePaddingTop - 2 &&
                  getY(prevCloseRef) <= pricePaddingTop + priceAdjHeight + 2 && (
                    <>
                      <line
                        x1={priceVolPaddingLeft}
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

            {/* Clipped Price Plot Series (Candles, Line/Area, Overlays, Crosshair Dot) */}
            <g clipPath="url(#gp-price-plot-clip)">

            {/* Bollinger Bands Envelope */}
            {showBb && (
              <g>
                <path d={generateBollingerFillPath()} fill="rgba(96, 165, 250, 0.08)" />
                <path
                  d={generatePriceVolSeriesPath((b) => b.bbUpper, getY)}
                  fill="none"
                  stroke="#60a5fa"
                  strokeWidth="1.1"
                  opacity="0.85"
                />
                <path
                  d={generatePriceVolSeriesPath((b) => b.bbMid, getY)}
                  fill="none"
                  stroke="#60a5fa"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                  opacity="0.65"
                />
                <path
                  d={generatePriceVolSeriesPath((b) => b.bbLower, getY)}
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
                const xPos = getPriceVolX(i);
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
                d={generatePriceVolSeriesPath((b) => b.sma50, getY)}
                fill="none"
                stroke="#eab308"
                strokeWidth="1.4"
                opacity="0.9"
              />
            )}
            {showEma20 && (
              <path
                d={generatePriceVolSeriesPath((b) => b.ema20, getY)}
                fill="none"
                stroke="#f472b6"
                strokeWidth="1.4"
                opacity="0.9"
              />
            )}
            {showEma9 && (
              <path
                d={generatePriceVolSeriesPath((b) => b.ema9, getY)}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.4"
                opacity="0.9"
              />
            )}
            {showVwap && (
              <path
                d={generatePriceVolSeriesPath((b) => b.vwap, getY)}
                fill="none"
                stroke="#2dd4bf"
                strokeWidth="1.5"
                strokeDasharray="5,2"
                opacity="0.9"
              />
            )}
            {showMa3 && (
              <path
                d={generatePriceVolSeriesPath(getMA3, getY)}
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
                    cx={getPriceVolX(i)}
                    cy={getY(h.psar)}
                    r="2"
                    fill={h.psarUp ? '#00ff00' : '#ff4444'}
                    opacity="0.9"
                  />
                );
              })}
            </g>

            {/* Vertical Time Axis ticks */}
            {history.map((h, i) => {
              const showTick =
                i === lastIdx ||
                (i % priceVolLabelStep === 0 &&
                  getPriceVolX(lastIdx) - getPriceVolX(i) >= minLabelGapPx * 0.78);
              if (showTick) {
                return (
                  <g key={`text-${i}`}>
                    <line
                      x1={getPriceVolX(i)}
                      y1={pricePaddingTop + priceAdjHeight}
                      x2={getPriceVolX(i)}
                      y2={pricePaddingTop + priceAdjHeight + 3}
                      stroke="#444"
                    />
                    <text
                      x={getPriceVolX(i)}
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
            {history.map((_, i) => {
              const { x, stripeWidth } = getPriceVolHoverStripeBounds(i);
              return (
                <rect
                  key={`detect-${i}`}
                  x={x}
                  y={pricePaddingTop}
                  width={stripeWidth}
                  height={priceAdjHeight}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoverIndex(i)}
                />
              );
            })}

            {/* Target Vertical Crosshair */}
            {hoverIndex !== null && (
              <g>
                <line
                  x1={getPriceVolX(hoverIndex)}
                  y1={pricePaddingTop}
                  x2={getPriceVolX(hoverIndex)}
                  y2={pricePaddingTop + priceAdjHeight}
                  stroke="#ff9900"
                  strokeWidth="0.8"
                  strokeDasharray="2,2"
                />
                {getY(history[hoverIndex].close) >= pricePaddingTop - 3 &&
                  getY(history[hoverIndex].close) <= pricePaddingTop + priceAdjHeight + 3 && (
                    <circle
                      cx={getPriceVolX(hoverIndex)}
                      cy={getY(history[hoverIndex].close)}
                      r="4"
                      fill="#ff9900"
                      stroke="black"
                      strokeWidth="1.5"
                    />
                  )}
              </g>
            )}

            {/* Interactive Left Y-Axis Scale Hit Area */}
            <rect
              ref={yAxisHitRef}
              x={0}
              y={0}
              width={paddingLeft}
              height={priceHeight}
              fill="transparent"
              className="cursor-ns-resize"
              onMouseEnter={() => {
                setIsYAxisHovered(true);
                setHoverIndex(null);
              }}
              onMouseLeave={() => setIsYAxisHovered(false)}
              onMouseDown={handleYAxisMouseDown}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCustomYRange(null);
              }}
            >
              <title>Scroll or drag vertically to zoom price scale (Double-click or press 0 to reset)</title>
            </rect>

            <defs>
              <clipPath id="gp-price-plot-clip">
                <rect
                  x={priceVolPaddingLeft - 8}
                  y={pricePaddingTop - 3}
                  width={priceVolAdjWidth + 16}
                  height={priceAdjHeight + 6}
                />
              </clipPath>
              <linearGradient id="grad-chart" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00ff00" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.0" />
              </linearGradient>
            </defs>
          </svg>
          <div className={PRICE_VOL_PANEL_HEADER_CLASS}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 min-w-0">
              <span className="text-zinc-500">PRICE CHART</span>
              {activeOverlayItems.map((item) => (
                <span key={item.id} className={`${item.colorClass} tabular-nums`}>
                  {item.label}: {typeof item.val === 'number' ? item.val.toFixed(2) : '--'}
                </span>
              ))}
            </div>
            {(isYZoomed || isYAxisDragging) && (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[#ff9900] font-bold tabular-nums shrink-0">
                  Y-SCALE: {yZoomFactor.toFixed(2)}×
                </span>
                <span
                  aria-hidden="true"
                  className="p-0.5 shrink-0 inline-flex items-center justify-center invisible"
                >
                  <X size={11} />
                </span>
              </div>
            )}
          </div>
            </>
          ) : chartDataPhase === 'pending' ? (
            <div style={{ height: BASE_PRICE_HEIGHT }} className="relative w-full">
              <div className={CHART_PANEL_HEADER_CLASS}>
                <span className="text-zinc-500">PRICE CHART</span>
              </div>
            </div>
          ) : (
            <div
              style={{ height: BASE_PRICE_HEIGHT }}
              className="flex flex-col items-center justify-center text-center text-zinc-500 font-mono select-none"
            >
              <p className="text-xs text-zinc-400">
                NO HISTORICAL DATA AVAILABLE FOR
              </p>
              <div className="text-white font-extrabold text-xl sm:text-2xl tracking-wider mt-1.5 mb-2">
                {stock.symbol}
              </div>
              <div className="text-[10px] text-zinc-600">
                DATA PROVIDERS: LIVE YAHOO FINANCE / ALPHA VANTAGE
              </div>
            </div>
          )}
        </div>

        {/* PANEL 2: Volume Study (+ Optional Vol MA 20) */}
        {isChartReady && hoveredData && showVolumeStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={volHeight}
              viewBox={`0 0 ${width} ${volHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
            >
              {/* Subtle interactive backdrop for left Volume Y-axis scale */}
              <rect
                x={2}
                y={volPaddingTop - 6}
                width={paddingLeft - 6}
                height={volPlotHeight + 12}
                rx="2"
                fill={
                  isVolYAxisDragging
                    ? 'rgba(255, 153, 0, 0.12)'
                    : isVolYAxisHovered
                    ? 'rgba(255, 153, 0, 0.06)'
                    : 'transparent'
                }
                stroke={
                  isVolYAxisDragging
                    ? 'rgba(255, 153, 0, 0.45)'
                    : isVolYAxisHovered || isVolYZoomed
                    ? 'rgba(255, 153, 0, 0.22)'
                    : 'transparent'
                }
                strokeWidth="1"
              />

              {[0.25, 0.5, 0.75].map((pct, idx) => {
                const yVal = getVolY(visibleMaxVolume * pct);
                return (
                  <line
                    key={`vol-grid-${idx}`}
                    x1={priceVolPaddingLeft}
                    y1={yVal}
                    x2={width - paddingRight}
                    y2={yVal}
                    stroke="#222"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                );
              })}

              {volExtraHeight > 0 && (
                <line
                  x1={priceVolPaddingLeft}
                  y1={getVolY(visibleMaxVolume)}
                  x2={width - paddingRight}
                  y2={getVolY(visibleMaxVolume)}
                  stroke="#2a2a2a"
                  strokeWidth="1"
                  strokeDasharray="2,2"
                />
              )}

              {volExtraHeight >= 14 && (
                <line
                  x1={priceVolPaddingLeft}
                  y1={volPaddingTop}
                  x2={width - paddingRight}
                  y2={volPaddingTop}
                  stroke="#1c1c1c"
                  strokeWidth="1"
                  strokeDasharray="2,2"
                />
              )}

              {volExtraHeight >= 16 && (
                <text
                  x={paddingLeft - 12}
                  y={volPaddingTop + 6}
                  textAnchor="end"
                  fill={isVolYAxisHovered || isVolYAxisDragging ? '#ff9900' : '#a1a1aa'}
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                  className="pointer-events-none"
                >
                  {formatAxisVolume(topBoundaryVolume)}
                </text>
              )}

              <text
                x={paddingLeft - 12}
                y={volExtraHeight === 0 ? volPaddingTop + 6 : getVolY(visibleMaxVolume) + 3}
                textAnchor="end"
                fill={isVolYAxisHovered || isVolYAxisDragging ? '#ff9900' : '#e4e4e7'}
                fontSize="9.5"
                fontFamily="monospace"
                fontWeight="bold"
                className="pointer-events-none"
              >
                {formatAxisVolume(visibleMaxVolume)}
              </text>
              {isVolYZoomed && (
                <text
                  x={paddingLeft - 12}
                  y={getVolY(visibleMaxVolume * 0.5) + 3}
                  textAnchor="end"
                  fill={isVolYAxisHovered || isVolYAxisDragging ? '#ff9900' : '#a1a1aa'}
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                  className="pointer-events-none"
                >
                  {formatAxisVolume(visibleMaxVolume * 0.5)}
                </text>
              )}
              <text
                x={paddingLeft - 12}
                y={volBaselineY + 3}
                textAnchor="end"
                fill={isVolYAxisHovered || isVolYAxisDragging ? '#ff9900' : '#e4e4e7'}
                fontSize="9.5"
                fontFamily="monospace"
                fontWeight="bold"
                className="pointer-events-none"
              >
                0
              </text>

              <g clipPath="url(#gp-vol-plot-clip)">
                {history.map((h, i) => {
                  const barX = getPriceVolX(i) - priceVolBarWidth / 2;
                  const safeVol = Math.max(0, h.volume);
                  const rawBarY = getVolY(safeVol);
                  const rawBarH = Math.max(0, volBaselineY - rawBarY);
                  const barH = safeVol > 0 ? Math.max(2, rawBarH) : 1;
                  const barY = volBaselineY - barH;
                  const isGreen = h.close >= h.open;
                  return (
                    <rect
                      key={`vol-bar-${i}`}
                      x={barX}
                      y={barY}
                      width={priceVolBarWidth}
                      height={barH}
                      fill={isGreen ? 'rgba(0, 255, 0, 0.15)' : 'rgba(255, 68, 68, 0.15)'}
                      stroke={isGreen ? '#00ff00' : '#ff4444'}
                      strokeWidth="0.8"
                    />
                  );
                })}

                {showVolMaStudy && (
                  <path
                    d={generatePriceVolSeriesPath((b) => b.volMa, getVolY)}
                    fill="none"
                    stroke="#ff9900"
                    strokeWidth="1.4"
                    opacity="0.9"
                  />
                )}
              </g>

              {history.map((_, i) => {
                const { x, stripeWidth } = getPriceVolHoverStripeBounds(i);
                return (
                  <rect
                    key={`vol-detect-${i}`}
                    x={x}
                    y={volPaddingTop}
                    width={stripeWidth}
                    height={volPlotHeight}
                    fill="transparent"
                    className="cursor-crosshair"
                    onMouseEnter={() => setHoverIndex(i)}
                  />
                );
              })}

              {hoverIndex !== null && (
                <line
                  x1={getPriceVolX(hoverIndex)}
                  y1={volPaddingTop}
                  x2={getPriceVolX(hoverIndex)}
                  y2={volBaselineY}
                  stroke="#ff9900"
                  strokeWidth="0.8"
                  strokeDasharray="2,2"
                />
              )}

              {/* Interactive Left Y-Axis Scale Hit Area for Volume */}
              <rect
                ref={volYAxisHitRef}
                x={0}
                y={0}
                width={paddingLeft}
                height={volHeight}
                fill="transparent"
                className="cursor-ns-resize"
                onMouseEnter={() => {
                  setIsVolYAxisHovered(true);
                  setHoverIndex(null);
                }}
                onMouseLeave={() => setIsVolYAxisHovered(false)}
                onMouseDown={handleVolYAxisMouseDown}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCustomVolMax(null);
                }}
              >
                <title>Scroll or drag vertically to zoom volume scale (Double-click or press 0 to reset)</title>
              </rect>

              <defs>
                <clipPath id="gp-vol-plot-clip">
                  <rect
                    x={priceVolPaddingLeft - 8}
                    y={volPaddingTop - 1}
                    width={priceVolAdjWidth + 16}
                    height={volPlotHeight + 2}
                  />
                </clipPath>
              </defs>
            </svg>
            <div className={PRICE_VOL_PANEL_HEADER_CLASS}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                <span className="text-zinc-500 inline-flex items-center gap-2">
                  <span>VOLUME STUDY</span>
                  <span className="text-zinc-300 tabular-nums">
                    BAR: {formatAxisVolume(hoveredData.volume)}
                  </span>
                </span>
                <div className="relative group/vol-tip pointer-events-auto inline-flex items-center">
                  <button
                    type="button"
                    aria-label="How to read Volume Study"
                    className="text-zinc-500 hover:text-[#ff9900] focus:text-[#ff9900] focus:outline-none cursor-help p-0.5 inline-flex items-center justify-center"
                  >
                    <Info size={12} />
                  </button>
                  <div
                    role="tooltip"
                    className="hidden group-hover/vol-tip:block group-focus-within/vol-tip:block absolute left-0 bottom-full mb-1.5 w-[340px] sm:w-[440px] max-w-[calc(100vw-6rem)] z-50 bg-[#0a0a0a] border border-[#444] rounded p-3 shadow-2xl shadow-black/95 normal-case tracking-normal font-mono font-normal text-[11px] leading-relaxed text-zinc-300 select-text"
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#ff9900] border-b border-[#222] pb-1 mb-2">
                      Volume Study
                    </div>
                    <div className="space-y-2">
                      <p>
                        <span className="text-zinc-100 font-bold">Bar Height:</span> The height of each vertical bar represents the total trading activity for that single candle. Taller bars indicate heavy participation from institutional and retail traders, while shorter bars show quiet trading.
                      </p>
                      <p>
                        <span className="text-[#00ff00] font-bold">Bar Color:</span> The volume bar is green if the stock closed higher than it opened for that period, and red if it closed lower.
                      </p>
                      <p>
                        <span className="text-[#ff9900] font-bold">Moving Average Line:</span> Many traders add a 20-period moving average line across the volume bars. Any bar rising well above this line signals unusual market interest.
                      </p>
                    </div>
                  </div>
                </div>
                {showVolMaStudy && (
                  <span className="text-[#ff9900] tabular-nums">
                    MA(20): {typeof hoveredData.volMa === 'number' ? formatAxisVolume(hoveredData.volMa) : '--'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(isVolYZoomed || isVolYAxisDragging) && (
                  <span className="text-[#ff9900] font-bold tabular-nums">
                    Y-SCALE: {volYZoomFactor.toFixed(2)}×
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => toggleStudy('volume')}
                  title="Hide Volume study"
                  aria-label="Hide Volume study"
                  className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer shrink-0 inline-flex items-center justify-center"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PANEL 3: RSI Study */}
        {isChartReady && hoveredData && showRsiStudy && (() => {
          const visibleRefLevels = [30, 50, 70].filter(
            (lvl) => lvl >= minRsi - 0.001 && lvl <= maxRsi + 0.001
          );
          const rsiScaleTicks = isRsiYZoomed
            ? [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
                pct,
                val: maxRsi - pct * rsiRange,
                yVal: rsiPaddingTop + pct * rsiAdjHeight,
              }))
            : [];

          return (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={rsiHeight}
              viewBox={`0 0 ${width} ${rsiHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
            >
              {/* Subtle interactive backdrop for left RSI Y-axis scale */}
              <rect
                x={2}
                y={rsiPaddingTop - 6}
                width={paddingLeft - 6}
                height={rsiAdjHeight + 12}
                rx="2"
                fill={
                  isRsiYAxisDragging
                    ? 'rgba(255, 153, 0, 0.12)'
                    : isRsiYAxisHovered
                    ? 'rgba(255, 153, 0, 0.06)'
                    : 'transparent'
                }
                stroke={
                  isRsiYAxisDragging
                    ? 'rgba(255, 153, 0, 0.45)'
                    : isRsiYAxisHovered || isRsiYZoomed
                    ? 'rgba(255, 153, 0, 0.22)'
                    : 'transparent'
                }
                strokeWidth="1"
              />

              <g clipPath="url(#gp-rsi-plot-clip)">
                <rect
                  x={paddingLeft}
                  y={getRsiY(100)}
                  width={width - paddingLeft - paddingRight}
                  height={Math.max(0, getRsiY(70) - getRsiY(100))}
                  fill="rgba(239, 68, 68, 0.08)"
                />
                <rect
                  x={paddingLeft}
                  y={getRsiY(30)}
                  width={width - paddingLeft - paddingRight}
                  height={Math.max(0, getRsiY(0) - getRsiY(30))}
                  fill="rgba(34, 197, 94, 0.08)"
                />
              </g>

              {/* Dynamic scale gridlines & labels when RSI Y-axis is zoomed */}
              {rsiScaleTicks.map(({ pct, val, yVal }) => {
                const nearRefLine = visibleRefLevels.some(
                  (lvl) => Math.abs(getRsiY(lvl) - yVal) < 3
                );
                const nearRefLabel = visibleRefLevels.some(
                  (lvl) => Math.abs(getRsiY(lvl) - yVal) < 13
                );
                const formattedVal =
                  Math.abs(val - Math.round(val)) < 0.05 || rsiRange >= 25
                    ? `${Math.round(val)}`
                    : val.toFixed(1);

                return (
                  <g key={`rsi-scale-${pct}`}>
                    {!nearRefLine && (
                      <line
                        x1={paddingLeft}
                        y1={yVal}
                        x2={width - paddingRight}
                        y2={yVal}
                        stroke="#1f1f1f"
                        strokeWidth="1"
                        strokeDasharray="2,2"
                      />
                    )}
                    {!nearRefLabel && (
                      <text
                        x={paddingLeft - 6}
                        y={yVal + 3}
                        textAnchor="end"
                        fill={isRsiYAxisHovered || isRsiYAxisDragging ? '#ff9900' : '#a1a1aa'}
                        fontSize="9.5"
                        fontFamily="monospace"
                        fontWeight="bold"
                        className="pointer-events-none"
                      >
                        {formattedVal}
                      </text>
                    )}
                  </g>
                );
              })}

              {visibleRefLevels.map((level) => {
                const yVal = getRsiY(level);
                const strokeColor =
                  level === 50 ? '#333' : level === 70 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(34, 197, 94, 0.5)';
                const textColor =
                  isRsiYAxisHovered || isRsiYAxisDragging
                    ? '#ff9900'
                    : level === 50
                    ? '#a1a1aa'
                    : level === 70
                    ? '#ef4444'
                    : '#22c55e';
                const rightTextColor = level === 50 ? '#a1a1aa' : level === 70 ? '#ef4444' : '#22c55e';
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
                      fontSize="9.5"
                      fontFamily="monospace"
                      fontWeight="bold"
                      className="pointer-events-none"
                    >
                      {labelText}
                    </text>
                    {yVal >= rsiPaddingTop + 8 && (
                      <text
                        x={width - paddingRight + 4}
                        y={yVal + 3}
                        textAnchor="start"
                        fill={rightTextColor}
                        fontSize="9.5"
                        fontFamily="monospace"
                        fontWeight="bold"
                        className="pointer-events-none"
                      >
                        {labelText}
                      </text>
                    )}
                  </g>
                );
              })}

              <g clipPath="url(#gp-rsi-plot-clip)">
                <path
                  d={rsiList.map((val, i) => `${i === 0 ? 'M' : 'L'}${getX(i)},${getRsiY(val)}`).join(' ')}
                  fill="none"
                  stroke="#9b59b6"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </g>

              {history.map((_, i) => {
                const { x, stripeWidth } = getHoverStripeBounds(i);
                return (
                  <rect
                    key={`rsi-detect-${i}`}
                    x={x}
                    y={rsiPaddingTop}
                    width={stripeWidth}
                    height={rsiAdjHeight}
                    fill="transparent"
                    className="cursor-crosshair"
                    onMouseEnter={() => setHoverIndex(i)}
                  />
                );
              })}

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
                  <g clipPath="url(#gp-rsi-plot-clip)">
                    <circle
                      cx={getX(hoverIndex)}
                      cy={getRsiY(rsiList[hoverIndex])}
                      r="3"
                      fill="#ff9900"
                      stroke="black"
                      strokeWidth="1"
                    />
                  </g>
                </g>
              )}

              {/* Interactive Left Y-Axis Scale Hit Area for RSI */}
              <rect
                ref={rsiYAxisHitRef}
                x={0}
                y={0}
                width={paddingLeft}
                height={rsiHeight}
                fill="transparent"
                className="cursor-ns-resize"
                onMouseEnter={() => {
                  setIsRsiYAxisHovered(true);
                  setHoverIndex(null);
                }}
                onMouseLeave={() => setIsRsiYAxisHovered(false)}
                onMouseDown={handleRsiYAxisMouseDown}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCustomRsiRange(null);
                }}
              >
                <title>Scroll or drag vertically to zoom RSI scale (Double-click or press 0 to reset)</title>
              </rect>

              <defs>
                <clipPath id="gp-rsi-plot-clip">
                  <rect
                    x={paddingLeft - 8}
                    y={rsiPaddingTop - 3}
                    width={adjWidth + 16}
                    height={rsiAdjHeight + 6}
                  />
                </clipPath>
              </defs>
            </svg>
            <div className={CHART_PANEL_HEADER_CLASS}>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                <span className="text-zinc-500 inline-flex items-center gap-1.5">
                  <span>RSI OSCILLATOR (14)</span>
                  <span className="text-[#9b59b6] tabular-nums">{currentRsi.toFixed(1)}</span>
                </span>
                <div className="relative group/rsi-tip pointer-events-auto inline-flex items-center">
                  <button
                    type="button"
                    aria-label="How to read RSI Oscillator (14)"
                    className="text-zinc-500 hover:text-[#9b59b6] focus:text-[#9b59b6] focus:outline-none cursor-help p-0.5 inline-flex items-center justify-center"
                  >
                    <Info size={12} />
                  </button>
                  <div
                    role="tooltip"
                    className="hidden group-hover/rsi-tip:block group-focus-within/rsi-tip:block absolute left-0 bottom-full mb-1.5 w-[340px] sm:w-[440px] max-w-[calc(100vw-6rem)] z-50 bg-[#0a0a0a] border border-[#444] rounded p-3 shadow-2xl shadow-black/95 normal-case tracking-normal font-mono font-normal text-[11px] leading-relaxed text-zinc-300 select-text"
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#9b59b6] border-b border-[#222] pb-1 mb-2">
                      RSI Oscillator Study
                    </div>
                    <div className="space-y-2">
                      <p>
                        <span className="text-[#ef4444] font-bold">70 (Overbought):</span> An RSI reading above 70 suggests the stock has seen heavy buying pressure and may be overbought or due for a short-term pullback. (In strong bull markets, traders sometimes adjust this threshold to 80.)
                      </p>
                      <p>
                        <span className="text-[#22c55e] font-bold">30 (Oversold):</span> An RSI reading below 30 suggests the stock has experienced heavy selling pressure and may be oversold or due for a bounce. (In strong downtrends, traders sometimes adjust this threshold to 20.)
                      </p>
                      <p>
                        <span className="text-zinc-100 font-bold">50 (The Centerline):</span> Acts as the balance point between bullish and bearish momentum. Readings above 50 generally confirm bullish momentum, while readings below 50 confirm bearish momentum.
                      </p>
                      <p>
                        <span className="text-[#9b59b6] font-bold">40 and 60 (Trend-Specific Zones):</span> During a strong uptrend, RSI often stays in the 40 to 90 range, with the 40–50 zone acting as support. During a strong downtrend, RSI tends to stay in the 10 to 60 range, with the 50–60 zone acting as resistance.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(isRsiYZoomed || isRsiYAxisDragging) && (
                  <span className="text-[#ff9900] font-bold tabular-nums">
                    Y-SCALE: {rsiYZoomFactor.toFixed(2)}×
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => toggleStudy('rsi')}
                  title="Hide RSI study"
                  aria-label="Hide RSI study"
                  className="pointer-events-auto text-zinc-600 hover:text-[#ff4444] p-0.5 cursor-pointer shrink-0 inline-flex items-center justify-center"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          </div>
          );
        })()}

        {/* PANEL 4: MACD (12, 26, 9) */}
        {isChartReady && hoveredData && showMacdStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
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
        {isChartReady && hoveredData && showStochStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
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
        {isChartReady && hoveredData && showCciStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
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
        {isChartReady && hoveredData && showAdxStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
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
        {isChartReady && hoveredData && showAtrStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
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
        {isChartReady && hoveredData && showObvStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
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
        {isChartReady && hoveredData && showRocStudy && (
          <div className="relative border-t border-[#161616] pt-1">
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
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
        <span>
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
              : '1M (LAST 30/31 DAYS)'}
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

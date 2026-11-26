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
  ATR_PADDING_BOTTOM,
  ATR_PADDING_TOP,
  BASE_PRICE_HEIGHT,
  MACD_PADDING_BOTTOM,
  MACD_PADDING_TOP,
  MAX_PRICE_EXPANSION_PX,
  OBV_PADDING_BOTTOM,
  OBV_PADDING_TOP,
  PRICE_ZOOM_EDGE_PADDING_RATIO,
  RSI_NATURAL_MAX,
  RSI_NATURAL_MIN,
  computeAtrPanelLayout,
  computeAutoAtrRange,
  computeAutoMacdRange,
  computeAutoObvRange,
  computeAutoPriceRange,
  computeMacdPanelLayout,
  computeObvPanelLayout,
  computeOffscalePcBadgeLayout,
  computePriceZoomLimits,
  computeScaledBoundedRange,
  computeScaledMacdZoom,
  computeScaledRsiRange,
  computeScaledStudyZoom,
  computeScaledVolumeMax,
  computeVolumePanelLayout,
  dragDeltaToZoomFactor,
  ensureRangeIncludesFocusBand,
  formatAtrAxisValue,
  formatMacdAxisValue,
  formatObvAxisValue,
  panBoundedRange,
  resolveReferenceLevelLabels,
  shouldShowYScaleIndicator,
  wheelDeltaToZoomFactor,
  type ReferenceLevelLabelInput,
  type YRange,
} from '../utils/yAxisZoom';
import {
  dispatchChartResetShortcut,
  isEditableKeyboardTarget,
  isZoomableChartPanel,
  type ChartPanelId,
  type ZoomableChartPanelId,
} from '../utils/chartFocus';
import CompanyLogo, { isCompanyEquitySymbol } from './CompanyLogo';

interface ChartWidgetProps {
  stock: StockData;
  onTickTimeChange?: (val: string) => void;
  initialCustomYRange?: YRange | null;
  initialCustomMacdZoom?: number | null;
  initialCustomAtrZoom?: number | null;
  initialCustomObvZoom?: number | null;
  initialResolvedEmptyKey?: string | null;
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
  initialCustomYRange = null,
  initialCustomMacdZoom = null,
  initialCustomAtrZoom = null,
  initialCustomObvZoom = null,
  initialResolvedEmptyKey = null,
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
  const [resolvedEmptyKey, setResolvedEmptyKey] = useState<string | null>(initialResolvedEmptyKey);
  const [historyLoadingKey, setHistoryLoadingKey] = useState<string | null>(null);
  const chartStackRef = useRef<HTMLDivElement | null>(null);
  const chartPanelRef = useRef<HTMLDivElement | null>(null);
  const focusedChartRef = useRef<ChartPanelId | null>(null);
  const chartPanelElsRef = useRef<Partial<Record<ChartPanelId, HTMLDivElement | null>>>({});
  const visiblePanelsRef = useRef<ReadonlySet<ChartPanelId>>(new Set());
  const yAxisHitRef = useRef<SVGRectElement | null>(null);
  const volYAxisHitRef = useRef<SVGRectElement | null>(null);
  const rsiYAxisHitRef = useRef<SVGRectElement | null>(null);
  const macdYAxisHitRef = useRef<SVGRectElement | null>(null);
  const atrYAxisHitRef = useRef<SVGRectElement | null>(null);
  const obvYAxisHitRef = useRef<SVGRectElement | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(600);
  const [customYRange, setCustomYRange] = useState<YRange | null>(initialCustomYRange);
  const [isYAxisHovered, setIsYAxisHovered] = useState<boolean>(false);
  const [isYAxisDragging, setIsYAxisDragging] = useState<boolean>(false);
  const [isPlotPanning, setIsPlotPanning] = useState<boolean>(false);
  const dragStateRef = useRef<{ startY: number; startMin: number; startMax: number } | null>(null);
  const panStateRef = useRef<{
    startY: number;
    startMin: number;
    startMax: number;
    plotHeight: number;
    hasMoved: boolean;
  } | null>(null);
  const scaleContextRef = useRef<{
    minPrice: number;
    maxPrice: number;
    computeScaledYRange: (baseMin: number, baseMax: number, factor: number) => YRange;
    panYRange: (baseMin: number, baseMax: number, deltaPrice: number) => YRange;
    normalizeYRange: (range: YRange) => YRange;
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

  // Independent MACD Study Y-axis zoom state (zoom factor relative to data-aware auto range)
  const [customMacdZoom, setCustomMacdZoom] = useState<number | null>(initialCustomMacdZoom);
  const [isMacdYAxisHovered, setIsMacdYAxisHovered] = useState<boolean>(false);
  const [isMacdYAxisDragging, setIsMacdYAxisDragging] = useState<boolean>(false);
  const macdDragStateRef = useRef<{ startY: number; startZoom: number } | null>(null);
  const macdScaleContextRef = useRef<{
    macdYZoomFactor: number;
    computeScaledMacdZoomFactor: (baseZoom: number, factor: number) => number;
    isModalOpen: boolean;
  } | null>(null);

  // Independent ATR Study Y-axis zoom state (zoom factor relative to data-aware non-negative auto range)
  const [customAtrZoom, setCustomAtrZoom] = useState<number | null>(initialCustomAtrZoom);
  const [isAtrYAxisHovered, setIsAtrYAxisHovered] = useState<boolean>(false);
  const [isAtrYAxisDragging, setIsAtrYAxisDragging] = useState<boolean>(false);
  const atrDragStateRef = useRef<{ startY: number; startZoom: number } | null>(null);
  const atrScaleContextRef = useRef<{
    atrYZoomFactor: number;
    computeScaledAtrZoomFactor: (baseZoom: number, factor: number) => number;
    isModalOpen: boolean;
  } | null>(null);

  // Independent OBV Study Y-axis zoom state (zoom factor relative to data-aware cumulative auto range)
  const [customObvZoom, setCustomObvZoom] = useState<number | null>(initialCustomObvZoom);
  const [isObvYAxisHovered, setIsObvYAxisHovered] = useState<boolean>(false);
  const [isObvYAxisDragging, setIsObvYAxisDragging] = useState<boolean>(false);
  const obvDragStateRef = useRef<{ startY: number; startZoom: number } | null>(null);
  const obvScaleContextRef = useRef<{
    obvYZoomFactor: number;
    computeScaledObvZoomFactor: (baseZoom: number, factor: number) => number;
    isModalOpen: boolean;
  } | null>(null);

  const isVolYAxisActiveRef = useRef<boolean>(false);
  isVolYAxisActiveRef.current = isVolYAxisHovered || isVolYAxisDragging;
  const isRsiYAxisActiveRef = useRef<boolean>(false);
  isRsiYAxisActiveRef.current = isRsiYAxisHovered || isRsiYAxisDragging;
  const isMacdYAxisActiveRef = useRef<boolean>(false);
  isMacdYAxisActiveRef.current = isMacdYAxisHovered || isMacdYAxisDragging;
  const isAtrYAxisActiveRef = useRef<boolean>(false);
  isAtrYAxisActiveRef.current = isAtrYAxisHovered || isAtrYAxisDragging;
  const isObvYAxisActiveRef = useRef<boolean>(false);
  isObvYAxisActiveRef.current = isObvYAxisHovered || isObvYAxisDragging;

  // Shared active-chart focus tracker (ref-based so listeners never read stale state)
  const focusChart = (panelId: ChartPanelId, options?: { focusDom?: boolean }) => {
    focusedChartRef.current = panelId;
    if (options?.focusDom === false) return;
    const panelEl = chartPanelElsRef.current[panelId];
    if (panelEl && typeof document !== 'undefined') {
      const activeEl = document.activeElement;
      if (!activeEl || !panelEl.contains(activeEl)) {
        panelEl.focus?.({ preventScroll: true });
      }
    }
  };

  // Shared chart-specific reset logic reused by both double-click and the `0` keyboard shortcut
  const resetChartPanel = (panelId: ZoomableChartPanelId) => {
    switch (panelId) {
      case 'price':
        dragStateRef.current = null;
        panStateRef.current = null;
        setIsYAxisDragging(false);
        setIsPlotPanning(false);
        setCustomYRange(null);
        return;
      case 'volume':
        volDragStateRef.current = null;
        setIsVolYAxisDragging(false);
        setCustomVolMax(null);
        return;
      case 'rsi':
        rsiDragStateRef.current = null;
        setIsRsiYAxisDragging(false);
        setCustomRsiRange(null);
        return;
      case 'macd':
        macdDragStateRef.current = null;
        setIsMacdYAxisDragging(false);
        setCustomMacdZoom(null);
        return;
      case 'atr':
        atrDragStateRef.current = null;
        setIsAtrYAxisDragging(false);
        setCustomAtrZoom(null);
        return;
      case 'obv':
        obvDragStateRef.current = null;
        setIsObvYAxisDragging(false);
        setCustomObvZoom(null);
        return;
    }
  };

  const resetHandlersRef = useRef<Record<ZoomableChartPanelId, () => void>>({
    price: () => resetChartPanel('price'),
    volume: () => resetChartPanel('volume'),
    rsi: () => resetChartPanel('rsi'),
    macd: () => resetChartPanel('macd'),
    atr: () => resetChartPanel('atr'),
    obv: () => resetChartPanel('obv'),
  });
  resetHandlersRef.current = {
    price: () => resetChartPanel('price'),
    volume: () => resetChartPanel('volume'),
    rsi: () => resetChartPanel('rsi'),
    macd: () => resetChartPanel('macd'),
    atr: () => resetChartPanel('atr'),
    obv: () => resetChartPanel('obv'),
  };

  const getPanelFocusProps = (panelId: ChartPanelId) => ({
    'data-chart-panel': panelId,
    tabIndex: -1,
    onMouseDownCapture: (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target instanceof Element ? e.target : null;
      const isInteractiveChild = Boolean(
        target?.closest(
          'button, a, input, textarea, select, [contenteditable="true"], [contenteditable=""]'
        )
      );
      focusChart(panelId, { focusDom: !isInteractiveChild });
    },
    onFocusCapture: () => {
      focusChart(panelId, { focusDom: false });
    },
  });

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
    setCustomMacdZoom(null);
    setCustomAtrZoom(null);
    setCustomObvZoom(null);

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

  const visiblePanels = new Set<ChartPanelId>();
  if (hasChartData) {
    visiblePanels.add('price');
    if (showVolumeStudy) visiblePanels.add('volume');
    if (showRsiStudy) visiblePanels.add('rsi');
    if (showMacdStudy) visiblePanels.add('macd');
    if (showStochStudy) visiblePanels.add('stoch');
    if (showCciStudy) visiblePanels.add('cci');
    if (showAdxStudy) visiblePanels.add('adx');
    if (showAtrStudy) visiblePanels.add('atr');
    if (showObvStudy) visiblePanels.add('obv');
    if (showRocStudy) visiblePanels.add('roc');
  }
  visiblePanelsRef.current = visiblePanels;

  // Clear chart focus when the focused study is hidden or chart data unloads
  useEffect(() => {
    const current = focusedChartRef.current;
    if (current && !visiblePanelsRef.current.has(current)) {
      focusedChartRef.current = null;
    }
  }, [
    hasChartData,
    showVolumeStudy,
    showRsiStudy,
    showMacdStudy,
    showStochStudy,
    showCciStudy,
    showAdxStudy,
    showAtrStudy,
    showObvStudy,
    showRocStudy,
  ]);

  // Clear active chart focus when clicking or focusing outside the chart stack
  useEffect(() => {
    const handleDocumentMouseDown = (e: MouseEvent) => {
      const stackEl = chartStackRef.current;
      if (!stackEl) return;
      const target = e.target as Node | null;
      if (!target || !stackEl.contains(target)) {
        focusedChartRef.current = null;
      }
    };

    const handleDocumentFocusIn = (e: FocusEvent) => {
      const stackEl = chartStackRef.current;
      if (!stackEl) return;
      const target = e.target as Node | null;
      if (!target || !stackEl.contains(target)) {
        focusedChartRef.current = null;
      }
    };

    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    document.addEventListener('focusin', handleDocumentFocusIn);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
      document.removeEventListener('focusin', handleDocumentFocusIn);
    };
  }, []);

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

  useEffect(() => {
    if (!showMacdStudy) {
      macdDragStateRef.current = null;
      setIsMacdYAxisDragging(false);
      setIsMacdYAxisHovered(false);
    }
  }, [showMacdStudy]);

  useEffect(() => {
    if (!showAtrStudy) {
      atrDragStateRef.current = null;
      setIsAtrYAxisDragging(false);
      setIsAtrYAxisHovered(false);
    }
  }, [showAtrStudy]);

  useEffect(() => {
    if (!showObvStudy) {
      obvDragStateRef.current = null;
      setIsObvYAxisDragging(false);
      setIsObvYAxisHovered(false);
    }
  }, [showObvStudy]);

  // Attach non-passive wheel listener on Price Chart left Y-axis area to zoom without scrolling page
  useEffect(() => {
    if (!hasChartData) return;
    const hitEl = yAxisHitRef.current;
    if (!hitEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focusChart('price');
      const ctx = scaleContextRef.current;
      if (!ctx) return;

      // Wheel up (deltaY < 0) => zoom in; wheel down (deltaY > 0) => zoom out
      const factor = wheelDeltaToZoomFactor(e.deltaY);
      setCustomYRange((prev) => {
        const base = prev
          ? ctx.normalizeYRange(prev)
          : { min: ctx.minPrice, max: ctx.maxPrice };
        return ctx.computeScaledYRange(base.min, base.max, factor);
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
      focusChart('volume');
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
      focusChart('rsi');
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

  // Attach non-passive wheel listener on MACD left Y-axis area
  useEffect(() => {
    if (!hasChartData || !showMacdStudy) return;
    const hitEl = macdYAxisHitRef.current;
    if (!hitEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focusChart('macd');
      const ctx = macdScaleContextRef.current;
      if (!ctx) return;

      const factor = wheelDeltaToZoomFactor(e.deltaY);
      setCustomMacdZoom((prev) => {
        const curZoom = prev !== null ? prev : ctx.macdYZoomFactor;
        return ctx.computeScaledMacdZoomFactor(curZoom, factor);
      });
    };

    hitEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      hitEl.removeEventListener('wheel', handleWheel);
    };
  }, [hasChartData, showMacdStudy]);

  // Attach non-passive wheel listener on ATR left Y-axis area
  useEffect(() => {
    if (!hasChartData || !showAtrStudy) return;
    const hitEl = atrYAxisHitRef.current;
    if (!hitEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focusChart('atr');
      const ctx = atrScaleContextRef.current;
      if (!ctx) return;

      const factor = wheelDeltaToZoomFactor(e.deltaY);
      setCustomAtrZoom((prev) => {
        const curZoom = prev !== null ? prev : ctx.atrYZoomFactor;
        return ctx.computeScaledAtrZoomFactor(curZoom, factor);
      });
    };

    hitEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      hitEl.removeEventListener('wheel', handleWheel);
    };
  }, [hasChartData, showAtrStudy]);

  // Attach non-passive wheel listener on OBV left Y-axis area
  useEffect(() => {
    if (!hasChartData || !showObvStudy) return;
    const hitEl = obvYAxisHitRef.current;
    if (!hitEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focusChart('obv');
      const ctx = obvScaleContextRef.current;
      if (!ctx) return;

      const factor = wheelDeltaToZoomFactor(e.deltaY);
      setCustomObvZoom((prev) => {
        const curZoom = prev !== null ? prev : ctx.obvYZoomFactor;
        return ctx.computeScaledObvZoomFactor(curZoom, factor);
      });
    };

    hitEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      hitEl.removeEventListener('wheel', handleWheel);
    };
  }, [hasChartData, showObvStudy]);

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

  // Smooth vertical plot panning (clamped to keep candlesticks strictly inside the plot)
  useEffect(() => {
    if (!isPlotPanning) return;

    const handleMouseMove = (e: MouseEvent) => {
      const pan = panStateRef.current;
      const ctx = scaleContextRef.current;
      if (!pan || !ctx) return;
      const dy = e.clientY - pan.startY;
      if (!pan.hasMoved && Math.abs(dy) < 3) return;
      pan.hasMoved = true;
      const startSpan = Math.max(pan.startMax - pan.startMin, 0.0001);
      const deltaPrice = (dy / Math.max(pan.plotHeight, 1)) * startSpan;
      setCustomYRange(ctx.panYRange(pan.startMin, pan.startMax, deltaPrice));
    };

    const handleMouseUp = () => {
      panStateRef.current = null;
      setIsPlotPanning(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPlotPanning]);

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

  // Smooth vertical Y-axis drag handling for MACD Study
  useEffect(() => {
    if (!isMacdYAxisDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const drag = macdDragStateRef.current;
      const ctx = macdScaleContextRef.current;
      if (!drag || !ctx) return;
      const dy = e.clientY - drag.startY;
      const factor = dragDeltaToZoomFactor(dy);
      setCustomMacdZoom(ctx.computeScaledMacdZoomFactor(drag.startZoom, factor));
    };

    const handleMouseUp = () => {
      macdDragStateRef.current = null;
      setIsMacdYAxisDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isMacdYAxisDragging]);

  // Smooth vertical Y-axis drag handling for ATR Study
  useEffect(() => {
    if (!isAtrYAxisDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const drag = atrDragStateRef.current;
      const ctx = atrScaleContextRef.current;
      if (!drag || !ctx) return;
      const dy = e.clientY - drag.startY;
      const factor = dragDeltaToZoomFactor(dy);
      setCustomAtrZoom(ctx.computeScaledAtrZoomFactor(drag.startZoom, factor));
    };

    const handleMouseUp = () => {
      atrDragStateRef.current = null;
      setIsAtrYAxisDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isAtrYAxisDragging]);

  // Smooth vertical Y-axis drag handling for OBV Study
  useEffect(() => {
    if (!isObvYAxisDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const drag = obvDragStateRef.current;
      const ctx = obvScaleContextRef.current;
      if (!drag || !ctx) return;
      const dy = e.clientY - drag.startY;
      const factor = dragDeltaToZoomFactor(dy);
      setCustomObvZoom(ctx.computeScaledObvZoomFactor(drag.startZoom, factor));
    };

    const handleMouseUp = () => {
      obvDragStateRef.current = null;
      setIsObvYAxisDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isObvYAxisDragging]);

  // Keyboard zoom shortcuts (+ / =, - / _) and focused-chart reset (0)
  useEffect(() => {
    if (!hasChartData) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const priceCtx = scaleContextRef.current;
      if (!priceCtx || priceCtx.isModalOpen) return;
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableKeyboardTarget(e.target) || isEditableKeyboardTarget(document.activeElement)) {
        return;
      }

      // `0` resets ONLY the currently focused visible zoomable chart via the shared double-click reset logic
      if (e.key === '0') {
        const resetPanel = dispatchChartResetShortcut(
          {
            key: e.key,
            repeat: e.repeat,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            altKey: e.altKey,
            defaultPrevented: e.defaultPrevented,
            target: e.target,
            activeElement: typeof document !== 'undefined' ? document.activeElement : null,
            isModalOpen: priceCtx.isModalOpen,
            focusedPanel: focusedChartRef.current,
            visiblePanels: visiblePanelsRef.current,
          },
          resetHandlersRef.current
        );
        if (resetPanel) {
          e.preventDefault();
        }
        return;
      }

      const isZoomIn = e.key === '+' || e.key === '=';
      const isZoomOut = e.key === '-' || e.key === '_';
      if (!isZoomIn && !isZoomOut) return;

      const focusedZoomablePanel =
        focusedChartRef.current &&
        visiblePanelsRef.current.has(focusedChartRef.current) &&
        isZoomableChartPanel(focusedChartRef.current)
          ? focusedChartRef.current
          : null;

      const activeZoomPanel: ZoomableChartPanelId = isVolYAxisActiveRef.current
        ? 'volume'
        : isRsiYAxisActiveRef.current
        ? 'rsi'
        : isMacdYAxisActiveRef.current
        ? 'macd'
        : isAtrYAxisActiveRef.current
        ? 'atr'
        : isObvYAxisActiveRef.current
        ? 'obv'
        : focusedZoomablePanel ?? 'price';

      if (activeZoomPanel === 'volume') {
        const volCtx = volScaleContextRef.current;
        if (!volCtx) return;
        e.preventDefault();
        setCustomVolMax((prev) =>
          volCtx.computeScaledVolMax(
            prev !== null ? prev : volCtx.visibleMaxVolume,
            isZoomIn ? 1.2 : 1 / 1.2
          )
        );
        return;
      }

      if (activeZoomPanel === 'rsi') {
        const rsiCtx = rsiScaleContextRef.current;
        if (!rsiCtx) return;
        e.preventDefault();
        setCustomRsiRange((prev) => {
          const curMin = prev ? prev.min : rsiCtx.minRsi;
          const curMax = prev ? prev.max : rsiCtx.maxRsi;
          return rsiCtx.computeScaledRsiYRange(curMin, curMax, isZoomIn ? 1.2 : 1 / 1.2);
        });
        return;
      }

      if (activeZoomPanel === 'macd') {
        const macdCtx = macdScaleContextRef.current;
        if (!macdCtx) return;
        e.preventDefault();
        setCustomMacdZoom((prev) =>
          macdCtx.computeScaledMacdZoomFactor(
            prev !== null ? prev : macdCtx.macdYZoomFactor,
            isZoomIn ? 1.2 : 1 / 1.2
          )
        );
        return;
      }

      if (activeZoomPanel === 'atr') {
        const atrCtx = atrScaleContextRef.current;
        if (!atrCtx) return;
        e.preventDefault();
        setCustomAtrZoom((prev) =>
          atrCtx.computeScaledAtrZoomFactor(
            prev !== null ? prev : atrCtx.atrYZoomFactor,
            isZoomIn ? 1.2 : 1 / 1.2
          )
        );
        return;
      }

      if (activeZoomPanel === 'obv') {
        const obvCtx = obvScaleContextRef.current;
        if (!obvCtx) return;
        e.preventDefault();
        setCustomObvZoom((prev) =>
          obvCtx.computeScaledObvZoomFactor(
            prev !== null ? prev : obvCtx.obvYZoomFactor,
            isZoomIn ? 1.2 : 1 / 1.2
          )
        );
        return;
      }

      e.preventDefault();
      setCustomYRange((prev) => {
        const base = prev
          ? priceCtx.normalizeYRange(prev)
          : { min: priceCtx.minPrice, max: priceCtx.maxPrice };
        return priceCtx.computeScaledYRange(base.min, base.max, isZoomIn ? 1.2 : 1 / 1.2);
      });
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
  const plotLeft = priceVolPaddingLeft;
  const adjWidth = Math.max(100, width - plotLeft - paddingRight);
  const priceVolAdjWidth = adjWidth;

  const pricePaddingTop = 18;
  const pricePaddingBottom = 18;
  const Y_AXIS_VERTICAL_EXTRA_PAD = 6;
  const Y_AXIS_BACKDROP_PAD_Y = 6 + Y_AXIS_VERTICAL_EXTRA_PAD;

  const barStep = adjWidth / Math.max(history.length, 1);
  const priceVolBarStep = barStep;
  const candleWidth = Math.max(4, Math.min(14, Math.floor(priceVolBarStep * 0.55)));
  const volBarWidth = Math.max(3, Math.min(12, Math.floor(barStep * 0.5)));
  const priceVolBarWidth = volBarWidth;

  const minLabelGapPx = (spansMultipleDays || interval === '1W') && interval !== '1M' ? 98 : 76;
  const maxLabels = Math.max(3, Math.floor(adjWidth / minLabelGapPx));
  const labelStep = Math.max(1, Math.ceil(history.length / maxLabels));
  const priceVolMaxLabels = maxLabels;
  const priceVolLabelStep = labelStep;
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

  let windowHigh = Number.NEGATIVE_INFINITY;
  let windowLow = Number.POSITIVE_INFINITY;
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (!h) continue;
    const candidates = [h.high, h.low, h.open, h.close];
    for (let j = 0; j < candidates.length; j++) {
      const val = candidates[j];
      if (typeof val === 'number' && Number.isFinite(val)) {
        if (val > windowHigh) windowHigh = val;
        if (val < windowLow) windowLow = val;
      }
    }
  }
  const hasFiniteWindowBounds =
    Number.isFinite(windowHigh) && Number.isFinite(windowLow) && windowHigh >= windowLow;
  if (!hasFiniteWindowBounds) {
    const fallbackPrice =
      typeof stock.price === 'number' && Number.isFinite(stock.price) && stock.price > 0
        ? stock.price
        : 1;
    windowHigh = fallbackPrice;
    windowLow = fallbackPrice;
  }

  const prevCloseRef =
    typeof stock.prevClose === 'number' && Number.isFinite(stock.prevClose) && stock.prevClose > 0
      ? stock.prevClose
      : null;

  const latestBar = history.length > 0 ? history[history.length - 1] : undefined;
  const latestBarClose =
    typeof latestBar?.close === 'number' && Number.isFinite(latestBar.close)
      ? latestBar.close
      : (windowLow + windowHigh) / 2;
  const anchorPrice =
    typeof stock.price === 'number' &&
    Number.isFinite(stock.price) &&
    stock.price > 0 &&
    stock.price >= windowLow * 0.5 &&
    stock.price <= windowHigh * 1.5
      ? stock.price
      : latestBarClose;

  // Compute automatic Y-axis bounds strictly from actual candlestick lows/highs (+ live anchorPrice),
  // only softly incorporating prevClose when close enough not to compress or displace candlesticks.
  const autoPriceResult = computeAutoPriceRange({
    candleLow: windowLow,
    candleHigh: windowHigh,
    currentPrice: anchorPrice,
    prevClose: showLevels ? prevCloseRef : null,
  });

  const autoMinPrice = autoPriceResult.min;
  const autoMaxPrice = autoPriceResult.max;
  const autoPriceRange = Math.max(autoMaxPrice - autoMinPrice, 0.0001);

  const visibleCandlesLow = autoPriceResult.coreLow;
  const visibleCandlesHigh = autoPriceResult.coreHigh;
  const visibleCandlesSpan = Math.max(visibleCandlesHigh - visibleCandlesLow, 0);
  const priceBoundMin = autoMinPrice >= 0 && visibleCandlesLow >= 0 ? 0 : undefined;

  const basePricePlotHeight = BASE_PRICE_HEIGHT - pricePaddingTop - pricePaddingBottom;
  const {
    minVisibleSpan: minVisibleRange,
    maxVisibleSpan: maxVisibleRange,
  } = computePriceZoomLimits({
    candleLow: windowLow,
    candleHigh: windowHigh,
    autoMinPrice,
    autoMaxPrice,
    plotHeightPx: basePricePlotHeight,
  });

  const normalizeYRange = (range: YRange): YRange =>
    ensureRangeIncludesFocusBand({
      range,
      focusMin: visibleCandlesLow,
      focusMax: visibleCandlesHigh,
      anchorValue: anchorPrice,
      minVisibleSpan: minVisibleRange,
      maxVisibleSpan: maxVisibleRange,
      boundMin: priceBoundMin,
      edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
    });

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
      focusMin: visibleCandlesLow,
      focusMax: visibleCandlesHigh,
      boundMin: priceBoundMin,
      edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
    });

  const panYRange = (
    baseMin: number,
    baseMax: number,
    deltaPrice: number
  ): YRange =>
    panBoundedRange({
      baseMin,
      baseMax,
      deltaPrice,
      minVisibleSpan: minVisibleRange,
      maxVisibleSpan: maxVisibleRange,
      anchorValue: anchorPrice,
      focusMin: visibleCandlesLow,
      focusMax: visibleCandlesHigh,
      boundMin: priceBoundMin,
      edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
    });

  const effectiveCustomYRange = customYRange ? normalizeYRange(customYRange) : null;
  const minPrice = effectiveCustomYRange ? effectiveCustomYRange.min : autoMinPrice;
  const maxPrice = effectiveCustomYRange ? effectiveCustomYRange.max : autoMaxPrice;
  const priceRange = Number.isFinite(maxPrice - minPrice)
    ? Math.max(maxPrice - minPrice, 0.0001)
    : autoPriceRange;
  const isYZoomed = effectiveCustomYRange !== null;
  const requiredSpanForCandles =
    visibleCandlesSpan > 0
      ? visibleCandlesSpan / (1 - 2 * PRICE_ZOOM_EDGE_PADDING_RATIO)
      : 0;
  const effectiveMinPriceRange = Math.max(minVisibleRange, requiredSpanForCandles);
  const rawMaxZoomMultiplier = autoPriceRange / Math.max(effectiveMinPriceRange, 0.0001);
  const maxZoomInMultiplier = Number.isFinite(rawMaxZoomMultiplier)
    ? Math.max(1.2, rawMaxZoomMultiplier)
    : 1.2;
  const yZoomFactor =
    Number.isFinite(autoPriceRange / priceRange) && autoPriceRange / priceRange > 0
      ? autoPriceRange / priceRange
      : 1;
  const priceExtraHeight =
    isYZoomed && yZoomFactor > 1 && maxZoomInMultiplier > 1
      ? Math.min(
          MAX_PRICE_EXPANSION_PX,
          Math.max(
            0,
            Math.round((Math.log(yZoomFactor) / Math.log(maxZoomInMultiplier)) * MAX_PRICE_EXPANSION_PX)
          )
        )
      : 0;
  const priceHeight = BASE_PRICE_HEIGHT + (Number.isFinite(priceExtraHeight) ? priceExtraHeight : 0);
  const priceAdjHeight = priceHeight - pricePaddingTop - pricePaddingBottom;

  scaleContextRef.current = {
    minPrice,
    maxPrice,
    computeScaledYRange,
    panYRange,
    normalizeYRange,
    isModalOpen: isStudiesModalOpen,
  };

  const handleYAxisMouseDown = (e: ReactMouseEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    focusChart('price');
    setHoverIndex(null);
    dragStateRef.current = {
      startY: e.clientY,
      startMin: minPrice,
      startMax: maxPrice,
    };
    setIsYAxisDragging(true);
  };

  const handlePlotMouseDown = (e: ReactMouseEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    focusChart('price');
    panStateRef.current = {
      startY: e.clientY,
      startMin: minPrice,
      startMax: maxPrice,
      plotHeight: priceAdjHeight,
      hasMoved: false,
    };
    setIsPlotPanning(true);
  };

  const priceTickStep = priceRange / 4;
  const formatAxisPrice = (val: number) => {
    if (typeof val !== 'number' || !Number.isFinite(val)) return '--';
    if (priceTickStep < 0.01) return val.toFixed(4);
    if (priceTickStep < 0.1) return val.toFixed(3);
    if (val >= 1000 && priceTickStep >= 0.5) return val.toFixed(1);
    if (val >= 10) return val.toFixed(2);
    return val.toFixed(3);
  };

  // Volume boundaries (include volMa if active) & independent Y-axis zoom against [0, visibleMaxVolume]
  // with capped 0..50px headroom above the plotting scale so taller bars stay visible where possible
  const volSeries = history.map((h) =>
    typeof h?.volume === 'number' && Number.isFinite(h.volume) && h.volume > 0 ? h.volume : 0
  );
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
    focusChart('volume');
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
    focusChart('rsi');
    setHoverIndex(null);
    rsiDragStateRef.current = {
      startY: e.clientY,
      startMin: minRsi,
      startMax: maxRsi,
    };
    setIsRsiYAxisDragging(true);
  };

  const getX = (index: number) => {
    if (history.length <= 1) return plotLeft + adjWidth / 2;
    return plotLeft + (index / (history.length - 1)) * adjWidth;
  };

  const getPriceVolX = (index: number) => {
    return getX(index);
  };

  const getHoverStripeBounds = (index: number) => {
    if (history.length <= 1) {
      return { x: plotLeft, stripeWidth: adjWidth };
    }
    const left = index === 0 ? plotLeft : (getX(index - 1) + getX(index)) / 2;
    const right =
      index === history.length - 1 ? plotLeft + adjWidth : (getX(index) + getX(index + 1)) / 2;
    return { x: left, stripeWidth: Math.max(1, right - left) };
  };

  const getPriceVolHoverStripeBounds = (index: number) => {
    return getHoverStripeBounds(index);
  };

  const getY = (price: number) => {
    if (typeof price !== 'number' || !Number.isFinite(price)) {
      return pricePaddingTop + priceAdjHeight / 2;
    }
    return pricePaddingTop + priceAdjHeight - ((price - minPrice) / priceRange) * priceAdjHeight;
  };

  const getVolY = (volume: number) => {
    const safeVol = typeof volume === 'number' && Number.isFinite(volume) ? Math.max(0, volume) : 0;
    return volBaselineY - (safeVol / Math.max(visibleMaxVolume, 1)) * volScaleHeight;
  };

  const getRsiY = (rsiVal: number) => {
    const safeRsi = typeof rsiVal === 'number' && Number.isFinite(rsiVal) ? rsiVal : 50;
    return rsiPaddingTop + rsiAdjHeight - ((safeRsi - minRsi) / rsiRange) * rsiAdjHeight;
  };

  const generateSeriesPath = (getter: (bar: HistoryBar, idx: number) => number | undefined, yMapper: (val: number) => number) => {
    const pts: string[] = [];
    for (let i = 0; i < history.length; i++) {
      const val = getter(history[i], i);
      if (typeof val === 'number' && Number.isFinite(val)) {
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
      if (typeof val === 'number' && Number.isFinite(val)) {
        pts.push(`${pts.length === 0 ? 'M' : 'L'}${getPriceVolX(i)},${yMapper(val)}`);
      }
    }
    return pts.join(' ');
  };

  const generateLinePath = () => {
    const pts: string[] = [];
    for (let i = 0; i < history.length; i++) {
      const closeVal = history[i]?.close;
      if (typeof closeVal === 'number' && Number.isFinite(closeVal)) {
        pts.push(`${pts.length === 0 ? 'M' : 'L'}${getPriceVolX(i)},${getY(closeVal)}`);
      }
    }
    return pts.join(' ');
  };

  const generateAreaPath = () => {
    const linePath = generateLinePath();
    if (!linePath) return '';
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

  const renderPanelHoverStripes = (
    keyPrefix: string,
    padTop: number = subPadTop,
    adjH: number = subAdjHeight
  ) => (
    <>
      {history.map((_, i) => {
        const { x, stripeWidth } = getHoverStripeBounds(i);
        return (
          <rect
            key={`${keyPrefix}-detect-${i}`}
            x={x}
            y={padTop}
            width={stripeWidth}
            height={adjH}
            fill="transparent"
            className="cursor-crosshair"
            onMouseEnter={() => setHoverIndex(i)}
          />
        );
      })}
      {hoverIndex !== null && (
        <line
          x1={getX(hoverIndex)}
          y1={padTop}
          x2={getX(hoverIndex)}
          y2={padTop + adjH}
          stroke="#ff9900"
          strokeWidth="0.8"
          strokeDasharray="2,2"
        />
      )}
    </>
  );

  // Precompute sub-panel domains
  // 1. MACD (data-aware zero-anchored scale with independent Y-axis zoom, bounded vertical
  // expansion to prevent clipping, and RSI-matched horizontal label-box separation)
  const macdPadTop = MACD_PADDING_TOP;
  const macdPadBottom = MACD_PADDING_BOTTOM;
  const autoMacdRange = computeAutoMacdRange(history);
  const {
    min: macdMin,
    max: macdMax,
    zoomFactor: macdYZoomFactor,
    isZoomed: isMacdYZoomed,
    macdHeight,
    plotHeight: macdAdjHeight,
  } = computeMacdPanelLayout(autoMacdRange, customMacdZoom);
  const macdSpan = Math.max(macdMax - macdMin, 0.0001);
  const macdLabelPrecisionRef = Math.min(Math.abs(macdMax), Math.abs(macdMin));
  const computeScaledMacdZoomFactor = (baseZoom: number, factor: number) =>
    computeScaledMacdZoom(baseZoom, factor, autoMacdRange);

  macdScaleContextRef.current = {
    macdYZoomFactor,
    computeScaledMacdZoomFactor,
    isModalOpen: isStudiesModalOpen,
  };

  const handleMacdYAxisMouseDown = (e: ReactMouseEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    focusChart('macd');
    setHoverIndex(null);
    macdDragStateRef.current = {
      startY: e.clientY,
      startZoom: macdYZoomFactor,
    };
    setIsMacdYAxisDragging(true);
  };

  const macdPlotLeft = plotLeft;
  const macdPlotRight = width - paddingRight;
  const macdBarWidth = volBarWidth;
  const macdBarHalf = macdBarWidth / 2;
  const macdSeriesLeft = macdPlotLeft + macdBarHalf;
  const macdSeriesRight = Math.max(macdSeriesLeft, macdPlotRight - macdBarHalf);

  const getMacdX = (index: number) => {
    return getX(index);
  };

  const getMacdHoverStripeBounds = (index: number) => {
    return getHoverStripeBounds(index);
  };

  const getMacdY = (v: number) => {
    const safeVal = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    return macdPadTop + macdAdjHeight - ((safeVal - macdMin) / macdSpan) * macdAdjHeight;
  };

  const generateMacdSeriesPath = (getter: (bar: HistoryBar, idx: number) => number | undefined) => {
    const pts: string[] = [];
    for (let i = 0; i < history.length; i++) {
      const val = getter(history[i], i);
      if (typeof val === 'number' && Number.isFinite(val)) {
        pts.push(`${pts.length === 0 ? 'M' : 'L'}${getMacdX(i)},${getMacdY(val)}`);
      }
    }
    return pts.join(' ');
  };

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

  // 5. ATR (14) — data-aware non-negative scale with independent Y-axis zoom matching MACD
  const atrPadTop = ATR_PADDING_TOP;
  const atrPadBottom = ATR_PADDING_BOTTOM;
  const autoAtrRange = computeAutoAtrRange(history.map((h) => h.atr));
  const {
    min: atrMin,
    max: atrMax,
    zoomFactor: atrYZoomFactor,
    isZoomed: isAtrYZoomed,
    panelHeight: atrHeight,
    plotHeight: atrAdjHeight,
  } = computeAtrPanelLayout(autoAtrRange, customAtrZoom);
  const atrSpan = Math.max(atrMax - atrMin, 0.0001);
  const computeScaledAtrZoomFactor = (baseZoom: number, factor: number) =>
    computeScaledStudyZoom(baseZoom, factor, autoAtrRange);

  atrScaleContextRef.current = {
    atrYZoomFactor,
    computeScaledAtrZoomFactor,
    isModalOpen: isStudiesModalOpen,
  };

  const handleAtrYAxisMouseDown = (e: ReactMouseEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    focusChart('atr');
    setHoverIndex(null);
    atrDragStateRef.current = {
      startY: e.clientY,
      startZoom: atrYZoomFactor,
    };
    setIsAtrYAxisDragging(true);
  };

  const getAtrY = (v: number) => {
    const safeVal = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : atrMin;
    return atrPadTop + atrAdjHeight - ((safeVal - atrMin) / atrSpan) * atrAdjHeight;
  };

  // 6. OBV — data-aware cumulative volume scale with independent Y-axis zoom matching MACD
  const obvPadTop = OBV_PADDING_TOP;
  const obvPadBottom = OBV_PADDING_BOTTOM;
  const autoObvRange = computeAutoObvRange(history.map((h) => h.obv));
  const {
    min: obvMin,
    max: obvMax,
    zoomFactor: obvYZoomFactor,
    isZoomed: isObvYZoomed,
    panelHeight: obvHeight,
    plotHeight: obvAdjHeight,
  } = computeObvPanelLayout(autoObvRange, customObvZoom);
  const obvSpan = Math.max(obvMax - obvMin, 1);
  const computeScaledObvZoomFactor = (baseZoom: number, factor: number) =>
    computeScaledStudyZoom(baseZoom, factor, autoObvRange);

  obvScaleContextRef.current = {
    obvYZoomFactor,
    computeScaledObvZoomFactor,
    isModalOpen: isStudiesModalOpen,
  };

  const handleObvYAxisMouseDown = (e: ReactMouseEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    focusChart('obv');
    setHoverIndex(null);
    obvDragStateRef.current = {
      startY: e.clientY,
      startZoom: obvYZoomFactor,
    };
    setIsObvYAxisDragging(true);
  };

  const getObvY = (v: number) => {
    const safeVal = typeof v === 'number' && Number.isFinite(v) ? v : (obvMin + obvMax) / 2;
    return obvPadTop + obvAdjHeight - ((safeVal - obvMin) / obvSpan) * obvAdjHeight;
  };

  // 7. ROC
  const rocVals = history.map((h) => h.roc).filter((v): v is number => typeof v === 'number' && !isNaN(v));
  const rocMaxAbs = Math.max(0.5, ...rocVals.map((v) => Math.abs(v))) * 1.15;
  const getRocY = (v: number) =>
    subPadTop + subAdjHeight - ((v + rocMaxAbs) / (2 * rocMaxAbs)) * subAdjHeight;

  const CHART_PANEL_HEADER_CLASS =
    'absolute top-1 left-[74px] right-2 flex items-center justify-between gap-2 text-xs leading-tight font-bold uppercase select-none pointer-events-none';
  const PRICE_VOL_PANEL_HEADER_CLASS =
    'absolute top-1 left-[74px] right-2 flex items-center justify-between gap-2 text-xs leading-tight font-bold uppercase select-none pointer-events-none';

  return (
    <div
      tabIndex={0}
      className="bg-[#010101] border border-[#333] rounded p-3.5 text-xs font-mono select-none focus:outline-none"
    >
      {/* Chart Headers */}
      <div className="flex flex-col sm:flex-row items-baseline sm:items-center justify-between border-b border-[#333] pb-2 mb-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {isCompanyEquitySymbol(stock.symbol) && (
            <div className="w-8 h-8 min-w-[32px] min-h-[32px] shrink-0 flex items-center justify-center">
              <CompanyLogo
                symbol={stock.symbol}
                size={32}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-extrabold uppercase tracking-wider leading-tight min-w-0">
            <span className="text-[#ff9900]">{stock.symbol}</span>
            {stock.name && stock.name !== stock.symbol && (
              <>
                <span className="text-zinc-300 font-normal">|</span>
                <span className="text-white truncate max-w-[260px] sm:max-w-none">{stock.name}</span>
              </>
            )}
            {stock.exchange && (
              <>
                <span className="text-zinc-300 font-normal">|</span>
                <span className="text-zinc-300 text-xs sm:text-xs font-bold">{stock.exchange}</span>
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
                className={`px-2.5 py-1 text-xs sm:text-xs font-bold transition-all cursor-pointer border-r border-[#3a3a3a] last:border-0 ${
                  interval === int
                    ? 'bg-[#00ff00] text-black font-extrabold'
                    : 'text-zinc-300 hover:text-white hover:bg-zinc-900'
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
              className={`px-2.5 py-1 text-xs sm:text-xs font-bold transition-colors cursor-pointer ${
                chartType === 'candle' ? 'bg-[#ff9900] text-black' : 'text-zinc-300 hover:text-white'
              }`}
            >
              CANDLES
            </button>
            <button
              type="button"
              onClick={() => setChartType('line')}
              className={`px-2.5 py-1 text-xs sm:text-xs font-bold transition-colors cursor-pointer ${
                chartType === 'line' ? 'bg-[#ff9900] text-black' : 'text-zinc-300 hover:text-white'
              }`}
            >
              LINE
            </button>
            <button
              type="button"
              onClick={() => setChartType('area')}
              className={`px-2.5 py-1 text-xs sm:text-xs font-bold transition-colors cursor-pointer ${
                chartType === 'area' ? 'bg-[#ff9900] text-black' : 'text-zinc-300 hover:text-white'
              }`}
            >
              AREA
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsStudiesModalOpen(true)}
            className="px-3 py-1 rounded border border-[#3498db] bg-[#0a1931]/60 hover:bg-[#3498db] text-[#3498db] hover:text-black text-xs sm:text-xs font-extrabold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Choose overlays, momentum oscillators, and volatility studies"
          >
            STUDIES ({activeStudies.length})
          </button>
        </div>
      </div>

      {/* Top statistics summary (Interactive hover feedback) */}
      <div className={`grid gap-2 bg-[#050505] border border-[#333] p-2 rounded mb-3 text-xs tabular-nums ${statsColClass}`}>
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
                    className={`text-xs font-bold block truncate ${
                      stock.extHoursChange > 0
                        ? 'text-[#00ff00]'
                        : stock.extHoursChange < 0
                        ? 'text-[#ff4444]'
                        : 'text-zinc-300'
                    }`}
                  >
                    {stock.extHoursChange > 0 ? '+' : ''}
                    {stock.extHoursChange.toFixed(2)} ({stock.extHoursChangePercent > 0 ? '+' : ''}
                    {stock.extHoursChangePercent.toFixed(2)}%)
                  </span>
                )}
            </>
          ) : (
            <span className="text-zinc-300 text-xs sm:text-sm md:text-base font-black block tracking-tight leading-tight mt-0.5">--</span>
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
            <span className="text-xs text-zinc-300 font-bold block truncate">
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
                  : 'text-zinc-300'
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
      <div
        ref={chartStackRef}
        className="flex flex-col gap-2 relative bg-black rounded p-1.5 border border-[#3a3a3a]"
      >
        {/* PANEL 1: Main Price Chart */}
        <div
          ref={(el) => {
            chartPanelRef.current = el;
            chartPanelElsRef.current.price = el;
          }}
          {...getPanelFocusProps('price')}
          className="relative pt-[6px] outline-none"
        >
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
              y={pricePaddingTop - Y_AXIS_BACKDROP_PAD_Y}
              width={paddingLeft - 6}
              height={priceAdjHeight + Y_AXIS_BACKDROP_PAD_Y * 2}
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
            {showLevels && (() => {
              const plotTop = pricePaddingTop;
              const plotBottom = pricePaddingTop + priceAdjHeight;
              const plotLeft = priceVolPaddingLeft;
              const plotRight = width - paddingRight;

              const hiLineY = getY(windowHigh);
              const loLineY = getY(windowLow);
              const hiVisible = hiLineY >= plotTop - 2 && hiLineY <= plotBottom + 2;
              const loVisible = loLineY >= plotTop - 2 && loLineY <= plotBottom + 2;

              const pcLineY = prevCloseRef !== null ? getY(prevCloseRef) : Number.NaN;
              const pcInRange =
                prevCloseRef !== null &&
                pcLineY >= plotTop - 2 &&
                pcLineY <= plotBottom + 2;
              const pcOffScale = prevCloseRef !== null && !pcInRange;

              const gutterInputs: ReferenceLevelLabelInput[] = [];
              if (hiVisible) gutterInputs.push({ id: 'HI', lineY: hiLineY, priority: 0 });
              if (pcInRange) gutterInputs.push({ id: 'PC', lineY: pcLineY, priority: 1 });
              if (loVisible) gutterInputs.push({ id: 'LO', lineY: loLineY, priority: 2 });

              const resolvedLabels = resolveReferenceLevelLabels({
                items: gutterInputs,
                minY: plotTop + 4,
                maxY: plotBottom - 4,
              });
              const labelById = new Map(resolvedLabels.map((item) => [item.id, item]));
              const hiLabel = labelById.get('HI');
              const loLabel = labelById.get('LO');
              const pcLabel = labelById.get('PC');

              const offscaleBadge = pcOffScale && prevCloseRef !== null
                ? (() => {
                    const isAbove = prevCloseRef > maxPrice;
                    const labelText = `${isAbove ? '▲' : '▼'} PC ${formatAxisPrice(prevCloseRef)}`;
                    const avoidRightEdgeYs: number[] = [];
                    if (hiVisible) avoidRightEdgeYs.push(hiLineY);
                    if (loVisible) avoidRightEdgeYs.push(loLineY);
                    if (hiLabel) avoidRightEdgeYs.push(hiLabel.labelY);
                    if (loLabel) avoidRightEdgeYs.push(loLabel.labelY);
                    const layout = computeOffscalePcBadgeLayout({
                      isAbove,
                      labelText,
                      plotLeft,
                      plotRight,
                      plotTop,
                      plotBottom,
                      avoidRightEdgeYs,
                    });
                    const pcReachableByZoomOut =
                      prevCloseRef >= visibleCandlesHigh - maxVisibleRange &&
                      prevCloseRef <= visibleCandlesLow + maxVisibleRange;
                    return { isAbove, labelText, layout, pcReachableByZoomOut };
                  })()
                : null;

              return (
                <g>
                  {hiVisible && (
                    <>
                      <line
                        x1={plotLeft}
                        y1={hiLineY}
                        x2={plotRight}
                        y2={hiLineY}
                        stroke="rgba(0, 255, 0, 0.45)"
                        strokeWidth="1"
                        strokeDasharray="3,3"
                      />
                      {hiLabel && hiLabel.displaced && (
                        <line
                          x1={plotRight}
                          y1={hiLineY}
                          x2={plotRight + 2.5}
                          y2={hiLabel.labelY}
                          stroke="rgba(0, 255, 0, 0.55)"
                          strokeWidth="0.8"
                        />
                      )}
                      {hiLabel && (
                        <text
                          data-level-label="HI"
                          x={plotRight + 3}
                          y={hiLabel.labelY + 3}
                          fill="#00ff00"
                          fontSize="8"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          HI
                        </text>
                      )}
                    </>
                  )}
                  {loVisible && (
                    <>
                      <line
                        x1={plotLeft}
                        y1={loLineY}
                        x2={plotRight}
                        y2={loLineY}
                        stroke="rgba(255, 68, 68, 0.45)"
                        strokeWidth="1"
                        strokeDasharray="3,3"
                      />
                      {loLabel && loLabel.displaced && (
                        <line
                          x1={plotRight}
                          y1={loLineY}
                          x2={plotRight + 2.5}
                          y2={loLabel.labelY}
                          stroke="rgba(255, 68, 68, 0.55)"
                          strokeWidth="0.8"
                        />
                      )}
                      {loLabel && (
                        <text
                          data-level-label="LO"
                          x={plotRight + 3}
                          y={loLabel.labelY + 3}
                          fill="#ff4444"
                          fontSize="8"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          LO
                        </text>
                      )}
                    </>
                  )}
                  {pcInRange && (
                    <>
                      <line
                        x1={plotLeft}
                        y1={pcLineY}
                        x2={plotRight}
                        y2={pcLineY}
                        stroke="rgba(52, 152, 219, 0.65)"
                        strokeWidth="1"
                        strokeDasharray="4,3"
                      />
                      {pcLabel && pcLabel.displaced && (
                        <line
                          x1={plotRight}
                          y1={pcLineY}
                          x2={plotRight + 2.5}
                          y2={pcLabel.labelY}
                          stroke="rgba(52, 152, 219, 0.7)"
                          strokeWidth="0.8"
                        />
                      )}
                      {pcLabel && (
                        <text
                          data-level-label="PC"
                          x={plotRight + 3}
                          y={pcLabel.labelY + 3}
                          fill="#3498db"
                          fontSize="8"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          PC
                        </text>
                      )}
                    </>
                  )}
                  {offscaleBadge && prevCloseRef !== null && (
                    <g
                      data-pc-offscale={offscaleBadge.layout.direction}
                      data-pc-badge-side={offscaleBadge.layout.side}
                    >
                      <title>{`Previous Close: $${prevCloseRef.toFixed(2)} (${offscaleBadge.isAbove ? 'above' : 'below'} visible candlestick range${offscaleBadge.pcReachableByZoomOut ? ' — zoom out to view in scale' : ' — outside max zoom-out range'})`}</title>
                      <rect
                        x={offscaleBadge.layout.x}
                        y={offscaleBadge.layout.y}
                        width={offscaleBadge.layout.width}
                        height={offscaleBadge.layout.height}
                        rx="2"
                        fill="rgba(5, 16, 30, 0.88)"
                        stroke="rgba(52, 152, 219, 0.6)"
                        strokeWidth="0.9"
                      />
                      <text
                        x={offscaleBadge.layout.x + offscaleBadge.layout.width / 2}
                        y={offscaleBadge.layout.y + 9.5}
                        textAnchor="middle"
                        fill="#3498db"
                        fontSize="8"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {offscaleBadge.labelText}
                      </text>
                    </g>
                  )}
                </g>
              );
            })()}

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
                if (
                  !h ||
                  typeof h.open !== 'number' ||
                  typeof h.close !== 'number' ||
                  typeof h.high !== 'number' ||
                  typeof h.low !== 'number' ||
                  !Number.isFinite(h.open) ||
                  !Number.isFinite(h.close) ||
                  !Number.isFinite(h.high) ||
                  !Number.isFinite(h.low)
                ) {
                  return null;
                }
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
            {/* Subtle Current-Price Reference Indicator */}
            {lastIdx >= 0 && Number.isFinite(anchorPrice) && (
              <g data-current-price-indicator="true">
                <line
                  x1={priceVolPaddingLeft}
                  y1={getY(anchorPrice)}
                  x2={width - paddingRight}
                  y2={getY(anchorPrice)}
                  stroke="rgba(255, 153, 0, 0.35)"
                  strokeWidth="1"
                  strokeDasharray="2,3"
                />
                <circle
                  cx={getPriceVolX(lastIdx)}
                  cy={getY(anchorPrice)}
                  r="2.5"
                  fill="#ff9900"
                  stroke="#000"
                  strokeWidth="1"
                >
                  <title>{`Current Price: $${anchorPrice.toFixed(2)}`}</title>
                </circle>
              </g>
            )}
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

            {/* Interactive hover detection & vertical pan stripes */}
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
                  className={isPlotPanning ? 'cursor-grabbing' : 'cursor-crosshair'}
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseDown={handlePlotMouseDown}
                />
              );
            })}

            {/* Target Vertical Crosshair */}
            {hoverIndex !== null && history[hoverIndex] && (
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
                {typeof history[hoverIndex].close === 'number' &&
                  Number.isFinite(history[hoverIndex].close) &&
                  getY(history[hoverIndex].close) >= pricePaddingTop - 3 &&
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
              y={-Y_AXIS_VERTICAL_EXTRA_PAD}
              width={paddingLeft}
              height={priceHeight + Y_AXIS_VERTICAL_EXTRA_PAD * 2}
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
                focusChart('price');
                resetChartPanel('price');
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
              <span className="text-zinc-300">PRICE CHART</span>
              {activeOverlayItems.map((item) => (
                <span key={item.id} className={`${item.colorClass} tabular-nums`}>
                  {item.label}: {typeof item.val === 'number' ? item.val.toFixed(2) : '--'}
                </span>
              ))}
            </div>
            {shouldShowYScaleIndicator(yZoomFactor) && (
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
                <span className="text-zinc-300">PRICE CHART</span>
              </div>
            </div>
          ) : (
            <div
              style={{ height: BASE_PRICE_HEIGHT }}
              className="flex flex-col items-center justify-center text-center text-zinc-300 font-mono select-none px-4"
            >
              {typeof stock.price === 'number' && stock.price > 0 && Array.isArray(stock.history) && stock.history.length === 0 ? (
                <>
                  <p className="text-xs text-zinc-300 max-w-md">
                    No price history yet for {stock.symbol}. This can happen with when-issued or newly listed tickers.
                  </p>
                  <div className="text-white font-extrabold text-xl sm:text-2xl tracking-wider mt-1.5 mb-2">
                    {stock.symbol}
                  </div>
                  <div className="text-xs text-zinc-400">
                    DATA PROVIDERS: LIVE YAHOO FINANCE / ALPHA VANTAGE
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-zinc-300">
                    NO HISTORICAL DATA AVAILABLE FOR
                  </p>
                  <div className="text-white font-extrabold text-xl sm:text-2xl tracking-wider mt-1.5 mb-2">
                    {stock.symbol}
                  </div>
                  <div className="text-xs text-zinc-300">
                    DATA PROVIDERS: LIVE YAHOO FINANCE / ALPHA VANTAGE
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* PANEL 2: Volume Study (+ Optional Vol MA 20) */}
        {isChartReady && hoveredData && showVolumeStudy && (
          <div
            ref={(el) => {
              chartPanelElsRef.current.volume = el;
            }}
            {...getPanelFocusProps('volume')}
            className="relative border-t border-[#161616] pt-1 outline-none"
          >
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
                y={volPaddingTop - Y_AXIS_BACKDROP_PAD_Y}
                width={paddingLeft - 6}
                height={volPlotHeight + Y_AXIS_BACKDROP_PAD_Y * 2}
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
                  const safeVol =
                    typeof h?.volume === 'number' && Number.isFinite(h.volume)
                      ? Math.max(0, h.volume)
                      : 0;
                  const rawBarY = getVolY(safeVol);
                  const rawBarH = Math.max(0, volBaselineY - rawBarY);
                  const barH = safeVol > 0 ? Math.max(2, rawBarH) : 1;
                  const barY = volBaselineY - barH;
                  const isGreen = (h?.close ?? 0) >= (h?.open ?? 0);
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
                y={-Y_AXIS_VERTICAL_EXTRA_PAD}
                width={paddingLeft}
                height={volHeight + Y_AXIS_VERTICAL_EXTRA_PAD * 2}
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
                  focusChart('volume');
                  resetChartPanel('volume');
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
                <span className="text-zinc-300 inline-flex items-center gap-2">
                  <span>VOLUME STUDY</span>
                  <span className="text-zinc-300 tabular-nums">
                    BAR:{' '}
                    {typeof hoveredData.volume === 'number' && Number.isFinite(hoveredData.volume)
                      ? formatAxisVolume(hoveredData.volume)
                      : '--'}
                  </span>
                </span>
                {showVolMaStudy && (
                  <span className="text-[#ff9900] tabular-nums">
                    MA(20): {typeof hoveredData.volMa === 'number' ? formatAxisVolume(hoveredData.volMa) : '--'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 self-start">
                {shouldShowYScaleIndicator(volYZoomFactor) && (
                  <span className="text-[#ff9900] font-bold tabular-nums">
                    Y-SCALE: {volYZoomFactor.toFixed(2)}×
                  </span>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <div className="relative group/vol-tip pointer-events-auto inline-flex items-center">
                    <button
                      type="button"
                      aria-label="How to read Volume Study"
                      className="text-zinc-300 hover:text-[#ff9900] focus:text-[#ff9900] focus:outline-none cursor-help p-0.5 inline-flex items-center justify-center"
                    >
                      <Info size={12} />
                    </button>
                    <div
                      role="tooltip"
                      className="hidden group-hover/vol-tip:block group-focus-within/vol-tip:block absolute right-0 bottom-full mb-1.5 w-[340px] sm:w-[440px] max-w-[calc(100vw-6rem)] z-50 bg-[#0a0a0a] border border-[#444] rounded p-3 shadow-2xl shadow-black/95 normal-case tracking-normal font-mono font-normal text-xs leading-relaxed text-zinc-300 text-left select-text"
                    >
                      <div className="text-xs font-bold uppercase tracking-wider text-[#ff9900] border-b border-[#3a3a3a] pb-1 mb-2">
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
                  <button
                    type="button"
                    onClick={() => toggleStudy('volume')}
                    title="Hide Volume study"
                    aria-label="Hide Volume study"
                    className="pointer-events-auto text-zinc-300 hover:text-[#ff4444] p-0.5 cursor-pointer shrink-0 inline-flex items-center justify-center"
                  >
                    <X size={11} />
                  </button>
                </div>
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
          <div
            ref={(el) => {
              chartPanelElsRef.current.rsi = el;
            }}
            {...getPanelFocusProps('rsi')}
            className="relative border-t border-[#161616] pt-1 outline-none"
          >
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
                y={rsiPaddingTop - Y_AXIS_BACKDROP_PAD_Y}
                width={paddingLeft - 6}
                height={rsiAdjHeight + Y_AXIS_BACKDROP_PAD_Y * 2}
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
                  x={plotLeft}
                  y={getRsiY(100)}
                  width={width - plotLeft - paddingRight}
                  height={Math.max(0, getRsiY(70) - getRsiY(100))}
                  fill="rgba(239, 68, 68, 0.08)"
                />
                <rect
                  x={plotLeft}
                  y={getRsiY(30)}
                  width={width - plotLeft - paddingRight}
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
                        x1={plotLeft}
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
                      x1={plotLeft}
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

              {hoverIndex !== null && hoverIndex < rsiList.length && (
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
                  {typeof rsiList[hoverIndex] === 'number' && Number.isFinite(rsiList[hoverIndex]) && (
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
                  )}
                </g>
              )}

              {/* Interactive Left Y-Axis Scale Hit Area for RSI */}
              <rect
                ref={rsiYAxisHitRef}
                x={0}
                y={-Y_AXIS_VERTICAL_EXTRA_PAD}
                width={paddingLeft}
                height={rsiHeight + Y_AXIS_VERTICAL_EXTRA_PAD * 2}
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
                  focusChart('rsi');
                  resetChartPanel('rsi');
                }}
              >
                <title>Scroll or drag vertically to zoom RSI scale (Double-click or press 0 to reset)</title>
              </rect>

              <defs>
                <clipPath id="gp-rsi-plot-clip">
                  <rect
                    x={plotLeft - 8}
                    y={rsiPaddingTop - 3}
                    width={adjWidth + 16}
                    height={rsiAdjHeight + 6}
                  />
                </clipPath>
              </defs>
            </svg>
            <div className={CHART_PANEL_HEADER_CLASS}>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                <span className="text-zinc-300 inline-flex items-center gap-1.5">
                  <span>RSI OSCILLATOR (14)</span>
                  <span className="text-[#9b59b6] tabular-nums">
                    {typeof currentRsi === 'number' && Number.isFinite(currentRsi)
                      ? currentRsi.toFixed(1)
                      : '--'}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-start">
                {shouldShowYScaleIndicator(rsiYZoomFactor) && (
                  <span className="text-[#ff9900] font-bold tabular-nums">
                    Y-SCALE: {rsiYZoomFactor.toFixed(2)}×
                  </span>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <div className="relative group/rsi-tip pointer-events-auto inline-flex items-center">
                    <button
                      type="button"
                      aria-label="How to read RSI Oscillator (14)"
                      className="text-zinc-300 hover:text-[#9b59b6] focus:text-[#9b59b6] focus:outline-none cursor-help p-0.5 inline-flex items-center justify-center"
                    >
                      <Info size={12} />
                    </button>
                    <div
                      role="tooltip"
                      className="hidden group-hover/rsi-tip:block group-focus-within/rsi-tip:block absolute right-0 bottom-full mb-1.5 w-[340px] sm:w-[440px] max-w-[calc(100vw-6rem)] z-50 bg-[#0a0a0a] border border-[#444] rounded p-3 shadow-2xl shadow-black/95 normal-case tracking-normal font-mono font-normal text-xs leading-relaxed text-zinc-300 text-left select-text"
                    >
                      <div className="text-xs font-bold uppercase tracking-wider text-[#9b59b6] border-b border-[#3a3a3a] pb-1 mb-2">
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
                  <button
                    type="button"
                    onClick={() => toggleStudy('rsi')}
                    title="Hide RSI study"
                    aria-label="Hide RSI study"
                    className="pointer-events-auto text-zinc-300 hover:text-[#ff4444] p-0.5 cursor-pointer shrink-0 inline-flex items-center justify-center"
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {/* PANEL 4: MACD (12, 26, 9) */}
        {isChartReady && hoveredData && showMacdStudy && (
          <div
            ref={(el) => {
              chartPanelElsRef.current.macd = el;
            }}
            {...getPanelFocusProps('macd')}
            className="relative border-t border-[#161616] pt-1 outline-none"
          >
            <svg
              width={width}
              height={macdHeight}
              viewBox={`0 0 ${width} ${macdHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
            >
              {/* Subtle interactive backdrop for left MACD Y-axis scale (matches RSI spacing) */}
              <rect
                data-macd-yaxis-box="true"
                x={2}
                y={macdPadTop - Y_AXIS_BACKDROP_PAD_Y}
                width={paddingLeft - 6}
                height={macdAdjHeight + Y_AXIS_BACKDROP_PAD_Y * 2}
                rx="2"
                fill={
                  isMacdYAxisDragging
                    ? 'rgba(255, 153, 0, 0.12)'
                    : isMacdYAxisHovered
                    ? 'rgba(255, 153, 0, 0.06)'
                    : 'transparent'
                }
                stroke={
                  isMacdYAxisDragging
                    ? 'rgba(255, 153, 0, 0.45)'
                    : isMacdYAxisHovered || isMacdYZoomed
                    ? 'rgba(255, 153, 0, 0.22)'
                    : 'transparent'
                }
                strokeWidth="1"
              />

              {/* Top & bottom scale guides */}
              {[macdMax, macdMin].map((lvl, idx) => (
                <line
                  key={`macd-bound-${idx}`}
                  x1={macdPlotLeft}
                  y1={getMacdY(lvl)}
                  x2={macdPlotRight}
                  y2={getMacdY(lvl)}
                  stroke="#1f1f1f"
                  strokeWidth="1"
                  strokeDasharray="2,2"
                />
              ))}

              {/* Zero baseline */}
              <line
                data-macd-zero-line="true"
                x1={macdPlotLeft}
                y1={getMacdY(0)}
                x2={macdPlotRight}
                y2={getMacdY(0)}
                stroke="#333"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              {[macdMax, 0, macdMin].map((lvl, idx) => (
                <text
                  key={`macd-lbl-${idx}`}
                  data-macd-axis-tick={idx === 0 ? 'max' : idx === 1 ? 'zero' : 'min'}
                  x={paddingLeft - 6}
                  y={getMacdY(lvl) + 3}
                  textAnchor="end"
                  fill={isMacdYAxisHovered || isMacdYAxisDragging ? '#ff9900' : '#a1a1aa'}
                  fontSize="9.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                  className="pointer-events-none"
                >
                  {formatMacdAxisValue(lvl, macdLabelPrecisionRef)}
                </text>
              ))}

              {/* Clipped MACD histogram, MACD line, and Signal line */}
              <g clipPath="url(#gp-macd-plot-clip)">
                {/* Histogram bars */}
                {history.map((h, i) => {
                  if (typeof h.macdHist !== 'number' || !Number.isFinite(h.macdHist)) return null;
                  const yZero = getMacdY(0);
                  const yVal = getMacdY(h.macdHist);
                  const barTop = Math.min(yZero, yVal);
                  const barH = Math.max(1, Math.abs(yVal - yZero));
                  const pos = h.macdHist >= 0;
                  return (
                    <rect
                      key={`macd-hist-${i}`}
                      data-macd-hist-bar={i}
                      x={getMacdX(i) - macdBarHalf}
                      y={barTop}
                      width={macdBarWidth}
                      height={barH}
                      fill={pos ? 'rgba(0, 255, 0, 0.35)' : 'rgba(255, 68, 68, 0.35)'}
                    />
                  );
                })}

                <path
                  data-macd-line="true"
                  d={generateMacdSeriesPath((b) => b.macd)}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.4"
                />
                <path
                  data-macd-signal-line="true"
                  d={generateMacdSeriesPath((b) => b.macdSignal)}
                  fill="none"
                  stroke="#ff9900"
                  strokeWidth="1.3"
                />
              </g>

              {/* Synchronized MACD hover stripes, crosshair line, and hover indicator */}
              {history.map((_, i) => {
                const { x, stripeWidth } = getMacdHoverStripeBounds(i);
                return (
                  <rect
                    key={`macd-detect-${i}`}
                    x={x}
                    y={macdPadTop}
                    width={stripeWidth}
                    height={macdAdjHeight}
                    fill="transparent"
                    className="cursor-crosshair"
                    onMouseEnter={() => setHoverIndex(i)}
                  />
                );
              })}

              {hoverIndex !== null && hoverIndex < history.length && (
                <g>
                  <line
                    x1={getMacdX(hoverIndex)}
                    y1={macdPadTop}
                    x2={getMacdX(hoverIndex)}
                    y2={macdPadTop + macdAdjHeight}
                    stroke="#ff9900"
                    strokeWidth="0.8"
                    strokeDasharray="2,2"
                  />
                  {typeof history[hoverIndex]?.macd === 'number' &&
                    Number.isFinite(history[hoverIndex].macd) && (
                      <g clipPath="url(#gp-macd-plot-clip)">
                        <circle
                          cx={getMacdX(hoverIndex)}
                          cy={getMacdY(history[hoverIndex].macd as number)}
                          r="2.8"
                          fill="#38bdf8"
                          stroke="black"
                          strokeWidth="1"
                        />
                      </g>
                    )}
                </g>
              )}

              {/* Interactive Left Y-Axis Scale Hit Area for MACD (strictly left of plot boundary) */}
              <rect
                ref={macdYAxisHitRef}
                x={0}
                y={-Y_AXIS_VERTICAL_EXTRA_PAD}
                width={paddingLeft}
                height={macdHeight + Y_AXIS_VERTICAL_EXTRA_PAD * 2}
                fill="transparent"
                className="cursor-ns-resize"
                onMouseEnter={() => {
                  setIsMacdYAxisHovered(true);
                  setHoverIndex(null);
                }}
                onMouseLeave={() => setIsMacdYAxisHovered(false)}
                onMouseDown={handleMacdYAxisMouseDown}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  focusChart('macd');
                  resetChartPanel('macd');
                }}
              >
                <title>Scroll or drag vertically to zoom MACD scale (Double-click or press 0 to reset)</title>
              </rect>

              <defs>
                <clipPath id="gp-macd-plot-clip">
                  <rect
                    x={macdPlotLeft}
                    y={macdPadTop - 3}
                    width={adjWidth}
                    height={macdAdjHeight + 6}
                  />
                </clipPath>
              </defs>
            </svg>
            <div className={CHART_PANEL_HEADER_CLASS} data-macd-header="true">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0 tabular-nums">
                <span className="text-zinc-300">MACD (12,26,9)</span>
                <span className="text-[#38bdf8]">
                  M: {typeof hoveredData.macd === 'number' && Number.isFinite(hoveredData.macd) ? hoveredData.macd.toFixed(2) : '--'}
                </span>
                <span className="text-[#ff9900]">
                  S: {typeof hoveredData.macdSignal === 'number' && Number.isFinite(hoveredData.macdSignal) ? hoveredData.macdSignal.toFixed(2) : '--'}
                </span>
                <span className={(hoveredData.macdHist ?? 0) >= 0 ? 'text-[#00ff00]' : 'text-[#ff4444]'}>
                  H: {typeof hoveredData.macdHist === 'number' && Number.isFinite(hoveredData.macdHist) ? hoveredData.macdHist.toFixed(2) : '--'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-start">
                {shouldShowYScaleIndicator(macdYZoomFactor) && (
                  <span className="text-[#ff9900] font-bold tabular-nums" data-macd-yscale="true">
                    Y-SCALE: {macdYZoomFactor.toFixed(2)}×
                  </span>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <div className="relative group/macd-tip pointer-events-auto inline-flex items-center">
                    <button
                      type="button"
                      aria-label="How to read MACD (12,26,9)"
                      className="text-zinc-300 hover:text-[#38bdf8] focus:text-[#38bdf8] focus:outline-none cursor-help p-0.5 inline-flex items-center justify-center"
                    >
                      <Info size={12} />
                    </button>
                    <div
                      role="tooltip"
                      className="hidden group-hover/macd-tip:block group-focus-within/macd-tip:block absolute right-0 bottom-full mb-1.5 w-[340px] sm:w-[440px] max-w-[calc(100vw-6rem)] z-50 bg-[#0a0a0a] border border-[#444] rounded p-3 shadow-2xl shadow-black/95 normal-case tracking-normal font-mono font-normal text-xs leading-relaxed text-zinc-300 text-left select-text"
                    >
                      <div className="text-xs font-bold uppercase tracking-wider text-[#38bdf8] border-b border-[#3a3a3a] pb-1 mb-2">
                        MACD Study
                      </div>
                      <div className="space-y-2">
                        <p>
                          <span className="text-[#38bdf8] font-bold">MACD (M):</span> The MACD line. Measures the difference between the 12-period and 26-period exponential moving averages (EMAs). It helps identify trend direction and momentum. Positive values indicate the shorter-term average is above the longer-term average; negative values indicate it is below.
                        </p>
                        <p>
                          <span className="text-[#ff9900] font-bold">Signal (S):</span> The signal line, a 9-period EMA of the MACD line. It smooths the MACD line and helps identify potential momentum shifts. When MACD crosses above the signal line, it can indicate bullish momentum. When it crosses below, it can indicate bearish momentum.
                        </p>
                        <p>
                          <span className="text-[#00ff00] font-bold">Histogram (H):</span> The difference between the MACD line and signal line (M − S). Positive values indicate MACD is above the signal line; negative values indicate it is below. Increasing histogram bars suggest widening momentum separation, while decreasing bars suggest weakening separation.
                        </p>
                        <p className="border-t border-[#2a2a2a] pt-2">
                          MACD is a lagging momentum indicator. Crossovers and changes in momentum can help identify potential trend shifts, but should not be treated as standalone buy or sell signals.
                        </p>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleStudy('macd')}
                    title="Hide MACD study"
                    aria-label="Hide MACD study"
                    className="pointer-events-auto text-zinc-300 hover:text-[#ff4444] p-0.5 cursor-pointer shrink-0 inline-flex items-center justify-center"
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PANEL 5: Slow Stochastic (14, 3, 3) */}
        {isChartReady && hoveredData && showStochStudy && (
          <div
            ref={(el) => {
              chartPanelElsRef.current.stoch = el;
            }}
            {...getPanelFocusProps('stoch')}
            className="relative border-t border-[#161616] pt-1 outline-none"
          >
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
            >
              <rect
                x={plotLeft}
                y={getStochY(100)}
                width={width - plotLeft - paddingRight}
                height={getStochY(80) - getStochY(100)}
                fill="rgba(239, 68, 68, 0.08)"
              />
              <rect
                x={plotLeft}
                y={getStochY(20)}
                width={width - plotLeft - paddingRight}
                height={getStochY(0) - getStochY(20)}
                fill="rgba(34, 197, 94, 0.08)"
              />
              {[20, 50, 80].map((lvl) => (
                <g key={`stoch-lvl-${lvl}`}>
                  <line
                    x1={plotLeft}
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
            <div className="absolute top-1 left-[74px] right-2 flex items-center justify-between text-xs font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-300 flex items-center gap-2 tabular-nums">
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
                className="pointer-events-auto text-zinc-300 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* PANEL 6: CCI (20) */}
        {isChartReady && hoveredData && showCciStudy && (
          <div
            ref={(el) => {
              chartPanelElsRef.current.cci = el;
            }}
            {...getPanelFocusProps('cci')}
            className="relative border-t border-[#161616] pt-1 outline-none"
          >
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
                    x1={plotLeft}
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
            <div className="absolute top-1 left-[74px] right-2 flex items-center justify-between text-xs font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-300 flex items-center gap-2 tabular-nums">
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
                className="pointer-events-auto text-zinc-300 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* PANEL 7: ADX / DMI (14) */}
        {isChartReady && hoveredData && showAdxStudy && (
          <div
            ref={(el) => {
              chartPanelElsRef.current.adx = el;
            }}
            {...getPanelFocusProps('adx')}
            className="relative border-t border-[#161616] pt-1 outline-none"
          >
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
                    x1={plotLeft}
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
            <div className="absolute top-1 left-[74px] right-2 flex items-center justify-between text-xs font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-300 flex items-center gap-2 tabular-nums">
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
                className="pointer-events-auto text-zinc-300 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* PANEL 8: ATR (14) */}
        {isChartReady && hoveredData && showAtrStudy && (
          <div
            ref={(el) => {
              chartPanelElsRef.current.atr = el;
            }}
            {...getPanelFocusProps('atr')}
            className="relative border-t border-[#161616] pt-1 outline-none"
          >
            <svg
              width={width}
              height={atrHeight}
              viewBox={`0 0 ${width} ${atrHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
            >
              {/* Subtle interactive backdrop for left ATR Y-axis scale (matches MACD spacing) */}
              <rect
                data-atr-yaxis-box="true"
                x={2}
                y={atrPadTop - Y_AXIS_BACKDROP_PAD_Y}
                width={paddingLeft - 6}
                height={atrAdjHeight + Y_AXIS_BACKDROP_PAD_Y * 2}
                rx="2"
                fill={
                  isAtrYAxisDragging
                    ? 'rgba(255, 153, 0, 0.12)'
                    : isAtrYAxisHovered
                    ? 'rgba(255, 153, 0, 0.06)'
                    : 'transparent'
                }
                stroke={
                  isAtrYAxisDragging
                    ? 'rgba(255, 153, 0, 0.45)'
                    : isAtrYAxisHovered || isAtrYZoomed
                    ? 'rgba(255, 153, 0, 0.22)'
                    : 'transparent'
                }
                strokeWidth="1"
              />

              {/* Horizontal scale gridlines & synchronized Y-axis ticks */}
              {[atrMax, (atrMax + atrMin) / 2, atrMin].map((lvl, idx) => (
                <g key={`atr-lvl-${idx}`}>
                  <line
                    x1={plotLeft}
                    y1={getAtrY(lvl)}
                    x2={width - paddingRight}
                    y2={getAtrY(lvl)}
                    stroke={idx === 1 ? '#262626' : '#1f1f1f'}
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <text
                    data-atr-axis-tick={idx === 0 ? 'max' : idx === 1 ? 'mid' : 'min'}
                    x={paddingLeft - 6}
                    y={getAtrY(lvl) + 3}
                    textAnchor="end"
                    fill={isAtrYAxisHovered || isAtrYAxisDragging ? '#ff9900' : '#a1a1aa'}
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                    className="pointer-events-none"
                  >
                    {formatAtrAxisValue(lvl, atrSpan)}
                  </text>
                </g>
              ))}

              {/* Clipped ATR line */}
              <g clipPath="url(#gp-atr-plot-clip)">
                <path
                  data-atr-line="true"
                  d={generateSeriesPath((b) => b.atr, getAtrY)}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                />
              </g>

              {/* Synchronized ATR hover stripes, crosshair line, and hover indicator */}
              {history.map((_, i) => {
                const { x, stripeWidth } = getHoverStripeBounds(i);
                return (
                  <rect
                    key={`atr-detect-${i}`}
                    x={x}
                    y={atrPadTop}
                    width={stripeWidth}
                    height={atrAdjHeight}
                    fill="transparent"
                    className="cursor-crosshair"
                    onMouseEnter={() => setHoverIndex(i)}
                  />
                );
              })}

              {hoverIndex !== null && hoverIndex < history.length && (
                <g>
                  <line
                    x1={getX(hoverIndex)}
                    y1={atrPadTop}
                    x2={getX(hoverIndex)}
                    y2={atrPadTop + atrAdjHeight}
                    stroke="#ff9900"
                    strokeWidth="0.8"
                    strokeDasharray="2,2"
                  />
                  {typeof history[hoverIndex]?.atr === 'number' &&
                    Number.isFinite(history[hoverIndex].atr) && (
                      <g clipPath="url(#gp-atr-plot-clip)">
                        <circle
                          cx={getX(hoverIndex)}
                          cy={getAtrY(history[hoverIndex].atr as number)}
                          r="2.8"
                          fill="#f59e0b"
                          stroke="black"
                          strokeWidth="1"
                        />
                      </g>
                    )}
                </g>
              )}

              {/* Interactive Left Y-Axis Scale Hit Area for ATR (strictly left of plot boundary) */}
              <rect
                ref={atrYAxisHitRef}
                x={0}
                y={-Y_AXIS_VERTICAL_EXTRA_PAD}
                width={paddingLeft}
                height={atrHeight + Y_AXIS_VERTICAL_EXTRA_PAD * 2}
                fill="transparent"
                className="cursor-ns-resize"
                onMouseEnter={() => {
                  setIsAtrYAxisHovered(true);
                  setHoverIndex(null);
                }}
                onMouseLeave={() => setIsAtrYAxisHovered(false)}
                onMouseDown={handleAtrYAxisMouseDown}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  focusChart('atr');
                  resetChartPanel('atr');
                }}
              >
                <title>Scroll or drag vertically to zoom ATR scale (Double-click or press 0 to reset)</title>
              </rect>

              <defs>
                <clipPath id="gp-atr-plot-clip">
                  <rect
                    x={plotLeft - 8}
                    y={atrPadTop - 3}
                    width={adjWidth + 16}
                    height={atrAdjHeight + 6}
                  />
                </clipPath>
              </defs>
            </svg>
            <div className={CHART_PANEL_HEADER_CLASS} data-atr-header="true">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0 tabular-nums">
                <span className="text-zinc-300">ATR (14)</span>
                <span className="text-[#f59e0b]">
                  ${typeof hoveredData.atr === 'number' && Number.isFinite(hoveredData.atr) ? hoveredData.atr.toFixed(3) : '--'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {shouldShowYScaleIndicator(atrYZoomFactor) && (
                  <span className="text-[#ff9900] font-bold tabular-nums" data-atr-yscale="true">
                    Y-SCALE: {atrYZoomFactor.toFixed(2)}×
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => toggleStudy('atr')}
                  title="Hide ATR study"
                  aria-label="Hide ATR study"
                  className="pointer-events-auto text-zinc-300 hover:text-[#ff4444] p-0.5 cursor-pointer shrink-0 inline-flex items-center justify-center"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PANEL 9: OBV (On-Balance Volume) */}
        {isChartReady && hoveredData && showObvStudy && (
          <div
            ref={(el) => {
              chartPanelElsRef.current.obv = el;
            }}
            {...getPanelFocusProps('obv')}
            className="relative border-t border-[#161616] pt-1 outline-none"
          >
            <svg
              width={width}
              height={obvHeight}
              viewBox={`0 0 ${width} ${obvHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
            >
              {/* Subtle interactive backdrop for left OBV Y-axis scale (matches MACD spacing) */}
              <rect
                data-obv-yaxis-box="true"
                x={2}
                y={obvPadTop - Y_AXIS_BACKDROP_PAD_Y}
                width={paddingLeft - 6}
                height={obvAdjHeight + Y_AXIS_BACKDROP_PAD_Y * 2}
                rx="2"
                fill={
                  isObvYAxisDragging
                    ? 'rgba(255, 153, 0, 0.12)'
                    : isObvYAxisHovered
                    ? 'rgba(255, 153, 0, 0.06)'
                    : 'transparent'
                }
                stroke={
                  isObvYAxisDragging
                    ? 'rgba(255, 153, 0, 0.45)'
                    : isObvYAxisHovered || isObvYZoomed
                    ? 'rgba(255, 153, 0, 0.22)'
                    : 'transparent'
                }
                strokeWidth="1"
              />

              {/* Optional zero baseline reference when OBV crosses zero in the visible range */}
              {obvMin < 0 && obvMax > 0 && (
                <line
                  data-obv-zero-line="true"
                  x1={plotLeft}
                  y1={getObvY(0)}
                  x2={width - paddingRight}
                  y2={getObvY(0)}
                  stroke="#333"
                  strokeWidth="1"
                  strokeDasharray="2,2"
                />
              )}

              {/* Horizontal scale gridlines & synchronized Y-axis ticks */}
              {[obvMax, (obvMax + obvMin) / 2, obvMin].map((lvl, idx) => (
                <g key={`obv-lvl-${idx}`}>
                  <line
                    x1={plotLeft}
                    y1={getObvY(lvl)}
                    x2={width - paddingRight}
                    y2={getObvY(lvl)}
                    stroke={idx === 1 ? '#262626' : '#1f1f1f'}
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <text
                    data-obv-axis-tick={idx === 0 ? 'max' : idx === 1 ? 'mid' : 'min'}
                    x={paddingLeft - 6}
                    y={getObvY(lvl) + 3}
                    textAnchor="end"
                    fill={isObvYAxisHovered || isObvYAxisDragging ? '#ff9900' : '#a1a1aa'}
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                    className="pointer-events-none"
                  >
                    {formatObvAxisValue(lvl, obvSpan)}
                  </text>
                </g>
              ))}

              {/* Clipped OBV line */}
              <g clipPath="url(#gp-obv-plot-clip)">
                <path
                  data-obv-line="true"
                  d={generateSeriesPath((b) => b.obv, getObvY)}
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth="1.5"
                />
              </g>

              {/* Synchronized OBV hover stripes, crosshair line, and hover indicator */}
              {history.map((_, i) => {
                const { x, stripeWidth } = getHoverStripeBounds(i);
                return (
                  <rect
                    key={`obv-detect-${i}`}
                    x={x}
                    y={obvPadTop}
                    width={stripeWidth}
                    height={obvAdjHeight}
                    fill="transparent"
                    className="cursor-crosshair"
                    onMouseEnter={() => setHoverIndex(i)}
                  />
                );
              })}

              {hoverIndex !== null && hoverIndex < history.length && (
                <g>
                  <line
                    x1={getX(hoverIndex)}
                    y1={obvPadTop}
                    x2={getX(hoverIndex)}
                    y2={obvPadTop + obvAdjHeight}
                    stroke="#ff9900"
                    strokeWidth="0.8"
                    strokeDasharray="2,2"
                  />
                  {typeof history[hoverIndex]?.obv === 'number' &&
                    Number.isFinite(history[hoverIndex].obv) && (
                      <g clipPath="url(#gp-obv-plot-clip)">
                        <circle
                          cx={getX(hoverIndex)}
                          cy={getObvY(history[hoverIndex].obv as number)}
                          r="2.8"
                          fill="#06b6d4"
                          stroke="black"
                          strokeWidth="1"
                        />
                      </g>
                    )}
                </g>
              )}

              {/* Interactive Left Y-Axis Scale Hit Area for OBV (strictly left of plot boundary) */}
              <rect
                ref={obvYAxisHitRef}
                x={0}
                y={-Y_AXIS_VERTICAL_EXTRA_PAD}
                width={paddingLeft}
                height={obvHeight + Y_AXIS_VERTICAL_EXTRA_PAD * 2}
                fill="transparent"
                className="cursor-ns-resize"
                onMouseEnter={() => {
                  setIsObvYAxisHovered(true);
                  setHoverIndex(null);
                }}
                onMouseLeave={() => setIsObvYAxisHovered(false)}
                onMouseDown={handleObvYAxisMouseDown}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  focusChart('obv');
                  resetChartPanel('obv');
                }}
              >
                <title>Scroll or drag vertically to zoom OBV scale (Double-click or press 0 to reset)</title>
              </rect>

              <defs>
                <clipPath id="gp-obv-plot-clip">
                  <rect
                    x={plotLeft - 8}
                    y={obvPadTop - 3}
                    width={adjWidth + 16}
                    height={obvAdjHeight + 6}
                  />
                </clipPath>
              </defs>
            </svg>
            <div className={CHART_PANEL_HEADER_CLASS} data-obv-header="true">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0 tabular-nums">
                <span className="text-zinc-300">OBV</span>
                <span className="text-[#06b6d4]">
                  {typeof hoveredData.obv === 'number' && Number.isFinite(hoveredData.obv)
                    ? formatAxisSigned(hoveredData.obv)
                    : '--'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {shouldShowYScaleIndicator(obvYZoomFactor) && (
                  <span className="text-[#ff9900] font-bold tabular-nums" data-obv-yscale="true">
                    Y-SCALE: {obvYZoomFactor.toFixed(2)}×
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => toggleStudy('obv')}
                  title="Hide OBV study"
                  aria-label="Hide OBV study"
                  className="pointer-events-auto text-zinc-300 hover:text-[#ff4444] p-0.5 cursor-pointer shrink-0 inline-flex items-center justify-center"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PANEL 10: ROC (12) */}
        {isChartReady && hoveredData && showRocStudy && (
          <div
            ref={(el) => {
              chartPanelElsRef.current.roc = el;
            }}
            {...getPanelFocusProps('roc')}
            className="relative border-t border-[#161616] pt-1 outline-none"
          >
            <svg
              width={width}
              height={subPanelHeight}
              viewBox={`0 0 ${width} ${subPanelHeight}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverIndex(null)}
            >
              <line
                x1={plotLeft}
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
            <div className="absolute top-1 left-[74px] right-2 flex items-center justify-between text-xs font-bold uppercase select-none pointer-events-none">
              <span className="text-zinc-300 flex items-center gap-2 tabular-nums">
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
                className="pointer-events-auto text-zinc-300 hover:text-[#ff4444] p-0.5 cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        )}
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

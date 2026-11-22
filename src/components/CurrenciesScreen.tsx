import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  CurrencyPair,
  FxIntelligencePayload,
  FxObservation,
  FxTimeframeId,
  MajorCurrencyCode,
  MonetaryPolicyDirection,
} from '../types';
import {
  FX_CURRENCY_META,
  FX_TIMEFRAMES,
  MAJOR_CURRENCIES,
  buildCurrencyCrossRates,
  buildCurrencyPerformanceRows,
  computeHistoricalFxTrend,
  formatPolicyRate,
  formatSignedPct,
  type CurrencyPerformanceRow,
} from '../utils/fxAnalytics';
import { InfoTooltipIcon, TerminalTooltip } from './TerminalTooltip';

export interface FredCurrenciesStatus {
  loading: boolean;
  error: string | null;
  requiresKey: boolean;
  fetchedAt: string | null;
}

export interface CurrenciesScreenProps {
  currencies: CurrencyPair[];
  fredCurrenciesStatus?: FredCurrenciesStatus;
  onRefreshCurrencies?: () => void;
  /** Optional preloaded payload (used for deterministic testing / SSR). */
  initialIntelligence?: FxIntelligencePayload | null;
  /** Disables auto-fetch on mount when testing static states. */
  disableAutoFetch?: boolean;
}

type PerformanceSortKey = 'code' | 'dailyPct' | 'weeklyPct' | 'monthlyPct' | 'trendScore';
type SortDirection = 'asc' | 'desc';

interface ChartSeriesOption {
  id: string;
  label: string;
  seriesId: string;
  title: string;
  decimals: number;
  isIndex: boolean;
  observations: FxObservation[];
}

function useContainerWidth(
  ref: React.RefObject<HTMLDivElement | null>,
  fallbackWidth: number,
  rebindKey?: string | number | boolean
): number {
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const updateWidth = () => {
      const nextWidth = Math.floor(el.getBoundingClientRect().width);
      if (nextWidth > 0) {
        setMeasuredWidth((prev) => (prev !== nextWidth ? nextWidth : prev));
      }
    };

    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const nextWidth = Math.floor(entry.contentRect.width);
          if (nextWidth > 0) {
            setMeasuredWidth((prev) => (prev !== nextWidth ? nextWidth : prev));
          }
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
    return undefined;
  }, [ref, rebindKey]);

  return measuredWidth ?? fallbackWidth;
}

function formatAxisDate(isoDate: string, timeframe: FxTimeframeId): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = months[Math.max(0, Math.min(11, Number(month) - 1))] || month;
  if (timeframe === '5Y') {
    return `${monthLabel} '${year.slice(2)}`;
  }
  if (timeframe === '1Y' || timeframe === '6M') {
    return `${monthLabel} ${Number(day)}, '${year.slice(2)}`;
  }
  return `${monthLabel} ${Number(day)}`;
}

function getValueColorClass(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return 'text-zinc-500';
  if (val > 0) return 'text-[#00ff00]';
  if (val < 0) return 'text-[#ff4444]';
  return 'text-zinc-300';
}

function getPolicyDirectionClass(direction: MonetaryPolicyDirection): string {
  if (direction === 'Increasing') return 'text-[#ff9900]';
  if (direction === 'Decreasing') return 'text-[#3498db]';
  if (direction === 'Unchanged') return 'text-zinc-300';
  return 'text-zinc-500';
}

const FX_TOOLTIPS = {
  overview:
    'Daily exchange-rate snapshots from Federal Reserve H.10 observations. Foreign currency changes measure each currency’s strength vs USD (direct quotes EUR/USD, GBP/USD, AUD/USD; inverted for USD/JPY and USD/CAD). USD tracks the Federal Reserve Nominal Broad U.S. Dollar Index (FRED DTWEXBGS).',
  performance:
    'All percentages reflect each currency’s own appreciation (+) or depreciation (-) using actual dated FRED observations without holiday interpolation. Daily compares the latest two observations; Weekly compares against the latest actual observation at least 7 calendar days prior; Monthly compares at least 30 calendar days prior.',
  historicalTrends:
    'Plots actual Federal Reserve H.10 daily business-day observations over the selected timeframe. Missing weekends and U.S. federal holidays are omitted rather than interpolated.',
  matrix:
    'Official Federal Reserve H.10 Statistical Release daily noon buying rates in New York. These are daily reference observations, not live intraday streaming quotes.',
  crossRates:
    'Derived 6×6 cross-rate table calculated from the latest FRED H.10 USD exchange-rate observations. Each cell shows units of the column currency per 1 unit of the row currency (ROW/COL) with mathematically reciprocal inverse pairs.',
  centralBanks:
    'Official daily central bank policy rates sourced from the Bank for International Settlements (BIS WS_CBPOL), with FRED fallback where available. Last Decision and Decision Date reflect the most recent observed policy rate change. Direction reflects policy trajectory over the trailing 180 calendar days.',
  nextMeeting:
    'Official future policy meeting calendars are not published in BIS WS_CBPOL or FRED interest-rate feeds. Quorix does not fabricate or hardcode future meeting dates.',
} as const;

interface HistoricalFxChartProps {
  series: ChartSeriesOption;
  timeframe: FxTimeframeId;
  points: FxObservation[];
  periodOpen: number | null;
}

const HistoricalFxChart: React.FC<HistoricalFxChartProps> = ({
  series,
  timeframe,
  points,
  periodOpen,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartWidth = useContainerWidth(containerRef, 760, `${series.id}-${timeframe}-${points.length}`);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    setHoverIdx(null);
  }, [series.id, timeframe]);

  const chartHeight = 250;
  const padLeft = 64;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 30;
  const plotWidth = Math.max(120, chartWidth - padLeft - padRight);
  const plotHeight = chartHeight - padTop - padBottom;

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((p) => p.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const span = maxVal - minVal;
    const pad = span > 0 ? span * 0.1 : Math.max(Math.abs(maxVal) * 0.01, 0.005);
    const yMin = minVal - pad;
    const yMax = maxVal + pad;
    const yRange = Math.max(1e-9, yMax - yMin);

    const xAt = (idx: number) => {
      if (points.length <= 1) return padLeft + plotWidth / 2;
      return padLeft + (idx / (points.length - 1)) * plotWidth;
    };
    const yAt = (val: number) => padTop + ((yMax - val) / yRange) * plotHeight;

    const coords = points.map((pt, idx) => ({
      x: xAt(idx),
      y: yAt(pt.value),
      date: pt.date,
      value: pt.value,
    }));

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
      .join(' ');

    const baselineY = padTop + plotHeight;
    const areaPath =
      coords.length > 1
        ? `${linePath} L${coords[coords.length - 1].x.toFixed(2)},${baselineY.toFixed(
            2
          )} L${coords[0].x.toFixed(2)},${baselineY.toFixed(2)} Z`
        : '';

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
      const value = yMax - frac * yRange;
      return { value, y: padTop + frac * plotHeight };
    });

    const maxXTicks = chartWidth < 460 ? 3 : chartWidth < 720 ? 5 : 6;
    const xTickIndices: number[] = [];
    if (points.length === 1) {
      xTickIndices.push(0);
    } else {
      const step = Math.max(1, Math.floor((points.length - 1) / (maxXTicks - 1)));
      for (let i = 0; i < points.length; i += step) {
        xTickIndices.push(i);
      }
      if (xTickIndices[xTickIndices.length - 1] !== points.length - 1) {
        if (xTickIndices.length >= maxXTicks) {
          xTickIndices[xTickIndices.length - 1] = points.length - 1;
        } else {
          xTickIndices.push(points.length - 1);
        }
      }
    }

    const xTicks = xTickIndices.map((idx) => ({
      idx,
      x: coords[idx].x,
      label: formatAxisDate(points[idx].date, timeframe),
    }));

    const isPositive =
      points.length >= 2 ? points[points.length - 1].value >= points[0].value : true;

    return {
      coords,
      linePath,
      areaPath,
      yTicks,
      xTicks,
      yOpen: periodOpen !== null ? yAt(periodOpen) : null,
      strokeColor: isPositive ? '#00ff00' : '#ff4444',
      gradientId: `fx-trend-fill-${series.seriesId}`,
    };
  }, [points, plotWidth, plotHeight, chartWidth, timeframe, periodOpen, series.seriesId]);

  const handlePointerMove = useCallback(
    (clientX: number, svgEl: SVGSVGElement | null) => {
      if (!svgEl || !geometry || geometry.coords.length === 0) return;
      const rect = svgEl.getBoundingClientRect();
      const relX = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, (relX - padLeft) / Math.max(1, plotWidth)));
      const idx = Math.round(ratio * (geometry.coords.length - 1));
      setHoverIdx(Math.max(0, Math.min(geometry.coords.length - 1, idx)));
    },
    [geometry, plotWidth]
  );

  if (!geometry || points.length === 0) {
    return (
      <div
        ref={containerRef}
        className="w-full h-[250px] bg-black border border-[#222] rounded flex items-center justify-center text-xs text-zinc-500 font-mono"
      >
        NO HISTORICAL OBSERVATIONS AVAILABLE FOR {series.label} ({timeframe})
      </div>
    );
  }

  const activePoint =
    hoverIdx !== null && geometry.coords[hoverIdx] ? geometry.coords[hoverIdx] : null;
  const activeDeltaPct =
    activePoint && periodOpen && periodOpen > 0
      ? ((activePoint.value - periodOpen) / periodOpen) * 100
      : null;

  return (
    <div ref={containerRef} className="w-full relative">
      {/* Live hover readout header */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-zinc-400 mb-1.5 min-h-[18px]">
        <div className="flex items-center gap-2">
          <span className="text-[#ff9900] font-bold">{series.label}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">{series.seriesId}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400">{points.length} OBSERVATIONS</span>
        </div>
        {activePoint ? (
          <div className="flex items-center gap-2 tabular-nums">
            <span className="text-zinc-400">{activePoint.date}</span>
            <span className="text-white font-bold">
              {activePoint.value.toFixed(series.decimals)}
            </span>
            {activeDeltaPct !== null && (
              <span className={getValueColorClass(activeDeltaPct)}>
                ({formatSignedPct(activeDeltaPct)} vs open)
              </span>
            )}
          </div>
        ) : (
          <span className="text-zinc-500">
            {points[0].date} → {points[points.length - 1].date}
          </span>
        )}
      </div>

      <div className="w-full bg-black border border-[#222] rounded overflow-hidden">
        <svg
          width={chartWidth}
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={`Historical FX trend chart for ${series.label} over ${timeframe}`}
          className="block w-full select-none cursor-crosshair"
          onMouseMove={(e) => handlePointerMove(e.clientX, e.currentTarget)}
          onMouseLeave={() => setHoverIdx(null)}
          onTouchMove={(e) => {
            if (e.touches[0]) handlePointerMove(e.touches[0].clientX, e.currentTarget);
          }}
          onTouchEnd={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={geometry.gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={geometry.strokeColor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={geometry.strokeColor} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Horizontal grid lines & Y-axis labels */}
          {geometry.yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padLeft}
                y1={tick.y}
                x2={chartWidth - padRight}
                y2={tick.y}
                stroke="#1c1c1c"
                strokeWidth="1"
              />
              <text
                x={padLeft - 8}
                y={tick.y + 3}
                textAnchor="end"
                fill="#71717a"
                fontSize="10"
                fontFamily="monospace"
              >
                {tick.value.toFixed(series.decimals)}
              </text>
            </g>
          ))}

          {/* Period Open dashed reference line */}
          {geometry.yOpen !== null && (
            <line
              x1={padLeft}
              y1={geometry.yOpen}
              x2={chartWidth - padRight}
              y2={geometry.yOpen}
              stroke="#52525b"
              strokeWidth="1"
              strokeDasharray="3,3"
            />
          )}

          {/* Area fill */}
          {geometry.areaPath && (
            <path d={geometry.areaPath} fill={`url(#${geometry.gradientId})`} />
          )}

          {/* Rate line */}
          <path
            d={geometry.linePath}
            fill="none"
            stroke={geometry.strokeColor}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Latest point marker */}
          {geometry.coords.length > 0 && (
            <circle
              cx={geometry.coords[geometry.coords.length - 1].x}
              cy={geometry.coords[geometry.coords.length - 1].y}
              r="3"
              fill={geometry.strokeColor}
              stroke="#000"
              strokeWidth="1"
            />
          )}

          {/* X-axis date labels */}
          {geometry.xTicks.map((tick) => (
            <text
              key={tick.idx}
              x={tick.x}
              y={chartHeight - 10}
              textAnchor={
                tick.idx === 0
                  ? 'start'
                  : tick.idx === points.length - 1
                  ? 'end'
                  : 'middle'
              }
              fill="#71717a"
              fontSize="10"
              fontFamily="monospace"
            >
              {tick.label}
            </text>
          ))}

          {/* Hover crosshair */}
          {activePoint && (
            <g>
              <line
                x1={activePoint.x}
                y1={padTop}
                x2={activePoint.x}
                y2={padTop + plotHeight}
                stroke="#ff9900"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              <line
                x1={padLeft}
                y1={activePoint.y}
                x2={chartWidth - padRight}
                y2={activePoint.y}
                stroke="#ff9900"
                strokeOpacity="0.45"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="4"
                fill="#ff9900"
                stroke="#000"
                strokeWidth="1.5"
              />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};

export const CurrenciesScreen: React.FC<CurrenciesScreenProps> = ({
  currencies,
  fredCurrenciesStatus,
  onRefreshCurrencies,
  initialIntelligence = null,
  disableAutoFetch = false,
}) => {
  const [intelligence, setIntelligence] = useState<FxIntelligencePayload | null>(
    initialIntelligence
  );
  const [loading, setLoading] = useState<boolean>(
    !initialIntelligence && !disableAutoFetch
  );
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<PerformanceSortKey>('dailyPct');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [selectedPairId, setSelectedPairId] = useState<string>('EUR/USD');
  const [selectedTimeframe, setSelectedTimeframe] = useState<FxTimeframeId>('3M');
  const [hoveredCross, setHoveredCross] = useState<{
    base: MajorCurrencyCode;
    quote: MajorCurrencyCode;
  } | null>(null);

  const fetchIntelligence = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/fred/fx-intelligence${force ? '?force=true' : ''}`);
      const data: FxIntelligencePayload = await resp.json();
      setIntelligence(data);
      if (!data.success && !data.requiresKey) {
        setError(data.error || 'Failed to load FX Market Intelligence data.');
      }
    } catch (err: any) {
      setError(err?.message || 'Network error loading FX Market Intelligence data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (disableAutoFetch) return;
    fetchIntelligence(false);
  }, [disableAutoFetch, fetchIntelligence]);

  const handleRefreshAll = useCallback(() => {
    fetchIntelligence(true);
    if (onRefreshCurrencies) {
      onRefreshCurrencies();
    }
  }, [fetchIntelligence, onRefreshCurrencies]);

  const isFredKeyMissing = Boolean(
    intelligence?.requiresKey || fredCurrenciesStatus?.requiresKey
  );
  const effectiveCurrencies = useMemo(() => {
    if (intelligence?.currencies && intelligence.currencies.length > 0) {
      return intelligence.currencies;
    }
    return currencies;
  }, [intelligence?.currencies, currencies]);

  const pairHistories = intelligence?.pairHistories ?? [];
  const usdIndex = intelligence?.usdIndex ?? null;
  const centralBanks = intelligence?.centralBanks ?? [];

  // Sections 1 & 2: Overview cards & Performance rows
  const performanceRows = useMemo(
    () => buildCurrencyPerformanceRows(pairHistories, usdIndex),
    [pairHistories, usdIndex]
  );

  const sortedPerformanceRows = useMemo(() => {
    const copy = [...performanceRows];
    copy.sort((a, b) => {
      if (sortKey === 'code') {
        const cmp = a.code.localeCompare(b.code);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return copy;
  }, [performanceRows, sortKey, sortDir]);

  const maxAbsTrendScore = useMemo(() => {
    const scores = performanceRows
      .map((r) => (r.trendScore !== null ? Math.abs(r.trendScore) : 0))
      .filter((v) => Number.isFinite(v));
    return Math.max(0.5, ...scores);
  }, [performanceRows]);

  const handleSortClick = (key: PerformanceSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'code' ? 'asc' : 'desc');
    }
  };

  // Section 3: Historical FX Trends series list
  const chartSeriesOptions: ChartSeriesOption[] = useMemo(() => {
    const options: ChartSeriesOption[] = pairHistories.map((h) => ({
      id: h.pair,
      label: h.pair,
      seriesId: h.seriesId,
      title: h.title,
      decimals: h.quoteCurrency === 'JPY' ? 2 : 4,
      isIndex: false,
      observations: h.observations,
    }));
    if (usdIndex && usdIndex.observations.length > 0) {
      options.push({
        id: 'USD_INDEX',
        label: 'USD INDEX',
        seriesId: usdIndex.seriesId,
        title: usdIndex.name,
        decimals: 2,
        isIndex: true,
        observations: usdIndex.observations,
      });
    }
    return options;
  }, [pairHistories, usdIndex]);

  const activeChartSeries = useMemo(() => {
    if (chartSeriesOptions.length === 0) return null;
    return (
      chartSeriesOptions.find((opt) => opt.id === selectedPairId) || chartSeriesOptions[0]
    );
  }, [chartSeriesOptions, selectedPairId]);

  const historicalTrend = useMemo(
    () =>
      activeChartSeries
        ? computeHistoricalFxTrend(activeChartSeries.observations, selectedTimeframe)
        : null,
    [activeChartSeries, selectedTimeframe]
  );

  // Section 5: 6x6 Cross-Rate Matrix
  const crossMatrix = useMemo(
    () => buildCurrencyCrossRates(pairHistories, effectiveCurrencies),
    [pairHistories, effectiveCurrencies]
  );

  const hoveredCrossDetail = useMemo(() => {
    if (!hoveredCross || hoveredCross.base === hoveredCross.quote) return null;
    const direct = crossMatrix.rows[hoveredCross.base]?.[hoveredCross.quote];
    const inverse = crossMatrix.rows[hoveredCross.quote]?.[hoveredCross.base];
    if (!direct || direct.rate === null) return null;
    return {
      direct,
      inverse,
    };
  }, [hoveredCross, crossMatrix]);

  const isAnyLoading = loading || Boolean(fredCurrenciesStatus?.loading);
  const syncedTimeLabel = intelligence?.fetchedAt
    ? new Date(intelligence.fetchedAt).toLocaleTimeString()
    : fredCurrenciesStatus?.fetchedAt
    ? new Date(fredCurrenciesStatus.fetchedAt).toLocaleTimeString()
    : null;

  const handleSelectOverviewCurrency = (row: CurrencyPerformanceRow) => {
    if (row.code === 'USD') {
      setSelectedPairId('USD_INDEX');
    } else {
      setSelectedPairId(row.pairLabel);
    }
  };

  const renderSortIcon = (key: PerformanceSortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown size={10} className="inline ml-1 text-zinc-600" />;
    }
    return sortDir === 'desc' ? (
      <ArrowDown size={10} className="inline ml-1 text-[#ff9900]" />
    ) : (
      <ArrowUp size={10} className="inline ml-1 text-[#ff9900]" />
    );
  };

  return (
    <div className="space-y-4 animate-fade-in select-none font-mono">
      {/* TOP WORKSPACE HEADER */}
      <div className="bg-[#050505] border border-[#333] rounded px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-sm sm:text-base font-bold uppercase tracking-wider">
            CRNC · FX MARKET INTELLIGENCE
          </h1>
          <div className="text-[10px] text-zinc-400 mt-0.5">
            FEDERAL RESERVE H.10 DAILY FX OBSERVATIONS · BIS OFFICIAL POLICY RATES
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-400">
          <span className="tabular-nums">
            {syncedTimeLabel ? `SYNCED ${syncedTimeLabel}` : 'ST. LOUIS FED H.10'}
          </span>
          <span className="text-zinc-700">·</span>
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={isAnyLoading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#333] bg-[#0c0c0c] text-zinc-200 hover:text-[#00ff00] hover:border-[#00ff00]/60 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0 text-[10px] font-bold uppercase tracking-wider"
            title="Refresh FRED FX observations and BIS central bank rates"
          >
            <RefreshCw size={11} className={isAnyLoading ? 'animate-spin' : ''} />
            <span>REFRESH DATA</span>
          </button>
        </div>
      </div>

      {/* FRED CONFIGURATION / ERROR BANNER (Sections 1-5 require FRED_API_KEY) */}
      {isFredKeyMissing && (
        <div className="bg-black border border-[#ff9900]/40 p-4 rounded text-xs text-zinc-300 space-y-1.5">
          <div className="flex items-center gap-2 text-[#ff9900] font-bold uppercase">
            <AlertCircle size={14} />
            <span>FRED_API_KEY Required for Exchange-Rate Sections</span>
          </div>
          <p className="text-zinc-400 leading-relaxed">
            Configure <span className="text-white font-bold">FRED_API_KEY</span> in System Settings (
            <span className="text-[#ff9900] font-bold">SETT</span>) or environment secrets to load live Federal Reserve H.10 daily exchange rates, currency performance, historical trends, and cross rates. Central bank policy rates below remain available via BIS.
          </p>
        </div>
      )}

      {!isFredKeyMissing && error && (
        <div className="bg-black border border-[#ff4444]/40 p-3.5 rounded text-xs text-[#ff4444] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={handleRefreshAll}
            className="px-2 py-1 text-[10px] font-bold uppercase border border-[#ff4444]/50 rounded text-zinc-200 hover:bg-[#ff4444]/10 cursor-pointer shrink-0"
          >
            RETRY
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SECTION 1: FX MARKET OVERVIEW                                        */}
      {/* ==================================================================== */}
      <section
        aria-label="FX Market Overview"
        className="bg-[#050505] border border-[#333] rounded p-4"
      >
        <div className="border-b border-[#222] pb-2 mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
              1. FX MARKET OVERVIEW
            </h2>
            <InfoTooltipIcon
              label="FX Market Overview methodology"
              title="FX MARKET OVERVIEW"
              content={FX_TOOLTIPS.overview}
              maxWidth={300}
            />
          </div>
          <span className="text-[10px] text-zinc-500 uppercase">
            6 MAJOR CURRENCIES · USD-RELATIVE STRENGTH · CLICK CARD TO CHART
          </span>
        </div>

        {loading && pairHistories.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5">
            {MAJOR_CURRENCIES.map((code) => (
              <div
                key={code}
                className="bg-[#0a0a0a] border border-[#222] rounded p-3 h-[126px] animate-pulse"
              >
                <div className="h-3 w-16 bg-zinc-800 rounded mb-2" />
                <div className="h-5 w-24 bg-zinc-800 rounded mb-3" />
                <div className="h-3 w-full bg-zinc-900 rounded mb-1.5" />
                <div className="h-3 w-4/5 bg-zinc-900 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5">
            {performanceRows.map((row) => {
              const meta = FX_CURRENCY_META[row.code];
              const isSelectedForChart =
                (row.code === 'USD' && selectedPairId === 'USD_INDEX') ||
                (row.code !== 'USD' && selectedPairId === row.pairLabel);
              const dailyPositive = row.dailyPct !== null && row.dailyPct > 0;
              const dailyNegative = row.dailyPct !== null && row.dailyPct < 0;

              return (
                <button
                  key={row.code}
                  type="button"
                  onClick={() => handleSelectOverviewCurrency(row)}
                  className={`text-left bg-[#080808] border rounded p-3 transition-colors cursor-pointer ${
                    isSelectedForChart
                      ? 'border-[#ff9900]/70 bg-[#0f0c06]'
                      : 'border-[#242424] hover:border-[#444] hover:bg-[#0d0d0d]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5 mb-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-white font-bold text-xs">{row.code}</span>
                        <span className="text-[10px] text-zinc-500 truncate">{row.name}</span>
                      </div>
                      <div className="text-[9.5px] text-[#3498db] font-semibold uppercase tracking-wide mt-0.5">
                        {row.pairLabel}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 mt-0.5 ${getValueColorClass(row.dailyPct)}`}
                      aria-hidden="true"
                    >
                      {dailyPositive ? (
                        <TrendingUp size={13} />
                      ) : dailyNegative ? (
                        <TrendingDown size={13} />
                      ) : (
                        <Minus size={13} />
                      )}
                    </span>
                  </div>

                  <div className="text-base font-bold text-white tabular-nums tracking-tight my-1.5">
                    {row.latestQuotedRate !== null
                      ? row.latestQuotedRate.toFixed(meta.quoteDecimals)
                      : '—'}
                  </div>

                  <div className="grid grid-cols-3 gap-1 pt-1.5 border-t border-[#1c1c1c] text-[9.5px] tabular-nums">
                    <div>
                      <div className="text-zinc-500 text-[8.5px]">1D</div>
                      <div className={`font-bold ${getValueColorClass(row.dailyPct)}`}>
                        {formatSignedPct(row.dailyPct, 2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-[8.5px]">1W</div>
                      <div className={`font-bold ${getValueColorClass(row.weeklyPct)}`}>
                        {formatSignedPct(row.weeklyPct, 2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-[8.5px]">1M</div>
                      <div className={`font-bold ${getValueColorClass(row.monthlyPct)}`}>
                        {formatSignedPct(row.monthlyPct, 2)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-1.5 text-[8.5px] text-zinc-500 flex items-center justify-between tabular-nums">
                    <span>{row.seriesId}</span>
                    <span>{row.latestDate || 'UNAVAILABLE'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ==================================================================== */}
      {/* SECTION 2: CURRENCY PERFORMANCE                                      */}
      {/* ==================================================================== */}
      <section
        aria-label="Currency Performance"
        className="bg-[#050505] border border-[#333] rounded p-4"
      >
        <div className="border-b border-[#222] pb-2 mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
              2. CURRENCY PERFORMANCE
            </h2>
            <InfoTooltipIcon
              label="Currency Performance calculation methodology"
              title="USD-RELATIVE PERFORMANCE METHODOLOGY"
              content={FX_TOOLTIPS.performance}
              maxWidth={310}
            />
          </div>
          <span className="text-[10px] text-zinc-500 uppercase">
            + STRENGTHENING · − WEAKENING · CLICK COLUMN HEADER TO SORT
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300 font-mono">
            <thead>
              <tr className="border-b border-[#333] text-zinc-400 text-[10px] uppercase font-bold">
                <th className="py-2 pr-3">
                  <button
                    type="button"
                    onClick={() => handleSortClick('code')}
                    className="hover:text-white transition-colors cursor-pointer uppercase"
                  >
                    CURRENCY {renderSortIcon('code')}
                  </button>
                </th>
                <th className="py-2 px-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortClick('dailyPct')}
                    className="hover:text-white transition-colors cursor-pointer uppercase"
                  >
                    DAILY {renderSortIcon('dailyPct')}
                  </button>
                </th>
                <th className="py-2 px-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortClick('weeklyPct')}
                    className="hover:text-white transition-colors cursor-pointer uppercase"
                  >
                    WEEKLY {renderSortIcon('weeklyPct')}
                  </button>
                </th>
                <th className="py-2 px-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortClick('monthlyPct')}
                    className="hover:text-white transition-colors cursor-pointer uppercase"
                  >
                    MONTHLY {renderSortIcon('monthlyPct')}
                  </button>
                </th>
                <th className="py-2 pl-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortClick('trendScore')}
                    className="hover:text-white transition-colors cursor-pointer uppercase"
                  >
                    TREND {renderSortIcon('trendScore')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedPerformanceRows.map((row) => {
                const score = row.trendScore;
                const barWidthPct =
                  score !== null ? Math.min(100, (Math.abs(score) / maxAbsTrendScore) * 100) : 0;
                const isPosTrend = score !== null && score >= 0;

                return (
                  <tr
                    key={row.code}
                    className="border-b border-[#1c1c1c] hover:bg-[#101010] text-[11px] transition-colors"
                  >
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[#3498db] font-bold w-8">{row.code}</span>
                        <span className="text-zinc-300">{row.name}</span>
                        <span className="text-[9.5px] text-zinc-500 hidden sm:inline">
                          ({row.pairLabel})
                        </span>
                      </div>
                    </td>
                    <td
                      className={`py-2.5 px-2 text-right font-bold tabular-nums ${getValueColorClass(
                        row.dailyPct
                      )}`}
                    >
                      {formatSignedPct(row.dailyPct)}
                    </td>
                    <td
                      className={`py-2.5 px-2 text-right font-bold tabular-nums ${getValueColorClass(
                        row.weeklyPct
                      )}`}
                    >
                      {formatSignedPct(row.weeklyPct)}
                    </td>
                    <td
                      className={`py-2.5 px-2 text-right font-bold tabular-nums ${getValueColorClass(
                        row.monthlyPct
                      )}`}
                    >
                      {formatSignedPct(row.monthlyPct)}
                    </td>
                    <td className="py-2.5 pl-3">
                      <div className="flex items-center justify-end gap-2.5">
                        {/* Centered relative strength bar */}
                        <div
                          className="w-20 sm:w-28 h-2 bg-[#141414] border border-[#262626] rounded-xs relative overflow-hidden shrink-0"
                          aria-hidden="true"
                        >
                          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-600" />
                          {score !== null && barWidthPct > 0 && (
                            <div
                              style={{
                                width: `${barWidthPct / 2}%`,
                                left: isPosTrend ? '50%' : `${50 - barWidthPct / 2}%`,
                              }}
                              className={`absolute top-0 bottom-0 ${
                                isPosTrend ? 'bg-[#00ff00]/80' : 'bg-[#ff4444]/80'
                              }`}
                            />
                          )}
                        </div>
                        <span
                          className={`text-[10px] font-semibold w-24 text-right ${
                            row.trend === 'Strengthening'
                              ? 'text-[#00ff00]'
                              : row.trend === 'Weakening'
                              ? 'text-[#ff4444]'
                              : row.trend === 'Mixed'
                              ? 'text-zinc-300'
                              : 'text-zinc-500'
                          }`}
                        >
                          {row.trend.toUpperCase()}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* SECTION 3: HISTORICAL FX TRENDS                                      */}
      {/* ==================================================================== */}
      <section
        aria-label="Historical FX Trends"
        className="bg-[#050505] border border-[#333] rounded p-4"
      >
        <div className="border-b border-[#222] pb-2 mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
              3. HISTORICAL FX TRENDS
            </h2>
            <InfoTooltipIcon
              label="Historical FX Trends information"
              title="HISTORICAL FX TRENDS"
              content={FX_TOOLTIPS.historicalTrends}
              maxWidth={290}
            />
          </div>
          <span className="text-[10px] text-zinc-500 uppercase">
            ACTUAL FRED H.10 DAILY OBSERVATIONS · NO INTERPOLATED DATES
          </span>
        </div>

        {/* Pair Selector & Timeframe Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Select currency pair">
            {chartSeriesOptions.length > 0 ? (
              chartSeriesOptions.map((opt) => {
                const active = activeChartSeries?.id === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedPairId(opt.id)}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#1a1306] border-[#ff9900] text-[#ff9900]'
                        : 'bg-[#0b0b0b] border-[#2a2a2a] text-zinc-400 hover:text-white hover:border-[#444]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })
            ) : (
              <span className="text-[10px] text-zinc-500">
                {loading ? 'LOADING HISTORICAL SERIES...' : 'NO HISTORICAL FX SERIES LOADED'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1" role="group" aria-label="Select historical timeframe">
            {FX_TIMEFRAMES.map((tf) => {
              const active = selectedTimeframe === tf.id;
              return (
                <button
                  key={tf.id}
                  type="button"
                  onClick={() => setSelectedTimeframe(tf.id)}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#14202b] border-[#3498db] text-[#3498db]'
                      : 'bg-[#0b0b0b] border-[#2a2a2a] text-zinc-400 hover:text-white hover:border-[#444]'
                  }`}
                >
                  {tf.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Period Summary Metrics */}
        {activeChartSeries && historicalTrend && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
            <div className="bg-[#080808] border border-[#222] rounded px-2.5 py-2">
              <div className="text-[9px] text-zinc-500 uppercase">LATEST RATE</div>
              <div className="text-xs font-bold text-white tabular-nums mt-0.5">
                {historicalTrend.latestRate !== null
                  ? historicalTrend.latestRate.toFixed(activeChartSeries.decimals)
                  : '—'}
              </div>
              <div className="text-[8.5px] text-zinc-500 tabular-nums mt-0.5">
                {historicalTrend.latestDate || '—'}
              </div>
            </div>

            <div className="bg-[#080808] border border-[#222] rounded px-2.5 py-2">
              <div className="text-[9px] text-zinc-500 uppercase">PERIOD OPEN</div>
              <div className="text-xs font-bold text-zinc-200 tabular-nums mt-0.5">
                {historicalTrend.periodOpen !== null
                  ? historicalTrend.periodOpen.toFixed(activeChartSeries.decimals)
                  : '—'}
              </div>
              <div className="text-[8.5px] text-zinc-500 tabular-nums mt-0.5">
                {historicalTrend.periodOpenDate || '—'}
              </div>
            </div>

            <div className="bg-[#080808] border border-[#222] rounded px-2.5 py-2">
              <div className="text-[9px] text-zinc-500 uppercase">PERIOD CLOSE</div>
              <div className="text-xs font-bold text-zinc-200 tabular-nums mt-0.5">
                {historicalTrend.periodClose !== null
                  ? historicalTrend.periodClose.toFixed(activeChartSeries.decimals)
                  : '—'}
              </div>
              <div className="text-[8.5px] text-zinc-500 tabular-nums mt-0.5">
                {historicalTrend.periodCloseDate || '—'}
              </div>
            </div>

            <div className="bg-[#080808] border border-[#222] rounded px-2.5 py-2">
              <div className="text-[9px] text-zinc-500 uppercase">PERIOD HIGH</div>
              <div className="text-xs font-bold text-[#00ff00] tabular-nums mt-0.5">
                {historicalTrend.periodHigh !== null
                  ? historicalTrend.periodHigh.toFixed(activeChartSeries.decimals)
                  : '—'}
              </div>
              <div className="text-[8.5px] text-zinc-500 tabular-nums mt-0.5">
                {historicalTrend.periodHighDate || '—'}
              </div>
            </div>

            <div className="bg-[#080808] border border-[#222] rounded px-2.5 py-2">
              <div className="text-[9px] text-zinc-500 uppercase">PERIOD LOW</div>
              <div className="text-xs font-bold text-[#ff4444] tabular-nums mt-0.5">
                {historicalTrend.periodLow !== null
                  ? historicalTrend.periodLow.toFixed(activeChartSeries.decimals)
                  : '—'}
              </div>
              <div className="text-[8.5px] text-zinc-500 tabular-nums mt-0.5">
                {historicalTrend.periodLowDate || '—'}
              </div>
            </div>

            <div className="bg-[#080808] border border-[#222] rounded px-2.5 py-2">
              <div className="text-[9px] text-zinc-500 uppercase">
                {selectedTimeframe} CHANGE
              </div>
              <div
                className={`text-xs font-bold tabular-nums mt-0.5 ${getValueColorClass(
                  historicalTrend.periodChangePct
                )}`}
              >
                {formatSignedPct(historicalTrend.periodChangePct)}
              </div>
              <div className="text-[8.5px] text-zinc-500 tabular-nums mt-0.5">
                {historicalTrend.periodChangeAbs !== null
                  ? `${historicalTrend.periodChangeAbs >= 0 ? '+' : ''}${historicalTrend.periodChangeAbs.toFixed(
                      activeChartSeries.decimals
                    )}`
                  : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Responsive Interactive Line Chart */}
        {loading && !activeChartSeries ? (
          <div className="w-full h-[250px] bg-black border border-[#222] rounded flex flex-col items-center justify-center gap-2 text-xs text-zinc-500">
            <RefreshCw className="animate-spin text-[#3498db]" size={18} />
            <span>LOADING FRED H.10 HISTORICAL SERIES...</span>
          </div>
        ) : activeChartSeries && historicalTrend ? (
          <HistoricalFxChart
            series={activeChartSeries}
            timeframe={selectedTimeframe}
            points={historicalTrend.points}
            periodOpen={historicalTrend.periodOpen}
          />
        ) : (
          <div className="w-full h-[180px] bg-black border border-[#222] rounded flex items-center justify-center text-xs text-zinc-500">
            {isFredKeyMissing
              ? 'CONFIGURE FRED_API_KEY TO VIEW HISTORICAL FX TRENDS.'
              : 'NO HISTORICAL FX DATA AVAILABLE.'}
          </div>
        )}
      </section>

      {/* ==================================================================== */}
      {/* SECTION 4: FOREIGN EXCHANGE RATES MATRIX (EXISTING FRED H.10 TABLE)  */}
      {/* ==================================================================== */}
      <section
        aria-label="Foreign Exchange Rates Matrix"
        className="bg-[#050505] border border-[#333] rounded p-4"
      >
        <div className="border-b border-[#222] pb-2 mb-3 flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
              4. FOREIGN EXCHANGE RATES MATRIX (FRED H.10)
            </h2>
            <InfoTooltipIcon
              label="FRED H.10 Matrix data disclosure"
              title="FEDERAL RESERVE H.10 RELEASE"
              content={FX_TOOLTIPS.matrix}
              maxWidth={290}
            />
          </div>
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <span>DAILY H.10 OBSERVATIONS · NOT INTRADAY QUOTES</span>
            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={isAnyLoading}
              className="text-zinc-500 hover:text-[#00ff00] disabled:text-zinc-700 transition-colors cursor-pointer"
              title="Refresh FRED H.10 rates"
              aria-label="Refresh FRED H.10 rates"
            >
              <RefreshCw size={12} className={isAnyLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {isAnyLoading && effectiveCurrencies.length === 0 ? (
          <div className="flex flex-col items-center py-10 space-y-2 text-zinc-500 text-xs bg-black border border-[#222] rounded">
            <RefreshCw className="animate-spin text-[#3498db]" size={18} />
            <span>FETCHING FEDERAL RESERVE H.10 DAILY EXCHANGE RATES...</span>
          </div>
        ) : effectiveCurrencies.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-xs bg-black border border-[#222] rounded font-mono">
            {isFredKeyMissing
              ? 'FRED_API_KEY REQUIRED TO LOAD H.10 EXCHANGE RATES.'
              : 'NO FRED FX OBSERVATIONS RETURNED.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300 font-mono">
              <thead>
                <tr className="border-b border-[#333] text-zinc-500 text-[10px] uppercase font-bold">
                  <th className="py-2">CURRENCY PAIR</th>
                  <th className="py-2">FRED SERIES</th>
                  <th className="py-2 text-right">H.10 RATE</th>
                  <th className="py-2 text-right">PREV OBS</th>
                  <th className="py-2 text-right">DAY CHANGE</th>
                  <th className="py-2 text-right">OBS DATE</th>
                  <th className="py-2 text-right">FEED</th>
                </tr>
              </thead>
              <tbody>
                {effectiveCurrencies.map((curr, idx) => {
                  const isPositive = curr.change >= 0;
                  const pctDiff =
                    typeof curr.prevRate === 'number' && curr.prevRate > 0
                      ? ((curr.rate - curr.prevRate) / curr.prevRate) * 100
                      : null;
                  return (
                    <tr
                      key={curr.seriesId || idx}
                      className="border-b border-[#1c1c1c] hover:bg-[#101010] text-[11px] font-mono tabular-nums"
                    >
                      <td className="py-2.5 text-[#3498db] font-bold">{curr.pair}</td>
                      <td className="text-zinc-500 text-[10px]">{curr.seriesId || '—'}</td>
                      <td className="text-right font-bold text-white">{curr.rate.toFixed(4)}</td>
                      <td className="text-right text-zinc-400">
                        {typeof curr.prevRate === 'number' ? curr.prevRate.toFixed(4) : '—'}
                      </td>
                      <td
                        className={`text-right font-bold ${
                          isPositive ? 'text-[#00ff00]' : 'text-[#ff4444]'
                        }`}
                      >
                        {isPositive ? '+' : ''}
                        {curr.change.toFixed(4)}
                        {pctDiff !== null && (
                          <span className="text-[9.5px] font-normal text-zinc-400 ml-1.5">
                            ({formatSignedPct(pctDiff)})
                          </span>
                        )}
                      </td>
                      <td className="text-right text-zinc-400">{curr.date || '—'}</td>
                      <td className="text-right text-[10px] text-[#00ff00] font-semibold uppercase">
                        FRED H.10
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ==================================================================== */}
      {/* SECTION 5: CURRENCY CROSS RATES (6x6 DERIVED MATRIX)                 */}
      {/* ==================================================================== */}
      <section
        aria-label="Currency Cross Rates"
        className="bg-[#050505] border border-[#333] rounded p-4"
      >
        <div className="border-b border-[#222] pb-2 mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
              5. CURRENCY CROSS RATES
            </h2>
            <InfoTooltipIcon
              label="Currency Cross Rates derivation methodology"
              title="DERIVED CROSS RATES (ROW / COL)"
              content={FX_TOOLTIPS.crossRates}
              maxWidth={300}
            />
          </div>
          <div className="text-[10px] text-zinc-400 tabular-nums min-h-[15px]">
            {hoveredCrossDetail ? (
              <span>
                <span className="text-white font-bold">
                  1 {hoveredCrossDetail.direct.base} ={' '}
                  {hoveredCrossDetail.direct.rate!.toFixed(hoveredCrossDetail.direct.decimals)}{' '}
                  {hoveredCrossDetail.direct.quote}
                </span>
                {hoveredCrossDetail.inverse?.rate !== null && hoveredCrossDetail.inverse && (
                  <span className="text-zinc-500 ml-2">
                    · INVERSE: 1 {hoveredCrossDetail.inverse.base} ={' '}
                    {hoveredCrossDetail.inverse.rate.toFixed(hoveredCrossDetail.inverse.decimals)}{' '}
                    {hoveredCrossDetail.inverse.quote}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-zinc-500 uppercase">
                1 ROW CURRENCY = X COLUMN CURRENCY · DERIVED FROM FRED H.10
                {crossMatrix.latestObservationDate
                  ? ` (AS OF ${crossMatrix.latestObservationDate})`
                  : ''}
              </span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="border-b border-[#333] text-[10px] uppercase">
                <th className="py-2 px-2 text-left text-zinc-500 font-bold w-20">BASE \ QUOTE</th>
                {crossMatrix.currencies.map((quote) => (
                  <th
                    key={quote}
                    className={`py-2 px-2 text-right font-bold transition-colors ${
                      hoveredCross?.quote === quote ? 'text-[#ff9900]' : 'text-[#3498db]'
                    }`}
                  >
                    {quote}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {crossMatrix.currencies.map((base) => (
                <tr key={base} className="border-b border-[#1c1c1c]">
                  <th
                    scope="row"
                    className={`py-2.5 px-2 text-left text-[11px] font-bold transition-colors ${
                      hoveredCross?.base === base ? 'text-[#ff9900]' : 'text-[#3498db]'
                    }`}
                  >
                    {base}
                  </th>
                  {crossMatrix.currencies.map((quote) => {
                    const cell = crossMatrix.rows[base][quote];
                    const isHovered =
                      hoveredCross?.base === base && hoveredCross?.quote === quote;
                    const isAxisHighlighted =
                      hoveredCross &&
                      (hoveredCross.base === base || hoveredCross.quote === quote);

                    return (
                      <td
                        key={`${base}-${quote}`}
                        onMouseEnter={() => setHoveredCross({ base, quote })}
                        onMouseLeave={() => setHoveredCross(null)}
                        className={`py-2.5 px-2 text-right text-[11px] tabular-nums transition-colors ${
                          cell.isDiagonal
                            ? 'text-zinc-600 bg-[#0a0a0a]'
                            : isHovered
                            ? 'bg-[#1a1306] text-[#ff9900] font-bold'
                            : isAxisHighlighted
                            ? 'bg-[#0e0e0e] text-white'
                            : 'text-zinc-200 hover:bg-[#111]'
                        }`}
                      >
                        {cell.rate !== null ? cell.rate.toFixed(cell.decimals) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2.5 text-[10px] text-zinc-500 flex flex-wrap items-center justify-between gap-2">
          <span>
            Cross rates are mathematically derived from underlying Federal Reserve H.10 USD exchange-rate observations (A/B = USD-per-A ÷ USD-per-B).
          </span>
          <span className="tabular-nums">
            {crossMatrix.availableCount}/30 PAIRS DERIVED
          </span>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* SECTION 6: CENTRAL BANK & INTEREST RATES                             */}
      {/* ==================================================================== */}
      <section
        aria-label="Central Bank and Interest Rates"
        className="bg-[#050505] border border-[#333] rounded p-4"
      >
        <div className="border-b border-[#222] pb-2 mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
              6. CENTRAL BANK &amp; INTEREST RATES
            </h2>
            <InfoTooltipIcon
              label="Central Bank policy rates source and methodology"
              title="CENTRAL BANK POLICY RATES"
              content={FX_TOOLTIPS.centralBanks}
              maxWidth={310}
            />
          </div>
          <div className="text-[10px] text-zinc-500 uppercase tabular-nums">
            {intelligence?.centralBanksSource
              ? `SOURCE: ${intelligence.centralBanksSource}`
              : 'SOURCE: BIS WS_CBPOL / FRED'}
            {intelligence?.centralBanksFetchedAt
              ? ` · SYNCED ${new Date(intelligence.centralBanksFetchedAt).toLocaleTimeString()}`
              : ''}
          </div>
        </div>

        {loading && centralBanks.length === 0 ? (
          <div className="flex flex-col items-center py-8 space-y-2 text-zinc-500 text-xs bg-black border border-[#222] rounded">
            <RefreshCw className="animate-spin text-[#3498db]" size={18} />
            <span>FETCHING OFFICIAL CENTRAL BANK POLICY RATES...</span>
          </div>
        ) : centralBanks.length === 0 ? (
          <div className="bg-black border border-[#222] rounded p-4 text-xs text-zinc-400">
            {intelligence?.centralBanksError ||
              'Central bank policy rate observations are currently unavailable from official feeds.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300 font-mono">
              <thead>
                <tr className="border-b border-[#333] text-zinc-500 text-[10px] uppercase font-bold">
                  <th className="py-2 pr-3">CENTRAL BANK</th>
                  <th className="py-2 px-2 text-right">POLICY RATE</th>
                  <th className="py-2 px-2 text-right">LAST DECISION</th>
                  <th className="py-2 px-2 text-right">DECISION DATE</th>
                  <th className="py-2 px-2 text-right">DIRECTION</th>
                  <th className="py-2 px-2 text-right">
                    <span className="inline-flex items-center gap-1 justify-end">
                      NEXT MEETING
                      <InfoTooltipIcon
                        label="Next scheduled meeting availability"
                        title="NEXT SCHEDULED MEETING"
                        content={FX_TOOLTIPS.nextMeeting}
                        maxWidth={270}
                        size={10}
                      />
                    </span>
                  </th>
                  <th className="py-2 pl-2 text-right">AS OF / SOURCE</th>
                </tr>
              </thead>
              <tbody>
                {centralBanks.map((cb) => {
                  const decisionColor =
                    cb.lastDecisionBps !== null && cb.lastDecisionBps > 0
                      ? 'text-[#ff9900]'
                      : cb.lastDecisionBps !== null && cb.lastDecisionBps < 0
                      ? 'text-[#3498db]'
                      : 'text-zinc-400';

                  return (
                    <tr
                      key={cb.currency}
                      className="border-b border-[#1c1c1c] hover:bg-[#101010] text-[11px] tabular-nums"
                    >
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[#3498db] font-bold w-8">{cb.currency}</span>
                          <div>
                            <div className="text-white font-semibold">{cb.centralBank}</div>
                            <div className="text-[9.5px] text-zinc-500">{cb.rateLabel}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-bold text-white">
                        {cb.available ? formatPolicyRate(cb.currentRate) : 'Unavailable'}
                      </td>
                      <td className={`py-2.5 px-2 text-right font-semibold ${decisionColor}`}>
                        {cb.available && cb.lastDecisionLabel ? cb.lastDecisionLabel : 'Unavailable'}
                      </td>
                      <td className="py-2.5 px-2 text-right text-zinc-400">
                        {cb.lastDecisionDate || '—'}
                      </td>
                      <td
                        className={`py-2.5 px-2 text-right font-bold uppercase text-[10px] ${getPolicyDirectionClass(
                          cb.direction
                        )}`}
                      >
                        {cb.direction}
                      </td>
                      <td className="py-2.5 px-2 text-right text-zinc-500 text-[10px]">
                        {cb.nextMeetingDate ? (
                          <span className="text-zinc-200">{cb.nextMeetingDate}</span>
                        ) : (
                          <TerminalTooltip
                            title="SCHEDULE UNAVAILABLE"
                            content={cb.nextMeetingNote}
                            maxWidth={260}
                          >
                            <span className="border-b border-dotted border-zinc-600 cursor-help">
                              Unavailable
                            </span>
                          </TerminalTooltip>
                        )}
                      </td>
                      <td className="py-2.5 pl-2 text-right text-[10px] text-zinc-400">
                        <div>{cb.latestObservationDate || '—'}</div>
                        <div className="text-[9px] text-zinc-500">
                          {cb.source} · {cb.seriesId}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

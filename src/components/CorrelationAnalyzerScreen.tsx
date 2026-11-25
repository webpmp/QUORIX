import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ChevronDown,
  Info,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { StockData } from '../types';
import {
  BENCHMARK_DEFAULTS,
  CORRELATION_LEGEND_BANDS,
  DEFAULT_LOOKBACK_PERIOD,
  DEFAULT_ROLLING_WINDOW,
  LOOKBACK_PERIODS,
  ROLLING_WINDOW_OPTIONS,
  buildCorrelationMatrix,
  computePairwiseAnalysis,
  formatCorrelationValue,
  generateCorrelationInsights,
  getLookbackConfig,
  interpretCorrelation,
  type CorrelationBandId,
  type DailyPricePoint,
  type LookbackPeriodId,
  type NormalizedPerformancePoint,
  type PairwiseCorrelationAnalysis,
  type ReturnScatterPoint,
  type RollingCorrelationPoint,
  type SecurityHistorySeries,
} from '../utils/correlation';
import { isValidTickerFormat, normalizeTickerSymbol } from '../utils/equityValidation';
import {
  clearDailyHistoryClientCache,
  fetchSecurityDailyHistory,
} from '../utils/dailyHistoryClient';
import { InfoTooltipIcon, TerminalTooltip } from './TerminalTooltip';
import ExplainerButton from './ExplainerButton';
import InsightRow from './InsightRow';
import StickyScreenHeader from './StickyScreenHeader';

const CORR_TOOLTIPS = {
  lookbackPeriod: 'Historical period used for correlation calculations.',
  pearson:
    "Measures the strength and direction of the linear relationship between two securities' daily returns. Values range from -1 to +1.",
  daily: 'Calculations use daily percentage returns from consecutive trading sessions.',
  rollingWindow:
    'Number of trading observations used for each rolling correlation calculation, separate from the overall lookback period.',
  correlationMatrix:
    "Each cell represents the Pearson correlation between two securities' daily returns over the selected lookback period.",
  correlationCoefficient:
    "Correlation measures how closely two securities' daily returns move together. +1 indicates perfect positive correlation, 0 indicates no linear correlation, and -1 indicates perfect negative correlation. Correlation does not establish causation.",
  rollingCorrelation:
    'Shows how the Pearson correlation between two securities changes over time using a moving observation window.',
  normalizedPerformance:
    'Compares historical percentage performance using Base 100: both securities are indexed to a common starting value of 100 so their percentage performance can be compared regardless of share price.',
  returnDistribution:
    'Each point represents the daily percentage returns of both securities on the same trading date. The fitted orange line is the ordinary least squares (OLS) regression line, showing their best-fitting linear relationship.',
  sameDirectionSessions:
    'Percentage of overlapping trading sessions in which both securities had returns with the same sign, whether positive or negative.',
  overlappingObservations:
    'Number of trading-date observations available for both securities and included in the correlation calculation.',
  correlationInsights:
    'Rule-based observations derived from calculated historical correlation values. These are descriptive findings, not predictions.',
} as const;

export const CORR_USAGE_WORKFLOW_STEPS = [
  {
    step: '1. Start with your existing holdings',
    detail: 'Add the securities you currently own to the Security Selection area.',
  },
  {
    step: '2. Examine the Correlation Matrix',
    detail:
      'Look for clusters of strongly positive correlations. These identify holdings that may provide overlapping exposure.',
  },
  {
    step: '3. Investigate negative and low correlations',
    detail: 'Identify securities that might diversify your existing positions.',
  },
  {
    step: '4. Inspect individual pairs',
    detail:
      'Select two securities and examine their rolling correlation, normalized performance, and return distribution.',
  },
  {
    step: '5. Check whether relationships are changing',
    detail:
      'Compare 30-day, 90-day, and 180-day periods. A relationship that looks strong over six months may have weakened recently.',
  },
  {
    step: '6. Make decisions using additional evidence',
    detail:
      'Combine correlation with volatility, fundamentals, valuation, liquidity, and your investment objectives.',
  },
] as const;

const CORR_USAGE_ARIA_TEXT = [
  'How do I use the CORR Workspace?',
  'Here is a practical workflow for analyzing your portfolio.',
  ...CORR_USAGE_WORKFLOW_STEPS.map((item) => `${item.step}: ${item.detail}`),
].join(' ');

const CORR_USAGE_TOOLTIP_CONTENT = (
  <div className="space-y-2.5 p-0.5">
    <div className="border-b border-[#3a3a3a] pb-2 space-y-1">
      <div className="text-xs font-bold text-[#ff9900] tracking-wide">
        How do I use the CORR Workspace?
      </div>
      <p className="text-[13px] text-zinc-300 leading-relaxed">
        Here is a practical workflow for analyzing your portfolio.
      </p>
    </div>
    <ol className="space-y-2">
      {CORR_USAGE_WORKFLOW_STEPS.map((item) => (
        <li key={item.step} className="space-y-0.5">
          <div className="text-[13px] font-bold text-zinc-100">{item.step}</div>
          <p className="text-xs text-zinc-300 leading-relaxed">{item.detail}</p>
        </li>
      ))}
    </ol>
  </div>
);

export interface CorrelationAnalyzerScreenProps {
  stocks: Record<string, StockData>;
  trackedTickers?: string[];
  seedTicker?: { id: number; symbol: string } | null;
  initialSymbols?: string[];
  initialSeriesMap?: Record<string, SecurityHistorySeries>;
  initialLookback?: LookbackPeriodId;
  initialRollingWindow?: number;
  onExecuteCommand?: (cmd: string) => void;
}

interface SearchCandidate {
  symbol: string;
  name: string;
  instrumentType: string;
  exchange: string;
  supported: boolean;
}

interface SecurityLoadEntry {
  status: 'loading' | 'ready' | 'error';
  series?: SecurityHistorySeries;
  error?: string;
  isInvalidTicker?: boolean;
  unsupported?: boolean;
  rateLimited?: boolean;
}

const MAX_SELECTED_SECURITIES = 12;

export const clearCorrelationClientCache = clearDailyHistoryClientCache;

function getMatrixCellClasses(bandId: CorrelationBandId, isDiagonal: boolean): string {
  if (isDiagonal) {
    return 'bg-[#141414] text-zinc-300 border-[#2c2c2c]';
  }
  switch (bandId) {
    case 'strong-positive':
      return 'bg-[#072b12] text-[#00ff00] border-[#14532d] hover:border-[#00ff00]';
    case 'moderate-positive':
      return 'bg-[#0a1f12] text-[#6ee787] border-[#143a23] hover:border-[#6ee787]';
    case 'weak-positive':
      return 'bg-[#0c1610] text-[#9ec7ab] border-[#1d2c22] hover:border-[#9ec7ab]';
    case 'neutral':
      return 'bg-[#101012] text-zinc-300 border-[#26262a] hover:border-zinc-400';
    case 'weak-negative':
      return 'bg-[#1a1010] text-[#d9a3a3] border-[#332020] hover:border-[#d9a3a3]';
    case 'moderate-negative':
      return 'bg-[#260f10] text-[#f87171] border-[#4b1c1f] hover:border-[#f87171]';
    case 'strong-negative':
      return 'bg-[#360c0e] text-[#ff4444] border-[#7f1d1d] hover:border-[#ff4444]';
    case 'unavailable':
    default:
      return 'bg-[#080808] text-zinc-300 border-[#3a3a3a]';
  }
}

function getBandSwatchClass(bandId: CorrelationBandId): string {
  switch (bandId) {
    case 'strong-positive':
      return 'bg-[#072b12] border-[#00ff00]/60';
    case 'moderate-positive':
      return 'bg-[#0a1f12] border-[#6ee787]/50';
    case 'weak-positive':
      return 'bg-[#0c1610] border-[#9ec7ab]/40';
    case 'neutral':
      return 'bg-[#101012] border-zinc-600';
    case 'weak-negative':
      return 'bg-[#1a1010] border-[#d9a3a3]/40';
    case 'moderate-negative':
      return 'bg-[#260f10] border-[#f87171]/50';
    case 'strong-negative':
      return 'bg-[#360c0e] border-[#ff4444]/60';
    default:
      return 'bg-[#080808] border-[#3a3a3a]';
  }
}

function getInterpretationTextClass(bandId: CorrelationBandId): string {
  switch (bandId) {
    case 'strong-positive':
      return 'text-[#00ff00]';
    case 'moderate-positive':
      return 'text-[#6ee787]';
    case 'weak-positive':
      return 'text-[#9ec7ab]';
    case 'neutral':
      return 'text-zinc-300';
    case 'weak-negative':
      return 'text-[#d9a3a3]';
    case 'moderate-negative':
      return 'text-[#f87171]';
    case 'strong-negative':
      return 'text-[#ff4444]';
    default:
      return 'text-zinc-300';
  }
}

const CORRELATION_SCALE_ARIA_TEXT = [
  CORR_TOOLTIPS.correlationCoefficient,
  ...CORRELATION_LEGEND_BANDS.map((band) => `${band.label}: ${band.rangeLabel}`),
].join(' ');

const CORRELATION_SCALE_POPOVER_CONTENT = (
  <div className="space-y-2">
    <p className="text-xs text-zinc-300 leading-relaxed">
      Correlation measures how closely two securities&apos; daily returns move together.
    </p>
    <div className="border-t border-b border-[#2e2e2e] py-1 divide-y divide-[#1e1e1e]">
      {CORRELATION_LEGEND_BANDS.map((band) => (
        <div
          key={band.id}
          className="flex items-center justify-between gap-3 py-1 text-xs"
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <span
              className={`w-2.5 h-2.5 rounded-xs border shrink-0 ${getBandSwatchClass(band.id)}`}
              aria-hidden="true"
            />
            <span className={`font-semibold ${getInterpretationTextClass(band.id)}`}>
              {band.label}
            </span>
          </span>
          <span className="font-mono text-zinc-200 tabular-nums whitespace-nowrap shrink-0">
            {band.rangeLabel}
          </span>
        </div>
      ))}
    </div>
    <p className="text-xs text-zinc-400 leading-snug">
      Correlation does not establish causation.
    </p>
  </div>
);

function formatShortIsoDate(iso: string): string {
  if (!iso || iso.length < 10) return iso;
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mIdx = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const yr = parts[0].slice(2);
  if (mIdx < 0 || mIdx > 11 || !Number.isFinite(day)) return iso;
  return `${months[mIdx]} ${day} '${yr}`;
}

function formatAxisDate(iso: string): string {
  if (!iso || iso.length < 10) return iso;
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mIdx = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  if (mIdx < 0 || mIdx > 11 || !Number.isFinite(day)) return iso;
  return `${months[mIdx]} ${day}`;
}

function pickTickIndices(length: number, maxTicks = 5): number[] {
  if (length <= 0) return [];
  if (length === 1) return [0];
  if (length <= maxTicks) return Array.from({ length }, (_, i) => i);
  const indices: number[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const idx = Math.round((i / (maxTicks - 1)) * (length - 1));
    if (indices[indices.length - 1] !== idx) indices.push(idx);
  }
  return indices;
}

export function computeResponsiveChartWidth(
  measuredWidth: number | null | undefined,
  fallbackWidth: number,
  minWidth = 260
): number {
  if (typeof measuredWidth === 'number' && Number.isFinite(measuredWidth) && measuredWidth > 0) {
    return Math.max(minWidth, Math.floor(measuredWidth));
  }
  return fallbackWidth;
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

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [ref, rebindKey]);

  return computeResponsiveChartWidth(measuredWidth, fallbackWidth);
}

/* ============================================================================
 * 1. HISTORICAL ROLLING CORRELATION CHART (SVG)
 * ========================================================================== */
const RollingCorrelationChart: React.FC<{
  symbolA: string;
  symbolB: string;
  series: RollingCorrelationPoint[];
  rollingWindow: number;
  unavailableReason: string | null;
}> = ({ symbolA, symbolB, series, rollingWindow, unavailableReason }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const hasChartData = !unavailableReason && series.length >= 2;
  const width = useContainerWidth(svgContainerRef, 680, hasChartData);

  if (!hasChartData) {
    return (
      <div className="w-full h-[230px] bg-[#080808] border border-[#3a3a3a] rounded flex flex-col items-center justify-center px-6 text-center gap-1.5">
        <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
          Rolling Correlation Unavailable
        </span>
        <span className="text-xs text-zinc-300 max-w-md leading-relaxed">
          {unavailableReason ||
            `Insufficient overlapping observations to compute a ${rollingWindow}-session rolling correlation for ${symbolA} vs ${symbolB}.`}
        </span>
      </div>
    );
  }

  const height = 210;
  const pad = { top: 18, right: 16, bottom: 28, left: 46 };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const xOf = (idx: number) =>
    pad.left + (series.length === 1 ? plotW / 2 : (idx / (series.length - 1)) * plotW);
  const yOf = (val: number) => {
    const clamped = Math.max(-1, Math.min(1, val));
    return pad.top + ((1 - clamped) / 2) * plotH;
  };
  const zeroY = yOf(0);

  const linePath = series
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(2)} ${yOf(pt.correlation).toFixed(2)}`)
    .join(' ');

  const areaBasePath = `${linePath} L ${xOf(series.length - 1).toFixed(2)} ${zeroY.toFixed(2)} L ${xOf(0).toFixed(2)} ${zeroY.toFixed(2)} Z`;

  const yTicks = [1, 0.5, 0, -0.5, -1];
  const maxXTicks = width >= 920 ? 7 : width >= 540 ? 5 : 4;
  const xTickIndices = pickTickIndices(series.length, maxXTicks);
  const activePt = hoverIdx !== null && series[hoverIdx] ? series[hoverIdx] : series[series.length - 1];
  const activeBand = interpretCorrelation(activePt.correlation);
  const clipIdPos = `roll-pos-${symbolA}-${symbolB}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const clipIdNeg = `roll-neg-${symbolA}-${symbolB}`.replace(/[^a-zA-Z0-9_-]/g, '');

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const norm = Math.max(0, Math.min(1, (relX - pad.left) / plotW));
    const idx = Math.round(norm * (series.length - 1));
    setHoverIdx(idx);
  };

  return (
    <div className="w-full min-w-0 bg-[#080808] border border-[#3a3a3a] rounded p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-2 text-zinc-300">
          <span className="text-zinc-200 font-bold">
            {symbolA} / {symbolB}
          </span>
          <span aria-hidden="true">·</span>
          <span>{rollingWindow} obs window</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1 text-zinc-300">
            <span className="inline-block w-3 border-t border-dashed border-zinc-400" aria-hidden="true" />
            <span>0.00 line</span>
          </span>
        </div>
        <div className="flex items-center gap-2 tabular-nums">
          <span className="text-zinc-300">{formatShortIsoDate(activePt.date)}</span>
          <span className={`font-bold ${getInterpretationTextClass(activeBand.id)}`}>
            r = {formatCorrelationValue(activePt.correlation)}
          </span>
          <span className="text-zinc-300">({activeBand.label})</span>
        </div>
      </div>

      <div ref={svgContainerRef} className="w-full min-w-0">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[210px] block select-none"
          role="img"
          aria-label={`Rolling ${rollingWindow}-observation Pearson correlation between ${symbolA} and ${symbolB}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
        <defs>
          <clipPath id={clipIdPos}>
            <rect x={pad.left} y={pad.top} width={plotW} height={Math.max(0, zeroY - pad.top)} />
          </clipPath>
          <clipPath id={clipIdNeg}>
            <rect x={pad.left} y={zeroY} width={plotW} height={Math.max(0, pad.top + plotH - zeroY)} />
          </clipPath>
        </defs>

        {/* Positive and negative background bands */}
        <rect
          x={pad.left}
          y={pad.top}
          width={plotW}
          height={Math.max(0, zeroY - pad.top)}
          fill="#00ff00"
          fillOpacity={0.035}
        />
        <rect
          x={pad.left}
          y={zeroY}
          width={plotW}
          height={Math.max(0, pad.top + plotH - zeroY)}
          fill="#ff4444"
          fillOpacity={0.035}
        />

        {/* Y-axis gridlines & labels */}
        {yTicks.map((tick) => {
          const y = yOf(tick);
          const isZero = tick === 0;
          return (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={pad.left + plotW}
                y1={y}
                y2={y}
                stroke={isZero ? '#71717a' : '#222222'}
                strokeWidth={isZero ? 1.25 : 1}
                strokeDasharray={isZero ? '4 3' : undefined}
              />
              <text
                x={pad.left - 8}
                y={y + 3}
                textAnchor="end"
                fill={isZero ? '#d4d4d8' : '#71717a'}
                fontSize="9.5"
                fontFamily="monospace"
              >
                {tick > 0 ? `+${tick.toFixed(2)}` : tick.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Shaded positive and negative fills under/over zero line */}
        <path d={areaBasePath} fill="#00ff00" fillOpacity={0.14} clipPath={`url(#${clipIdPos})`} />
        <path d={areaBasePath} fill="#ff4444" fillOpacity={0.16} clipPath={`url(#${clipIdNeg})`} />

        {/* Rolling correlation line */}
        <path
          d={linePath}
          fill="none"
          stroke="#ff9900"
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* X-axis date ticks */}
        {xTickIndices.map((idx) => (
          <text
            key={idx}
            x={xOf(idx)}
            y={height - 8}
            textAnchor={idx === 0 ? 'start' : idx === series.length - 1 ? 'end' : 'middle'}
            fill="#a1a1aa"
            fontSize="9.5"
            fontFamily="monospace"
          >
            {formatAxisDate(series[idx].date)}
          </text>
        ))}

        {/* Hover crosshair */}
        {hoverIdx !== null && series[hoverIdx] && (
          <g>
            <line
              x1={xOf(hoverIdx)}
              x2={xOf(hoverIdx)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="#52525b"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={xOf(hoverIdx)}
              cy={yOf(series[hoverIdx].correlation)}
              r={4}
              fill="#ff9900"
              stroke="#010101"
              strokeWidth={1.5}
            />
          </g>
        )}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 mt-2 text-xs font-mono uppercase tracking-wider tabular-nums select-none">
        <span className="font-semibold text-[#00ff00]">POSITIVE (+1.00)</span>
        <span className="font-semibold text-[#ff4444]">NEGATIVE (-1.00)</span>
      </div>
    </div>
  );
};

/* ============================================================================
 * 2. NORMALIZED PERFORMANCE COMPARISON CHART (BASE = 100, SVG)
 * ========================================================================== */
const NormalizedPerformanceChart: React.FC<{
  symbolA: string;
  symbolB: string;
  series: NormalizedPerformancePoint[];
}> = ({ symbolA, symbolB, series }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const hasChartData = series.length >= 2;
  const width = useContainerWidth(svgContainerRef, 520, hasChartData);

  if (!hasChartData) {
    return (
      <div className="w-full h-[220px] bg-[#080808] border border-[#3a3a3a] rounded flex items-center justify-center px-6 text-center text-xs text-zinc-300">
        Insufficient overlapping adjusted closing prices to plot normalized performance (Base = 100).
      </div>
    );
  }

  const height = 200;
  const pad = { top: 18, right: 16, bottom: 26, left: 48 };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  let minVal = 100;
  let maxVal = 100;
  for (const pt of series) {
    minVal = Math.min(minVal, pt.indexA, pt.indexB);
    maxVal = Math.max(maxVal, pt.indexA, pt.indexB);
  }
  const span = Math.max(2, maxVal - minVal);
  const yMin = minVal - span * 0.08;
  const yMax = maxVal + span * 0.08;

  const xOf = (idx: number) => pad.left + (idx / (series.length - 1)) * plotW;
  const yOf = (val: number) => pad.top + ((yMax - val) / (yMax - yMin)) * plotH;

  const pathA = series
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(2)} ${yOf(pt.indexA).toFixed(2)}`)
    .join(' ');
  const pathB = series
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(2)} ${yOf(pt.indexB).toFixed(2)}`)
    .join(' ');

  const yTicks = [yMax, yMin + (yMax - yMin) * 0.66, yMin + (yMax - yMin) * 0.33, yMin];
  const maxXTicks = width >= 680 ? 6 : width >= 460 ? 5 : 4;
  const xTickIndices = pickTickIndices(series.length, maxXTicks);
  const activePt = hoverIdx !== null && series[hoverIdx] ? series[hoverIdx] : series[series.length - 1];
  const pctA = activePt.indexA - 100;
  const pctB = activePt.indexB - 100;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const norm = Math.max(0, Math.min(1, (relX - pad.left) / plotW));
    setHoverIdx(Math.round(norm * (series.length - 1)));
  };

  return (
    <div className="w-full min-w-0 flex-1 bg-[#080808] border border-[#3a3a3a] rounded p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs font-mono">
        <div className="flex items-center gap-3 tabular-nums">
          <span className="text-[#ff9900] font-bold">
            ━ {symbolA}: {activePt.indexA.toFixed(1)} ({pctA >= 0 ? '+' : ''}
            {pctA.toFixed(1)}%)
          </span>
          <span className="text-[#3498db] font-bold">
            ━ {symbolB}: {activePt.indexB.toFixed(1)} ({pctB >= 0 ? '+' : ''}
            {pctB.toFixed(1)}%)
          </span>
        </div>
        <span className="text-zinc-300 tabular-nums">{formatShortIsoDate(activePt.date)}</span>
      </div>

      <div ref={svgContainerRef} className="w-full min-w-0">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[200px] block select-none"
          role="img"
          aria-label={`Normalized performance comparison of ${symbolA} and ${symbolB} indexed to 100`}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
        {yTicks.map((tick, i) => {
          const y = yOf(tick);
          return (
            <g key={i}>
              <line x1={pad.left} x2={pad.left + plotW} y1={y} y2={y} stroke="#1d1d1d" strokeWidth={1} />
              <text
                x={pad.left - 8}
                y={y + 3}
                textAnchor="end"
                fill="#a1a1aa"
                fontSize="9"
                fontFamily="monospace"
              >
                {tick.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Base 100 dashed reference line */}
        <line
          x1={pad.left}
          x2={pad.left + plotW}
          y1={yOf(100)}
          y2={yOf(100)}
          stroke="#52525b"
          strokeWidth={1}
          strokeDasharray="4 3"
        />

        <path d={pathB} fill="none" stroke="#3498db" strokeWidth={1.7} strokeLinejoin="round" />
        <path d={pathA} fill="none" stroke="#ff9900" strokeWidth={1.8} strokeLinejoin="round" />

        {xTickIndices.map((idx) => (
          <text
            key={idx}
            x={xOf(idx)}
            y={height - 8}
            textAnchor={idx === 0 ? 'start' : idx === series.length - 1 ? 'end' : 'middle'}
            fill="#a1a1aa"
            fontSize="9"
            fontFamily="monospace"
          >
            {formatAxisDate(series[idx].date)}
          </text>
        ))}

        {hoverIdx !== null && series[hoverIdx] && (
          <g>
            <line
              x1={xOf(hoverIdx)}
              x2={xOf(hoverIdx)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="#52525b"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={xOf(hoverIdx)} cy={yOf(series[hoverIdx].indexA)} r={3.5} fill="#ff9900" />
            <circle cx={xOf(hoverIdx)} cy={yOf(series[hoverIdx].indexB)} r={3.5} fill="#3498db" />
          </g>
        )}
        </svg>
      </div>
    </div>
  );
};

/* ============================================================================
 * 3. DAILY RETURN SCATTER PLOT (DAILY % RETURNS, SVG)
 * ========================================================================== */
const DailyReturnScatterPlot: React.FC<{
  symbolA: string;
  symbolB: string;
  points: ReturnScatterPoint[];
  regressionLine: { slope: number; intercept: number } | null;
  correlation: number | null;
}> = ({ symbolA, symbolB, points, regressionLine, correlation }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const hasChartData = points.length >= 2;
  const width = useContainerWidth(svgContainerRef, 520, hasChartData);

  if (!hasChartData) {
    return (
      <div className="w-full flex-1 h-[220px] bg-[#080808] border border-[#3a3a3a] rounded flex items-center justify-center px-6 text-center text-xs text-zinc-300">
        Insufficient overlapping daily percentage returns to render scatter plot.
      </div>
    );
  }

  const height = 200;
  const pad = { top: 18, right: 18, bottom: 26, left: 48 };
  const plotW = Math.max(1, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  let maxAbsX = 1;
  let maxAbsY = 1;
  for (const pt of points) {
    maxAbsX = Math.max(maxAbsX, Math.abs(pt.retAPct));
    maxAbsY = Math.max(maxAbsY, Math.abs(pt.retBPct));
  }
  const boundX = Math.ceil(maxAbsX * 1.12 * 2) / 2;
  const boundY = Math.ceil(maxAbsY * 1.12 * 2) / 2;

  const xOf = (val: number) => pad.left + ((val + boundX) / (2 * boundX)) * plotW;
  const yOf = (val: number) => pad.top + ((boundY - val) / (2 * boundY)) * plotH;

  const band = interpretCorrelation(correlation);
  const dotColor =
    band.direction === 'positive'
      ? '#00ff00'
      : band.direction === 'negative'
      ? '#ff4444'
      : '#a1a1aa';

  // Clamp OLS regression line to plot boundaries
  let regStart: { x: number; y: number } | null = null;
  let regEnd: { x: number; y: number } | null = null;
  if (regressionLine) {
    const x1 = -boundX;
    const x2 = boundX;
    const y1 = Math.max(-boundY, Math.min(boundY, regressionLine.slope * x1 + regressionLine.intercept));
    const y2 = Math.max(-boundY, Math.min(boundY, regressionLine.slope * x2 + regressionLine.intercept));
    regStart = { x: xOf(x1), y: yOf(y1) };
    regEnd = { x: xOf(x2), y: yOf(y2) };
  }

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="w-full min-w-0 flex-1 bg-[#080808] border border-[#3a3a3a] rounded p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs font-mono">
        <span className="text-zinc-300">
          X: <span className="text-zinc-200 font-bold">{symbolA} Daily %</span> · Y:{' '}
          <span className="text-zinc-200 font-bold">{symbolB} Daily %</span>
        </span>
        {hovered ? (
          <span className="text-zinc-300 tabular-nums">
            {formatShortIsoDate(hovered.date)} · {symbolA}{' '}
            <span className={hovered.retAPct >= 0 ? 'text-[#00ff00]' : 'text-[#ff4444]'}>
              {hovered.retAPct >= 0 ? '+' : ''}
              {hovered.retAPct.toFixed(2)}%
            </span>{' '}
            · {symbolB}{' '}
            <span className={hovered.retBPct >= 0 ? 'text-[#00ff00]' : 'text-[#ff4444]'}>
              {hovered.retBPct >= 0 ? '+' : ''}
              {hovered.retBPct.toFixed(2)}%
            </span>
          </span>
        ) : (
          <span className="text-zinc-300 tabular-nums">{points.length} daily return sessions</span>
        )}
      </div>

      <div ref={svgContainerRef} className="w-full min-w-0">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[200px] block select-none"
          role="img"
          aria-label={`Daily percentage return scatter plot of ${symbolA} versus ${symbolB}`}
        >
        {/* Plot frame */}
        <rect
          x={pad.left}
          y={pad.top}
          width={plotW}
          height={plotH}
          fill="#050505"
          stroke="#222222"
          strokeWidth={1}
        />

        {/* Zero reference axes */}
        <line
          x1={pad.left}
          x2={pad.left + plotW}
          y1={yOf(0)}
          y2={yOf(0)}
          stroke="#52525b"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <line
          x1={xOf(0)}
          x2={xOf(0)}
          y1={pad.top}
          y2={pad.top + plotH}
          stroke="#52525b"
          strokeWidth={1}
          strokeDasharray="3 3"
        />

        {/* Y axis labels */}
        {[-boundY, 0, boundY].map((tick) => (
          <text
            key={`y-${tick}`}
            x={pad.left - 7}
            y={yOf(tick) + 3}
            textAnchor="end"
            fill="#a1a1aa"
            fontSize="9"
            fontFamily="monospace"
          >
            {tick > 0 ? `+${tick.toFixed(1)}%` : `${tick.toFixed(1)}%`}
          </text>
        ))}

        {/* X axis labels */}
        {[-boundX, 0, boundX].map((tick) => (
          <text
            key={`x-${tick}`}
            x={xOf(tick)}
            y={height - 8}
            textAnchor={tick < 0 ? 'start' : tick > 0 ? 'end' : 'middle'}
            fill="#a1a1aa"
            fontSize="9"
            fontFamily="monospace"
          >
            {tick > 0 ? `+${tick.toFixed(1)}%` : `${tick.toFixed(1)}%`}
          </text>
        ))}

        {/* OLS linear trendline */}
        {regStart && regEnd && (
          <line
            x1={regStart.x}
            y1={regStart.y}
            x2={regEnd.x}
            y2={regEnd.y}
            stroke="#ff9900"
            strokeWidth={1.3}
            strokeOpacity={0.8}
          />
        )}

        {/* Daily return points */}
        {points.map((pt, idx) => {
          const isHovered = hoverIdx === idx;
          return (
            <circle
              key={`${pt.date}-${idx}`}
              cx={xOf(pt.retAPct)}
              cy={yOf(pt.retBPct)}
              r={isHovered ? 4.5 : 2.8}
              fill={isHovered ? '#ff9900' : dotColor}
              fillOpacity={isHovered ? 1 : 0.72}
              stroke={isHovered ? '#ffffff' : '#050505'}
              strokeWidth={isHovered ? 1.2 : 0.6}
              className="cursor-pointer"
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          );
        })}
        </svg>
      </div>
    </div>
  );
};

/* ============================================================================
 * MAIN WORKSPACE: CORRELATION ANALYZER (CORR)
 * ========================================================================== */
export default function CorrelationAnalyzerScreen({
  stocks,
  seedTicker = null,
  initialSymbols,
  initialSeriesMap,
  initialLookback = DEFAULT_LOOKBACK_PERIOD,
  initialRollingWindow = DEFAULT_ROLLING_WINDOW,
  onExecuteCommand,
}: CorrelationAnalyzerScreenProps) {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(() => {
    if (Array.isArray(initialSymbols)) {
      return Array.from(new Set(initialSymbols.map((s) => normalizeTickerSymbol(s)).filter(Boolean)));
    }
    return BENCHMARK_DEFAULTS.map((b) => b.symbol);
  });

  const [loadMap, setLoadMap] = useState<Record<string, SecurityLoadEntry>>(() => {
    if (!initialSeriesMap) return {};
    const next: Record<string, SecurityLoadEntry> = {};
    for (const [sym, series] of Object.entries(initialSeriesMap)) {
      const key = normalizeTickerSymbol(sym);
      next[key] = series.error
        ? {
            status: 'error',
            series,
            error: series.error,
            isInvalidTicker: series.isInvalidTicker,
            unsupported: series.unsupported,
            rateLimited: series.rateLimited,
          }
        : { status: 'ready', series };
    }
    return next;
  });

  const [lookbackPeriod, setLookbackPeriod] = useState<LookbackPeriodId>(initialLookback);
  const [rollingWindow, setRollingWindow] = useState<number>(initialRollingWindow);
  const [activePair, setActivePair] = useState<[string, string]>(() => {
    const syms = Array.isArray(initialSymbols)
      ? initialSymbols.map((s) => normalizeTickerSymbol(s)).filter(Boolean)
      : BENCHMARK_DEFAULTS.map((b) => b.symbol);
    return syms.length >= 2 ? [syms[0], syms[1]] : ['', ''];
  });

  // Search box state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchCandidate[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHighlightedIndex, setSearchHighlightedIndex] = useState<number>(-1);
  const [selectionNotice, setSelectionNotice] = useState<{
    tone: 'error' | 'warning' | 'info';
    text: string;
  } | null>(null);
  const [validatingSymbol, setValidatingSymbol] = useState<string | null>(null);

  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSearchSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const selection = pendingSearchSelectionRef.current;
    const inputEl = searchInputRef.current;
    if (!selection || !inputEl) return;
    pendingSearchSelectionRef.current = null;
    if (document.activeElement === inputEl) {
      try {
        inputEl.setSelectionRange(selection.start, selection.end);
      } catch {
        // ignore if selection range is unavailable
      }
    }
  }, [searchQuery]);

  // Load daily adjusted history for a single symbol (uses cache and avoids duplicate fetches)
  const ensureSymbolLoaded = useCallback(async (rawSym: string, force = false) => {
    const sym = normalizeTickerSymbol(rawSym);
    if (!sym) return;

    setLoadMap((prev) => {
      const existing = prev[sym];
      if (!force && existing && (existing.status === 'loading' || existing.status === 'ready')) {
        return prev;
      }
      return { ...prev, [sym]: { status: 'loading', series: existing?.series } };
    });

    const series = await fetchSecurityDailyHistory(sym, force);
    if (!mountedRef.current) return;

    if (series.error || series.bars.length === 0) {
      setLoadMap((prev) => ({
        ...prev,
        [sym]: {
          status: 'error',
          series,
          error: series.error || `No historical daily price data available for ${sym}.`,
          isInvalidTicker: series.isInvalidTicker,
          unsupported: series.unsupported,
          rateLimited: series.rateLimited,
        },
      }));
    } else {
      setLoadMap((prev) => ({
        ...prev,
        [sym]: { status: 'ready', series },
      }));
    }
  }, []);

  // Trigger fetches whenever selectedSymbols includes an unloaded symbol
  useEffect(() => {
    for (const sym of selectedSymbols) {
      const entry = loadMap[sym];
      if (!entry) {
        void ensureSymbolLoaded(sym, false);
      }
    }
  }, [selectedSymbols, loadMap, ensureSymbolLoaded]);

  // If user executed a chained command like `AAPL CORR` or `CORR NVDA`, add that ticker automatically
  const lastSeedIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!seedTicker || !seedTicker.symbol) return;
    if (lastSeedIdRef.current === seedTicker.id) return;
    lastSeedIdRef.current = seedTicker.id;
    const sym = normalizeTickerSymbol(seedTicker.symbol);
    if (!sym || !isValidTickerFormat(sym)) return;

    setSelectedSymbols((prev) => {
      if (prev.includes(sym)) return prev;
      if (prev.length >= MAX_SELECTED_SECURITIES) return prev;
      return [sym, ...prev];
    });
    setActivePair((prev) => {
      const partner = prev[0] && prev[0] !== sym ? prev[0] : prev[1] && prev[1] !== sym ? prev[1] : 'SPY';
      return partner && partner !== sym ? [sym, partner] : prev;
    });
  }, [seedTicker]);

  // Keep activePair synchronized with selectedSymbols
  useEffect(() => {
    if (selectedSymbols.length < 2) {
      setActivePair(['', '']);
      return;
    }
    setActivePair((prev) => {
      const [a, b] = prev;
      if (a && b && a !== b && selectedSymbols.includes(a) && selectedSymbols.includes(b)) {
        return prev;
      }
      return [selectedSymbols[0], selectedSymbols[1]];
    });
  }, [selectedSymbols]);

  // Close search dropdown on outside click
  useEffect(() => {
    if (!searchOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setSearchHighlightedIndex(-1);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [searchOpen]);

  // Debounced security search by ticker or company name
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchHighlightedIndex(-1);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/market/search?q=${encodeURIComponent(trimmed)}`);
        const data = await resp.json();
        if (cancelled) return;
        setSearchResults(Array.isArray(data?.results) ? data.results : []);
        setSearchHighlightedIndex(-1);
      } catch {
        if (!cancelled) {
          setSearchResults([]);
          setSearchHighlightedIndex(-1);
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const handleAddSymbol = useCallback(
    async (rawSymbol: string, candidate?: SearchCandidate) => {
      const sym = normalizeTickerSymbol(rawSymbol);
      setSelectionNotice(null);

      if (!sym) return;

      if (candidate && !candidate.supported) {
        setSelectionNotice({
          tone: 'error',
          text: `${sym} (${candidate.instrumentType}) is not a supported instrument type for daily correlation analysis.`,
        });
        return;
      }

      if (selectedSymbols.includes(sym)) {
        setSelectionNotice({
          tone: 'warning',
          text: `${sym} is already included in the correlation comparison.`,
        });
        setSearchQuery('');
        setSearchOpen(false);
        return;
      }

      if (selectedSymbols.length >= MAX_SELECTED_SECURITIES) {
        setSelectionNotice({
          tone: 'warning',
          text: `Maximum of ${MAX_SELECTED_SECURITIES} securities can be compared simultaneously. Remove one to add ${sym}.`,
        });
        return;
      }

      // Validate before adding if typed manually (not picked from validated search results or known benchmarks)
      const isKnownBenchmark = BENCHMARK_DEFAULTS.some((b) => b.symbol === sym);
      if (!candidate && !isKnownBenchmark && !loadMap[sym]?.series?.bars?.length) {
        if (!isValidTickerFormat(sym)) {
          setSelectionNotice({
            tone: 'error',
            text: `"${rawSymbol.trim()}" is not a valid ticker symbol. Search by company name or enter a valid ticker (e.g., AAPL, SPY, ^GSPC, GC).`,
          });
          return;
        }
        setValidatingSymbol(sym);
        const series = await fetchSecurityDailyHistory(sym, false);
        if (!mountedRef.current) return;
        setValidatingSymbol(null);

        if (series.isInvalidTicker) {
          setSelectionNotice({
            tone: 'error',
            text: series.error || `Invalid ticker symbol "${sym}". Verify the symbol and try again.`,
          });
          return;
        }
        if (series.unsupported) {
          setSelectionNotice({
            tone: 'error',
            text: series.error || `Instrument "${sym}" is not supported for daily correlation analysis.`,
          });
          return;
        }
        if (series.rateLimited) {
          setSelectionNotice({
            tone: 'warning',
            text: series.error || 'Provider rate limit reached. Please retry in a moment.',
          });
          return;
        }

        // Cache validated result in loadMap before adding to selectedSymbols
        setLoadMap((prev) => ({
          ...prev,
          [sym]:
            series.error || series.bars.length === 0
              ? { status: 'error', series, error: series.error || `No historical data for ${sym}.` }
              : { status: 'ready', series },
        }));
      }

      setSelectedSymbols((prev) => (prev.includes(sym) ? prev : [...prev, sym]));
      setSearchQuery('');
      setSearchResults([]);
      setSearchOpen(false);
      setSearchHighlightedIndex(-1);
    },
    [selectedSymbols, loadMap]
  );

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    // Prefer exact ticker match from dropdown, else top supported candidate if user typed a company name
    const upper = trimmed.toUpperCase();
    const exactMatch = searchResults.find((r) => r.symbol.toUpperCase() === upper);
    if (exactMatch) {
      await handleAddSymbol(exactMatch.symbol, exactMatch);
      return;
    }
    if (searchResults.length > 0 && !isValidTickerFormat(upper)) {
      await handleAddSymbol(searchResults[0].symbol, searchResults[0]);
      return;
    }
    await handleAddSymbol(upper);
  };

  const handlePopulateTickerInput = useCallback(
    (symbol: string) => {
      const normalized = normalizeTickerSymbol(symbol);
      if (!normalized) return;
      onExecuteCommand?.(normalized);
      const terminalInput = document.getElementById('terminal-input') as HTMLInputElement | null;
      if (terminalInput) {
        terminalInput.focus();
      }
    },
    [onExecuteCommand]
  );

  const handleRemoveSymbol = (sym: string) => {
    setSelectionNotice(null);
    setSelectedSymbols((prev) => prev.filter((s) => s !== sym));
  };

  const handleClearAll = () => {
    setSelectionNotice(null);
    setSelectedSymbols([]);
    setActivePair(['', '']);
  };

  const handleRefreshAll = () => {
    setSelectionNotice(null);
    for (const sym of selectedSymbols) {
      void ensureSymbolLoaded(sym, true);
    }
  };

  // Build ordered SecurityHistorySeries list for matrix & pairwise computations
  const orderedSeries: SecurityHistorySeries[] = useMemo(() => {
    return selectedSymbols.map((sym) => {
      const entry = loadMap[sym];
      if (entry?.series) return entry.series;
      const bench = BENCHMARK_DEFAULTS.find((b) => b.symbol === sym);
      const knownStock = stocks[sym];
      return {
        symbol: sym,
        name: bench?.name || knownStock?.name || sym,
        instrumentType: bench?.instrumentType || 'EQUITY',
        exchange: bench?.exchange || knownStock?.exchange || 'US',
        priceBasis: 'adjclose',
        adjustedCloseAvailable: true,
        bars: [],
        earliestDate: null,
        latestDate: null,
        error: entry?.status === 'error' ? entry.error || 'Data unavailable' : null,
      };
    });
  }, [selectedSymbols, loadMap, stocks]);

  const seriesBySymbol = useMemo(() => {
    const map = new Map<string, SecurityHistorySeries>();
    for (const s of orderedSeries) {
      map.set(s.symbol, s);
    }
    return map;
  }, [orderedSeries]);

  const anyLoading = useMemo(
    () => selectedSymbols.some((sym) => !loadMap[sym] || loadMap[sym]?.status === 'loading'),
    [selectedSymbols, loadMap]
  );

  const errorEntries = useMemo(
    () =>
      selectedSymbols
        .map((sym) => ({ sym, entry: loadMap[sym] }))
        .filter((x) => x.entry?.status === 'error'),
    [selectedSymbols, loadMap]
  );

  const matrixResult = useMemo(
    () => buildCorrelationMatrix(orderedSeries, lookbackPeriod),
    [orderedSeries, lookbackPeriod]
  );

  const activePairAnalysis: PairwiseCorrelationAnalysis | null = useMemo(() => {
    const [symA, symB] = activePair;
    if (!symA || !symB || symA === symB) return null;
    const sA = seriesBySymbol.get(symA);
    const sB = seriesBySymbol.get(symB);
    if (!sA || !sB) return null;
    return computePairwiseAnalysis(sA, sB, lookbackPeriod, rollingWindow);
  }, [activePair, seriesBySymbol, lookbackPeriod, rollingWindow]);

  const insights = useMemo(
    () => generateCorrelationInsights(matrixResult, activePairAnalysis),
    [matrixResult, activePairAnalysis]
  );

  // Coverage & price-basis notices across selected securities (excluding ones still loading)
  const coverageAlerts = useMemo(() => {
    const alerts: string[] = [];
    for (const sym of selectedSymbols) {
      const load = loadMap[sym];
      if (!load || load.status === 'loading' || load.status === 'error') continue;
      const cov = matrixResult.coverageBySymbol[sym];
      if (cov && !cov.hasSufficientCoverage && cov.warningMessage) {
        alerts.push(cov.warningMessage);
      }
    }
    return alerts;
  }, [selectedSymbols, loadMap, matrixResult]);

  const unadjustedSymbols = useMemo(() => {
    return selectedSymbols.filter((sym) => {
      const load = loadMap[sym];
      return load?.status === 'ready' && load.series && !load.series.adjustedCloseAvailable;
    });
  }, [selectedSymbols, loadMap]);

  const lookbackCfg = getLookbackConfig(lookbackPeriod);

  return (
    <div className="space-y-4 animate-fade-in font-mono text-zinc-300">
      {/* ====================================================================
       * FROZEN TOP CONTROLS: HEADER & SECURITY SELECTION
       * Pinned at the top together on viewports >= 1024px wide AND >= 800px tall
       * Content below scrolls cleanly underneath behind the opaque bg-black container.
       * Uses top-[-1rem] -mt-4 pt-4 to fully cover the scroller's top padding (no peek gap).
       * Tightened paddings/gaps keep vertical height compact (~260-280px / <30% of 900px).
       * ==================================================================== */}
      <StickyScreenHeader className="space-y-2.5">
        {/* ====================================================================
         * HEADER & ACTIVE CONFIGURATION BAR
         * ==================================================================== */}
        <div className="bg-[#050505] border border-[#333] rounded px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3a3a3a] pb-2 mb-2">
            <h1 className="text-white text-sm md:text-base font-bold uppercase tracking-wider">
              CORRELATION ANALYZER
            </h1>
            <div className="flex items-center gap-2 shrink-0">
              <ExplainerButton
                label="How do I use the CORR Workspace?"
                ariaText={CORR_USAGE_ARIA_TEXT}
                text={CORR_USAGE_TOOLTIP_CONTENT}
                maxWidth={400}
              />
              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={selectedSymbols.length === 0 || anyLoading}
                className="px-2.5 py-1 rounded bg-[#0c0c0c] border border-[#333] hover:border-[#ff9900] text-zinc-300 hover:text-white text-xs font-bold uppercase flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <RefreshCw size={11} className={anyLoading ? 'animate-spin text-[#ff9900]' : ''} />
                <span>REFRESH DATA</span>
              </button>
            </div>
          </div>

          {/* Active Configuration Readout + Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
            {/* Lookback Period Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-zinc-300 uppercase font-bold tracking-wider">
                <span>LOOKBACK PERIOD</span>
                <InfoTooltipIcon
                  label="Lookback period explanation"
                  title="LOOKBACK PERIOD"
                  content={CORR_TOOLTIPS.lookbackPeriod}
                />
              </span>
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Lookback period">
                {LOOKBACK_PERIODS.map((period) => {
                  const isActive = lookbackPeriod === period.id;
                  return (
                    <button
                      key={period.id}
                      type="button"
                      onClick={() => setLookbackPeriod(period.id)}
                      aria-pressed={isActive}
                      className={`px-2 py-0.5 rounded text-xs font-bold uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                        isActive
                          ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                          : 'bg-[#0a0a0a] border-[#3a3a3a] text-zinc-300 hover:text-white hover:border-[#444]'
                      }`}
                    >
                      {period.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Config Summary (clean unboxed tabular metadata) */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-300 tabular-nums">
              <span className="inline-flex items-center gap-1">
                <span>
                  INTERVAL: <strong className="text-zinc-200">DAILY</strong>
                </span>
                <InfoTooltipIcon
                  label="Daily return interval explanation"
                  title="DAILY RETURNS"
                  content={CORR_TOOLTIPS.daily}
                />
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <span>
                  METHOD: <strong className="text-zinc-200">PEARSON</strong>
                </span>
                <InfoTooltipIcon
                  label="Pearson correlation method explanation"
                  title="PEARSON CORRELATION"
                  content={CORR_TOOLTIPS.pearson}
                />
              </span>
              <span aria-hidden="true">·</span>
              <span>
                SECURITIES: <strong className="text-zinc-200">{selectedSymbols.length}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* ====================================================================
         * A. SECURITY SELECTION & BENCHMARK CONTROLS
         * ==================================================================== */}
        <div className="bg-[#050505] border border-[#333] rounded px-3 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
              SECURITY SELECTION
            </h2>
            {selectedSymbols.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs text-zinc-300 hover:text-[#ff4444] border border-[#3a3a3a] hover:border-[#ff4444]/60 px-2 py-0.5 rounded uppercase font-bold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Trash2 size={10} />
                <span>CLEAR ALL</span>
              </button>
            )}
          </div>

          {/* Search Input + Benchmark Quick-Adds */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-2.5 items-center">
            <div ref={searchBoxRef} className="xl:col-span-6 relative">
              <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
                <div className="flex-1 flex items-center bg-black border border-[#333] focus-within:border-[#3498db] rounded px-2.5 py-1 transition-colors">
                  <Search size={12} className="text-zinc-300 mr-2 shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      const rawValue = e.target.value;
                      const upperValue = rawValue.toUpperCase();
                      if (
                        upperValue !== rawValue &&
                        e.target.selectionStart !== null &&
                        e.target.selectionEnd !== null
                      ) {
                        pendingSearchSelectionRef.current = {
                          start: e.target.selectionStart,
                          end: e.target.selectionEnd,
                        };
                      }
                      setSearchQuery(upperValue);
                      setSearchOpen(true);
                      setSearchHighlightedIndex(-1);
                      setSelectionNotice(null);
                    }}
                    onFocus={() => {
                      if (searchQuery.trim()) setSearchOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        if (searchResults.length > 0) {
                          e.preventDefault();
                          if (!searchOpen) {
                            setSearchOpen(true);
                            setSearchHighlightedIndex(0);
                          } else {
                            setSearchHighlightedIndex((prev) =>
                              prev < searchResults.length - 1 ? prev + 1 : 0
                            );
                          }
                        }
                      } else if (e.key === 'ArrowUp') {
                        if (searchResults.length > 0) {
                          e.preventDefault();
                          if (!searchOpen) {
                            setSearchOpen(true);
                            setSearchHighlightedIndex(searchResults.length - 1);
                          } else {
                            setSearchHighlightedIndex((prev) =>
                              prev <= 0 ? searchResults.length - 1 : prev - 1
                            );
                          }
                        }
                      } else if (e.key === 'Enter') {
                        if (searchOpen && searchHighlightedIndex >= 0 && searchHighlightedIndex < searchResults.length) {
                          const item = searchResults[searchHighlightedIndex];
                          const alreadySelected = selectedSymbols.includes(item.symbol);
                          if (!alreadySelected && item.supported) {
                            e.preventDefault();
                            void handleAddSymbol(item.symbol, item);
                          }
                        }
                      } else if (e.key === 'Escape') {
                        if (searchOpen) {
                          e.preventDefault();
                          setSearchOpen(false);
                          setSearchHighlightedIndex(-1);
                        }
                      }
                    }}
                    placeholder="Search ticker or company name (e.g., AAPL, Microsoft, SPY, SPX, Gold, BTC)..."
                    aria-label="Search security by ticker symbol or company name"
                    className="flex-1 min-w-0 bg-transparent text-[#00ff00] text-xs font-mono outline-none placeholder-zinc-600"
                    autoComplete="off"
                    spellCheck="false"
                  />
                  {searchLoading && <RefreshCw size={11} className="animate-spin text-[#ff9900] ml-1 shrink-0" />}
                </div>
                <button
                  type="submit"
                  disabled={!searchQuery.trim() || validatingSymbol !== null}
                  className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-xs leading-none uppercase transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                >
                  <Plus size={11} className="shrink-0" />
                  <span className="leading-none">{validatingSymbol ? 'VALIDATING...' : 'ADD'}</span>
                </button>
              </form>

              {/* Live Search Dropdown */}
              {searchOpen && searchQuery.trim().length > 0 && (
                <div
                  role="listbox"
                  aria-label="Matching securities"
                  className="absolute left-0 right-0 top-full mt-1 z-40 bg-[#070707] border border-[#333] rounded shadow-xl max-h-64 overflow-y-auto"
                >
                  {searchLoading && searchResults.length === 0 ? (
                    <div className="px-3 py-2.5 text-xs text-zinc-300">Searching securities...</div>
                  ) : searchResults.length === 0 ? (
                    <div className="px-3 py-2.5 text-xs text-zinc-300">
                      No directory matches for &ldquo;{searchQuery.trim()}&rdquo;. Press Enter to validate directly as a ticker.
                    </div>
                  ) : (
                    searchResults.map((item, idx) => {
                      const alreadySelected = selectedSymbols.includes(item.symbol);
                      const isHighlighted = idx === searchHighlightedIndex;
                      return (
                        <button
                          key={item.symbol}
                          type="button"
                          role="option"
                          aria-selected={isHighlighted || alreadySelected}
                          disabled={alreadySelected || !item.supported}
                          onClick={() => void handleAddSymbol(item.symbol, item)}
                          onMouseEnter={() => setSearchHighlightedIndex(idx)}
                          className={`w-full text-left px-3 py-2 border-b border-[#2e2e2e] last:border-b-0 flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            isHighlighted ? 'bg-[#1e293b] text-white' : 'hover:bg-[#141414]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[#3498db] font-bold text-xs">{item.symbol}</span>
                              <span className="text-zinc-200 text-xs truncate">{item.name}</span>
                            </div>
                            <div className="text-xs text-zinc-300 mt-0.5">
                              {item.instrumentType} · {item.exchange}
                            </div>
                          </div>
                          <span className="text-xs font-bold uppercase shrink-0">
                            {alreadySelected ? (
                              <span className="text-zinc-300">SELECTED</span>
                            ) : !item.supported ? (
                              <span className="text-[#ff4444]">UNSUPPORTED</span>
                            ) : (
                              <span className="text-[#00ff00]">+ ADD</span>
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Selectable Default Benchmarks */}
            <div className="xl:col-span-6">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-zinc-300 uppercase font-bold mr-1">BENCHMARKS:</span>
                {BENCHMARK_DEFAULTS.map((b) => {
                  const isSelected = selectedSymbols.includes(b.symbol);
                  return (
                    <button
                      key={b.symbol}
                      type="button"
                      onClick={() =>
                        isSelected ? handleRemoveSymbol(b.symbol) : void handleAddSymbol(b.symbol)
                      }
                      title={`${isSelected ? 'Remove' : 'Add'} ${b.name}`}
                      className={`px-2 py-1 rounded text-xs font-bold uppercase border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        isSelected
                          ? 'bg-[#1a1a1a] border-[#ff9900] text-[#ff9900]'
                          : 'bg-[#0a0a0a] border-[#3a3a3a] text-zinc-300 hover:border-zinc-400 hover:text-white'
                      }`}
                    >
                      {isSelected ? '✓ ' : '+ '}
                      {b.symbol}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Inline Selection Feedback */}
          {selectionNotice && (
            <div
              role="status"
              className={`px-3 py-2 rounded border text-xs flex items-center justify-between gap-2 ${
                selectionNotice.tone === 'error'
                  ? 'bg-red-950/25 border-red-800/60 text-red-300'
                  : selectionNotice.tone === 'warning'
                  ? 'bg-amber-950/25 border-amber-700/60 text-amber-300'
                  : 'bg-zinc-900/60 border-zinc-700 text-zinc-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertCircle size={12} className="shrink-0" />
                <span>{selectionNotice.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectionNotice(null)}
                aria-label="Dismiss message"
                className="text-zinc-300 hover:text-white cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Selected Securities List */}
          {selectedSymbols.length > 0 && (
            <div className="pt-2 border-t border-[#1e1e1e] flex flex-wrap gap-2">
              {selectedSymbols.map((sym) => {
                const entry = loadMap[sym];
                const isErr = entry?.status === 'error';
                const isLoad = !entry || entry.status === 'loading';
                const cov = matrixResult.coverageBySymbol[sym];
                const partial = !isLoad && !isErr && cov && !cov.hasSufficientCoverage;

                return (
                  <div
                    key={sym}
                    className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs max-w-full ${
                      isErr
                        ? 'bg-red-950/20 border-red-800/60'
                        : partial
                        ? 'bg-amber-950/15 border-amber-700/50'
                        : 'bg-[#0b0b0b] border-[#3a3a3a]'
                    }`}
                  >
                    <span className="font-bold text-[#3498db] whitespace-nowrap">{sym}</span>
                    {isLoad && <RefreshCw size={10} className="animate-spin text-[#ff9900] shrink-0" />}
                    <button
                      type="button"
                      onClick={() => handleRemoveSymbol(sym)}
                      aria-label={`Remove ${sym}`}
                      title={`Remove ${sym}`}
                      className="p-0.5 text-zinc-300 hover:text-[#ff4444] transition-colors cursor-pointer shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </StickyScreenHeader>

      {/* ====================================================================
       * ALERTS: API ERRORS, COVERAGE LIMITATIONS, UNADJUSTED CLOSE NOTICE
       * ==================================================================== */}
      {errorEntries.length > 0 && (
        <div className="bg-red-950/20 border border-red-800/60 rounded p-3 space-y-1.5 text-xs text-red-200">
          <div className="flex items-center gap-1.5 font-bold text-[#ff4444] uppercase text-xs">
            <AlertCircle size={12} />
            <span>Historical Data Errors</span>
          </div>
          {errorEntries.map(({ sym, entry }) => (
            <div key={sym} className="flex flex-wrap items-center justify-between gap-2 text-red-300">
              <span>
                <strong>{sym}:</strong> {entry?.error || 'Historical daily prices unavailable.'}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void ensureSymbolLoaded(sym, true)}
                  className="text-xs underline hover:text-white cursor-pointer"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveSymbol(sym)}
                  className="text-xs underline hover:text-white cursor-pointer"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {coverageAlerts.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-700/50 rounded p-3 space-y-1 text-xs text-amber-200">
          <div className="flex items-center gap-1.5 font-bold text-amber-400 uppercase text-xs">
            <AlertTriangle size={12} />
            <span>Insufficient Historical Coverage for {lookbackCfg.label} Lookback</span>
          </div>
          {coverageAlerts.map((msg, i) => (
            <div key={i} className="text-amber-300/90 leading-relaxed">
              {msg}
            </div>
          ))}
        </div>
      )}

      {unadjustedSymbols.length > 0 && (
        <div className="bg-[#09090b] border border-[#2a2a2e] rounded px-3 py-2 text-[13px] text-zinc-300 flex items-start gap-2">
          <Info size={12} className="text-[#3498db] shrink-0 mt-0.5" />
          <span>
            Adjusted closing prices were unavailable from the upstream feed for{' '}
            <strong className="text-zinc-200">{unadjustedSymbols.join(', ')}</strong>; daily returns for{' '}
            {unadjustedSymbols.length === 1 ? 'that instrument use' : 'those instruments use'} unadjusted closing prices.
          </span>
        </div>
      )}

      {/* ====================================================================
       * EMPTY STATES: 0 SECURITIES OR 1 SECURITY SELECTED
       * ==================================================================== */}
      {selectedSymbols.length === 0 && (
        <div className="bg-[#050505] border border-[#333] rounded p-8 text-center space-y-3">
          <div className="text-white text-sm font-bold uppercase tracking-wider">
            No Securities Selected
          </div>
          <p className="text-zinc-300 text-xs max-w-md mx-auto">
            Select at least two securities above to populate the correlation matrix.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setSelectedSymbols(BENCHMARK_DEFAULTS.map((b) => b.symbol))}
              className="px-3 py-1.5 rounded bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-xs uppercase cursor-pointer"
            >
              LOAD BENCHMARKS (SPY · QQQ · IWM · DIA)
            </button>
          </div>
        </div>
      )}

      {selectedSymbols.length === 1 && (
        <div className="bg-[#050505] border border-[#333] rounded p-8 text-center space-y-3">
          <div className="text-white text-sm font-bold uppercase tracking-wider">
            One Security Selected ({selectedSymbols[0]})
          </div>
          <p className="text-zinc-300 text-xs max-w-md mx-auto">
            Add another ticker to compare against{' '}
            <strong className="text-[#3498db]">{selectedSymbols[0]}</strong>.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {BENCHMARK_DEFAULTS.filter((b) => b.symbol !== selectedSymbols[0]).map((b) => (
              <button
                key={b.symbol}
                type="button"
                onClick={() => void handleAddSymbol(b.symbol)}
                className="px-2.5 py-1 rounded bg-[#0c0c0c] border border-[#333] hover:border-[#ff9900] text-zinc-200 hover:text-[#ff9900] text-xs font-bold uppercase cursor-pointer"
              >
                + COMPARE WITH {b.symbol}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ====================================================================
       * C. CORRELATION MATRIX (PRIMARY FOCAL VISUALIZATION)
       * ==================================================================== */}
      {selectedSymbols.length >= 2 && (
        <div className="bg-[#050505] border border-[#333] rounded p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3a3a3a] pb-2.5">
            <div className="flex items-center gap-1.5">
              <h2 className="text-xs text-[#ff9900] font-bold uppercase tracking-wider">
                CORRELATION MATRIX
              </h2>
              <InfoTooltipIcon
                label="Correlation matrix explanation"
                title="CORRELATION MATRIX"
                content={CORR_TOOLTIPS.correlationMatrix}
              />
            </div>
            <div className="text-xs text-zinc-300 tabular-nums">
              {anyLoading ? (
                <span className="text-[#ff9900] inline-flex items-center gap-1.5">
                  <RefreshCw size={10} className="animate-spin" />
                  FETCHING HISTORICAL PRICES...
                </span>
              ) : matrixResult.minOverlapCount !== null ? (
                <span className="inline-flex items-center gap-1">
                  <span>
                    OVERLAPPING SESSIONS:{' '}
                    <strong className="text-zinc-200">
                      {matrixResult.minOverlapCount === matrixResult.maxOverlapCount
                        ? `${matrixResult.minOverlapCount}`
                        : `${matrixResult.minOverlapCount}–${matrixResult.maxOverlapCount}`}
                    </strong>
                  </span>
                  <InfoTooltipIcon
                    label="Overlapping sessions explanation"
                    title="OVERLAPPING OBSERVATIONS"
                    content={CORR_TOOLTIPS.overlappingObservations}
                  />
                </span>
              ) : (
                <span className="text-zinc-300">NO OVERLAPPING SESSIONS</span>
              )}
            </div>
          </div>

          {/* Symmetrical Responsive Matrix Table */}
          <div className="w-full overflow-x-auto pb-1">
            <table
              className="w-full min-w-full border-separate border-spacing-1 text-xs font-mono"
              aria-label="Security correlation matrix"
            >
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-[#050505] text-left px-2.5 py-2 text-xs text-zinc-300 uppercase font-bold whitespace-nowrap w-px min-w-[76px]">
                    SECURITY
                  </th>
                  {matrixResult.symbols.map((sym) => (
                    <th
                      key={`col-${sym}`}
                      className="px-2 py-2 text-center text-xs text-[#3498db] font-bold uppercase whitespace-nowrap min-w-[88px]"
                      title={seriesBySymbol.get(sym)?.name || sym}
                    >
                      {sym}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixResult.cells.map((row, rowIdx) => {
                  const rowSym = matrixResult.symbols[rowIdx];
                  const rowLoad = loadMap[rowSym];
                  const rowName = seriesBySymbol.get(rowSym)?.name || rowSym;
                  return (
                    <tr key={`row-${rowSym}`}>
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-[#050505] text-left px-2.5 py-2 border-r border-[#3a3a3a] whitespace-nowrap w-px min-w-[76px]"
                        title={rowName}
                      >
                        <div className="text-xs font-bold text-[#3498db]">{rowSym}</div>
                      </th>
                      {row.map((cell) => {
                        const isPairSelected =
                          !cell.isDiagonal &&
                          ((activePair[0] === cell.rowSymbol && activePair[1] === cell.colSymbol) ||
                            (activePair[0] === cell.colSymbol && activePair[1] === cell.rowSymbol));
                        const colLoad = loadMap[cell.colSymbol];
                        const cellLoading =
                          !rowLoad ||
                          rowLoad.status === 'loading' ||
                          !colLoad ||
                          colLoad.status === 'loading';

                        const displayVal = cellLoading
                          ? '...'
                          : cell.isDiagonal
                          ? cell.correlation !== null
                            ? '1.00'
                            : '—'
                          : formatCorrelationValue(cell.correlation);

                        const cellStyle = getMatrixCellClasses(
                          cellLoading ? 'unavailable' : cell.interpretation.id,
                          cell.isDiagonal
                        );

                        const cellTooltipTitle = cell.isDiagonal
                          ? cell.rowSymbol
                          : `${cell.rowSymbol} / ${cell.colSymbol}`;
                        const cellAriaSummary = cellLoading
                          ? `${cellTooltipTitle}: Loading historical prices`
                          : cell.unavailableReason
                          ? `${cellTooltipTitle}: ${cell.unavailableReason}`
                          : cell.isDiagonal
                          ? `${cell.rowSymbol} · Self-correlation: 1.00 · Observations: ${cell.observationCount}`
                          : `${cell.rowSymbol} / ${cell.colSymbol} · Pearson: ${displayVal} (${cell.interpretation.label}) · Observations: ${cell.observationCount}`;

                        const cellTooltipBody = cellLoading ? (
                          <div className="text-zinc-300">Loading daily return history...</div>
                        ) : cell.unavailableReason ? (
                          <div className="text-amber-300">{cell.unavailableReason}</div>
                        ) : cell.isDiagonal ? (
                          <div className="space-y-0.5 tabular-nums">
                            <div>
                              Self-correlation: <span className="text-zinc-100 font-bold">1.00</span>
                            </div>
                            <div>
                              Observations: <span className="text-zinc-100">{cell.observationCount}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-0.5 tabular-nums">
                            <div>
                              Pearson:{' '}
                              <span className={`font-bold ${getInterpretationTextClass(cell.interpretation.id)}`}>
                                {displayVal}
                              </span>
                            </div>
                            <div>
                              Interpretation:{' '}
                              <span className="text-zinc-100">{cell.interpretation.label}</span>
                            </div>
                            <div>
                              Observations:{' '}
                              <span className="text-zinc-100">{cell.observationCount}</span>
                              {cell.hasPartialCoverage && (
                                <span className="text-amber-400"> (partial lookback)</span>
                              )}
                            </div>
                          </div>
                        );

                        return (
                          <td key={`${cell.rowSymbol}-${cell.colSymbol}`} className="p-0 min-w-[88px]">
                            <TerminalTooltip
                              title={cellTooltipTitle}
                              content={cellTooltipBody}
                              ariaText={cellAriaSummary}
                              maxWidth={250}
                              nonInteractive={true}
                              className="block w-full"
                            >
                              {cell.isDiagonal ? (
                                <div
                                  tabIndex={0}
                                  className={`w-full h-[48px] min-w-[88px] rounded border flex items-center justify-center tabular-nums focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff9900] ${cellStyle}`}
                                >
                                  <span className="text-xs font-bold">{displayVal}</span>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setActivePair([cell.rowSymbol, cell.colSymbol])}
                                  aria-label={`Compare ${cell.rowSymbol} and ${cell.colSymbol}: correlation ${displayVal}`}
                                  className={`w-full h-[48px] min-w-[88px] rounded border flex items-center justify-center gap-0.5 tabular-nums transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff9900] ${cellStyle} ${
                                    isPairSelected ? 'ring-1 ring-[#ff9900] border-[#ff9900]' : ''
                                  }`}
                                >
                                  <span className="text-xs font-extrabold">{displayVal}</span>
                                  {!cellLoading && cell.correlation !== null && cell.hasPartialCoverage && (
                                    <span className="text-xs text-amber-400 font-bold" aria-hidden="true">
                                      *
                                    </span>
                                  )}
                                </button>
                              )}
                            </TerminalTooltip>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Continuous Correlation Scale Legend with Classification Popover */}
          <div className="pt-3 border-t border-[#1e1e1e] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-300 uppercase">
              <span className="inline-flex items-center gap-1.5 font-bold tracking-wider text-zinc-300">
                <span>CORRELATION SCALE</span>
                <InfoTooltipIcon
                  label="Correlation scale classifications"
                  title="CORRELATION CLASSIFICATIONS"
                  content={CORRELATION_SCALE_POPOVER_CONTENT}
                  ariaText={CORRELATION_SCALE_ARIA_TEXT}
                  maxWidth={320}
                  scrollable={true}
                />
              </span>
              {coverageAlerts.length > 0 && (
                <span className="text-amber-400/90 normal-case">* Partial lookback coverage</span>
              )}
            </div>

            {/* Continuous Horizontal Color Bar (-1.0 to +1.0 using existing matrix palette) */}
            <div className="space-y-1">
              <div
                aria-hidden="true"
                className="relative h-2.5 w-full rounded-sm border border-[#2f2f33] overflow-hidden bg-[linear-gradient(90deg,#7f1d1d_0%,#4b1c1f_22%,#332020_38%,#101012_50%,#1d2c22_62%,#143a23_78%,#14532d_100%)]"
              >
                <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-400/60" />
              </div>
              <div className="grid grid-cols-3 items-center text-xs font-bold tabular-nums">
                <span className="text-left text-[#f87171]">-1.0</span>
                <span className="text-center text-zinc-300">0</span>
                <span className="text-right text-[#6ee787]">+1.0</span>
              </div>
            </div>

            {/* Three Concise Explanatory Groups */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 pt-0.5 text-xs">
              <div className="sm:text-left">
                <div className="font-bold uppercase tracking-wider text-[#ff4444]">NEGATIVE</div>
                <div className="text-zinc-300 leading-snug">Move in opposite directions</div>
              </div>
              <div className="sm:text-center">
                <div className="font-bold uppercase tracking-wider text-zinc-300">NEAR ZERO</div>
                <div className="text-zinc-300 leading-snug">Little or no relationship</div>
              </div>
              <div className="sm:text-right">
                <div className="font-bold uppercase tracking-wider text-[#00ff00]">POSITIVE</div>
                <div className="text-zinc-300 leading-snug">Move in the same direction</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
       * D & E. PAIRWISE COMPARISON + ROLLING CORRELATION
       * ==================================================================== */}
      {selectedSymbols.length >= 2 && activePairAnalysis && (
        <div className="bg-[#050505] border border-[#333] rounded p-4 space-y-4">
          {/* Section Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3a3a3a] pb-2.5">
            <h2 className="text-xs text-[#ff9900] font-bold uppercase tracking-wider">
              PAIRWISE COMPARISON
            </h2>
          </div>

          {/* Pair Selector & Rolling Window Controls */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-xs font-bold text-white whitespace-nowrap">
                {activePairAnalysis.symbolA} / {activePairAnalysis.symbolB}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-zinc-300">
                  <span className="uppercase font-bold">PAIR:</span>
                  <span className="relative inline-flex items-center">
                    <select
                      aria-label="First security in pair"
                      value={activePair[0]}
                      onChange={(e) => {
                        const nextA = e.target.value;
                        const nextB =
                          nextA === activePair[1]
                            ? selectedSymbols.find((s) => s !== nextA) || activePair[1]
                            : activePair[1];
                        setActivePair([nextA, nextB]);
                      }}
                      className="appearance-none bg-black border border-[#333] focus:border-[#ff9900] rounded pl-2 pr-7 py-1 text-[#3498db] font-bold outline-none cursor-pointer"
                    >
                      {selectedSymbols.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={12}
                      aria-hidden="true"
                      className="pointer-events-none absolute right-2 text-[#3498db]"
                    />
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => setActivePair([activePair[1], activePair[0]])}
                  title="Swap pair axes"
                  aria-label="Swap pair securities"
                  className="p-1 rounded bg-[#0c0c0c] border border-[#333] hover:border-[#ff9900] text-zinc-300 hover:text-white cursor-pointer"
                >
                  <ArrowLeftRight size={12} />
                </button>

                <span className="relative inline-flex items-center">
                  <select
                    aria-label="Second security in pair"
                    value={activePair[1]}
                    onChange={(e) => {
                      const nextB = e.target.value;
                      const nextA =
                        nextB === activePair[0]
                          ? selectedSymbols.find((s) => s !== nextB) || activePair[0]
                          : activePair[0];
                      setActivePair([nextA, nextB]);
                    }}
                    className="appearance-none bg-black border border-[#333] focus:border-[#ff9900] rounded pl-2 pr-7 py-1 text-[#3498db] font-bold outline-none cursor-pointer"
                  >
                    {selectedSymbols.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={12}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2 text-[#3498db]"
                  />
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Rolling window observations">
              <span className="inline-flex items-center gap-1 text-zinc-300 uppercase font-bold mr-0.5">
                <span>ROLLING WINDOW</span>
                <InfoTooltipIcon
                  label="Rolling window explanation"
                  title="ROLLING WINDOW"
                  content={CORR_TOOLTIPS.rollingWindow}
                />
              </span>
              {ROLLING_WINDOW_OPTIONS.map((win) => (
                <button
                  key={win}
                  type="button"
                  onClick={() => setRollingWindow(win)}
                  aria-pressed={rollingWindow === win}
                  className={`px-2 py-1 rounded border font-bold uppercase cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                    rollingWindow === win
                      ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                      : 'bg-[#0a0a0a] border-[#3a3a3a] text-zinc-300 hover:text-white'
                  }`}
                >
                  {win} OBS
                </button>
              ))}
            </div>
          </div>

          {/* Pairwise Unavailable Notice */}
          {activePairAnalysis.unavailableReason && !anyLoading && (
            <div className="bg-amber-950/20 border border-amber-700/50 rounded p-3 text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-400" />
              <span>{activePairAnalysis.unavailableReason}</span>
            </div>
          )}

          {/* Pairwise KPI Summary Strip (flat hairline dividers, tabular-nums) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="bg-[#080808] border border-[#3a3a3a] rounded p-2.5">
              <div className="flex items-center justify-between gap-1 text-xs text-zinc-300 uppercase font-bold">
                <span>PEARSON CORRELATION</span>
                <InfoTooltipIcon
                  label="Pearson correlation explanation"
                  title="CORRELATION COEFFICIENT"
                  content={CORR_TOOLTIPS.correlationCoefficient}
                />
              </div>
              <div
                className={`text-lg font-extrabold tabular-nums mt-0.5 ${getInterpretationTextClass(
                  activePairAnalysis.interpretation.id
                )}`}
              >
                {formatCorrelationValue(activePairAnalysis.correlation)}
              </div>
              <div className="text-xs text-zinc-300">{activePairAnalysis.lookbackLabel} daily</div>
            </div>

            <div className="bg-[#080808] border border-[#3a3a3a] rounded p-2.5">
              <div className="flex items-center justify-between gap-1 text-xs text-zinc-300 uppercase font-bold">
                <span>INTERPRETATION</span>
              </div>
              <div
                className={`text-xs font-bold mt-1 leading-snug ${getInterpretationTextClass(
                  activePairAnalysis.interpretation.id
                )}`}
              >
                {activePairAnalysis.interpretation.label}
              </div>
              <div className="text-xs text-zinc-300 tabular-nums">
                {activePairAnalysis.interpretation.rangeLabel}
              </div>
            </div>

            <div className="bg-[#080808] border border-[#3a3a3a] rounded p-2.5">
              <div className="flex items-center justify-between gap-1 text-xs text-zinc-300 uppercase font-bold">
                <span>SAME-DIRECTION SESSIONS</span>
                <InfoTooltipIcon
                  label="Same-direction sessions explanation"
                  title="SAME-DIRECTION SESSIONS"
                  content={CORR_TOOLTIPS.sameDirectionSessions}
                />
              </div>
              <div className="text-lg font-extrabold text-zinc-100 tabular-nums mt-0.5">
                {activePairAnalysis.sameDirectionPct !== null
                  ? `${activePairAnalysis.sameDirectionPct.toFixed(1)}%`
                  : '—'}
              </div>
              <div className="text-xs text-zinc-300 tabular-nums">
                {activePairAnalysis.observationCount > 0
                  ? `${activePairAnalysis.sameDirectionCount} of ${activePairAnalysis.observationCount} sessions`
                  : 'No overlapping data'}
              </div>
            </div>

            <div className="bg-[#080808] border border-[#3a3a3a] rounded p-2.5">
              <div className="flex items-center justify-between gap-1 text-xs text-zinc-300 uppercase font-bold">
                <span>OVERLAPPING OBSERVATIONS</span>
                <InfoTooltipIcon
                  label="Overlapping observations explanation"
                  title="OVERLAPPING OBSERVATIONS"
                  content={CORR_TOOLTIPS.overlappingObservations}
                />
              </div>
              <div className="text-lg font-extrabold text-zinc-100 tabular-nums mt-0.5">
                {activePairAnalysis.observationCount}
              </div>
              <div className="text-xs text-zinc-300 tabular-nums">
                {activePairAnalysis.startDate && activePairAnalysis.endDate
                  ? `${formatShortIsoDate(activePairAnalysis.startDate)} – ${formatShortIsoDate(
                      activePairAnalysis.endDate
                    )}`
                  : '—'}
              </div>
            </div>

            <div className="bg-[#080808] border border-[#3a3a3a] rounded p-2.5 col-span-2 md:col-span-1">
              <div className="flex items-center justify-between gap-1 text-xs text-zinc-300 uppercase font-bold">
                <span>LATEST {rollingWindow}D ROLLING</span>
              </div>
              <div className="text-lg font-extrabold text-[#ff9900] tabular-nums mt-0.5">
                {activePairAnalysis.rollingSeries.length > 0
                  ? formatCorrelationValue(
                      activePairAnalysis.rollingSeries[activePairAnalysis.rollingSeries.length - 1]
                        .correlation
                    )
                  : '—'}
              </div>
              <div className="text-xs text-zinc-300 tabular-nums">
                {activePairAnalysis.rollingSeries.length > 0
                  ? `${activePairAnalysis.rollingSeries.length} rolling pts`
                  : 'Insufficient history'}
              </div>
            </div>
          </div>

          {/* Rolling Correlation Chart (full width inside Pairwise section) */}
          <div className="space-y-1.5 w-full min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <h3 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                  ROLLING CORRELATION
                </h3>
                <InfoTooltipIcon
                  label="Rolling correlation explanation"
                  title="ROLLING CORRELATION"
                  content={CORR_TOOLTIPS.rollingCorrelation}
                />
              </div>
              <span className="text-zinc-300 uppercase tabular-nums">
                {rollingWindow} OBS · {lookbackCfg.label.toUpperCase()}
              </span>
            </div>
            <RollingCorrelationChart
              symbolA={activePairAnalysis.symbolA}
              symbolB={activePairAnalysis.symbolB}
              series={activePairAnalysis.rollingSeries}
              rollingWindow={activePairAnalysis.rollingWindow}
              unavailableReason={activePairAnalysis.rollingUnavailableReason}
            />
          </div>

          {/* 2-Column Analytical Pair Charts: Normalized Performance + Return Distribution */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
            <div className="space-y-1.5 flex flex-col min-w-0 w-full">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                    NORMALIZED PERFORMANCE
                  </h3>
                  <InfoTooltipIcon
                    label="Normalized performance explanation"
                    title="NORMALIZED PERFORMANCE"
                    content={CORR_TOOLTIPS.normalizedPerformance}
                  />
                </div>
                <span className="inline-flex items-center gap-1 text-zinc-300 uppercase font-bold">
                  <span>BASE 100</span>
                </span>
              </div>
              <NormalizedPerformanceChart
                symbolA={activePairAnalysis.symbolA}
                symbolB={activePairAnalysis.symbolB}
                series={activePairAnalysis.normalizedSeries}
              />
            </div>

            <div className="space-y-1.5 flex flex-col min-w-0 w-full">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                    RETURN DISTRIBUTION
                  </h3>
                  <InfoTooltipIcon
                    label="Return distribution scatter plot explanation"
                    title="RETURN DISTRIBUTION"
                    content={CORR_TOOLTIPS.returnDistribution}
                  />
                </div>
                <span className="inline-flex items-center gap-1 text-zinc-300 uppercase font-bold">
                  <span className="inline-block w-3 h-0.5 bg-[#ff9900]" aria-hidden="true" />
                  <span>OLS REGRESSION</span>
                </span>
              </div>
              <DailyReturnScatterPlot
                symbolA={activePairAnalysis.symbolA}
                symbolB={activePairAnalysis.symbolB}
                points={activePairAnalysis.scatterPoints}
                regressionLine={activePairAnalysis.regressionLine}
                correlation={activePairAnalysis.correlation}
              />
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
       * F. RULE-BASED CORRELATION INSIGHTS
       * ==================================================================== */}
      {selectedSymbols.length >= 2 && (
        <div className="bg-[#050505] border border-[#333] rounded p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3a3a3a] pb-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-xs text-[#ff9900] font-bold uppercase tracking-wider">
                CORRELATION INSIGHTS
              </h2>
              <InfoTooltipIcon
                label="Correlation insights explanation"
                title="CORRELATION INSIGHTS"
                content={CORR_TOOLTIPS.correlationInsights}
              />
            </div>
          </div>

          {anyLoading && insights.length === 0 ? (
            <div className="py-4 text-xs text-zinc-300">
              Computing observations from historical returns...
            </div>
          ) : insights.length === 0 ? (
            <div className="py-4 text-xs text-zinc-300">
              No notable correlation observations for the current selection and lookback period.
            </div>
          ) : (
            <div className="divide-y divide-[#1d1d1d]">
              {insights.map((item) => (
                <InsightRow
                  key={item.id}
                  item={item}
                  onPopulateTicker={handlePopulateTickerInput}
                />
              ))}
            </div>
          )}

          <div className="pt-2.5 border-t border-[#2e2e2e] text-xs text-zinc-300 leading-relaxed max-w-3xl">
            Correlation does not establish causation, does not predict future performance, and low historical correlation does not guarantee diversification during future market stress.
          </div>
        </div>
      )}
    </div>
  );
}

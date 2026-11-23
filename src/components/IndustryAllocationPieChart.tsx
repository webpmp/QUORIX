import React, { useMemo, useState } from 'react';
import type { IndustryAllocationRow } from '../utils/portfolioRiskEngine';

export const INDUSTRY_PIE_COLORS = [
  '#ff9900',
  '#3498db',
  '#10b981',
  '#a855f7',
  '#06b6d4',
  '#f43f5e',
  '#eab308',
  '#6366f1',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#fb923c',
] as const;

const UNCLASSIFIED_PIE_COLORS = ['#64748b', '#71717a', '#475569'] as const;

export interface IndustryPieSlice {
  key: string;
  industry: string;
  sector: string;
  isClassified: boolean;
  marketValue: number;
  portfolioWeightPct: number;
  holdingCount: number;
  tickers: string[];
  color: string;
  /** Fraction of the pie circle (0..1), proportional to portfolioWeightPct */
  sliceFraction: number;
  startAngleDeg: number;
  endAngleDeg: number;
  midAngleDeg: number;
  sweepAngleDeg: number;
  isFullCircle: boolean;
  pathD: string;
  labelX: number;
  labelY: number;
  showInlineLabel: boolean;
  /** Outward offset along slice bisector for hover/focus highlight */
  hoverOffsetX: number;
  hoverOffsetY: number;
}

const PIE_SIZE = 220;
const PIE_CX = PIE_SIZE / 2;
const PIE_CY = PIE_SIZE / 2;
const PIE_RADIUS = 94;
const INLINE_LABEL_RADIUS = 60;
const HOVER_OFFSET = 5;
const MIN_LABEL_SWEEP_DEG = 28;

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function describePieWedge(
  cx: number,
  cy: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number
): string {
  const start = polarToCartesian(cx, cy, radius, startAngleDeg);
  const end = polarToCartesian(cx, cy, radius, endAngleDeg);
  const largeArcFlag = endAngleDeg - startAngleDeg > 180 ? 1 : 0;
  return [
    `M ${cx.toFixed(2)} ${cy.toFixed(2)}`,
    `L ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function formatUsdFull(val: number): string {
  if (!Number.isFinite(val)) return '—';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getIndustryColorMap(industries: IndustryAllocationRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  let classifiedIdx = 0;
  let unclassifiedIdx = 0;

  for (const ind of industries) {
    const key = `${ind.sector}::${ind.industry}`;
    if (ind.isClassified) {
      map[key] = INDUSTRY_PIE_COLORS[classifiedIdx % INDUSTRY_PIE_COLORS.length];
      classifiedIdx += 1;
    } else {
      map[key] = UNCLASSIFIED_PIE_COLORS[unclassifiedIdx % UNCLASSIFIED_PIE_COLORS.length];
      unclassifiedIdx += 1;
    }
  }
  return map;
}

/**
 * Pure helper building SVG pie geometry directly from the IndustryAllocationRow[]
 * dataset used by the Industry Allocation Breakdown table.
 */
export function buildIndustryPieSlices(
  industries: IndustryAllocationRow[],
  colorMap?: Record<string, string>
): IndustryPieSlice[] {
  const positiveRows = industries.filter(
    (ind) => Number.isFinite(ind.portfolioWeightPct) && ind.portfolioWeightPct > 0
  );
  if (positiveRows.length === 0) return [];

  const resolvedColors = colorMap ?? getIndustryColorMap(industries);
  const totalWeightPct = positiveRows.reduce((sum, ind) => sum + ind.portfolioWeightPct, 0);
  if (totalWeightPct <= 0) return [];

  let cursorDeg = -90;
  const isSingle = positiveRows.length === 1;

  return positiveRows.map((ind) => {
    const key = `${ind.sector}::${ind.industry}`;
    const sliceFraction = ind.portfolioWeightPct / totalWeightPct;
    const sweepAngleDeg = isSingle ? 360 : sliceFraction * 360;
    const startAngleDeg = cursorDeg;
    const endAngleDeg = startAngleDeg + sweepAngleDeg;
    const midAngleDeg = startAngleDeg + sweepAngleDeg / 2;
    cursorDeg = endAngleDeg;

    const labelPt = isSingle
      ? { x: PIE_CX, y: PIE_CY }
      : polarToCartesian(PIE_CX, PIE_CY, INLINE_LABEL_RADIUS, midAngleDeg);

    const midRad = (midAngleDeg * Math.PI) / 180;
    const hoverOffsetX = isSingle ? 0 : Math.cos(midRad) * HOVER_OFFSET;
    const hoverOffsetY = isSingle ? 0 : Math.sin(midRad) * HOVER_OFFSET;

    return {
      key,
      industry: ind.industry,
      sector: ind.sector,
      isClassified: ind.isClassified,
      marketValue: ind.marketValue,
      portfolioWeightPct: ind.portfolioWeightPct,
      holdingCount: ind.holdingCount,
      tickers: ind.tickers,
      color: resolvedColors[key] ?? INDUSTRY_PIE_COLORS[0],
      sliceFraction,
      startAngleDeg,
      endAngleDeg,
      midAngleDeg,
      sweepAngleDeg,
      isFullCircle: isSingle,
      pathD: isSingle ? '' : describePieWedge(PIE_CX, PIE_CY, PIE_RADIUS, startAngleDeg, endAngleDeg),
      labelX: labelPt.x,
      labelY: labelPt.y,
      showInlineLabel: isSingle || sweepAngleDeg >= MIN_LABEL_SWEEP_DEG,
      hoverOffsetX,
      hoverOffsetY,
    };
  });
}

export interface IndustryAllocationPieChartProps {
  industries: IndustryAllocationRow[];
  colorMap?: Record<string, string>;
  cashWeightPct?: number;
}

function getContrastLabelColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.54 ? '#050505' : '#ffffff';
}

export const IndustryAllocationPieChart: React.FC<IndustryAllocationPieChartProps> = ({
  industries,
  colorMap,
}) => {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const slices = useMemo(
    () => buildIndustryPieSlices(industries, colorMap),
    [industries, colorMap]
  );

  const activeSlice = useMemo(
    () => (activeKey ? slices.find((s) => s.key === activeKey) ?? null : null),
    [activeKey, slices]
  );

  if (slices.length === 0) {
    return null;
  }

  return (
    <div
      className="flex justify-center py-3 border-b border-prm-divider"
      data-testid="industry-pie-chart-container"
    >
      {/* Centered Pie Chart SVG + Hover/Tap/Focus Tooltip */}
      <div className="relative shrink-0 w-[200px] h-[200px] sm:w-[220px] sm:h-[220px]">
        <svg
          viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}
          className="w-full h-full block overflow-visible select-none"
          role="img"
          aria-label={`Industry allocation pie chart across ${slices.length} ${
            slices.length === 1 ? 'industry' : 'industries'
          }`}
        >
          {slices.map((slice) => {
            const isHovered = activeKey === slice.key;
            const isDimmed = activeKey !== null && !isHovered;
            const titleText = `${slice.industry} (${slice.sector}): ${slice.portfolioWeightPct.toFixed(
              1
            )}% · ${formatUsdFull(slice.marketValue)}`;

            return (
              <g
                key={slice.key}
                transform={
                  isHovered
                    ? `translate(${slice.hoverOffsetX.toFixed(2)}, ${slice.hoverOffsetY.toFixed(2)})`
                    : undefined
                }
                className={`transition-all duration-150 ease-out cursor-pointer outline-none ${
                  isDimmed ? 'opacity-55' : 'opacity-100'
                }`}
                tabIndex={0}
                role="button"
                aria-label={titleText}
                onMouseEnter={() => setActiveKey(slice.key)}
                onMouseLeave={() => setActiveKey((prev) => (prev === slice.key ? null : prev))}
                onFocus={() => setActiveKey(slice.key)}
                onBlur={() => setActiveKey((prev) => (prev === slice.key ? null : prev))}
                onClick={() => setActiveKey((prev) => (prev === slice.key ? null : slice.key))}
              >
                {slice.isFullCircle ? (
                  <circle
                    cx={PIE_CX}
                    cy={PIE_CY}
                    r={PIE_RADIUS}
                    fill={slice.color}
                    stroke={isHovered ? '#ffffff' : '#050505'}
                    strokeWidth={isHovered ? 2 : 1.5}
                  >
                    <title>{titleText}</title>
                  </circle>
                ) : (
                  <path
                    d={slice.pathD}
                    fill={slice.color}
                    stroke={isHovered ? '#ffffff' : '#050505'}
                    strokeWidth={isHovered ? 2 : 1.5}
                    strokeLinejoin="round"
                  >
                    <title>{titleText}</title>
                  </path>
                )}

                {slice.showInlineLabel && (
                  <text
                    x={slice.labelX}
                    y={slice.labelY}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={getContrastLabelColor(slice.color)}
                    fontSize="12"
                    fontWeight="800"
                    className="pointer-events-none select-none font-mono"
                  >
                    {slice.portfolioWeightPct.toFixed(1)}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Interactive Hover / Focus / Tap Tooltip */}
        {activeSlice && (
          <div
            role="tooltip"
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-20 w-64 max-w-[calc(100vw-3rem)] bg-[#0a0a0a] border border-prm-border rounded px-3 py-2.5 shadow-2xl shadow-black/95 text-prm-label leading-snug"
          >
            <div className="flex items-start gap-1.5 font-bold text-white text-prm-body">
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                className="shrink-0 mt-1"
                aria-hidden="true"
              >
                <rect width="10" height="10" rx="2" fill={activeSlice.color} />
              </svg>
              <span className="break-words">{activeSlice.industry}</span>
            </div>
            <div className="text-prm-label text-zinc-300 uppercase mt-0.5">
              {activeSlice.sector}
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-prm-divider grid grid-cols-2 gap-2 tabular-nums">
              <div>
                <div className="text-prm-label text-zinc-300 uppercase">Weight</div>
                <div className="text-prm-body text-white font-bold">
                  {activeSlice.portfolioWeightPct.toFixed(1)}%
                </div>
              </div>
              <div className="text-right">
                <div className="text-prm-label text-zinc-300 uppercase">Market Value</div>
                <div className="text-prm-body text-zinc-100 font-bold">
                  {formatUsdFull(activeSlice.marketValue)}
                </div>
              </div>
            </div>
            <div className="mt-1 text-prm-label text-[#3498db] font-bold truncate">
              {activeSlice.tickers.join(', ')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default IndustryAllocationPieChart;

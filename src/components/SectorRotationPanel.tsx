import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  Building2,
  ExternalLink,
  Info,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import type {
  InstitutionalPositionChangeRow,
  SectorId,
  SectorInsiderSentimentStatus,
  SectorInstitutionalTrend,
  SectorPerformancePeriod,
  SectorPriceHistoryPoint,
  SectorRotationItem,
  SectorRotationResponse,
  SectorRotationStatus,
} from '../types';
import {
  formatCompactShares,
  formatCompactUsd,
  formatIsoDateShort,
  formatQuarterLabel,
  formatSignedPercent,
} from '../utils/institutionalActivity';

interface SectorRotationPanelProps {
  data: SectorRotationResponse | null;
  loading: boolean;
  error: string | null;
  windowDays: number;
  onWindowDaysChange: (days: number) => void;
  onRefresh: () => void;
  onInspectSecurity: (security: { ticker?: string | null; cusip?: string; issuerName?: string }) => void;
  onInspectInvestor: (cik: string) => void;
  onSelectEtfTicker?: (ticker: string) => void;
}

type TableSortField =
  | 'name'
  | 'etfTicker'
  | 'latestPrice'
  | '1W'
  | '1M'
  | '3M'
  | '6M'
  | 'relativeStrength'
  | 'institutionalTrend'
  | 'insiderSentiment'
  | 'rotationStatus';

type DetailActivityTab = 'INCREASES' | 'DECREASES' | 'NEW' | 'EXITS' | 'HOLDINGS';

const PERIODS: SectorPerformancePeriod[] = ['1W', '1M', '3M', '6M'];
const INSIDER_WINDOWS = [30, 90, 180] as const;

function getSafeExternalUrl(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

function formatPrice(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return `$${val.toFixed(2)}`;
}

function formatReturnCell(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

function getReturnColorClass(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'text-zinc-500';
  if (val > 0.005) return 'text-[#00ff00]';
  if (val < -0.005) return 'text-[#ff4444]';
  return 'text-zinc-300';
}

function getRotationBadgeMeta(status: SectorRotationStatus): { label: string; cls: string; rank: number } {
  switch (status) {
    case 'LEADING':
      return {
        label: 'LEADING',
        cls: 'text-[#00ff00] border-[#00ff00]/45 bg-[#00ff00]/10',
        rank: 4,
      };
    case 'IMPROVING':
      return {
        label: 'IMPROVING',
        cls: 'text-[#3498db] border-[#3498db]/45 bg-[#3498db]/10',
        rank: 3,
      };
    case 'WEAKENING':
      return {
        label: 'WEAKENING',
        cls: 'text-amber-400 border-amber-500/45 bg-amber-950/35',
        rank: 2,
      };
    case 'LAGGING':
      return {
        label: 'LAGGING',
        cls: 'text-[#ff4444] border-[#ff4444]/45 bg-[#ff4444]/10',
        rank: 1,
      };
    case 'INSUFFICIENT_DATA':
    default:
      return {
        label: 'N/A',
        cls: 'text-zinc-500 border-zinc-800 bg-zinc-950',
        rank: 0,
      };
  }
}

function getInstitutionalBadgeMeta(trend: SectorInstitutionalTrend): { label: string; cls: string; rank: number } {
  switch (trend) {
    case 'ACCUMULATING':
      return {
        label: 'ACCUMULATING',
        cls: 'text-emerald-400 border-emerald-500/40 bg-emerald-950/35',
        rank: 3,
      };
    case 'NEUTRAL':
      return {
        label: 'NEUTRAL',
        cls: 'text-zinc-300 border-zinc-700 bg-zinc-900/50',
        rank: 2,
      };
    case 'DISTRIBUTING':
      return {
        label: 'DISTRIBUTING',
        cls: 'text-amber-400 border-amber-500/40 bg-amber-950/35',
        rank: 1,
      };
    case 'INSUFFICIENT_DATA':
    default:
      return {
        label: 'UNAVAILABLE',
        cls: 'text-zinc-500 border-zinc-800 bg-zinc-950',
        rank: 0,
      };
  }
}

function getInsiderBadgeMeta(sentiment: SectorInsiderSentimentStatus): { label: string; cls: string; rank: number } {
  switch (sentiment) {
    case 'NET_BUYING':
      return {
        label: 'NET BUYING',
        cls: 'text-[#00ff00] border-[#00ff00]/40 bg-[#00ff00]/10',
        rank: 3,
      };
    case 'BALANCED':
      return {
        label: 'BALANCED',
        cls: 'text-[#3498db] border-[#3498db]/40 bg-[#3498db]/10',
        rank: 2,
      };
    case 'NET_SELLING':
      return {
        label: 'NET SELLING',
        cls: 'text-[#ff4444] border-[#ff4444]/40 bg-[#ff4444]/10',
        rank: 1,
      };
    case 'UNAVAILABLE':
    default:
      return {
        label: 'UNAVAILABLE',
        cls: 'text-zinc-500 border-zinc-800 bg-zinc-950',
        rank: 0,
      };
  }
}

interface NormalizedSeriesPoint {
  date: string;
  sectorPct: number;
  spyPct: number | null;
  sectorClose: number;
  spyClose: number | null;
}

function buildNormalizedComparisonSeries(
  sectorBars: SectorPriceHistoryPoint[],
  spyBars: SectorPriceHistoryPoint[],
  startDate: string | null
): NormalizedSeriesPoint[] {
  if (!sectorBars.length || !startDate) return [];
  const filteredSector = sectorBars.filter((b) => b.date >= startDate);
  if (filteredSector.length < 2) return [];

  const spyMap = new Map<string, number>();
  for (const b of spyBars) {
    spyMap.set(b.date, b.close);
  }

  const baseSector = filteredSector[0].close;
  if (!Number.isFinite(baseSector) || baseSector <= 0) return [];

  // Find anchor SPY close on or closest before first sector bar date
  let baseSpy: number | null = spyMap.get(filteredSector[0].date) ?? null;
  if (baseSpy === null) {
    for (let i = spyBars.length - 1; i >= 0; i--) {
      if (spyBars[i].date <= filteredSector[0].date) {
        baseSpy = spyBars[i].close;
        break;
      }
    }
  }

  return filteredSector.map((bar) => {
    const spyClose = spyMap.get(bar.date) ?? null;
    const sectorPct = ((bar.close - baseSector) / baseSector) * 100;
    const spyPct =
      spyClose !== null && baseSpy !== null && baseSpy > 0
        ? ((spyClose - baseSpy) / baseSpy) * 100
        : null;
    return {
      date: bar.date,
      sectorPct,
      spyPct,
      sectorClose: bar.close,
      spyClose,
    };
  });
}

const SectorComparisonChart: React.FC<{
  sectorTicker: string;
  sectorBars: SectorPriceHistoryPoint[];
  spyBars: SectorPriceHistoryPoint[];
  startDate: string | null;
  period: SectorPerformancePeriod;
}> = ({ sectorTicker, sectorBars, spyBars, startDate, period }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const series = useMemo(
    () => buildNormalizedComparisonSeries(sectorBars, spyBars, startDate),
    [sectorBars, spyBars, startDate]
  );

  if (series.length < 2) {
    return (
      <div className="h-[220px] flex items-center justify-center bg-[#060606] border border-[#222] rounded text-zinc-500 text-[11px]">
        Insufficient historical daily bars for {sectorTicker} vs SPY ({period}).
      </div>
    );
  }

  const width = 620;
  const height = 210;
  const padLeft = 46;
  const padRight = 14;
  const padTop = 16;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  let minVal = 0;
  let maxVal = 0;
  for (const pt of series) {
    if (pt.sectorPct < minVal) minVal = pt.sectorPct;
    if (pt.sectorPct > maxVal) maxVal = pt.sectorPct;
    if (pt.spyPct !== null) {
      if (pt.spyPct < minVal) minVal = pt.spyPct;
      if (pt.spyPct > maxVal) maxVal = pt.spyPct;
    }
  }
  const range = Math.max(1, maxVal - minVal);
  const yMin = minVal - range * 0.12;
  const yMax = maxVal + range * 0.12;

  const xFor = (idx: number) =>
    padLeft + (idx / Math.max(1, series.length - 1)) * plotW;
  const yFor = (val: number) =>
    padTop + ((yMax - val) / Math.max(0.0001, yMax - yMin)) * plotH;

  const sectorPath = series
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(pt.sectorPct).toFixed(1)}`)
    .join(' ');

  const spyPath = series
    .filter((pt) => pt.spyPct !== null)
    .map((pt, idx) => {
      const origIdx = series.indexOf(pt);
      return `${idx === 0 ? 'M' : 'L'}${xFor(origIdx).toFixed(1)},${yFor(pt.spyPct!).toFixed(1)}`;
    })
    .join(' ');

  const zeroY = yFor(0);
  const midIdx = Math.floor(series.length / 2);
  const activePoint = hoverIdx !== null && series[hoverIdx] ? series[hoverIdx] : series[series.length - 1];
  const activeSpread =
    activePoint.spyPct !== null ? activePoint.sectorPct - activePoint.spyPct : null;

  const yTicks = [yMax, (yMax + yMin) / 2, yMin];

  return (
    <div className="bg-[#060606] border border-[#222] rounded p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-bold text-[#ff9900]">
            <span className="w-2.5 h-0.5 bg-[#ff9900] inline-block" />
            {sectorTicker}: {formatReturnCell(activePoint.sectorPct)}
          </span>
          <span className="inline-flex items-center gap-1.5 font-bold text-[#3498db]">
            <span className="w-2.5 h-0.5 bg-[#3498db] inline-block" />
            SPY: {formatReturnCell(activePoint.spyPct)}
          </span>
          {activeSpread !== null && (
            <span className={`font-bold tabular-nums ${getReturnColorClass(activeSpread)}`}>
              RS: {formatReturnCell(activeSpread)}
            </span>
          )}
        </div>
        <span className="text-zinc-500 tabular-nums">
          {activePoint.date} • {period} NORMALIZED (%)
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[185px] select-none overflow-visible"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          const relX = ((e.clientX - rect.left) / rect.width) * width;
          const norm = Math.max(0, Math.min(1, (relX - padLeft) / plotW));
          const idx = Math.round(norm * (series.length - 1));
          setHoverIdx(idx);
        }}
      >
        {/* Horizontal grid lines */}
        {yTicks.map((tick, idx) => {
          const y = yFor(tick);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#1c1c1c"
                strokeWidth="1"
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                fill="#71717a"
                fontSize="9"
                fontFamily="monospace"
              >
                {tick > 0 ? `+${tick.toFixed(1)}%` : `${tick.toFixed(1)}%`}
              </text>
            </g>
          );
        })}

        {/* Zero baseline */}
        {zeroY >= padTop && zeroY <= height - padBottom && (
          <line
            x1={padLeft}
            y1={zeroY}
            x2={width - padRight}
            y2={zeroY}
            stroke="#3f3f46"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
        )}

        {/* SPY Benchmark Line */}
        {spyPath && (
          <path d={spyPath} fill="none" stroke="#3498db" strokeWidth="1.6" strokeOpacity="0.9" />
        )}

        {/* Sector ETF Line */}
        <path d={sectorPath} fill="none" stroke="#ff9900" strokeWidth="2.1" />

        {/* Hover crosshair */}
        {hoverIdx !== null && series[hoverIdx] && (
          <g>
            <line
              x1={xFor(hoverIdx)}
              y1={padTop}
              x2={xFor(hoverIdx)}
              y2={height - padBottom}
              stroke="#52525b"
              strokeDasharray="2 2"
              strokeWidth="1"
            />
            <circle
              cx={xFor(hoverIdx)}
              cy={yFor(series[hoverIdx].sectorPct)}
              r="3.2"
              fill="#ff9900"
              stroke="#000"
              strokeWidth="1"
            />
            {series[hoverIdx].spyPct !== null && (
              <circle
                cx={xFor(hoverIdx)}
                cy={yFor(series[hoverIdx].spyPct!)}
                r="2.8"
                fill="#3498db"
                stroke="#000"
                strokeWidth="1"
              />
            )}
          </g>
        )}

        {/* X axis date labels */}
        <text x={padLeft} y={height - 6} textAnchor="start" fill="#71717a" fontSize="9" fontFamily="monospace">
          {series[0].date}
        </text>
        <text
          x={xFor(midIdx)}
          y={height - 6}
          textAnchor="middle"
          fill="#71717a"
          fontSize="9"
          fontFamily="monospace"
        >
          {series[midIdx].date}
        </text>
        <text
          x={width - padRight}
          y={height - 6}
          textAnchor="end"
          fill="#71717a"
          fontSize="9"
          fontFamily="monospace"
        >
          {series[series.length - 1].date}
        </text>
      </svg>
    </div>
  );
};

export default function SectorRotationPanel({
  data,
  loading,
  error,
  windowDays,
  onWindowDaysChange,
  onRefresh,
  onInspectSecurity,
  onInspectInvestor,
  onSelectEtfTicker,
}: SectorRotationPanelProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<SectorPerformancePeriod>('3M');
  const [sortField, setSortField] = useState<TableSortField>('relativeStrength');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedSectorId, setSelectedSectorId] = useState<SectorId | null>(null);
  const [detailActivityTab, setDetailActivityTab] = useState<DetailActivityTab>('INCREASES');

  const handleSortClick = (field: TableSortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir(field === 'name' || field === 'etfTicker' ? 'asc' : 'desc');
    }
  };

  const sortedSectors = useMemo(() => {
    if (!data?.sectors) return [];
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...data.sectors].sort((a, b) => {
      switch (sortField) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'etfTicker':
          return a.etfTicker.localeCompare(b.etfTicker) * dir;
        case 'latestPrice':
          return ((a.market.latestPrice ?? -Infinity) - (b.market.latestPrice ?? -Infinity)) * dir;
        case '1W':
        case '1M':
        case '3M':
        case '6M':
          return (
            ((a.market.returns[sortField].returnPct ?? -Infinity) -
              (b.market.returns[sortField].returnPct ?? -Infinity)) *
            dir
          );
        case 'institutionalTrend': {
          const rankDiff =
            (getInstitutionalBadgeMeta(a.institutional.trend).rank -
              getInstitutionalBadgeMeta(b.institutional.trend).rank) *
            dir;
          if (rankDiff !== 0) return rankDiff;
          return ((a.institutional.netPercentChange ?? -Infinity) - (b.institutional.netPercentChange ?? -Infinity)) * dir;
        }
        case 'insiderSentiment': {
          const rankDiff =
            (getInsiderBadgeMeta(a.insider.sentiment).rank -
              getInsiderBadgeMeta(b.insider.sentiment).rank) *
            dir;
          if (rankDiff !== 0) return rankDiff;
          return ((a.insider.buySellRatio ?? -Infinity) - (b.insider.buySellRatio ?? -Infinity)) * dir;
        }
        case 'rotationStatus': {
          const rankDiff =
            (getRotationBadgeMeta(a.market.rotationStatus[selectedPeriod]).rank -
              getRotationBadgeMeta(b.market.rotationStatus[selectedPeriod]).rank) *
            dir;
          if (rankDiff !== 0) return rankDiff;
          return (
            ((a.market.relativeStrength[selectedPeriod] ?? -Infinity) -
              (b.market.relativeStrength[selectedPeriod] ?? -Infinity)) *
            dir
          );
        }
        case 'relativeStrength':
        default:
          return (
            ((a.market.relativeStrength[selectedPeriod] ?? -Infinity) -
              (b.market.relativeStrength[selectedPeriod] ?? -Infinity)) *
            dir
          );
      }
    });
  }, [data, sortField, sortDir, selectedPeriod]);

  const selectedSector: SectorRotationItem | null = useMemo(() => {
    if (!selectedSectorId || !data?.sectors) return null;
    return data.sectors.find((s) => s.id === selectedSectorId) || null;
  }, [selectedSectorId, data]);

  const activeOverview = data?.overviewByPeriod?.[selectedPeriod] || null;

  const openSectorDetail = (id: SectorId) => {
    setSelectedSectorId(id);
    setDetailActivityTab('INCREASES');
  };

  if (loading && !data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-black border border-[#222] rounded p-8">
        <div className="flex flex-col items-center gap-2 text-zinc-400">
          <RefreshCw size={18} className="animate-spin text-[#ff9900]" />
          <span className="text-[11px] uppercase tracking-wider font-bold">
            LOADING SECTOR ROTATION (SPDR ETFS, FORM 13F COHORT &amp; FORM 4 INSIDERS)...
          </span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-black border border-[#222] rounded p-6">
        <div className="max-w-lg w-full bg-[#0a0a0a] border border-red-900/50 rounded p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-[#ff4444] font-bold text-xs uppercase">
            <AlertCircle size={14} />
            <span>SECTOR ROTATION DATA UNAVAILABLE</span>
          </div>
          <p className="text-zinc-300 text-[11px] leading-relaxed">{error}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-1 bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-[10px] uppercase rounded cursor-pointer"
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const benchmarkReturn = data.benchmark.returns[selectedPeriod]?.returnPct ?? null;

  // =========================================================================
  // SECTOR DETAIL VIEW
  // =========================================================================
  if (selectedSector) {
    const rotMeta = getRotationBadgeMeta(selectedSector.market.rotationStatus[selectedPeriod]);
    const instMeta = getInstitutionalBadgeMeta(selectedSector.institutional.trend);
    const insMeta = getInsiderBadgeMeta(selectedSector.insider.sentiment);
    const activePeriodPoint = selectedSector.market.returns[selectedPeriod];
    const activeChangesRows: InstitutionalPositionChangeRow[] =
      detailActivityTab === 'INCREASES'
        ? selectedSector.institutional.largestIncreases
        : detailActivityTab === 'DECREASES'
        ? selectedSector.institutional.largestDecreases
        : detailActivityTab === 'NEW'
        ? selectedSector.institutional.recentNewPositions
        : detailActivityTab === 'EXITS'
        ? selectedSector.institutional.recentExits
        : [];

    const insiderBuyPct =
      selectedSector.insider.buySellRatio !== null
        ? Math.max(0, Math.min(100, selectedSector.insider.buySellRatio * 100))
        : null;

    return (
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
        {/* Detail Header Bar */}
        <div className="bg-black border border-[#2a2a2a] rounded p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setSelectedSectorId(null)}
              className="px-2.5 py-1 rounded bg-[#0c0c0c] border border-[#333] hover:border-[#ff9900] hover:text-[#ff9900] text-zinc-200 text-[10px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <ArrowLeft size={11} />
              <span>BACK TO SECTOR ROTATION</span>
            </button>
            <div className="h-4 w-px bg-[#2a2a2a] hidden sm:block" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-extrabold text-white uppercase tracking-wide">
                  {selectedSector.name}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-[#ff9900]/15 border border-[#ff9900]/50 text-[#ff9900] text-[10px] font-extrabold">
                  {selectedSector.etfTicker}
                </span>
                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-extrabold ${rotMeta.cls}`}>
                  {rotMeta.label}
                </span>
                {selectedSector.market.relativeStrengthRank[selectedPeriod] !== null && (
                  <span className="text-[10px] text-zinc-400 font-bold">
                    RS RANK #{selectedSector.market.relativeStrengthRank[selectedPeriod]}/11
                  </span>
                )}
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">
                {selectedSector.etfName} • LAST: {formatPrice(selectedSector.market.latestPrice)}
                {selectedSector.market.latestDate ? ` (${selectedSector.market.latestDate})` : ''}
              </div>
            </div>
          </div>

          {/* Period Switcher in Detail View */}
          <div className="flex items-center gap-1.5 shrink-0 select-none">
            <span className="text-[9px] text-zinc-500 font-bold uppercase">LOOKBACK:</span>
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSelectedPeriod(p)}
                className={`px-2 py-0.5 rounded text-[10px] font-extrabold border transition-colors cursor-pointer ${
                  selectedPeriod === p
                    ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                    : 'bg-[#0a0a0a] border-[#2a2a2a] text-zinc-400 hover:border-zinc-500 hover:text-zinc-100'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Row 1: Historical ETF vs SPY Chart + Multi-Period Performance Table */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <div className="xl:col-span-7">
            <SectorComparisonChart
              sectorTicker={selectedSector.etfTicker}
              sectorBars={selectedSector.market.history}
              spyBars={data.benchmark.history}
              startDate={activePeriodPoint?.startDate || null}
              period={selectedPeriod}
            />
          </div>

          <div className="xl:col-span-5 bg-black border border-[#222] rounded p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#ff9900]">
                  RELATIVE PERFORMANCE VS SPY
                </span>
                <span className="text-[9px] text-zinc-500 uppercase">DAILY CLOSING PRICES</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[11px] tabular-nums">
                  <thead>
                    <tr className="border-b border-[#222] text-[9px] text-zinc-500 uppercase">
                      <th className="py-1.5 pr-2">PERIOD</th>
                      <th className="py-1.5 px-2 text-right">{selectedSector.etfTicker}</th>
                      <th className="py-1.5 px-2 text-right">SPY</th>
                      <th className="py-1.5 px-2 text-right">REL STR</th>
                      <th className="py-1.5 px-2 text-right">RANK</th>
                      <th className="py-1.5 pl-2 text-right">STATUS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#151515]">
                    {PERIODS.map((p) => {
                      const secR = selectedSector.market.returns[p].returnPct;
                      const spyR = data.benchmark.returns[p].returnPct;
                      const rs = selectedSector.market.relativeStrength[p];
                      const rank = selectedSector.market.relativeStrengthRank[p];
                      const pStatus = getRotationBadgeMeta(selectedSector.market.rotationStatus[p]);
                      const isSel = p === selectedPeriod;
                      return (
                        <tr
                          key={p}
                          onClick={() => setSelectedPeriod(p)}
                          className={`cursor-pointer transition-colors ${
                            isSel ? 'bg-[#ff9900]/10' : 'hover:bg-[#0d0d0d]'
                          }`}
                        >
                          <td className="py-2 pr-2 font-bold text-zinc-200">{p}</td>
                          <td className={`py-2 px-2 text-right font-bold ${getReturnColorClass(secR)}`}>
                            {formatReturnCell(secR)}
                          </td>
                          <td className={`py-2 px-2 text-right ${getReturnColorClass(spyR)}`}>
                            {formatReturnCell(spyR)}
                          </td>
                          <td className={`py-2 px-2 text-right font-bold ${getReturnColorClass(rs)}`}>
                            {formatReturnCell(rs)}
                          </td>
                          <td className="py-2 px-2 text-right text-zinc-300">
                            {rank !== null ? `#${rank}` : '—'}
                          </td>
                          <td className="py-2 pl-2 text-right">
                            <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${pStatus.cls}`}>
                              {pStatus.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {activePeriodPoint?.startDate && activePeriodPoint?.endDate && (
              <div className="mt-2 pt-2 border-t border-[#1c1c1c] text-[10px] text-zinc-500 flex items-center justify-between">
                <span>
                  {selectedPeriod} WINDOW: {activePeriodPoint.startDate} → {activePeriodPoint.endDate}
                </span>
                <span className="tabular-nums">
                  {formatPrice(activePeriodPoint.startPrice)} → {formatPrice(activePeriodPoint.endPrice)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Institutional Positioning (13F) & Insider Activity (Form 4) — Strictly Separated */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Institutional 13F Card */}
          <div className="bg-black border border-[#222] rounded p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2 border-b border-[#1c1c1c] pb-2">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[#ff9900]">
                  <Building2 size={12} />
                  <span>INSTITUTIONAL POSITIONING (FORM 13F)</span>
                </div>
                <div className="text-[9px] text-zinc-500 mt-0.5">
                  DELAYED QUARTERLY 13F FILINGS • NOT REAL-TIME FLOWS
                  {selectedSector.institutional.previousPeriod && selectedSector.institutional.reportingPeriod
                    ? ` • ${formatQuarterLabel(selectedSector.institutional.previousPeriod)} → ${formatQuarterLabel(
                        selectedSector.institutional.reportingPeriod
                      )}`
                    : ''}
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded border text-[10px] font-extrabold shrink-0 ${instMeta.cls}`}>
                {instMeta.label}
              </span>
            </div>

            {!selectedSector.institutional.available ? (
              <div className="py-4 text-[11px] text-zinc-400">
                {data.institutionalMeta.error ||
                  'Institutional Form 13F positioning data is currently unavailable.'}
              </div>
            ) : selectedSector.institutional.classifiedSecuritiesCount === 0 ? (
              <div className="py-4 text-[11px] text-zinc-400">
                No classified securities in the current comparable 13F manager cohort mapped to {selectedSector.name}.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 tabular-nums">
                <div className="bg-[#080808] border border-[#1d1d1d] rounded p-2">
                  <div className="text-[9px] text-zinc-500 uppercase">MANAGERS INC / DEC</div>
                  <div className="text-xs font-bold mt-0.5">
                    <span className="text-[#00ff00]">↑{selectedSector.institutional.managersIncreasing}</span>
                    <span className="text-zinc-600 mx-1">/</span>
                    <span className="text-[#ff4444]">↓{selectedSector.institutional.managersDecreasing}</span>
                  </div>
                  <div className="text-[9px] text-zinc-500">
                    {selectedSector.institutional.activeManagersCount} active of{' '}
                    {selectedSector.institutional.comparableManagersTotal} cohort
                  </div>
                </div>

                <div className="bg-[#080808] border border-[#1d1d1d] rounded p-2">
                  <div className="text-[9px] text-zinc-500 uppercase">NET SHARE CHANGE</div>
                  <div
                    className={`text-xs font-bold mt-0.5 ${
                      selectedSector.institutional.netShareChange > 0
                        ? 'text-[#00ff00]'
                        : selectedSector.institutional.netShareChange < 0
                        ? 'text-[#ff4444]'
                        : 'text-zinc-300'
                    }`}
                  >
                    {formatCompactShares(selectedSector.institutional.netShareChange, true)}
                  </div>
                  <div className="text-[9px] text-zinc-500">
                    {formatSignedPercent(selectedSector.institutional.netPercentChange)} vs prior qtr
                  </div>
                </div>

                <div className="bg-[#080808] border border-[#1d1d1d] rounded p-2">
                  <div className="text-[9px] text-zinc-500 uppercase">REPORTED VALUE</div>
                  <div className="text-xs font-bold text-white mt-0.5">
                    {formatCompactUsd(selectedSector.institutional.aggregateValueUsd)}
                  </div>
                  <div className="text-[9px] text-zinc-500">
                    {selectedSector.institutional.classifiedSecuritiesCount} classified securities
                  </div>
                </div>

                <div className="bg-[#080808] border border-[#1d1d1d] rounded p-2">
                  <div className="text-[9px] text-zinc-500 uppercase">NEW POSITIONS</div>
                  <div className="text-xs font-bold text-[#00ff00] mt-0.5">
                    {selectedSector.institutional.newPositions}
                  </div>
                </div>

                <div className="bg-[#080808] border border-[#1d1d1d] rounded p-2">
                  <div className="text-[9px] text-zinc-500 uppercase">EXITED POSITIONS</div>
                  <div className="text-xs font-bold text-[#ff4444] mt-0.5">
                    {selectedSector.institutional.exitedPositions}
                  </div>
                </div>

                <div className="bg-[#080808] border border-[#1d1d1d] rounded p-2">
                  <div className="text-[9px] text-zinc-500 uppercase">VALUE CHANGE</div>
                  <div className={`text-xs font-bold mt-0.5 ${getReturnColorClass(selectedSector.institutional.valueChangePct)}`}>
                    {formatSignedPercent(selectedSector.institutional.valueChangePct)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Insider Form 4 Card (Strictly Separate) */}
          <div className="bg-black border border-[#222] rounded p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2 border-b border-[#1c1c1c] pb-2">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[#3498db]">
                  <Users size={12} />
                  <span>INSIDER SENTIMENT (FORM 4 — SEPARATE FROM 13F)</span>
                </div>
                <div className="text-[9px] text-zinc-500 mt-0.5">
                  TRAILING {selectedSector.insider.windowDays}D OPEN-MARKET FORM 4 FILINGS
                  {selectedSector.insider.since && selectedSector.insider.until
                    ? ` • ${selectedSector.insider.since} → ${selectedSector.insider.until}`
                    : ''}
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded border text-[10px] font-extrabold shrink-0 ${insMeta.cls}`}>
                {insMeta.label}
              </span>
            </div>

            {!selectedSector.insider.available ? (
              <div className="py-4 text-[11px] text-zinc-400 leading-relaxed">
                {selectedSector.insider.unavailableReason ||
                  'No qualifying Form 4 open-market insider transactions available for this sector.'}
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-3 gap-2 tabular-nums">
                  <div className="bg-[#080808] border border-[#1d1d1d] rounded p-2">
                    <div className="text-[9px] text-zinc-500 uppercase">INSIDER BUYING</div>
                    <div className="text-xs font-bold text-[#00ff00] mt-0.5">
                      {formatCompactUsd(selectedSector.insider.buysDollars)}
                    </div>
                    <div className="text-[9px] text-zinc-500 whitespace-nowrap">
                      {selectedSector.insider.buysCount ?? 0} tx
                    </div>
                  </div>
                  <div className="bg-[#080808] border border-[#1d1d1d] rounded p-2">
                    <div className="text-[9px] text-zinc-500 uppercase">INSIDER SELLING</div>
                    <div className="text-xs font-bold text-[#ff4444] mt-0.5">
                      {formatCompactUsd(selectedSector.insider.sellsDollars)}
                    </div>
                    <div className="text-[9px] text-zinc-500 whitespace-nowrap">
                      {selectedSector.insider.sellsCount ?? 0} tx
                    </div>
                  </div>
                  <div className="bg-[#080808] border border-[#1d1d1d] rounded p-2">
                    <div className="text-[9px] text-zinc-500 uppercase">BUY $ SHARE</div>
                    <div className="text-xs font-bold text-white mt-0.5">
                      {insiderBuyPct !== null ? `${insiderBuyPct.toFixed(1)}%` : '—'}
                    </div>
                    <div className="text-[9px] text-zinc-500">
                      {selectedSector.insider.sicCodesWithActivity}/{selectedSector.insider.sicCodesQueried.length} SICs active
                    </div>
                  </div>
                </div>

                {insiderBuyPct !== null && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full rounded bg-[#ff4444]/35 overflow-hidden flex">
                      <div
                        className="h-full bg-[#00ff00]"
                        style={{ width: `${insiderBuyPct.toFixed(1)}%` }}
                      />
                    </div>
                    <div className="text-[9px] text-zinc-500 leading-relaxed">
                      {selectedSector.insider.unavailableReason ||
                        `Aggregated from 3spread Form 4 filings across ${selectedSector.insider.sicCodesWithActivity}/${selectedSector.insider.sicCodesQueried.length} representative SIC codes (${selectedSector.insider.sicCodesQueried.join(
                          ', '
                        )}).`}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Row 3: Sector Institutional Activity Drill-Down */}
        <div className="bg-black border border-[#222] rounded overflow-hidden">
          <div className="px-3 py-2 bg-[#0a0a0a] border-b border-[#222] flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-200">
              {selectedSector.name.toUpperCase()} — INSTITUTIONAL 13F ACTIVITY DRILL-DOWN
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  {
                    id: 'INCREASES',
                    label: `LARGEST INCREASES (${selectedSector.institutional.largestIncreases.length})`,
                  },
                  {
                    id: 'DECREASES',
                    label: `LARGEST DECREASES (${selectedSector.institutional.largestDecreases.length})`,
                  },
                  {
                    id: 'NEW',
                    label: `NEW POSITIONS (${selectedSector.institutional.recentNewPositions.length})`,
                  },
                  {
                    id: 'EXITS',
                    label: `EXITS (${selectedSector.institutional.recentExits.length})`,
                  },
                  {
                    id: 'HOLDINGS',
                    label: `TOP SECURITIES (${selectedSector.institutional.topSecurities.length})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDetailActivityTab(tab.id)}
                  className={`px-2 py-1 rounded text-[9px] font-extrabold uppercase border transition-colors cursor-pointer ${
                    detailActivityTab === tab.id
                      ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                      : 'bg-black border-[#262626] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {detailActivityTab === 'HOLDINGS' ? (
            selectedSector.institutional.topSecurities.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 text-[11px]">
                No classified securities available in this sector for the current 13F cohort.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[11px] tabular-nums">
                  <thead>
                    <tr className="bg-[#080808] border-b border-[#222] text-[9px] text-zinc-500 uppercase">
                      <th className="py-2 px-3">SECURITY</th>
                      <th className="py-2 px-2.5 text-right">INC / NEW</th>
                      <th className="py-2 px-2.5 text-right">DEC / EXIT</th>
                      <th className="py-2 px-2.5 text-right">NET SHARE CHG</th>
                      <th className="py-2 px-2.5 text-right">% CHG</th>
                      <th className="py-2 px-3 text-right">REPORTED VALUE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#161616]">
                    {selectedSector.institutional.topSecurities.map((sec) => (
                      <tr key={sec.cusip} className="hover:bg-[#0d0d0d]">
                        <td className="py-2 px-3">
                          <button
                            type="button"
                            onClick={() =>
                              onInspectSecurity({
                                ticker: sec.ticker,
                                cusip: sec.cusip,
                                issuerName: sec.issuerName,
                              })
                            }
                            className="text-left group cursor-pointer"
                          >
                            <span className="font-bold text-white group-hover:text-[#ff9900] transition-colors">
                              {sec.ticker ? `${sec.ticker} — ` : ''}
                              {sec.issuerName}
                            </span>
                            <span className="block text-[9px] text-zinc-500">CUSIP: {sec.cusip}</span>
                          </button>
                        </td>
                        <td className="py-2 px-2.5 text-right text-[#00ff00] font-bold">
                          +{sec.institutionsIncreasing} / {sec.newPositions} new
                        </td>
                        <td className="py-2 px-2.5 text-right text-[#ff4444]">
                          -{sec.institutionsDecreasing} / {sec.exitedPositions} exit
                        </td>
                        <td
                          className={`py-2 px-2.5 text-right font-bold ${
                            sec.netShareChange >= 0 ? 'text-[#00ff00]' : 'text-[#ff4444]'
                          }`}
                        >
                          {formatCompactShares(sec.netShareChange, true)}
                        </td>
                        <td
                          className={`py-2 px-2.5 text-right font-bold ${getReturnColorClass(
                            sec.netPercentChange
                          )}`}
                        >
                          {formatSignedPercent(sec.netPercentChange)}
                        </td>
                        <td className="py-2 px-3 text-right text-white font-bold">
                          {formatCompactUsd(sec.totalValueUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : activeChangesRows.length === 0 ? (
            <div className="p-6 text-center text-zinc-500 text-[11px]">
              No {detailActivityTab.toLowerCase()} recorded in {selectedSector.name} for the current comparable 13F period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px] tabular-nums">
                <thead>
                  <tr className="bg-[#080808] border-b border-[#222] text-[9px] text-zinc-500 uppercase">
                    <th className="py-2 px-3">INSTITUTIONAL MANAGER</th>
                    <th className="py-2 px-2.5">SECURITY</th>
                    <th className="py-2 px-2.5 text-right">SHARE CHANGE</th>
                    <th className="py-2 px-2.5 text-right">% CHANGE</th>
                    <th className="py-2 px-2.5 text-right">VALUE</th>
                    <th className="py-2 px-3 text-right">PERIOD / FILED</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#161616]">
                  {activeChangesRows.map((row) => {
                    const safeUrl = getSafeExternalUrl(row.sourceUrl);
                    return (
                      <tr key={row.id} className="hover:bg-[#0d0d0d]">
                        <td className="py-2 px-3">
                          <button
                            type="button"
                            onClick={() => onInspectInvestor(row.managerCik)}
                            className="text-left font-bold text-[#3498db] hover:underline cursor-pointer"
                          >
                            {row.managerName}
                          </button>
                          <div className="text-[9px] text-zinc-500 flex items-center gap-1.5">
                            <span>CIK {row.managerCik}</span>
                            {safeUrl && (
                              <a
                                href={safeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-zinc-400 hover:text-[#ff9900] inline-flex items-center gap-0.5"
                              >
                                <span>EDGAR</span>
                                <ExternalLink size={8} />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              onInspectSecurity({
                                ticker: row.ticker,
                                cusip: row.cusip,
                                issuerName: row.issuerName,
                              })
                            }
                            className="text-left group cursor-pointer"
                          >
                            <span className="font-bold text-white group-hover:text-[#ff9900]">
                              {row.ticker ? `${row.ticker} — ` : ''}
                              {row.issuerName}
                            </span>
                            <span className="block text-[9px] text-zinc-500">CUSIP: {row.cusip}</span>
                          </button>
                        </td>
                        <td
                          className={`py-2 px-2.5 text-right font-bold ${
                            row.shareChange >= 0 ? 'text-[#00ff00]' : 'text-[#ff4444]'
                          }`}
                        >
                          {formatCompactShares(row.shareChange, true)}
                        </td>
                        <td
                          className={`py-2 px-2.5 text-right font-bold ${
                            row.category === 'NEW'
                              ? 'text-[#00ff00]'
                              : getReturnColorClass(row.percentChange)
                          }`}
                        >
                          {row.category === 'NEW' ? 'NEW' : formatSignedPercent(row.percentChange)}
                        </td>
                        <td className="py-2 px-2.5 text-right text-white font-bold">
                          {formatCompactUsd(row.currentValueUsd || row.previousValueUsd)}
                        </td>
                        <td className="py-2 px-3 text-right text-[10px] text-zinc-400 whitespace-nowrap">
                          <div>
                            {row.previousPeriod} → {row.currentPeriod}
                          </div>
                          <div className="text-[9px] text-zinc-500">
                            {row.filingDate ? `FILED ${formatIsoDateShort(row.filingDate)}` : '—'}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // PRIMARY SECTOR ROTATION OVERVIEW + COMPARISON TABLE
  // =========================================================================
  const cov = data.institutionalMeta.coverage;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
      {/* Controls & Benchmark Status Bar */}
      <div className="bg-black border border-[#222] rounded px-3 py-2 flex flex-wrap items-center justify-between gap-2.5 select-none">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-zinc-500 font-bold uppercase">RETURN PERIOD:</span>
            <div className="flex items-center gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelectedPeriod(p)}
                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold border transition-colors cursor-pointer ${
                    selectedPeriod === p
                      ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                      : 'bg-[#0a0a0a] border-[#262626] text-zinc-400 hover:border-zinc-500 hover:text-zinc-100'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <span className="text-zinc-800 hidden sm:inline">|</span>

          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-zinc-500 font-bold uppercase">INSIDER WINDOW:</span>
            <div className="flex items-center gap-1">
              {INSIDER_WINDOWS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onWindowDaysChange(d)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                    windowDays === d
                      ? 'bg-[#3498db]/15 border-[#3498db] text-[#3498db]'
                      : 'bg-[#0a0a0a] border-[#262626] text-zinc-400 hover:border-zinc-500 hover:text-zinc-100'
                  }`}
                >
                  {d}D
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Benchmark Readout */}
        <div className="flex flex-wrap items-center gap-2 text-[10px] tabular-nums">
          <span className="text-zinc-500 uppercase font-bold">BENCHMARK:</span>
          <span className="text-white font-extrabold">{data.benchmark.ticker}</span>
          <span className="text-zinc-300">{formatPrice(data.benchmark.latestPrice)}</span>
          <span className={`font-bold ${getReturnColorClass(benchmarkReturn)}`}>
            ({selectedPeriod}: {formatReturnCell(benchmarkReturn)})
          </span>
          {data.benchmark.latestDate && (
            <span className="text-zinc-500">AS OF {data.benchmark.latestDate}</span>
          )}
        </div>
      </div>

      {/* Partial Availability Banner (when 3spread is unconfigured or rate-limited) */}
      {!data.institutionalMeta.available && data.institutionalMeta.error && (
        <div className="px-3 py-2 rounded bg-amber-950/25 border border-amber-600/40 text-amber-200 text-[11px] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert size={13} className="text-amber-400 shrink-0" />
            <span>
              Market ETF rotation data is active. Institutional 13F &amp; Form 4 insider signals unavailable:{' '}
              {data.institutionalMeta.error}
            </span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="px-2 py-0.5 rounded border border-amber-500/50 text-amber-300 hover:bg-amber-500/15 text-[10px] font-bold uppercase cursor-pointer"
          >
            RETRY
          </button>
        </div>
      )}

      {/* Sector Rotation Overview Summary Strip (Responsive to Selected Period) */}
      {activeOverview && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2.5">
          {/* Strongest Sector */}
          <div className="bg-black border border-[#222] rounded p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[9px] font-bold uppercase text-zinc-500">
              <span>STRONGEST ({selectedPeriod})</span>
              <TrendingUp size={11} className="text-[#00ff00]" />
            </div>
            {activeOverview.strongestSector ? (
              <button
                type="button"
                onClick={() => openSectorDetail(activeOverview.strongestSector!.id)}
                className="text-left mt-1 group cursor-pointer"
              >
                <div className="text-xs font-extrabold text-white group-hover:text-[#ff9900] truncate">
                  {activeOverview.strongestSector.name}{' '}
                  <span className="text-[#ff9900]">({activeOverview.strongestSector.etfTicker})</span>
                </div>
                <div className="text-[10px] tabular-nums mt-0.5 flex items-center gap-2">
                  <span className={`font-bold ${getReturnColorClass(activeOverview.strongestSector.returnPct)}`}>
                    {formatReturnCell(activeOverview.strongestSector.returnPct)}
                  </span>
                  <span className="text-zinc-500">
                    RS {formatReturnCell(activeOverview.strongestSector.relativeStrengthPct)}
                  </span>
                </div>
              </button>
            ) : (
              <div className="text-xs text-zinc-500 mt-1">Unavailable</div>
            )}
          </div>

          {/* Weakest Sector */}
          <div className="bg-black border border-[#222] rounded p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[9px] font-bold uppercase text-zinc-500">
              <span>WEAKEST ({selectedPeriod})</span>
              <TrendingDown size={11} className="text-[#ff4444]" />
            </div>
            {activeOverview.weakestSector ? (
              <button
                type="button"
                onClick={() => openSectorDetail(activeOverview.weakestSector!.id)}
                className="text-left mt-1 group cursor-pointer"
              >
                <div className="text-xs font-extrabold text-white group-hover:text-[#ff9900] truncate">
                  {activeOverview.weakestSector.name}{' '}
                  <span className="text-[#ff9900]">({activeOverview.weakestSector.etfTicker})</span>
                </div>
                <div className="text-[10px] tabular-nums mt-0.5 flex items-center gap-2">
                  <span className={`font-bold ${getReturnColorClass(activeOverview.weakestSector.returnPct)}`}>
                    {formatReturnCell(activeOverview.weakestSector.returnPct)}
                  </span>
                  <span className="text-zinc-500">
                    RS {formatReturnCell(activeOverview.weakestSector.relativeStrengthPct)}
                  </span>
                </div>
              </button>
            ) : (
              <div className="text-xs text-zinc-500 mt-1">Unavailable</div>
            )}
          </div>

          {/* Breadth vs SPY */}
          <div className="bg-black border border-[#222] rounded p-2.5 flex flex-col justify-between">
            <div className="text-[9px] font-bold uppercase text-zinc-500">
              VS SPY BREADTH ({selectedPeriod})
            </div>
            <div className="mt-1 space-y-1.5">
              <div className="flex items-baseline justify-between text-xs font-extrabold tabular-nums">
                <span className="text-[#00ff00]">{activeOverview.outperformingCount} OUTPERF</span>
                <span className="text-[#ff4444]">{activeOverview.underperformingCount} UNDER</span>
              </div>
              <div className="h-1.5 w-full rounded bg-[#ff4444]/35 overflow-hidden flex">
                <div
                  className="h-full bg-[#00ff00]"
                  style={{
                    width: `${
                      activeOverview.outperformingCount + activeOverview.underperformingCount > 0
                        ? (activeOverview.outperformingCount /
                            (activeOverview.outperformingCount + activeOverview.underperformingCount)) *
                          100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Improving Momentum */}
          <div className="bg-black border border-[#222] rounded p-2.5 flex flex-col justify-between">
            <div className="text-[9px] font-bold uppercase text-[#3498db]">
              IMPROVING MOMENTUM ({activeOverview.improvingSectors.length})
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {activeOverview.improvingSectors.length === 0 ? (
                <span className="text-[10px] text-zinc-500">None in {selectedPeriod} window</span>
              ) : (
                activeOverview.improvingSectors.slice(0, 4).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openSectorDetail(s.id)}
                    className="px-1.5 py-0.5 rounded bg-[#3498db]/15 border border-[#3498db]/40 text-[#3498db] hover:border-[#3498db] text-[9px] font-bold cursor-pointer"
                  >
                    {s.etfTicker}
                  </button>
                ))
              )}
              {activeOverview.improvingSectors.length > 4 && (
                <span className="text-[9px] text-zinc-500 self-center">
                  +{activeOverview.improvingSectors.length - 4}
                </span>
              )}
            </div>
          </div>

          {/* Weakening Momentum */}
          <div className="bg-black border border-[#222] rounded p-2.5 flex flex-col justify-between">
            <div className="text-[9px] font-bold uppercase text-amber-400">
              WEAKENING MOMENTUM ({activeOverview.weakeningSectors.length})
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {activeOverview.weakeningSectors.length === 0 ? (
                <span className="text-[10px] text-zinc-500">None in {selectedPeriod} window</span>
              ) : (
                activeOverview.weakeningSectors.slice(0, 4).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openSectorDetail(s.id)}
                    className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-500/40 text-amber-300 hover:border-amber-400 text-[9px] font-bold cursor-pointer"
                  >
                    {s.etfTicker}
                  </button>
                ))
              )}
              {activeOverview.weakeningSectors.length > 4 && (
                <span className="text-[9px] text-zinc-500 self-center">
                  +{activeOverview.weakeningSectors.length - 4}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Primary Sector Rotation Comparison Table */}
      <div className="bg-black border border-[#222] rounded overflow-hidden">
        <div className="px-3 py-2 bg-[#0a0a0a] border-b border-[#222] flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <span className="font-extrabold uppercase tracking-wider text-zinc-200">
            US EQUITY SECTOR ROTATION MATRIX (11 GICS SECTORS)
          </span>
          <span className="text-zinc-500">
            13F COHORT: {data.institutionalMeta.available
              ? `${data.institutionalMeta.managersAnalyzed} MANAGERS (${formatQuarterLabel(
                  data.institutionalMeta.previousPeriod || ''
                )} → ${formatQuarterLabel(data.institutionalMeta.reportingPeriod || '')})`
              : 'UNAVAILABLE'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[11px] tabular-nums">
            <thead>
              <tr className="bg-[#080808] border-b border-[#222] text-[10px] text-zinc-400 uppercase select-none">
                {(
                  [
                    { field: 'name', label: 'SECTOR', align: 'left' },
                    { field: 'etfTicker', label: 'ETF', align: 'left' },
                    { field: 'latestPrice', label: 'PRICE', align: 'right' },
                    { field: '1W', label: '1W', align: 'right' },
                    { field: '1M', label: '1M', align: 'right' },
                    { field: '3M', label: '3M', align: 'right' },
                    { field: '6M', label: '6M', align: 'right' },
                    { field: 'relativeStrength', label: `REL STR (${selectedPeriod})`, align: 'right' },
                    { field: 'institutionalTrend', label: 'INSTITUTIONAL (13F)', align: 'left' },
                    { field: 'insiderSentiment', label: `INSIDER (${windowDays}D)`, align: 'left' },
                    { field: 'rotationStatus', label: 'ROTATION STATUS', align: 'right' },
                  ] as const
                ).map((col) => {
                  const isActiveSort = sortField === col.field;
                  const isActivePeriodCol = col.field === selectedPeriod;
                  return (
                    <th
                      key={col.field}
                      className={`py-2 px-2.5 whitespace-nowrap ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      } ${isActivePeriodCol ? 'text-[#ff9900] bg-[#ff9900]/5' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSortClick(col.field)}
                        className={`inline-flex items-center gap-1 hover:text-white cursor-pointer ${
                          isActiveSort ? 'text-[#ff9900]' : ''
                        }`}
                      >
                        <span>{col.label}</span>
                        <ArrowUpDown size={9} className={isActiveSort ? 'opacity-100' : 'opacity-40'} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#151515]">
              {sortedSectors.map((sector) => {
                const rot = getRotationBadgeMeta(sector.market.rotationStatus[selectedPeriod]);
                const inst = getInstitutionalBadgeMeta(sector.institutional.trend);
                const ins = getInsiderBadgeMeta(sector.insider.sentiment);
                const rsVal = sector.market.relativeStrength[selectedPeriod];
                const rsRank = sector.market.relativeStrengthRank[selectedPeriod];

                return (
                  <tr
                    key={sector.id}
                    onClick={() => openSectorDetail(sector.id)}
                    className="hover:bg-[#0f0f0f] transition-colors cursor-pointer group"
                  >
                    <td className="py-2.5 px-2.5">
                      <div className="font-bold text-white group-hover:text-[#ff9900] transition-colors whitespace-nowrap">
                        {sector.name}
                      </div>
                      <div className="text-[9px] text-zinc-500 truncate max-w-[180px]">
                        {sector.institutional.classifiedSecuritiesCount > 0
                          ? `${sector.institutional.classifiedSecuritiesCount} 13F sec • ${formatCompactUsd(
                              sector.institutional.aggregateValueUsd
                            )}`
                          : 'Click for breakdown'}
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectEtfTicker?.(sector.etfTicker);
                        }}
                        title={`Open ${sector.etfTicker} in Graph Price (GP)`}
                        aria-label={`Open ${sector.etfTicker} in Graph Price`}
                        className="font-extrabold text-[#ff9900] hover:text-amber-300 hover:underline underline-offset-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff9900] rounded px-1 -mx-1 py-0.5 transition-colors cursor-pointer"
                      >
                        {sector.etfTicker}
                      </button>
                    </td>
                    <td className="py-2.5 px-2.5 text-right text-zinc-200 font-bold">
                      {formatPrice(sector.market.latestPrice)}
                    </td>
                    {PERIODS.map((p) => {
                      const val = sector.market.returns[p].returnPct;
                      const isSel = p === selectedPeriod;
                      return (
                        <td
                          key={p}
                          className={`py-2.5 px-2.5 text-right font-bold ${getReturnColorClass(val)} ${
                            isSel ? 'bg-[#ff9900]/5' : ''
                          }`}
                        >
                          {formatReturnCell(val)}
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                      <div className={`font-bold ${getReturnColorClass(rsVal)}`}>
                        {formatReturnCell(rsVal)}
                      </div>
                      <div className="text-[9px] text-zinc-500">
                        {rsRank !== null ? `RANK #${rsRank}` : '—'}
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 whitespace-nowrap">
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-extrabold ${inst.cls}`}>
                        {inst.label}
                      </span>
                      {sector.institutional.available && sector.institutional.activeManagersCount > 0 ? (
                        <div className="text-[9px] text-zinc-400 mt-0.5">
                          <span className="text-[#00ff00]">↑{sector.institutional.managersIncreasing}</span>
                          {' / '}
                          <span className="text-[#ff4444]">↓{sector.institutional.managersDecreasing}</span>
                          {sector.institutional.netPercentChange !== null
                            ? ` (${formatSignedPercent(sector.institutional.netPercentChange)})`
                            : ''}
                        </div>
                      ) : (
                        <div className="text-[9px] text-zinc-600 mt-0.5">No cohort coverage</div>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 whitespace-nowrap">
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-extrabold ${ins.cls}`}>
                        {ins.label}
                      </span>
                      {sector.insider.available && sector.insider.buySellRatio !== null ? (
                        <div className="text-[9px] text-zinc-400 mt-0.5 whitespace-nowrap">
                          {(sector.insider.buySellRatio * 100).toFixed(0)}% buy (
                          {(sector.insider.buysCount ?? 0) + (sector.insider.sellsCount ?? 0)} tx)
                        </div>
                      ) : (
                        <div className="text-[9px] text-zinc-600 mt-0.5">Form 4 n/a</div>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[9px] font-extrabold ${rot.cls}`}>
                        {rot.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Classification Coverage & Methodology Footer */}
      <div className="bg-[#080808] border border-[#222] rounded p-3 space-y-2 text-[10px] text-zinc-400">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1c1c1c] pb-2">
          <div className="flex items-center gap-1.5 text-zinc-200 font-extrabold uppercase tracking-wider">
            <Info size={11} className="text-[#ff9900]" />
            <span>METHODOLOGY, DATA SEPARATION &amp; 13F CLASSIFICATION COVERAGE</span>
          </div>
          {data.institutionalMeta.available && cov.totalSecuritiesInCohort > 0 && (
            <div className="tabular-nums text-[10px] text-zinc-300">
              CLASSIFIED: <span className="text-[#00ff00] font-bold">{cov.classifiedSecuritiesCount}</span> /{' '}
              {cov.totalSecuritiesInCohort} SECURITIES (
              {cov.classifiedValuePct !== null ? `${cov.classifiedValuePct.toFixed(1)}%` : '—'} OF COHORT USD) •
              EXCLUDED BROAD ETFS/FUNDS: {cov.unclassifiedFundOrEtfCount} • UNMAPPED: {cov.unclassifiedUnknownCount}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-[10px] leading-relaxed">
          <div>
            <span className="text-zinc-200 font-bold">Market Rotation: </span>
            {data.methodology.rotationClassification}
          </div>
          <div>
            <span className="text-zinc-200 font-bold">Institutional (Form 13F): </span>
            {data.methodology.institutionalPositioning}
          </div>
          <div>
            <span className="text-zinc-200 font-bold">Insider Sentiment (Form 4): </span>
            {data.methodology.insiderSentiment}
          </div>
          <div>
            <span className="text-zinc-200 font-bold">Sector Benchmarks: </span>
            {data.methodology.marketPerformance}
          </div>
        </div>
      </div>
    </div>
  );
}

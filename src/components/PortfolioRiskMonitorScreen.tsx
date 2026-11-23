import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Edit3,
  FileSpreadsheet,
  FolderPlus,
  Layers,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type {
  PortfolioAccount,
  PortfolioRiskThresholds,
  PortfolioSecurityMetadata,
  PortfolioStoreState,
  StockData,
} from '../types';
import {
  LOOKBACK_PERIODS,
  formatCorrelationValue,
  type CorrelationBandId,
  type LookbackPeriodId,
  type SecurityHistorySeries,
} from '../utils/correlation';
import { fetchSecurityDailyHistory } from '../utils/dailyHistoryClient';
import {
  DEFAULT_PORTFOLIO_THRESHOLDS,
  addPortfolioToStore,
  deletePortfolioFromStore,
  loadPortfolioStore,
  loadPortfolioThresholds,
  removeHoldingFromPortfolio,
  savePortfolioStore,
  savePortfolioThresholds,
  setPortfolioCashBalance,
  updatePortfolioInStore,
  upsertHoldingInPortfolio,
} from '../utils/portfolioStorage';
import {
  computeDownsideScenario,
  computePortfolioRiskAnalysis,
  type DownsideScenarioResult,
  type EnrichedPortfolioPosition,
} from '../utils/portfolioRiskEngine';
import { PortfolioManagerPanel, type PortfolioManagerTab } from './PortfolioManagerPanel';
import { InfoTooltipIcon, TerminalTooltip } from './TerminalTooltip';

export interface PortfolioRiskMonitorScreenProps {
  stocks: Record<string, StockData>;
  trackedTickers?: string[];
  onSelectTicker?: (ticker: string) => void;
  onExecuteCommand?: (cmd: string) => void;
  onOpenCorrWorkspace?: () => void;
  /** Deterministic test overrides */
  initialStore?: PortfolioStoreState;
  initialMetadataMap?: Record<string, PortfolioSecurityMetadata>;
  initialHistoryMap?: Record<string, SecurityHistorySeries>;
  initialSpySeries?: SecurityHistorySeries | null;
  initialLookback?: LookbackPeriodId;
  disableAutoFetch?: boolean;
}

type SortKey =
  | 'positionRank'
  | 'ticker'
  | 'shares'
  | 'currentPrice'
  | 'marketValue'
  | 'weightPct'
  | 'unrealizedGain'
  | 'annualizedVolatilityPct'
  | 'riskContributionPct';

const PRM_SECTIONS = [
  { id: 'prm-overview', label: '1. OVERVIEW' },
  { id: 'prm-concentration', label: '2. CONCENTRATION' },
  { id: 'prm-sectors', label: '3. SECTORS' },
  { id: 'prm-positions', label: '4. POSITIONS' },
  { id: 'prm-volatility', label: '5. VOLATILITY & RISK' },
  { id: 'prm-diversification', label: '6. DIVERSIFICATION' },
  { id: 'prm-scenarios', label: '7. DOWNSIDE SCENARIOS' },
] as const;

const SECTOR_BAR_COLORS = [
  '#ff9900',
  '#3498db',
  '#00ff00',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
  '#14b8a6',
  '#71717a',
];

function formatUsd(val: number | null | undefined, compact = false): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (compact) {
    if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 100_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPct(val: number | null | undefined, digits = 1, showPlus = false): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const prefix = showPlus && val > 0 ? '+' : '';
  return `${prefix}${val.toFixed(digits)}%`;
}

function getMatrixCellClasses(bandId: CorrelationBandId, isDiagonal: boolean): string {
  if (isDiagonal) {
    return 'bg-[#141414] text-zinc-400 border-[#2c2c2c]';
  }
  switch (bandId) {
    case 'strong-positive':
      return 'bg-[#3b0c0c] text-[#ff6666] border-[#7f1d1d]';
    case 'moderate-positive':
      return 'bg-[#2a1807] text-[#ffb347] border-[#5c330c]';
    case 'weak-positive':
      return 'bg-[#121614] text-zinc-300 border-[#242c28]';
    case 'neutral':
      return 'bg-[#0b1f14] text-[#6ee787] border-[#143a23]';
    case 'weak-negative':
    case 'moderate-negative':
    case 'strong-negative':
      return 'bg-[#072b12] text-[#00ff00] border-[#14532d]';
    default:
      return 'bg-[#0b0b0b] text-zinc-600 border-[#1f1f1f]';
  }
}

function toneTextClass(tone: 'positive' | 'neutral' | 'warning' | 'negative'): string {
  switch (tone) {
    case 'positive':
      return 'text-[#00ff00]';
    case 'warning':
      return 'text-[#ff9900]';
    case 'negative':
      return 'text-[#ff4444]';
    default:
      return 'text-zinc-200';
  }
}

function toneBadgeClass(tone: 'positive' | 'neutral' | 'warning' | 'negative'): string {
  switch (tone) {
    case 'positive':
      return 'text-[#00ff00] border-[#00ff00]/40 bg-[#00ff00]/10';
    case 'warning':
      return 'text-[#ff9900] border-[#ff9900]/40 bg-[#ff9900]/10';
    case 'negative':
      return 'text-[#ff4444] border-[#ff4444]/40 bg-[#ff4444]/10';
    default:
      return 'text-zinc-300 border-zinc-700 bg-zinc-900';
  }
}

export const PortfolioRiskMonitorScreen: React.FC<PortfolioRiskMonitorScreenProps> = ({
  stocks,
  trackedTickers = [],
  onSelectTicker,
  onExecuteCommand,
  onOpenCorrWorkspace,
  initialStore,
  initialMetadataMap,
  initialHistoryMap,
  initialSpySeries = null,
  initialLookback = '1Y',
  disableAutoFetch = false,
}) => {
  const [store, setStore] = useState<PortfolioStoreState>(() =>
    initialStore
      ? initialStore
      : loadPortfolioStore(typeof window !== 'undefined' ? window.localStorage : null)
  );
  const [thresholds, setThresholds] = useState<PortfolioRiskThresholds>(() =>
    loadPortfolioThresholds(typeof window !== 'undefined' ? window.localStorage : null)
  );
  const [lookback, setLookback] = useState<LookbackPeriodId>(initialLookback);

  const [metadataMap, setMetadataMap] = useState<Record<string, PortfolioSecurityMetadata>>(
    () => initialMetadataMap || {}
  );
  const [historyMap, setHistoryMap] = useState<Record<string, SecurityHistorySeries>>(
    () => initialHistoryMap || {}
  );
  const [spySeries, setSpySeries] = useState<SecurityHistorySeries | null>(initialSpySeries);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Manager drawer & UI toggles
  const [managerOpen, setManagerOpen] = useState<boolean>(false);
  const [managerTab, setManagerTab] = useState<PortfolioManagerTab>('manual');
  const [thresholdsOpen, setThresholdsOpen] = useState<boolean>(false);

  // Position table sort & inline edit state
  const [sortKey, setSortKey] = useState<SortKey>('weightPct');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSharesDraft, setEditSharesDraft] = useState<string>('');
  const [editCostDraft, setEditCostDraft] = useState<string>('');

  // Downside scenario interactive controls
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('spy-10');
  const [customScenarioMode, setCustomScenarioMode] = useState<'sector' | 'positions'>('sector');
  const [customSectorName, setCustomSectorName] = useState<string>('');
  const [customSectorShockPct, setCustomSectorShockPct] = useState<number>(-15);
  const [customPosShocks, setCustomPosShocks] = useState<Record<string, number>>({});
  const [newShockTicker, setNewShockTicker] = useState<string>('');
  const [newShockPct, setNewShockPct] = useState<string>('-20');

  // Persist store & thresholds to localStorage
  useEffect(() => {
    if (initialStore) return;
    savePortfolioStore(typeof window !== 'undefined' ? window.localStorage : null, store);
  }, [store, initialStore]);

  useEffect(() => {
    if (initialStore) return;
    savePortfolioThresholds(typeof window !== 'undefined' ? window.localStorage : null, thresholds);
  }, [thresholds, initialStore]);

  const activePortfolio: PortfolioAccount | null = useMemo(() => {
    if (store.portfolios.length === 0) return null;
    return (
      store.portfolios.find((p) => p.id === store.activePortfolioId) || store.portfolios[0]
    );
  }, [store]);

  const holdingTickers = useMemo(
    () => (activePortfolio ? activePortfolio.holdings.map((h) => h.ticker) : []),
    [activePortfolio]
  );
  const holdingTickersKey = holdingTickers.join(',');

  const fetchBatchMetadata = useCallback(
    async (symbols: string[], force = false): Promise<Record<string, PortfolioSecurityMetadata>> => {
      if (symbols.length === 0) return {};
      try {
        const params = new URLSearchParams({ symbols: symbols.join(',') });
        if (force) params.set('force', 'true');
        const resp = await fetch(`/api/portfolio/metadata?${params.toString()}`);
        const data = await resp.json();
        if (data?.success && data.metadata && typeof data.metadata === 'object') {
          setMetadataMap((prev) => ({ ...prev, ...data.metadata }));
          return data.metadata as Record<string, PortfolioSecurityMetadata>;
        }
      } catch {
        // Handled cleanly by caller
      }
      return {};
    },
    []
  );

  const refreshPortfolioMarketData = useCallback(
    async (force = false) => {
      if (disableAutoFetch) return;
      if (holdingTickers.length === 0) {
        setLoadError(null);
        return;
      }

      setIsLoadingData(true);
      setLoadError(null);
      try {
        const symbolsToFetch: string[] = Array.from(new Set<string>(holdingTickers));
        const [, spyHist, ...holdingHists] = await Promise.all([
          fetchBatchMetadata(symbolsToFetch, force),
          fetchSecurityDailyHistory('SPY', force),
          ...symbolsToFetch.map((sym) => fetchSecurityDailyHistory(sym, force)),
        ]);

        if (spyHist) setSpySeries(spyHist);
        setHistoryMap((prev) => {
          const next = { ...prev };
          for (const series of holdingHists) {
            if (series?.symbol) next[series.symbol] = series;
          }
          return next;
        });
      } catch (err: any) {
        setLoadError(err?.message || 'Unable to refresh portfolio market data.');
      } finally {
        setIsLoadingData(false);
      }
    },
    [disableAutoFetch, holdingTickers, fetchBatchMetadata]
  );

  useEffect(() => {
    if (disableAutoFetch) return;
    if (!holdingTickersKey) return;
    void refreshPortfolioMarketData(false);
  }, [holdingTickersKey, disableAutoFetch, refreshPortfolioMarketData]);

  // Run Portfolio Risk Analytics Engine
  const analysis = useMemo(() => {
    if (!activePortfolio) return null;
    return computePortfolioRiskAnalysis({
      portfolio: activePortfolio,
      metadataMap,
      stocksMap: stocks,
      historyMap,
      spySeries,
      lookbackPeriod: lookback,
      thresholds,
      benchmarkSectorWeights: null,
    });
  }, [activePortfolio, metadataMap, stocks, historyMap, spySeries, lookback, thresholds]);

  // Sync default custom sector & ticker when portfolio changes
  useEffect(() => {
    if (!analysis) return;
    if (
      analysis.sectorExposure.sectors.length > 0 &&
      (!customSectorName || !analysis.sectorExposure.sectors.some((s) => s.sector === customSectorName))
    ) {
      setCustomSectorName(analysis.sectorExposure.sectors[0].sector);
    }
    if (
      analysis.positions.length > 0 &&
      (!newShockTicker || !analysis.positions.some((p) => p.ticker === newShockTicker))
    ) {
      setNewShockTicker(analysis.positions[0].ticker);
    }
  }, [analysis, customSectorName, newShockTicker]);

  // Custom scenario results
  const customSectorScenario: DownsideScenarioResult | null = useMemo(() => {
    if (!analysis || !customSectorName) return null;
    return computeDownsideScenario({
      id: 'custom-sector',
      name: `Custom Sector Shock: ${customSectorName} (${customSectorShockPct}%)`,
      category: 'sector',
      description: `Hypothetical ${customSectorShockPct}% uniform decline across all holdings in ${customSectorName}.`,
      methodologyNote:
        'Hypothetical sector-specific stress test using current portfolio weights; holdings outside this sector and cash remain unchanged.',
      positions: analysis.positions,
      cashBalance: analysis.cashBalance,
      totalPortfolioValue: analysis.totalPortfolioValue,
      sectorShock: { sector: customSectorName, shockPct: customSectorShockPct },
    });
  }, [analysis, customSectorName, customSectorShockPct]);

  const customPositionsScenario: DownsideScenarioResult | null = useMemo(() => {
    if (!analysis) return null;
    const activeEntries: Array<[string, number]> = (
      Object.entries(customPosShocks) as Array<[string, number]>
    ).filter(
      ([sym, pct]) =>
        analysis.positions.some((p) => p.ticker === sym) &&
        Number.isFinite(pct) &&
        pct !== 0
    );
    if (activeEntries.length === 0) return null;
    const label = activeEntries.map(([sym, pct]) => `${sym} ${pct}%`).join(', ');
    const positionShocks: Record<string, number> = {};
    for (const [sym, pct] of activeEntries) {
      positionShocks[sym] = pct;
    }
    return computeDownsideScenario({
      id: 'custom-positions',
      name: `Custom Position Shock (${label})`,
      category: 'position',
      description: `Hypothetical simultaneous shock applied to ${activeEntries.length} selected holding${activeEntries.length === 1 ? '' : 's'}.`,
      methodologyNote:
        'Hypothetical user-defined single or multi-position shock using actual weights; unshocked holdings and cash remain unchanged.',
      positions: analysis.positions,
      cashBalance: analysis.cashBalance,
      totalPortfolioValue: analysis.totalPortfolioValue,
      positionShocks,
    });
  }, [analysis, customPosShocks]);

  const allPresetScenarios = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.marketScenarios, ...analysis.concentratedStressScenarios];
  }, [analysis]);

  const activeScenarioDetail: DownsideScenarioResult | null = useMemo(() => {
    if (selectedScenarioId === 'custom-sector' && customSectorScenario) return customSectorScenario;
    if (selectedScenarioId === 'custom-positions' && customPositionsScenario) {
      return customPositionsScenario;
    }
    return (
      allPresetScenarios.find((s) => s.id === selectedScenarioId) ||
      allPresetScenarios[1] ||
      allPresetScenarios[0] ||
      null
    );
  }, [selectedScenarioId, customSectorScenario, customPositionsScenario, allPresetScenarios]);

  // Sorted positions for Section 4
  const sortedPositions = useMemo(() => {
    if (!analysis) return [];
    const copy = [...analysis.positions];
    const dir = sortDir === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      if (sortKey === 'ticker') {
        return a.ticker.localeCompare(b.ticker) * dir;
      }
      const getNum = (p: EnrichedPortfolioPosition): number => {
        const val = p[sortKey];
        if (typeof val === 'number' && Number.isFinite(val)) return val;
        return sortDir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      };
      return (getNum(a) - getNum(b)) * dir;
    });
    return copy;
  }, [analysis, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'ticker' || key === 'positionRank' ? 'asc' : 'desc');
    }
  };

  // Store mutation callbacks
  const handleCreatePortfolio = useCallback((name: string, cashBalance: number): PortfolioAccount => {
    let createdAccount!: PortfolioAccount;
    setStore((prev) => {
      const res = addPortfolioToStore(prev, name, cashBalance);
      createdAccount = res.created;
      return res.store;
    });
    return createdAccount;
  }, []);

  const handleRenamePortfolio = useCallback((portfolioId: string, name: string) => {
    setStore((prev) =>
      updatePortfolioInStore(prev, portfolioId, (pf) => ({ ...pf, name: name.slice(0, 80) }))
    );
  }, []);

  const handleDeletePortfolio = useCallback((portfolioId: string) => {
    setStore((prev) => deletePortfolioFromStore(prev, portfolioId));
  }, []);

  const handleUpdateCash = useCallback(
    (cashBalance: number) => {
      if (!activePortfolio) return;
      setStore((prev) =>
        updatePortfolioInStore(prev, activePortfolio.id, (pf) =>
          setPortfolioCashBalance(pf, cashBalance)
        )
      );
    },
    [activePortfolio]
  );

  const handleUpsertHolding = useCallback(
    (
      input: {
        ticker: string;
        shares: number;
        avgCostBasis: number | null;
        source: 'manual' | 'csv' | 'tracked_watchlist';
      },
      mergeMode: 'replace' | 'add'
    ) => {
      setStore((prev) => {
        const targetId = prev.activePortfolioId || prev.portfolios[0]?.id;
        if (!targetId) return prev;
        return updatePortfolioInStore(prev, targetId, (pf) =>
          upsertHoldingInPortfolio(pf, input, mergeMode)
        );
      });
    },
    []
  );

  const handleBulkImport = useCallback(
    (
      targetPortfolioId: string,
      holdings: Array<{
        ticker: string;
        shares: number;
        avgCostBasis: number | null;
        source: 'csv' | 'tracked_watchlist';
      }>,
      mergeMode: 'replace' | 'add',
      cashDelta = 0
    ) => {
      setStore((prev) =>
        updatePortfolioInStore(prev, targetPortfolioId, (pf) => {
          let nextPf = pf;
          for (const h of holdings) {
            nextPf = upsertHoldingInPortfolio(nextPf, h, mergeMode);
          }
          if (cashDelta > 0) {
            nextPf = setPortfolioCashBalance(nextPf, nextPf.cashBalance + cashDelta);
          }
          return nextPf;
        })
      );
    },
    []
  );

  const handleInlineEditSave = (pos: EnrichedPortfolioPosition) => {
    if (!activePortfolio) return;
    const shares = Number(editSharesDraft);
    if (!Number.isFinite(shares) || shares <= 0) return;
    const cost =
      editCostDraft.trim() !== '' && Number.isFinite(Number(editCostDraft)) && Number(editCostDraft) >= 0
        ? Number(editCostDraft)
        : null;
    setStore((prev) =>
      updatePortfolioInStore(prev, activePortfolio.id, (pf) =>
        upsertHoldingInPortfolio(
          pf,
          { ticker: pos.ticker, shares, avgCostBasis: cost, source: pos.source },
          'replace'
        )
      )
    );
    setEditingId(null);
  };

  const handleRemovePosition = (tickerOrId: string) => {
    if (!activePortfolio) return;
    setStore((prev) =>
      updatePortfolioInStore(prev, activePortfolio.id, (pf) =>
        removeHoldingFromPortfolio(pf, tickerOrId)
      )
    );
  };

  const openManager = (tab: PortfolioManagerTab) => {
    setManagerTab(tab);
    setManagerOpen(true);
  };

  const jumpToSection = (sectionId: string) => {
    if (typeof document === 'undefined') return;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const isEmptyPortfolio =
    !activePortfolio || (activePortfolio.holdings.length === 0 && activePortfolio.cashBalance <= 0);

  return (
    <div className="space-y-4 font-mono text-zinc-200 animate-fade-in">
      {/* Top Workspace Header & Controls */}
      <div className="bg-[#050505] border border-[#333] rounded p-3.5 space-y-3">
        <div className="border-b border-[#2a2a2a] pb-2.5">
          <h1 className="text-white text-md font-bold uppercase tracking-wider">
            PORTFOLIO RISK MONITOR
          </h1>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#1f1f1f] pb-2.5">
          {activePortfolio && (
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Select portfolio"
                value={activePortfolio.id}
                onChange={(e) =>
                  setStore((prev) => ({ ...prev, activePortfolioId: e.target.value }))
                }
                className="bg-black border border-[#333] hover:border-[#ff9900] rounded px-2 py-1 text-xs text-zinc-100 font-bold outline-none cursor-pointer"
              >
                {store.portfolios.map((pf) => (
                  <option key={pf.id} value={pf.id}>
                    {pf.name} ({pf.holdings.length})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => openManager('manual')}
              className="px-2.5 py-1.5 rounded bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-[10px] uppercase inline-flex items-center justify-center gap-1 leading-none transition-colors cursor-pointer"
            >
              <Plus size={11} />
              <span>ADD HOLDING</span>
            </button>
            <button
              type="button"
              onClick={() => openManager('csv')}
              className="px-2.5 py-1.5 rounded bg-black border border-[#333] hover:border-[#ff9900] text-zinc-200 hover:text-[#ff9900] font-bold text-[10px] uppercase inline-flex items-center justify-center gap-1 leading-none transition-colors cursor-pointer"
            >
              <FileSpreadsheet size={11} />
              <span>CSV IMPORT</span>
            </button>
            <button
              type="button"
              onClick={() => openManager('watchlist')}
              className="px-2.5 py-1.5 rounded bg-black border border-[#333] hover:border-[#3498db] text-zinc-200 hover:text-[#3498db] font-bold text-[10px] uppercase inline-flex items-center justify-center gap-1 leading-none transition-colors cursor-pointer"
            >
              <Layers size={11} />
              <span>WATCHLIST</span>
            </button>
            <button
              type="button"
              onClick={() => openManager('portfolios')}
              className="px-2.5 py-1.5 rounded bg-black border border-[#333] hover:border-zinc-500 text-zinc-300 hover:text-white font-bold text-[10px] uppercase inline-flex items-center justify-center gap-1 leading-none transition-colors cursor-pointer"
            >
              <FolderPlus size={11} />
              <span>PORTFOLIOS</span>
            </button>
            <button
              type="button"
              onClick={() => setThresholdsOpen((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded border font-bold text-[10px] uppercase inline-flex items-center justify-center gap-1 leading-none transition-colors cursor-pointer ${
                thresholdsOpen
                  ? 'bg-[#1a1a1a] border-[#ff9900] text-[#ff9900]'
                  : 'bg-black border-[#333] text-zinc-300 hover:border-zinc-500'
              }`}
            >
              <SlidersHorizontal size={11} />
              <span>THRESHOLDS</span>
            </button>
            <button
              type="button"
              onClick={() => void refreshPortfolioMarketData(true)}
              disabled={isLoadingData || holdingTickers.length === 0}
              aria-label="Refresh portfolio market prices and history"
              title="Refresh market prices & historical returns"
              className="px-2 py-1.5 rounded bg-black border border-[#333] hover:border-[#00ff00] text-zinc-400 hover:text-[#00ff00] disabled:opacity-40 inline-flex items-center justify-center leading-none transition-colors cursor-pointer"
            >
              <RefreshCw size={11} className={isLoadingData ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Lookback Selector + Section Anchors */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 uppercase font-bold mr-1">RISK LOOKBACK:</span>
            {LOOKBACK_PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setLookback(p.id)}
                className={`px-2 py-1 rounded text-[10px] font-bold uppercase border transition-colors cursor-pointer leading-none ${
                  lookback === p.id
                    ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                    : 'bg-black border-[#2a2a2a] text-zinc-400 hover:text-zinc-200 hover:border-[#444]'
                }`}
              >
                {p.shortLabel}
              </button>
            ))}
            {isLoadingData && (
              <span className="text-[10px] text-[#ff9900] ml-2 inline-flex items-center gap-1">
                <RefreshCw size={10} className="animate-spin" />
                SYNCING MARKET DATA...
              </span>
            )}
          </div>

          {!isEmptyPortfolio && (
            <div className="flex flex-wrap items-center gap-1">
              {PRM_SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => jumpToSection(sec.id)}
                  className="px-1.5 py-0.5 rounded bg-black border border-[#242424] hover:border-[#ff9900] text-[9.5px] text-zinc-400 hover:text-[#ff9900] uppercase font-bold transition-colors cursor-pointer"
                >
                  {sec.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Configurable Risk Thresholds Bar */}
        {thresholdsOpen && (
          <div className="border-t border-[#242424] pt-3 grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-[10px]">
            {[
              {
                key: 'maxSinglePositionPct' as const,
                label: 'Max Single Pos (%)',
                min: 5,
                max: 80,
                step: 1,
              },
              {
                key: 'minPositionPct' as const,
                label: 'Underallocated (%)',
                min: 0.5,
                max: 15,
                step: 0.5,
              },
              {
                key: 'maxTop5Pct' as const,
                label: 'Max Top-5 (%)',
                min: 20,
                max: 95,
                step: 5,
              },
              {
                key: 'maxSectorPct' as const,
                label: 'Max Sector (%)',
                min: 10,
                max: 80,
                step: 5,
              },
              {
                key: 'highCorrelationThreshold' as const,
                label: 'High Corr (r)',
                min: 0.4,
                max: 0.95,
                step: 0.05,
              },
            ].map((item) => (
              <label key={item.key} className="bg-black border border-[#262626] rounded p-2 space-y-1">
                <span className="block text-zinc-400 uppercase font-bold">{item.label}</span>
                <input
                  type="number"
                  min={item.min}
                  max={item.max}
                  step={item.step}
                  value={thresholds[item.key]}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    if (Number.isFinite(num)) {
                      setThresholds((prev) => ({
                        ...prev,
                        [item.key]: Math.min(item.max, Math.max(item.min, num)),
                      }));
                    }
                  }}
                  className="w-full bg-[#080808] border border-[#333] focus:border-[#ff9900] rounded px-2 py-1 text-xs text-zinc-100 tabular-nums outline-none"
                />
              </label>
            ))}
            <div className="col-span-2 sm:col-span-5 flex justify-end">
              <button
                type="button"
                onClick={() => setThresholds({ ...DEFAULT_PORTFOLIO_THRESHOLDS })}
                className="text-[10px] text-zinc-400 hover:text-[#ff9900] uppercase font-bold cursor-pointer"
              >
                RESET DEFAULTS
              </button>
            </div>
          </div>
        )}
      </div>

      {loadError && (
        <div className="bg-black border border-[#ff4444]/40 rounded px-3 py-2 text-[11px] text-[#ff4444] flex items-center gap-2">
          <AlertCircle size={13} className="shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Portfolio Data Manager Panel (Manual, CSV, Watchlist, Multi-Portfolio) */}
      {managerOpen && (
        <PortfolioManagerPanel
          activeTab={managerTab}
          onTabChange={setManagerTab}
          onClose={() => setManagerOpen(false)}
          portfolios={store.portfolios}
          activePortfolio={activePortfolio}
          trackedTickers={trackedTickers}
          stocks={stocks}
          onSelectPortfolio={(id) => setStore((prev) => ({ ...prev, activePortfolioId: id }))}
          onCreatePortfolio={handleCreatePortfolio}
          onRenamePortfolio={handleRenamePortfolio}
          onDeletePortfolio={handleDeletePortfolio}
          onUpdateCash={handleUpdateCash}
          onUpsertHolding={handleUpsertHolding}
          onBulkImport={handleBulkImport}
          onVerifySymbols={(syms) => fetchBatchMetadata(syms, false)}
        />
      )}

      {/* Empty State */}
      {isEmptyPortfolio || !analysis ? (
        <div className="bg-[#050505] border border-[#333] rounded p-8 text-center space-y-4">
          <div className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
            {activePortfolio ? `${activePortfolio.name} — NO HOLDINGS CONFIGURED` : 'NO PERSONAL PORTFOLIO CONFIGURED'}
          </div>
          <div className="text-xs text-zinc-400 max-w-xl mx-auto">
            Add positions manually, upload a brokerage CSV export, or import equities from your Quorix Tracked Equities watchlist to calculate live portfolio exposure, concentration, covariance volatility, CORR diversification clusters, and downside stress tests.
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => openManager('manual')}
              className="px-3.5 py-2 rounded bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-[10.5px] uppercase inline-flex items-center gap-1.5 leading-none cursor-pointer"
            >
              <Plus size={12} />
              <span>ADD HOLDINGS MANUALLY</span>
            </button>
            <button
              type="button"
              onClick={() => openManager('csv')}
              className="px-3.5 py-2 rounded bg-black border border-[#444] hover:border-[#ff9900] text-zinc-200 hover:text-[#ff9900] font-bold text-[10.5px] uppercase inline-flex items-center gap-1.5 leading-none cursor-pointer"
            >
              <FileSpreadsheet size={12} />
              <span>IMPORT BROKERAGE CSV</span>
            </button>
            <button
              type="button"
              onClick={() => openManager('watchlist')}
              className="px-3.5 py-2 rounded bg-black border border-[#444] hover:border-[#3498db] text-zinc-200 hover:text-[#3498db] font-bold text-[10.5px] uppercase inline-flex items-center gap-1.5 leading-none cursor-pointer"
            >
              <Layers size={12} />
              <span>SEED FROM TRACKED EQUITIES</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Global Data Warnings */}
          {analysis.dataWarnings.length > 0 && (
            <div className="bg-black border border-amber-500/40 rounded px-3 py-2 space-y-1 text-[10.5px] text-amber-400">
              {analysis.dataWarnings.map((w, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <AlertTriangle size={12} className="shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* ================================================================ */}
          {/* SECTION 1: PORTFOLIO OVERVIEW                                    */}
          {/* ================================================================ */}
          <section id="prm-overview" className="bg-[#050505] border border-[#333] rounded p-3.5 space-y-3">
            <div className="border-b border-[#2a2a2a] pb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                  PORTFOLIO OVERVIEW
                </h2>
                <InfoTooltipIcon
                  label="Portfolio Overview info"
                  title="Portfolio Overview"
                  content="Consolidated market valuation, exposure, historical volatility, beta vs SPY, concentration, and transparent rule-based risk assessment."
                />
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                  RISK ASSESSMENT:
                </span>
                <span
                  className={`px-3 py-1 rounded border text-sm font-extrabold uppercase tracking-wider leading-none ${toneBadgeClass(
                    analysis.overallRisk.tone
                  )}`}
                >
                  {analysis.overallRisk.level}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">Total Market Value</div>
                <div className="text-base font-bold text-white tabular-nums mt-0.5">
                  {formatUsd(analysis.totalPortfolioValue)}
                </div>
                <div className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                  Equities {formatUsd(analysis.totalEquityValue, true)}
                </div>
              </div>

              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">Holdings</div>
                <div className="text-base font-bold text-white tabular-nums mt-0.5">
                  {analysis.holdingCount}
                </div>
                <div className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                  {analysis.pricedHoldingCount} priced
                  {analysis.unpricedHoldings.length > 0
                    ? ` · ${analysis.unpricedHoldings.length} unpriced`
                    : ''}
                </div>
              </div>

              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">Cash Allocation</div>
                <div className="text-base font-bold text-[#3498db] tabular-nums mt-0.5">
                  {formatPct(analysis.cashWeightPct)}
                </div>
                <div className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                  {formatUsd(analysis.cashBalance)}
                </div>
              </div>

              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">Largest Position</div>
                <div className="text-base font-bold text-white tabular-nums mt-0.5">
                  {analysis.concentration.largestPosition ? (
                    <>
                      <span className="text-[#3498db] mr-1.5">
                        {analysis.concentration.largestPosition.ticker}
                      </span>
                      <span
                        className={
                          analysis.concentration.largestPosition.weightPct >
                          thresholds.maxSinglePositionPct
                            ? 'text-[#ff4444]'
                            : 'text-white'
                        }
                      >
                        {formatPct(analysis.concentration.largestPosition.weightPct)}
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="text-[10px] text-zinc-500 tabular-nums mt-0.5 truncate">
                  {analysis.concentration.largestPosition
                    ? formatUsd(analysis.concentration.largestPosition.marketValue)
                    : 'No priced holdings'}
                </div>
              </div>

              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold flex items-center gap-1">
                  <span>Portfolio Beta (SPY)</span>
                  <InfoTooltipIcon
                    label="Portfolio Beta info"
                    content={`Historical covariance-based beta of weighted portfolio returns (including cash at 0%) against SPY over ${analysis.volatilityRisk.lookbackLabel}.`}
                  />
                </div>
                <div
                  className={`text-base font-bold tabular-nums mt-0.5 ${
                    analysis.volatilityRisk.portfolioBetaVsSpy === null
                      ? 'text-zinc-500'
                      : analysis.volatilityRisk.portfolioBetaVsSpy >= 1.3
                      ? 'text-[#ff4444]'
                      : analysis.volatilityRisk.portfolioBetaVsSpy >= 1.1
                      ? 'text-[#ff9900]'
                      : 'text-[#00ff00]'
                  }`}
                >
                  {analysis.volatilityRisk.portfolioBetaVsSpy !== null
                    ? analysis.volatilityRisk.portfolioBetaVsSpy.toFixed(2)
                    : '—'}
                </div>
                <div className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                  {analysis.volatilityRisk.betaObservationCount > 0
                    ? `${analysis.volatilityRisk.betaObservationCount} sessions (${lookback})`
                    : 'Insufficient history'}
                </div>
              </div>

              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold flex items-center gap-1">
                  <span>Portfolio Volatility</span>
                  <InfoTooltipIcon
                    label="Portfolio Volatility info"
                    content="Annualized portfolio standard deviation computed via full weight-covariance matrix (√(wᵀΣw × 252)), not a simple average of holding volatilities."
                  />
                </div>
                <div
                  className={`text-base font-bold tabular-nums mt-0.5 ${
                    analysis.volatilityRisk.portfolioVolatilityPct === null
                      ? 'text-zinc-500'
                      : analysis.volatilityRisk.portfolioVolatilityPct >= 25
                      ? 'text-[#ff4444]'
                      : analysis.volatilityRisk.portfolioVolatilityPct >= 16
                      ? 'text-[#ff9900]'
                      : 'text-[#00ff00]'
                  }`}
                >
                  {analysis.volatilityRisk.portfolioVolatilityPct !== null
                    ? `${analysis.volatilityRisk.portfolioVolatilityPct.toFixed(1)}%`
                    : '—'}
                </div>
                <div className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                  {analysis.volatilityRisk.alignedSessionCount > 0
                    ? `Annualized · ${analysis.volatilityRisk.alignedSessionCount}d`
                    : 'Unavailable'}
                </div>
              </div>

              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">Concentration</div>
                <div
                  className={`text-base font-bold mt-0.5 ${
                    analysis.concentration.concentrationLabel === 'Very High'
                      ? 'text-[#ff4444]'
                      : analysis.concentration.concentrationLabel === 'High'
                      ? 'text-[#ff9900]'
                      : analysis.concentration.concentrationLabel === 'Moderate'
                      ? 'text-zinc-100'
                      : analysis.concentration.concentrationLabel === 'Low'
                      ? 'text-[#00ff00]'
                      : 'text-zinc-500'
                  }`}
                >
                  {analysis.concentration.concentrationLabel}
                </div>
                <div className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                  Top 5: {formatPct(analysis.concentration.top5WeightPct)}
                  {analysis.concentration.hhi !== null
                    ? ` · HHI ${Math.round(analysis.concentration.hhi)}`
                    : ''}
                </div>
              </div>

              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">
                  {analysis.totalUnrealizedGain !== null ? 'Unrealized P&L' : 'Max Drawdown'}
                </div>
                {analysis.totalUnrealizedGain !== null ? (
                  <>
                    <div
                      className={`text-base font-bold tabular-nums mt-0.5 ${
                        analysis.totalUnrealizedGain >= 0 ? 'text-[#00ff00]' : 'text-[#ff4444]'
                      }`}
                    >
                      {analysis.totalUnrealizedGain >= 0 ? '+' : ''}
                      {formatUsd(analysis.totalUnrealizedGain, true)}
                    </div>
                    <div className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                      {formatPct(analysis.totalUnrealizedGainPct, 2, true)} ({analysis.costBasisCoverageCount}/{analysis.holdingCount} costed)
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-base font-bold text-[#ff4444] tabular-nums mt-0.5">
                      {analysis.volatilityRisk.maxDrawdownPct !== null
                        ? `${analysis.volatilityRisk.maxDrawdownPct.toFixed(1)}%`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      {analysis.volatilityRisk.maxDrawdownPeakDate &&
                      analysis.volatilityRisk.maxDrawdownTroughDate
                        ? `${analysis.volatilityRisk.maxDrawdownPeakDate} → ${analysis.volatilityRisk.maxDrawdownTroughDate}`
                        : 'Cost basis not entered'}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Transparent Rule-Based Risk Drivers */}
            <div className="bg-black border border-[#222] rounded px-3 py-2.5 space-y-1.5">
              <div className="text-zinc-500 uppercase font-bold text-[9.5px] tracking-wider">
                RULE DRIVERS:
              </div>
              <ul className="list-disc pl-4 space-y-1 text-[11px] leading-relaxed text-zinc-300 marker:text-zinc-500">
                {analysis.overallRisk.drivers.map((drv, idx) => (
                  <li key={idx}>{drv}</li>
                ))}
              </ul>
            </div>
          </section>

          {/* ================================================================ */}
          {/* SECTION 2: PORTFOLIO CONCENTRATION                               */}
          {/* ================================================================ */}
          <section id="prm-concentration" className="bg-[#050505] border border-[#333] rounded p-3.5 space-y-3">
            <div className="border-b border-[#2a2a2a] pb-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                  PORTFOLIO CONCENTRATION
                </h2>
                <InfoTooltipIcon
                  label="Concentration info"
                  title="Concentration Analysis"
                  content="Evaluates single-name weight, Top 5 / Top 10 concentration, Herfindahl-Hirschman Index (HHI), effective equal-weight positions (1/Σw²), and configurable threshold breaches."
                />
              </div>
              <span className="text-[10px] text-zinc-500 tabular-nums">
                THRESHOLDS: SINGLE &gt;{thresholds.maxSinglePositionPct}% · TOP 5 &gt;{thresholds.maxTop5Pct}% · SECTOR &gt;{thresholds.maxSectorPct}%
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">Top 5 Weight</div>
                <div
                  className={`text-sm font-bold tabular-nums mt-0.5 ${
                    analysis.concentration.top5WeightPct > thresholds.maxTop5Pct
                      ? 'text-[#ff4444]'
                      : 'text-white'
                  }`}
                >
                  {formatPct(analysis.concentration.top5WeightPct)}
                </div>
              </div>
              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">Top 10 Weight</div>
                <div className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {formatPct(analysis.concentration.top10WeightPct)}
                </div>
              </div>
              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">Single-Stock Exp.</div>
                <div className="text-sm font-bold text-zinc-100 tabular-nums mt-0.5">
                  {formatPct(analysis.concentration.singleStockWeightPct)}
                </div>
                <div className="text-[9.5px] text-zinc-500 tabular-nums">
                  ETFs/Funds: {formatPct(analysis.concentration.etfFundWeightPct)}
                </div>
              </div>
              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">HHI Index</div>
                <div className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {analysis.concentration.hhi !== null
                    ? Math.round(analysis.concentration.hhi).toLocaleString('en-US')
                    : '—'}
                </div>
                <div className="text-[9.5px] text-zinc-500">0–10,000 scale</div>
              </div>
              <div className="bg-black border border-[#242424] rounded p-2.5">
                <div className="text-[9.5px] text-zinc-500 uppercase font-bold">Effective Holdings</div>
                <div className="text-sm font-bold text-[#3498db] tabular-nums mt-0.5">
                  {analysis.concentration.effectivePositions !== null
                    ? analysis.concentration.effectivePositions.toFixed(1)
                    : '—'}
                </div>
                <div className="text-[9.5px] text-zinc-500">1 / Σw² equivalent</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Largest Holdings Weight Chart */}
              <div className="bg-black border border-[#242424] rounded p-3 space-y-2">
                <div className="text-[10px] text-zinc-400 uppercase font-bold flex items-center justify-between">
                  <span>LARGEST HOLDINGS BY PORTFOLIO WEIGHT</span>
                  <span className="text-zinc-500">LIMIT: {thresholds.maxSinglePositionPct}%</span>
                </div>
                <div className="space-y-1.5">
                  {analysis.positions
                    .filter((p) => p.weightPct !== null)
                    .slice(0, 10)
                    .map((pos) => {
                      const w = pos.weightPct ?? 0;
                      const barPct = Math.min(100, Math.max(1.5, w));
                      const barColor = pos.isOversized
                        ? '#ff4444'
                        : pos.isUnderallocated
                        ? '#71717a'
                        : '#ff9900';
                      return (
                        <div key={pos.id} className="grid grid-cols-12 items-center gap-2 text-[10.5px]">
                          <div className="col-span-2 truncate">
                            <button
                              type="button"
                              onClick={() => onSelectTicker?.(pos.ticker)}
                              className="text-[#3498db] hover:text-[#ff9900] font-bold cursor-pointer"
                            >
                              {pos.ticker}
                            </button>
                          </div>
                          <div className="col-span-7">
                            <svg className="w-full h-3.5 block" viewBox="0 0 200 12" preserveAspectRatio="none">
                              <rect x="0" y="1" width="200" height="10" fill="#141414" rx="1.5" />
                              <rect
                                x="0"
                                y="1"
                                width={(barPct / 100) * 200}
                                height="10"
                                fill={barColor}
                                rx="1.5"
                              />
                              <line
                                x1={(Math.min(100, thresholds.maxSinglePositionPct) / 100) * 200}
                                y1="0"
                                x2={(Math.min(100, thresholds.maxSinglePositionPct) / 100) * 200}
                                y2="12"
                                stroke="#ffffff"
                                strokeOpacity="0.45"
                                strokeDasharray="2 2"
                                strokeWidth="1"
                              />
                            </svg>
                          </div>
                          <div
                            className={`col-span-3 text-right tabular-nums font-bold ${
                              pos.isOversized ? 'text-[#ff4444]' : 'text-zinc-200'
                            }`}
                          >
                            {w.toFixed(1)}%
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Concentration Warnings & Distribution Assessment */}
              <div className="bg-black border border-[#242424] rounded p-3 space-y-2.5">
                <div className="text-[10px] text-zinc-400 uppercase font-bold">
                  CONCENTRATION WARNINGS &amp; BALANCE
                </div>
                <div className="text-[11px] text-zinc-300 border-b border-[#1c1c1c] pb-2">
                  {analysis.concentration.distributionAssessment}
                </div>
                {analysis.concentration.warnings.length === 0 ? (
                  <div className="text-[11px] text-[#00ff00] py-2">
                    No positions or sectors currently exceed your configured concentration thresholds.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[272px] overflow-y-auto">
                    {analysis.concentration.warnings.map((warn) => (
                      <div
                        key={warn.id}
                        className={`rounded border px-2.5 py-2 text-[10.5px] ${
                          warn.severity === 'high'
                            ? 'border-[#ff4444]/40 bg-[#ff4444]/10 text-[#ff8888]'
                            : 'border-[#ff9900]/40 bg-[#ff9900]/10 text-amber-300'
                        }`}
                      >
                        <div className="font-bold uppercase text-[10px]">{warn.title}</div>
                        <div className="text-zinc-300 mt-0.5">{warn.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ================================================================ */}
          {/* SECTION 3: SECTOR & INDUSTRY EXPOSURE                            */}
          {/* ================================================================ */}
          <section id="prm-sectors" className="bg-[#050505] border border-[#333] rounded p-3.5 space-y-3">
            <div className="border-b border-[#2a2a2a] pb-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                  SECTOR &amp; INDUSTRY EXPOSURE
                </h2>
                <InfoTooltipIcon
                  label="Sector Exposure info"
                  title="Sector & Industry Classifications"
                  content="Classifications come from verified security metadata (Yahoo Finance Search and single-sector ETF mapping). Broad ETFs and securities lacking verified classifications remain explicitly Unclassified."
                />
              </div>
              <div className="text-[10px] text-zinc-500 tabular-nums">
                CLASSIFIED EQUITY: {formatPct(analysis.sectorExposure.classifiedEquityPct)} · UNCLASSIFIED:{' '}
                {formatPct(analysis.sectorExposure.unclassifiedEquityPct)} · CASH: {formatPct(analysis.cashWeightPct)}
              </div>
            </div>

            {!analysis.sectorExposure.benchmarkAvailable &&
              analysis.sectorExposure.benchmarkUnavailableReason && (
                <div className="bg-black border border-[#2a2a2a] rounded px-3 py-1.5 text-[10px] text-zinc-400">
                  <span className="text-[#ff9900] font-bold uppercase mr-1.5">S&amp;P 500 BENCHMARK NOTE:</span>
                  {analysis.sectorExposure.benchmarkUnavailableReason}
                </div>
              )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Sector Allocation Visual Chart & Table */}
              <div className="bg-black border border-[#242424] rounded p-3 space-y-3">
                <div className="text-[10px] text-zinc-400 uppercase font-bold">
                  SECTOR ALLOCATION BREAKDOWN
                </div>

                {/* Stacked Bar Visual */}
                {analysis.sectorExposure.sectors.length > 0 && (
                  <svg className="w-full h-5 block rounded overflow-hidden" viewBox="0 0 400 16" preserveAspectRatio="none">
                    {(() => {
                      let cursorX = 0;
                      const segments = analysis.sectorExposure.sectors.map((sec, idx) => {
                        const segW = (sec.portfolioWeightPct / 100) * 400;
                        const x = cursorX;
                        cursorX += segW;
                        return (
                          <rect
                            key={sec.sector}
                            x={x}
                            y={0}
                            width={Math.max(0.5, segW)}
                            height={16}
                            fill={sec.isClassified ? SECTOR_BAR_COLORS[idx % SECTOR_BAR_COLORS.length] : '#52525b'}
                          >
                            <title>{`${sec.sector}: ${sec.portfolioWeightPct.toFixed(1)}%`}</title>
                          </rect>
                        );
                      });
                      if (analysis.cashWeightPct > 0) {
                        segments.push(
                          <rect
                            key="cash-seg"
                            x={cursorX}
                            y={0}
                            width={Math.max(0.5, (analysis.cashWeightPct / 100) * 400)}
                            height={16}
                            fill="#1e3a5f"
                          >
                            <title>{`Cash: ${analysis.cashWeightPct.toFixed(1)}%`}</title>
                          </rect>
                        );
                      }
                      return segments;
                    })()}
                  </svg>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[10.5px] border-collapse">
                    <thead>
                      <tr className="border-b border-[#2a2a2a] text-zinc-500 text-[9.5px] uppercase">
                        <th className="py-1.5 pr-2">Sector</th>
                        <th className="py-1.5 px-2 text-right">Port %</th>
                        <th className="py-1.5 px-2 text-right">Value</th>
                        <th className="py-1.5 px-2">Largest Holdings</th>
                        <th className="py-1.5 pl-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#181818]">
                      {analysis.sectorExposure.sectors.map((sec, idx) => (
                        <tr key={sec.sector} className="hover:bg-[#101010]">
                          <td className="py-1.5 pr-2 font-semibold text-zinc-100 whitespace-nowrap">
                            <svg
                              width="8"
                              height="8"
                              viewBox="0 0 8 8"
                              className="inline-block mr-1.5 align-middle"
                              aria-hidden="true"
                            >
                              <rect
                                width="8"
                                height="8"
                                rx="1.5"
                                fill={
                                  sec.isClassified
                                    ? SECTOR_BAR_COLORS[idx % SECTOR_BAR_COLORS.length]
                                    : '#52525b'
                                }
                              />
                            </svg>
                            {sec.sector}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums font-bold text-white">
                            {sec.portfolioWeightPct.toFixed(1)}%
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-zinc-300">
                            {formatUsd(sec.marketValue, true)}
                          </td>
                          <td className="py-1.5 px-2 text-zinc-400">
                            {sec.largestHoldings
                              .map((h) => `${h.ticker} (${h.weightPct.toFixed(1)}%)`)
                              .join(', ')}
                          </td>
                          <td className="py-1.5 pl-2 text-right">
                            <span
                              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                                sec.status === 'overweight'
                                  ? 'text-[#ff4444] border-[#ff4444]/40 bg-[#ff4444]/10'
                                  : sec.status === 'underweight'
                                  ? 'text-zinc-400 border-zinc-700 bg-zinc-900'
                                  : sec.status === 'unclassified'
                                  ? 'text-zinc-400 border-zinc-700 bg-zinc-900'
                                  : 'text-[#00ff00] border-[#00ff00]/30 bg-[#00ff00]/10'
                              }`}
                            >
                              {sec.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {analysis.cashBalance > 0 && (
                        <tr className="hover:bg-[#101010]">
                          <td className="py-1.5 pr-2 font-semibold text-[#3498db]">Cash (USD)</td>
                          <td className="py-1.5 px-2 text-right tabular-nums font-bold text-[#3498db]">
                            {analysis.cashWeightPct.toFixed(1)}%
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-zinc-300">
                            {formatUsd(analysis.cashBalance, true)}
                          </td>
                          <td className="py-1.5 px-2 text-zinc-500">Liquid Reserve</td>
                          <td className="py-1.5 pl-2 text-right text-[9px] text-zinc-500 uppercase">CASH</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Industry Breakdown Table */}
              <div className="bg-black border border-[#242424] rounded p-3 space-y-2.5">
                <div className="text-[10px] text-zinc-400 uppercase font-bold">
                  INDUSTRY ALLOCATION BREAKDOWN ({analysis.sectorExposure.industries.length})
                </div>
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-[10.5px] border-collapse">
                    <thead>
                      <tr className="border-b border-[#2a2a2a] text-zinc-500 text-[9.5px] uppercase">
                        <th className="py-1.5 pr-2">Industry</th>
                        <th className="py-1.5 px-2">Sector</th>
                        <th className="py-1.5 px-2 text-right">Weight</th>
                        <th className="py-1.5 pl-2">Holdings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#181818]">
                      {analysis.sectorExposure.industries.map((ind) => (
                        <tr key={`${ind.sector}-${ind.industry}`} className="hover:bg-[#101010]">
                          <td className="py-1.5 pr-2 text-zinc-100 font-medium">{ind.industry}</td>
                          <td className="py-1.5 px-2 text-zinc-500">{ind.sector}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums font-bold text-white">
                            {ind.portfolioWeightPct.toFixed(1)}%
                          </td>
                          <td className="py-1.5 pl-2 text-[#3498db] font-bold">
                            {ind.tickers.join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          {/* ================================================================ */}
          {/* SECTION 4: POSITION SIZING & ALLOCATION                          */}
          {/* ================================================================ */}
          <section id="prm-positions" className="bg-[#050505] border border-[#333] rounded p-3.5 space-y-3">
            <div className="border-b border-[#2a2a2a] pb-1.5 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                POSITION SIZING &amp; ALLOCATION ({analysis.holdingCount})
              </h2>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="text-[#ff4444]">
                  OVERSIZED (&gt;{thresholds.maxSinglePositionPct}%): {analysis.concentration.oversizedPositions.length}
                </span>
                <span className="text-zinc-400">
                  UNDERALLOCATED (&lt;{thresholds.minPositionPct}%): {analysis.concentration.underallocatedPositions.length}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto bg-black border border-[#242424] rounded">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead>
                  <tr className="bg-[#0b0b0b] border-b border-[#2a2a2a] text-zinc-500 text-[9.5px] uppercase select-none">
                    {[
                      { key: 'positionRank' as SortKey, label: '#', align: 'left' },
                      { key: 'ticker' as SortKey, label: 'Ticker / Company', align: 'left' },
                      { key: 'shares' as SortKey, label: 'Shares', align: 'right' },
                      { key: 'currentPrice' as SortKey, label: 'Price', align: 'right' },
                      { key: 'marketValue' as SortKey, label: 'Market Value', align: 'right' },
                      { key: 'weightPct' as SortKey, label: 'Alloc %', align: 'right' },
                    ].map((col) => (
                      <th
                        key={col.key}
                        className={`py-2 px-2.5 whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(col.key)}
                          className="inline-flex items-center gap-1 hover:text-[#ff9900] uppercase font-bold cursor-pointer"
                        >
                          <span>{col.label}</span>
                          {sortKey === col.key &&
                            (sortDir === 'desc' ? <ArrowDown size={9} /> : <ArrowUp size={9} />)}
                        </button>
                      </th>
                    ))}
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Cost Basis</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('unrealizedGain')}
                        className="inline-flex items-center gap-1 hover:text-[#ff9900] uppercase font-bold cursor-pointer"
                      >
                        <span>Unrealized P&amp;L</span>
                        {sortKey === 'unrealizedGain' &&
                          (sortDir === 'desc' ? <ArrowDown size={9} /> : <ArrowUp size={9} />)}
                      </button>
                    </th>
                    <th className="py-2 px-2.5 text-center whitespace-nowrap">Flags</th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181818]">
                  {sortedPositions.map((pos) => {
                    const isEditing = editingId === pos.id;
                    return (
                      <tr key={pos.id} className="hover:bg-[#101010] transition-colors">
                        <td className="py-2 px-2.5 text-zinc-500 tabular-nums">
                          {pos.positionRank ?? '—'}
                        </td>
                        <td className="py-2 px-2.5 min-w-[160px]">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onSelectTicker?.(pos.ticker)}
                              className="text-[#3498db] hover:text-[#ff9900] font-bold cursor-pointer"
                              title={`Inspect ${pos.ticker} in Graph Price`}
                            >
                              {pos.ticker}
                            </button>
                            <span className="text-[9px] text-zinc-500 uppercase">{pos.instrumentType}</span>
                          </div>
                          <div className="text-[10px] text-zinc-400 truncate max-w-[200px]">
                            {pos.name}
                          </div>
                        </td>
                        <td className="py-2 px-2.5 text-right tabular-nums text-zinc-200">
                          {isEditing ? (
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={editSharesDraft}
                              onChange={(e) => setEditSharesDraft(e.target.value)}
                              className="w-20 bg-[#080808] border border-[#3498db] rounded px-1.5 py-0.5 text-right text-xs text-white tabular-nums outline-none"
                            />
                          ) : (
                            pos.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })
                          )}
                        </td>
                        <td className="py-2 px-2.5 text-right tabular-nums text-zinc-200">
                          {pos.currentPrice !== null ? (
                            `$${pos.currentPrice.toFixed(2)}`
                          ) : (
                            <span className="text-[#ff4444]">Unavailable</span>
                          )}
                        </td>
                        <td className="py-2 px-2.5 text-right tabular-nums font-bold text-white">
                          {formatUsd(pos.marketValue)}
                        </td>
                        <td
                          className={`py-2 px-2.5 text-right tabular-nums font-bold ${
                            pos.isOversized
                              ? 'text-[#ff4444]'
                              : pos.isUnderallocated
                              ? 'text-zinc-500'
                              : 'text-zinc-100'
                          }`}
                        >
                          {formatPct(pos.weightPct)}
                        </td>
                        <td className="py-2 px-2.5 text-right tabular-nums text-zinc-300">
                          {isEditing ? (
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={editCostDraft}
                              onChange={(e) => setEditCostDraft(e.target.value)}
                              placeholder="Optional"
                              className="w-20 bg-[#080808] border border-[#3498db] rounded px-1.5 py-0.5 text-right text-xs text-white tabular-nums outline-none"
                            />
                          ) : pos.avgCostBasis !== null ? (
                            `$${pos.avgCostBasis.toFixed(2)}`
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 px-2.5 text-right tabular-nums whitespace-nowrap">
                          {pos.unrealizedGain !== null ? (
                            <span
                              className={
                                pos.unrealizedGain >= 0 ? 'text-[#00ff00] font-semibold' : 'text-[#ff4444] font-semibold'
                              }
                            >
                              {pos.unrealizedGain >= 0 ? '+' : ''}
                              {formatUsd(pos.unrealizedGain)} ({formatPct(pos.unrealizedGainPct, 1, true)})
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="py-2 px-2.5 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {pos.isOversized && (
                              <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded border border-[#ff4444]/40 bg-[#ff4444]/10 text-[#ff4444]">
                                OVERSIZED
                              </span>
                            )}
                            {pos.isUnderallocated && (
                              <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-400">
                                SMALL
                              </span>
                            )}
                            {pos.priceUnavailable && (
                              <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400">
                                NO PRICE
                              </span>
                            )}
                            {!pos.isOversized && !pos.isUnderallocated && !pos.priceUnavailable && (
                              <span className="text-[9px] text-zinc-600">OK</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2.5 text-right whitespace-nowrap">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleInlineEditSave(pos)}
                                aria-label={`Save ${pos.ticker}`}
                                className="p-1 rounded border border-[#00ff00]/50 text-[#00ff00] hover:bg-[#00ff00]/15 cursor-pointer"
                              >
                                <Check size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                aria-label="Cancel edit"
                                className="p-1 rounded border border-[#333] text-zinc-400 hover:text-white cursor-pointer"
                              >
                                <X size={11} />
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(pos.id);
                                  setEditSharesDraft(String(pos.shares));
                                  setEditCostDraft(
                                    pos.avgCostBasis !== null ? String(pos.avgCostBasis) : ''
                                  );
                                }}
                                title={`Edit ${pos.ticker}`}
                                aria-label={`Edit ${pos.ticker}`}
                                className="p-1 rounded border border-[#2a2a2a] text-zinc-400 hover:text-[#ff9900] hover:border-[#ff9900] cursor-pointer"
                              >
                                <Edit3 size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemovePosition(pos.id)}
                                title={`Remove ${pos.ticker}`}
                                aria-label={`Remove ${pos.ticker}`}
                                className="p-1 rounded border border-[#2a2a2a] text-zinc-500 hover:text-[#ff4444] hover:border-[#ff4444] cursor-pointer"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Cash Row */}
                  {analysis.cashBalance > 0 && (
                    <tr className="bg-[#090d12]">
                      <td className="py-2 px-2.5 text-zinc-600">—</td>
                      <td className="py-2 px-2.5">
                        <span className="text-[#3498db] font-bold">CASH</span>
                        <div className="text-[10px] text-zinc-500">US Dollar Cash Position</div>
                      </td>
                      <td className="py-2 px-2.5 text-right text-zinc-500">—</td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-zinc-400">$1.00</td>
                      <td className="py-2 px-2.5 text-right tabular-nums font-bold text-[#3498db]">
                        {formatUsd(analysis.cashBalance)}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums font-bold text-[#3498db]">
                        {formatPct(analysis.cashWeightPct)}
                      </td>
                      <td className="py-2 px-2.5 text-right text-zinc-600">—</td>
                      <td className="py-2 px-2.5 text-right text-zinc-600">—</td>
                      <td className="py-2 px-2.5 text-center text-[9px] text-[#3498db] uppercase font-bold">
                        LIQUID
                      </td>
                      <td className="py-2 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => openManager('manual')}
                          className="text-[10px] text-[#3498db] hover:text-[#ff9900] uppercase font-bold cursor-pointer"
                        >
                          EDIT
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ================================================================ */}
          {/* SECTION 5: VOLATILITY & PORTFOLIO RISK                           */}
          {/* ================================================================ */}
          <section id="prm-volatility" className="bg-[#050505] border border-[#333] rounded p-3.5 space-y-3">
            <div className="border-b border-[#2a2a2a] pb-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                  VOLATILITY &amp; PORTFOLIO RISK
                </h2>
                <InfoTooltipIcon
                  label="Volatility methodology info"
                  title="Covariance Volatility Methodology"
                  content={analysis.volatilityRisk.methodologySummary}
                  maxWidth={320}
                />
              </div>
              <span className="text-[10px] text-zinc-500 tabular-nums">
                {analysis.volatilityRisk.startDate && analysis.volatilityRisk.endDate
                  ? `${analysis.volatilityRisk.lookbackLabel} (${analysis.volatilityRisk.startDate} → ${analysis.volatilityRisk.endDate} · ${analysis.volatilityRisk.alignedSessionCount} sessions)`
                  : `Lookback: ${analysis.volatilityRisk.lookbackLabel}`}
              </span>
            </div>

            <div className="text-[10px] text-zinc-400 bg-black border border-[#222] rounded px-3 py-1.5">
              <span className="text-zinc-500 uppercase font-bold mr-1.5">METHODOLOGY:</span>
              {analysis.volatilityRisk.methodologySummary}
            </div>

            {analysis.volatilityRisk.unavailableReason ? (
              <div className="bg-black border border-[#2a2a2a] rounded p-4 text-xs text-zinc-400">
                {analysis.volatilityRisk.unavailableReason}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="bg-black border border-[#242424] rounded p-2.5">
                    <div className="text-[9.5px] text-zinc-500 uppercase font-bold">
                      Portfolio Volatility (Cov)
                    </div>
                    <div className="text-base font-bold text-white tabular-nums mt-0.5">
                      {formatPct(analysis.volatilityRisk.portfolioVolatilityPct)}
                    </div>
                    <div className="text-[9.5px] text-zinc-500 tabular-nums">
                      Weighted Avg Vol: {formatPct(analysis.volatilityRisk.weightedAvgHoldingVolPct)}
                    </div>
                  </div>
                  <div className="bg-black border border-[#242424] rounded p-2.5">
                    <div className="text-[9.5px] text-zinc-500 uppercase font-bold">
                      Portfolio Beta vs SPY
                    </div>
                    <div className="text-base font-bold text-white tabular-nums mt-0.5">
                      {analysis.volatilityRisk.portfolioBetaVsSpy !== null
                        ? analysis.volatilityRisk.portfolioBetaVsSpy.toFixed(2)
                        : '—'}
                    </div>
                    <div className="text-[9.5px] text-zinc-500 tabular-nums">
                      {analysis.volatilityRisk.betaObservationCount} aligned SPY days
                    </div>
                  </div>
                  <div className="bg-black border border-[#242424] rounded p-2.5">
                    <div className="text-[9.5px] text-zinc-500 uppercase font-bold">
                      Historical Max Drawdown
                    </div>
                    <div className="text-base font-bold text-[#ff4444] tabular-nums mt-0.5">
                      {formatPct(analysis.volatilityRisk.maxDrawdownPct)}
                    </div>
                    <div className="text-[9.5px] text-zinc-500 tabular-nums">
                      {analysis.volatilityRisk.maxDrawdownPeakDate &&
                      analysis.volatilityRisk.maxDrawdownTroughDate
                        ? `${analysis.volatilityRisk.maxDrawdownPeakDate} → ${analysis.volatilityRisk.maxDrawdownTroughDate}`
                        : '—'}
                    </div>
                  </div>
                  <div className="bg-black border border-[#242424] rounded p-2.5">
                    <div className="text-[9.5px] text-zinc-500 uppercase font-bold">
                      Diversification Ratio
                    </div>
                    <div className="text-base font-bold text-[#00ff00] tabular-nums mt-0.5">
                      {analysis.volatilityRisk.diversificationRatio !== null
                        ? `${analysis.volatilityRisk.diversificationRatio.toFixed(2)}x`
                        : '—'}
                    </div>
                    <div className="text-[9.5px] text-zinc-500">
                      Coverage: {formatPct(analysis.volatilityRisk.coveredTotalWeightPct)}
                    </div>
                  </div>
                </div>

                {/* Historical Drawdown SVG Chart */}
                {analysis.volatilityRisk.drawdownCurve.length >= 2 && (
                  <div className="bg-black border border-[#242424] rounded p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-zinc-400 uppercase font-bold">
                      <span>HISTORICAL CONSTANT-WEIGHT PORTFOLIO DRAWDOWN CURVE</span>
                      <span className="text-[#ff4444] tabular-nums">
                        MAX DD: {formatPct(analysis.volatilityRisk.maxDrawdownPct)}
                      </span>
                    </div>
                    <svg className="w-full h-28 block" viewBox="0 0 600 96" preserveAspectRatio="none">
                      {(() => {
                        const curve = analysis.volatilityRisk.drawdownCurve;
                        const minDd = Math.min(-5, ...curve.map((c) => c.drawdownPct));
                        const pts = curve.map((c, idx) => {
                          const x = (idx / Math.max(1, curve.length - 1)) * 600;
                          const y = (Math.abs(c.drawdownPct) / Math.abs(minDd)) * 84 + 4;
                          return `${x.toFixed(1)},${y.toFixed(1)}`;
                        });
                        const areaPath = `M 0,4 L ${pts.join(' L ')} L 600,4 Z`;
                        const linePath = `M ${pts.join(' L ')}`;
                        return (
                          <>
                            <line x1="0" y1="4" x2="600" y2="4" stroke="#333" strokeWidth="1" />
                            <line x1="0" y1="46" x2="600" y2="46" stroke="#1f1f1f" strokeDasharray="3 3" strokeWidth="1" />
                            <path d={areaPath} fill="#ff4444" fillOpacity="0.18" />
                            <path d={linePath} fill="none" stroke="#ff4444" strokeWidth="1.5" />
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {/* Risk Contribution by Holding */}
                  <div className="lg:col-span-2 bg-black border border-[#242424] rounded p-3 space-y-2">
                    <div className="text-[10px] text-zinc-400 uppercase font-bold">
                      RISK CONTRIBUTION &amp; VOLATILITY BY HOLDING
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[10.5px] border-collapse">
                        <thead>
                          <tr className="border-b border-[#2a2a2a] text-zinc-500 text-[9.5px] uppercase">
                            <th className="py-1.5 pr-2">Ticker</th>
                            <th className="py-1.5 px-2 text-right">Weight</th>
                            <th className="py-1.5 px-2 text-right">Risk Share</th>
                            <th className="py-1.5 px-2 text-right">Ann. Vol</th>
                            <th className="py-1.5 px-2 text-right">Beta (SPY)</th>
                            <th className="py-1.5 pl-2 text-right">Max DD</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#181818]">
                          {analysis.volatilityRisk.largestVolContributors.map((pos) => {
                            const rc = pos.riskContributionPct ?? 0;
                            const weight = pos.weightPct ?? 0;
                            const disproportionate = rc > weight * 1.25 && rc > 10;
                            return (
                              <tr key={pos.id} className="hover:bg-[#101010]">
                                <td className="py-1.5 pr-2 font-bold text-[#3498db]">{pos.ticker}</td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-zinc-300">
                                  {weight.toFixed(1)}%
                                </td>
                                <td
                                  className={`py-1.5 px-2 text-right tabular-nums font-bold ${
                                    disproportionate ? 'text-[#ff4444]' : 'text-white'
                                  }`}
                                >
                                  {rc.toFixed(1)}%
                                </td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-zinc-200">
                                  {formatPct(pos.annualizedVolatilityPct)}
                                </td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-zinc-200">
                                  {pos.betaVsSpy !== null ? pos.betaVsSpy.toFixed(2) : '—'}
                                </td>
                                <td className="py-1.5 pl-2 text-right tabular-nums text-[#ff4444]">
                                  {formatPct(pos.maxDrawdownPct)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Risk Concentration by Sector */}
                  <div className="bg-black border border-[#242424] rounded p-3 space-y-2">
                    <div className="text-[10px] text-zinc-400 uppercase font-bold">
                      RISK CONCENTRATION BY SECTOR
                    </div>
                    <div className="space-y-2">
                      {analysis.volatilityRisk.riskBySector.map((sec) => (
                        <div key={sec.sector} className="space-y-0.5 text-[10.5px]">
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-200 truncate">{sec.sector}</span>
                            <span className="tabular-nums font-bold text-[#ff9900]">
                              {sec.riskContributionPct.toFixed(1)}% risk
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[9.5px] text-zinc-500">
                            <span>Capital weight: {sec.portfolioWeightPct.toFixed(1)}%</span>
                            <span>
                              Ratio:{' '}
                              {sec.portfolioWeightPct > 0
                                ? `${(sec.riskContributionPct / sec.portfolioWeightPct).toFixed(2)}x`
                                : '—'}
                            </span>
                          </div>
                          <svg className="w-full h-2 block" viewBox="0 0 200 6" preserveAspectRatio="none">
                            <rect x="0" y="0" width="200" height="6" fill="#161616" rx="1" />
                            <rect
                              x="0"
                              y="0"
                              width={Math.min(200, Math.max(2, (sec.riskContributionPct / 100) * 200))}
                              height="6"
                              fill={sec.riskContributionPct > 45 ? '#ff4444' : '#ff9900'}
                              rx="1"
                            />
                          </svg>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {analysis.volatilityRisk.excludedFromRiskModel.length > 0 && (
              <div className="text-[10px] text-amber-400 bg-black border border-amber-500/30 rounded px-3 py-1.5">
                Excluded from covariance model:{' '}
                {analysis.volatilityRisk.excludedFromRiskModel
                  .map((e) => `${e.ticker} (${e.reason})`)
                  .join(' · ')}
              </div>
            )}
          </section>

          {/* ================================================================ */}
          {/* SECTION 6: PORTFOLIO DIVERSIFICATION (CORR INTEGRATION)          */}
          {/* ================================================================ */}
          <section id="prm-diversification" className="bg-[#050505] border border-[#333] rounded p-3.5 space-y-3">
            <div className="border-b border-[#2a2a2a] pb-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                  PORTFOLIO DIVERSIFICATION &amp; CORRELATION RISK
                </h2>
                <InfoTooltipIcon
                  label="Diversification CORR info"
                  title="Powered by CORR Engine"
                  content="Reuses Quorix's CORR Pearson daily-return correlation engine directly to identify correlated clusters, sector overlap, and holdings offering limited diversification."
                />
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span
                  className={`px-2 py-0.5 rounded border font-bold uppercase ${toneBadgeClass(
                    analysis.diversification.assessmentTone
                  )}`}
                >
                  {analysis.diversification.assessmentLabel}
                </span>
                {(onOpenCorrWorkspace || onExecuteCommand) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenCorrWorkspace) {
                        onOpenCorrWorkspace();
                      } else if (onExecuteCommand) {
                        onExecuteCommand('CORR');
                      }
                    }}
                    className="text-[#3498db] hover:text-[#ff9900] font-bold uppercase cursor-pointer"
                  >
                    OPEN IN CORR →
                  </button>
                )}
              </div>
            </div>

            <div className="bg-black border border-[#242424] rounded p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1 max-w-3xl">
                <div className={`text-xs font-bold ${toneTextClass(analysis.diversification.assessmentTone)}`}>
                  {analysis.diversification.assessmentSummary}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-zinc-400">
                  {analysis.diversification.assessmentDrivers.map((d, i) => (
                    <span key={i}>• {d}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4 text-right tabular-nums">
                <div>
                  <div className="text-[9.5px] text-zinc-500 uppercase">Weighted Avg r</div>
                  <div className="text-sm font-bold text-white">
                    {formatCorrelationValue(analysis.diversification.weightedAvgPairwiseCorrelation)}
                  </div>
                </div>
                <div>
                  <div className="text-[9.5px] text-zinc-500 uppercase">Clustered Weight</div>
                  <div
                    className={`text-sm font-bold ${
                      analysis.diversification.concentratedCorrelatedWeightPct >= 50
                        ? 'text-[#ff4444]'
                        : 'text-zinc-100'
                    }`}
                  >
                    {formatPct(analysis.diversification.concentratedCorrelatedWeightPct)}
                  </div>
                </div>
              </div>
            </div>

            {/* Portfolio Correlation Matrix (Direct CORR Engine Output) */}
            {analysis.diversification.matrix.symbols.length >= 2 ? (
              <div className="bg-black border border-[#242424] rounded p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                  <span className="text-zinc-400 uppercase font-bold">
                    PORTFOLIO CORRELATION MATRIX ({lookback} DAILY RETURNS · CORR ENGINE)
                  </span>
                  <span className="text-zinc-500">
                    RED = HIGH POSITIVE CO-MOVEMENT (LIMITED DIVERSIFICATION) · GREEN = LOW / NEGATIVE
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="border-collapse text-[10px] font-mono">
                    <thead>
                      <tr>
                        <th className="p-1.5 text-left text-zinc-500 border border-[#1f1f1f] bg-[#0a0a0a]">
                          TICKER
                        </th>
                        {analysis.diversification.matrix.symbols.map((sym) => (
                          <th
                            key={`col-${sym}`}
                            className="p-1.5 text-center text-[#3498db] font-bold border border-[#1f1f1f] bg-[#0a0a0a] min-w-[54px]"
                          >
                            {sym}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.diversification.matrix.cells.map((row, rIdx) => {
                        const rowSym = analysis.diversification.matrix.symbols[rIdx];
                        return (
                          <tr key={`row-${rowSym}`}>
                            <td className="p-1.5 font-bold text-[#3498db] border border-[#1f1f1f] bg-[#0a0a0a]">
                              {rowSym}
                            </td>
                            {row.map((cell) => (
                              <td
                                key={`${cell.rowSymbol}-${cell.colSymbol}`}
                                className="p-0.5 border border-[#1a1a1a]"
                              >
                                <TerminalTooltip
                                  title={`${cell.rowSymbol} / ${cell.colSymbol}`}
                                  content={
                                    cell.correlation !== null
                                      ? `Pearson r = ${formatCorrelationValue(cell.correlation)} (${cell.interpretation.label}) across ${cell.observationCount} aligned daily sessions.`
                                      : cell.unavailableReason || 'Correlation unavailable.'
                                  }
                                >
                                  <div
                                    className={`w-full min-w-[48px] text-center py-1 px-1 rounded-xs border tabular-nums font-bold ${getMatrixCellClasses(
                                      cell.interpretation.id,
                                      cell.isDiagonal
                                    )}`}
                                  >
                                    {cell.isDiagonal ? '1.00' : formatCorrelationValue(cell.correlation)}
                                  </div>
                                </TerminalTooltip>
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-black border border-[#242424] rounded p-3 text-xs text-zinc-500">
                Add at least 2 priced holdings with daily historical data to populate the portfolio correlation matrix.
              </div>
            )}

            {/* Clusters, Highly Correlated Pairs & Limited Diversification Holdings */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Correlation Clusters */}
              <div className="bg-black border border-[#242424] rounded p-3 space-y-2">
                <div className="text-[10px] text-zinc-400 uppercase font-bold">
                  CORRELATION CLUSTERS (r ≥ {thresholds.highCorrelationThreshold.toFixed(2)})
                </div>
                {analysis.diversification.clusters.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 py-2">
                    No tightly correlated clusters detected above {thresholds.highCorrelationThreshold.toFixed(2)}.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {analysis.diversification.clusters.map((cl) => (
                      <div
                        key={cl.id}
                        className="border border-[#ff9900]/35 bg-[#ff9900]/5 rounded p-2 text-[10.5px] space-y-1"
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-[#3498db]">{cl.tickers.join(' · ')}</span>
                          <span className="text-[#ff9900] tabular-nums">
                            {cl.combinedWeightPct.toFixed(1)}% wt
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          Avg r: {formatCorrelationValue(cl.avgCorrelation)} · Sectors: {cl.sectors.join(', ')}
                        </div>
                        {cl.isSameSectorCluster && (
                          <div className="text-[9.5px] text-[#ff4444] font-bold uppercase">
                            Same-sector overlap cluster
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Highly Correlated Pairs */}
              <div className="bg-black border border-[#242424] rounded p-3 space-y-2">
                <div className="text-[10px] text-zinc-400 uppercase font-bold">
                  HIGHLY CORRELATED PAIRS ({analysis.diversification.highlyCorrelatedPairs.length})
                </div>
                {analysis.diversification.highlyCorrelatedPairs.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 py-2">
                    No pairs exceed r ≥ {thresholds.highCorrelationThreshold.toFixed(2)}.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {analysis.diversification.highlyCorrelatedPairs.slice(0, 8).map((pair) => (
                      <div
                        key={`${pair.symbolA}-${pair.symbolB}`}
                        className="flex items-center justify-between border-b border-[#1c1c1c] pb-1.5 last:border-b-0 text-[10.5px]"
                      >
                        <div>
                          <span className="font-bold text-zinc-100">
                            {pair.symbolA} / {pair.symbolB}
                          </span>
                          <div className="text-[9.5px] text-zinc-500">
                            Combined {pair.combinedWeightPct.toFixed(1)}%
                            {pair.sameSector && pair.sharedSector ? ` · ${pair.sharedSector} overlap` : ''}
                          </div>
                        </div>
                        <span className="font-bold text-[#ff4444] tabular-nums">
                          {formatCorrelationValue(pair.correlation)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Limited Diversification Benefit Holdings */}
              <div className="bg-black border border-[#242424] rounded p-3 space-y-2">
                <div className="text-[10px] text-zinc-400 uppercase font-bold">
                  LIMITED DIVERSIFICATION BENEFIT
                </div>
                {analysis.diversification.limitedDiversificationHoldings.length === 0 ? (
                  <div className="text-[11px] text-[#00ff00] py-2">
                    No individual holdings currently exhibit redundant portfolio co-movement above threshold.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {analysis.diversification.limitedDiversificationHoldings.map((pos) => (
                      <div
                        key={pos.id}
                        className="flex items-center justify-between border-b border-[#1c1c1c] pb-1.5 last:border-b-0 text-[10.5px]"
                      >
                        <div>
                          <span className="font-bold text-[#3498db]">{pos.ticker}</span>
                          <span className="text-[9.5px] text-zinc-500 ml-1.5">{pos.sector}</span>
                          <div className="text-[9.5px] text-zinc-400 tabular-nums">
                            Weight {formatPct(pos.weightPct)} · Risk {formatPct(pos.riskContributionPct)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[#ff9900] font-bold tabular-nums">
                            avg r {formatCorrelationValue(pos.weightedAvgCorrWithPortfolio)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ================================================================ */}
          {/* SECTION 7: DOWNSIDE RISK SCENARIOS                               */}
          {/* ================================================================ */}
          <section id="prm-scenarios" className="bg-[#050505] border border-[#333] rounded p-3.5 space-y-3">
            <div className="border-b border-[#2a2a2a] pb-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                  DOWNSIDE RISK SCENARIOS &amp; STRESS TESTS
                </h2>
                <InfoTooltipIcon
                  label="Downside scenarios info"
                  title="Hypothetical Stress Testing"
                  content="Market-wide scenarios scale each holding by its historical beta vs SPY (cash = 0%). Sector and custom position shocks apply user-defined declines directly to current portfolio weights. These are hypothetical stress tests, not statistical forecasts."
                  maxWidth={310}
                />
              </div>
              <span className="text-[9.5px] text-amber-400 uppercase font-bold">
                HYPOTHETICAL STRESS ANALYSIS — NOT A FORECAST
              </span>
            </div>

            {/* Market-Wide SPY Shock Grid (-5%, -10%, -15%, -20%) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {analysis.marketScenarios.map((sc) => {
                const isSelected = activeScenarioDetail?.id === sc.id;
                return (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => setSelectedScenarioId(sc.id)}
                    className={`text-left p-3 rounded border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#17120a] border-[#ff9900]'
                        : 'bg-black border-[#262626] hover:border-zinc-500'
                    }`}
                  >
                    <div className="text-[10px] font-bold uppercase text-zinc-400">{sc.name}</div>
                    <div className="text-base font-bold text-[#ff4444] tabular-nums mt-1">
                      {formatUsd(sc.estimatedLossDollars)}
                    </div>
                    <div className="flex items-center justify-between text-[10px] tabular-nums mt-1">
                      <span className="text-[#ff6666] font-bold">
                        {formatPct(sc.estimatedLossPct)}
                      </span>
                      <span className="text-zinc-400">
                        Rem: {formatUsd(sc.remainingPortfolioValue, true)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Concentrated Exposure Stress Presets */}
            {analysis.concentratedStressScenarios.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] text-zinc-400 uppercase font-bold">
                  CONCENTRATED EXPOSURE STRESS TESTS
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {analysis.concentratedStressScenarios.map((sc) => {
                    const isSelected = activeScenarioDetail?.id === sc.id;
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => setSelectedScenarioId(sc.id)}
                        className={`text-left p-2.5 rounded border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#17120a] border-[#ff9900]'
                            : 'bg-black border-[#262626] hover:border-zinc-500'
                        }`}
                      >
                        <div className="text-[10px] font-bold text-zinc-200 truncate" title={sc.name}>
                          {sc.name}
                        </div>
                        <div className="flex items-center justify-between text-[11px] tabular-nums mt-1">
                          <span className="text-[#ff4444] font-bold">
                            {formatUsd(sc.estimatedLossDollars, true)}
                          </span>
                          <span className="text-[#ff6666]">{formatPct(sc.estimatedLossPct)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Interactive Custom Sector / Multi-Position Shock Builder */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="bg-black border border-[#242424] rounded p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#ff9900] uppercase font-bold">
                    CUSTOM HYPOTHETICAL SHOCK BUILDER
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCustomScenarioMode('sector');
                        setSelectedScenarioId('custom-sector');
                      }}
                      className={`px-2 py-0.5 rounded text-[9.5px] font-bold uppercase border cursor-pointer ${
                        customScenarioMode === 'sector'
                          ? 'bg-[#ff9900] text-black border-[#ff9900]'
                          : 'bg-[#0a0a0a] text-zinc-400 border-[#333]'
                      }`}
                    >
                      SECTOR SHOCK
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomScenarioMode('positions');
                        if (Object.keys(customPosShocks).length > 0) {
                          setSelectedScenarioId('custom-positions');
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-[9.5px] font-bold uppercase border cursor-pointer ${
                        customScenarioMode === 'positions'
                          ? 'bg-[#ff9900] text-black border-[#ff9900]'
                          : 'bg-[#0a0a0a] text-zinc-400 border-[#333]'
                      }`}
                    >
                      POSITION SHOCKS
                    </button>
                  </div>
                </div>

                {customScenarioMode === 'sector' ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9.5px] text-zinc-400 uppercase mb-1">
                          Target Sector
                        </label>
                        <select
                          value={customSectorName}
                          onChange={(e) => {
                            setCustomSectorName(e.target.value);
                            setSelectedScenarioId('custom-sector');
                          }}
                          className="w-full bg-[#080808] border border-[#333] rounded px-2 py-1.5 text-xs text-zinc-100 outline-none"
                        >
                          {analysis.sectorExposure.sectors.map((s) => (
                            <option key={s.sector} value={s.sector}>
                              {s.sector} ({s.portfolioWeightPct.toFixed(1)}%)
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9.5px] text-zinc-400 uppercase mb-1">
                          Decline (%)
                        </label>
                        <input
                          type="number"
                          min={-100}
                          max={0}
                          step={5}
                          value={customSectorShockPct}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v)) {
                              setCustomSectorShockPct(Math.max(-100, Math.min(0, v)));
                              setSelectedScenarioId('custom-sector');
                            }
                          }}
                          className="w-full bg-[#080808] border border-[#333] rounded px-2 py-1.5 text-xs text-zinc-100 tabular-nums outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[-10, -15, -20, -30, -40].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            setCustomSectorShockPct(val);
                            setSelectedScenarioId('custom-sector');
                          }}
                          className={`px-2 py-0.5 rounded border text-[10px] font-bold tabular-nums cursor-pointer ${
                            customSectorShockPct === val
                              ? 'border-[#ff9900] text-[#ff9900] bg-[#ff9900]/10'
                              : 'border-[#333] text-zinc-400 hover:text-white'
                          }`}
                        >
                          {val}%
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="block text-[9.5px] text-zinc-400 uppercase mb-1">
                          Holding
                        </label>
                        <select
                          value={newShockTicker}
                          onChange={(e) => setNewShockTicker(e.target.value)}
                          className="w-full bg-[#080808] border border-[#333] rounded px-2 py-1.5 text-xs text-zinc-100 outline-none"
                        >
                          {analysis.positions
                            .filter((p) => p.marketValue !== null)
                            .map((p) => (
                              <option key={p.ticker} value={p.ticker}>
                                {p.ticker} ({formatPct(p.weightPct)})
                              </option>
                            ))}
                        </select>
                      </div>
                      <div className="w-24">
                        <label className="block text-[9.5px] text-zinc-400 uppercase mb-1">
                          Shock (%)
                        </label>
                        <input
                          type="number"
                          min={-100}
                          max={0}
                          step={5}
                          value={newShockPct}
                          onChange={(e) => setNewShockPct(e.target.value)}
                          className="w-full bg-[#080808] border border-[#333] rounded px-2 py-1.5 text-xs text-zinc-100 tabular-nums outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const v = Number(newShockPct);
                          if (!newShockTicker || !Number.isFinite(v)) return;
                          const clamped = Math.max(-100, Math.min(0, v));
                          setCustomPosShocks((prev) => ({ ...prev, [newShockTicker]: clamped }));
                          setSelectedScenarioId('custom-positions');
                        }}
                        className="px-2.5 py-1.5 rounded bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-[10px] uppercase inline-flex items-center justify-center leading-none cursor-pointer h-[30px]"
                      >
                        APPLY
                      </button>
                    </div>

                    {Object.keys(customPosShocks).length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(customPosShocks).map(([sym, pct]) => (
                          <span
                            key={sym}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#141414] border border-[#ff4444]/40 text-[10px] text-zinc-200 tabular-nums"
                          >
                            <span className="font-bold text-[#3498db]">{sym}</span>
                            <span className="text-[#ff4444] font-bold">{pct}%</span>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomPosShocks((prev) => {
                                  const next = { ...prev };
                                  delete next[sym];
                                  return next;
                                });
                              }}
                              className="text-zinc-500 hover:text-white cursor-pointer"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-zinc-500">
                        Add one or multiple holdings above to model simultaneous idiosyncratic declines.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Selected Scenario Breakdown & Largest Loss Contributors */}
              {activeScenarioDetail && (
                <div className="bg-black border border-[#242424] rounded p-3 space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#1c1c1c] pb-2">
                    <div>
                      <div className="text-xs font-bold text-white">{activeScenarioDetail.name}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        {activeScenarioDetail.methodologyNote}
                      </div>
                    </div>
                    <div className="text-right tabular-nums shrink-0">
                      <div className="text-sm font-bold text-[#ff4444]">
                        {formatUsd(activeScenarioDetail.estimatedLossDollars)} (
                        {formatPct(activeScenarioDetail.estimatedLossPct)})
                      </div>
                      <div className="text-[10px] text-zinc-400">
                        Remaining: {formatUsd(activeScenarioDetail.remainingPortfolioValue)}
                      </div>
                    </div>
                  </div>

                  {activeScenarioDetail.usedFallbackBetaTickers.length > 0 && (
                    <div className="text-[9.5px] text-amber-400">
                      Beta unavailable for {activeScenarioDetail.usedFallbackBetaTickers.join(', ')} — applied 1.0x market shock fallback.
                    </div>
                  )}

                  <div className="overflow-x-auto max-h-48 overflow-y-auto">
                    <table className="w-full text-left text-[10.5px] border-collapse">
                      <thead>
                        <tr className="border-b border-[#2a2a2a] text-zinc-500 text-[9.5px] uppercase">
                          <th className="py-1 pr-2">Holding</th>
                          <th className="py-1 px-2 text-right">Weight</th>
                          <th className="py-1 px-2 text-right">Applied Shock</th>
                          <th className="py-1 px-2 text-right">Est. Loss ($)</th>
                          <th className="py-1 pl-2 text-right">Port. Impact</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#181818]">
                        {activeScenarioDetail.contributors.map((c) => (
                          <tr key={c.ticker} className="hover:bg-[#101010]">
                            <td className="py-1.5 pr-2 font-bold text-[#3498db]">
                              {c.ticker}
                              {c.usedFallbackBeta && (
                                <span className="text-[8.5px] text-amber-400 ml-1">(1.0x)</span>
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-zinc-300">
                              {c.weightPct.toFixed(1)}%
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-[#ff9900]">
                              {c.appliedShockPct.toFixed(1)}%
                              {c.betaUsed !== null && !c.usedFallbackBeta
                                ? ` (β ${c.betaUsed.toFixed(2)})`
                                : ''}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums font-bold text-[#ff4444]">
                              {formatUsd(c.dollarImpact)}
                            </td>
                            <td className="py-1.5 pl-2 text-right tabular-nums text-[#ff6666]">
                              {formatPct(c.portfolioImpactPct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default PortfolioRiskMonitorScreen;

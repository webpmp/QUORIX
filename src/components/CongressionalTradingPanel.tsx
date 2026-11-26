import React, { useState, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import {
  Search,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Landmark,
  AlertCircle,
  FileText,
  Filter,
  TriangleAlert,
  Info,
  RefreshCw,
} from 'lucide-react';
import type {
  CongressAssetGroup,
  CongressParty,
  CongressStatusResponse,
  CongressTradeRecord,
  CongressTradesResponse,
  CongressTxType,
} from '../types';
import TerminalSelect from './TerminalSelect';
import CompanyLogo, { isCompanyEquitySymbol } from './CompanyLogo';
import { TerminalTooltip } from './TerminalTooltip';

export interface CongressionalTradingPanelRef {
  refresh: () => Promise<{
    indexCheckRan: boolean;
    newFilingsFound: number;
    cooldownActive: boolean;
    lastIndexCheck: string | null;
  }>;
}

export interface CongressTradingPanelStatusUpdate {
  lastUpdated: string | null;
  lastIndexCheck: string | null;
  isStale: boolean;
  isLoading: boolean;
  isBackfilling: boolean;
  backfillProgress?: {
    processedFilings: number;
    totalFilings: number;
    percentComplete: number;
  };
}

interface CongressionalTradingPanelProps {
  selectedTicker: string;
  onSelectTicker?: (ticker: string) => void;
  initialTrades?: CongressTradeRecord[];
  onStatusUpdate?: (status: CongressTradingPanelStatusUpdate) => void;
}

function getSafeExternalUrl(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {}
  return null;
}

export function getPartyBadgeClass(party: CongressParty): string {
  switch (party) {
    case 'Democrat':
      return 'text-sky-400 border-sky-500/40 bg-sky-950/30';
    case 'Republican':
      return 'text-[#ff4444] border-[#ff4444]/40 bg-[#ff4444]/10';
    case 'Independent':
      return 'text-amber-400 border-amber-500/40 bg-amber-950/30';
    default:
      return 'text-zinc-300 border-zinc-700 bg-zinc-900/40';
  }
}

export function getTxTypeBadgeClass(txType: CongressTxType): string {
  switch (txType) {
    case 'BUY':
      return 'text-[#00ff00] border-[#00ff00]/40 bg-[#00ff00]/10';
    case 'SELL':
      return 'text-[#ff4444] border-[#ff4444]/40 bg-[#ff4444]/10';
    case 'EXCHANGE':
      return 'text-amber-400 border-amber-500/40 bg-amber-950/30';
    default:
      return 'text-zinc-300 border-zinc-700 bg-zinc-900/40';
  }
}

const CongressionalTradingPanel = forwardRef<CongressionalTradingPanelRef, CongressionalTradingPanelProps>(
  function CongressionalTradingPanel(
    {
      selectedTicker,
      onSelectTicker,
      initialTrades,
      onStatusUpdate,
    }: CongressionalTradingPanelProps,
    ref
  ) {
    // Query & Filter states
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [partyFilter, setPartyFilter] = useState<string>('ALL');
    const [typeFilter, setTypeFilter] = useState<string>('ALL');
    const [ownerFilter, setOwnerFilter] = useState<string>('ALL');
    const [assetGroupFilter, setAssetGroupFilter] = useState<CongressAssetGroup>('EQUITIES');
    const [filterThisTickerOnly, setFilterThisTickerOnly] = useState<boolean>(false);
    const [sortBy, setSortBy] = useState<'filingDate' | 'notificationDate' | 'transactionDate' | 'amount'>('filingDate');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [page, setPage] = useState<number>(1);
    const [pageSize, setPageSize] = useState<number>(50);

    // Data states
    const [trades, setTrades] = useState<CongressTradeRecord[]>(initialTrades || []);
    const [scannedFilings, setScannedFilings] = useState<CongressTradesResponse['scannedFilings']>([]);
    const [totalTrades, setTotalTrades] = useState<number>(initialTrades ? initialTrades.length : 0);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [isStale, setIsStale] = useState<boolean>(false);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);

    // Ingestion status state
    const [status, setStatus] = useState<CongressStatusResponse | null>(null);

    // View mode: feed vs scanned filings modal/section
    const [showScannedSection, setShowScannedSection] = useState<boolean>(false);
    const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

    // Fetch ingestion status
    const fetchStatus = useCallback(async () => {
      try {
        const res = await fetch('/api/congress/status');
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setStatus(data);
            if (data.lastUpdated) {
              setLastUpdated(data.lastUpdated);
            }
            if (typeof data.isStale === 'boolean') {
              setIsStale(data.isStale);
            }
          }
        }
      } catch {}
    }, []);

    // Fetch trades
    const fetchTrades = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (partyFilter !== 'ALL') qs.set('party', partyFilter);
        if (typeFilter !== 'ALL') qs.set('type', typeFilter);
        if (ownerFilter !== 'ALL') qs.set('owner', ownerFilter);
        if (assetGroupFilter !== 'ALL') qs.set('assetGroup', assetGroupFilter);
        if (filterThisTickerOnly && selectedTicker) {
          qs.set('ticker', selectedTicker);
        }
        if (searchQuery.trim()) {
          qs.set('politician', searchQuery.trim());
        }
        if (sortBy === 'notificationDate') {
          qs.set('sortBy', 'disclosureDate');
        } else {
          qs.set('sortBy', sortBy);
        }
        qs.set('sortDir', sortDir);
        qs.set('page', String(page));
        qs.set('pageSize', String(pageSize));

        const res = await fetch(`/api/congress/trades?${qs.toString()}`);
        const data: CongressTradesResponse = await res.json();

        if (!res.ok || !data.success) {
          setError('Failed to retrieve Congressional trading data.');
          return;
        }

        setTrades(Array.isArray(data.trades) ? data.trades : []);
        setScannedFilings(Array.isArray(data.scannedFilings) ? data.scannedFilings : []);
        setTotalTrades(data.totalTrades || 0);
        setTotalPages(data.totalPages || 1);
        setIsStale(Boolean(data.isStale));
        setLastUpdated(data.lastUpdated);
      } catch (err: any) {
        setError(err?.message || 'Network error fetching Congressional trading data.');
      } finally {
        setLoading(false);
      }
    }, [
      partyFilter,
      typeFilter,
      ownerFilter,
      assetGroupFilter,
      filterThisTickerOnly,
      selectedTicker,
      searchQuery,
      sortBy,
      sortDir,
      page,
      pageSize,
    ]);

    // Expose refresh to parent via ref
    useImperativeHandle(
      ref,
      () => ({
        refresh: async () => {
          let checkRan = false;
          let newFound = 0;
          let isCool = false;
          let lastCheck: string | null = null;
          try {
            const res = await fetch('/api/congress/status?refresh=true');
            if (res.ok) {
              const data = await res.json();
              if (data.success) {
                setStatus(data);
                if (data.lastUpdated) setLastUpdated(data.lastUpdated);
                if (typeof data.isStale === 'boolean') setIsStale(data.isStale);
                checkRan = Boolean(data.indexCheckRan);
                newFound = typeof data.newFilingsFound === 'number' ? data.newFilingsFound : 0;
                isCool = Boolean(data.cooldownActive);
                lastCheck = data.lastIndexCheck || null;
              }
            }
          } catch {}

          await fetchTrades();

          return {
            indexCheckRan: checkRan,
            newFilingsFound: newFound,
            cooldownActive: isCool,
            lastIndexCheck: lastCheck,
          };
        },
      }),
      [fetchTrades]
    );

    // Notify parent about status updates
    useEffect(() => {
      if (onStatusUpdate) {
        onStatusUpdate({
          lastUpdated,
          lastIndexCheck: status?.lastIndexCheck || null,
          isStale,
          isLoading: loading,
          isBackfilling: Boolean(status?.isBackfilling),
          backfillProgress: status?.backfillProgress,
        });
      }
    }, [lastUpdated, status?.lastIndexCheck, isStale, loading, status?.isBackfilling, status?.backfillProgress, onStatusUpdate]);

    useEffect(() => {
      void fetchStatus();
      void fetchTrades();
    }, [fetchStatus, fetchTrades]);

    // Periodic polling for status when backfilling
    useEffect(() => {
      if (status?.isBackfilling) {
        const timer = setInterval(() => {
          void fetchStatus();
        }, 5000);
        return () => clearInterval(timer);
      }
    }, [status?.isBackfilling, fetchStatus]);

    const handleTickerClick = (ticker: string) => {
      if (onSelectTicker && isCompanyEquitySymbol(ticker)) {
        onSelectTicker(ticker);
      }
    };

    const handleSortToggle = (col: 'filingDate' | 'notificationDate' | 'transactionDate' | 'amount') => {
      if (sortBy === col) {
        setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        setSortBy(col);
        setSortDir('desc');
      }
      setPage(1);
    };

  return (
    <div className="flex flex-col flex-1 min-h-0 space-y-2.5">
      {/* Top Status Banner */}
      <div className="bg-[#0a0a0a] border border-[#3a3a3a] rounded p-2.5 flex flex-col md:flex-row justify-between items-start md:items-center gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-zinc-100 font-bold uppercase tracking-wider text-xs">
            <Landmark size={13} className="text-[#ff9900]" />
            <span>HOUSE OF REPRESENTATIVES PTR FEED</span>
          </span>

          {status?.isBackfilling && (
            <span className="px-2 py-0.5 rounded border border-[#ff9900]/40 bg-[#ff9900]/10 text-[#ff9900] text-xs font-bold uppercase inline-flex items-center gap-1">
              <span>INGESTING {status.backfillProgress.processedFilings} / {status.backfillProgress.totalFilings}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
          <span className="tabular-nums">
            <strong className="text-zinc-100">{totalTrades}</strong> {assetGroupFilter === 'EQUITIES' ? 'EQUITIES & ETFs' : 'FIXED INCOME & OTHER'} OF <strong className="text-zinc-100">{status?.totalTransactions ?? totalTrades}</strong> TOTAL |{' '}
            <strong className="text-zinc-100">{status?.totalParsedFilings ?? 460}</strong> DIGITAL FILINGS |{' '}
            <button
              type="button"
              onClick={() => setShowScannedSection(!showScannedSection)}
              className="text-[#ff9900] hover:underline cursor-pointer"
            >
              {status?.totalScannedFilings ?? 67} SCANNED (VIEW)
            </button>
          </span>
        </div>
      </div>

      {/* Scanned Filings Modal / Drawer */}
      {showScannedSection && (
        <div className="bg-[#0a0a0a] border border-[#ff9900]/50 rounded p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[#ff9900] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
              <FileText size={12} />
              <span>PAPER / SCANNED FILINGS (LINK-ONLY — ZERO TEXT STREAM)</span>
            </span>
            <button
              type="button"
              onClick={() => setShowScannedSection(false)}
              className="text-zinc-300 hover:text-white uppercase font-bold"
            >
              [CLOSE]
            </button>
          </div>
          <p className="text-zinc-300">
            These filings were submitted as handwritten or scanned paper documents without embedded font streams. In compliance with Phase 1 scope, they are preserved as direct links to official House Clerk PDF records:
          </p>
          <div className="max-h-40 overflow-y-auto space-y-1 divide-y divide-[#2e2e2e]">
            {scannedFilings && scannedFilings.length > 0 ? (
              scannedFilings.map((sf) => (
                <div key={sf.docId} className="pt-1 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-zinc-100 font-bold">{sf.politicianName}</span>{' '}
                    <span className="text-zinc-400">({sf.stateDistrict})</span> • Filed: {sf.filingDate} • Doc #{sf.docId}
                  </div>
                  <a
                    href={getSafeExternalUrl(sf.filingUrl) || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#ff9900] hover:underline inline-flex items-center gap-1 font-bold"
                  >
                    <span>VIEW PDF</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
              ))
            ) : (
              <div className="text-zinc-400 py-2">No scanned filings cached.</div>
            )}
          </div>
        </div>
      )}

      {/* Control Bar: Filters & Asset Group Switcher */}
      <div className="bg-[#080808] border border-[#3a3a3a] rounded p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Left: Asset Group Switcher */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setAssetGroupFilter('EQUITIES');
              setPage(1);
            }}
            className={`px-2.5 py-1 rounded text-xs font-extrabold uppercase tracking-wider border transition-colors cursor-pointer ${
              assetGroupFilter === 'EQUITIES'
                ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                : 'bg-black border-[#3a3a3a] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
            }`}
          >
            EQUITIES &amp; ETFS
          </button>
          <button
            type="button"
            onClick={() => {
              setAssetGroupFilter('FIXED_INCOME_OTHER');
              setPage(1);
            }}
            className={`px-2.5 py-1 rounded text-xs font-extrabold uppercase tracking-wider border transition-colors cursor-pointer ${
              assetGroupFilter === 'FIXED_INCOME_OTHER'
                ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                : 'bg-black border-[#3a3a3a] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
            }`}
          >
            FIXED INCOME &amp; OTHER
          </button>
        </div>

        {/* Center: Search politician or ticker */}
        <div className="flex items-center gap-2 flex-1 max-w-xs min-w-[200px]">
          <div className="relative w-full">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="SEARCH POLITICIAN..."
              className="w-full bg-black border border-[#3a3a3a] hover:border-[#ff9900] focus:border-[#ff9900] rounded pl-7 pr-2 py-1 text-xs text-zinc-100 outline-none placeholder:text-zinc-400"
            />
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>

        {/* Right: Dropdown Filters & Ticker Lock */}
        <div className="flex flex-wrap items-center gap-2">
          {selectedTicker && isCompanyEquitySymbol(selectedTicker) && (
            <button
              type="button"
              onClick={() => {
                setFilterThisTickerOnly(!filterThisTickerOnly);
                setPage(1);
              }}
              className={`px-2 py-1 rounded text-xs font-bold uppercase border transition-colors cursor-pointer inline-flex items-center gap-1 ${
                filterThisTickerOnly
                  ? 'bg-[#ff9900] border-[#ff9900] text-black'
                  : 'bg-black border-[#3a3a3a] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
              }`}
            >
              <Filter size={10} />
              <span>{selectedTicker} ONLY</span>
            </button>
          )}

          {/* Party */}
          <TerminalSelect
            sizeVariant="sm"
            value={partyFilter}
            onChange={(e) => {
              setPartyFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">ALL PARTIES</option>
            <option value="Democrat">DEMOCRATS</option>
            <option value="Republican">REPUBLICANS</option>
            <option value="Independent">INDEPENDENT</option>
          </TerminalSelect>

          {/* Tx Type */}
          <TerminalSelect
            sizeVariant="sm"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">ALL TYPES</option>
            <option value="BUY">PURCHASE (BUY)</option>
            <option value="SELL">SALE (SELL)</option>
            <option value="EXCHANGE">EXCHANGE</option>
          </TerminalSelect>

          {/* Owner */}
          <TerminalSelect
            sizeVariant="sm"
            value={ownerFilter}
            onChange={(e) => {
              setOwnerFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">ALL OWNERS</option>
            <option value="self">SELF</option>
            <option value="spouse">SPOUSE (SP)</option>
            <option value="joint">JOINT (JT)</option>
            <option value="dependent">DEPENDENT (DC)</option>
          </TerminalSelect>
        </div>
      </div>

      {/* Main Table Container with Sticky Header */}
      <div className="bg-black border border-[#3a3a3a] rounded flex-1 min-h-[350px] overflow-x-auto overflow-y-auto relative">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="sticky top-0 bg-[#0c0c0c] border-b border-[#3a3a3a] z-10 select-none shadow-sm">
            <tr className="text-zinc-300 font-bold uppercase tracking-wider text-xs">
              <th className="py-2 px-3">TICKER / ASSET</th>
              <th className="py-2 px-3">POLITICIAN</th>
              <th className="py-2 px-2.5">TYPE</th>
              <th
                className="py-2 px-2.5 cursor-pointer hover:text-white"
                onClick={() => handleSortToggle('transactionDate')}
              >
                TX DATE {sortBy === 'transactionDate' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th
                className="py-2 px-2.5 cursor-pointer hover:text-white"
                onClick={() => handleSortToggle('notificationDate')}
              >
                NOTIFIED {sortBy === 'notificationDate' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th
                className="py-2 px-2.5 cursor-pointer hover:text-white"
                onClick={() => handleSortToggle('filingDate')}
              >
                <div className="inline-flex items-center gap-1">
                  <span>FILED {sortBy === 'filingDate' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
                  <TerminalTooltip
                    title="REPORTING DEADLINE"
                    content="Members must report within 30 days of being notified of a trade, and no later than 45 days after the trade."
                    maxWidth={280}
                  >
                    <Info size={11} className="text-zinc-400 hover:text-[#ff9900] transition-colors cursor-help inline shrink-0" />
                  </TerminalTooltip>
                </div>
              </th>
              <th className="py-2 px-2 text-right">
                <div className="inline-flex items-center justify-end gap-1 w-full">
                  <span>GAP</span>
                  <TerminalTooltip
                    title="REPORTING DEADLINE"
                    content="Members must report within 30 days of being notified of a trade, and no later than 45 days after the trade."
                    maxWidth={280}
                  >
                    <Info size={11} className="text-zinc-400 hover:text-[#ff9900] transition-colors cursor-help inline shrink-0" />
                  </TerminalTooltip>
                </div>
              </th>
              <th
                className="py-2 px-3 text-right cursor-pointer hover:text-white"
                onClick={() => handleSortToggle('amount')}
              >
                AMOUNT RANGE {sortBy === 'amount' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th className="py-2 px-2.5">OWNER</th>
              <th className="py-2 px-3 text-right">FILING</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2e2e2e]">
            {loading ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-zinc-300 text-xs">
                  <div className="inline-flex items-center gap-2">
                    <RefreshCw size={14} className="animate-spin text-[#ff9900]" />
                    <span>LOADING CONGRESSIONAL TRADES...</span>
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-[#ff4444] text-xs">
                  <div className="inline-flex items-center gap-2">
                    <AlertCircle size={14} />
                    <span>{error}</span>
                  </div>
                </td>
              </tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-zinc-400 text-xs">
                  NO CONGRESSIONAL TRADES MATCHING CURRENT FILTERS.
                </td>
              </tr>
            ) : (
              trades.map((t) => {
                const filingUrl = getSafeExternalUrl(t.filingUrl);
                const hasDetails = Boolean(t.description || t.comment || t.subholding || t.location);
                const isExpanded = expandedRowId === t.id;
                return (
                  <React.Fragment key={t.id}>
                    <tr
                      className="hover:bg-[#121212] transition-colors group text-zinc-200"
                    >
                      {/* Ticker / Asset */}
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          {t.ticker && isCompanyEquitySymbol(t.ticker) ? (
                            <>
                              <CompanyLogo symbol={t.ticker} size={20} className="shrink-0" />
                              <div className="flex flex-col">
                                <button
                                  type="button"
                                  onClick={() => handleTickerClick(t.ticker!)}
                                  className="font-extrabold text-white text-xs hover:text-[#ff9900] transition-colors cursor-pointer text-left"
                                >
                                  {t.ticker}
                                </button>
                                <span className="text-zinc-400 truncate max-w-[200px] text-xs" title={t.rawAssetDescription}>
                                  {t.rawAssetDescription}
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-col">
                              <span className="font-bold text-zinc-100 text-xs truncate max-w-[220px]" title={t.rawAssetDescription}>
                                {t.rawAssetDescription}
                              </span>
                              {t.assetTypeCode && (
                                <span className="text-zinc-400 text-xs">TYPE: [{t.assetTypeCode}]</span>
                              )}
                            </div>
                          )}
                          {hasDetails && (
                            <button
                              type="button"
                              onClick={() => setExpandedRowId(isExpanded ? null : t.id)}
                              className="ml-auto text-zinc-400 hover:text-white transition-colors cursor-pointer p-0.5"
                              title={isExpanded ? 'Collapse notes' : 'Expand description & comments'}
                            >
                              <ChevronDown
                                size={12}
                                className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Politician */}
                      <td className="py-2 px-3">
                        <div className="flex flex-col">
                          <span className="text-zinc-100 font-bold text-xs">{t.politicianName}</span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span
                              className={`px-1.5 py-0.2 rounded border text-xs font-bold uppercase ${getPartyBadgeClass(
                                t.party
                              )}`}
                            >
                              {t.party.slice(0, 3).toUpperCase()}
                            </span>
                            <span className="text-zinc-400 text-xs">{t.stateDistrict}</span>
                            {t.isAmended && (
                              <TerminalTooltip
                                title="AMENDED FILING"
                                content={`This transaction was reported in an amendment filing (Doc ID: ${t.docId}).`}
                                maxWidth={240}
                              >
                                <span
                                  tabIndex={0}
                                  role="note"
                                  aria-label="Amended filing. This transaction was reported in an amendment filing."
                                  className="px-1 py-0.2 rounded border border-amber-500/40 bg-amber-950/30 text-amber-400 text-xs font-bold uppercase cursor-help outline-none focus:ring-1 focus:ring-amber-400"
                                >
                                  AMD
                                </span>
                              </TerminalTooltip>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Type */}
                      <td className="py-2 px-2.5">
                        <div className="flex flex-col gap-0.5 items-start">
                          <span
                            className={`px-2 py-0.5 rounded border text-xs font-bold uppercase inline-block ${getTxTypeBadgeClass(
                              t.txType
                            )}`}
                          >
                            {t.txTypeRaw === 'Unknown' ? 'UNK' : t.txType}
                          </span>
                          {t.isOption && (
                            <span className="px-1 py-0.2 rounded border border-purple-500/40 bg-purple-950/30 text-purple-300 text-xs font-bold uppercase">
                              OPTION
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Transaction Date */}
                      <td className="py-2 px-2.5 tabular-nums text-zinc-300 text-xs whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{t.transactionDate}</span>
                          {t.dateAnomaly && (t.dateAnomalyReason?.toLowerCase().includes('trade date') || (!t.dateAnomalyReason?.toLowerCase().includes('notification date') && !t.dateAnomalyReason?.toLowerCase().includes('notif'))) && (
                            <TerminalTooltip
                              title="DATE ANOMALY"
                              ariaText={`Date anomaly. Trade date (${t.transactionDate}) is likely a typo in the original filing: ${t.dateAnomalyReason}. Verify against the PDF.`}
                              content={
                                <span>
                                  Date as filed: The trade date ({t.transactionDate}) {t.dateAnomalyReason?.toLowerCase().includes('in the future') ? 'is in the future' : 'is after notification date'}, which is likely a typo in the original filing. Verify against the PDF.
                                </span>
                              }
                              maxWidth={280}
                            >
                              <span
                                role="note"
                                aria-label={`Date anomaly. Trade date (${t.transactionDate}) is likely a typo in the original filing: ${t.dateAnomalyReason}. Verify against the PDF.`}
                                className="inline-flex items-center text-amber-400 hover:text-amber-300 focus:text-amber-300 cursor-help outline-none rounded"
                              >
                                <TriangleAlert size={12} className="shrink-0" />
                              </span>
                            </TerminalTooltip>
                          )}
                        </div>
                      </td>

                      {/* Notification Date */}
                      <td className="py-2 px-2.5 tabular-nums text-zinc-300 text-xs whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{t.notificationDate || t.disclosureDate}</span>
                          {t.dateAnomaly && t.dateAnomalyReason?.toLowerCase().includes('notification date') && (
                            <TerminalTooltip
                              title="DATE ANOMALY"
                              ariaText={`Date anomaly. Notification date (${t.notificationDate || t.disclosureDate}) is in the future, which is likely a typo in the original filing. Verify against the PDF.`}
                              content={
                                <span>
                                  Date as filed: The notification date ({t.notificationDate || t.disclosureDate}) is in the future, which is likely a typo in the original filing. Verify against the PDF.
                                </span>
                              }
                              maxWidth={280}
                            >
                              <span
                                role="note"
                                aria-label={`Date anomaly. Notification date (${t.notificationDate || t.disclosureDate}) is in the future, which is likely a typo in the original filing. Verify against the PDF.`}
                                className="inline-flex items-center text-amber-400 hover:text-amber-300 focus:text-amber-300 cursor-help outline-none rounded"
                              >
                                <TriangleAlert size={12} className="shrink-0" />
                              </span>
                            </TerminalTooltip>
                          )}
                        </div>
                      </td>

                      {/* Filing Date */}
                      <td className="py-2 px-2.5 tabular-nums text-zinc-300 text-xs whitespace-nowrap">
                        {t.filingDate}
                      </td>

                      {/* Gap Days */}
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap text-xs">
                        <span
                          className={
                            t.reportingGapDays > 45
                              ? 'text-amber-400 font-bold'
                              : 'text-zinc-300'
                          }
                          title={`Filing Gap: ${t.reportingGapDays} days from trade date to index filing date`}
                        >
                          {t.reportingGapDays}d
                        </span>
                      </td>

                      {/* Amount Range */}
                      <td className="py-2 px-3 text-right tabular-nums font-mono text-zinc-100 text-xs whitespace-nowrap">
                        <span>{t.amountRange}</span>
                        {t.isExactAmount && (
                          <span className="ml-1 text-xs text-zinc-400 font-sans tracking-tight">(exact)</span>
                        )}
                      </td>

                      {/* Owner */}
                      <td className="py-2 px-2.5 uppercase text-xs whitespace-nowrap">
                        <span className="text-zinc-300">{t.owner}</span>
                      </td>

                      {/* Filing Link */}
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {filingUrl ? (
                          <a
                            href={filingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#ff9900] hover:text-white transition-colors inline-flex items-center gap-1 font-bold text-xs"
                            title={`Doc ID: ${t.docId}`}
                          >
                            <span>PDF</span>
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="text-zinc-400 text-xs">#{t.docId}</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && hasDetails && (
                      <tr className="bg-[#0b0b0b] text-zinc-300 border-b border-[#2e2e2e]">
                        <td colSpan={10} className="px-4 py-2.5 text-xs">
                          <div className="flex flex-col gap-1.5 pl-4 border-l-2 border-[#ff9900]/40">
                            {t.subholding && (
                              <div>
                                <span className="font-bold text-zinc-400 uppercase mr-1.5">SUBHOLDING OF:</span>
                                <span className="text-zinc-200">{t.subholding}</span>
                              </div>
                            )}
                            {t.location && (
                              <div>
                                <span className="font-bold text-zinc-400 uppercase mr-1.5">LOCATION:</span>
                                <span className="text-zinc-200">{t.location}</span>
                              </div>
                            )}
                            {t.description && (
                              <div>
                                <span className="font-bold text-zinc-400 uppercase mr-1.5">DESCRIPTION:</span>
                                <span className="text-zinc-200">{t.description}</span>
                              </div>
                            )}
                            {t.comment && (
                              <div>
                                <span className="font-bold text-zinc-400 uppercase mr-1.5">COMMENTS:</span>
                                <span className="text-zinc-200">{t.comment}</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="bg-[#0a0a0a] border border-[#3a3a3a] rounded px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-zinc-400">
          SHOWING {trades.length > 0 ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, totalTrades)} OF{' '}
          <span className="text-zinc-200 font-bold">{totalTrades}</span> TRADES
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
            className="px-2.5 py-1 rounded bg-black border border-[#3a3a3a] hover:border-[#ff9900] text-zinc-300 disabled:opacity-40 disabled:hover:border-[#3a3a3a] inline-flex items-center gap-1 font-bold cursor-pointer"
          >
            <ChevronLeft size={11} />
            <span>PREV</span>
          </button>
          <span className="text-zinc-300 tabular-nums font-bold">
            PAGE {page} OF {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage(page + 1)}
            className="px-2.5 py-1 rounded bg-black border border-[#3a3a3a] hover:border-[#ff9900] text-zinc-300 disabled:opacity-40 disabled:hover:border-[#3a3a3a] inline-flex items-center gap-1 font-bold cursor-pointer"
          >
            <span>NEXT</span>
            <ChevronRight size={11} />
          </button>
        </div>
      </div>

      {/* Senate eFD Exclusion Notice & House Statutory Notice Footer */}
      <div className="border-t border-[#2e2e2e] pt-2.5 flex flex-col gap-2 text-xs text-zinc-400">
        <div>
          <span>U.S. Senate disclosures are not included. The Senate eFD requires a user affirmation that this app does not submit on your behalf. </span>
          <a
            href="https://efdsearch.senate.gov/search/home/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#ff9900] hover:underline inline-flex items-center gap-1 font-bold"
          >
            <span>OFFICIAL SENATE eFD SEARCH</span>
            <ExternalLink size={10} />
          </a>
        </div>
        <div className="text-zinc-400 leading-relaxed">
          <span>NOTICE: Financial Disclosure Statements and Periodic Transaction Reports are made available under Title I of the Ethics in Government Act (5 U.S.C. app. § 105). It is unlawful to use information contained in these reports for (A) any unlawful purpose, (B) any commercial purpose, other than by news and communications media for dissemination to the general public, (C) determining or establishing credit ratings, or (D) direct or indirect solicitation of money for political, charitable, or other purposes. Disclosed amounts are statutory ranges or exact cash receipts as filed.</span>
        </div>
      </div>
    </div>
  );
});

export default CongressionalTradingPanel;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  FileSpreadsheet,
  FolderPlus,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  PortfolioAccount,
  PortfolioSecurityMetadata,
  StockData,
} from '../types';
import {
  isValidTickerFormat,
  normalizeTickerSymbol,
} from '../utils/equityValidation';
import {
  detectCsvColumnMapping,
  parseCsvText,
  validateCsvImportRows,
  type CsvColumnMapping,
} from '../utils/portfolioCsv';

export type PortfolioManagerTab = 'manual' | 'csv' | 'watchlist' | 'portfolios';

export interface PortfolioManagerPanelProps {
  activeTab: PortfolioManagerTab;
  onTabChange: (tab: PortfolioManagerTab) => void;
  onClose: () => void;
  portfolios: PortfolioAccount[];
  activePortfolio: PortfolioAccount | null;
  trackedTickers: string[];
  stocks: Record<string, StockData>;
  onSelectPortfolio: (portfolioId: string) => void;
  onCreatePortfolio: (name: string, cashBalance: number) => PortfolioAccount;
  onRenamePortfolio: (portfolioId: string, name: string) => void;
  onDeletePortfolio: (portfolioId: string) => void;
  onUpdateCash: (cashBalance: number) => void;
  onUpsertHolding: (
    input: {
      ticker: string;
      shares: number;
      avgCostBasis: number | null;
      source: 'manual' | 'csv' | 'tracked_watchlist';
    },
    mergeMode: 'replace' | 'add'
  ) => void;
  onBulkImport: (
    targetPortfolioId: string,
    holdings: Array<{
      ticker: string;
      shares: number;
      avgCostBasis: number | null;
      source: 'csv' | 'tracked_watchlist';
    }>,
    mergeMode: 'replace' | 'add',
    cashDelta?: number
  ) => void;
  onVerifySymbols: (symbols: string[]) => Promise<Record<string, PortfolioSecurityMetadata>>;
}

interface SearchOption {
  symbol: string;
  name: string;
  instrumentType: string;
  exchange: string;
}

export const PortfolioManagerPanel: React.FC<PortfolioManagerPanelProps> = ({
  activeTab,
  onTabChange,
  onClose,
  portfolios,
  activePortfolio,
  trackedTickers,
  stocks,
  onSelectPortfolio,
  onCreatePortfolio,
  onRenamePortfolio,
  onDeletePortfolio,
  onUpdateCash,
  onUpsertHolding,
  onBulkImport,
  onVerifySymbols,
}) => {
  // Manual entry state
  const [tickerInput, setTickerInput] = useState('');
  const [sharesInput, setSharesInput] = useState('');
  const [costBasisInput, setCostBasisInput] = useState('');
  const [manualMergeMode, setManualMergeMode] = useState<'replace' | 'add'>('replace');
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);
  const [manualValidating, setManualValidating] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchOption[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHighlightedIndex, setSearchHighlightedIndex] = useState<number>(-1);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const searchDropdownRef = useRef<HTMLDivElement | null>(null);

  // Cash quick-edit state
  const [cashInput, setCashInput] = useState<string>(
    activePortfolio ? String(activePortfolio.cashBalance) : '0'
  );
  const [cashSavedMsg, setCashSavedMsg] = useState<string | null>(null);

  // Portfolio management state
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [newPortfolioCash, setNewPortfolioCash] = useState('0');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // CSV import state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [csvFileName, setCsvFileName] = useState<string>('');
  const [csvRawText, setCsvRawText] = useState<string>('');
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping>({
    tickerCol: null,
    sharesCol: null,
    costBasisCol: null,
    marketValueCol: null,
    assetTypeCol: null,
  });
  const [csvDupStrategy, setCsvDupStrategy] = useState<'merge' | 'skip'>('merge');
  const [csvExistingMode, setCsvExistingMode] = useState<'add' | 'replace'>('add');
  const [csvIncludeCash, setCsvIncludeCash] = useState<boolean>(true);
  const [csvVerifying, setCsvVerifying] = useState<boolean>(false);
  const [csvVerifiedInvalid, setCsvVerifiedInvalid] = useState<Set<string>>(new Set());
  const [csvVerificationDone, setCsvVerificationDone] = useState<boolean>(false);
  const [csvNotice, setCsvNotice] = useState<string | null>(null);
  const [csvNewPortfolioName, setCsvNewPortfolioName] = useState<string>('');

  // Watchlist import state
  const [watchlistDraft, setWatchlistDraft] = useState<
    Record<string, { selected: boolean; shares: string; costBasis: string }>
  >(() => {
    const initial: Record<string, { selected: boolean; shares: string; costBasis: string }> = {};
    for (const sym of trackedTickers) {
      initial[sym] = { selected: false, shares: '', costBasis: '' };
    }
    return initial;
  });
  const [watchlistMergeMode, setWatchlistMergeMode] = useState<'add' | 'replace'>('replace');
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [watchlistNotice, setWatchlistNotice] = useState<string | null>(null);

  useEffect(() => {
    setCashInput(activePortfolio ? String(activePortfolio.cashBalance) : '0');
  }, [activePortfolio?.id, activePortfolio?.cashBalance]);

  // Close search dropdown on outside click
  useEffect(() => {
    if (!searchOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setSearchHighlightedIndex(-1);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [searchOpen]);

  // Live ticker autocomplete using existing /api/market/search
  useEffect(() => {
    const q = tickerInput.trim();
    if (!q || q.length < 1 || activeTab !== 'manual') {
      setSearchResults([]);
      setSearchHighlightedIndex(-1);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!cancelled && data?.success && Array.isArray(data.results)) {
          setSearchResults(
            data.results
              .filter((r: any) => r?.supported !== false)
              .slice(0, 6)
              .map((r: any) => ({
                symbol: String(r.symbol || '').toUpperCase(),
                name: String(r.name || r.symbol || ''),
                instrumentType: String(r.instrumentType || 'EQUITY'),
                exchange: String(r.exchange || ''),
              }))
          );
          setSearchHighlightedIndex(-1);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
          setSearchHighlightedIndex(-1);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tickerInput, activeTab]);

  const parsedCsv = useMemo(() => {
    if (!csvRawText.trim()) return { headers: [], rows: [], hasHeaderRow: false };
    return parseCsvText(csvRawText);
  }, [csvRawText]);

  const csvValidation = useMemo(() => {
    if (parsedCsv.rows.length === 0) return null;
    return validateCsvImportRows(parsedCsv.rows, csvMapping, {
      duplicateStrategy: csvDupStrategy,
      existingHoldings: activePortfolio?.holdings || [],
      verifiedInvalidTickers: csvVerifiedInvalid,
    });
  }, [parsedCsv, csvMapping, csvDupStrategy, activePortfolio?.holdings, csvVerifiedInvalid]);

  const normalizedManualTicker = normalizeTickerSymbol(tickerInput);
  const manualExistingHolding = useMemo(
    () => activePortfolio?.holdings.find((h) => h.ticker === normalizedManualTicker) || null,
    [activePortfolio?.holdings, normalizedManualTicker]
  );

  const handleLoadCsvText = (raw: string, fileName = '') => {
    setCsvRawText(raw);
    setCsvFileName(fileName);
    const parsed = parseCsvText(raw);
    setCsvMapping(detectCsvColumnMapping(parsed.headers));
    setCsvVerifiedInvalid(new Set());
    setCsvVerificationDone(false);
    setCsvNotice(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      handleLoadCsvText(String(reader.result || ''), file.name);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleVerifyCsvTickers = async () => {
    if (!csvValidation || csvValidation.validHoldings.length === 0) return;
    setCsvVerifying(true);
    setCsvNotice(null);
    try {
      const tickers = csvValidation.validHoldings.map((h) => h.ticker);
      const metaMap = await onVerifySymbols(tickers);
      const invalidSet = new Set<string>();
      for (const sym of tickers) {
        const meta = metaMap[sym];
        if (!meta || !meta.valid) {
          invalidSet.add(sym);
        }
      }
      setCsvVerifiedInvalid(invalidSet);
      setCsvVerificationDone(true);
      if (invalidSet.size > 0) {
        setCsvNotice(
          `${invalidSet.size} ticker${invalidSet.size === 1 ? '' : 's'} failed market verification (${Array.from(invalidSet).join(', ')}) and will be excluded.`
        );
      } else {
        setCsvNotice(`All ${tickers.length} tickers verified against live market data.`);
      }
    } catch {
      setCsvNotice('Unable to verify tickers right now. Review rows carefully before confirming.');
    } finally {
      setCsvVerifying(false);
    }
  };

  const handleConfirmCsvImport = () => {
    if (!csvValidation || csvValidation.globalErrors.length > 0) return;
    if (csvValidation.validHoldings.length === 0 && csvValidation.detectedCashTotal <= 0) return;

    let targetId = activePortfolio?.id ?? null;
    if (!targetId) {
      const created = onCreatePortfolio(
        csvNewPortfolioName.trim() ||
          (csvFileName ? csvFileName.replace(/\.csv$/i, '') : 'Imported Portfolio'),
        0
      );
      targetId = created.id;
    }

    onBulkImport(
      targetId,
      csvValidation.validHoldings.map((h) => ({
        ticker: h.ticker,
        shares: h.shares,
        avgCostBasis: h.avgCostBasis,
        source: 'csv',
      })),
      csvExistingMode,
      csvIncludeCash && csvValidation.detectedCashTotal > 0 ? csvValidation.detectedCashTotal : 0
    );

    setCsvRawText('');
    setCsvFileName('');
    setCsvVerifiedInvalid(new Set());
    setCsvVerificationDone(false);
    onClose();
  };

  const handleManualAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);
    setManualSuccess(null);

    const sym = normalizeTickerSymbol(tickerInput);
    if (!sym || !isValidTickerFormat(sym)) {
      setManualError('Enter a valid ticker symbol (e.g., AAPL, MSFT, BRK-B, SPY).');
      return;
    }

    const shares = Number(sharesInput);
    if (!Number.isFinite(shares) || shares <= 0) {
      setManualError('Shares must be a positive number.');
      return;
    }

    let avgCostBasis: number | null = null;
    if (costBasisInput.trim() !== '') {
      const parsedCost = Number(costBasisInput);
      if (!Number.isFinite(parsedCost) || parsedCost < 0) {
        setManualError('Average cost basis must be zero or a positive dollar amount.');
        return;
      }
      avgCostBasis = parsedCost;
    }

    setManualValidating(true);
    try {
      const metaMap = await onVerifySymbols([sym]);
      const meta = metaMap[sym];
      if (!meta || !meta.valid) {
        setManualError(`Ticker "${sym}" was not recognized as a valid security.`);
        return;
      }

      if (!activePortfolio) {
        onCreatePortfolio('Primary Portfolio', 0);
      }
      onUpsertHolding(
        { ticker: sym, shares, avgCostBasis, source: 'manual' },
        manualExistingHolding ? manualMergeMode : 'replace'
      );
      setTickerInput('');
      setSharesInput('');
      setCostBasisInput('');
      setSearchOpen(false);
      setManualSuccess(`Saved ${shares} shares of ${sym}.`);
    } finally {
      setManualValidating(false);
    }
  };

  const handleSaveCash = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(cashInput.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setCashSavedMsg('Enter a valid non-negative cash balance.');
      return;
    }
    if (!activePortfolio) {
      onCreatePortfolio('Primary Portfolio', parsed);
    } else {
      onUpdateCash(parsed);
    }
    setCashSavedMsg('Cash position updated.');
    window.setTimeout(() => setCashSavedMsg(null), 2500);
  };

  const handleCreatePortfolioSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPortfolioName.trim();
    if (!trimmed) return;
    const cashVal = Number(newPortfolioCash.replace(/[$,\s]/g, ''));
    onCreatePortfolio(trimmed, Number.isFinite(cashVal) && cashVal >= 0 ? cashVal : 0);
    setNewPortfolioName('');
    setNewPortfolioCash('0');
  };

  const handleImportWatchlist = () => {
    setWatchlistError(null);
    setWatchlistNotice(null);

    const selectedEntries = trackedTickers
      .map((sym) => {
        const entry = watchlistDraft[sym];
        if (!entry?.selected) return null;
        const shares = Number(entry.shares);
        const cost = entry.costBasis.trim() !== '' ? Number(entry.costBasis) : null;
        return { sym, shares, cost };
      })
      .filter((x): x is { sym: string; shares: number; cost: number | null } => x !== null);

    if (selectedEntries.length === 0) {
      setWatchlistError('Select at least one tracked equity and enter share quantities.');
      return;
    }

    const invalidShares = selectedEntries.filter((x) => !Number.isFinite(x.shares) || x.shares <= 0);
    if (invalidShares.length > 0) {
      setWatchlistError(
        `Enter positive share quantities for: ${invalidShares.map((x) => x.sym).join(', ')}.`
      );
      return;
    }

    const invalidCost = selectedEntries.filter(
      (x) => x.cost !== null && (!Number.isFinite(x.cost) || x.cost < 0)
    );
    if (invalidCost.length > 0) {
      setWatchlistError(
        `Invalid average cost basis for: ${invalidCost.map((x) => x.sym).join(', ')}.`
      );
      return;
    }

    let targetId = activePortfolio?.id ?? null;
    if (!targetId) {
      const created = onCreatePortfolio('Watchlist Portfolio', 0);
      targetId = created.id;
    }

    onBulkImport(
      targetId,
      selectedEntries.map((x) => ({
        ticker: x.sym,
        shares: x.shares,
        avgCostBasis: x.cost,
        source: 'tracked_watchlist',
      })),
      watchlistMergeMode
    );
    setWatchlistNotice(`Imported ${selectedEntries.length} holdings from Tracked Equities.`);
    onClose();
  };

  const tabs: Array<{ id: PortfolioManagerTab; label: string; icon: React.ReactNode }> = [
    { id: 'manual', label: 'MANUAL ENTRY & CASH', icon: <Plus size={11} /> },
    { id: 'csv', label: 'CSV IMPORT', icon: <FileSpreadsheet size={11} /> },
    { id: 'watchlist', label: 'FROM TRACKED EQUITIES', icon: <Layers size={11} /> },
    { id: 'portfolios', label: `PORTFOLIOS (${portfolios.length})`, icon: <FolderPlus size={11} /> },
  ];

  return (
    <div className="bg-[#080808] border border-[#ff9900]/50 rounded p-4 font-mono space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2a2a] pb-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors cursor-pointer leading-none ${
                activeTab === tab.id
                  ? 'bg-[#ff9900] text-black border-[#ff9900]'
                  : 'bg-black text-zinc-400 border-[#333] hover:text-white hover:border-zinc-500'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close portfolio data manager"
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#333] bg-black text-zinc-400 hover:text-white hover:border-zinc-500 text-[10px] uppercase font-bold cursor-pointer leading-none"
        >
          <X size={11} />
          <span>CLOSE</span>
        </button>
      </div>

      {/* TAB 1: MANUAL ENTRY & CASH */}
      {activeTab === 'manual' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <form onSubmit={handleManualAddSubmit} className="lg:col-span-2 bg-black border border-[#262626] rounded p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                ADD / UPDATE HOLDING
              </span>
              {activePortfolio && (
                <span className="text-[10px] text-zinc-500">
                  TARGET: <span className="text-zinc-200 font-bold">{activePortfolio.name}</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div ref={searchContainerRef} className="relative">
                <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">
                  Ticker Symbol *
                </label>
                <div className="flex items-center bg-[#080808] border border-[#333] focus-within:border-[#3498db] rounded px-2 py-1.5">
                  <Search size={11} className="text-zinc-500 mr-1.5 shrink-0" />
                  <input
                    type="text"
                    value={tickerInput}
                    onChange={(e) => {
                      setTickerInput(e.target.value.toUpperCase());
                      setSearchOpen(true);
                      setSearchHighlightedIndex(-1);
                      setManualError(null);
                    }}
                    onFocus={() => {
                      if (searchResults.length > 0) setSearchOpen(true);
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
                          e.preventDefault();
                          const selected = searchResults[searchHighlightedIndex];
                          setTickerInput(selected.symbol);
                          setSearchOpen(false);
                          setSearchHighlightedIndex(-1);
                        }
                      } else if (e.key === 'Escape') {
                        if (searchOpen) {
                          e.preventDefault();
                          setSearchOpen(false);
                          setSearchHighlightedIndex(-1);
                        }
                      }
                    }}
                    placeholder="AAPL, SPY..."
                    className="w-full bg-transparent text-xs text-zinc-100 uppercase outline-none placeholder-zinc-600"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                {searchOpen && searchResults.length > 0 && (
                  <div
                    ref={searchDropdownRef}
                    role="listbox"
                    aria-label="Search suggestions"
                    className="absolute left-0 top-full mt-1 z-30 w-[32rem] max-w-[calc(100vw-2rem)] bg-[#0a0a0a] border border-[#444] rounded shadow-xl max-h-48 overflow-y-auto"
                  >
                    {searchResults.map((opt, idx) => {
                      const isHighlighted = idx === searchHighlightedIndex;
                      return (
                        <button
                          key={opt.symbol}
                          type="button"
                          role="option"
                          aria-selected={isHighlighted}
                          onClick={() => {
                            setTickerInput(opt.symbol);
                            setSearchOpen(false);
                            setSearchHighlightedIndex(-1);
                          }}
                          onMouseEnter={() => setSearchHighlightedIndex(idx)}
                          className={`w-full text-left px-2.5 py-1.5 border-b border-[#1c1c1c] last:border-b-0 flex items-center justify-between gap-3 text-[10.5px] cursor-pointer transition-colors ${
                            isHighlighted ? 'bg-[#1e293b] text-white' : 'hover:bg-[#1a1a1a]'
                          }`}
                        >
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            <span className="text-[#3498db] font-bold shrink-0">{opt.symbol}</span>
                            <span className="text-zinc-300 truncate">{opt.name}</span>
                          </div>
                          <span className="text-[9px] text-zinc-500 shrink-0 uppercase">{opt.instrumentType}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">
                  Shares *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={sharesInput}
                  onChange={(e) => setSharesInput(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full bg-[#080808] border border-[#333] focus:border-[#3498db] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none tabular-nums"
                />
              </div>

              <div>
                <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">
                  Avg Cost Basis (USD, Opt.)
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={costBasisInput}
                  onChange={(e) => setCostBasisInput(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-[#080808] border border-[#333] focus:border-[#3498db] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none tabular-nums"
                />
              </div>
            </div>

            {manualExistingHolding && (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#121212] border border-[#333] rounded px-2.5 py-1.5 text-[10.5px]">
                <span className="text-amber-400">
                  {manualExistingHolding.ticker} already exists ({manualExistingHolding.shares} shares).
                </span>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1 cursor-pointer text-zinc-300">
                    <input
                      type="radio"
                      name="manual-merge"
                      checked={manualMergeMode === 'replace'}
                      onChange={() => setManualMergeMode('replace')}
                    />
                    <span>Replace quantity</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer text-zinc-300">
                    <input
                      type="radio"
                      name="manual-merge"
                      checked={manualMergeMode === 'add'}
                      onChange={() => setManualMergeMode('add')}
                    />
                    <span>Add to existing</span>
                  </label>
                </div>
              </div>
            )}

            {manualError && (
              <div className="flex items-center gap-1.5 text-[10.5px] text-[#ff4444]">
                <AlertCircle size={12} className="shrink-0" />
                <span>{manualError}</span>
              </div>
            )}
            {manualSuccess && (
              <div className="flex items-center gap-1.5 text-[10.5px] text-[#00ff00]">
                <CheckCircle2 size={12} className="shrink-0" />
                <span>{manualSuccess}</span>
              </div>
            )}

            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={manualValidating}
                className="px-3 py-1.5 rounded bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-[10px] uppercase inline-flex items-center justify-center gap-1.5 leading-none transition-colors cursor-pointer disabled:opacity-40"
              >
                {manualValidating ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />}
                <span>{manualValidating ? 'VALIDATING...' : manualExistingHolding ? 'UPDATE POSITION' : 'ADD POSITION'}</span>
              </button>
            </div>
          </form>

          {/* Cash Position Card */}
          <form onSubmit={handleSaveCash} className="bg-black border border-[#262626] rounded p-3 space-y-3 flex flex-col justify-between">
            <div className="space-y-2.5">
              <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider block">
                CASH POSITION (USD)
              </span>
              <div className="flex items-center bg-[#080808] border border-[#333] focus-within:border-[#3498db] rounded px-2.5 py-1.5">
                <DollarSign size={12} className="text-zinc-500 mr-1 shrink-0" />
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  className="w-full bg-transparent text-xs text-zinc-100 outline-none tabular-nums"
                  placeholder="0.00"
                />
              </div>
              <div className="text-[10px] text-zinc-500">
                Cash is included in total portfolio value, allocation weights, volatility, beta, and downside stress buffers.
              </div>
              {cashSavedMsg && (
                <div className="text-[10px] text-[#00ff00]">{cashSavedMsg}</div>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-3 py-1.5 rounded border border-[#ff9900]/60 bg-[#ff9900]/10 hover:bg-[#ff9900] hover:text-black text-[#ff9900] font-bold text-[10px] uppercase inline-flex items-center justify-center leading-none transition-colors cursor-pointer"
              >
                SAVE CASH
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 2: CSV IMPORT */}
      {activeTab === 'csv' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-black border border-[#262626] rounded p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                  1. UPLOAD OR PASTE BROKERAGE CSV
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1 rounded bg-[#141414] border border-[#444] hover:border-[#ff9900] text-zinc-200 hover:text-[#ff9900] text-[10px] font-bold uppercase inline-flex items-center gap-1.5 cursor-pointer leading-none"
                >
                  <Upload size={11} />
                  <span>UPLOAD .CSV</span>
                </button>
              </div>
              {csvFileName && (
                <div className="text-[10px] text-[#00ff00]">Loaded file: {csvFileName}</div>
              )}
              <textarea
                rows={4}
                value={csvRawText}
                onChange={(e) => handleLoadCsvText(e.target.value, csvFileName)}
                placeholder={'Ticker,Shares,Average Cost\nAAPL,50,185.00\nMSFT,25,380.50\nCASH,5000,'}
                className="w-full bg-[#080808] border border-[#333] focus:border-[#3498db] rounded p-2 text-[11px] text-zinc-200 font-mono outline-none placeholder-zinc-600"
              />
              {!activePortfolio && (
                <div>
                  <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">
                    New Portfolio Name
                  </label>
                  <input
                    type="text"
                    value={csvNewPortfolioName}
                    onChange={(e) => setCsvNewPortfolioName(e.target.value)}
                    placeholder="e.g. Core Equity Brokerage"
                    className="w-full bg-[#080808] border border-[#333] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none"
                  />
                </div>
              )}
            </div>

            {/* Column Mapping */}
            <div className="bg-black border border-[#262626] rounded p-3 space-y-2.5">
              <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider block">
                2. COLUMN MAPPING & IMPORT RULES
              </span>
              {parsedCsv.headers.length === 0 ? (
                <div className="text-[11px] text-zinc-500 py-6 text-center">
                  Upload or paste a CSV file to detect and map brokerage columns.
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { key: 'tickerCol' as const, label: 'Ticker *' },
                      { key: 'sharesCol' as const, label: 'Shares *' },
                      { key: 'costBasisCol' as const, label: 'Cost Basis (Opt)' },
                      { key: 'marketValueCol' as const, label: 'Cash/Value (Opt)' },
                      { key: 'assetTypeCol' as const, label: 'Asset Type (Opt)' },
                    ].map((field) => (
                      <div key={field.key}>
                        <label className="block text-[9.5px] text-zinc-400 uppercase font-bold mb-1">
                          {field.label}
                        </label>
                        <select
                          value={csvMapping[field.key] === null ? '' : String(csvMapping[field.key])}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : Number(e.target.value);
                            setCsvMapping((prev) => ({ ...prev, [field.key]: val }));
                            setCsvVerificationDone(false);
                          }}
                          className="w-full bg-[#080808] border border-[#333] rounded px-2 py-1 text-[10.5px] text-zinc-200 outline-none"
                        >
                          <option value="">— Unmapped —</option>
                          {parsedCsv.headers.map((h, idx) => (
                            <option key={`${h}-${idx}`} value={idx}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[#1e1e1e] text-[10px] text-zinc-300">
                    <label className="inline-flex items-center gap-1.5">
                      <span className="text-zinc-500 uppercase">CSV Duplicates:</span>
                      <select
                        value={csvDupStrategy}
                        onChange={(e) => setCsvDupStrategy(e.target.value as 'merge' | 'skip')}
                        className="bg-[#080808] border border-[#333] rounded px-1.5 py-0.5 text-[10px] text-zinc-200"
                      >
                        <option value="merge">Merge shares</option>
                        <option value="skip">Skip duplicates</option>
                      </select>
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <span className="text-zinc-500 uppercase">Existing Holdings:</span>
                      <select
                        value={csvExistingMode}
                        onChange={(e) => setCsvExistingMode(e.target.value as 'add' | 'replace')}
                        className="bg-[#080808] border border-[#333] rounded px-1.5 py-0.5 text-[10px] text-zinc-200"
                      >
                        <option value="add">Merge shares</option>
                        <option value="replace">Overwrite</option>
                      </select>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={csvIncludeCash}
                        onChange={(e) => setCsvIncludeCash(e.target.checked)}
                      />
                      <span>Include cash rows</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Validation & Preview */}
          {csvValidation && (
            <div className="bg-black border border-[#262626] rounded p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[10px]">
                  <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                    3. VALIDATION &amp; PREVIEW
                  </span>
                  <span className="text-[#00ff00] font-bold tabular-nums">
                    {csvValidation.validHoldings.length} VALID
                  </span>
                  {csvValidation.cashRowCount > 0 && (
                    <span className="text-[#3498db] font-bold tabular-nums">
                      ${csvValidation.detectedCashTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })} CASH
                    </span>
                  )}
                  {csvValidation.duplicateRowCount > 0 && (
                    <span className="text-amber-400 font-bold tabular-nums">
                      {csvValidation.duplicateRowCount} DUPLICATE
                    </span>
                  )}
                  {csvValidation.errorRowCount > 0 && (
                    <span className="text-[#ff4444] font-bold tabular-nums">
                      {csvValidation.errorRowCount} INVALID
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={csvVerifying || csvValidation.validHoldings.length === 0}
                    onClick={handleVerifyCsvTickers}
                    className="px-2.5 py-1.5 rounded border border-[#3498db]/60 bg-[#3498db]/10 hover:bg-[#3498db]/20 text-[#3498db] font-bold text-[10px] uppercase inline-flex items-center gap-1.5 leading-none cursor-pointer disabled:opacity-40"
                  >
                    <RefreshCw size={10} className={csvVerifying ? 'animate-spin' : ''} />
                    <span>{csvVerifying ? 'VERIFYING...' : 'VERIFY TICKERS'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={
                      csvValidation.globalErrors.length > 0 ||
                      (csvValidation.validHoldings.length === 0 && csvValidation.detectedCashTotal <= 0)
                    }
                    onClick={handleConfirmCsvImport}
                    className="px-3 py-1.5 rounded bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-[10px] uppercase inline-flex items-center gap-1.5 leading-none cursor-pointer disabled:opacity-40"
                  >
                    <CheckCircle2 size={11} />
                    <span>CONFIRM IMPORT</span>
                  </button>
                </div>
              </div>

              {csvValidation.globalErrors.map((err, i) => (
                <div key={`ge-${i}`} className="flex items-center gap-1.5 text-[10.5px] text-[#ff4444]">
                  <AlertCircle size={12} className="shrink-0" />
                  <span>{err}</span>
                </div>
              ))}
              {csvValidation.globalWarnings.map((warn, i) => (
                <div key={`gw-${i}`} className="flex items-center gap-1.5 text-[10.5px] text-amber-400">
                  <AlertTriangle size={12} className="shrink-0" />
                  <span>{warn}</span>
                </div>
              ))}
              {csvNotice && (
                <div className={`text-[10.5px] ${csvVerifiedInvalid.size > 0 ? 'text-amber-400' : 'text-[#00ff00]'}`}>
                  {csvNotice}
                </div>
              )}
              {!csvVerificationDone && csvValidation.validHoldings.length > 0 && (
                <div className="text-[10px] text-zinc-500">
                  Tip: Click VERIFY TICKERS to validate every symbol against live market data before confirming.
                </div>
              )}

              <div className="overflow-x-auto max-h-56 overflow-y-auto border border-[#1f1f1f] rounded">
                <table className="w-full text-left text-[10.5px] border-collapse">
                  <thead>
                    <tr className="bg-[#0d0d0d] border-b border-[#2a2a2a] text-zinc-500 text-[9.5px] uppercase">
                      <th className="py-1.5 px-2">Row</th>
                      <th className="py-1.5 px-2">Status</th>
                      <th className="py-1.5 px-2">Ticker</th>
                      <th className="py-1.5 px-2 text-right">Shares / Cash</th>
                      <th className="py-1.5 px-2 text-right">Cost Basis</th>
                      <th className="py-1.5 px-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181818]">
                    {csvValidation.rows.map((row) => (
                      <tr key={row.rowIndex} className="hover:bg-[#101010]">
                        <td className="py-1.5 px-2 text-zinc-500 tabular-nums">{row.rowIndex}</td>
                        <td className="py-1.5 px-2">
                          <span
                            className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                              row.status === 'valid'
                                ? 'text-[#00ff00] border-[#00ff00]/40 bg-[#00ff00]/10'
                                : row.status === 'cash'
                                ? 'text-[#3498db] border-[#3498db]/40 bg-[#3498db]/10'
                                : row.status === 'duplicate_in_csv'
                                ? 'text-amber-400 border-amber-500/40 bg-amber-500/10'
                                : 'text-[#ff4444] border-[#ff4444]/40 bg-[#ff4444]/10'
                            }`}
                          >
                            {row.status === 'duplicate_in_csv' ? 'DUPLICATE' : row.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 font-bold text-zinc-100">{row.ticker || row.rawTicker || '—'}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-zinc-200">
                          {row.status === 'cash' && row.cashAmount !== null
                            ? `$${row.cashAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : row.shares !== null
                            ? row.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })
                            : '—'}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-zinc-300">
                          {row.avgCostBasis !== null ? `$${row.avgCostBasis.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-1.5 px-2 text-[10px]">
                          {row.errors.length > 0 ? (
                            <span className="text-[#ff4444]">{row.errors.join(' ')}</span>
                          ) : row.warnings.length > 0 ? (
                            <span className="text-amber-400">{row.warnings.join(' ')}</span>
                          ) : (
                            <span className="text-zinc-500">Ready</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: EXISTING QUORIX TRACKED EQUITIES INTEGRATION */}
      {activeTab === 'watchlist' && (
        <div className="bg-black border border-[#262626] rounded p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider block">
                IMPORT FROM QUORIX TRACKED EQUITIES
              </span>
              <span className="text-[10px] text-zinc-500">
                Select equities from your personal Quorix watchlist and enter actual share quantities. Institutional 13F holdings in INST are never imported.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={watchlistMergeMode}
                onChange={(e) => setWatchlistMergeMode(e.target.value as 'add' | 'replace')}
                className="bg-[#080808] border border-[#333] rounded px-2 py-1 text-[10px] text-zinc-200"
              >
                <option value="replace">Overwrite existing</option>
                <option value="add">Add to existing</option>
              </select>
              <button
                type="button"
                onClick={handleImportWatchlist}
                className="px-3 py-1.5 rounded bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-[10px] uppercase inline-flex items-center gap-1.5 leading-none cursor-pointer"
              >
                <CheckCircle2 size={11} />
                <span>IMPORT SELECTED</span>
              </button>
            </div>
          </div>

          {watchlistError && (
            <div className="flex items-center gap-1.5 text-[10.5px] text-[#ff4444]">
              <AlertCircle size={12} className="shrink-0" />
              <span>{watchlistError}</span>
            </div>
          )}
          {watchlistNotice && (
            <div className="text-[10.5px] text-[#00ff00]">{watchlistNotice}</div>
          )}

          {trackedTickers.length === 0 ? (
            <div className="text-center py-6 text-[11px] text-zinc-500">
              No tracked equities in your Quorix watchlist.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-64 overflow-y-auto border border-[#1f1f1f] rounded">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead>
                  <tr className="bg-[#0d0d0d] border-b border-[#2a2a2a] text-zinc-500 text-[9.5px] uppercase">
                    <th className="py-1.5 px-2 w-8">Use</th>
                    <th className="py-1.5 px-2">Ticker</th>
                    <th className="py-1.5 px-2">Name</th>
                    <th className="py-1.5 px-2 text-right">Last Price</th>
                    <th className="py-1.5 px-2 text-right">Shares *</th>
                    <th className="py-1.5 px-2 text-right">Avg Cost (Opt)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181818]">
                  {trackedTickers.map((sym) => {
                    const st = stocks[sym];
                    const row = watchlistDraft[sym] || { selected: false, shares: '', costBasis: '' };
                    return (
                      <tr key={sym} className="hover:bg-[#101010]">
                        <td className="py-1.5 px-2">
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(e) =>
                              setWatchlistDraft((prev) => ({
                                ...prev,
                                [sym]: { ...row, selected: e.target.checked },
                              }))
                            }
                          />
                        </td>
                        <td className="py-1.5 px-2 font-bold text-[#3498db]">{sym}</td>
                        <td className="py-1.5 px-2 text-zinc-300 truncate max-w-[180px]">
                          {st?.name || sym}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-zinc-200">
                          {st && st.price > 0 ? `$${st.price.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={row.shares}
                            onChange={(e) => {
                              const val = e.target.value;
                              setWatchlistDraft((prev) => ({
                                ...prev,
                                [sym]: {
                                  ...row,
                                  shares: val,
                                  selected: val.trim() !== '' ? true : row.selected,
                                },
                              }));
                            }}
                            placeholder="0"
                            className="w-24 bg-[#080808] border border-[#333] rounded px-2 py-0.5 text-right text-[11px] text-zinc-100 tabular-nums outline-none focus:border-[#3498db]"
                          />
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={row.costBasis}
                            onChange={(e) =>
                              setWatchlistDraft((prev) => ({
                                ...prev,
                                [sym]: { ...row, costBasis: e.target.value },
                              }))
                            }
                            placeholder="Optional"
                            className="w-24 bg-[#080808] border border-[#333] rounded px-2 py-0.5 text-right text-[11px] text-zinc-100 tabular-nums outline-none focus:border-[#3498db]"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: MULTIPLE PORTFOLIOS MANAGER */}
      {activeTab === 'portfolios' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form onSubmit={handleCreatePortfolioSubmit} className="bg-black border border-[#262626] rounded p-3 space-y-3">
            <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider block">
              CREATE NEW PORTFOLIO
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">
                  Portfolio Name *
                </label>
                <input
                  type="text"
                  value={newPortfolioName}
                  onChange={(e) => setNewPortfolioName(e.target.value)}
                  placeholder="e.g. Retirement IRA"
                  className="w-full bg-[#080808] border border-[#333] focus:border-[#3498db] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 uppercase font-bold mb-1">
                  Starting Cash (USD)
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={newPortfolioCash}
                  onChange={(e) => setNewPortfolioCash(e.target.value)}
                  className="w-full bg-[#080808] border border-[#333] focus:border-[#3498db] rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none tabular-nums"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!newPortfolioName.trim()}
                className="px-3 py-1.5 rounded bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-[10px] uppercase inline-flex items-center gap-1.5 leading-none cursor-pointer disabled:opacity-40"
              >
                <FolderPlus size={11} />
                <span>CREATE PORTFOLIO</span>
              </button>
            </div>
          </form>

          <div className="bg-black border border-[#262626] rounded p-3 space-y-2">
            <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider block">
              SAVED PORTFOLIOS ({portfolios.length})
            </span>
            {portfolios.length === 0 ? (
              <div className="text-[11px] text-zinc-500 py-4">No portfolios created yet.</div>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {portfolios.map((pf) => {
                  const isActive = activePortfolio?.id === pf.id;
                  const isRenaming = renameId === pf.id;
                  return (
                    <div
                      key={pf.id}
                      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded border ${
                        isActive
                          ? 'bg-[#151515] border-[#ff9900]'
                          : 'bg-[#080808] border-[#222] hover:border-[#444]'
                      }`}
                    >
                      {isRenaming ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (renameDraft.trim()) onRenamePortfolio(pf.id, renameDraft.trim());
                            setRenameId(null);
                          }}
                          className="flex items-center gap-1.5 flex-1"
                        >
                          <input
                            type="text"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            className="flex-1 bg-black border border-[#3498db] rounded px-2 py-0.5 text-xs text-white outline-none"
                            autoFocus
                          />
                          <button
                            type="submit"
                            className="px-2 py-0.5 rounded bg-[#ff9900] text-black text-[9.5px] font-bold uppercase cursor-pointer"
                          >
                            SAVE
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenameId(null)}
                            className="px-2 py-0.5 rounded border border-[#333] text-zinc-400 text-[9.5px] uppercase cursor-pointer"
                          >
                            CANCEL
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onSelectPortfolio(pf.id)}
                            className="text-left flex-1 min-w-0 cursor-pointer"
                          >
                            <div className="text-xs font-bold text-zinc-100 truncate">{pf.name}</div>
                            <div className="text-[10px] text-zinc-500 tabular-nums">
                              {pf.holdings.length} holding{pf.holdings.length === 1 ? '' : 's'} · Cash $
                              {pf.cashBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                            </div>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setRenameId(pf.id);
                                setRenameDraft(pf.name);
                              }}
                              className="px-2 py-0.5 rounded border border-[#333] text-[9.5px] text-zinc-400 hover:text-[#ff9900] hover:border-[#ff9900] uppercase cursor-pointer"
                            >
                              RENAME
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeletePortfolio(pf.id)}
                              title={`Delete ${pf.name}`}
                              aria-label={`Delete portfolio ${pf.name}`}
                              className="p-1 rounded border border-[#333] text-zinc-500 hover:text-[#ff4444] hover:border-[#ff4444] cursor-pointer"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

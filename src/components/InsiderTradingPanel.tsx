import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import type {
  InsiderTradingRecord,
  InsiderTradingResponse,
  InsiderTransactionCategory,
} from '../types';
import {
  formatInsiderPrice,
  formatInsiderShares,
  formatInsiderValue,
} from '../utils/insiderTrading';

export interface InsiderTradingPanelProps {
  ticker: string;
  /** Optional preloaded state for deterministic SSR / unit testing. */
  initialResponse?: InsiderTradingResponse | null;
  /** Optional initial loading state override for testing. */
  initialLoading?: boolean;
  /** Disables automatic fetch on mount when testing static states. */
  disableAutoFetch?: boolean;
}

const PAGE_SIZE = 20;

function getTransactionVisualClass(category: InsiderTransactionCategory): {
  labelClass: string;
  codeClass: string;
} {
  switch (category) {
    case 'purchase':
      return {
        labelClass: 'text-[#00ff00] font-bold',
        codeClass: 'text-[#00ff00] border-[#00ff00]/40 bg-[#00ff00]/10',
      };
    case 'sale':
    case 'disposition':
      return {
        labelClass: 'text-[#ff4444] font-bold',
        codeClass: 'text-[#ff4444] border-[#ff4444]/40 bg-[#ff4444]/10',
      };
    case 'grant':
      return {
        labelClass: 'text-[#ff9900] font-semibold',
        codeClass: 'text-[#ff9900] border-[#ff9900]/40 bg-[#ff9900]/10',
      };
    case 'exercise':
      return {
        labelClass: 'text-[#3498db] font-semibold',
        codeClass: 'text-[#3498db] border-[#3498db]/40 bg-[#3498db]/10',
      };
    case 'tax':
    case 'gift':
    default:
      return {
        labelClass: 'text-zinc-300 font-normal',
        codeClass: 'text-zinc-400 border-zinc-700 bg-zinc-900',
      };
  }
}

export const InsiderTradingPanel: React.FC<InsiderTradingPanelProps> = ({
  ticker,
  initialResponse = null,
  initialLoading = false,
  disableAutoFetch = false,
}) => {
  const normalizedTicker = (ticker || '').trim().toUpperCase();

  const [response, setResponse] = useState<InsiderTradingResponse | null>(initialResponse);
  const [loading, setLoading] = useState<boolean>(
    initialLoading || (!initialResponse && !disableAutoFetch && Boolean(normalizedTicker))
  );
  const [offset, setOffset] = useState<number>(initialResponse?.offset ?? 0);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef<number>(0);

  const fetchInsiders = useCallback(
    async (targetTicker: string, targetOffset: number, force = false) => {
      if (!targetTicker) {
        setResponse(null);
        setLoading(false);
        setNetworkError(null);
        return;
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const reqId = ++requestSeqRef.current;

      setLoading(true);
      setNetworkError(null);

      try {
        const params = new URLSearchParams({
          ticker: targetTicker,
          limit: String(PAGE_SIZE),
          offset: String(targetOffset),
        });
        if (force) params.set('force', 'true');

        const res = await fetch(`/api/insiders?${params.toString()}`, {
          signal: controller.signal,
        });
        const data: InsiderTradingResponse = await res.json();

        if (reqId !== requestSeqRef.current) return;
        setResponse(data);
        setLoading(false);
      } catch (err: any) {
        if (err?.name === 'AbortError' || reqId !== requestSeqRef.current) return;
        setResponse(null);
        setNetworkError('Unable to retrieve insider trading data.');
        setLoading(false);
      }
    },
    []
  );

  // Clear stale records immediately and fetch fresh data whenever the selected ticker changes
  useEffect(() => {
    if (disableAutoFetch) return;
    setResponse(null);
    setOffset(0);
    setNetworkError(null);
    if (!normalizedTicker) {
      setLoading(false);
      return;
    }
    fetchInsiders(normalizedTicker, 0, false);

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [normalizedTicker, disableAutoFetch, fetchInsiders]);

  const handlePageChange = (nextOffset: number) => {
    const safeOffset = Math.max(0, nextOffset);
    setOffset(safeOffset);
    fetchInsiders(normalizedTicker, safeOffset, false);
  };

  const handleRefresh = () => {
    fetchInsiders(normalizedTicker, offset, true);
  };

  // Never display records belonging to a different ticker
  const activeResponse =
    response && (!normalizedTicker || response.ticker.toUpperCase() === normalizedTicker)
      ? response
      : null;

  const records: InsiderTradingRecord[] = activeResponse?.success ? activeResponse.records : [];
  const isMissingKey = Boolean(activeResponse?.requiresKey);
  const errorMessage =
    networkError || (!activeResponse?.success && !isMissingKey ? activeResponse?.error || null : null);
  const hasMore = Boolean(activeResponse?.hasMore);
  const showPagination = activeResponse?.success && (offset > 0 || hasMore);
  const isFilingOnlyMode = activeResponse?.dataMode === 'filings';

  return (
    <section
      aria-label="Insider Trading"
      className="bg-[#050505] border border-[#333] p-3 rounded font-mono"
    >
      {/* Section Header */}
      <div className="border-b border-[#333] pb-1.5 mb-2 flex flex-wrap items-center justify-between gap-2 select-none">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
            INSIDER TRADING
          </h2>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
          {activeResponse?.success && records.length > 0 && (
            <span className="tabular-nums">
              {offset + 1}–{offset + records.length}
              {hasMore ? '+' : ''}
            </span>
          )}
          {!disableAutoFetch && normalizedTicker && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              aria-label={`Refresh insider trading records for ${normalizedTicker}`}
              title="Refresh insider trading records"
              className="text-zinc-500 hover:text-[#00ff00] disabled:text-zinc-700 transition-colors cursor-pointer"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center gap-1.5 py-4 text-[10px] text-zinc-500 font-mono">
          <RefreshCw size={10} className="animate-spin text-[#ff9900]" />
          <span>RETRIEVING INSIDER TRADING RECORDS FOR {normalizedTicker}...</span>
        </div>
      ) : isMissingKey ? (
        /* Missing API Key State */
        <div className="bg-black border border-[#ff9900]/35 rounded px-3 py-2.5 text-[11px] text-zinc-400 flex items-start gap-2">
          <AlertCircle size={13} className="text-[#ff9900] shrink-0 mt-0.5" />
          <div>
            <span className="text-[#ff9900] font-bold uppercase block text-[10px] mb-0.5">
              3spread API Configuration Required
            </span>
            <span>
              Configure <span className="text-zinc-200 font-semibold">THREESPREAD_API_KEY</span> on
              the server (or in System Settings <span className="text-zinc-200 font-semibold">SETT</span>) to load SEC insider trading filings.
            </span>
          </div>
        </div>
      ) : errorMessage ? (
        /* API Error State */
        <div className="bg-black border border-[#ff4444]/35 rounded px-3 py-2.5 text-[11px] text-[#ff4444] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle size={13} className="shrink-0" />
            <span className="truncate">{errorMessage}</span>
          </div>
          {!disableAutoFetch && (
            <button
              type="button"
              onClick={handleRefresh}
              className="px-2 py-0.5 text-[10px] font-bold uppercase border border-[#ff4444]/40 rounded text-zinc-200 hover:bg-[#ff4444]/10 cursor-pointer shrink-0"
            >
              RETRY
            </button>
          )}
        </div>
      ) : records.length === 0 ? (
        /* Empty State */
        <div className="text-center py-4 text-zinc-500 text-[11px]">
          No insider trading records available for this ticker.
        </div>
      ) : (
        /* Populated Table State */
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] text-zinc-300 border-collapse font-mono">
              <thead>
                <tr className="border-b border-[#2a2a2a] text-zinc-500 text-[10px] uppercase font-bold">
                  <th className="py-2 pr-3 whitespace-nowrap">DATE</th>
                  <th className="py-2 px-2 whitespace-nowrap">INSIDER</th>
                  <th className="py-2 px-2 whitespace-nowrap">TRANSACTION</th>
                  {!isFilingOnlyMode && (
                    <>
                      <th className="py-2 px-2 text-right whitespace-nowrap">SHARES</th>
                      <th className="py-2 px-2 text-right whitespace-nowrap">PRICE</th>
                      <th className="py-2 px-2 text-right whitespace-nowrap">VALUE</th>
                    </>
                  )}
                  <th className="py-2 pl-2 text-right whitespace-nowrap">FILING</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => {
                  const visual = getTransactionVisualClass(rec.transactionCategory);
                  const filingLabel = rec.formType
                    ? `Form ${rec.formType}${rec.filingDate ? ` · ${rec.filingDate}` : ''}`
                    : rec.filingDate || rec.accessionNum || 'SEC Filing';

                  return (
                    <tr
                      key={rec.id}
                      className="border-b border-[#1c1c1c] hover:bg-[#101010] transition-colors align-middle"
                    >
                      <td className="py-2 pr-3 text-zinc-400 tabular-nums whitespace-nowrap">
                        {rec.date || '—'}
                      </td>
                      <td className="py-2 px-2 text-zinc-100 font-semibold max-w-[220px]">
                        <div className="truncate" title={rec.insiderName}>
                          {rec.insiderName}
                        </div>
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {rec.transactionCode && (
                            <span
                              className={`inline-block px-1 py-px text-[9px] font-bold uppercase border rounded-xs leading-tight ${visual.codeClass}`}
                              title={`SEC Form 4 Transaction Code ${rec.transactionCode}`}
                            >
                              {rec.transactionCode}
                            </span>
                          )}
                          <span className={visual.labelClass}>{rec.transactionLabel}</span>
                        </div>
                        {rec.securityTitle && (
                          <div className="text-[9.5px] text-zinc-500 truncate max-w-[180px]">
                            {rec.securityTitle}
                          </div>
                        )}
                      </td>
                      {!isFilingOnlyMode && (
                        <>
                          <td className="py-2 px-2 text-right text-zinc-200 tabular-nums whitespace-nowrap">
                            {formatInsiderShares(rec.shares)}
                          </td>
                          <td className="py-2 px-2 text-right text-zinc-300 tabular-nums whitespace-nowrap">
                            {formatInsiderPrice(rec.price)}
                          </td>
                          <td
                            className={`py-2 px-2 text-right tabular-nums whitespace-nowrap ${
                              rec.transactionCategory === 'purchase'
                                ? 'text-[#00ff00] font-semibold'
                                : rec.transactionCategory === 'sale'
                                ? 'text-[#ff4444] font-semibold'
                                : 'text-zinc-200'
                            }`}
                          >
                            {formatInsiderValue(rec.totalValue)}
                          </td>
                        </>
                      )}
                      <td className="py-2 pl-2 text-right whitespace-nowrap">
                        {rec.sourceUrl ? (
                          <a
                            href={rec.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[#3498db] hover:text-[#5dade2] hover:underline text-[10px] tabular-nums"
                            title={
                              rec.accessionNum
                                ? `Open SEC filing ${rec.accessionNum} in a new tab`
                                : 'Open original SEC filing in a new tab'
                            }
                          >
                            <span>{filingLabel}</span>
                            <ExternalLink size={10} className="shrink-0" aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="text-zinc-500 text-[10px] tabular-nums">
                            {filingLabel}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {showPagination && (
            <div className="mt-2.5 pt-2 border-t border-[#1e1e1e] flex items-center justify-between text-[10px] text-zinc-500 select-none">
              <span className="tabular-nums">
                SHOWING {offset + 1}–{offset + records.length}
                {activeResponse?.windowStart && activeResponse?.windowEnd
                  ? ` · WINDOW ${activeResponse.windowStart} TO ${activeResponse.windowEnd}`
                  : ''}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handlePageChange(offset - PAGE_SIZE)}
                  disabled={offset === 0 || loading}
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded border border-[#333] bg-[#0a0a0a] text-zinc-300 hover:border-[#555] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer uppercase font-bold"
                >
                  <ChevronLeft size={11} />
                  <span>PREV</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePageChange(offset + PAGE_SIZE)}
                  disabled={!hasMore || loading}
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded border border-[#333] bg-[#0a0a0a] text-zinc-300 hover:border-[#555] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer uppercase font-bold"
                >
                  <span>NEXT</span>
                  <ChevronRight size={11} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

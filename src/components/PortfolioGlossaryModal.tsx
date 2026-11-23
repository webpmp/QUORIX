import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';

export type PrmGlossaryTermId =
  | 'risk-assessment'
  | 'beta'
  | 'spy'
  | 'volatility'
  | 'max-drawdown'
  | 'hhi'
  | 'effective-holdings'
  | 'top-weight'
  | 'single-stock-vs-etf'
  | 'unrealized-pnl'
  | 'risk-share'
  | 'diversification-ratio'
  | 'correlation'
  | 'correlated-cluster'
  | 'unclassified'
  | 'leveraged-etf'
  | 'stress-test'
  | 'lookback';

export interface PrmGlossaryEntry {
  id: PrmGlossaryTermId;
  term: string;
  definition: string;
}

export const PRM_GLOSSARY_TERMS: readonly PrmGlossaryEntry[] = [
  {
    id: 'risk-assessment',
    term: 'Risk Assessment',
    definition:
      'Overall rule-based rating (Low, Moderate, Elevated, or High) summarizing concentration, volatility, beta, and correlation risk across the portfolio.',
  },
  {
    id: 'beta',
    term: 'Beta (vs SPY)',
    definition:
      'Measures how strongly portfolio returns move relative to the S&P 500. A beta of 3.0 means the portfolio has historically moved about 3x as much as the S&P 500.',
  },
  {
    id: 'spy',
    term: 'SPY',
    definition:
      'Ticker symbol for the SPDR S&P 500 ETF, used as the broad U.S. stock market benchmark for beta and market-shock scenarios.',
  },
  {
    id: 'volatility',
    term: 'Volatility (annualized)',
    definition:
      'Measures how widely portfolio returns swing over the lookback window, scaled to a full trading year (252 days) using how holdings move together.',
  },
  {
    id: 'max-drawdown',
    term: 'Max Drawdown',
    definition:
      'The largest peak-to-trough percentage decline the portfolio would have experienced over the selected lookback window at current weights.',
  },
  {
    id: 'hhi',
    term: 'HHI (Herfindahl-Hirschman Index)',
    definition:
      'A concentration score from 0 to 10,000 equal to the sum of squared percentage weights, where higher numbers mean more capital is packed into fewer holdings.',
  },
  {
    id: 'effective-holdings',
    term: 'Effective Holdings',
    definition:
      'The number of equal-weight positions that would match your portfolio concentration (1 / Σw²), showing how concentrated the portfolio actually behaves.',
  },
  {
    id: 'top-weight',
    term: 'Top 5 / Top 10 Weight',
    definition:
      'The combined share of total portfolio value concentrated in your 5 or 10 largest positions.',
  },
  {
    id: 'single-stock-vs-etf',
    term: 'Single-Stock vs ETF Exposure',
    definition:
      'Splits portfolio weight between individual company stocks and pooled ETFs or funds to distinguish company-specific risk from fund exposure.',
  },
  {
    id: 'unrealized-pnl',
    term: 'Unrealized P&L',
    definition:
      'Paper gain or loss on open holdings, calculated as current market value minus total entered cost basis.',
  },
  {
    id: 'risk-share',
    term: 'Risk Share',
    definition:
      'Each holding’s percentage contribution to total portfolio volatility, factoring in both position size and how closely it moves with the rest of the portfolio.',
  },
  {
    id: 'diversification-ratio',
    term: 'Diversification Ratio',
    definition:
      'Compares the weighted average volatility of individual holdings to total portfolio volatility; values above 1.0x mean imperfect correlations are smoothing swings.',
  },
  {
    id: 'correlation',
    term: 'Correlation (r)',
    definition:
      'A score from -1.00 to +1.00 showing how closely two holdings move together day to day, where +1.00 means lockstep movement and negative values offset each other.',
  },
  {
    id: 'correlated-cluster',
    term: 'Correlated Cluster',
    definition:
      'A group of holdings whose daily returns all move closely together above your high-correlation threshold, creating overlapping risk across multiple tickers.',
  },
  {
    id: 'unclassified',
    term: 'Unclassified (Broad ETF / Fund)',
    definition:
      'Multi-sector funds, bond ETFs, leveraged products, or securities without a single GICS sector assignment, kept separate rather than forcing an inaccurate sector.',
  },
  {
    id: 'leveraged-etf',
    term: 'Leveraged ETF',
    definition:
      'A fund built to deliver a daily multiple (such as 2x or 3x) of an underlying stock or index; several holdings can be 2x leveraged funds, which is why their beta and volatility are very high.',
  },
  {
    id: 'stress-test',
    term: 'Stress Test',
    definition:
      'A hypothetical what-if estimate showing potential dollar and percentage losses during a sharp market, sector, or single-holding drop; it is not a forecast.',
  },
  {
    id: 'lookback',
    term: 'Lookback',
    definition:
      'The historical window of daily trading sessions (such as 30D, 90D, 6M, or 1Y) used to compute volatility, beta, max drawdown, and correlations.',
  },
] as const;

export interface PortfolioGlossaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTermId?: PrmGlossaryTermId | null;
}

export const PortfolioGlossaryModal: React.FC<PortfolioGlossaryModalProps> = ({
  isOpen,
  onClose,
  initialTermId = null,
}) => {
  const [query, setQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<PrmGlossaryTermId | null>(initialTermId);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setHighlightedId(initialTermId ?? null);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const timer = window.setTimeout(() => {
      if (initialTermId && itemRefs.current[initialTermId]) {
        itemRefs.current[initialTermId]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      } else {
        closeButtonRef.current?.focus();
      }
    }, 30);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(timer);
    };
  }, [isOpen, initialTermId, onClose]);

  const filteredTerms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PRM_GLOSSARY_TERMS;
    return PRM_GLOSSARY_TERMS.filter(
      (entry) =>
        entry.term.toLowerCase().includes(q) || entry.definition.toLowerCase().includes(q)
    );
  }, [query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-[2px] p-4 font-mono"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="prm-glossary-title"
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-[#080808] border border-prm-border rounded shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (matches StudiesModal dialog pattern) */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-prm-border bg-[#050505] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen size={16} className="text-[#ff9900] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2
                id="prm-glossary-title"
                className="text-sm font-extrabold text-white tracking-wider uppercase"
              >
                Portfolio Risk Glossary
              </h2>
              <p className="text-prm-label text-zinc-300 mt-0.5">
                Plain-English definitions for metrics in Portfolio Risk Monitor
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close glossary"
            className="min-h-8 min-w-8 px-2 py-1.5 rounded border border-prm-border bg-black text-zinc-300 hover:text-white hover:border-[#ff9900] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff9900] inline-flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X size={15} />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-4 py-3 border-b border-prm-divider bg-[#080808] shrink-0">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightedId(null);
              }}
              aria-label="Filter glossary terms"
              placeholder="Filter terms (e.g. Beta, HHI, Leveraged ETF, Drawdown)..."
              className="w-full min-h-8 bg-black border border-prm-border focus:border-[#ff9900] rounded pl-9 pr-8 py-1.5 text-prm-body text-white placeholder-zinc-400 focus:outline-none transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear glossary filter"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Definitions list */}
        <div className="overflow-y-auto p-4 space-y-2.5">
          {filteredTerms.length === 0 ? (
            <div className="text-prm-body text-zinc-300 text-center py-6">
              No glossary terms match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <dl className="space-y-2.5">
              {filteredTerms.map((entry) => {
                const isHighlighted = highlightedId === entry.id;
                return (
                  <div
                    key={entry.id}
                    id={`prm-glossary-term-${entry.id}`}
                    ref={(el) => {
                      itemRefs.current[entry.id] = el;
                    }}
                    className={`rounded border px-3 py-2.5 transition-colors ${
                      isHighlighted
                        ? 'bg-[#17120a] border-[#ff9900]'
                        : 'bg-black border-prm-border'
                    }`}
                  >
                    <dt className="text-prm-body font-bold text-[#ff9900]">{entry.term}</dt>
                    <dd className="text-prm-body text-zinc-200 mt-1 leading-relaxed">
                      {entry.definition}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortfolioGlossaryModal;

import { useState, useEffect } from 'react';
import { X, Search, Check, RotateCcw } from 'lucide-react';
import {
  STUDY_CATALOG,
  StudyCategory,
  StudyId,
} from '../utils/technicalStudies';

interface StudiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeStudies: StudyId[];
  onToggleStudy: (id: StudyId) => void;
  onResetDefaults: () => void;
  onClearAll: () => void;
}

type FilterTab = 'all' | StudyCategory;

export default function StudiesModal({
  isOpen,
  onClose,
  activeStudies,
  onToggleStudy,
  onResetDefaults,
  onClearAll,
}: StudiesModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<FilterTab>('all');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const q = searchQuery.trim().toLowerCase();
  const filteredStudies = STUDY_CATALOG.filter((study) => {
    if (categoryFilter !== 'all' && study.category !== categoryFilter) {
      return false;
    }
    if (!q) return true;
    return (
      study.name.toLowerCase().includes(q) ||
      study.code.toLowerCase().includes(q) ||
      study.description.toLowerCase().includes(q)
    );
  });

  const activeSet = new Set(activeStudies);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-[2px] p-4 font-mono select-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="studies-modal-title"
    >
      <div
        className="w-full max-w-3xl bg-[#080808] border border-[#333] rounded shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626] bg-[#050505]">
          <div className="min-w-0">
            <h2
              id="studies-modal-title"
              className="text-sm font-extrabold text-white tracking-wider uppercase"
            >
              Graph Price Studies &amp; Indicators
            </h2>
            <p className="text-[11px] text-zinc-400 mt-0.5 tabular-nums">
              {activeStudies.length} active · Selections persist automatically across sessions
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close studies modal"
            className="p-1.5 rounded border border-[#333] text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Search & Category Filters */}
        <div className="p-4 pb-3 border-b border-[#1f1f1f] space-y-3 bg-[#080808]">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search studies (e.g. VWAP, MACD, Bollinger, Stochastic, ADX)..."
              className="w-full bg-black border border-[#333] focus:border-[#ff9900] rounded pl-9 pr-8 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none transition-colors"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1 bg-black p-1 rounded border border-[#222]">
            {(
              [
                { id: 'all', label: 'All Studies' },
                { id: 'overlay', label: 'Price Overlays' },
                { id: 'momentum', label: 'Momentum & Trend' },
                { id: 'volume_volatility', label: 'Volume & Volatility' },
              ] as Array<{ id: FilterTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={`px-3 py-1.5 rounded text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  categoryFilter === tab.id
                    ? 'bg-[#ff9900] text-black'
                    : 'text-zinc-400 hover:text-white hover:bg-[#141414]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Study Grid */}
        <div className="p-4 overflow-y-auto max-h-[55vh] bg-[#060606]">
          {filteredStudies.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-500 space-y-2 border border-dashed border-[#262626] rounded">
              <div>No studies match &ldquo;{searchQuery}&rdquo;.</div>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('all');
                }}
                className="px-3 py-1.5 border border-[#333] rounded text-[#ff9900] hover:border-[#ff9900] font-bold cursor-pointer"
              >
                Clear Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredStudies.map((study) => {
                const isActive = activeSet.has(study.id);
                return (
                  <button
                    key={study.id}
                    type="button"
                    onClick={() => onToggleStudy(study.id)}
                    aria-pressed={isActive}
                    className={`w-full text-left p-3 rounded border transition-colors flex items-start gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#ff9900] ${
                      isActive
                        ? 'bg-[#121212] border-[#ff9900]/70 text-white'
                        : 'bg-[#0a0a0a] border-[#242424] hover:border-[#444] text-zinc-300'
                    }`}
                  >
                    {/* Checkbox */}
                    <span
                      className={`mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
                        isActive
                          ? 'bg-[#ff9900] border-[#ff9900] text-black'
                          : 'bg-black border-[#444] text-transparent'
                      }`}
                    >
                      <Check size={11} strokeWidth={3} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-2.5 h-1 rounded-full shrink-0 ${study.bgClass}`}
                          />
                          <span className="font-bold text-xs text-white truncate">
                            {study.code}
                          </span>
                        </div>
                        <span className="text-[10px] text-zinc-500 whitespace-nowrap shrink-0">
                          {study.placement}
                        </span>
                      </div>
                      <div className="text-[11px] font-semibold text-zinc-200 mt-0.5 truncate">
                        {study.name}
                      </div>
                      <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">
                        {study.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-[#262626] bg-[#050505]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetDefaults}
              className="px-3 py-1.5 rounded border border-[#333] text-[11px] font-bold text-zinc-300 hover:text-[#ff9900] hover:border-[#ff9900] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw size={12} />
              <span>Reset Defaults</span>
            </button>
            <button
              type="button"
              onClick={onClearAll}
              disabled={activeStudies.length === 0}
              className="px-3 py-1.5 rounded border border-[#333] text-[11px] font-bold text-zinc-400 hover:text-[#ff4444] hover:border-[#ff4444] disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Clear All
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-1.5 rounded bg-[#ff9900] hover:bg-[#ffaa22] text-black text-xs font-extrabold tracking-wide transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

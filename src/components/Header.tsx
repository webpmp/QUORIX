import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { extractRecognizedCommandPrefix, formatCommandInput } from '../utils/commandParser';

interface HeaderProps {
  currentCommand: string;
  onCommandChange: (val: string) => void;
  onCommandSubmit: (e: React.FormEvent) => void;
  activeScreen: string;
  tickTime?: string;
  errorMessage?: string | null;
}

const SEARCH_HISTORY_STORAGE_KEY = 'quorix_search_history_v1';
const MAX_SEARCH_HISTORY = 5;

function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(trimmed);
      if (cleaned.length >= MAX_SEARCH_HISTORY) break;
    }
    return cleaned;
  } catch {
    return [];
  }
}

export default function Header({
  currentCommand,
  onCommandChange,
  onCommandSubmit,
  activeScreen,
  tickTime,
  errorMessage
}: HeaderProps) {
  const [time, setTime] = useState(new Date());
  const [searchHistory, setSearchHistory] = useState<string[]>(loadSearchHistory);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [historySubmitTick, setHistorySubmitTick] = useState<number>(0);

  const historyContainerRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingHistorySubmitRef = useRef<boolean>(false);
  const prevCommandRef = useRef<string>(currentCommand);

  // When a command code is placed into the input programmatically, ensure caret is at the end
  useLayoutEffect(() => {
    if (prevCommandRef.current !== currentCommand) {
      prevCommandRef.current = currentCommand;
      if (document.activeElement === inputRef.current && inputRef.current) {
        const len = currentCommand.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }
  }, [currentCommand]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pendingHistorySubmitRef.current) return;
    pendingHistorySubmitRef.current = false;
    formRef.current?.requestSubmit();
  }, [historySubmitTick, currentCommand]);

  useEffect(() => {
    if (!isHistoryOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (
        historyContainerRef.current &&
        !historyContainerRef.current.contains(e.target as Node)
      ) {
        setIsHistoryOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const shouldRefocusInput = Boolean(
          historyContainerRef.current?.contains(document.activeElement)
        );
        setIsHistoryOpen(false);
        if (shouldRefocusInput) {
          inputRef.current?.focus();
        }
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isHistoryOpen]);

  const recordSearchHistory = (rawTerm: string) => {
    const trimmed = rawTerm.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const key = trimmed.toLowerCase();
      const next = [
        trimmed,
        ...prev.filter((item) => item.trim().toLowerCase() !== key),
      ].slice(0, MAX_SEARCH_HISTORY);
      try {
        localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    const trimmed = currentCommand.trim();
    if (trimmed) {
      recordSearchHistory(trimmed);
    }
    setIsHistoryOpen(false);
    onCommandSubmit(e);
  };

  const handleSelectHistoryItem = (entry: string) => {
    onCommandChange(entry);
    setIsHistoryOpen(false);
    pendingHistorySubmitRef.current = true;
    setHistorySubmitTick((n) => n + 1);
  };

  const handleRemoveHistoryItem = (entry: string) => {
    const key = entry.trim().toLowerCase();
    setSearchHistory((prev) => {
      const next = prev.filter((item) => item.trim().toLowerCase() !== key);
      try {
        localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const formatZoneTime = (timeZone: string) => {
    return time.toLocaleTimeString('en-GB', {
      timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <header className="relative z-40 bg-[#1a1a1a] border-b border-[#333] select-none text-[#d4d4d4] font-mono text-xs">
      {/* City clks */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1 bg-black border-b border-[#3a3a3a] text-xs text-zinc-400">
        <div className="flex items-center space-x-4">
          <span className="text-[#00ff00] font-bold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ff00]"></span>
            CONNECTED
          </span>
          <span className="tabular-nums text-white font-black">
            {tickTime || '--'}
          </span>
          <span className="hidden sm:inline">GMT {formatZoneTime('UTC')}</span>
          <span className="hidden md:inline"><span className="text-[#ff9900]">NY</span> {formatZoneTime('America/New_York')}</span>
          <span className="hidden md:inline"><span className="text-[#ff9900]">LDN</span> {formatZoneTime('Europe/London')}</span>
          <span className="hidden lg:inline"><span className="text-[#ff9900]">TYO</span> {formatZoneTime('Asia/Tokyo')}</span>
        </div>
      </div>

      {/* Primary Input Commad Bar */}
      <div className="p-2.5 bg-[#0a0a0a] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
        {/* Terminal Indicator */}
        <div className="flex items-center space-x-2 text-[#ff9900] font-extrabold pr-2 shrink-0">
          <span className="text-2xl leading-none tracking-wider uppercase">QUORIX</span>
          <span className="text-zinc-300 text-xs font-normal">v1.0</span>
        </div>

        {/* Input area */}
        <div ref={historyContainerRef} className="relative w-full sm:w-[47rem] max-w-full min-w-0 shrink">
          <form
            ref={formRef}
            onSubmit={handleFormSubmit}
            className="flex items-center bg-black border border-[#444] focus-within:border-[#3498db] px-2 py-1 rounded transition-colors duration-150"
          >
            <button
              type="button"
              onClick={() => setIsHistoryOpen((prev) => !prev)}
              aria-expanded={isHistoryOpen}
              aria-haspopup="listbox"
              aria-controls="terminal-search-history"
              aria-label={isHistoryOpen ? 'Collapse recent search history' : 'Expand recent search history'}
              title={isHistoryOpen ? 'Hide recent searches' : 'Show recent searches'}
              className="w-5 h-5 shrink-0 mr-1.5 flex items-center justify-center rounded text-[#3498db] hover:text-white hover:bg-[#3498db]/20 font-bold select-none cursor-pointer transition-colors leading-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#3498db]"
            >
              {isHistoryOpen ? '⌄' : '>'}
            </button>
            <div className="relative flex-1 min-w-0 flex items-center h-full">
              {/* Synchronized visual presentation layer for command prefix styling */}
              {(() => {
                const prefixMatch = extractRecognizedCommandPrefix(currentCommand);
                if (prefixMatch && prefixMatch.prefix) {
                  const hasTrailingSpace = prefixMatch.remainder.length > 0 && /^\s/.test(prefixMatch.remainder);
                  const badgeInsetClass = hasTrailingSpace
                    ? 'left-[-4px] right-[-4px]'
                    : 'left-[-4px] right-0';

                  return (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none select-none absolute inset-0 flex items-center font-mono text-sm whitespace-pre"
                    >
                      <span className="relative inline-flex items-center justify-center font-mono text-sm leading-none shrink-0 uppercase">
                        {/* Invisible character sizing anchor matching input typography */}
                        <span className="invisible select-none">{prefixMatch.prefix}</span>
                        {/* Perfectly centered visual badge with balanced padding and full border visibility */}
                        <span className={`absolute ${badgeInsetClass} top-1/2 -translate-y-1/2 flex items-center justify-center bg-black border border-[#3a3a3a] rounded text-xs text-[#ff9900] font-bold leading-none px-1.5 h-[18px]`}>
                          {prefixMatch.prefix}
                        </span>
                      </span>
                      <span className="text-[#00ff00] uppercase font-mono">
                        {prefixMatch.remainder}
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
              <input
                ref={inputRef}
                type="text"
                value={currentCommand}
                onChange={(e) => {
                  onCommandChange(e.target.value.toUpperCase());
                }}
                placeholder="Enter command code (e.g., AAPL GP, CRNC, WEAT, or describe stock/query...)"
                className={`w-full bg-transparent font-mono text-sm uppercase placeholder:normal-case outline-none placeholder-zinc-700 caret-[#00ff00] relative z-10 selection:bg-[#3498db]/40 selection:text-white ${
                  extractRecognizedCommandPrefix(currentCommand) ? 'text-transparent' : 'text-[#00ff00]'
                }`}
                id="terminal-input"
                autoFocus
                autoComplete="off"
                spellCheck="false"
              />
            </div>
            <button
              type="submit"
              className="ml-2 px-3 py-0.5 rounded bg-[#ff9900] text-black font-extrabold text-xs uppercase hover:bg-amber-500 transition-colors cursor-pointer shrink-0"
            >
              EXEC
            </button>
          </form>

          {errorMessage && (
            <div
              role="alert"
              className="absolute left-0 top-full mt-1 z-50 bg-[#110505] border border-[#ff4444] px-2.5 py-1 rounded text-xs font-mono text-[#ff4444] flex items-center gap-1.5 shadow-lg shadow-black/80 animate-fade-in"
            >
              <span className="font-bold">!</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {isHistoryOpen && (
            <div
              id="terminal-search-history"
              role="listbox"
              aria-label="Recent searches"
              className="absolute left-0 right-0 top-full mt-1 z-50 bg-black border border-[#444] rounded shadow-xl shadow-black/90 overflow-hidden"
            >
              {searchHistory.length === 0 ? (
                <div className="px-3 py-2 text-xs font-mono text-zinc-300">
                  No recent searches yet
                </div>
              ) : (
                searchHistory.map((item) => {
                  const prefixMatch = extractRecognizedCommandPrefix(item);
                  return (
                    <div
                      key={item}
                      role="option"
                      aria-selected={false}
                      className="flex items-center border-b border-[#3a3a3a] last:border-b-0 bg-black hover:bg-[#3498db]/15 transition-colors"
                    >
                      <button
                        type="button"
                        aria-label={`Run recent search: ${item}`}
                        onClick={() => handleSelectHistoryItem(item)}
                        className="flex-1 min-w-0 text-left px-2.5 py-1.5 flex items-center gap-2 focus-visible:bg-[#3498db]/15 focus-visible:outline-none cursor-pointer font-mono text-xs"
                      >
                        <span className="text-[#3498db] font-bold shrink-0" aria-hidden="true">&gt;</span>
                        {prefixMatch && prefixMatch.prefix ? (
                          <div className="flex items-center truncate whitespace-pre">
                            <span className="inline-flex items-center justify-center bg-black border border-[#3a3a3a] rounded text-xs text-[#ff9900] font-bold leading-none px-1.5 h-[18px] shrink-0 uppercase mr-1.5">
                              {prefixMatch.prefix}
                            </span>
                            <span className="text-[#00ff00] uppercase font-mono truncate">
                              {prefixMatch.remainder.trimStart()}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[#00ff00] truncate">{item}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${item} from search history`}
                        title="Remove from history"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveHistoryItem(item);
                        }}
                        className="shrink-0 px-2.5 py-1.5 text-zinc-300 hover:text-[#ff4444] focus-visible:text-[#ff4444] focus-visible:outline-none cursor-pointer font-mono text-xs font-bold leading-none transition-colors"
                      >
                        &times;
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Active command display */}
        <div className="flex items-center space-x-2 text-xs self-end sm:self-auto shrink-0">
          <span className="text-zinc-300">ACTIVE SCREEN:</span>
          <span className="bg-black border border-[#333] px-2 py-0.5 text-[#ff9900] font-bold rounded uppercase tracking-wider min-w-[42px] text-center">
            {activeScreen || 'GP COMMAND'}
          </span>
        </div>
      </div>
    </header>
  );
}

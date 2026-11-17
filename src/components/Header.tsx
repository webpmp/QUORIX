import React, { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';

interface HeaderProps {
  currentCommand: string;
  onCommandChange: (val: string) => void;
  onCommandSubmit: (e: React.FormEvent) => void;
  activeScreen: string;
  tickTime?: string;
}

export default function Header({
  currentCommand,
  onCommandChange,
  onCommandSubmit,
  activeScreen,
  tickTime
}: HeaderProps) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
    <header className="bg-[#1a1a1a] border-b border-[#333] select-none text-[#d4d4d4] font-mono text-xs">
      {/* City clks */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1 bg-black border-b border-[#222] text-[10px] text-zinc-400">
        <div className="flex items-center space-x-4">
          <span className="text-[#00ff00] font-bold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ff00]"></span>
            CONNECTED
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <span className="text-zinc-300 font-bold">TICK/TIME</span>
            <span className="text-white font-black">{tickTime || '--'}</span>
          </span>
          <span className="hidden sm:inline">GMT {formatZoneTime('UTC')}</span>
          <span className="hidden md:inline"><span className="text-[#ff9900]">NY</span> {formatZoneTime('America/New_York')}</span>
          <span className="hidden md:inline"><span className="text-[#ff9900]">LDN</span> {formatZoneTime('Europe/London')}</span>
          <span className="hidden lg:inline"><span className="text-[#ff9900]">TYO</span> {formatZoneTime('Asia/Tokyo')}</span>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center gap-1 text-[10px] text-[#3498db]">
            <ShieldCheck size={12} />
            <span>AI GROUNDING: ACTIVE</span>
          </div>
        </div>
      </div>

      {/* Primary Input Commad Bar */}
      <div className="p-2.5 bg-[#0a0a0a] flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
        {/* Terminal Indicator */}
        <div className="flex items-center space-x-2 text-[#ff9900] font-extrabold pr-2 sm:border-r border-[#333]">
          <span className="text-2xl leading-none tracking-wider uppercase">QUORIX</span>
          <span className="text-zinc-500 text-[10px] font-normal">v4.2</span>
        </div>

        {/* Input area */}
        <form onSubmit={onCommandSubmit} className="flex-1 flex items-center bg-black border border-[#444] focus-within:border-[#3498db] px-2 py-1 rounded transition-colors duration-150">
          <span className="text-[#3498db] mr-2 font-bold select-none">&gt;</span>
          <input
            type="text"
            value={currentCommand}
            onChange={(e) => onCommandChange(e.target.value)}
            placeholder="Enter command code (e.g., AAPL GP, CRNC, WEAT, or describe stock/query...)"
            className="w-full bg-transparent text-[#00ff00] font-mono text-sm outline-none placeholder-zinc-700 caret-[#00ff00]"
            id="terminal-input"
            autoFocus
            autoComplete="off"
            spellCheck="false"
          />
          <button
            type="submit"
            className="ml-2 px-3 py-0.5 rounded bg-[#ff9900] text-black font-extrabold text-[10px] uppercase hover:bg-amber-500 transition-colors"
          >
            EXEC
          </button>
        </form>

        {/* Active command display */}
        <div className="flex items-center space-x-2 text-[10px] self-end sm:self-auto">
          <span className="text-zinc-500">ACTIVE SCREEN:</span>
          <span className="bg-black border border-[#333] px-2 py-0.5 text-[#ff9900] font-bold rounded uppercase tracking-wider min-w-[42px] text-center">
            {activeScreen || 'GP COMMAND'}
          </span>
        </div>
      </div>
    </header>
  );
}

import { useEffect, useState } from 'react';
import { StockData } from '../types';

function getMarketTimeDetails() {
  try {
    const etString = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const etDate = new Date(etString);
    const day = etDate.getDay();
    const hours = etDate.getHours();
    const minutes = etDate.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    const isWeekend = day === 0 || day === 6;
    if (isWeekend) {
      return { isWeekend: true, isPreMarket: false, isCoreHours: false, isAfterHours: false };
    }

    const isPreMarket = (totalMinutes >= 4 * 60) && (totalMinutes < 9 * 60 + 30);
    const isCoreHours = (totalMinutes >= 9 * 60 + 30) && (totalMinutes < 16 * 60);
    const isAfterHours = (totalMinutes >= 16 * 60) && (totalMinutes < 20 * 60);

    return {
      isWeekend,
      isPreMarket,
      isCoreHours,
      isAfterHours
    };
  } catch (err) {
    const date = new Date();
    const day = date.getDay();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    const isWeekend = day === 0 || day === 6;
    if (isWeekend) {
      return { isWeekend: true, isPreMarket: false, isCoreHours: false, isAfterHours: false };
    }
    const isPreMarket = (totalMinutes >= 4 * 60) && (totalMinutes < 9 * 60 + 30);
    const isCoreHours = (totalMinutes >= 9 * 60 + 30) && (totalMinutes < 16 * 60);
    const isAfterHours = (totalMinutes >= 16 * 60) && (totalMinutes < 20 * 60);

    return {
      isWeekend,
      isPreMarket,
      isCoreHours,
      isAfterHours
    };
  }
}

interface TickerTapeProps {
  stocks: Record<string, StockData>;
  onSelectTicker?: (ticker: string) => void;
}

const TAPE_ITEMS = [
  { name: 'S&P 500', symbol: 'SPX' },
  { name: 'DOW JONES', symbol: 'DJI' },
  { name: 'NASDAQ', symbol: 'IXIC' },
  { name: 'GOLD (OZ)', symbol: 'GC' },
  { name: 'WTI CRUDE', symbol: 'CL' },
  { name: 'US 10Y BOND', symbol: 'TNX' },
  { name: 'BITCOIN', symbol: 'BTC' }
];

export const getTickerSymbol = (name: string): string => {
  const norm = name.toUpperCase();
  if (norm.includes('S&P') || norm.includes('500')) return 'SPX';
  if (norm.includes('DOW') || norm.includes('JONES')) return 'DJI';
  if (norm.includes('NASDAQ')) return 'IXIC';
  if (norm.includes('GOLD')) return 'GC';
  if (norm.includes('CRUDE') || norm.includes('BRENT') || norm.includes('WTI')) return 'CL';
  if (norm.includes('BOND') || norm.includes('10Y')) return 'TNX';
  if (norm.includes('BITCOIN') || norm.includes('BTC')) return 'BTC';
  return name;
};

export default function TickerTape({ stocks, onSelectTicker }: TickerTapeProps) {
  const [isMarketHours, setIsMarketHours] = useState<boolean>(true);
  const [, setTimerValue] = useState<number>(Date.now());

  // Force re-renders periodically to clear expired tick flash animations precisely
  useEffect(() => {
    const reRenderInterval = setInterval(() => {
      setTimerValue(Date.now());
    }, 500);

    const mDetails = getMarketTimeDetails();
    setIsMarketHours(mDetails.isPreMarket || mDetails.isCoreHours || mDetails.isAfterHours);

    const marketHoursInterval = setInterval(() => {
      const activeDetails = getMarketTimeDetails();
      setIsMarketHours(activeDetails.isPreMarket || activeDetails.isCoreHours || activeDetails.isAfterHours);
    }, 15000);

    return () => {
      clearInterval(reRenderInterval);
      clearInterval(marketHoursInterval);
    };
  }, []);

  return (
    <div className="bg-[#1a1a1a] border-b border-[#333] select-none text-xs font-mono py-1 px-3 whitespace-nowrap overflow-x-auto overflow-y-hidden flex items-center space-x-6 text-[#d4d4d4] shadow-inner">
      <div className="flex items-center space-x-2 shrink-0">
        <span className="text-[9px] bg-[#ff9900] text-black px-1.5 py-0.5 font-extrabold uppercase rounded-sm">INDEX TAPE</span>
        {!isMarketHours && (
          <span className="text-[8px] bg-red-950/40 text-red-400 border border-red-900/40 px-1.5 py-0.5 font-bold uppercase rounded-sm">
            CLOSE/LAST
          </span>
        )}
      </div>
      <div className="flex space-x-6 items-center flex-1">
        {TAPE_ITEMS.map((item) => {
          const stock = stocks[item.symbol];
          if (!stock) return null;

          const hasPrice = stock.price > 0;
          const up = stock.change >= 0;
          const prefix = up ? '+' : '';
          
          let displayPrice = hasPrice
            ? stock.price.toLocaleString('en-US', { 
                minimumFractionDigits: stock.symbol === 'TNX' ? 3 : 2,
                maximumFractionDigits: stock.symbol === 'TNX' ? 3 : 2
              })
            : '--';
          
          if (hasPrice && stock.symbol === 'TNX') {
            displayPrice += '%';
          }

          const displayChange = hasPrice
            ? prefix + stock.change.toLocaleString('en-US', {
                minimumFractionDigits: stock.symbol === 'TNX' ? 3 : 2,
                maximumFractionDigits: stock.symbol === 'TNX' ? 3 : 2
              })
            : '--';

          const displayPercent = hasPrice ? prefix + stock.changePercent.toFixed(2) + '%' : '--';

          // Visual flash indicator for recent state updates
          const now = Date.now();
          const hasFlashedRecently = stock.lastTickTime && (now - stock.lastTickTime < 1500);
          const flashClass = hasFlashedRecently
            ? (stock.lastTickDirection === 'up'
                ? 'bg-emerald-500/25 text-emerald-400 scale-[1.02]'
                : 'bg-rose-500/25 text-rose-400 scale-[1.02]')
            : '';

          return (
            <div
              key={item.symbol}
              onClick={() => onSelectTicker?.(item.symbol)}
              className={`flex items-center space-x-1.5 px-2 py-0.5 rounded cursor-pointer transition-all duration-300 hover:bg-[#333]/50 hover:scale-[1.03] active:scale-[0.97] ${flashClass}`}
              title={`Click to open ${item.name} (${item.symbol}) in GRAPH PRICE`}
              id={`ticker-tape-${item.symbol}`}
            >
              <span className="text-zinc-400 font-semibold">{item.name}</span>
              <span className="text-white font-bold">{displayPrice}</span>
              <span className={`text-[10px] ${!hasPrice ? 'text-zinc-600' : up ? 'text-emerald-400' : 'text-rose-500'} font-mono`}>
                {hasPrice ? `${displayChange} (${displayPercent})` : '--'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

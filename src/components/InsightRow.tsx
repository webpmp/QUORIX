import React from 'react';
import type { CorrelationInsight } from '../utils/correlation.ts';

export interface InsightRowProps {
  item: CorrelationInsight;
  onPopulateTicker?: (ticker: string) => void;
}

/**
 * InsightRow renders a single analytical observation in the CORRELATION INSIGHTS panel.
 * Uses a two-column grid on sm+ (`sm:grid sm:grid-cols-[minmax(0,48rem)_9.5rem] sm:items-start sm:justify-start sm:gap-6`)
 * so the metric sits right after the text column (consistent 24px / gap-6) instead of at the panel's far right edge,
 * while maintaining identical line breaks and text column width across changing observations.
 * On mobile (<sm), falls back to flex column (`flex flex-col gap-2`).
 */
export const InsightRow: React.FC<InsightRowProps> = ({ item, onPopulateTicker }) => {
  const toneClass =
    item.tone === 'positive'
      ? 'text-[#00ff00]'
      : item.tone === 'negative'
      ? 'text-[#ff4444]'
      : item.tone === 'warning'
      ? 'text-amber-400'
      : 'text-[#3498db]';

  return (
    <div className="py-2.5 first:pt-0 last:pb-0 flex flex-col gap-2 sm:grid sm:grid-cols-[minmax(0,48rem)_9.5rem] sm:items-start sm:justify-start sm:gap-6">
      <div className="space-y-0.5 min-w-0">
        <div className={`text-xs font-bold uppercase tracking-wide ${toneClass}`}>
          {item.title}
        </div>
        <p className="text-xs text-zinc-300 leading-relaxed">{item.summary}</p>
      </div>
      <div className="text-[13px] font-bold text-zinc-200 tabular-nums whitespace-nowrap shrink-0 sm:text-left">
        {item.metricTickers && item.metricTickers.length === 2 && item.metricValue ? (
          <>
            {onPopulateTicker ? (
              <button
                type="button"
                onClick={() => onPopulateTicker(item.metricTickers![0])}
                title={`Populate ticker input with ${item.metricTickers[0]}`}
                aria-label={`Populate ticker input with ${item.metricTickers[0]}`}
                className="text-[#3498db] hover:text-[#ff9900] focus-visible:text-[#ff9900] font-bold cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff9900] rounded-xs"
              >
                {item.metricTickers[0]}
              </button>
            ) : (
              <span className="text-[#3498db] font-bold">{item.metricTickers[0]}</span>
            )}
            <span className="text-zinc-300"> / </span>
            {onPopulateTicker ? (
              <button
                type="button"
                onClick={() => onPopulateTicker(item.metricTickers![1])}
                title={`Populate ticker input with ${item.metricTickers[1]}`}
                aria-label={`Populate ticker input with ${item.metricTickers[1]}`}
                className="text-[#3498db] hover:text-[#ff9900] focus-visible:text-[#ff9900] font-bold cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff9900] rounded-xs"
              >
                {item.metricTickers[1]}
              </button>
            ) : (
              <span className="text-[#3498db] font-bold">{item.metricTickers[1]}</span>
            )}
            <span>: {item.metricValue}</span>
          </>
        ) : item.metricTickers && item.metricTickers.length === 1 && item.metricValue ? (
          <>
            {onPopulateTicker ? (
              <button
                type="button"
                onClick={() => onPopulateTicker(item.metricTickers![0])}
                title={`Populate ticker input with ${item.metricTickers[0]}`}
                aria-label={`Populate ticker input with ${item.metricTickers[0]}`}
                className="text-[#3498db] hover:text-[#ff9900] focus-visible:text-[#ff9900] font-bold cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff9900] rounded-xs"
              >
                {item.metricTickers[0]}
              </button>
            ) : (
              <span className="text-[#3498db] font-bold">{item.metricTickers[0]}</span>
            )}
            <span> {item.metricValue}</span>
          </>
        ) : (
          item.metricLabel
        )}
      </div>
    </div>
  );
}

export default InsightRow;

import React from 'react';

/**
 * Structured parsing and rendering for Security Analytics (DES) and Analyst Consensus (ANR) reports.
 */

export interface MetricItem {
  label: string;
  value: string;
}

export function parseMetricPair(line: string): MetricItem[] {
  // Line format e.g.:
  // "  LAST PRICE   : $355.58 (+1.23 / +0.35%)"
  // "  MARKET CAP   : 5.17T    |  BETA         : 1.09"
  // "  CONSENSUS    : BUY (45 analysts) | MEAN TARGET: $260.00"
  const parts = line.split('|');
  const items: MetricItem[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      const label = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (label && value) {
        items.push({ label, value });
      } else {
        items.push({ label: trimmed, value: '' });
      }
    } else {
      items.push({ label: trimmed, value: '' });
    }
  }

  return items;
}

export function isDividerLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && /^=+$/.test(trimmed);
}

export function isSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  const knownHeadings = [
    'MARKET & VALUATION METRICS',
    'FINANCIAL HEALTH & CASH FLOW',
    'BUSINESS OVERVIEW',
    'KEY EXECUTIVES',
    'RECENT HEADLINES',
    'RATING BREAKDOWN',
    'KEY FUNDAMENTAL DRIVERS',
  ];
  return knownHeadings.some((h) => trimmed === h || trimmed.startsWith(`${h} (`));
}

export function renderMetricGrid(items: MetricItem[]) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 py-1">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-baseline justify-between gap-3 text-xs leading-normal">
          <span className="text-zinc-400 font-medium tracking-wide shrink-0">
            {item.label}
          </span>
          <span className="text-zinc-100 font-semibold tabular-nums font-mono text-right truncate">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface AnrTableRow {
  period: string;
  strongBuy: string;
  buy: string;
  hold: string;
  sell: string;
  strongSell: string;
}

export function parseAnrTable(lines: string[]): {
  tableRows: AnrTableRow[];
  remainingLines: string[];
} {
  // Find table header row
  // Header e.g.: "  PERIOD   STRONG BUY   BUY   HOLD   SELL   STRONG SELL"
  const headerIdx = lines.findIndex((l) =>
    /PERIOD\s+STRONG BUY\s+BUY\s+HOLD\s+SELL\s+STRONG SELL/i.test(l)
  );

  if (headerIdx === -1) {
    return { tableRows: [], remainingLines: lines };
  }

  const tableRows: AnrTableRow[] = [];
  let currIdx = headerIdx + 1;

  // Next line might be dashes: e.g. "  ------   ----------   ---   ----   ----   -----------"
  if (currIdx < lines.length && /^\s*[- ]+\s*$/.test(lines[currIdx])) {
    currIdx++;
  }

  // Parse subsequent period rows (up to empty line or heading)
  while (currIdx < lines.length) {
    const line = lines[currIdx];
    const trimmed = line.trim();
    if (!trimmed || isSectionHeading(line) || isDividerLine(line) || trimmed.startsWith('SOURCE:')) {
      break;
    }

    const tokens = trimmed.split(/\s+/);
    if (tokens.length >= 6) {
      // 0: period, 1: strongBuy, 2: buy, 3: hold, 4: sell, 5: strongSell
      tableRows.push({
        period: tokens[0],
        strongBuy: tokens[1],
        buy: tokens[2],
        hold: tokens[3],
        sell: tokens[4],
        strongSell: tokens[5],
      });
      currIdx++;
    } else {
      break;
    }
  }

  const remainingLines = [...lines.slice(0, headerIdx), ...lines.slice(currIdx)];
  return { tableRows, remainingLines };
}

/**
 * Render structured DES (Security Analytics) Report
 */
interface StructuredDesReportProps {
  rawText: string;
  onSelectTicker?: (ticker: string) => void;
  quoteStrip?: React.ReactNode;
}

export const StructuredDesReport: React.FC<StructuredDesReportProps> = ({
  rawText,
  onSelectTicker,
  quoteStrip,
}) => {
  if (!rawText.trim()) return null;

  const lines = rawText.split('\n');

  // Filter out leading divider lines if present
  let startIdx = 0;
  while (startIdx < lines.length && (!lines[startIdx].trim() || isDividerLine(lines[startIdx]))) {
    startIdx++;
  }

  interface Section {
    type: 'meta' | 'metrics' | 'prose' | 'list' | 'footer' | 'raw';
    heading?: string;
    metrics?: MetricItem[];
    paragraphs?: string[];
    listItems?: string[];
    rawLines?: string[];
  }

  const sections: Section[] = [];
  let currentSection: Section | null = null;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (isDividerLine(line)) {
      continue;
    }

    if (!trimmed) {
      // blank line: ends current paragraph or flushes
      continue;
    }

    if (isSectionHeading(line)) {
      if (currentSection) {
        sections.push(currentSection);
      }
      if (trimmed === 'MARKET & VALUATION METRICS' || trimmed === 'FINANCIAL HEALTH & CASH FLOW') {
        currentSection = { type: 'metrics', heading: trimmed, metrics: [] };
      } else if (trimmed === 'BUSINESS OVERVIEW') {
        currentSection = { type: 'prose', heading: trimmed, paragraphs: [] };
      } else if (trimmed === 'KEY EXECUTIVES' || trimmed.startsWith('RECENT HEADLINES')) {
        currentSection = { type: 'list', heading: trimmed, listItems: [] };
      } else {
        currentSection = { type: 'raw', heading: trimmed, rawLines: [] };
      }
      continue;
    }

    if (trimmed.startsWith('SOURCE:')) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = { type: 'footer', rawLines: [trimmed] };
      continue;
    }

    // Check top meta lines: SECTOR: ... | INDUSTRY: ... or HQ: ... | EMPLOYEES: ...
    if (
      !currentSection &&
      (trimmed.startsWith('SECTOR:') ||
        trimmed.startsWith('HQ:') ||
        trimmed.startsWith('EXCHANGE:'))
    ) {
      const items = parseMetricPair(line);
      sections.push({ type: 'meta', metrics: items });
      continue;
    }

    if (currentSection) {
      if (currentSection.type === 'metrics') {
        const items = parseMetricPair(line);
        currentSection.metrics!.push(...items);
      } else if (currentSection.type === 'prose') {
        currentSection.paragraphs!.push(trimmed);
      } else if (currentSection.type === 'list') {
        currentSection.listItems!.push(trimmed);
      } else if (currentSection.type === 'footer') {
        currentSection.rawLines!.push(trimmed);
      } else {
        currentSection.rawLines!.push(trimmed);
      }
    } else {
      // Uncategorized lines before any heading
      sections.push({ type: 'raw', rawLines: [trimmed] });
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  let renderedQuoteStrip = false;

  return (
    <div className="font-sans space-y-4 text-zinc-300">
      {sections.map((sec, sIdx) => {
        const isMarketValuation =
          sec.type === 'metrics' && sec.heading === 'MARKET & VALUATION METRICS';
        const shouldPrependQuoteStrip = quoteStrip && isMarketValuation && !renderedQuoteStrip;
        if (shouldPrependQuoteStrip) {
          renderedQuoteStrip = true;
        }

        const quoteStripNode = shouldPrependQuoteStrip ? (
          <div key="quote-strip-container">{quoteStrip}</div>
        ) : null;

        if (sec.type === 'meta' && sec.metrics) {
          return (
            <React.Fragment key={sIdx}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-1.5 px-3 rounded bg-zinc-900/40 border border-[#222] text-xs">
                {sec.metrics.map((m, mIdx) => (
                  <div key={mIdx} className="flex items-baseline gap-1.5">
                    <span className="text-zinc-400 font-semibold uppercase tracking-wider">
                      {m.label}:
                    </span>
                    <span className="text-zinc-200 font-medium">{m.value}</span>
                  </div>
                ))}
              </div>
            </React.Fragment>
          );
        }

        if (sec.type === 'metrics' && sec.metrics) {
          return (
            <React.Fragment key={sIdx}>
              {quoteStripNode}
              <div className="space-y-1.5">
                {sec.heading && (
                  <div className="text-xs font-bold uppercase tracking-wider text-[#ff9900] border-b border-[#2e2e2e] pb-1">
                    {sec.heading}
                  </div>
                )}
                {renderMetricGrid(sec.metrics)}
              </div>
            </React.Fragment>
          );
        }

        if (sec.type === 'prose' && sec.paragraphs) {
          return (
            <div key={sIdx} className="space-y-2">
              {sec.heading && (
                <div className="text-xs font-bold uppercase tracking-wider text-[#ff9900] border-b border-[#2e2e2e] pb-1">
                  {sec.heading}
                </div>
              )}
              <div className="text-[13px] leading-relaxed text-zinc-300 space-y-2">
                {sec.paragraphs.map((para, pIdx) => (
                  <p key={pIdx}>{para}</p>
                ))}
              </div>
            </div>
          );
        }

        if (sec.type === 'list' && sec.listItems) {
          const isHeadlines = sec.heading?.startsWith('RECENT HEADLINES');

          return (
            <div key={sIdx} className="space-y-2">
              {sec.heading && (
                <div className="text-xs font-bold uppercase tracking-wider text-[#ff9900] border-b border-[#2e2e2e] pb-1">
                  {sec.heading}
                </div>
              )}
              <ul className="space-y-1.5 text-[13px] leading-relaxed">
                {sec.listItems.map((item, lIdx) => {
                  let cleaned = item.startsWith('•') ? item.slice(1).trim() : item;

                  if (isHeadlines) {
                    // format: [YYYY-MM-DD] Publisher: Title
                    const match = cleaned.match(/^(\[\d{4}-\d{2}-\d{2}\]|\[RECENT\])\s*([^:]+):\s*(.*)$/);
                    if (match) {
                      const [, date, publisher, headline] = match;
                      return (
                        <li key={lIdx} className="flex items-baseline gap-2">
                          <span className="text-zinc-400 font-mono text-xs tabular-nums shrink-0">
                            {date}
                          </span>
                          <span className="text-zinc-300 font-semibold shrink-0">
                            {publisher}:
                          </span>
                          <span className="text-zinc-200">{headline}</span>
                        </li>
                      );
                    }
                  }

                  // Executive format: Name — Title
                  const execParts = cleaned.split('—');
                  if (execParts.length === 2) {
                    return (
                      <li key={lIdx} className="flex items-baseline justify-between gap-4 text-xs">
                        <span className="text-zinc-200 font-semibold">{execParts[0].trim()}</span>
                        <span className="text-zinc-400">{execParts[1].trim()}</span>
                      </li>
                    );
                  }

                  return (
                    <li key={lIdx} className="text-zinc-300">
                      {cleaned}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        }

        if (sec.type === 'footer' && sec.rawLines) {
          return (
            <div key={sIdx} className="pt-2 border-t border-[#222] text-xs font-mono text-zinc-400">
              {sec.rawLines.join(' ')}
            </div>
          );
        }

        return (
          <div key={sIdx} className="space-y-1 text-zinc-300 text-[13px]">
            {sec.heading && (
              <div className="text-xs font-bold uppercase tracking-wider text-[#ff9900] border-b border-[#2e2e2e] pb-1">
                {sec.heading}
              </div>
            )}
            {sec.rawLines?.map((rl, rIdx) => (
              <div key={rIdx}>{rl}</div>
            ))}
          </div>
        );
      })}
      {quoteStrip && !renderedQuoteStrip && (
        <div key="quote-strip-fallback">{quoteStrip}</div>
      )}
    </div>
  );
};

/**
 * Render structured ANR (Analyst Consensus) Report
 */
interface StructuredAnrReportProps {
  rawText: string;
  consensusLabel?: string;
  consensusColorClass?: string;
  onSelectTicker?: (ticker: string) => void;
}

export const StructuredAnrReport: React.FC<StructuredAnrReportProps> = ({
  rawText,
  consensusLabel,
  consensusColorClass = 'text-zinc-300',
  onSelectTicker,
}) => {
  if (!rawText.trim()) return null;

  const lines = rawText.split('\n');

  // Extract Rating Breakdown Table
  const { tableRows, remainingLines } = parseAnrTable(lines);

  interface Section {
    type: 'summary' | 'table' | 'drivers' | 'footer' | 'raw';
    heading?: string;
    metrics?: MetricItem[];
    listItems?: string[];
    rawLines?: string[];
  }

  const sections: Section[] = [];
  let currentSection: Section | null = null;

  // Process remaining lines
  for (let i = 0; i < remainingLines.length; i++) {
    const line = remainingLines[i];
    const trimmed = line.trim();

    if (isDividerLine(line)) {
      continue;
    }

    if (!trimmed) {
      continue;
    }

    if (isSectionHeading(line)) {
      if (currentSection) {
        sections.push(currentSection);
      }
      if (trimmed.startsWith('RATING BREAKDOWN')) {
        currentSection = { type: 'table', heading: trimmed };
      } else if (trimmed === 'KEY FUNDAMENTAL DRIVERS') {
        currentSection = { type: 'drivers', heading: trimmed, listItems: [] };
      } else {
        currentSection = { type: 'raw', heading: trimmed, rawLines: [] };
      }
      continue;
    }

    if (trimmed.startsWith('SOURCE:')) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = { type: 'footer', rawLines: [trimmed] };
      continue;
    }

    // Top summary section (RECOMMENDATION, CURRENT PRICE, TARGET MEAN, TARGET RANGE)
    if (
      !currentSection &&
      (trimmed.startsWith('RECOMMENDATION') ||
        trimmed.startsWith('CURRENT PRICE') ||
        trimmed.startsWith('TARGET MEAN') ||
        trimmed.startsWith('TARGET RANGE'))
    ) {
      if (!currentSection || (currentSection as Section).type !== 'summary') {
        currentSection = { type: 'summary', metrics: [] };
      }
      const items = parseMetricPair(line);
      currentSection.metrics!.push(...items);
      continue;
    }

    if (currentSection) {
      if (currentSection.type === 'drivers') {
        currentSection.listItems!.push(trimmed);
      } else if (currentSection.type === 'footer') {
        currentSection.rawLines!.push(trimmed);
      } else {
        if (!currentSection.rawLines) currentSection.rawLines = [];
        currentSection.rawLines.push(trimmed);
      }
    } else {
      sections.push({ type: 'raw', rawLines: [trimmed] });
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return (
    <div className="font-sans space-y-4 text-zinc-300">
      {sections.map((sec, sIdx) => {
        if (sec.type === 'summary' && sec.metrics) {
          return (
            <div
              key={sIdx}
              className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded bg-zinc-900/30 border border-[#222]"
            >
              {sec.metrics.map((m, mIdx) => {
                const isRec = m.label.toUpperCase() === 'RECOMMENDATION';
                return (
                  <div key={mIdx} className="flex items-baseline justify-between gap-3 text-xs leading-normal">
                    <span className="text-zinc-400 font-medium uppercase tracking-wider shrink-0">
                      {m.label}
                    </span>
                    {isRec && consensusLabel ? (
                      <span className={`font-bold font-mono uppercase tracking-wider text-sm ${consensusColorClass}`}>
                        {consensusLabel}
                      </span>
                    ) : (
                      <span className="text-zinc-100 font-semibold tabular-nums font-mono text-right truncate">
                        {m.value}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        }

        if (sec.type === 'table') {
          return (
            <div key={sIdx} className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-[#ff9900] border-b border-[#2e2e2e] pb-1">
                {sec.heading || 'RATING BREAKDOWN (BY PERIOD)'}
              </div>
              {tableRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#333] text-zinc-400 font-semibold uppercase">
                        <th className="py-2 pr-3">PERIOD</th>
                        <th className="py-2 px-3 text-right">STRONG BUY</th>
                        <th className="py-2 px-3 text-right">BUY</th>
                        <th className="py-2 px-3 text-right">HOLD</th>
                        <th className="py-2 px-3 text-right">SELL</th>
                        <th className="py-2 pl-3 text-right">STRONG SELL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#222]">
                      {tableRows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-zinc-900/40">
                          <td className="py-2 pr-3 font-mono font-medium text-zinc-200">
                            {row.period}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-mono text-[#00ff00]">
                            {row.strongBuy}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-mono text-[#00ff00]">
                            {row.buy}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-mono text-[#ff9900]">
                            {row.hold}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-mono text-[#ff4444]">
                            {row.sell}
                          </td>
                          <td className="py-2 pl-3 text-right tabular-nums font-mono text-[#ff4444]">
                            {row.strongSell}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-zinc-400 text-xs italic">No breakdown trend data available.</div>
              )}
            </div>
          );
        }

        if (sec.type === 'drivers' && sec.listItems) {
          return (
            <div key={sIdx} className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-[#ff9900] border-b border-[#2e2e2e] pb-1">
                {sec.heading}
              </div>
              <ul className="space-y-1.5 text-[13px] leading-relaxed">
                {sec.listItems.map((item, lIdx) => {
                  let cleaned = item.startsWith('•') ? item.slice(1).trim() : item;
                  const colonIdx = cleaned.indexOf(':');
                  if (colonIdx !== -1) {
                    const label = cleaned.slice(0, colonIdx).trim();
                    const val = cleaned.slice(colonIdx + 1).trim();
                    return (
                      <li key={lIdx} className="flex items-baseline justify-between gap-4 text-xs">
                        <span className="text-zinc-400 font-medium">{label}</span>
                        <span className="text-zinc-100 font-semibold tabular-nums font-mono text-right">
                          {val}
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={lIdx} className="text-zinc-300">
                      {cleaned}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        }

        if (sec.type === 'footer' && sec.rawLines) {
          return (
            <div key={sIdx} className="pt-2 border-t border-[#222] text-xs font-mono text-zinc-400">
              {sec.rawLines.join(' ')}
            </div>
          );
        }

        return (
          <div key={sIdx} className="space-y-1 text-zinc-300 text-[13px]">
            {sec.heading && (
              <div className="text-xs font-bold uppercase tracking-wider text-[#ff9900] border-b border-[#2e2e2e] pb-1">
                {sec.heading}
              </div>
            )}
            {sec.rawLines?.map((rl, rIdx) => (
              <div key={rIdx}>{rl}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

import React from 'react';
import { NewsItem } from '../types';
import NewsPaywallBadge from './NewsPaywallBadge';
import { formatNewsSourceLabel, isNewsItemPaywalled } from '../utils/newsPaywall';

export function formatDisplayTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return '';
      }
    });
}

export function cleanHeadline(title: string, source?: string): string {
  if (!title) return '';
  const decoded = decodeHtmlEntities(title).trim();
  // Strip trailing source only when separated by whitespace on both sides (" - ", " – ", " — ", " | ")
  // AND the trailing segment is at the end of the title.
  // When source is provided, strip only if trailing segment matches source (or vice-versa).
  const match = decoded.match(/^(.*?)\s+[-–—|]\s+([^-–—|]+)$/);
  if (match) {
    const trailingSource = match[2].trim();
    if (!source) {
      return match[1].trim();
    }
    const cleanSource = source.replace(/\s*Business\b/gi, '').trim().toLowerCase();
    const sourceTokens = cleanSource.split(/[^a-z0-9]+/).filter(Boolean);
    const trailingLower = trailingSource.toLowerCase();

    const matchesSource =
      trailingLower.includes(cleanSource) ||
      cleanSource.includes(trailingLower) ||
      (sourceTokens.length > 0 && sourceTokens.some((tok) => tok.length >= 3 && trailingLower.includes(tok)));

    if (matchesSource) {
      return match[1].trim();
    }
  }
  return decoded;
}

export const cleanTitle = cleanHeadline;

export function cleanSummary(rawSummary?: string, headline?: string): string {
  if (!rawSummary || typeof rawSummary !== 'string') return '';
  // 1. Strip HTML tags
  let cleaned = rawSummary.replace(/<[^>]*>/g, ' ');
  // 2. Decode common HTML entities
  cleaned = decodeHtmlEntities(cleaned);
  // 3. Normalize whitespace and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  // 4. Do not display if it merely repeats the headline
  if (headline) {
    const normSummary = cleaned.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const normHeadline = headline.toLowerCase().replace(/[^\w\s]/g, '').trim();
    if (normSummary === normHeadline || (normHeadline.length > 15 && normSummary.startsWith(normHeadline))) {
      return '';
    }
  }

  return cleaned;
}

export interface NewsCardProps {
  item: NewsItem;
  showTickers?: boolean;
  relatedTickers?: string[];
  onSelectTicker?: (ticker: string) => void;
  className?: string;
}

export const NewsCard: React.FC<NewsCardProps> = ({
  item,
  showTickers = true,
  relatedTickers = [],
  onSelectTicker,
  className = '',
}) => {
  const displayTime = formatDisplayTime(item.publishedAt || item.time);
  const cleanedTitle = cleanHeadline(item.title, item.source);
  const sourceLabel = formatNewsSourceLabel(item.source);
  const paywalled = isNewsItemPaywalled(item);
  const cleanedItemSummary = cleanSummary(item.content, cleanedTitle);

  const shouldRenderFooter = showTickers && relatedTickers.length > 0;

  return (
    <div
      className={`bg-black border border-[#151515] hover:border-[#333] p-4 rounded transition-all flex flex-col justify-between font-mono ${className}`.trim()}
    >
      <div>
        {/* Linked headline, source attribution, and paywall indicator on first line, timestamp on second line */}
        <div className="mb-2 leading-snug break-words">
          <a
            href={item.url || 'https://www.reuters.com'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white hover:text-[#00ff00] text-sm md:text-base font-bold leading-snug hover:underline break-words"
          >
            {cleanedTitle}
          </a>
          {sourceLabel && (
            <>
              {' '}
              <span className="text-xs text-[#ff9900] font-extrabold uppercase ml-1.5 select-none">—{' '}</span>
              <a
                href={item.url || 'https://www.reuters.com'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#ff9900] font-extrabold uppercase hover:text-[#00ff00] hover:underline select-none"
              >
                [{sourceLabel}]
              </a>
            </>
          )}
          {paywalled && (
            <>
              {' '}
              <NewsPaywallBadge className="ml-1" />
            </>
          )}
          {displayTime && (
            <div className="text-xs text-zinc-300 font-mono mt-1">
              {displayTime}
            </div>
          )}
        </div>
        {cleanedItemSummary && (
          <p
            className={`text-xs md:text-sm text-zinc-300 font-normal font-sans line-clamp-3 ${
              shouldRenderFooter ? 'mb-3' : ''
            }`.trim()}
          >
            {cleanedItemSummary}
          </p>
        )}
      </div>

      {shouldRenderFooter && (
        <div className="space-y-1.5 mt-2 pt-2 border-t border-[#151515] text-xs">
          {/* Related Tickers row */}
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-300">
            {relatedTickers.map((t, tIdx) => (
              <React.Fragment key={t}>
                {tIdx > 0 && <span className="text-zinc-300">, </span>}
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onSelectTicker) {
                      onSelectTicker(t);
                    }
                  }}
                  className="text-[#3498db] hover:text-[#00ff00] hover:underline cursor-pointer font-bold"
                >
                  {t}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NewsCard;

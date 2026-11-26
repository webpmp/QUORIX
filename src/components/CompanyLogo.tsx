import React, { useState, useEffect } from 'react';

export type LogoTier = 'parqet' | 'fmp' | 'monogram';

export interface CompanyLogoProps {
  symbol: string;
  size?: number; // size in px, defaults to 48
  className?: string;
}

/**
 * Known non-corporate instruments in Quorix (indices, commodities, treasury yields, crypto, currencies).
 * These assets do not represent corporations and should not render corporate logos or monograms.
 */
export const NON_EQUITY_SYMBOLS = new Set([
  'SPX',
  'DJI',
  'IXIC',
  'VIX',
  'RUT',
  'GC',
  'CL',
  'BZ',
  'TNX',
  'BTC',
  'ETH',
  'SOL',
  'DXY',
]);

/**
 * Checks whether a symbol represents a corporate equity or ETF eligible for logo display.
 * Rejects index/future/forex/crypto symbols, symbols starting with '^' or ending with '=F',
 * or currency pairs containing '/'.
 */
export function isCompanyEquitySymbol(raw: string): boolean {
  if (!raw) return false;
  const sym = raw.trim().toUpperCase();
  if (!sym) return false;
  if (NON_EQUITY_SYMBOLS.has(sym)) return false;
  if (sym.startsWith('^') || sym.endsWith('=F') || sym.includes('/')) return false;
  return true;
}

/**
 * Splits the title line (e.g. "APPLE INC. (AAPL)") from pre-formatted report text (DES, ANR),
 * allowing a CompanyLogo to sit in a dedicated header row directly above the divider and body.
 * If text doesn't contain a newline, or has no content, returns null title and the original text.
 */
export function splitReportTitleAndBody(rawReport: string): {
  title: string | null;
  body: string;
} {
  if (!rawReport || typeof rawReport !== 'string') {
    return { title: null, body: rawReport || '' };
  }
  const newlineIdx = rawReport.indexOf('\n');
  if (newlineIdx === -1) {
    return { title: null, body: rawReport };
  }
  const firstLine = rawReport.slice(0, newlineIdx).trim();
  // Expect first line to be non-empty and not just a divider
  if (!firstLine || firstLine.startsWith('=')) {
    return { title: null, body: rawReport };
  }
  // The rest of the report starting from after the first newline (e.g. "======")
  const restOfReport = rawReport.slice(newlineIdx + 1);
  return {
    title: firstLine,
    body: restOfReport,
  };
}

/**
 * Module-scoped status cache tracking the working/failed tier for a given ticker.
 * If a ticker failed 'parqet', it goes directly to 'fmp'; if both failed, directly to 'monogram'.
 */
export const logoStatusCache = new Map<string, LogoTier>();

/**
 * Normalizes ticker symbols for logo CDN endpoints.
 * E.g., 'brk.b' -> 'BRK-B', 'bf.b' -> 'BF-B'
 */
export function normalizeLogoSymbol(raw: string): string {
  if (!raw) return '';
  return raw.trim().toUpperCase().replace(/\./g, '-');
}

/**
 * Returns the CDN URL for a given tier and normalized symbol.
 */
export function getLogoUrl(normalizedSymbol: string, tier: 'parqet' | 'fmp'): string {
  if (tier === 'parqet') {
    return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(normalizedSymbol)}`;
  }
  return `https://images.financialmodelingprep.com/symbol/${encodeURIComponent(normalizedSymbol)}.png`;
}

/**
 * Clear the status cache (useful for tests).
 */
export function clearLogoStatusCache(): void {
  logoStatusCache.clear();
}

export const CompanyLogo: React.FC<CompanyLogoProps> = ({
  symbol,
  size = 48,
  className = '',
}) => {
  const normalizedSymbol = normalizeLogoSymbol(symbol);

  // If there's no symbol, render nothing
  if (!normalizedSymbol) {
    return null;
  }

  // Determine starting tier from module-scoped cache (default to 'parqet')
  const initialTier: LogoTier = logoStatusCache.get(normalizedSymbol) || 'parqet';
  const [tier, setTier] = useState<LogoTier>(initialTier);

  // Reset tier when symbol changes
  useEffect(() => {
    const cached = logoStatusCache.get(normalizedSymbol) || 'parqet';
    setTier(cached);
  }, [normalizedSymbol]);

  const handleImageError = () => {
    if (tier === 'parqet') {
      logoStatusCache.set(normalizedSymbol, 'fmp');
      setTier('fmp');
    } else if (tier === 'fmp') {
      logoStatusCache.set(normalizedSymbol, 'monogram');
      setTier('monogram');
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    // If the image loaded as an empty/transparent 0x0 or 1x1 placeholder, treat as failure
    if (img.naturalWidth <= 1 || img.naturalHeight <= 1) {
      handleImageError();
    }
  };

  // Base dimensions and styling
  const containerStyle: React.CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    minWidth: `${size}px`,
    minHeight: `${size}px`,
  };

  if (tier === 'monogram') {
    const initials = normalizedSymbol.replace(/[^A-Z0-9]/g, '').slice(0, 2);
    // Font size strictly proportional: about 35–40% of size (e.g. 18px at 48px, 12px at 32px)
    const fontSize = Math.max(9, Math.round(size * 0.38));

    return (
      <span
        data-testid="company-logo-monogram"
        aria-hidden="true"
        style={{ ...containerStyle, fontSize: `${fontSize}px` }}
        className={`inline-flex items-center justify-center font-mono font-bold rounded-xs bg-[#141414] border border-[#2a2a2a] text-[#ff9900] select-none shrink-0 ${className}`}
      >
        {initials}
      </span>
    );
  }

  const currentUrl = getLogoUrl(normalizedSymbol, tier);

  return (
    <div
      data-testid={`company-logo-container-${tier}`}
      style={containerStyle}
      className={`inline-flex items-center justify-center bg-zinc-800/80 border border-[#2a2a2a] rounded-xs p-[1px] shrink-0 overflow-hidden ${className}`}
    >
      <img
        key={`${normalizedSymbol}-${tier}`}
        src={currentUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="w-full h-full object-contain block"
        onLoad={handleImageLoad}
        onError={handleImageError}
      />
    </div>
  );
};

export default CompanyLogo;

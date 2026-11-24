import React, { useEffect, useState } from 'react';
import { RefreshCw, ExternalLink, AlertCircle, Info } from 'lucide-react';
import { NewsItem } from '../types';
import NewsPaywallBadge from './NewsPaywallBadge';
import {
  formatTickerTimestamp,
  isNewsItemPaywalled,
  normalizeClientNewsUrl,
  subscribePaywallUpdates,
  syncNewsPaywallStatuses,
} from '../utils/newsPaywall';
import {
  FADE_IN_ITEM_DURATION_MS,
  FADE_OUT_ITEM_DURATION_MS,
  computeLeftToRightStaggerPlan,
  computeTickerFeedSignature,
  decideIncomingFeedTransition,
  type ConfiguredNewsSources,
  type NewsTickerSourceId,
  type NewsTickerTransitionPhase,
  type TickerFeedSnapshot,
  type ViewportHorizontalBounds,
  type VisibleItemRect,
} from '../utils/newsTickerTransition';

interface NewsTickerResponse {
  success: boolean;
  sources: string[];
  configuredSources?: ConfiguredNewsSources;
  activeSource?: NewsTickerSourceId;
  isSimulated: boolean;
  data: NewsItem[];
  error?: string;
}

type TickerCssVars = React.CSSProperties & {
  '--marquee-duration'?: string;
  '--marquee-min-width'?: string;
  '--ticker-fade-delay'?: string;
};

const ROTATION_INTERVAL_MS = 10 * 60 * 1000;
const TICKER_SPEED_PX_PER_SEC = 55;

const NEWS_TICKER_STYLES = `
  @keyframes marquee-scroll {
    0% {
      transform: translate3d(0%, 0, 0);
    }
    100% {
      transform: translate3d(-50%, 0, 0);
    }
  }
  .animate-marquee-continuous {
    display: flex;
    width: max-content;
    will-change: transform;
    animation: marquee-scroll var(--marquee-duration, 150s) linear infinite;
  }
  .marquee-sequence {
    min-width: var(--marquee-min-width, 100%);
  }
  .animate-marquee-continuous:hover,
  .animate-marquee-paused {
    animation-play-state: paused;
  }
  .ticker-headline-item {
    will-change: opacity;
  }
  .ticker-headline-steady {
    opacity: 1;
    transition: background-color 150ms ease, border-color 150ms ease;
  }
  .ticker-headline-exiting {
    opacity: 0;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      opacity ${FADE_OUT_ITEM_DURATION_MS}ms ease-out var(--ticker-fade-delay, 0ms);
  }
  .ticker-headline-entering {
    opacity: 0;
    transition: none;
  }
  .ticker-headline-revealing {
    opacity: 1;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      opacity ${FADE_IN_ITEM_DURATION_MS}ms ease-out var(--ticker-fade-delay, 0ms);
  }
`;

function getCurrentRotationSlot(): number {
  return Math.floor(Date.now() / ROTATION_INTERVAL_MS);
}

function normalizeTickerUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const keptParams = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.startsWith('utm_') ||
        lowerKey === 'fbclid' ||
        lowerKey === 'gclid' ||
        lowerKey === 'ref' ||
        lowerKey === 'src' ||
        lowerKey === 'ocid'
      ) {
        return;
      }
      keptParams.append(key, value);
    });
    const query = keptParams.toString();
    return `${host}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

function normalizeTickerTitle(rawTitle?: string): string {
  if (!rawTitle) return '';
  return rawTitle
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deduplicateTickerNews(items: NewsItem[]): NewsItem[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const unique: NewsItem[] = [];

  for (const item of items) {
    const normTitle = normalizeTickerTitle(item?.title);
    if (!normTitle) continue;
    const normUrl = normalizeClientNewsUrl(item?.url) || normalizeTickerUrl(item?.url);
    if (normUrl && seenUrls.has(normUrl)) continue;
    if (seenTitles.has(normTitle)) continue;

    if (normUrl) seenUrls.add(normUrl);
    seenTitles.add(normTitle);
    unique.push(item);
  }

  return unique;
}

export default function NewsTicker() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [configuredSources, setConfiguredSources] = useState<ConfiguredNewsSources>({
    nyt: false,
    news: false,
    newsdata: false,
  });
  const [activeSource, setActiveSource] = useState<NewsTickerSourceId>(null);
  const [isSimulated, setIsSimulated] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [viewportWidth, setViewportWidth] = useState<number>(0);
  const [marqueeDurationSec, setMarqueeDurationSec] = useState<number>(150);
  const [feedVersion, setFeedVersion] = useState<number>(0);
  const [paywallSyncVersion, setPaywallSyncVersion] = useState<number>(0);
  const [transitionPhase, setTransitionPhase] = useState<NewsTickerTransitionPhase>('scrolling');
  const [staggerDelays, setStaggerDelays] = useState<Record<string, number>>({});

  const lastSlotRef = React.useRef<number>(getCurrentRotationSlot());
  const displayedSigRef = React.useRef<string>('');
  const newsCountRef = React.useRef<number>(0);
  const pendingFeedRef = React.useRef<TickerFeedSnapshot | null>(null);
  const phaseRef = React.useRef<NewsTickerTransitionPhase>('scrolling');
  const phaseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const raf1Ref = React.useRef<number | null>(null);
  const raf2Ref = React.useRef<number | null>(null);
  const retryTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchRequestIdRef = React.useRef<number>(0);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const isMountedRef = React.useRef<boolean>(true);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const firstSequenceRef = React.useRef<HTMLDivElement | null>(null);

  const formatSourceLabel = (source: string) => {
    const cleaned = source.replace(' Business', '').trim().toUpperCase();
    return cleaned === 'NEW YORK TIMES' ? 'NYT' : cleaned;
  };

  const clearTransitionScheduling = React.useCallback(() => {
    if (phaseTimerRef.current) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    if (typeof cancelAnimationFrame !== 'undefined') {
      if (raf1Ref.current !== null) {
        cancelAnimationFrame(raf1Ref.current);
        raf1Ref.current = null;
      }
      if (raf2Ref.current !== null) {
        cancelAnimationFrame(raf2Ref.current);
        raf2Ref.current = null;
      }
    }
  }, []);

  const setPhaseSync = React.useCallback((next: NewsTickerTransitionPhase) => {
    phaseRef.current = next;
    setTransitionPhase(next);
  }, []);

  const measureRenderedItems = React.useCallback((): {
    itemRects: VisibleItemRect[];
    viewportBounds: ViewportHorizontalBounds | null;
  } => {
    const vpEl = viewportRef.current;
    if (!vpEl) {
      return { itemRects: [], viewportBounds: null };
    }
    const vpRect = vpEl.getBoundingClientRect();
    const viewportBounds: ViewportHorizontalBounds = {
      left: vpRect.left,
      right: vpRect.right,
      width: vpRect.width,
    };
    const nodes = vpEl.querySelectorAll<HTMLElement>('[data-ticker-item-key]');
    const itemRects: VisibleItemRect[] = [];
    nodes.forEach((node) => {
      const key = node.dataset.tickerItemKey;
      if (!key) return;
      const rect = node.getBoundingClientRect();
      itemRects.push({
        key,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      });
    });
    return { itemRects, viewportBounds };
  }, []);

  const commitFeedSnapshot = React.useCallback(
    (snapshot: TickerFeedSnapshot) => {
      if (!isMountedRef.current) return;
      clearTransitionScheduling();
      displayedSigRef.current = snapshot.signature;
      newsCountRef.current = snapshot.news.length;
      setNews(snapshot.news);
      setActiveSource(snapshot.activeSource);
      setConfiguredSources(snapshot.configuredSources);
      setIsSimulated(snapshot.isSimulated);
      setStaggerDelays({});
      setFeedVersion((v) => v + 1);
      setPhaseSync(snapshot.news.length > 0 ? 'fading-in' : 'scrolling');
    },
    [clearTransitionScheduling, setPhaseSync]
  );

  const startFadeOutToPending = React.useCallback(() => {
    clearTransitionScheduling();
    const { itemRects, viewportBounds } = measureRenderedItems();
    const plan = computeLeftToRightStaggerPlan(
      itemRects,
      viewportBounds,
      'out',
      newsCountRef.current
    );

    setStaggerDelays(plan.delaysByKey);
    setPhaseSync('fading-out');

    phaseTimerRef.current = setTimeout(() => {
      phaseTimerRef.current = null;
      if (!isMountedRef.current) return;
      const next = pendingFeedRef.current;
      pendingFeedRef.current = null;
      if (next) {
        commitFeedSnapshot(next);
      } else {
        setStaggerDelays({});
        setPhaseSync('scrolling');
      }
    }, plan.totalDurationMs);
  }, [clearTransitionScheduling, commitFeedSnapshot, measureRenderedItems, setPhaseSync]);

  const scheduleIncomingFeed = React.useCallback(
    (incoming: TickerFeedSnapshot) => {
      const action = decideIncomingFeedTransition({
        phase: phaseRef.current,
        hasDisplayedHeadlines: newsCountRef.current > 0,
        displayedSignature: displayedSigRef.current,
        pendingSignature: pendingFeedRef.current?.signature ?? null,
        incomingSignature: incoming.signature,
      });

      if (action === 'noop') {
        // Keep source metadata in sync without disturbing the active crawl
        setConfiguredSources(incoming.configuredSources);
        setIsSimulated(incoming.isSimulated);
        return;
      }

      if (action === 'enter-immediately') {
        pendingFeedRef.current = null;
        commitFeedSnapshot(incoming);
        return;
      }

      if (action === 'replace-pending') {
        // A fade-out is already underway; swap in the latest payload for Phase B without restarting Phase A
        pendingFeedRef.current = incoming;
        return;
      }

      // 'start-fade-out' or 'interrupt-to-fade-out'
      pendingFeedRef.current = incoming;
      startFadeOutToPending();
    },
    [commitFeedSnapshot, startFadeOutToPending]
  );

  // Phase C: once newly swapped headlines mount at opacity 0 ('fading-in'),
  // wait one paint frame so the initial hidden state commits, then sweep them in left-to-right
  // and resume normal scrolling when the reveal completes.
  useEffect(() => {
    if (transitionPhase !== 'fading-in') return;
    if (news.length === 0) {
      setStaggerDelays({});
      setPhaseSync('scrolling');
      return;
    }

    const beginReveal = () => {
      if (!isMountedRef.current || phaseRef.current !== 'fading-in') return;
      const { itemRects, viewportBounds } = measureRenderedItems();
      const plan = computeLeftToRightStaggerPlan(
        itemRects,
        viewportBounds,
        'in',
        news.length
      );
      setStaggerDelays(plan.delaysByKey);
      setPhaseSync('revealing');

      phaseTimerRef.current = setTimeout(() => {
        phaseTimerRef.current = null;
        if (!isMountedRef.current || phaseRef.current !== 'revealing') return;
        setStaggerDelays({});
        setPhaseSync('scrolling');
      }, plan.totalDurationMs);
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      raf1Ref.current = requestAnimationFrame(() => {
        raf1Ref.current = null;
        raf2Ref.current = requestAnimationFrame(() => {
          raf2Ref.current = null;
          beginReveal();
        });
      });
    } else {
      beginReveal();
    }

    return () => {
      if (phaseRef.current === 'fading-in') {
        clearTransitionScheduling();
      }
    };
  }, [transitionPhase, feedVersion, news.length, clearTransitionScheduling, measureRenderedItems, setPhaseSync]);

  const fetchNews = React.useCallback(
    async (force = false, slot = getCurrentRotationSlot(), attempt = 0) => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const requestId = ++fetchRequestIdRef.current;

      setLoading(true);
      if (attempt === 0 && newsCountRef.current === 0) {
        setError(null);
      }
      lastSlotRef.current = slot;

      try {
        const params = new URLSearchParams({
          mode: 'rotate',
          slot: String(slot),
        });
        if (force) params.set('force', 'true');
        const response = await fetch(`/api/news/ticker?${params.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!isMountedRef.current || requestId !== fetchRequestIdRef.current) return;

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const rawText = await response.text();
        if (!isMountedRef.current || requestId !== fetchRequestIdRef.current) return;

        const trimmedText = rawText.trimStart();

        if (!response.ok || !contentType.includes('application/json') || trimmedText.startsWith('<')) {
          if (attempt < 2 && isMountedRef.current && requestId === fetchRequestIdRef.current) {
            retryTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current && requestId === fetchRequestIdRef.current) {
                void fetchNews(force, slot, attempt + 1);
              }
            }, 1200 * (attempt + 1));
            return;
          }
          if (newsCountRef.current > 0) {
            return;
          }
          throw new Error(
            !response.ok
              ? `HTTP error! status: ${response.status}`
              : 'News service temporarily unavailable'
          );
        }

        const result: NewsTickerResponse = JSON.parse(rawText);
        if (!isMountedRef.current || requestId !== fetchRequestIdRef.current) return;

        if (result.success && Array.isArray(result.data)) {
          setError(null);
          const uniqueNews = deduplicateTickerNews(result.data);
          syncNewsPaywallStatuses(uniqueNews);

          const nextSource: NewsTickerSourceId = result.activeSource ?? null;
          const nextConfigured: ConfiguredNewsSources = result.configuredSources
            ? result.configuredSources
            : (() => {
                const srcs = result.sources || [];
                return {
                  nyt: srcs.some((s) => s.toUpperCase().includes('NYT')),
                  news: srcs.some((s) => s.toUpperCase().includes('NEWS API')),
                  newsdata: srcs.some((s) => s.toUpperCase().includes('NEWSDATA')),
                };
              })();

          if (uniqueNews.length === 0 && newsCountRef.current > 0) {
            // Preserve existing headlines instead of fading out to a blank ticker on a transient empty refresh
            setConfiguredSources(nextConfigured);
            return;
          }

          const snapshot: TickerFeedSnapshot = {
            news: uniqueNews,
            activeSource: nextSource,
            configuredSources: nextConfigured,
            isSimulated: !!result.isSimulated,
            signature: computeTickerFeedSignature(nextSource, uniqueNews),
          };

          scheduleIncomingFeed(snapshot);
        } else {
          throw new Error(result.error || 'Failed to parse news payload');
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || !isMountedRef.current || requestId !== fetchRequestIdRef.current) {
          return;
        }
        if (newsCountRef.current === 0) {
          console.warn('News headlines fetch notice:', err?.message || err);
          setError(err?.message || 'Connection error');
        }
      } finally {
        if (isMountedRef.current && requestId === fetchRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [scheduleIncomingFeed]
  );

  useEffect(() => {
    isMountedRef.current = true;
    void fetchNews(false, getCurrentRotationSlot());
    // Check every 30s; force-refresh immediately whenever the 10-minute source slot rolls over
    const interval = setInterval(() => {
      const currentSlot = getCurrentRotationSlot();
      const slotChanged = currentSlot !== lastSlotRef.current;
      void fetchNews(slotChanged, currentSlot);
    }, 30000);
    const handleSettingsUpdate = () => {
      void fetchNews(true, getCurrentRotationSlot());
    };
    window.addEventListener('quorix-settings-updated', handleSettingsUpdate);
    const unsubscribePaywall = subscribePaywallUpdates(() => {
      setPaywallSyncVersion((v) => v + 1);
    });
    return () => {
      isMountedRef.current = false;
      clearTransitionScheduling();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      clearInterval(interval);
      window.removeEventListener('quorix-settings-updated', handleSettingsUpdate);
      unsubscribePaywall();
    };
  }, [fetchNews, clearTransitionScheduling]);

  const updateMarqueeMetrics = React.useCallback(() => {
    const seqEl = firstSequenceRef.current;
    const vpEl = viewportRef.current;
    if (!seqEl || !vpEl || news.length === 0) return;

    const vpWidth = Math.ceil(vpEl.getBoundingClientRect().width);
    if (vpWidth > 0) {
      setViewportWidth((prev) => (Math.abs(prev - vpWidth) > 1 ? vpWidth : prev));
    }

    const seqWidth = Math.max(seqEl.getBoundingClientRect().width, vpWidth);
    if (seqWidth <= 0) return;

    const nextDuration = Math.max(1, Number((seqWidth / TICKER_SPEED_PX_PER_SEC).toFixed(2)));
    setMarqueeDurationSec((prev) => (Math.abs(prev - nextDuration) > 0.05 ? nextDuration : prev));
  }, [news.length]);

  React.useLayoutEffect(() => {
    updateMarqueeMetrics();
  }, [updateMarqueeMetrics, news, feedVersion, paywallSyncVersion]);

  useEffect(() => {
    const seqEl = firstSequenceRef.current;
    const vpEl = viewportRef.current;
    if (!seqEl && !vpEl) return;

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      updateMarqueeMetrics();
    });
    if (seqEl) observer.observe(seqEl);
    if (vpEl) observer.observe(vpEl);
    return () => observer.disconnect();
  }, [updateMarqueeMetrics, feedVersion]);

  const headlinePhaseClass =
    transitionPhase === 'fading-out'
      ? 'ticker-headline-exiting'
      : transitionPhase === 'fading-in'
      ? 'ticker-headline-entering'
      : transitionPhase === 'revealing'
      ? 'ticker-headline-revealing'
      : 'ticker-headline-steady';

  const isCrawlPaused = isPaused || transitionPhase !== 'scrolling';
  const marqueeVars: TickerCssVars = {
    '--marquee-duration': `${marqueeDurationSec}s`,
    '--marquee-min-width': viewportWidth > 0 ? `${viewportWidth}px` : '100%',
  };

  const renderSequenceItems = (seqNum: 1 | 2) =>
    news.map((item, index) => {
      const paywalled = isNewsItemPaywalled(item);
      const tickerTime = formatTickerTimestamp(item.time);
      const itemKey = `${seqNum}-${index}`;
      const delayMs = staggerDelays[itemKey] ?? 0;
      const itemVars: TickerCssVars | undefined =
        transitionPhase === 'fading-out' || transitionPhase === 'revealing'
          ? { '--ticker-fade-delay': `${delayMs}ms` }
          : undefined;

      return (
        <a
          key={`${item.id}-${seqNum}-${index}`}
          data-ticker-item-key={itemKey}
          href={item.url}
          target="_blank"
          referrerPolicy="no-referrer"
          tabIndex={seqNum === 2 ? -1 : undefined}
          style={itemVars}
          className={`ticker-headline-item ${headlinePhaseClass} flex items-center gap-2 hover:bg-zinc-900/60 py-0.5 px-2 rounded border border-transparent hover:border-[#333] group whitespace-nowrap shrink-0`}
          title={item.title}
        >
          <span className="text-zinc-100 group-hover:text-[#00ff00] transition-colors leading-none font-medium max-w-lg truncate">
            {item.title}
          </span>
          <span className="text-xs text-[#3498db] font-bold uppercase shrink-0">
            [{formatSourceLabel(item.source)}]
          </span>
          {paywalled && <NewsPaywallBadge />}
          {tickerTime && (
            <span className="text-xs text-zinc-300 shrink-0 font-mono">
              {tickerTime}
            </span>
          )}
          <ExternalLink
            size={8}
            className="text-zinc-300 group-hover:text-[#00ff00] opacity-0 group-hover:opacity-100 transition-all ml-0.5"
          />
        </a>
      );
    });

  return (
    <div
      data-ticker-phase={transitionPhase}
      className="bg-[#0b0b0b] border-t border-[#333] select-none text-xs font-mono py-1 flex items-center relative z-20 h-9 overflow-hidden w-full"
    >
      {/* Static styles for continuous marquee & staggered headline transitions */}
      <style>{NEWS_TICKER_STYLES}</style>

      {/* Source Badge Prefix */}
      <div className="bg-[#111] border-r border-[#333] px-3 py-1 flex items-center gap-2 text-xs font-extrabold uppercase shrink-0 h-full relative z-30">
        <button
          onClick={() => setIsPaused(!isPaused)}
          className={`text-black font-extrabold px-1.5 py-0.5 rounded-sm transition-all cursor-pointer ${
            isPaused
              ? 'bg-[#e74c3c] hover:bg-[#ff4d4d]'
              : 'bg-[#ffaa00] hover:bg-[#ffbb22]'
          }`}
          title={isPaused ? 'Click to resume scrolling' : 'Click to pause scrolling'}
        >
          NEWS TAPE {isPaused ? '⏸' : ''}
        </button>

        {/* Source connection indicators */}
        <div className="hidden md:flex items-center gap-1 font-normal">
          {[
            { id: 'nyt' as const, label: 'NYT', active: configuredSources.nyt, isApiKeySource: true },
            { id: 'news' as const, label: 'NEWS', active: configuredSources.news, isApiKeySource: true },
            { id: 'newsdata' as const, label: 'NEWSDATA.IO', active: configuredSources.newsdata, isApiKeySource: true },
            { id: 'yahoo' as const, label: 'YF', active: true, isApiKeySource: false },
          ].map((src) => {
            const isCurrentFeed = src.active && activeSource === src.id;
            const tooltipPrefix = src.isApiKeySource ? `${src.label} API key` : 'Yahoo Finance';
            return (
              <span
                key={src.id}
                className={`text-xs px-1 rounded-sm border transition-colors ${
                  !src.active
                    ? 'bg-zinc-900 text-zinc-300 border-zinc-700/80'
                    : isCurrentFeed
                    ? 'bg-[#00ff00]/15 text-[#00ff00] border-[#00ff00] font-bold'
                    : 'bg-[#1a1a1a] text-[#00ff00] border-[#00ff00]/30'
                }`}
                title={
                  !src.active
                    ? `${tooltipPrefix} not configured`
                    : isCurrentFeed
                    ? `${tooltipPrefix} active — currently sourcing ticker (rotates every 10 min)`
                    : `${tooltipPrefix} active (rotates every 10 min)`
                }
              >
                {src.label}
              </span>
            );
          })}
        </div>

        {/* Sync trigger */}
        <button
          type="button"
          onClick={() => {
            void fetchNews(true, getCurrentRotationSlot());
            window.dispatchEvent(new Event('quorix-news-refresh'));
          }}
          disabled={loading}
          className="text-zinc-300 hover:text-[#00ff00] active:text-[#00ff00] disabled:text-zinc-700 transition-colors ml-1 cursor-pointer"
          title="Manual news refresh"
        >
          <RefreshCw size={10} className={`${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Scrolling Content Wrapper */}
      <div ref={viewportRef} className="flex-1 overflow-hidden relative flex items-center h-full">
        {error ? (
          <div className="px-3 text-[#ff4444] text-xs flex items-center gap-1 font-bold">
            <AlertCircle size={11} />
            <span>NEWS WIRE ERROR: {error}. RE-SYNCHRONIZING...</span>
          </div>
        ) : news.length === 0 ? (
          <div className="px-3 text-zinc-300 text-xs flex items-center gap-1.5 font-bold">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            <span>
              {loading
                ? 'CONNECTING LIVE NYT / NEWSAPI / NEWSDATA WIRE...'
                : 'NO LIVE NEWS HEADLINES AVAILABLE — CHECK NEWS API KEYS IN SETT.'}
            </span>
          </div>
        ) : (
          /* Double the items to make the marquee transition infinite and completely seamless */
          <div
            key={feedVersion}
            style={marqueeVars}
            className={`animate-marquee-continuous${isCrawlPaused ? ' animate-marquee-paused' : ''}`}
          >
            {/* First sequence */}
            <div ref={firstSequenceRef} className="marquee-sequence flex items-center gap-12 pr-12">
              {renderSequenceItems(1)}
            </div>

            {/* Identical cloned second sequence for seamless loop */}
            <div className="marquee-sequence flex items-center gap-12 pr-12" aria-hidden="true">
              {renderSequenceItems(2)}
            </div>
          </div>
        )}
      </div>

      {/* Info indicator */}
      <div className="hidden lg:flex items-center gap-1.5 px-3 border-l border-[#333] text-zinc-300 text-xs shrink-0 h-full">
        <Info size={10} className="text-[#3498db]" />
        <span>HOVER TO PAUSE</span>
      </div>
    </div>
  );
}

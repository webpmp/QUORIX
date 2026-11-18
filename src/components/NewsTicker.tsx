import React, { useEffect, useState } from 'react';
import { RefreshCw, ExternalLink, Globe, AlertCircle, Info } from 'lucide-react';
import { NewsItem } from '../types';

interface NewsTickerResponse {
  success: boolean;
  sources: string[];
  configuredSources?: {
    nyt: boolean;
    news: boolean;
    newsdata: boolean;
  };
  activeSource?: 'nyt' | 'news' | 'newsdata' | 'yahoo' | null;
  isSimulated: boolean;
  data: NewsItem[];
  error?: string;
}

const ROTATION_INTERVAL_MS = 10 * 60 * 1000;
const TICKER_SPEED_PX_PER_SEC = 55;

function getCurrentRotationSlot(): number {
  return Math.floor(Date.now() / ROTATION_INTERVAL_MS);
}

export default function NewsTicker() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [configuredSources, setConfiguredSources] = useState<{
    nyt: boolean;
    news: boolean;
    newsdata: boolean;
  }>({ nyt: false, news: false, newsdata: false });
  const [activeSource, setActiveSource] = useState<'nyt' | 'news' | 'newsdata' | 'yahoo' | null>(null);
  const [isSimulated, setIsSimulated] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [repeatCount, setRepeatCount] = useState<number>(1);
  const [marqueeDurationSec, setMarqueeDurationSec] = useState<number>(150);
  const [feedVersion, setFeedVersion] = useState<number>(0);
  const lastSlotRef = React.useRef<number>(getCurrentRotationSlot());
  const lastFeedSigRef = React.useRef<string>('');
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const firstSequenceRef = React.useRef<HTMLDivElement | null>(null);

  const formatSourceLabel = (source: string) => {
    const cleaned = source.replace(' Business', '').trim().toUpperCase();
    return cleaned === 'NEW YORK TIMES' ? 'NYT' : cleaned;
  };

  const fetchNews = async (force = false, slot = getCurrentRotationSlot()) => {
    setLoading(true);
    setError(null);
    lastSlotRef.current = slot;
    try {
      const params = new URLSearchParams({
        mode: 'rotate',
        slot: String(slot),
      });
      if (force) params.set('force', 'true');
      const response = await fetch(`/api/news/ticker?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result: NewsTickerResponse = await response.json();
      if (result.success && Array.isArray(result.data)) {
        const nextSource = result.activeSource ?? null;
        const nextSig = `${nextSource || ''}|${result.data.map((item) => `${item.id}:${item.title}`).join('|')}`;
        if (nextSig !== lastFeedSigRef.current) {
          lastFeedSigRef.current = nextSig;
          setRepeatCount(1);
          setNews(result.data);
          setFeedVersion((v) => v + 1);
        }
        if (result.configuredSources) {
          setConfiguredSources(result.configuredSources);
        } else {
          const srcs = result.sources || [];
          setConfiguredSources({
            nyt: srcs.some((s) => s.toUpperCase().includes('NYT')),
            news: srcs.some((s) => s.toUpperCase().includes('NEWS API')),
            newsdata: srcs.some((s) => s.toUpperCase().includes('NEWSDATA')),
          });
        }
        setActiveSource(nextSource);
        setIsSimulated(!!result.isSimulated);
      } else {
        throw new Error(result.error || 'Failed to parse news payload');
      }
    } catch (err: any) {
      console.error('Failed to load news headlines:', err);
      setError(err.message || 'Connection error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews(false, getCurrentRotationSlot());
    // Check every 30s; force-refresh immediately whenever the 10-minute source slot rolls over
    const interval = setInterval(() => {
      const currentSlot = getCurrentRotationSlot();
      const slotChanged = currentSlot !== lastSlotRef.current;
      fetchNews(slotChanged, currentSlot);
    }, 30000);
    const handleSettingsUpdate = () => {
      fetchNews(true, getCurrentRotationSlot());
    };
    window.addEventListener('quorix-settings-updated', handleSettingsUpdate);
    return () => {
      clearInterval(interval);
      window.removeEventListener('quorix-settings-updated', handleSettingsUpdate);
    };
  }, []);

  const updateMarqueeMetrics = React.useCallback(() => {
    const seqEl = firstSequenceRef.current;
    const vpEl = viewportRef.current;
    if (!seqEl || !vpEl || news.length === 0) return;

    const seqWidth = seqEl.getBoundingClientRect().width;
    const vpWidth = vpEl.getBoundingClientRect().width;
    if (seqWidth <= 0) return;

    if (vpWidth > 0 && seqWidth < vpWidth + 100 && repeatCount < 20) {
      const singlePassWidth = seqWidth / repeatCount;
      if (singlePassWidth > 0) {
        const needed = Math.min(20, Math.max(repeatCount + 1, Math.ceil((vpWidth + 200) / singlePassWidth)));
        if (needed > repeatCount) {
          setRepeatCount(needed);
          return;
        }
      }
    }

    const nextDuration = Math.max(1, Number((seqWidth / TICKER_SPEED_PX_PER_SEC).toFixed(2)));
    setMarqueeDurationSec((prev) => (Math.abs(prev - nextDuration) > 0.05 ? nextDuration : prev));
  }, [news.length, repeatCount]);

  React.useLayoutEffect(() => {
    updateMarqueeMetrics();
  }, [updateMarqueeMetrics, news, feedVersion]);

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

  const repeatedNews = React.useMemo(() => {
    if (repeatCount <= 1 || news.length === 0) return news;
    const expanded: NewsItem[] = [];
    for (let i = 0; i < repeatCount; i++) {
      expanded.push(...news);
    }
    return expanded;
  }, [news, repeatCount]);

  return (
    <div className="bg-[#0b0b0b] border-t border-[#333] select-none text-xs font-mono py-1 flex items-center relative z-20 h-9 overflow-hidden w-full">
      {/* Styles for continuous marquee animation */}
      <style>{`
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
          animation: marquee-scroll ${marqueeDurationSec}s linear infinite;
        }
        .animate-marquee-continuous:hover,
        .animate-marquee-paused {
          animation-play-state: paused;
        }
      `}</style>

      {/* Source Badge Prefix */}
      <div className="bg-[#111] border-r border-[#333] px-3 py-1 flex items-center gap-2 text-[10px] font-extrabold uppercase shrink-0 h-full relative z-30">
        <button
          onClick={() => setIsPaused(!isPaused)}
          className={`text-black font-extrabold px-1.5 py-0.5 rounded-sm transition-all cursor-pointer ${
            isPaused 
              ? 'bg-[#e74c3c] hover:bg-[#ff4d4d]' 
              : 'bg-[#ffaa00] hover:bg-[#ffbb22]'
          }`}
          title={isPaused ? "Click to resume scrolling" : "Click to pause scrolling"}
        >
          NEWS TAPE {isPaused ? "⏸" : ""}
        </button>
        
        {/* Source connection indicators */}
        <div className="hidden md:flex items-center gap-1 font-normal">
          {[
            { id: 'nyt' as const, label: 'NYT', active: configuredSources.nyt },
            { id: 'news' as const, label: 'NEWS', active: configuredSources.news },
            { id: 'newsdata' as const, label: 'NEWSDATA.IO', active: configuredSources.newsdata },
          ].map((src) => {
            const isCurrentFeed = src.active && activeSource === src.id;
            return (
              <span
                key={src.id}
                className={`text-[8px] px-1 rounded-sm border transition-colors ${
                  !src.active
                    ? 'bg-zinc-900 text-zinc-500 border-zinc-700/80'
                    : isCurrentFeed
                    ? 'bg-[#00ff00]/15 text-[#00ff00] border-[#00ff00] font-bold'
                    : 'bg-[#1a1a1a] text-[#00ff00] border-[#00ff00]/30'
                }`}
                title={
                  !src.active
                    ? `${src.label} API key not configured`
                    : isCurrentFeed
                    ? `${src.label} API key active — currently sourcing ticker (rotates every 10 min)`
                    : `${src.label} API key active (rotates every 10 min)`
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
            fetchNews(true, getCurrentRotationSlot());
            window.dispatchEvent(new Event('quorix-news-refresh'));
          }}
          disabled={loading}
          className="text-zinc-500 hover:text-[#00ff00] active:text-[#00ff00] disabled:text-zinc-700 transition-colors ml-1 cursor-pointer"
          title="Manual news refresh"
        >
          <RefreshCw size={10} className={`${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Scrolling Content Wrapper */}
      <div ref={viewportRef} className="flex-1 overflow-hidden relative flex items-center h-full">
        {error ? (
          <div className="px-3 text-[#ff4444] text-[10px] flex items-center gap-1 font-bold">
            <AlertCircle size={11} />
            <span>NEWS WIRE ERROR: {error}. RE-SYNCHRONIZING...</span>
          </div>
        ) : news.length === 0 ? (
          <div className="px-3 text-zinc-500 text-[10px] flex items-center gap-1.5 font-bold">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            <span>{loading ? 'CONNECTING LIVE NYT / NEWSAPI / NEWSDATA WIRE...' : 'NO LIVE NEWS HEADLINES AVAILABLE — CHECK NEWS API KEYS IN SETT.'}</span>
          </div>
        ) : (
          /* Double the items to make the marquee transition infinite and completely seamless */
          <div 
            key={`${activeSource || 'default'}-${feedVersion}`}
            className={`animate-marquee-continuous${isPaused ? ' animate-marquee-paused' : ''}`}
          >
            {/* First sequence */}
            <div ref={firstSequenceRef} className="flex items-center gap-12 pr-12">
              {repeatedNews.map((item, index) => {
                const sentimentColor = 
                  item.sentiment === 'positive' ? 'text-[#00ff00]' : 
                  item.sentiment === 'negative' ? 'text-[#ff4444]' : 'text-zinc-400';
                const sentimentSymbol = 
                  item.sentiment === 'positive' ? '▲' : 
                  item.sentiment === 'negative' ? '▼' : '●';

                return (
                  <a
                    key={`${item.id}-1-${index}`}
                    href={item.url}
                    target="_blank"
                    referrerPolicy="no-referrer"
                    className="flex items-center gap-2 hover:bg-zinc-900/60 py-0.5 px-2 rounded border border-transparent hover:border-[#333] transition-all group whitespace-nowrap shrink-0"
                    title={item.title}
                  >
                    <span className="text-zinc-100 group-hover:text-[#00ff00] transition-colors leading-none font-medium max-w-lg truncate">
                      {item.title}
                    </span>
                    <span className="text-[9px] text-[#3498db] font-bold uppercase shrink-0">
                      [{formatSourceLabel(item.source)}]
                    </span>
                    <span className="text-[9px] text-zinc-500 shrink-0 font-mono">
                      {item.time}
                    </span>
                    <span className={`inline-flex items-center justify-center leading-none self-center text-[10px] font-bold shrink-0 ${sentimentColor}`} title={`Sentiment: ${item.sentiment}`}>
                      {sentimentSymbol}
                    </span>
                    <ExternalLink size={8} className="text-zinc-600 group-hover:text-[#00ff00] opacity-0 group-hover:opacity-100 transition-all ml-0.5" />
                  </a>
                );
              })}
            </div>

            {/* Identical cloned second sequence for seamless loop */}
            <div className="flex items-center gap-12 pr-12">
              {repeatedNews.map((item, index) => {
                const sentimentColor = 
                  item.sentiment === 'positive' ? 'text-[#00ff00]' : 
                  item.sentiment === 'negative' ? 'text-[#ff4444]' : 'text-zinc-400';
                const sentimentSymbol = 
                  item.sentiment === 'positive' ? '▲' : 
                  item.sentiment === 'negative' ? '▼' : '●';

                return (
                  <a
                    key={`${item.id}-2-${index}`}
                    href={item.url}
                    target="_blank"
                    referrerPolicy="no-referrer"
                    className="flex items-center gap-2 hover:bg-zinc-900/60 py-0.5 px-2 rounded border border-transparent hover:border-[#333] transition-all group whitespace-nowrap shrink-0"
                    title={item.title}
                  >
                    <span className="text-zinc-100 group-hover:text-[#00ff00] transition-colors leading-none font-medium max-w-lg truncate">
                      {item.title}
                    </span>
                    <span className="text-[9px] text-[#3498db] font-bold uppercase shrink-0">
                      [{formatSourceLabel(item.source)}]
                    </span>
                    <span className="text-[9px] text-zinc-500 shrink-0 font-mono">
                      {item.time}
                    </span>
                    <span className={`inline-flex items-center justify-center leading-none self-center text-[10px] font-bold shrink-0 ${sentimentColor}`} title={`Sentiment: ${item.sentiment}`}>
                      {sentimentSymbol}
                    </span>
                    <ExternalLink size={8} className="text-zinc-600 group-hover:text-[#00ff00] opacity-0 group-hover:opacity-100 transition-all ml-0.5" />
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Info indicator */}
      <div className="hidden lg:flex items-center gap-1.5 px-3 border-l border-[#333] text-zinc-500 text-[9px] shrink-0 h-full">
        <Info size={10} className="text-[#3498db]" />
        <span>CLICK NEWS TAPE OR HOVER TO PAUSE</span>
      </div>
    </div>
  );
}

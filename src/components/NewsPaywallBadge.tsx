import React from 'react';

interface NewsPaywallBadgeProps {
  className?: string;
}

/**
 * Shared subscription paywall indicator (`[$]`) used consistently across
 * NEWS HUB, GRAPH PRICE, and NEWS TICKER CRAWL.
 * Only render this component when an article has confirmed paywall evidence.
 */
export const NewsPaywallBadge: React.FC<NewsPaywallBadgeProps> = ({ className = '' }) => (
  <span
    className={`inline-block text-xs text-zinc-400 bg-transparent border-0 font-semibold tracking-tight select-none shrink-0 ${className}`.trim()}
    title="Subscription required"
    aria-label="Subscription required"
    data-paywall-indicator="true"
  >
    [$]
  </span>
);

export default NewsPaywallBadge;

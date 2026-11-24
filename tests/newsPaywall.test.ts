import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  analyzeHtmlForPaywall,
  createNewsPaywallService,
  isSafeExternalArticleUrl,
  normalizePaywallUrl,
  type FetchArticleResponse,
} from '../src/server/newsPaywallService';
import {
  clearSharedPaywallStore,
  formatNewsSourceLabel,
  formatTickerTimestamp,
  isNewsItemPaywalled,
  normalizeClientNewsUrl,
  syncNewsPaywallStatuses,
} from '../src/utils/newsPaywall';
import NewsPaywallBadge from '../src/components/NewsPaywallBadge';

const PUBLIC_DNS_LOOKUP = async () => [{ address: '93.184.216.34', family: 4 }];

function makeMockResponse(
  html: string,
  options: { status?: number; contentType?: string; location?: string } = {},
): FetchArticleResponse {
  const status = options.status ?? 200;
  const headerMap = new Map<string, string>();
  if (options.contentType !== undefined) {
    headerMap.set('content-type', options.contentType);
  } else {
    headerMap.set('content-type', 'text/html; charset=utf-8');
  }
  if (options.location) {
    headerMap.set('location', options.location);
  }
  return {
    status,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
    bodyText: async () => html,
    cancelBody: async () => undefined,
  };
}

test('analyzeHtmlForPaywall detects Schema.org JSON-LD isAccessibleForFree: false (top-level, @graph, hasPart)', () => {
  const topLevelHtml = `
    <html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"NewsArticle","headline":"Test","isAccessibleForFree":false}
      </script>
    </head><body></body></html>
  `;
  assert.equal(analyzeHtmlForPaywall(topLevelHtml, 200).status, 'paywalled');

  const graphHtml = `
    <html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"NewsArticle","hasPart":{"@type":"WebPageElement","isAccessibleForFree":"False","cssSelector":".paywall"}}]}
      </script>
    </head><body></body></html>
  `;
  assert.equal(analyzeHtmlForPaywall(graphHtml, 200).status, 'paywalled');

  const freeHtml = `
    <html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"NewsArticle","isAccessibleForFree":true}
      </script>
    </head><body></body></html>
  `;
  assert.equal(analyzeHtmlForPaywall(freeHtml, 200).status, 'free');
});

test('analyzeHtmlForPaywall detects microdata, publisher subscription meta tags, structured state, DOM barriers, and HTTP 402', () => {
  const microdataHtml = `<html><head><meta itemprop="isAccessibleForFree" content="false"></head></html>`;
  assert.equal(analyzeHtmlForPaywall(microdataHtml, 200).status, 'paywalled');

  const lockedMetaHtml = `<html><head><meta property="article:content_tier" content="locked"></head></html>`;
  assert.equal(analyzeHtmlForPaywall(lockedMetaHtml, 200).status, 'paywalled');

  const djMetaHtml = `<html><head><meta name="dj.article.access" content="subscriber"></head></html>`;
  assert.equal(analyzeHtmlForPaywall(djMetaHtml, 200).status, 'paywalled');

  const freeMetaHtml = `<html><head><meta property="article:content_tier" content="free"></head></html>`;
  assert.equal(analyzeHtmlForPaywall(freeMetaHtml, 200).status, 'free');

  // Metered alone is inconclusive (not guaranteed locked)
  const meteredMetaHtml = `<html><head><meta property="article:content_tier" content="metered"></head></html>`;
  assert.equal(analyzeHtmlForPaywall(meteredMetaHtml, 200).status, 'unknown');

  const nextDataHtml = `<html><body><script id="__NEXT_DATA__">{"props":{"pageProps":{"isPaywalled":true}}}</script></body></html>`;
  assert.equal(analyzeHtmlForPaywall(nextDataHtml, 200).status, 'paywalled');

  const domBarrierHtml = `<html><body><div data-paywall="true">Subscribe</div></body></html>`;
  assert.equal(analyzeHtmlForPaywall(domBarrierHtml, 200).status, 'paywalled');

  assert.equal(analyzeHtmlForPaywall('', 402).status, 'paywalled');
});

test('service does not classify articles by publisher domain alone or HTTP 403/429 bot blocks', async () => {
  const service = createNewsPaywallService({
    dnsLookup: PUBLIC_DNS_LOOKUP,
    fetchUrl: async (url) => {
      if (url.includes('free-article')) {
        return makeMockResponse(
          `<html><head><script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":true}</script></head></html>`,
        );
      }
      if (url.includes('bot-blocked')) {
        return makeMockResponse('Access Denied', { status: 403 });
      }
      if (url.includes('rate-limited')) {
        return makeMockResponse('Too Many Requests', { status: 429 });
      }
      return makeMockResponse('<html><body><article>Plain article with no metadata</article></body></html>');
    },
  });

  // Subscription-domain URLs with free or inconclusive responses must NOT be marked paywalled
  const freeWsj = await service.detectPaywall('https://www.wsj.com/articles/free-article-123');
  assert.equal(freeWsj.paywalled, false);
  assert.equal(freeWsj.status, 'free');

  const blockedNyt = await service.detectPaywall('https://www.nytimes.com/2026/05/01/bot-blocked.html');
  assert.equal(blockedNyt.paywalled, false);
  assert.equal(blockedNyt.status, 'unknown');

  const rateLimitedFt = await service.detectPaywall('https://www.ft.com/content/rate-limited');
  assert.equal(rateLimitedFt.paywalled, false);
  assert.equal(rateLimitedFt.status, 'unknown');

  const plainBloomberg = await service.detectPaywall('https://www.bloomberg.com/news/plain-story');
  assert.equal(plainBloomberg.paywalled, false);
  assert.equal(plainBloomberg.status, 'unknown');
});

test('service caches by normalized URL and deduplicates concurrent in-flight requests across views', async () => {
  let fetchCount = 0;
  const service = createNewsPaywallService({
    dnsLookup: PUBLIC_DNS_LOOKUP,
    fetchUrl: async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 20));
      return makeMockResponse(
        `<html><head><meta property="article:content_tier" content="locked"></head></html>`,
      );
    },
  });

  const urlA = 'https://www.example-news.com/markets/fed-decision?utm_source=ticker&ref=home';
  const urlB = 'https://example-news.com/markets/fed-decision/?utm_medium=hub';

  assert.equal(normalizePaywallUrl(urlA), normalizePaywallUrl(urlB));

  // Concurrent requests (e.g. NEWS TICKER + NEWS HUB simultaneously) trigger only one fetch
  const [r1, r2] = await Promise.all([
    service.detectPaywall(urlA),
    service.detectPaywall(urlB),
  ]);
  assert.equal(fetchCount, 1);
  assert.equal(r1.paywalled, true);
  assert.equal(r2.paywalled, true);

  // Subsequent batch enrichment (e.g. GRAPH PRICE) reuses cache without another fetch
  const enriched = await service.enrichNewsItemsWithPaywall([
    { id: '1', title: 'Fed Decision', url: urlB },
  ]);
  assert.equal(fetchCount, 1);
  assert.equal(enriched[0].paywalled, true);
});

test('service handles network errors and non-HTML responses gracefully without throwing', async () => {
  const service = createNewsPaywallService({
    dnsLookup: PUBLIC_DNS_LOOKUP,
    fetchUrl: async (url) => {
      if (url.includes('network-err')) {
        throw new Error('ECONNRESET');
      }
      return makeMockResponse('%PDF-1.7', { contentType: 'application/pdf' });
    },
  });

  const enriched = await service.enrichNewsItemsWithPaywall([
    { id: 'err', title: 'Broken Link', url: 'https://example.com/network-err' },
    { id: 'pdf', title: 'Filing PDF', url: 'https://example.com/report.pdf' },
    { id: 'empty', title: 'No URL' },
  ]);

  assert.deepEqual(
    enriched.map((x) => x.paywalled),
    [false, false, false],
  );
});

test('isSafeExternalArticleUrl blocks private, loopback, link-local, metadata, and non-HTTP URLs', async () => {
  assert.equal(await isSafeExternalArticleUrl('http://localhost:3000/api/news', PUBLIC_DNS_LOOKUP), false);
  assert.equal(await isSafeExternalArticleUrl('http://127.0.0.1/admin', PUBLIC_DNS_LOOKUP), false);
  assert.equal(await isSafeExternalArticleUrl('http://169.254.169.254/latest/meta-data/', PUBLIC_DNS_LOOKUP), false);
  assert.equal(await isSafeExternalArticleUrl('http://10.0.0.5/internal', PUBLIC_DNS_LOOKUP), false);
  assert.equal(await isSafeExternalArticleUrl('http://172.16.0.1/internal', PUBLIC_DNS_LOOKUP), false);
  assert.equal(await isSafeExternalArticleUrl('http://192.168.1.1/router', PUBLIC_DNS_LOOKUP), false);
  assert.equal(await isSafeExternalArticleUrl('http://[::1]/secret', PUBLIC_DNS_LOOKUP), false);
  assert.equal(await isSafeExternalArticleUrl('http://[::ffff:127.0.0.1]/secret', PUBLIC_DNS_LOOKUP), false);
  assert.equal(await isSafeExternalArticleUrl('file:///etc/passwd', PUBLIC_DNS_LOOKUP), false);
  assert.equal(await isSafeExternalArticleUrl('javascript:alert(1)', PUBLIC_DNS_LOOKUP), false);
  assert.equal(await isSafeExternalArticleUrl('https://user:pass@example.com/a', PUBLIC_DNS_LOOKUP), false);

  // DNS resolving to private IP must also be blocked
  const privateDns = async () => [{ address: '127.0.0.1', family: 4 }];
  assert.equal(await isSafeExternalArticleUrl('https://rebind.example.com/article', privateDns), false);

  // Valid public URL passes
  assert.equal(await isSafeExternalArticleUrl('https://www.reuters.com/markets/story', PUBLIC_DNS_LOOKUP), true);
});

test('redirect to private network address is blocked safely', async () => {
  const service = createNewsPaywallService({
    dnsLookup: PUBLIC_DNS_LOOKUP,
    fetchUrl: async (url) => {
      if (url.includes('public.example.com')) {
        return makeMockResponse('', {
          status: 302,
          location: 'http://169.254.169.254/latest/meta-data/',
        });
      }
      throw new Error('Should never fetch redirected private target');
    },
  });

  const result = await service.detectPaywall('https://public.example.com/redirect');
  assert.equal(result.paywalled, false);
  assert.equal(result.signal, 'blocked-url');
});

test('shared client helpers format ticker timestamps without literal UTC, preserve source formatting, and sync paywall status', () => {
  assert.equal(formatTickerTimestamp('10:39 PM UTC'), '10:39 PM');
  assert.equal(formatTickerTimestamp('08:05 AM utc'), '08:05 AM');
  assert.equal(formatTickerTimestamp('2:15 PM'), '2:15 PM');
  assert.equal(formatTickerTimestamp(''), '');

  assert.equal(formatNewsSourceLabel('New York Times Business'), 'NEW YORK TIMES');
  assert.equal(formatNewsSourceLabel('Reuters'), 'REUTERS');

  clearSharedPaywallStore();
  const baseUrl = 'https://www.ft.com/content/abc123';
  const trackedUrl = 'https://ft.com/content/abc123?utm_source=ticker';
  assert.equal(normalizeClientNewsUrl(baseUrl), normalizeClientNewsUrl(trackedUrl));

  // Initially unmarked
  assert.equal(isNewsItemPaywalled({ url: baseUrl, paywalled: false }), false);

  // Another view receives confirmed paywalled=true -> shared client store updates already-loaded articles
  syncNewsPaywallStatuses([{ url: trackedUrl, paywalled: true }]);
  assert.equal(isNewsItemPaywalled({ url: baseUrl, paywalled: false }), true);
  assert.equal(isNewsItemPaywalled({ url: 'https://example.com/free', paywalled: false }), false);
  clearSharedPaywallStore();
});

test('NewsPaywallBadge renders [$] with subscription tooltip and no FREE/UNKNOWN text', () => {
  const markup = renderToStaticMarkup(React.createElement(NewsPaywallBadge));
  assert.ok(markup.includes('[$]'));
  assert.ok(markup.includes('title="Subscription required"'));
  assert.ok(!markup.includes('FREE'));
  assert.ok(!markup.includes('UNKNOWN'));
});

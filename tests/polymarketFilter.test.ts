import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLatestRequestGuard,
  filterPolymarketEventsByTicker,
  getTickerCompanyProfile,
  isMultiCompanyPolymarketEvent,
  resolveTickerFromQuery,
  type PolymarketEventLike,
} from '../src/utils/polymarketFilter';
import { createPolymarketTickerResolver } from '../src/server/polymarketTickerResolver';

/**
 * Representative real-world Polymarket Gamma API events captured from live feeds,
 * including single-company strike events, tagged product release events,
 * multi-company leaderboard/race events, false-positive substring traps, and
 * non-company Google Search pop-culture trivia.
 */
const REALISTIC_POLYMARKET_EVENTS: PolymarketEventLike[] = [
  {
    id: 'evt-meta-hit',
    title: 'What will Meta Platforms, Inc. (META) hit in November 2026?',
    slug: 'what-price-will-meta-hit-in-november-2026',
    volume: 420_000,
    tags: [{ slug: 'finance' }, { slug: 'hit-price' }],
    markets: [
      {
        id: 'm-meta-780',
        question: 'Will Meta Platforms, Inc. (META) hit (HIGH) $780 in November?',
        groupItemTitle: '↑ $780',
      },
      {
        id: 'm-meta-740',
        question: 'Will Meta Platforms, Inc. (META) hit (HIGH) $740 in November?',
        groupItemTitle: '↑ $740',
      },
    ],
  },
  {
    id: 'evt-meta-muse',
    title: 'Muse Charm released by...?',
    slug: 'muse-charm-released-by',
    volume: 85_000,
    tags: [{ slug: 'ai' }, { slug: 'meta' }, { slug: 'tech' }],
    markets: [
      {
        id: 'm-muse-dec15',
        question: 'Muse Charm released by December 15?',
        groupItemTitle: 'December 15',
      },
      {
        id: 'm-muse-dec31',
        question: 'Muse Charm released by December 31?',
        groupItemTitle: 'December 31',
      },
    ],
  },
  {
    id: 'evt-best-ai-2026',
    title: 'Which company has best AI model end of 2026?',
    slug: 'which-company-has-best-ai-model-end-of-2026',
    volume: 9_500_000,
    tags: [{ slug: 'tech' }, { slug: 'ai' }, { slug: 'openai' }, { slug: 'anthropic' }],
    markets: [
      {
        id: 'm-ai-google',
        question: 'Will Google have the best AI model at the end of December 2026?',
        groupItemTitle: 'Google',
      },
      {
        id: 'm-ai-anthropic',
        question: 'Will Anthropic have the best AI model at the end of December 2026?',
        groupItemTitle: 'Anthropic',
      },
      {
        id: 'm-ai-deepseek',
        question: 'Will DeepSeek have the best AI model at the end of December 2026?',
        groupItemTitle: 'DeepSeek',
      },
      {
        id: 'm-ai-zai',
        question: 'Will Z.ai have the best AI model at the end of December 2026?',
        groupItemTitle: 'Z.ai',
      },
      {
        id: 'm-ai-alibaba',
        question: 'Will Alibaba have the best AI model at the end of December 2026?',
        groupItemTitle: 'Alibaba',
      },
      {
        id: 'm-ai-meta',
        question: 'Will Meta have the best AI model at the end of December 2026?',
        groupItemTitle: 'Meta',
      },
    ],
  },
  {
    id: 'evt-largest-company-nov',
    title: 'Largest Company end of November 2026?',
    slug: 'largest-company-end-of-november-2026',
    volume: 6_200_000,
    tags: [{ slug: 'tech' }, { slug: 'finance' }, { slug: 'big-tech' }],
    markets: [
      {
        id: 'm-largest-nvda',
        question: 'Will NVIDIA be the largest company in the world by market cap on November 30, 2026?',
        groupItemTitle: 'NVIDIA',
      },
      {
        id: 'm-largest-alphabet',
        question: 'Will Alphabet be the largest company in the world by market cap on November 30, 2026?',
        groupItemTitle: 'Alphabet',
      },
      {
        id: 'm-largest-msft',
        question: 'Will Microsoft be the largest company in the world by market cap on November 30, 2026?',
        groupItemTitle: 'Microsoft',
      },
      {
        id: 'm-largest-meta',
        question: 'Will Meta be the largest company in the world by market cap on November 30, 2026?',
        groupItemTitle: 'Meta',
      },
    ],
  },
  {
    id: 'evt-nvda-hit',
    title: 'What will NVIDIA (NVDA) hit in November 2026?',
    slug: 'what-will-nvidia-nvda-hit-in-november-2026',
    volume: 1_800_000,
    tags: [{ slug: 'nvda' }, { slug: 'equities' }, { slug: 'stocks' }],
    markets: [
      {
        id: 'm-nvda-200',
        question: 'Will NVIDIA (NVDA) hit (HIGH) $200 in November?',
        groupItemTitle: '↑ $200',
      },
    ],
  },
  {
    id: 'evt-googl-hit',
    title: 'What will Alphabet Inc. (GOOGL) hit in November 2026?',
    slug: 'what-will-alphabet-inc-googl-hit-in-november-2026',
    volume: 950_000,
    tags: [{ slug: 'finance' }, { slug: 'hit-price' }],
    markets: [
      {
        id: 'm-googl-390',
        question: 'Will Alphabet Inc. (GOOGL) hit (HIGH) $390 in November?',
        groupItemTitle: '↑ $390',
      },
    ],
  },
  {
    id: 'evt-google-trivia',
    title: '#1 Searched Movie on Google 2026?',
    slug: '1-searched-movie-on-google-2026',
    volume: 3_100_000,
    tags: [{ slug: 'tech' }, { slug: 'google' }, { slug: 'pop-culture' }, { slug: 'movies' }],
    markets: [
      {
        id: 'm-movie-1',
        question: 'Will Avatar 3 be the #1 searched movie on Google in 2026?',
        groupItemTitle: 'Avatar 3',
      },
    ],
  },
  {
    id: 'evt-msft-close',
    title: 'Microsoft (MSFT) closes above ___ on November 24?',
    slug: 'microsoft-msft-closes-above-nov-24',
    volume: 610_000,
    tags: [{ slug: 'msft' }, { slug: 'equities' }, { slug: 'stocks' }],
    markets: [
      {
        id: 'm-msft-500',
        question: 'Will Microsoft (MSFT) close above $500 on November 24?',
        groupItemTitle: '$500',
      },
    ],
  },
  {
    id: 'evt-private-ai-only',
    title: 'Third-best AI Agent Lab end of November?',
    slug: 'third-best-ai-agent-lab-end-of-november',
    volume: 2_000_000,
    tags: [{ slug: 'ai' }, { slug: 'tech' }],
    markets: [
      {
        id: 'm-agent-anthropic',
        question: 'Will Anthropic be the third-best AI Agent Lab?',
        groupItemTitle: 'Anthropic',
      },
      {
        id: 'm-agent-deepseek',
        question: 'Will DeepSeek be the third-best AI Agent Lab?',
        groupItemTitle: 'DeepSeek',
      },
      {
        id: 'm-agent-zai',
        question: 'Will Z.ai be the third-best AI Agent Lab?',
        groupItemTitle: 'Z.ai',
      },
    ],
  },
  {
    id: 'evt-metamask-false-positive',
    title: 'Will MetaMask launch a token in 2026?',
    slug: 'will-metamask-launch-a-token-in-2026',
    volume: 500_000,
    tags: [{ slug: 'crypto' }],
    markets: [
      {
        id: 'm-metamask',
        question: 'Will MetaMask launch a token before December 31, 2026?',
        groupItemTitle: 'MetaMask',
      },
    ],
  },
  {
    id: 'evt-substring-trap',
    title: 'Global precious metal prices and metadata regulations in 2026?',
    slug: 'precious-metal-metadata-2026',
    volume: 120_000,
    tags: [{ slug: 'economy' }],
    markets: [
      {
        id: 'm-metal',
        question: 'Will industrial metal prices rise 10% based on metadata benchmarks?',
        groupItemTitle: 'Metal',
      },
    ],
  },
];

test('1, 5, 6, 7: Selecting META returns Meta-only contracts and excludes NVIDIA, Alphabet, Anthropic, DeepSeek, Z.ai, Alibaba, and substring traps', () => {
  const filtered = filterPolymarketEventsByTicker(REALISTIC_POLYMARKET_EVENTS, 'META');
  const eventIds = filtered.map((e) => e.id);

  assert.deepEqual(eventIds, [
    'evt-meta-hit',
    'evt-meta-muse',
    'evt-best-ai-2026',
    'evt-largest-company-nov',
  ]);

  // Verify false positives and unrelated company events are completely excluded
  assert.ok(!eventIds.includes('evt-nvda-hit'));
  assert.ok(!eventIds.includes('evt-googl-hit'));
  assert.ok(!eventIds.includes('evt-msft-close'));
  assert.ok(!eventIds.includes('evt-private-ai-only'));
  assert.ok(!eventIds.includes('evt-metamask-false-positive'));
  assert.ok(!eventIds.includes('evt-substring-trap'));

  // Multi-company events must ONLY contain the Meta contract
  const bestAi = filtered.find((e) => e.id === 'evt-best-ai-2026')!;
  assert.equal(bestAi.markets!.length, 1);
  assert.equal(bestAi.markets![0].id, 'm-ai-meta');

  const largest = filtered.find((e) => e.id === 'evt-largest-company-nov')!;
  assert.equal(largest.markets!.length, 1);
  assert.equal(largest.markets![0].id, 'm-largest-meta');

  // Assert no surviving contract mentions Anthropic, DeepSeek, Z.ai, Alibaba, NVIDIA, or Alphabet
  const allContractText = filtered
    .flatMap((e) => e.markets || [])
    .map((m) => `${m.groupItemTitle || ''} ${m.question || ''}`)
    .join('\n');

  for (const forbidden of ['Anthropic', 'DeepSeek', 'Z.ai', 'Alibaba', 'NVIDIA', 'Alphabet', 'Google', 'MetaMask']) {
    assert.ok(
      !allContractText.includes(forbidden),
      `Unexpected competitor/unrelated entity "${forbidden}" leaked into META results`,
    );
  }
});

test('2: Selecting NVDA returns NVIDIA-related markets and contracts only', () => {
  const filtered = filterPolymarketEventsByTicker(REALISTIC_POLYMARKET_EVENTS, 'NVDA');
  assert.deepEqual(
    filtered.map((e) => e.id),
    ['evt-largest-company-nov', 'evt-nvda-hit'],
  );

  const largest = filtered.find((e) => e.id === 'evt-largest-company-nov')!;
  assert.equal(largest.markets!.length, 1);
  assert.equal(largest.markets![0].id, 'm-largest-nvda');
});

test('3: Selecting GOOG includes Alphabet/GOOGL/Google company markets and excludes Google Search pop-culture trivia', () => {
  const profile = getTickerCompanyProfile('GOOG');
  assert.ok(profile.tickerAliases.includes('GOOG'));
  assert.ok(profile.tickerAliases.includes('GOOGL'));
  assert.ok(profile.searchQueries.includes('GOOGL'));
  assert.ok(profile.searchQueries.includes('Alphabet'));

  const filtered = filterPolymarketEventsByTicker(REALISTIC_POLYMARKET_EVENTS, 'GOOG');
  assert.deepEqual(
    filtered.map((e) => e.id),
    ['evt-best-ai-2026', 'evt-largest-company-nov', 'evt-googl-hit'],
  );

  // Google Search pop-culture trivia excluded
  assert.ok(!filtered.some((e) => e.id === 'evt-google-trivia'));

  // Contract-level isolation on multi-company events
  assert.deepEqual(
    filtered.find((e) => e.id === 'evt-best-ai-2026')!.markets!.map((m) => m.id),
    ['m-ai-google'],
  );
  assert.deepEqual(
    filtered.find((e) => e.id === 'evt-largest-company-nov')!.markets!.map((m) => m.id),
    ['m-largest-alphabet'],
  );
});

test('4: Selecting MSFT returns Microsoft-related markets and contracts only', () => {
  const filtered = filterPolymarketEventsByTicker(REALISTIC_POLYMARKET_EVENTS, 'MSFT');
  assert.deepEqual(
    filtered.map((e) => e.id),
    ['evt-largest-company-nov', 'evt-msft-close'],
  );
  assert.deepEqual(
    filtered.find((e) => e.id === 'evt-largest-company-nov')!.markets!.map((m) => m.id),
    ['m-largest-msft'],
  );
});

test('7 & 8 & 10: Multi-company detection, ticker switching, clearing filter, and volume sort preservation work consistently', () => {
  assert.equal(isMultiCompanyPolymarketEvent(REALISTIC_POLYMARKET_EVENTS[2]), true);
  assert.equal(isMultiCompanyPolymarketEvent(REALISTIC_POLYMARKET_EVENTS[0]), false);

  // Switching tickers produces distinct, non-overlapping filtered results
  const metaResults = filterPolymarketEventsByTicker(REALISTIC_POLYMARKET_EVENTS, 'META');
  const nvdaResults = filterPolymarketEventsByTicker(REALISTIC_POLYMARKET_EVENTS, 'NVDA');
  const clearedResults = filterPolymarketEventsByTicker(REALISTIC_POLYMARKET_EVENTS, '');

  assert.equal(clearedResults.length, REALISTIC_POLYMARKET_EVENTS.length);
  assert.notDeepEqual(
    metaResults.flatMap((e) => (e.markets || []).map((m) => m.id)),
    nvdaResults.flatMap((e) => (e.markets || []).map((m) => m.id)),
  );

  // Preserving existing volume descending sort order after filtering
  const sortedMeta = [...metaResults].sort((a, b) => (b.volume || 0) - (a.volume || 0));
  assert.deepEqual(
    sortedMeta.map((e) => e.id),
    ['evt-best-ai-2026', 'evt-largest-company-nov', 'evt-meta-hit', 'evt-meta-muse'],
  );

  // Ticker query resolution recognizes explicit tickers and known search symbols, ignores general terms
  assert.equal(resolveTickerFromQuery('meta', ''), 'META');
  assert.equal(resolveTickerFromQuery('', 'goog'), 'GOOG');
  assert.equal(resolveTickerFromQuery('', 'earnings'), '');
});

test('9: createLatestRequestGuard aborts older requests and prevents stale async responses from overwriting newer selections', async () => {
  const guard = createLatestRequestGuard();
  let committedTicker = '';
  let committedEvents: PolymarketEventLike[] = [];

  const simulateFetch = (ticker: string, delayMs: number, payload: PolymarketEventLike[]) => {
    const { requestId, signal } = guard.next();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        if (signal.aborted || !guard.isCurrent(requestId)) {
          resolve();
          return;
        }
        committedTicker = ticker;
        committedEvents = filterPolymarketEventsByTicker(payload, ticker);
        resolve();
      }, delayMs);
    });
  };

  // Start slower NVDA request first, then faster META request immediately after
  const slowNvdaPromise = simulateFetch('NVDA', 50, REALISTIC_POLYMARKET_EVENTS);
  const fastMetaPromise = simulateFetch('META', 10, REALISTIC_POLYMARKET_EVENTS);

  await Promise.all([slowNvdaPromise, fastMetaPromise]);

  // Even though NVDA resolved AFTER META, META's filtered results remain committed
  assert.equal(committedTicker, 'META');
  assert.ok(committedEvents.length > 0);
  assert.ok(
    committedEvents.every((ev) =>
      (ev.markets || []).every((m) => !/NVIDIA|Anthropic|DeepSeek/i.test(m.question || '')),
    ),
  );
});

test('CRWD resolves to CrowdStrike Holdings Inc., searches with company aliases, matches CrowdStrike events, and rejects WTI crude oil noise', async () => {
  const resolver = createPolymarketTickerResolver();
  const resolution = await resolver.resolveTicker('crwd');

  assert.equal(resolution.status, 'recognized');
  assert.equal(resolution.ticker, 'CRWD');
  assert.equal(resolution.companyName, 'CrowdStrike Holdings Inc.');
  assert.ok(resolution.profile);
  assert.ok(resolution.profile!.searchQueries.includes('CRWD'));
  assert.ok(resolution.profile!.searchQueries.includes('CrowdStrike'));
  assert.ok(resolution.profile!.searchQueries.includes('CrowdStrike Holdings'));

  // Search box typing "CRWD" also resolves to ticker CRWD
  assert.equal(resolveTickerFromQuery('', 'crwd'), 'CRWD');

  const sampleProviderEvents: PolymarketEventLike[] = [
    // Real-world Gamma fuzzy match noise when querying q=CRWD
    {
      id: 'evt-wti-crude',
      title: 'What will WTI Crude Oil (WTI) hit in November 2026?',
      slug: 'what-will-wti-crude-oil-hit',
      volume: 1_500_000,
      tags: [{ slug: 'oil' }, { slug: 'crude' }],
      markets: [
        {
          id: 'm-wti-1',
          question: 'Will WTI Crude Oil (WTI) hit (HIGH) $160 in November?',
          groupItemTitle: '↑ $160',
        },
      ],
    },
    // Legitimate CrowdStrike earnings market referencing CrowdStrike Holdings (CRWD)
    {
      id: 'evt-crwd-earnings',
      title: 'Will CrowdStrike Holdings (CRWD) beat quarterly earnings?',
      slug: 'will-crowdstrike-holdings-crwd-beat-quarterly-earnings',
      volume: 120_000,
      tags: [{ slug: 'earnings' }, { slug: 'stocks' }],
      markets: [
        {
          id: 'm-crwd-beat',
          question: 'Will CrowdStrike Holdings Inc. beat Q3 EPS estimates?',
          groupItemTitle: 'Beat EPS',
        },
      ],
    },
    // Legitimate CrowdStrike ARR market referencing "CrowdStrike" without literal "CRWD"
    {
      id: 'evt-crwd-arr',
      title: 'Will CrowdStrike Q3 net new ARR be above $250M?',
      slug: 'will-crowdstrike-q3-net-new-arr-be-above-250m',
      volume: 75_000,
      tags: [{ slug: 'earnings' }, { slug: 'tech' }],
      markets: [
        {
          id: 'm-crwd-arr',
          question: 'Will CrowdStrike Q3 net new ARR exceed $250M?',
          groupItemTitle: '$250M+',
        },
      ],
    },
    // Multi-contract earnings call mention market where only 1 contract references CrowdStrike
    {
      id: 'evt-dell-call',
      title: 'What will Dell say during their next earnings call?',
      slug: 'what-will-dell-say-during-their-next-earnings-call',
      volume: 45_000,
      tags: [{ slug: 'tech' }, { slug: 'mention-markets' }, { slug: 'earnings-calls' }],
      markets: [
        {
          id: 'm-dell-ai',
          question: 'Will Dell say "AI" 50+ times during earnings call?',
          groupItemTitle: 'AI 50+ times',
        },
        {
          id: 'm-dell-crwd',
          question: 'Will Dell say "CrowdStrike" during earnings call?',
          groupItemTitle: 'CrowdStrike',
        },
      ],
    },
  ];

  const filtered = filterPolymarketEventsByTicker(sampleProviderEvents, 'CRWD');
  assert.deepEqual(
    filtered.map((e) => e.id),
    ['evt-crwd-earnings', 'evt-crwd-arr', 'evt-dell-call'],
  );
  // WTI Crude Oil excluded
  assert.ok(!filtered.some((e) => e.id === 'evt-wti-crude'));
  // Dell call filtered down to ONLY the CrowdStrike contract
  const dellEvent = filtered.find((e) => e.id === 'evt-dell-call')!;
  assert.deepEqual(
    dellEvent.markets!.map((m) => m.id),
    ['m-dell-crwd'],
  );

  // Genuine zero-results response when provider only returns unrelated events
  const zeroMatches = filterPolymarketEventsByTicker([sampleProviderEvents[0]], 'CRWD');
  assert.equal(zeroMatches.length, 0);
});

test('ticker resolver distinguishes dynamic valid equities, unrecognized symbols, invalid formats, and lookup degradation', async () => {
  const mockFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('q=SNOW')) {
      return new Response(
        JSON.stringify({
          quotes: [
            {
              symbol: 'SNOW',
              quoteType: 'EQUITY',
              longname: 'Snowflake Inc.',
              shortname: 'Snowflake Inc.',
              exchange: 'NYQ',
              isYahooFinance: true,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('q=ZZZZ99')) {
      return new Response(JSON.stringify({ quotes: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('Upstream network failure');
  }) as typeof fetch;

  const resolver = createPolymarketTickerResolver({ fetchFn: mockFetch });

  // Dynamic valid equity not in static list resolves to company name + search aliases
  const snow = await resolver.resolveTicker('SNOW');
  assert.equal(snow.status, 'recognized');
  assert.equal(snow.companyName, 'Snowflake Inc.');
  assert.ok(snow.profile!.searchQueries.includes('SNOW'));
  assert.ok(snow.profile!.searchQueries.includes('Snowflake'));

  // Weather "snow" markets must NOT match SNOW (Snowflake Inc.) via lowercase slugs/tags
  const weatherSnowEvent: PolymarketEventLike = {
    id: 'evt-weather-snow',
    title: 'First snow of the 2026 season',
    slug: 'first-snow-of-the-2026-season',
    tags: [{ slug: 'weather' }, { slug: 'snow' }],
    markets: [
      {
        id: 'm-snow-buffalo',
        question: 'Will it snow in Buffalo, NY by October 31?',
        slug: 'will-it-snow-in-buffalo',
      },
    ],
  };
  assert.equal(
    filterPolymarketEventsByTicker([weatherSnowEvent], 'SNOW', { companyName: snow.companyName }).length,
    0,
  );

  // Non-existent symbol returns unrecognized (distinct from recognized zero-results)
  const bogus = await resolver.resolveTicker('ZZZZ99');
  assert.equal(bogus.status, 'unrecognized');
  assert.match(bogus.reason || '', /not recognized/i);

  // Invalid format returns invalid
  const malformed = await resolver.resolveTicker('!!!');
  assert.equal(malformed.status, 'invalid');

  // Transient Yahoo lookup failure does not falsely mark a valid-format ticker invalid
  const degraded = await resolver.resolveTicker('PANW');
  assert.equal(degraded.status, 'recognized');
  assert.equal(degraded.source, 'fallback');
});


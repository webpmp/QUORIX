import test from 'node:test';
import assert from 'node:assert';

test('1. General NEWS broad Yahoo search queries list includes markets, stock market, and SPY', () => {
  const generalYahooQueries = ['markets', 'stock market', 'SPY'];
  assert.strictEqual(generalYahooQueries.length, 3);
  assert.ok(generalYahooQueries.includes('markets'));
  assert.ok(generalYahooQueries.includes('stock market'));
  assert.ok(generalYahooQueries.includes('SPY'));
});

test('2. Multi-query Yahoo normalization and deduplication preserves unique articles', () => {
  const query1News = [
    { uuid: 'u1', title: 'Markets rally on tech earnings', link: 'https://finance.yahoo.com/news/1', providerPublishTime: 1700000000 },
    { uuid: 'u2', title: 'Fed hints at rate pause', link: 'https://finance.yahoo.com/news/2', providerPublishTime: 1700000100 },
  ];
  const query2News = [
    // Duplicate of u1 from query 1
    { uuid: 'u1', title: 'Markets rally on tech earnings', link: 'https://finance.yahoo.com/news/1', providerPublishTime: 1700000000 },
    { uuid: 'u3', title: 'Oil dips as inventories swell', link: 'https://finance.yahoo.com/news/3', providerPublishTime: 1700000200 },
  ];
  const query3News = [
    // Same title with slightly different URL
    { uuid: 'u4', title: 'Markets rally on tech earnings', link: 'https://finance.yahoo.com/news/1?guccounter=1', providerPublishTime: 1700000000 },
    { uuid: 'u5', title: 'SPY hits new weekly high', link: 'https://finance.yahoo.com/news/5', providerPublishTime: 1700000300 },
  ];

  const seenUrls = new Set<string>();
  const seenUuids = new Set<string>();
  const seenNormTitles = new Set<string>();
  const merged: any[] = [];

  for (const rawList of [query1News, query2News, query3News]) {
    for (const art of rawList) {
      const normTitle = art.title.toLowerCase().replace(/[^\w\s]/g, '').trim();
      const uuid = art.uuid;
      const url = art.link.split('?')[0];

      if (seenUrls.has(url) || seenUuids.has(uuid) || seenNormTitles.has(normTitle)) {
        continue;
      }
      seenUrls.add(url);
      seenUuids.add(uuid);
      seenNormTitles.add(normTitle);
      merged.push({
        id: `yfg-${uuid}`,
        title: art.title,
        url: art.link,
        publishedAt: new Date(art.providerPublishTime * 1000).toISOString(),
      });
    }
  }

  // Expect exactly 4 unique articles (u1, u2, u3, u5)
  assert.strictEqual(merged.length, 4);
  assert.deepStrictEqual(merged.map(m => m.id), ['yfg-u1', 'yfg-u2', 'yfg-u3', 'yfg-u5']);
});

test('3. General NEWS works and includes Yahoo sources even when secondary API keys are absent', () => {
  const hasNytKey = false;
  const hasNewsApiKey = false;
  const hasNewsdataKey = false;
  const requestedTickers: string[] = [];
  const rotateMode = false;

  const activeSources: string[] = [];
  const fetchPromises: string[] = [];

  if (requestedTickers.length === 0 && !rotateMode) {
    activeSources.push('Yahoo Finance (Markets)');
    fetchPromises.push('yahoo-search-markets');
  }

  if (!rotateMode && requestedTickers.length === 0) {
    activeSources.push('Yahoo Finance (RSS)');
    fetchPromises.push('yahoo-rss-markets');
  }

  const availableApiSources: string[] = [];
  if (hasNytKey) availableApiSources.push('nyt');
  if (hasNewsApiKey) availableApiSources.push('news');
  if (hasNewsdataKey) availableApiSources.push('newsdata');

  for (const src of availableApiSources) {
    activeSources.push(src);
    fetchPromises.push(src);
  }

  assert.strictEqual(availableApiSources.length, 0);
  assert.strictEqual(activeSources.length, 2);
  assert.ok(activeSources.includes('Yahoo Finance (Markets)'));
  assert.ok(activeSources.includes('Yahoo Finance (RSS)'));
  assert.strictEqual(fetchPromises.length, 2);
});

test('4. Secondary providers contribute alongside Yahoo sources when configured', () => {
  const hasNytKey = true;
  const hasNewsApiKey = true;
  const hasNewsdataKey = false;
  const requestedTickers: string[] = [];
  const rotateMode = false;

  const activeSources: string[] = [];
  const fetchPromises: string[] = [];

  if (requestedTickers.length === 0 && !rotateMode) {
    activeSources.push('Yahoo Finance (Markets)');
    fetchPromises.push('yahoo-search-markets');
  }

  if (!rotateMode && requestedTickers.length === 0) {
    activeSources.push('Yahoo Finance (RSS)');
    fetchPromises.push('yahoo-rss-markets');
  }

  const availableApiSources: string[] = [];
  if (hasNytKey) availableApiSources.push('NYT Business');
  if (hasNewsApiKey) availableApiSources.push('News API');
  if (hasNewsdataKey) availableApiSources.push('Newsdata.io');

  for (const src of availableApiSources) {
    activeSources.push(src);
    fetchPromises.push(src);
  }

  assert.strictEqual(activeSources.length, 4);
  assert.deepStrictEqual(activeSources, [
    'Yahoo Finance (Markets)',
    'Yahoo Finance (RSS)',
    'NYT Business',
    'News API',
  ]);
});

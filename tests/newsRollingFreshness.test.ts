import test from 'node:test';
import assert from 'node:assert';

// Verification helper that mirrors Workspace.tsx rolling 24-hour freshness filter logic
export function filterArticlesRolling24Hours(articles: any[], nowMs: number = Date.now()): any[] {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const cutoffMs = nowMs - TWENTY_FOUR_HOURS_MS;

  const filtered = articles.filter((item: any) => {
    const pubStr = item?.publishedAt;
    if (!pubStr || typeof pubStr !== 'string' || !pubStr.trim()) return false;
    try {
      const itemTimeMs = new Date(pubStr).getTime();
      if (Number.isNaN(itemTimeMs)) return false;
      return itemTimeMs >= cutoffMs;
    } catch {
      return false;
    }
  });

  const combined = [...filtered];
  combined.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return combined;
}

test('1. Articles within the rolling 24-hour window are included and sorted newest first', () => {
  const now = new Date('2026-11-27T15:00:00.000Z').getTime();

  const articles = [
    { id: '1', title: '5 hours ago', publishedAt: new Date(now - 5 * 3600 * 1000).toISOString() },
    { id: '2', title: '23 hours ago', publishedAt: new Date(now - 23 * 3600 * 1000).toISOString() },
    { id: '3', title: '1 hour ago', publishedAt: new Date(now - 1 * 3600 * 1000).toISOString() },
    { id: '4', title: 'Just now', publishedAt: new Date(now).toISOString() },
  ];

  const result = filterArticlesRolling24Hours(articles, now);
  assert.strictEqual(result.length, 4);
  assert.deepStrictEqual(result.map(a => a.id), ['4', '3', '1', '2']);
});

test('2. Articles older than 24 hours (e.g. 24h 1m, 2 days, 3 days) are strictly excluded', () => {
  const now = new Date('2026-11-27T15:00:00.000Z').getTime();

  const articles = [
    { id: 'fresh', title: '23h 59m ago', publishedAt: new Date(now - (24 * 3600 * 1000 - 60000)).toISOString() },
    { id: 'exact-cutoff', title: 'Exactly 24h ago', publishedAt: new Date(now - 24 * 3600 * 1000).toISOString() },
    { id: 'old-24h1m', title: '24h 1m ago', publishedAt: new Date(now - (24 * 3600 * 1000 + 60000)).toISOString() },
    { id: 'old-2days', title: '2 days ago', publishedAt: new Date(now - 48 * 3600 * 1000).toISOString() },
    { id: 'old-3days', title: '3 days ago', publishedAt: new Date(now - 72 * 3600 * 1000).toISOString() },
  ];

  const result = filterArticlesRolling24Hours(articles, now);
  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result.map(a => a.id), ['fresh', 'exact-cutoff']);
});

test('3. Articles published yesterday by calendar date appear if within rolling 24 hours', () => {
  // E.g., now is Friday 08:00 AM UTC; yesterday was Thursday. An article from Thursday 10:00 AM UTC is 22 hours old.
  const now = new Date('2026-11-27T08:00:00.000Z').getTime();
  const yesterdayArticleTime = new Date('2026-11-26T10:00:00.000Z').toISOString();

  const articles = [
    { id: 'yesterday-valid', title: 'Published yesterday (22h ago)', publishedAt: yesterdayArticleTime },
    { id: 'yesterday-expired', title: 'Published yesterday (26h ago)', publishedAt: new Date(now - 26 * 3600 * 1000).toISOString() },
  ];

  const result = filterArticlesRolling24Hours(articles, now);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'yesterday-valid');
});

test('4. Missing, unparseable, null, or empty timestamps are strictly excluded', () => {
  const now = new Date('2026-11-27T15:00:00.000Z').getTime();

  const articles = [
    { id: 'valid', title: 'Valid timestamp', publishedAt: new Date(now - 3600 * 1000).toISOString() },
    { id: 'missing-prop', title: 'Missing prop' },
    { id: 'null-val', title: 'Null timestamp', publishedAt: null },
    { id: 'undefined-val', title: 'Undefined timestamp', publishedAt: undefined },
    { id: 'empty-str', title: 'Empty string', publishedAt: '   ' },
    { id: 'invalid-date', title: 'Invalid date string', publishedAt: 'not-a-valid-date-string' },
  ];

  const result = filterArticlesRolling24Hours(articles, now);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'valid');
});

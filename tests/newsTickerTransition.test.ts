import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NewsTicker from '../src/components/NewsTicker';
import {
  FADE_IN_ITEM_DURATION_MS,
  FADE_IN_MAX_STAGGER_SPAN_MS,
  FADE_IN_STAGGER_STEP_MS,
  FADE_OUT_ITEM_DURATION_MS,
  FADE_OUT_MAX_STAGGER_SPAN_MS,
  FADE_OUT_STAGGER_STEP_MS,
  PHASE_SETTLE_BUFFER_MS,
  computeLeftToRightStaggerPlan,
  computeTickerFeedSignature,
  decideIncomingFeedTransition,
  type VisibleItemRect,
} from '../src/utils/newsTickerTransition';
import type { NewsItem } from '../src/types';

function makeNewsItem(id: string, title: string, source = 'Yahoo Finance'): NewsItem {
  return {
    id,
    title,
    source,
    time: '2026-11-24T12:00:00.000Z',
    sentiment: 'neutral',
    url: `https://example.com/news/${id}`,
  };
}

test('computeTickerFeedSignature distinguishes source switches and headline updates while ignoring unchanged feeds', () => {
  const batchA = [
    makeNewsItem('1', 'Fed holds rates steady', 'NYT'),
    makeNewsItem('2', 'Tech stocks lead midday gains', 'NYT'),
  ];
  const batchASame = [
    makeNewsItem('1', 'Fed holds rates steady', 'NYT'),
    makeNewsItem('2', 'Tech stocks lead midday gains', 'NYT'),
  ];
  const batchB = [
    makeNewsItem('3', 'Treasury yields ease after auction', 'NewsAPI'),
    makeNewsItem('2', 'Tech stocks lead midday gains', 'NewsAPI'),
  ];

  const sigA1 = computeTickerFeedSignature('nyt', batchA);
  const sigA2 = computeTickerFeedSignature('nyt', batchASame);
  const sigSourceSwitch = computeTickerFeedSignature('news', batchA);
  const sigContentUpdate = computeTickerFeedSignature('nyt', batchB);

  assert.equal(sigA1, sigA2);
  assert.notEqual(sigA1, sigSourceSwitch);
  assert.notEqual(sigA1, sigContentUpdate);
});

test('computeLeftToRightStaggerPlan orders visible mid-scroll headlines strictly left-to-right across both marquee sequences', () => {
  // Simulate a mid-scroll ticker where end of sequence 1 and start of sequence 2 are both visible
  const viewport = { left: 200, right: 1200, width: 1000 };
  const rects: VisibleItemRect[] = [
    // Off-screen left
    { key: '1-0', left: -300, right: 100, width: 400 },
    // Visible on left edge (partially clipped)
    { key: '1-1', left: 120, right: 440, width: 320 },
    // Visible in middle
    { key: '1-2', left: 488, right: 760, width: 272 },
    // Visible from cloned sequence 2 on right
    { key: '2-0', left: 808, right: 1120, width: 312 },
    // Visible partially entering right edge
    { key: '2-1', left: 1168, right: 1450, width: 282 },
    // Off-screen right
    { key: '2-2', left: 1498, right: 1800, width: 302 },
  ];

  const outPlan = computeLeftToRightStaggerPlan(rects, viewport, 'out', 3);
  assert.equal(outPlan.visibleCount, 4);
  assert.equal(outPlan.delaysByKey['1-1'], 0);
  assert.equal(outPlan.delaysByKey['1-2'], FADE_OUT_STAGGER_STEP_MS);
  assert.equal(outPlan.delaysByKey['2-0'], FADE_OUT_STAGGER_STEP_MS * 2);
  assert.equal(outPlan.delaysByKey['2-1'], FADE_OUT_STAGGER_STEP_MS * 3);
  // Off-screen items clear immediately on fade-out
  assert.equal(outPlan.delaysByKey['1-0'], 0);
  assert.equal(outPlan.delaysByKey['2-2'], 0);
  assert.equal(
    outPlan.totalDurationMs,
    FADE_OUT_STAGGER_STEP_MS * 3 + FADE_OUT_ITEM_DURATION_MS + PHASE_SETTLE_BUFFER_MS
  );

  const inPlan = computeLeftToRightStaggerPlan(rects, viewport, 'in', 3);
  assert.equal(inPlan.visibleCount, 4);
  assert.equal(inPlan.delaysByKey['1-1'], 0);
  assert.equal(inPlan.delaysByKey['1-2'], FADE_IN_STAGGER_STEP_MS);
  assert.equal(inPlan.delaysByKey['2-0'], FADE_IN_STAGGER_STEP_MS * 2);
  assert.equal(inPlan.delaysByKey['2-1'], FADE_IN_STAGGER_STEP_MS * 3);
  // Off-screen items settle at maxDelayMs so they are opaque before scrolling resumes
  assert.equal(inPlan.delaysByKey['2-2'], inPlan.maxDelayMs);
  assert.equal(
    inPlan.totalDurationMs,
    FADE_IN_STAGGER_STEP_MS * 3 + FADE_IN_ITEM_DURATION_MS + PHASE_SETTLE_BUFFER_MS
  );
});

test('computeLeftToRightStaggerPlan caps total stagger span on ultrawide viewports and falls back cleanly without DOM rects', () => {
  const ultrawideViewport = { left: 0, right: 3200, width: 3200 };
  const manyRects: VisibleItemRect[] = Array.from({ length: 12 }, (_, idx) => ({
    key: `1-${idx}`,
    left: idx * 250,
    right: idx * 250 + 220,
    width: 220,
  }));

  const outPlan = computeLeftToRightStaggerPlan(manyRects, ultrawideViewport, 'out', 12);
  assert.equal(outPlan.visibleCount, 12);
  assert.ok(outPlan.maxDelayMs <= FADE_OUT_MAX_STAGGER_SPAN_MS);
  assert.ok(outPlan.delaysByKey['1-0'] < outPlan.delaysByKey['1-11']);

  const inPlan = computeLeftToRightStaggerPlan(manyRects, ultrawideViewport, 'in', 12);
  assert.equal(inPlan.visibleCount, 12);
  assert.ok(inPlan.maxDelayMs <= FADE_IN_MAX_STAGGER_SPAN_MS);
  assert.ok(inPlan.delaysByKey['1-0'] < inPlan.delaysByKey['1-11']);

  // Fallback when layout measurements are unavailable (zero-width viewport)
  const fallbackPlan = computeLeftToRightStaggerPlan([], null, 'in', 6);
  assert.equal(fallbackPlan.visibleCount, 5);
  assert.equal(fallbackPlan.delaysByKey['1-0'], 0);
  assert.ok(fallbackPlan.delaysByKey['1-4'] > fallbackPlan.delaysByKey['1-0']);
  assert.equal(fallbackPlan.delaysByKey['1-5'], fallbackPlan.maxDelayMs);
  assert.equal(fallbackPlan.delaysByKey['2-0'], fallbackPlan.maxDelayMs);
});

test('decideIncomingFeedTransition prevents overlapping transitions and stale overwrites across refreshes and source switches', () => {
  // Initial load with no displayed headlines enters directly into Phase C fade-in
  assert.equal(
    decideIncomingFeedTransition({
      phase: 'scrolling',
      hasDisplayedHeadlines: false,
      displayedSignature: '',
      pendingSignature: null,
      incomingSignature: 'nyt|1:Headline A',
    }),
    'enter-immediately'
  );

  // Identical refresh while scrolling is a noop (preserves smooth crawl)
  assert.equal(
    decideIncomingFeedTransition({
      phase: 'scrolling',
      hasDisplayedHeadlines: true,
      displayedSignature: 'nyt|1:Headline A',
      pendingSignature: null,
      incomingSignature: 'nyt|1:Headline A',
    }),
    'noop'
  );

  // Normal refresh or source switch while scrolling starts Phase A fade-out
  assert.equal(
    decideIncomingFeedTransition({
      phase: 'scrolling',
      hasDisplayedHeadlines: true,
      displayedSignature: 'nyt|1:Headline A',
      pendingSignature: null,
      incomingSignature: 'yahoo|2:Headline B',
    }),
    'start-fade-out'
  );

  // Rapid consecutive source switch during Phase A fade-out coalesces into pending payload without restarting fade-out
  assert.equal(
    decideIncomingFeedTransition({
      phase: 'fading-out',
      hasDisplayedHeadlines: true,
      displayedSignature: 'nyt|1:Headline A',
      pendingSignature: 'yahoo|2:Headline B',
      incomingSignature: 'news|3:Headline C',
    }),
    'replace-pending'
  );

  // Duplicate response matching already-pending feed during fade-out is ignored
  assert.equal(
    decideIncomingFeedTransition({
      phase: 'fading-out',
      hasDisplayedHeadlines: true,
      displayedSignature: 'nyt|1:Headline A',
      pendingSignature: 'yahoo|2:Headline B',
      incomingSignature: 'yahoo|2:Headline B',
    }),
    'noop'
  );

  // Newer payload arriving while mounted at opacity 0 (fading-in) swaps immediately without an invisible fade-out
  assert.equal(
    decideIncomingFeedTransition({
      phase: 'fading-in',
      hasDisplayedHeadlines: true,
      displayedSignature: 'yahoo|2:Headline B',
      pendingSignature: null,
      incomingSignature: 'news|3:Headline C',
    }),
    'enter-immediately'
  );

  // Newer payload arriving mid-reveal cleanly interrupts into a fade-out before swapping
  assert.equal(
    decideIncomingFeedTransition({
      phase: 'revealing',
      hasDisplayedHeadlines: true,
      displayedSignature: 'yahoo|2:Headline B',
      pendingSignature: null,
      incomingSignature: 'news|3:Headline C',
    }),
    'interrupt-to-fade-out'
  );
});

test('NewsTicker renders preserved structure with static CSS variable styles and transition phase classes', () => {
  const html = renderToStaticMarkup(React.createElement(NewsTicker));

  assert.match(html, /data-ticker-phase="scrolling"/);
  assert.match(html, /NEWS TAPE/);
  assert.match(html, /HOVER TO PAUSE/);
  assert.match(html, /NYT/);
  assert.match(html, /NEWSDATA\.IO/);
  assert.match(html, /YF/);
  // Verify static CSS custom property rules replaced dynamic style interpolation
  assert.match(html, /var\(--marquee-duration, 150s\)/);
  assert.match(html, /var\(--marquee-min-width, 100%\)/);
  assert.match(html, /var\(--ticker-fade-delay, 0ms\)/);
  assert.match(html, /\.ticker-headline-exiting/);
  assert.match(html, /\.ticker-headline-entering/);
  assert.match(html, /\.ticker-headline-revealing/);
  assert.match(html, /\.ticker-headline-steady/);
});

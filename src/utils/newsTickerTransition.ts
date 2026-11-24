import { NewsItem } from '../types';

export type NewsTickerSourceId = 'nyt' | 'news' | 'newsdata' | 'yahoo' | null;

export type NewsTickerTransitionPhase =
  | 'scrolling'
  | 'fading-out'
  | 'fading-in'
  | 'revealing';

export interface ConfiguredNewsSources {
  nyt: boolean;
  news: boolean;
  newsdata: boolean;
}

export interface TickerFeedSnapshot {
  news: NewsItem[];
  activeSource: NewsTickerSourceId;
  configuredSources: ConfiguredNewsSources;
  isSimulated: boolean;
  signature: string;
}

export interface VisibleItemRect {
  key: string;
  left: number;
  right: number;
  width: number;
}

export interface ViewportHorizontalBounds {
  left: number;
  right: number;
  width: number;
}

export interface StaggerPlan {
  delaysByKey: Record<string, number>;
  visibleCount: number;
  maxDelayMs: number;
  totalDurationMs: number;
}

export const FADE_OUT_ITEM_DURATION_MS = 220;
export const FADE_OUT_STAGGER_STEP_MS = 65;
export const FADE_OUT_MAX_STAGGER_SPAN_MS = 260;

export const FADE_IN_ITEM_DURATION_MS = 240;
export const FADE_IN_STAGGER_STEP_MS = 70;
export const FADE_IN_MAX_STAGGER_SPAN_MS = 280;

export const PHASE_SETTLE_BUFFER_MS = 24;
const FALLBACK_VISIBLE_SLOTS = 5;

/**
 * Builds a stable signature representing the displayed news source and headline content.
 * Changes whenever the active source switches or headlines are added, removed, reordered, or updated.
 */
export function computeTickerFeedSignature(
  activeSource: NewsTickerSourceId,
  items: readonly NewsItem[]
): string {
  return `${activeSource || ''}|${items
    .map((item) => `${item.id}:${item.title}:${item.url || ''}`)
    .join('|')}`;
}

/**
 * Computes left-to-right staggered opacity delays for headline items currently inside
 * the visible ticker viewport.
 *
 * - For `fading-out`: visible headlines sweep away left-to-right; off-screen headlines get 0ms.
 * - For `fading-in`: visible headlines sweep in left-to-right; off-screen headlines settle at maxDelayMs
 *   so they are already opaque before scrolling resumes.
 */
export function computeLeftToRightStaggerPlan(
  itemRects: readonly VisibleItemRect[],
  viewport: ViewportHorizontalBounds | null,
  direction: 'out' | 'in',
  fallbackSequenceLength = 0
): StaggerPlan {
  const itemDurationMs =
    direction === 'out' ? FADE_OUT_ITEM_DURATION_MS : FADE_IN_ITEM_DURATION_MS;
  const stepMs =
    direction === 'out' ? FADE_OUT_STAGGER_STEP_MS : FADE_IN_STAGGER_STEP_MS;
  const maxSpanMs =
    direction === 'out' ? FADE_OUT_MAX_STAGGER_SPAN_MS : FADE_IN_MAX_STAGGER_SPAN_MS;

  const delaysByKey: Record<string, number> = {};

  if (viewport && viewport.width > 0 && itemRects.length > 0) {
    const visible = itemRects
      .filter(
        (item) =>
          item.width > 0 && item.right > viewport.left + 1 && item.left < viewport.right - 1
      )
      .sort((a, b) => a.left - b.left);

    if (visible.length > 0) {
      const effectiveStep =
        visible.length <= 1
          ? 0
          : Math.min(stepMs, Math.floor(maxSpanMs / (visible.length - 1)));
      const maxDelayMs = visible.length <= 1 ? 0 : effectiveStep * (visible.length - 1);

      for (const item of itemRects) {
        delaysByKey[item.key] = direction === 'out' ? 0 : maxDelayMs;
      }
      visible.forEach((item, idx) => {
        delaysByKey[item.key] = idx * effectiveStep;
      });

      return {
        delaysByKey,
        visibleCount: visible.length,
        maxDelayMs,
        totalDurationMs: maxDelayMs + itemDurationMs + PHASE_SETTLE_BUFFER_MS,
      };
    }
  }

  // Deterministic fallback when layout measurements are unavailable (e.g., SSR or hidden container)
  const fallbackCount = Math.min(Math.max(0, fallbackSequenceLength), FALLBACK_VISIBLE_SLOTS);
  if (fallbackCount === 0) {
    return {
      delaysByKey,
      visibleCount: 0,
      maxDelayMs: 0,
      totalDurationMs: itemDurationMs + PHASE_SETTLE_BUFFER_MS,
    };
  }

  const effectiveStep =
    fallbackCount <= 1
      ? 0
      : Math.min(stepMs, Math.floor(maxSpanMs / (fallbackCount - 1)));
  const maxDelayMs = fallbackCount <= 1 ? 0 : effectiveStep * (fallbackCount - 1);

  for (let i = 0; i < fallbackSequenceLength; i++) {
    const delay = i < fallbackCount ? i * effectiveStep : direction === 'out' ? 0 : maxDelayMs;
    delaysByKey[`1-${i}`] = delay;
    delaysByKey[`2-${i}`] = direction === 'out' ? 0 : maxDelayMs;
  }

  return {
    delaysByKey,
    visibleCount: fallbackCount,
    maxDelayMs,
    totalDurationMs: maxDelayMs + itemDurationMs + PHASE_SETTLE_BUFFER_MS,
  };
}

export type IncomingFeedAction =
  | 'noop'
  | 'enter-immediately'
  | 'start-fade-out'
  | 'replace-pending'
  | 'interrupt-to-fade-out';

export interface TransitionDecisionInput {
  phase: NewsTickerTransitionPhase;
  hasDisplayedHeadlines: boolean;
  displayedSignature: string;
  pendingSignature: string | null;
  incomingSignature: string;
}

/**
 * Pure transition coordinator that prevents overlapping transitions and stale overwrites
 * when automatic refreshes or source switches occur while a transition is already active.
 */
export function decideIncomingFeedTransition(
  input: TransitionDecisionInput
): IncomingFeedAction {
  const activeTargetSig = input.pendingSignature ?? input.displayedSignature;
  if (input.incomingSignature === activeTargetSig) {
    return 'noop';
  }

  if (!input.hasDisplayedHeadlines) {
    return 'enter-immediately';
  }

  if (input.phase === 'fading-out') {
    // Coalesce onto the in-flight fade-out so we never restart or stack fade-out timers
    return 'replace-pending';
  }

  if (input.phase === 'fading-in') {
    // Headlines are still mounted at opacity 0 prior to reveal; swap straight to the newest feed
    return 'enter-immediately';
  }

  if (input.phase === 'revealing') {
    // Interrupt the visible reveal cleanly and fade out before swapping to the newest feed
    return 'interrupt-to-fade-out';
  }

  return 'start-fade-out';
}

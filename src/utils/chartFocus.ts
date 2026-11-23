export type ZoomableChartPanelId = 'price' | 'volume' | 'rsi' | 'macd' | 'atr' | 'obv';
export type ChartPanelId = ZoomableChartPanelId | 'stoch' | 'cci' | 'adx' | 'roc';

export const ZOOMABLE_CHART_PANELS: ReadonlySet<ZoomableChartPanelId> = new Set([
  'price',
  'volume',
  'rsi',
  'macd',
  'atr',
  'obv',
]);

export function isZoomableChartPanel(panel: ChartPanelId | null): panel is ZoomableChartPanelId {
  return panel !== null && ZOOMABLE_CHART_PANELS.has(panel as ZoomableChartPanelId);
}

export interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
}

const EDITABLE_ANCESTOR_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], [role="searchbox"], [role="combobox"]';

/**
 * Returns true if the event target or active element is a text-entry control
 * where single-key chart shortcuts (such as `0`) must never trigger.
 */
export function isEditableKeyboardTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as EditableTargetLike;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (el.isContentEditable === true) {
    return true;
  }
  if (typeof el.getAttribute === 'function') {
    const ceAttr = el.getAttribute('contenteditable');
    if (ceAttr === '' || ceAttr === 'true' || ceAttr === 'plaintext-only') {
      return true;
    }
    const roleAttr = el.getAttribute('role');
    if (roleAttr === 'textbox' || roleAttr === 'searchbox' || roleAttr === 'combobox') {
      return true;
    }
  }
  if (typeof el.closest === 'function') {
    try {
      if (el.closest(EDITABLE_ANCESTOR_SELECTOR)) {
        return true;
      }
    } catch {
      // Ignore selector errors on non-standard targets
    }
  }
  return false;
}

export interface ChartResetShortcutInput {
  key: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
  activeElement?: unknown;
  isModalOpen: boolean;
  focusedPanel: ChartPanelId | null;
  visiblePanels: ReadonlySet<ChartPanelId>;
}

/**
 * Resolves which chart panel should be reset when pressing `0`.
 * Returns `null` if the event is not a valid reset shortcut, originates from an
 * editable text-entry control, occurs while a modal is open, or when no
 * visible zoomable chart panel currently holds focus.
 */
export function resolveChartResetShortcut(
  input: ChartResetShortcutInput
): ZoomableChartPanelId | null {
  if (input.isModalOpen) return null;
  if (input.defaultPrevented) return null;
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  if (input.key !== '0') return null;
  if (input.repeat) return null;
  if (isEditableKeyboardTarget(input.target) || isEditableKeyboardTarget(input.activeElement)) {
    return null;
  }
  if (!input.focusedPanel || !input.visiblePanels.has(input.focusedPanel)) {
    return null;
  }
  return isZoomableChartPanel(input.focusedPanel) ? input.focusedPanel : null;
}

/**
 * Dispatches a keyboard reset shortcut (`0`) to at most ONE panel's existing
 * reset handler. Returns the panel ID that was reset, or `null` if no reset occurred.
 */
export function dispatchChartResetShortcut(
  input: ChartResetShortcutInput,
  resetHandlers: Record<ZoomableChartPanelId, () => void>
): ZoomableChartPanelId | null {
  const targetPanel = resolveChartResetShortcut(input);
  if (!targetPanel) return null;
  resetHandlers[targetPanel]();
  return targetPanel;
}

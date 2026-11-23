import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartWidget from '../src/components/ChartWidget';
import { setCachedMarketHistory } from '../src/utils/marketHistoryCache';
import { STUDIES_STORAGE_KEY } from '../src/utils/technicalStudies';
import {
  dispatchChartResetShortcut,
  isEditableKeyboardTarget,
  resolveChartResetShortcut,
  type ChartPanelId,
  type ZoomableChartPanelId,
} from '../src/utils/chartFocus';
import type { StockData } from '../src/types';

const ALL_PANELS: ReadonlySet<ChartPanelId> = new Set([
  'price',
  'volume',
  'rsi',
  'macd',
  'stoch',
  'cci',
  'adx',
  'atr',
  'obv',
  'roc',
]);

interface SimulatedChartSession {
  zoomState: Record<ZoomableChartPanelId, number | null>;
  resetCounts: Record<ZoomableChartPanelId, number>;
  focusedPanel: ChartPanelId | null;
  visiblePanels: Set<ChartPanelId>;
  activeElement: unknown;
  isModalOpen: boolean;
  focusChart: (panel: ChartPanelId) => void;
  clickOutsideCharts: (target?: unknown) => void;
  wheelZoom: (panel: ZoomableChartPanelId, nextZoom: number) => void;
  dragZoom: (panel: ZoomableChartPanelId, nextZoom: number) => void;
  doubleClickReset: (panel: ZoomableChartPanelId) => void;
  pressKey: (opts: {
    key: string;
    repeat?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    target?: unknown;
  }) => ZoomableChartPanelId | null;
  hidePanel: (panel: ChartPanelId) => void;
  switchSecurityOrTimeframe: (opts?: { uncached?: boolean }) => void;
}

function createSimulatedChartSession(): SimulatedChartSession {
  const zoomState: Record<ZoomableChartPanelId, number | null> = {
    price: null,
    volume: null,
    rsi: null,
    macd: null,
    atr: null,
    obv: null,
  };
  const resetCounts: Record<ZoomableChartPanelId, number> = {
    price: 0,
    volume: 0,
    rsi: 0,
    macd: 0,
    atr: 0,
    obv: 0,
  };

  // Mirrors initial app state where `#terminal-input` has `autoFocus`
  const terminalInput = { tagName: 'INPUT', id: 'terminal-input' };
  const panelElements: Record<ChartPanelId, { tagName: string; panel: ChartPanelId }> = {
    price: { tagName: 'DIV', panel: 'price' },
    volume: { tagName: 'DIV', panel: 'volume' },
    rsi: { tagName: 'DIV', panel: 'rsi' },
    macd: { tagName: 'DIV', panel: 'macd' },
    stoch: { tagName: 'DIV', panel: 'stoch' },
    cci: { tagName: 'DIV', panel: 'cci' },
    adx: { tagName: 'DIV', panel: 'adx' },
    atr: { tagName: 'DIV', panel: 'atr' },
    obv: { tagName: 'DIV', panel: 'obv' },
    roc: { tagName: 'DIV', panel: 'roc' },
  };

  const resetChartPanel = (panel: ZoomableChartPanelId) => {
    zoomState[panel] = null;
    resetCounts[panel] += 1;
  };

  const resetHandlers: Record<ZoomableChartPanelId, () => void> = {
    price: () => resetChartPanel('price'),
    volume: () => resetChartPanel('volume'),
    rsi: () => resetChartPanel('rsi'),
    macd: () => resetChartPanel('macd'),
    atr: () => resetChartPanel('atr'),
    obv: () => resetChartPanel('obv'),
  };

  const session: SimulatedChartSession = {
    zoomState,
    resetCounts,
    focusedPanel: null,
    visiblePanels: new Set<ChartPanelId>(ALL_PANELS),
    activeElement: terminalInput,
    isModalOpen: false,
    focusChart(panel) {
      session.focusedPanel = panel;
      session.activeElement = panelElements[panel];
    },
    clickOutsideCharts(target = { tagName: 'BODY' }) {
      session.focusedPanel = null;
      session.activeElement = target;
    },
    wheelZoom(panel, nextZoom) {
      session.focusChart(panel);
      zoomState[panel] = nextZoom;
    },
    dragZoom(panel, nextZoom) {
      session.focusChart(panel);
      zoomState[panel] = nextZoom;
    },
    doubleClickReset(panel) {
      session.focusChart(panel);
      resetChartPanel(panel);
    },
    pressKey({ key, repeat = false, ctrlKey = false, metaKey = false, altKey = false, target }) {
      return dispatchChartResetShortcut(
        {
          key,
          repeat,
          ctrlKey,
          metaKey,
          altKey,
          target: target ?? session.activeElement,
          activeElement: session.activeElement,
          isModalOpen: session.isModalOpen,
          focusedPanel: session.focusedPanel,
          visiblePanels: session.visiblePanels,
        },
        resetHandlers
      );
    },
    hidePanel(panel) {
      session.visiblePanels.delete(panel);
      if (session.focusedPanel === panel) {
        session.focusedPanel = null;
      }
    },
    switchSecurityOrTimeframe(opts) {
      // Mirrors [sym, interval] reset effect and optional loading -> ready transition
      (Object.keys(zoomState) as ZoomableChartPanelId[]).forEach((k) => {
        zoomState[k] = null;
      });
      if (opts?.uncached) {
        const prevVisible = new Set(session.visiblePanels);
        session.visiblePanels.clear();
        session.focusedPanel = null;
        prevVisible.forEach((p) => session.visiblePanels.add(p));
      } else {
        session.clickOutsideCharts(terminalInput);
      }
    },
  };

  return session;
}

test('Validation 1-4: pressing `0` resets ONLY the currently focused chart across Price, Volume, RSI, MACD, ATR, and OBV while leaving all others unchanged', () => {
  const panels: ZoomableChartPanelId[] = ['price', 'volume', 'rsi', 'macd', 'atr', 'obv'];

  for (const target of panels) {
    const session = createSimulatedChartSession();
    // Zoom every chart to distinct custom zoom levels
    session.wheelZoom('price', 2.25);
    session.wheelZoom('volume', 1.8);
    session.dragZoom('rsi', 2.6);
    session.wheelZoom('macd', 1.95);
    session.dragZoom('atr', 2.4);
    session.wheelZoom('obv', 1.65);

    // Focus the target chart and press `0`
    session.focusChart(target);
    const resetResult = session.pressKey({ key: '0' });

    assert.equal(resetResult, target, `Expected \`0\` to reset ${target}`);
    assert.equal(session.zoomState[target], null, `${target} zoom must reset to null`);
    assert.equal(session.resetCounts[target], 1, `${target} must reset exactly once`);

    for (const other of panels) {
      if (other === target) continue;
      assert.notEqual(
        session.zoomState[other],
        null,
        `Resetting ${target} must leave ${other} zoom unchanged`
      );
      assert.equal(
        session.resetCounts[other],
        0,
        `Resetting ${target} must not invoke reset on ${other}`
      );
    }
  }
});

test('Validation 5-6: interacting with zoom controls establishes/retains focus without extra click, and switching focus routes `0` to the most recently focused chart', () => {
  const session = createSimulatedChartSession();

  // Start with auto-focused `#terminal-input`, then wheel-zoom MACD directly
  assert.equal((session.activeElement as { tagName: string }).tagName, 'INPUT');
  session.wheelZoom('macd', 2.1);
  // No click required after wheel zoom; pressing `0` immediately resets MACD
  assert.equal(session.pressKey({ key: '0' }), 'macd');
  assert.equal(session.zoomState.macd, null);

  // Zoom RSI and ATR, then switch focus back to RSI
  session.dragZoom('rsi', 2.5);
  session.wheelZoom('atr', 1.75);
  assert.equal(session.focusedPanel, 'atr');

  session.focusChart('rsi');
  assert.equal(session.pressKey({ key: '0' }), 'rsi');
  assert.equal(session.zoomState.rsi, null);
  assert.equal(session.zoomState.atr, 1.75, 'ATR must stay zoomed when RSI is reset');

  // Switch focus to a non-zoomable chart (STOCH): pressing `0` must NOT reset ATR or Price
  session.wheelZoom('price', 1.9);
  session.focusChart('stoch');
  assert.equal(session.pressKey({ key: '0' }), null);
  assert.equal(session.zoomState.price, 1.9);
  assert.equal(session.zoomState.atr, 1.75);
});

test('Validation 7-8: pressing `0` resets nothing when no chart is focused, when a study is hidden, when a modal is open, with modifier keys, or while typing in editable controls', () => {
  const session = createSimulatedChartSession();

  // Initial state: no chart focused -> pressing `0` does nothing
  assert.equal(session.pressKey({ key: '0' }), null);

  // Zoom Price & MACD, then click outside all charts -> pressing `0` does nothing
  session.wheelZoom('price', 2.0);
  session.wheelZoom('macd', 1.85);
  session.clickOutsideCharts({ tagName: 'DIV' });
  assert.equal(session.pressKey({ key: '0' }), null);
  assert.equal(session.zoomState.price, 2.0);
  assert.equal(session.zoomState.macd, 1.85);

  // Editable text-entry controls must NEVER trigger chart reset
  const editableTargets = [
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
    {
      tagName: 'DIV',
      getAttribute: (name: string) => (name === 'contenteditable' ? 'true' : null),
    },
    {
      tagName: 'SPAN',
      closest: (sel: string) => (sel.includes('contenteditable') ? { tagName: 'DIV' } : null),
    },
    {
      tagName: 'DIV',
      getAttribute: (name: string) => (name === 'role' ? 'searchbox' : null),
    },
    {
      tagName: 'DIV',
      getAttribute: (name: string) => (name === 'role' ? 'textbox' : null),
    },
  ];

  for (const el of editableTargets) {
    assert.equal(isEditableKeyboardTarget(el), true);
    session.focusChart('macd');
    assert.equal(
      resolveChartResetShortcut({
        key: '0',
        target: el,
        activeElement: el,
        isModalOpen: false,
        focusedPanel: 'macd',
        visiblePanels: ALL_PANELS,
      }),
      null
    );
    assert.equal(session.pressKey({ key: '0', target: el }), null);
  }
  assert.equal(session.zoomState.macd, 1.85);

  // Studies modal open -> pressing `0` does nothing
  session.focusChart('macd');
  session.isModalOpen = true;
  assert.equal(session.pressKey({ key: '0' }), null);
  session.isModalOpen = false;

  // Browser zoom shortcut Ctrl+0 / Cmd+0 / Alt+0 -> ignored
  assert.equal(session.pressKey({ key: '0', ctrlKey: true }), null);
  assert.equal(session.pressKey({ key: '0', metaKey: true }), null);
  assert.equal(session.pressKey({ key: '0', altKey: true }), null);
  assert.equal(session.zoomState.macd, 1.85);

  // Hiding the currently focused panel clears focus so `0` does nothing
  session.hidePanel('macd');
  assert.equal(session.pressKey({ key: '0' }), null);
  assert.equal(session.zoomState.price, 2.0);
});

test('Validation 9-11: double-click reset reuses shared logic, single keypress triggers only one reset, and security/timeframe switches preserve shortcut reliability', () => {
  const session = createSimulatedChartSession();

  // Double-click resets only the target chart and keeps focus on it
  session.wheelZoom('price', 2.1);
  session.wheelZoom('obv', 1.7);
  session.doubleClickReset('obv');
  assert.equal(session.zoomState.obv, null);
  assert.equal(session.zoomState.price, 2.1);
  assert.equal(session.focusedPanel, 'obv');

  // Single keypress triggers one reset; held-key repeat does not trigger duplicate resets
  session.wheelZoom('atr', 2.3);
  assert.equal(session.pressKey({ key: '0', repeat: false }), 'atr');
  assert.equal(session.pressKey({ key: '0', repeat: true }), null);
  assert.equal(session.resetCounts.atr, 1);

  // Switch security (cached) and timeframe (uncached) -> focus clears cleanly and re-establishes on interaction
  session.wheelZoom('rsi', 2.4);
  session.switchSecurityOrTimeframe({ uncached: false });
  assert.equal(session.focusedPanel, null);
  assert.equal(session.pressKey({ key: '0' }), null);

  session.dragZoom('rsi', 1.9);
  assert.equal(session.pressKey({ key: '0' }), 'rsi');
  assert.equal(session.zoomState.rsi, null);

  session.wheelZoom('obv', 2.2);
  session.switchSecurityOrTimeframe({ uncached: true });
  assert.equal(session.focusedPanel, null);
  session.wheelZoom('obv', 1.6);
  assert.equal(session.pressKey({ key: '0' }), 'obv');
  assert.equal(session.zoomState.obv, null);
});

test('ChartWidget SSR attaches data-chart-panel and tabIndex=-1 focus hooks to every chart panel without altering visual layout', () => {
  const prevStorage = (globalThis as { localStorage?: Storage }).localStorage;
  const store = new Map<string, string>();
  store.set(
    STUDIES_STORAGE_KEY,
    JSON.stringify(['volume', 'rsi', 'macd', 'stoch', 'cci', 'adx', 'atr', 'obv', 'roc'])
  );
  (globalThis as { localStorage?: Partial<Storage> }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };

  try {
    const baseTs = 1711000000;
    const bars = Array.from({ length: 24 }, (_, i) => ({
      date: `B${i}`,
      timestamp: baseTs + i * 3600,
      open: 150 + i * 0.2,
      high: 151 + i * 0.2,
      low: 149 + i * 0.2,
      close: 150.5 + i * 0.2,
      volume: 1_000_000 + i * 25_000,
      rsi: 45 + Math.sin(i / 3) * 15,
      macd: Math.sin(i / 3) * 0.8,
      macdSignal: Math.sin((i - 2) / 3) * 0.65,
      macdHist: Math.sin(i / 3) * 0.15,
      stochK: 50 + Math.sin(i / 3) * 20,
      stochD: 50 + Math.sin((i - 1) / 3) * 18,
      cci: Math.sin(i / 3) * 80,
      adx: 24 + Math.cos(i / 4) * 6,
      plusDi: 28 + Math.sin(i / 3) * 5,
      minusDi: 18 + Math.cos(i / 3) * 5,
      atr: 1.5 + Math.sin(i / 4) * 0.3,
      obv: 12_000_000 + i * 250_000,
      roc: Math.sin(i / 3) * 1.4,
    }));

    setCachedMarketHistory('FOCUS_TEST', '1h', bars);
    const stock: StockData = {
      symbol: 'FOCUS_TEST',
      name: 'Focus Test Equity',
      price: bars[bars.length - 1].close,
      change: 0.5,
      changePercent: 0.33,
      open: bars[0].open,
      high: 156,
      low: 149,
      volume: 24_000_000,
      prevClose: 150,
      marketCap: '100B',
      peRatio: 20,
      beta: 1.1,
      history: bars,
    };

    const html = renderToStaticMarkup(React.createElement(ChartWidget, { stock }));

    const expectedPanels: ChartPanelId[] = [
      'price',
      'volume',
      'rsi',
      'macd',
      'stoch',
      'cci',
      'adx',
      'atr',
      'obv',
      'roc',
    ];
    for (const panel of expectedPanels) {
      assert.equal(
        html.includes(`data-chart-panel="${panel}" tabindex="-1"`),
        true,
        `Expected panel ${panel} to render focusable wrapper attributes`
      );
    }
  } finally {
    if (prevStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as { localStorage?: Storage }).localStorage = prevStorage;
    }
  }
});

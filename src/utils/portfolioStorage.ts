import type {
  PortfolioAccount,
  PortfolioHolding,
  PortfolioHoldingSource,
  PortfolioRiskThresholds,
  PortfolioStoreState,
} from '../types';
import {
  isValidTickerFormat,
  normalizeTickerSymbol,
  type StorageLike,
} from './equityValidation';

export const PORTFOLIO_STORAGE_KEY = 'quorix_prm_portfolios_v1';
export const PORTFOLIO_THRESHOLDS_STORAGE_KEY = 'quorix_prm_thresholds_v1';

export const DEFAULT_PORTFOLIO_THRESHOLDS: PortfolioRiskThresholds = {
  maxSinglePositionPct: 20,
  minPositionPct: 2,
  maxTop5Pct: 60,
  maxSectorPct: 35,
  highCorrelationThreshold: 0.7,
};

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function createEmptyPortfolioStore(): PortfolioStoreState {
  return {
    version: 1,
    activePortfolioId: null,
    portfolios: [],
  };
}

export function sanitizeHolding(raw: unknown): PortfolioHolding | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  const ticker = normalizeTickerSymbol(h.ticker);
  if (!isValidTickerFormat(ticker)) return null;

  const shares = typeof h.shares === 'number' ? h.shares : Number(h.shares);
  if (!Number.isFinite(shares) || shares <= 0) return null;

  let avgCostBasis: number | null = null;
  if (h.avgCostBasis !== null && h.avgCostBasis !== undefined && h.avgCostBasis !== '') {
    const parsedCost = typeof h.avgCostBasis === 'number' ? h.avgCostBasis : Number(h.avgCostBasis);
    if (Number.isFinite(parsedCost) && parsedCost >= 0) {
      avgCostBasis = parsedCost;
    }
  }

  const rawSource = String(h.source || 'manual');
  const source: PortfolioHoldingSource =
    rawSource === 'csv' || rawSource === 'tracked_watchlist' ? rawSource : 'manual';

  return {
    id: typeof h.id === 'string' && h.id.trim() ? h.id.trim() : generateId('pos'),
    ticker,
    shares,
    avgCostBasis,
    source,
    updatedAt:
      typeof h.updatedAt === 'string' && h.updatedAt.trim()
        ? h.updatedAt
        : new Date().toISOString(),
  };
}

export function deduplicatePortfolioHoldings(holdings: readonly PortfolioHolding[]): PortfolioHolding[] {
  const byTicker = new Map<string, PortfolioHolding>();
  for (const h of holdings) {
    const clean = sanitizeHolding(h);
    if (!clean) continue;
    const existing = byTicker.get(clean.ticker);
    if (!existing) {
      byTicker.set(clean.ticker, clean);
    } else {
      // Combine shares and compute weighted-average cost basis when both have cost basis
      const combinedShares = existing.shares + clean.shares;
      let mergedCost: number | null = existing.avgCostBasis;
      if (existing.avgCostBasis !== null && clean.avgCostBasis !== null && combinedShares > 0) {
        mergedCost =
          (existing.shares * existing.avgCostBasis + clean.shares * clean.avgCostBasis) /
          combinedShares;
      } else if (existing.avgCostBasis === null && clean.avgCostBasis !== null) {
        mergedCost = clean.avgCostBasis;
      }
      byTicker.set(clean.ticker, {
        ...existing,
        shares: combinedShares,
        avgCostBasis: mergedCost,
        updatedAt: clean.updatedAt,
      });
    }
  }
  return Array.from(byTicker.values());
}

export function sanitizePortfolioAccount(raw: unknown): PortfolioAccount | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  if (!name) return null;

  const rawCash = typeof p.cashBalance === 'number' ? p.cashBalance : Number(p.cashBalance ?? 0);
  const cashBalance = Number.isFinite(rawCash) && rawCash >= 0 ? rawCash : 0;

  const rawHoldings = Array.isArray(p.holdings) ? p.holdings : [];
  const validHoldings: PortfolioHolding[] = [];
  for (const item of rawHoldings) {
    const clean = sanitizeHolding(item);
    if (clean) validHoldings.push(clean);
  }

  const now = new Date().toISOString();
  return {
    id: typeof p.id === 'string' && p.id.trim() ? p.id.trim() : generateId('pf'),
    name: name.slice(0, 80),
    cashBalance,
    holdings: deduplicatePortfolioHoldings(validHoldings),
    createdAt: typeof p.createdAt === 'string' && p.createdAt.trim() ? p.createdAt : now,
    updatedAt: typeof p.updatedAt === 'string' && p.updatedAt.trim() ? p.updatedAt : now,
  };
}

export function loadPortfolioStore(
  storage: Pick<StorageLike, 'getItem'> | null | undefined
): PortfolioStoreState {
  if (!storage) return createEmptyPortfolioStore();
  try {
    const raw = storage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) return createEmptyPortfolioStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return createEmptyPortfolioStore();
    const rawPortfolios = Array.isArray((parsed as Record<string, unknown>).portfolios)
      ? ((parsed as Record<string, unknown>).portfolios as unknown[])
      : [];

    const seenIds = new Set<string>();
    const portfolios: PortfolioAccount[] = [];
    for (const item of rawPortfolios) {
      const clean = sanitizePortfolioAccount(item);
      if (clean && !seenIds.has(clean.id)) {
        seenIds.add(clean.id);
        portfolios.push(clean);
      }
    }

    const rawActive =
      typeof (parsed as Record<string, unknown>).activePortfolioId === 'string'
        ? ((parsed as Record<string, unknown>).activePortfolioId as string)
        : null;
    const activePortfolioId =
      rawActive && portfolios.some((p) => p.id === rawActive)
        ? rawActive
        : portfolios[0]?.id ?? null;

    return {
      version: 1,
      activePortfolioId,
      portfolios,
    };
  } catch {
    return createEmptyPortfolioStore();
  }
}

export function savePortfolioStore(
  storage: Pick<StorageLike, 'setItem'> | null | undefined,
  state: PortfolioStoreState
): void {
  if (!storage) return;
  try {
    storage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota / privacy mode errors
  }
}

export function loadPortfolioThresholds(
  storage: Pick<StorageLike, 'getItem'> | null | undefined
): PortfolioRiskThresholds {
  if (!storage) return { ...DEFAULT_PORTFOLIO_THRESHOLDS };
  try {
    const raw = storage.getItem(PORTFOLIO_THRESHOLDS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PORTFOLIO_THRESHOLDS };
    const parsed = JSON.parse(raw) as Partial<PortfolioRiskThresholds>;
    const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    return {
      maxSinglePositionPct: clamp(
        parsed?.maxSinglePositionPct,
        5,
        80,
        DEFAULT_PORTFOLIO_THRESHOLDS.maxSinglePositionPct
      ),
      minPositionPct: clamp(
        parsed?.minPositionPct,
        0.25,
        15,
        DEFAULT_PORTFOLIO_THRESHOLDS.minPositionPct
      ),
      maxTop5Pct: clamp(parsed?.maxTop5Pct, 20, 95, DEFAULT_PORTFOLIO_THRESHOLDS.maxTop5Pct),
      maxSectorPct: clamp(parsed?.maxSectorPct, 10, 80, DEFAULT_PORTFOLIO_THRESHOLDS.maxSectorPct),
      highCorrelationThreshold: clamp(
        parsed?.highCorrelationThreshold,
        0.4,
        0.95,
        DEFAULT_PORTFOLIO_THRESHOLDS.highCorrelationThreshold
      ),
    };
  } catch {
    return { ...DEFAULT_PORTFOLIO_THRESHOLDS };
  }
}

export function savePortfolioThresholds(
  storage: Pick<StorageLike, 'setItem'> | null | undefined,
  thresholds: PortfolioRiskThresholds
): void {
  if (!storage) return;
  try {
    storage.setItem(PORTFOLIO_THRESHOLDS_STORAGE_KEY, JSON.stringify(thresholds));
  } catch {
    // ignore storage errors
  }
}

export function createPortfolioAccount(name: string, cashBalance = 0): PortfolioAccount {
  const now = new Date().toISOString();
  const safeName = name.trim().slice(0, 80) || 'My Portfolio';
  const safeCash = Number.isFinite(cashBalance) && cashBalance >= 0 ? cashBalance : 0;
  return {
    id: generateId('pf'),
    name: safeName,
    cashBalance: safeCash,
    holdings: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function addPortfolioToStore(
  store: PortfolioStoreState,
  name: string,
  cashBalance = 0
): { store: PortfolioStoreState; created: PortfolioAccount } {
  const created = createPortfolioAccount(name, cashBalance);
  return {
    created,
    store: {
      version: 1,
      activePortfolioId: created.id,
      portfolios: [...store.portfolios, created],
    },
  };
}

export function updatePortfolioInStore(
  store: PortfolioStoreState,
  portfolioId: string,
  updater: (portfolio: PortfolioAccount) => PortfolioAccount
): PortfolioStoreState {
  let changed = false;
  const portfolios = store.portfolios.map((p) => {
    if (p.id !== portfolioId) return p;
    changed = true;
    return { ...updater(p), updatedAt: new Date().toISOString() };
  });
  return changed ? { ...store, portfolios } : store;
}

export function deletePortfolioFromStore(
  store: PortfolioStoreState,
  portfolioId: string
): PortfolioStoreState {
  const remaining = store.portfolios.filter((p) => p.id !== portfolioId);
  const nextActive =
    store.activePortfolioId === portfolioId
      ? remaining[0]?.id ?? null
      : store.activePortfolioId;
  return {
    version: 1,
    activePortfolioId: nextActive,
    portfolios: remaining,
  };
}

export interface UpsertHoldingInput {
  ticker: string;
  shares: number;
  avgCostBasis?: number | null;
  source?: PortfolioHoldingSource;
}

/**
 * Adds or updates a holding inside a portfolio while strictly preventing duplicate tickers.
 * - mergeMode 'replace': overwrites shares and cost basis for an existing ticker
 * - mergeMode 'add': adds shares and computes share-weighted average cost basis
 */
export function upsertHoldingInPortfolio(
  portfolio: PortfolioAccount,
  input: UpsertHoldingInput,
  mergeMode: 'replace' | 'add' = 'replace'
): PortfolioAccount {
  const ticker = normalizeTickerSymbol(input.ticker);
  if (!isValidTickerFormat(ticker)) return portfolio;
  if (!Number.isFinite(input.shares) || input.shares <= 0) return portfolio;

  const avgCostBasis =
    input.avgCostBasis !== null &&
    input.avgCostBasis !== undefined &&
    Number.isFinite(input.avgCostBasis) &&
    input.avgCostBasis >= 0
      ? input.avgCostBasis
      : null;

  const now = new Date().toISOString();
  const source: PortfolioHoldingSource = input.source || 'manual';
  const existingIdx = portfolio.holdings.findIndex((h) => h.ticker === ticker);

  if (existingIdx === -1) {
    const newHolding: PortfolioHolding = {
      id: generateId('pos'),
      ticker,
      shares: input.shares,
      avgCostBasis,
      source,
      updatedAt: now,
    };
    return {
      ...portfolio,
      holdings: [...portfolio.holdings, newHolding],
      updatedAt: now,
    };
  }

  const existing = portfolio.holdings[existingIdx];
  let nextShares = input.shares;
  let nextCost = avgCostBasis;

  if (mergeMode === 'add') {
    nextShares = existing.shares + input.shares;
    if (existing.avgCostBasis !== null && avgCostBasis !== null && nextShares > 0) {
      nextCost =
        (existing.shares * existing.avgCostBasis + input.shares * avgCostBasis) / nextShares;
    } else if (avgCostBasis === null) {
      nextCost = existing.avgCostBasis;
    }
  }

  const updatedHoldings = portfolio.holdings.map((h, idx) =>
    idx === existingIdx
      ? {
          ...h,
          shares: nextShares,
          avgCostBasis: nextCost,
          source,
          updatedAt: now,
        }
      : h
  );

  return {
    ...portfolio,
    holdings: updatedHoldings,
    updatedAt: now,
  };
}

export function removeHoldingFromPortfolio(
  portfolio: PortfolioAccount,
  tickerOrId: string
): PortfolioAccount {
  const normalized = normalizeTickerSymbol(tickerOrId);
  const now = new Date().toISOString();
  return {
    ...portfolio,
    holdings: portfolio.holdings.filter(
      (h) => h.id !== tickerOrId && h.ticker !== normalized
    ),
    updatedAt: now,
  };
}

export function setPortfolioCashBalance(
  portfolio: PortfolioAccount,
  cashBalance: number
): PortfolioAccount {
  const safeCash = Number.isFinite(cashBalance) && cashBalance >= 0 ? cashBalance : 0;
  return {
    ...portfolio,
    cashBalance: safeCash,
    updatedAt: new Date().toISOString(),
  };
}

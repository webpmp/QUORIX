import type { PortfolioHolding } from '../types';
import { isValidTickerFormat, normalizeTickerSymbol } from './equityValidation';

export interface ParsedCsvTable {
  headers: string[];
  rows: string[][];
  hasHeaderRow: boolean;
}

export interface CsvColumnMapping {
  tickerCol: number | null;
  sharesCol: number | null;
  costBasisCol: number | null;
  marketValueCol: number | null;
  assetTypeCol: number | null;
}

export type CsvRowStatus = 'valid' | 'cash' | 'duplicate_in_csv' | 'error';

export interface CsvValidatedRow {
  rowIndex: number; // 1-based data row index
  rawTicker: string;
  ticker: string;
  shares: number | null;
  avgCostBasis: number | null;
  cashAmount: number | null;
  status: CsvRowStatus;
  existsInPortfolio: boolean;
  warnings: string[];
  errors: string[];
}

export interface CsvValidationSummary {
  rows: CsvValidatedRow[];
  validHoldings: Array<{
    ticker: string;
    shares: number;
    avgCostBasis: number | null;
    mergedDuplicateCount: number;
    existsInPortfolio: boolean;
  }>;
  detectedCashTotal: number;
  cashRowCount: number;
  validRowCount: number;
  duplicateRowCount: number;
  errorRowCount: number;
  missingCostBasisCount: number;
  existingOverlapTickers: string[];
  globalWarnings: string[];
  globalErrors: string[];
}

const CASH_SYMBOLS = new Set([
  'CASH',
  'USD',
  '$USD',
  'USDOLLAR',
  'SPAXX',
  'VMFXX',
  'SWVXX',
  'FDRXX',
  'FZFXX',
  'SPRXX',
  'CORE',
  'MMF',
  'MONEYMARKET',
  'SETTLEMENT',
]);

/**
 * RFC-4180 compliant CSV parser handling quoted fields, escaped quotes (""),
 * embedded commas, UTF-8 BOM, and CRLF/LF line endings.
 */
export function parseCsvText(rawText: string): ParsedCsvTable {
  const cleaned = rawText.replace(/^\uFEFF/, '');
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && cleaned[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) {
        matrix.push(row);
      }
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) {
    matrix.push(row);
  }

  if (matrix.length === 0) {
    return { headers: [], rows: [], hasHeaderRow: false };
  }

  // Normalize column counts to the widest row
  const maxCols = Math.max(...matrix.map((r) => r.length));
  const padded = matrix.map((r) => {
    if (r.length === maxCols) return r;
    return [...r, ...new Array(maxCols - r.length).fill('')];
  });

  // Detect if first row looks like headers (contains non-numeric text keywords)
  const firstRow = padded[0];
  const headerKeywordRe =
    /(symbol|ticker|security|stock|holding|share|qty|quantity|unit|cost|basis|price|value|cash|type|asset)/i;
  const looksLikeHeader =
    firstRow.some((cell) => headerKeywordRe.test(cell)) ||
    (padded.length > 1 && firstRow.every((cell) => cell === '' || Number.isNaN(Number(cell.replace(/[$,%\s,]/g, '')))));

  if (looksLikeHeader) {
    const headers = firstRow.map((h, idx) => (h.trim() ? h.trim() : `Column ${idx + 1}`));
    return {
      headers,
      rows: padded.slice(1),
      hasHeaderRow: true,
    };
  }

  return {
    headers: firstRow.map((_, idx) => `Column ${idx + 1}`),
    rows: padded,
    hasHeaderRow: false,
  };
}

/**
 * Automatically guesses brokerage CSV column indices from header names.
 */
export function detectCsvColumnMapping(headers: readonly string[]): CsvColumnMapping {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());

  const findCol = (patterns: RegExp[], exclude: Set<number>): number | null => {
    for (const pat of patterns) {
      for (let i = 0; i < norm.length; i++) {
        if (exclude.has(i)) continue;
        if (pat.test(norm[i])) return i;
      }
    }
    return null;
  };

  const used = new Set<number>();

  const tickerCol = findCol(
    [/^ticker$/, /^symbol$/, /\bticker\b/, /\bsymbol\b/, /\bsecurity\b/, /\bholding\b/],
    used
  );
  if (tickerCol !== null) used.add(tickerCol);

  const sharesCol = findCol(
    [/^shares$/, /^quantity$/, /^qty$/, /\bshares\b/, /\bquantity\b/, /\bqty\b/, /\bunits?\b/],
    used
  );
  if (sharesCol !== null) used.add(sharesCol);

  const costBasisCol = findCol(
    [
      /\bavg\b.*\bcost\b/,
      /\baverage\b.*\bcost\b/,
      /\bcost\b.*\bshare\b/,
      /\bcost\s*basis\b/,
      /\bavg\b.*\bprice\b/,
      /\bpurchase\s*price\b/,
      /\bunit\s*cost\b/,
      /\bcost\b/,
    ],
    used
  );
  if (costBasisCol !== null) used.add(costBasisCol);

  const marketValueCol = findCol(
    [/\bmarket\s*value\b/, /\bcurrent\s*value\b/, /\bvalue\b/, /\bbalance\b/, /\bamount\b/],
    used
  );
  if (marketValueCol !== null) used.add(marketValueCol);

  const assetTypeCol = findCol([/\basset\s*type\b/, /\btype\b/, /\bcategory\b/, /\bclass\b/], used);

  return {
    tickerCol,
    sharesCol,
    costBasisCol,
    marketValueCol,
    assetTypeCol,
  };
}

/**
 * Parses a currency or numeric string (e.g. "$1,234.56", "100.5", "(50.00)") into a finite number.
 */
export function parseNumericCell(raw: string | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-' || trimmed === '--' || trimmed.toLowerCase() === 'n/a') {
    return null;
  }
  const isParenNegative = /^\(.*\)$/.test(trimmed);
  const stripped = trimmed.replace(/[()$,%\s]/g, '').replace(/,/g, '');
  if (!stripped) return null;
  const num = Number(stripped);
  if (!Number.isFinite(num)) return null;
  return isParenNegative ? -Math.abs(num) : num;
}

function isCashRow(rawTicker: string, assetType: string): boolean {
  const sym = rawTicker.toUpperCase().replace(/[^A-Z0-9$]/g, '');
  const typeNorm = assetType.toUpperCase();
  if (typeNorm.includes('CASH') || typeNorm.includes('MONEY MARKET')) return true;
  if (CASH_SYMBOLS.has(sym)) return true;
  if (/^CASH\b/i.test(rawTicker.trim()) || /\bCASH\s+BALANCE\b/i.test(rawTicker.trim())) return true;
  return false;
}

export interface ValidateCsvOptions {
  duplicateStrategy?: 'merge' | 'skip';
  existingHoldings?: readonly PortfolioHolding[];
  verifiedInvalidTickers?: ReadonlySet<string>;
}

/**
 * Validates mapped CSV rows, detecting invalid tickers, missing/invalid share counts,
 * duplicate tickers within the CSV, overlaps with existing portfolio holdings, cash rows,
 * and missing optional cost basis warnings.
 */
export function validateCsvImportRows(
  rows: readonly string[][],
  mapping: CsvColumnMapping,
  options: ValidateCsvOptions = {}
): CsvValidationSummary {
  const duplicateStrategy = options.duplicateStrategy || 'merge';
  const existingSet = new Set(
    (options.existingHoldings || []).map((h) => normalizeTickerSymbol(h.ticker))
  );
  const verifiedInvalid = options.verifiedInvalidTickers || new Set<string>();

  const globalWarnings: string[] = [];
  const globalErrors: string[] = [];

  if (mapping.tickerCol === null) {
    globalErrors.push('Map a Ticker / Symbol column before importing.');
  }
  if (mapping.sharesCol === null) {
    globalErrors.push('Map a Shares / Quantity column before importing.');
  }
  if (rows.length === 0) {
    globalErrors.push('CSV file contains no data rows to import.');
  }
  if (mapping.costBasisCol === null && rows.length > 0) {
    globalWarnings.push('No Cost Basis column mapped — unrealized gain/loss will remain unavailable for imported holdings.');
  }

  const validatedRows: CsvValidatedRow[] = [];
  const seenInCsv = new Map<
    string,
    { ticker: string; shares: number; avgCostBasis: number | null; mergedDuplicateCount: number; existsInPortfolio: boolean }
  >();
  let detectedCashTotal = 0;
  let cashRowCount = 0;
  let validRowCount = 0;
  let duplicateRowCount = 0;
  let errorRowCount = 0;
  let missingCostBasisCount = 0;
  const existingOverlapSet = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !c || !c.trim())) continue;

    const rawTicker = mapping.tickerCol !== null ? (r[mapping.tickerCol] || '').trim() : '';
    const rawShares = mapping.sharesCol !== null ? (r[mapping.sharesCol] || '').trim() : '';
    const rawCost = mapping.costBasisCol !== null ? (r[mapping.costBasisCol] || '').trim() : '';
    const rawValue = mapping.marketValueCol !== null ? (r[mapping.marketValueCol] || '').trim() : '';
    const rawType = mapping.assetTypeCol !== null ? (r[mapping.assetTypeCol] || '').trim() : '';

    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    if (isCashRow(rawTicker, rawType)) {
      const cashAmt = parseNumericCell(rawValue) ?? parseNumericCell(rawShares);
      if (cashAmt === null || cashAmt < 0) {
        errorRowCount++;
        validatedRows.push({
          rowIndex: i + 1,
          rawTicker,
          ticker: 'CASH',
          shares: null,
          avgCostBasis: null,
          cashAmount: null,
          status: 'error',
          existsInPortfolio: false,
          warnings: [],
          errors: ['Cash row is missing a valid non-negative cash amount.'],
        });
      } else {
        cashRowCount++;
        detectedCashTotal += cashAmt;
        validatedRows.push({
          rowIndex: i + 1,
          rawTicker,
          ticker: 'CASH',
          shares: null,
          avgCostBasis: null,
          cashAmount: cashAmt,
          status: 'cash',
          existsInPortfolio: false,
          warnings: ['Will be added to portfolio cash position.'],
          errors: [],
        });
      }
      continue;
    }

    const ticker = normalizeTickerSymbol(rawTicker.replace(/^\$/, ''));
    if (!ticker) {
      rowErrors.push('Missing ticker symbol.');
    } else if (!isValidTickerFormat(ticker)) {
      rowErrors.push(`Invalid ticker format "${rawTicker}".`);
    } else if (verifiedInvalid.has(ticker)) {
      rowErrors.push(`Ticker "${ticker}" could not be verified as a valid market security.`);
    }

    const shares = parseNumericCell(rawShares);
    if (shares === null || shares <= 0) {
      rowErrors.push('Shares must be a positive number.');
    }

    let avgCostBasis: number | null = null;
    if (mapping.costBasisCol !== null) {
      if (rawCost) {
        const parsedCost = parseNumericCell(rawCost);
        if (parsedCost === null || parsedCost < 0) {
          rowWarnings.push(`Unparseable cost basis "${rawCost}" ignored.`);
        } else {
          avgCostBasis = parsedCost;
        }
      } else {
        missingCostBasisCount++;
        rowWarnings.push('Missing cost basis (optional).');
      }
    }

    const existsInPortfolio = Boolean(ticker && existingSet.has(ticker));
    if (existsInPortfolio && rowErrors.length === 0) {
      existingOverlapSet.add(ticker);
      rowWarnings.push('Already exists in selected portfolio.');
    }

    if (rowErrors.length > 0 || shares === null) {
      errorRowCount++;
      validatedRows.push({
        rowIndex: i + 1,
        rawTicker,
        ticker,
        shares,
        avgCostBasis,
        cashAmount: null,
        status: 'error',
        existsInPortfolio,
        warnings: rowWarnings,
        errors: rowErrors,
      });
      continue;
    }

    const existingCsvEntry = seenInCsv.get(ticker);
    if (existingCsvEntry) {
      duplicateRowCount++;
      if (duplicateStrategy === 'merge') {
        const nextShares = existingCsvEntry.shares + shares;
        let nextCost = existingCsvEntry.avgCostBasis;
        if (existingCsvEntry.avgCostBasis !== null && avgCostBasis !== null && nextShares > 0) {
          nextCost =
            (existingCsvEntry.shares * existingCsvEntry.avgCostBasis + shares * avgCostBasis) /
            nextShares;
        } else if (existingCsvEntry.avgCostBasis === null && avgCostBasis !== null) {
          nextCost = avgCostBasis;
        }
        existingCsvEntry.shares = nextShares;
        existingCsvEntry.avgCostBasis = nextCost;
        existingCsvEntry.mergedDuplicateCount += 1;
        rowWarnings.push(`Duplicate ticker in CSV — shares will be merged into ${ticker}.`);
      } else {
        rowWarnings.push(`Duplicate ticker in CSV — row will be skipped.`);
      }

      validatedRows.push({
        rowIndex: i + 1,
        rawTicker,
        ticker,
        shares,
        avgCostBasis,
        cashAmount: null,
        status: 'duplicate_in_csv',
        existsInPortfolio,
        warnings: rowWarnings,
        errors: [],
      });
      continue;
    }

    validRowCount++;
    seenInCsv.set(ticker, {
      ticker,
      shares,
      avgCostBasis,
      mergedDuplicateCount: 0,
      existsInPortfolio,
    });

    validatedRows.push({
      rowIndex: i + 1,
      rawTicker,
      ticker,
      shares,
      avgCostBasis,
      cashAmount: null,
      status: 'valid',
      existsInPortfolio,
      warnings: rowWarnings,
      errors: [],
    });
  }

  if (duplicateRowCount > 0) {
    globalWarnings.push(
      `${duplicateRowCount} duplicate ticker row${duplicateRowCount === 1 ? '' : 's'} detected in CSV (${
        duplicateStrategy === 'merge' ? 'merging share quantities' : 'skipping duplicates'
      }).`
    );
  }
  if (existingOverlapSet.size > 0) {
    globalWarnings.push(
      `${existingOverlapSet.size} ticker${existingOverlapSet.size === 1 ? '' : 's'} already exist in the active portfolio.`
    );
  }
  if (errorRowCount > 0) {
    globalWarnings.push(
      `${errorRowCount} invalid row${errorRowCount === 1 ? '' : 's'} will be excluded from import.`
    );
  }

  return {
    rows: validatedRows,
    validHoldings: Array.from(seenInCsv.values()),
    detectedCashTotal,
    cashRowCount,
    validRowCount,
    duplicateRowCount,
    errorRowCount,
    missingCostBasisCount,
    existingOverlapTickers: Array.from(existingOverlapSet),
    globalWarnings,
    globalErrors,
  };
}

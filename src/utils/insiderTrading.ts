import type { InsiderTradingRecord, InsiderTransactionCategory } from '../types';

/**
 * Documented 3spread `/v1/insiders` filing-summary shape (`InsiderFilingSummary`).
 */
export interface ThreeSpreadInsiderFilingSummary {
  filing_id: string;
  cik?: string | null;
  form_type?: string | null;
  period_of_report?: string | null;
  accepted_time?: string | null;
  is_valid?: boolean | null;
  is_amendment?: boolean | null;
  filer_name?: string | null;
  issuer_cik?: string | null;
  issuer_name?: string | null;
  issuer_trading_symbol?: string | null;
  accession_num?: string | null;
  source_url?: string | null;
  rpt_owner_cik?: string | null;
}

/**
 * Documented 3spread `/v1/insiders/transactions` row shape (`InsiderTransactionRow`).
 */
export interface ThreeSpreadInsiderTransactionRow {
  transaction_kind?: string | null;
  filing_id: string;
  record_index: number;
  issuer_cik?: string | null;
  issuer_trading_symbol?: string | null;
  security_title?: string | null;
  transaction_date?: string | null;
  transaction_code?: string | null;
  transaction_acquired_disposed_code?: string | null;
  transaction_shares?: string | number | null;
  transaction_price_per_share?: string | number | null;
  transaction_total_value?: string | number | null;
  shares_owned_following_transaction?: string | number | null;
  direct_or_indirect_ownership?: string | null;
  filer_name?: string | null;
  filer_cik?: string[] | null;
}

/**
 * Official SEC Section 16 (Form 4/5) transaction code definitions.
 * Classifications strictly follow documented SEC code meanings without guesswork.
 */
export const SEC_TRANSACTION_CODE_INFO: Record<
  string,
  { label: string; category: InsiderTransactionCategory }
> = {
  P: { label: 'Purchase', category: 'purchase' },
  S: { label: 'Sale', category: 'sale' },
  A: { label: 'Grant / Award', category: 'grant' },
  D: { label: 'Disposition to Issuer', category: 'disposition' },
  F: { label: 'Tax Withholding', category: 'tax' },
  G: { label: 'Gift', category: 'gift' },
  M: { label: 'Option Exercise', category: 'exercise' },
  C: { label: 'Conversion', category: 'exercise' },
  X: { label: 'Derivative Exercise', category: 'exercise' },
  E: { label: 'Expiration (Short)', category: 'other' },
  H: { label: 'Expiration (Long)', category: 'other' },
  I: { label: 'Discretionary Trade', category: 'other' },
  J: { label: 'Other Acq./Disp.', category: 'other' },
  K: { label: 'Equity Swap', category: 'other' },
  L: { label: 'Small Acquisition', category: 'purchase' },
  U: { label: 'Tender of Shares', category: 'disposition' },
  W: { label: 'Will / Descent', category: 'other' },
  Z: { label: 'Voting Trust', category: 'other' },
};

export function classifyInsiderTransaction(
  rawCode: string | null | undefined,
  acquiredDisposed?: string | null
): {
  code: string | null;
  label: string;
  category: InsiderTransactionCategory;
} {
  const code =
    typeof rawCode === 'string' && rawCode.trim()
      ? rawCode.trim().toUpperCase().slice(0, 4)
      : null;

  if (code && SEC_TRANSACTION_CODE_INFO[code]) {
    return {
      code,
      label: SEC_TRANSACTION_CODE_INFO[code].label,
      category: SEC_TRANSACTION_CODE_INFO[code].category,
    };
  }

  if (code) {
    return {
      code,
      label: `Code ${code}`,
      category: 'other',
    };
  }

  const ad =
    typeof acquiredDisposed === 'string' ? acquiredDisposed.trim().toUpperCase() : '';
  if (ad === 'A') {
    return { code: null, label: 'Acquisition', category: 'other' };
  }
  if (ad === 'D') {
    return { code: null, label: 'Disposition', category: 'other' };
  }

  return { code: null, label: 'Filing Reported', category: 'other' };
}

/**
 * Validates an API-provided SEC `source_url` to allow only safe http(s) links.
 * Never fabricates or constructs SEC URLs manually.
 */
export function sanitizeSecSourceUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function parseOptionalNumeric(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

export function extractIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * Joins 3spread `/v1/insiders/transactions` rows with `/v1/insiders` filing metadata
 * (providing `form_type`, `accepted_time`, `accession_num`, and `source_url`) by `filing_id`.
 * Falls back cleanly to filing-summary records if no transaction rows exist in the window.
 */
export function mergeInsiderTransactionsWithFilings(
  transactions: ThreeSpreadInsiderTransactionRow[],
  filings: ThreeSpreadInsiderFilingSummary[]
): {
  records: InsiderTradingRecord[];
  issuerName: string | null;
  dataMode: 'transactions' | 'filings';
} {
  const filingById = new Map<string, ThreeSpreadInsiderFilingSummary>();
  let issuerName: string | null = null;

  for (const filing of filings) {
    if (!filing || typeof filing.filing_id !== 'string' || !filing.filing_id.trim()) continue;
    filingById.set(filing.filing_id, filing);
    if (!issuerName && typeof filing.issuer_name === 'string' && filing.issuer_name.trim()) {
      issuerName = filing.issuer_name.trim();
    }
  }

  if (transactions.length > 0) {
    // Also index filings by accession suffix so dual-CIK copies still resolve form_type & source_url
    const filingByAccession = new Map<string, ThreeSpreadInsiderFilingSummary>();
    for (const filing of filings) {
      if (!filing || typeof filing.filing_id !== 'string') continue;
      const acc =
        (typeof filing.accession_num === 'string' && filing.accession_num.trim()) ||
        (filing.filing_id.includes('_') ? filing.filing_id.split('_').slice(1).join('_') : '');
      if (acc && !filingByAccession.has(acc)) {
        filingByAccession.set(acc, filing);
      }
    }

    const deduped = new Map<string, InsiderTradingRecord>();

    transactions.forEach((tx, idx) => {
      const accessionFromId = tx.filing_id.includes('_')
        ? tx.filing_id.split('_').slice(1).join('_')
        : '';
      const filing =
        filingById.get(tx.filing_id) ||
        (accessionFromId ? filingByAccession.get(accessionFromId) : undefined);

      const adRaw =
        typeof tx.transaction_acquired_disposed_code === 'string'
          ? tx.transaction_acquired_disposed_code.trim().toUpperCase()
          : '';
      const acquiredDisposed: 'A' | 'D' | null = adRaw === 'A' || adRaw === 'D' ? adRaw : null;

      const diRaw =
        typeof tx.direct_or_indirect_ownership === 'string'
          ? tx.direct_or_indirect_ownership.trim().toUpperCase()
          : '';
      const directOrIndirect: 'D' | 'I' | null = diRaw === 'D' || diRaw === 'I' ? diRaw : null;

      const classification = classifyInsiderTransaction(tx.transaction_code, acquiredDisposed);
      const shares = parseOptionalNumeric(tx.transaction_shares);
      const price = parseOptionalNumeric(tx.transaction_price_per_share);
      const rawTotal = parseOptionalNumeric(tx.transaction_total_value);
      const totalValue =
        rawTotal !== null
          ? rawTotal
          : shares !== null && price !== null && shares > 0 && price > 0
          ? shares * price
          : null;

      const txDate =
        extractIsoDate(tx.transaction_date) ||
        extractIsoDate(filing?.period_of_report) ||
        extractIsoDate(filing?.accepted_time);
      const filingDate = extractIsoDate(filing?.accepted_time) || extractIsoDate(filing?.period_of_report);
      const insiderName =
        (typeof tx.filer_name === 'string' && tx.filer_name.trim()) ||
        (typeof filing?.filer_name === 'string' && filing.filer_name.trim()) ||
        'Reporting Owner Unavailable';

      const accessionNum =
        (typeof filing?.accession_num === 'string' && filing.accession_num.trim()) ||
        (accessionFromId || null);
      const recordIndex = typeof tx.record_index === 'number' ? tx.record_index : idx;

      const record: InsiderTradingRecord = {
        id: `${tx.filing_id}:${recordIndex}`,
        filingId: tx.filing_id,
        recordIndex,
        date: txDate,
        filingDate,
        insiderName,
        transactionCode: classification.code,
        transactionLabel: classification.label,
        transactionCategory: classification.category,
        acquiredDisposed,
        securityTitle:
          typeof tx.security_title === 'string' && tx.security_title.trim()
            ? tx.security_title.trim()
            : null,
        shares,
        price,
        totalValue,
        sharesFollowing: parseOptionalNumeric(tx.shares_owned_following_transaction),
        directOrIndirect,
        formType:
          typeof filing?.form_type === 'string' && filing.form_type.trim()
            ? filing.form_type.trim()
            : null,
        accessionNum,
        sourceUrl: sanitizeSecSourceUrl(filing?.source_url),
        isAmendment: Boolean(filing?.is_amendment),
      };

      // Deduplicate dual-CIK EDGAR copies sharing the same accession number & row index
      const dedupeKey = `${accessionNum || tx.filing_id}:${recordIndex}`;
      const existing = deduped.get(dedupeKey);
      if (!existing || (!existing.sourceUrl && record.sourceUrl)) {
        deduped.set(dedupeKey, record);
      }
    });

    const records = Array.from(deduped.values());

    // Sort newest transaction date first, then filing date descending, then record index ascending
    records.sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      const filingCmp = (b.filingDate || '').localeCompare(a.filingDate || '');
      if (filingCmp !== 0) return filingCmp;
      return a.recordIndex - b.recordIndex;
    });

    return { records, issuerName, dataMode: 'transactions' };
  }

  // Filing-only fallback when a company has Form 3/4/5 filings but no non-derivative rows in window
  const filingRecords: InsiderTradingRecord[] = filings
    .filter((f) => f && typeof f.filing_id === 'string' && f.filing_id.trim())
    .map((filing, idx) => {
      const formType =
        typeof filing.form_type === 'string' && filing.form_type.trim()
          ? filing.form_type.trim()
          : null;
      return {
        id: `${filing.filing_id}:filing:${idx}`,
        filingId: filing.filing_id,
        recordIndex: idx,
        date: extractIsoDate(filing.period_of_report) || extractIsoDate(filing.accepted_time),
        filingDate: extractIsoDate(filing.accepted_time),
        insiderName:
          typeof filing.filer_name === 'string' && filing.filer_name.trim()
            ? filing.filer_name.trim()
            : 'Reporting Owner Unavailable',
        transactionCode: null,
        transactionLabel: formType ? `Form ${formType} Filing` : 'SEC Filing',
        transactionCategory: 'other',
        acquiredDisposed: null,
        securityTitle: null,
        shares: null,
        price: null,
        totalValue: null,
        sharesFollowing: null,
        directOrIndirect: null,
        formType,
        accessionNum:
          typeof filing.accession_num === 'string' && filing.accession_num.trim()
            ? filing.accession_num.trim()
            : null,
        sourceUrl: sanitizeSecSourceUrl(filing.source_url),
        isAmendment: Boolean(filing.is_amendment),
      };
    });

  return { records: filingRecords, issuerName, dataMode: 'filings' };
}

export function formatInsiderShares(shares: number | null): string {
  if (shares === null || !Number.isFinite(shares)) return '—';
  const abs = Math.abs(shares);
  const isWhole = Math.abs(abs - Math.round(abs)) < 1e-4;
  return shares.toLocaleString('en-US', {
    maximumFractionDigits: isWhole ? 0 : 2,
  });
}

export function formatInsiderPrice(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return '—';
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatInsiderValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  return `${sign}$${abs.toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })}`;
}

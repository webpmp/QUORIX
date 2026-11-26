import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  CongressAssetGroup,
  CongressOwnerType,
  CongressParty,
  CongressStatusResponse,
  CongressTradeRecord,
  CongressTradesResponse,
  CongressTxType,
} from '../types';

// Constants and Politeness Rules
const HOUSE_DISCLOSURES_BASE = 'https://disclosures-clerk.house.gov/public_disc';
const USER_AGENT = 'QUORIX-InstitutionalActivityMonitor/1.0 (Research Spike; contact: admin@quorix.local)';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB max per PDF
const MAX_ZIP_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB max per index ZIP
const THROTTLE_DELAY_MS = 1000; // ~1 request per second
const COOLDOWN_DURATION_MS = 300_000; // 5 min cooldown on 429/403
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6-hour TTL

const CACHE_DIR = path.resolve(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'congress-trades.json');

// Asset Types that represent listed securities eligible for ticker extraction
const LISTED_EQUITY_CODES = new Set(['ST', 'OP', 'OT']); // Stocks, Options, Other (ETFs)

interface StoredCacheData {
  lastUpdated: string | null;
  lastIndexCheck: string | null;
  processedDocIds: Record<string, 'parsed' | 'scanned' | 'failed'>;
  trades: CongressTradeRecord[];
  scannedFilings: Array<{
    docId: string;
    year: string;
    politicianName: string;
    stateDistrict: string;
    filingDate: string;
    filingUrl: string;
  }>;
  totalAFilingsIgnored: number;
}

interface RawHouseMemberRecord {
  DocID: string | number;
  FilingDate: string;
  FilingType: string;
  Prefix?: string;
  First?: string;
  Last?: string;
  Suffix?: string;
  StateDst?: string;
  Year?: string | number;
}

interface LegislatorEntry {
  bioguide: string;
  first: string;
  last: string;
  official_full: string;
  party: string;
  state: string;
  district: number;
  districts?: Array<[string, number]>;
}

interface LegislatorsDataset {
  _source: string;
  _license: string;
  _date: string;
  legislators: LegislatorEntry[];
}

// In-memory runtime state
let isBackfillRunning = false;
let upstreamCooldownUntil = 0;
let lastIndexCheckAttempt = 0; // Timestamp of last index fetch attempt for rate limiting
const MIN_INDEX_CHECK_INTERVAL_MS = 60_000; // Minimum 60s between upstream House Clerk index checks

let backfillProgressState = {
  processedFilings: 0,
  totalFilings: 0,
  percentComplete: 0,
};

let cachedData: StoredCacheData = {
  lastUpdated: null,
  lastIndexCheck: null,
  processedDocIds: {},
  trades: [],
  scannedFilings: [],
  totalAFilingsIgnored: 0,
};

// Legislators lookup map
let legislatorsDataset: LegislatorsDataset | null = null;
const legislatorLookup = new Map<string, LegislatorEntry>();

function loadLegislators() {
  if (legislatorLookup.size > 0) return;
  try {
    const jsonPath = path.resolve(process.cwd(), 'src/data/legislators-house-trimmed.json');
    if (fs.existsSync(jsonPath)) {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      legislatorsDataset = JSON.parse(raw);
      if (legislatorsDataset && Array.isArray(legislatorsDataset.legislators)) {
        for (const leg of legislatorsDataset.legislators) {
          const normLast = normalizeName(leg.last);
          // Key by state + district + normLast
          const key = `${leg.state}-${leg.district}-${normLast}`;
          legislatorLookup.set(key, leg);
          if (Array.isArray(leg.districts)) {
            for (const [st, dst] of leg.districts) {
              legislatorLookup.set(`${st}-${dst}-${normLast}`, leg);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[CongressionalTradingService] Could not load legislators dataset:', err);
  }
}

export function cleanPoliticianName(raw: string): string {
  let s = (raw || '').trim();
  s = s.replace(/^(Hon\.|Rep\.|Sen\.)\s+/i, '');
  s = s.replace(/,?\s+(Jr\.?|Sr\.?|II|III|IV)$/i, '');
  return s.trim();
}

export function normalizeName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export function matchLegislator(
  stateDst: string,
  rawName: string
): { bioguideId?: string; party: CongressParty; fullName?: string; district: number } {
  loadLegislators();
  const st = (stateDst || '').slice(0, 2).toUpperCase();
  const rawDst = (stateDst || '').slice(2);
  const district = parseInt(rawDst, 10) || 0;

  const cleaned = cleanPoliticianName(rawName);
  const normFull = normalizeName(cleaned);

  // 1. Exact match on ST-DISTRICT-FULLNAME
  const hitFull = legislatorLookup.get(`${st}-${district}-${normFull}`);
  if (hitFull) {
    return {
      bioguideId: hitFull.bioguide,
      party: mapParty(hitFull.party),
      fullName: hitFull.official_full,
      district,
    };
  }

  // 2. Multi-token split: check last token and last two tokens (e.g. Wasserman Schultz, Van Epps)
  const tokens = cleaned.split(/\s+/);
  const lastToken = tokens[tokens.length - 1] || '';
  const normLast = normalizeName(lastToken);

  const hitLast = legislatorLookup.get(`${st}-${district}-${normLast}`);
  if (hitLast) {
    return {
      bioguideId: hitLast.bioguide,
      party: mapParty(hitLast.party),
      fullName: hitLast.official_full,
      district,
    };
  }

  if (tokens.length >= 2) {
    const lastTwo = tokens.slice(-2).join(' ');
    const hitTwo = legislatorLookup.get(`${st}-${district}-${normalizeName(lastTwo)}`);
    if (hitTwo) {
      return {
        bioguideId: hitTwo.bioguide,
        party: mapParty(hitTwo.party),
        fullName: hitTwo.official_full,
        district,
      };
    }
  }

  // 3. Fallback: match by state and last name across legislators if only 1 match
  if (legislatorsDataset && Array.isArray(legislatorsDataset.legislators)) {
    const candidates = legislatorsDataset.legislators.filter(
      (l) => l.state === st && (normalizeName(l.last) === normLast || normalizeName(l.last) === normFull)
    );
    if (candidates.length === 1) {
      const c = candidates[0];
      return {
        bioguideId: c.bioguide,
        party: mapParty(c.party),
        fullName: c.official_full,
        district: c.district,
      };
    }
  }

  return { party: 'Unknown', district };
}

function mapParty(rawParty: string): CongressParty {
  const p = (rawParty || '').toLowerCase();
  if (p.includes('democrat')) return 'Democrat';
  if (p.includes('republican')) return 'Republican';
  if (p.includes('independent')) return 'Independent';
  return 'Unknown';
}

function parseAmountBounds(amtStr: string): { min: number; max: number; isExact: boolean } {
  if (!amtStr) return { min: 0, max: 0, isExact: false };
  const clean = amtStr.replace(/[$,]/g, '').trim();
  if (clean.includes('-')) {
    const parts = clean.split('-').map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
    if (parts.length === 2) return { min: parts[0], max: parts[1], isExact: false };
    if (parts.length === 1) return { min: parts[0], max: parts[0], isExact: false };
  }
  const single = parseFloat(clean);
  if (!isNaN(single)) return { min: single, max: single, isExact: true };
  return { min: 0, max: 0, isExact: false };
}

export function toIsoDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.trim().split('/');
  if (parts.length === 3) {
    const [m, d, y] = parts;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return dateStr.trim();
}

function mapTxType(raw: string): { type: CongressTxType; raw: string } {
  const norm = (raw || '').trim().toUpperCase();
  if (norm.startsWith('P')) return { type: 'BUY', raw: (raw || '').trim() || 'P' };
  if (norm.startsWith('S')) return { type: 'SELL', raw: (raw || '').trim() || 'S' };
  if (norm.startsWith('E')) return { type: 'EXCHANGE', raw: (raw || '').trim() || 'E' };
  return { type: 'OTHER', raw: 'Unknown' };
}

function mapOwner(raw: string): CongressOwnerType {
  const norm = (raw || '').trim().toUpperCase();
  if (norm === 'SP') return 'spouse';
  if (norm === 'JT') return 'joint';
  if (norm === 'DC') return 'dependent';
  if (norm === 'SELF') return 'self';
  return 'self';
}

export function loadCacheFromDisk(): StoredCacheData {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as StoredCacheData;
      if (parsed && Array.isArray(parsed.trades)) {
        cachedData = parsed;
        return cachedData;
      }
    }
  } catch (err) {
    console.warn('[CongressionalTradingService] Failed to read disk cache:', err);
  }
  return cachedData;
}

export function writeCacheToDisk(data: StoredCacheData): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const tempFile = path.join(CACHE_DIR, `congress-trades-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    fs.writeFileSync(tempFile, JSON.stringify(data), 'utf-8');
    fs.renameSync(tempFile, CACHE_FILE);
  } catch (err) {
    console.error('[CongressionalTradingService] Failed to write cache atomically:', err);
  }
}

// Fetch helper with User-Agent, timeout, and response size guards
async function fetchWithPoliteness(url: string, maxBytes: number): Promise<Buffer | null> {
  const now = Date.now();
  if (now < upstreamCooldownUntil) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 429 || res.status === 403) {
      console.warn(`[CongressionalTradingService] Upstream returned status ${res.status}. Entering 5-min cooldown.`);
      upstreamCooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLength > maxBytes) {
      console.warn(`[CongressionalTradingService] File exceeded max size: ${url} (${contentLength} > ${maxBytes})`);
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > maxBytes) {
      return null;
    }

    return Buffer.from(arrayBuf);
  } catch (err) {
    clearTimeout(timeout);
    return null;
  }
}

// Coordinate-based PDF table extractor using pdfjs-dist
export async function extractTradesFromPdfBuffer(
  pdfBuffer: Buffer,
  docId: string,
  year: string,
  memberMeta: { name: string; stateDst: string; filingDate: string }
): Promise<{
  isScanned: boolean;
  trades: CongressTradeRecord[];
}> {
  const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
  const uint8 = new Uint8Array(pdfBuffer);
  let doc: pdfjsLib.PDFDocumentProxy;

  try {
    doc = await pdfjsLib.getDocument({ data: uint8 }).promise;
  } catch (err) {
    return { isScanned: false, trades: [] };
  }

  let totalItems = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    totalItems += content.items.filter((it: any) => it.str && it.str.trim().length > 0).length;
  }

  // Scanned detection: fewer than 15 text elements across entire PDF
  if (totalItems < 15) {
    return { isScanned: true, trades: [] };
  }

  const trades: CongressTradeRecord[] = [];
  const legislator = matchLegislator(memberMeta.stateDst, memberMeta.name);

  interface PartialRow {
    txDateStr: string;
    internalTxId?: string;
    owner: string;
    txType: string;
    notifDate: string;
    assetHeaderTokens: string[];
    metaTokens: string[];
    amountTokens: string[];
    pageNum: number;
    rowIndex: number;
  }

  let pendingSplitRow: PartialRow | null = null;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = (content.items as any[]).filter((it) => it.str && it.str.trim().length > 0);

    let xOwner = 65.0;
    let xAsset = 104.0;
    let xTxType = 262.0;
    let xTxDate = 326.0;
    let xNotifDate = 382.0;
    let xAmount = 446.0;
    let xCapGains = 525.0;

    let headerBottomY = 0;
    let tableBottomY = 0;

    for (const it of items) {
      const s = it.str.trim();
      const x = it.transform[4];
      const y = it.transform[5];
      if (s === 'Owner') xOwner = x;
      if (s === 'Asset') {
        xAsset = x;
        headerBottomY = y;
      }
      if (s === 'Transaction') xTxType = x;
      if (s === 'Date' && x > 300 && x < 360) xTxDate = x;
      if (s === 'Notification') xNotifDate = x;
      if (s === 'Amount') xAmount = x;
      if (s === 'Cap.') xCapGains = x;

      if (
        s.startsWith('* For the complete') ||
        s.startsWith('INITIAL') ||
        s.startsWith('I CERTIFY') ||
        s.startsWith('Digitally Signed')
      ) {
        if (tableBottomY === 0 || y > tableBottomY) {
          tableBottomY = y;
        }
      }
    }

    const colOwnerBound = (xOwner + xAsset) / 2;
    const colAssetBound = (xAsset + xTxType) / 2;
    const colTxTypeBound = (xTxType + xTxDate) / 2;
    const colTxDateBound = (xTxDate + xNotifDate) / 2;
    const colNotifDateBound = (xNotifDate + xAmount) / 2;
    const colAmountBound = (xAmount + xCapGains) / 2;

    const pageBottomLimit = tableBottomY > 0 ? tableBottomY : 30;

    // Filter items: strip out anything below tableBottomY or certification/signature markers
    const validItems = items.filter((it) => {
      const y = it.transform[5];
      const s = it.str.trim();
      if (tableBottomY > 0 && y <= tableBottomY) return false;
      if (s.startsWith('Filing ID #')) return false;
      if (s.startsWith('* For the complete')) return false;
      if (s.startsWith('INITIAL')) return false;
      if (s.startsWith('I CERTIFY')) return false;
      if (s.startsWith('Digitally Signed')) return false;
      if (s.includes('Hon.') && (y < 300 || s.includes(','))) return false;
      return true;
    });

    const txDates = validItems
      .filter((it) => dateRegex.test(it.str.trim()) && it.transform[4] >= colTxTypeBound && it.transform[4] < colTxDateBound)
      .sort((a, b) => b.transform[5] - a.transform[5]);

    // If there was a split row carried over from the previous page, pick up continuation tokens at the top of the new page
    if (pendingSplitRow) {
      const firstDateY = txDates.length > 0 ? txDates[0].transform[5] + 20 : pageBottomLimit;
      const continuationItems = validItems.filter((it) => {
        const y = it.transform[5];
        return y < headerBottomY - 10 && y >= firstDateY;
      });
      continuationItems.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);

      for (const it of continuationItems) {
        const x = it.transform[4];
        const s = it.str.trim();
        if (['ID', 'Owner', 'Asset', 'Transaction', 'Type', 'Date', 'Notification', 'Amount', 'Cap.', 'Gains >', '$200?'].includes(s)) {
          continue;
        }
        if (x >= colNotifDateBound && x < colAmountBound) {
          pendingSplitRow.amountTokens.push(s);
        } else if (x >= colOwnerBound && x < colAssetBound) {
          pendingSplitRow.metaTokens.push(s);
        }
      }

      finalizeParsedRow(pendingSplitRow, trades, docId, year, memberMeta, legislator);
      pendingSplitRow = null;
    }

    for (let i = 0; i < txDates.length; i++) {
      const curDate = txDates[i];
      const curY = curDate.transform[5];

      const topY = curY + 20;
      let bottomY = pageBottomLimit;
      const isLastOnPage = i === txDates.length - 1;
      if (!isLastOnPage) {
        bottomY = txDates[i + 1].transform[5] + 8;
      }

      const txItems = validItems.filter((it) => it.transform[5] <= topY && it.transform[5] >= bottomY);
      txItems.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);

      const row: PartialRow = {
        txDateStr: curDate.str.trim(),
        internalTxId: undefined,
        owner: '',
        txType: '',
        notifDate: '',
        assetHeaderTokens: [],
        metaTokens: [],
        amountTokens: [],
        pageNum,
        rowIndex: i + 1,
      };

      for (const it of txItems) {
        const x = it.transform[4];
        const s = it.str.trim();
        if (['ID', 'Owner', 'Asset', 'Transaction', 'Type', 'Date', 'Notification', 'Amount', 'Cap.', 'Gains >', '$200?'].includes(s)) {
          continue;
        }

        if (x < xOwner && /^\d+$/.test(s)) {
          row.internalTxId = s;
        } else if (x >= xOwner - 10 && x < colOwnerBound) {
          row.owner = (row.owner + ' ' + s).trim();
        } else if (x >= colOwnerBound && x < colAssetBound) {
          row.assetHeaderTokens.push(s);
        } else if (x >= colAssetBound && x < colTxTypeBound) {
          row.txType = (row.txType + ' ' + s).trim();
        } else if (x >= colTxDateBound && x < colNotifDateBound) {
          if (dateRegex.test(s)) row.notifDate = s;
        } else if (x >= colNotifDateBound && x < colAmountBound) {
          row.amountTokens.push(s);
        }
      }

      const isPageBoundary = isLastOnPage && pageNum < doc.numPages;
      const currentAmt = row.amountTokens.join(' ');
      const hasUnclosedAmt = currentAmt.trim().endsWith('-');
      const hasCode = row.assetHeaderTokens.join(' ').includes('[');

      if (isPageBoundary && (hasUnclosedAmt || !hasCode)) {
        pendingSplitRow = row;
      } else {
        finalizeParsedRow(row, trades, docId, year, memberMeta, legislator);
      }
    }
  }

  if (pendingSplitRow) {
    finalizeParsedRow(pendingSplitRow, trades, docId, year, memberMeta, legislator);
  }

  return { isScanned: false, trades };
}

function finalizeParsedRow(
  row: {
    txDateStr: string;
    internalTxId?: string;
    owner: string;
    txType: string;
    notifDate: string;
    assetHeaderTokens: string[];
    metaTokens: string[];
    amountTokens: string[];
    pageNum: number;
    rowIndex: number;
  },
  trades: CongressTradeRecord[],
  docId: string,
  year: string,
  memberMeta: { name: string; stateDst: string; filingDate: string },
  legislator: { bioguideId?: string; party: CongressParty; fullName?: string; district: number }
): void {
  const combinedAssetTokens = [...row.assetHeaderTokens, ...row.metaTokens];

  let assetName = '';
  let subholding: string | undefined;
  let location: string | undefined;
  let description: string | undefined;
  let comment: string | undefined;
  let filingStatus: string | undefined;

  let currentSection: 'ASSET' | 'FILING_STATUS' | 'SUBHOLDING' | 'LOCATION' | 'DESCRIPTION' | 'COMMENT' = 'ASSET';
  let curTokens: string[] = [];

  function assignCur(section: typeof currentSection, tokens: string[]) {
    const val = tokens.join(' ').replace(/\s+/g, ' ').trim();
    if (!val) return;
    if (section === 'ASSET') assetName = val;
    else if (section === 'FILING_STATUS') filingStatus = val;
    else if (section === 'SUBHOLDING') subholding = val;
    else if (section === 'LOCATION') location = val;
    else if (section === 'DESCRIPTION') description = val;
    else if (section === 'COMMENT') comment = val;
  }

  for (const token of combinedAssetTokens) {
    const norm = token.replace(/\u0000/g, '');
    if (/^Filing\s*Status\s*:/i.test(norm) || /^F\s*S\s*:/i.test(norm)) {
      assignCur(currentSection, curTokens);
      currentSection = 'FILING_STATUS';
      curTokens = [norm.replace(/^[^:]+:\s*/, '')];
    } else if (/^Subholding\s*Of\s*:/i.test(norm) || /^S\s*O\s*:/i.test(norm)) {
      assignCur(currentSection, curTokens);
      currentSection = 'SUBHOLDING';
      curTokens = [norm.replace(/^[^:]+:\s*/, '')];
    } else if (/^Location\s*:/i.test(norm) || /^L\s*:/i.test(norm)) {
      assignCur(currentSection, curTokens);
      currentSection = 'LOCATION';
      curTokens = [norm.replace(/^[^:]+:\s*/, '')];
    } else if (/^Description\s*:/i.test(norm) || /^D\s*:/i.test(norm)) {
      assignCur(currentSection, curTokens);
      currentSection = 'DESCRIPTION';
      curTokens = [norm.replace(/^[^:]+:\s*/, '')];
    } else if (/^Comments?\s*:/i.test(norm) || /^C\s*:/i.test(norm)) {
      assignCur(currentSection, curTokens);
      currentSection = 'COMMENT';
      curTokens = [norm.replace(/^[^:]+:\s*/, '')];
    } else {
      curTokens.push(token);
    }
  }
  assignCur(currentSection, curTokens);

  // Rule: asset name ends strictly at the [XX] code
  const bracketMatch = assetName.match(/^(.*?\[[A-Z]{2}\])(?:\s+(.*))?$/);
  if (bracketMatch) {
    assetName = bracketMatch[1].trim();
    const extraTail = bracketMatch[2] ? bracketMatch[2].trim() : '';
    if (extraTail) {
      if (!description) description = extraTail;
      else description = extraTail + ' ' + description;
    }
  }

  const rawAssetDescription = assetName.replace(/\s+/g, ' ').trim();

  // Extract asset code [XX]
  const codeMatch = rawAssetDescription.match(/\[([A-Z]{2})\]/);
  const assetTypeCode = codeMatch ? codeMatch[1] : null;

  // Extract parenthesized ticker ONLY if assetTypeCode is eligible
  const tickerMatch = rawAssetDescription.match(/\(([A-Z0-9\.\/]{1,6})\)/);
  let ticker: string | null = null;
  if (tickerMatch) {
    const rawTicker = tickerMatch[1].toUpperCase();
    if (!assetTypeCode || LISTED_EQUITY_CODES.has(assetTypeCode)) {
      ticker = rawTicker;
    }
  }

  const assetGroup: CongressAssetGroup = ticker ? 'EQUITIES' : 'FIXED_INCOME_OTHER';
  const isAmended = (filingStatus || '').toLowerCase().includes('amend');

  // Check if option trade
  const isOption = assetTypeCode === 'OP' || rawAssetDescription.toLowerCase().includes('option');

  // Amount parsing and normalization:
  // e.g. "$15.001" or "$1,001 - $15.000" normalized to standard comma thousands separators
  let rawAmt = row.amountTokens.join(' ').replace(/\s+-\s+/, ' - ').trim();
  rawAmt = rawAmt.replace(/\$(\d{1,3})\.(\d{3})\b/g, '$$$1,$2');
  if (rawAmt.toLowerCase().includes('spouse/dc over') || rawAmt.toLowerCase().includes('over $1,000,000')) {
    if (rawAmt.toLowerCase().includes('spouse')) {
      rawAmt = 'Spouse/DC Over $1,000,000';
    }
  }
  const bounds = parseAmountBounds(rawAmt);

  // ISO Dates: YYYY-MM-DD
  const txDateIso = toIsoDate(row.txDateStr);
  const notifDateIso = toIsoDate(row.notifDate || row.txDateStr);
  const filingDateIso = toIsoDate(memberMeta.filingDate);

  // Compute reporting gap from filingDate to transactionDate
  let reportingGapDays = 0;
  try {
    const [tY, tM, tD] = txDateIso.split('-').map((n) => parseInt(n, 10));
    const [fY, fM, fD] = filingDateIso.split('-').map((n) => parseInt(n, 10));
    const tDate = new Date(tY, tM - 1, tD);
    const fDate = new Date(fY, fM - 1, fD);
    reportingGapDays = Math.max(0, Math.round((fDate.getTime() - tDate.getTime()) / (1000 * 3600 * 24)));
  } catch {}

  // Date Anomaly Check:
  // Flag any row where trade date is after notification date, trade date is after today,
  // notification date is after today, or notification date is before trade date.
  const todayIso = new Date().toISOString().slice(0, 10);
  let dateAnomaly = false;
  const anomalyReasons: string[] = [];

  if (txDateIso > todayIso) {
    dateAnomaly = true;
    anomalyReasons.push('trade date is in the future');
  }
  if (notifDateIso > todayIso) {
    dateAnomaly = true;
    anomalyReasons.push('notification date is in the future');
  }
  if (txDateIso > notifDateIso) {
    dateAnomaly = true;
    anomalyReasons.push('trade date is after notification date');
  }

  const mappedTx = mapTxType(row.txType);
  const compositeId = row.internalTxId
    ? `${docId}-${row.internalTxId}-${txDateIso}-${rawAssetDescription}-${rawAmt}`
    : `${docId}-${row.rowIndex}-${txDateIso}-${rawAssetDescription}-${rawAmt}`;

  trades.push({
    id: compositeId,
    internalTxId: row.internalTxId,
    docId,
    year,
    politicianName: legislator.fullName || memberMeta.name,
    bioguideId: legislator.bioguideId,
    party: legislator.party,
    state: memberMeta.stateDst.slice(0, 2),
    district: legislator.district,
    stateDistrict: memberMeta.stateDst,
    filingDate: filingDateIso,
    transactionDate: txDateIso,
    disclosureDate: notifDateIso,
    notificationDate: notifDateIso,
    reportingGapDays,
    dateAnomaly: dateAnomaly || undefined,
    dateAnomalyReason: anomalyReasons.length > 0 ? anomalyReasons.join('; ') : undefined,
    isOption: isOption || undefined,
    ticker,
    rawAssetDescription,
    assetTypeCode,
    assetGroup,
    txType: mappedTx.type,
    txTypeRaw: mappedTx.raw,
    owner: mapOwner(row.owner),
    ownerRaw: row.owner || 'self',
    amountRange: rawAmt || 'Undetermined',
    amountMin: bounds.min,
    amountMax: bounds.max,
    isExactAmount: bounds.isExact,
    filingStatus,
    subholding,
    location,
    description,
    comment,
    filingUrl: `${HOUSE_DISCLOSURES_BASE}/ptr-pdfs/${year}/${docId}.pdf`,
    isAmended,
    parseStatus: 'parsed_fully',
  });
}

// Ingest pipeline: fetch House indices, filter P filings for last 12 months, and backfill unseen PDFs
export async function runIngestionBackfill(options?: { forceCheckIndex?: boolean }): Promise<{
  indexCheckRan: boolean;
  newFilingsFound: number;
  cooldownActive: boolean;
  cooldownRemainingSeconds?: number;
}> {
  const now = Date.now();
  if (isBackfillRunning) {
    return {
      indexCheckRan: false,
      newFilingsFound: 0,
      cooldownActive: false,
    };
  }

  // Rate limit index checks: respect 429/403 cooldown and max-frequency limit (60s)
  if (now < upstreamCooldownUntil) {
    const remainingSec = Math.ceil((upstreamCooldownUntil - now) / 1000);
    return {
      indexCheckRan: false,
      newFilingsFound: 0,
      cooldownActive: true,
      cooldownRemainingSeconds: remainingSec,
    };
  }

  if (!options?.forceCheckIndex && now - lastIndexCheckAttempt < MIN_INDEX_CHECK_INTERVAL_MS) {
    const remainingSec = Math.ceil((MIN_INDEX_CHECK_INTERVAL_MS - (now - lastIndexCheckAttempt)) / 1000);
    return {
      indexCheckRan: false,
      newFilingsFound: 0,
      cooldownActive: true,
      cooldownRemainingSeconds: remainingSec,
    };
  }

  isBackfillRunning = true;
  lastIndexCheckAttempt = now;
  cachedData.lastIndexCheck = new Date(now).toISOString();

  let newFilingsFoundCount = 0;

  try {
    loadLegislators();
    loadCacheFromDisk();

    const currentYear = new Date().getFullYear();
    const yearsToCheck = [currentYear, currentYear - 1];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 365);

    const parser = new XMLParser({ ignoreAttributes: false });
    const unseenPFilings: Array<{
      docId: string;
      year: string;
      name: string;
      stateDst: string;
      filingDate: string;
      fDate: Date;
    }> = [];

    let totalAFilings = 0;

    for (const yr of yearsToCheck) {
      const zipUrl = `${HOUSE_DISCLOSURES_BASE}/financial-pdfs/${yr}FD.zip`;
      const zipBuf = await fetchWithPoliteness(zipUrl, MAX_ZIP_SIZE_BYTES);
      if (!zipBuf) continue;

      try {
        const zip = new AdmZip(zipBuf);
        const xmlEntry = zip.getEntries().find((e) => e.entryName.endsWith('.xml'));
        if (!xmlEntry) continue;

        const xmlContent = xmlEntry.getData().toString('utf-8');
        const parsedObj = parser.parse(xmlContent);
        const members: RawHouseMemberRecord[] = parsedObj?.FinancialDisclosure?.Member || [];

        for (const m of members) {
          const filingType = String(m.FilingType || '').trim();
          if (filingType === 'A') {
            totalAFilings++;
            continue;
          }
          if (filingType !== 'P') continue;

          const fDateStr = String(m.FilingDate || '').trim();
          let fDate: Date | null = null;
          try {
            const parts = fDateStr.split('/');
            if (parts.length === 3) {
              fDate = new Date(parseInt(parts[2], 10), parseInt(parts[0], 10) - 1, parseInt(parts[1], 10));
            }
          } catch {}

          if (!fDate || fDate < cutoffDate) continue;

          const docId = String(m.DocID || '').trim();
          const docYear = String(m.Year || yr).trim();
          const fullName = `${m.Prefix ? m.Prefix + ' ' : ''}${m.First || ''} ${m.Last || ''}`.trim();
          const stateDst = String(m.StateDst || '').trim();

          if (!cachedData.processedDocIds[docId]) {
            unseenPFilings.push({
              docId,
              year: docYear,
              name: fullName,
              stateDst,
              filingDate: fDateStr,
              fDate,
            });
          }
        }
      } catch (zipErr) {
        console.warn(`[CongressionalTradingService] Failed parsing index zip for ${yr}:`, zipErr);
      }
    }

    cachedData.totalAFilingsIgnored = totalAFilings;

    // Filter deduplicated unseen filings
    const uniqueUnseen = new Map<string, (typeof unseenPFilings)[0]>();
    for (const f of unseenPFilings) {
      uniqueUnseen.set(f.docId, f);
    }
    const queue = Array.from(uniqueUnseen.values());
    newFilingsFoundCount = queue.length;

    backfillProgressState = {
      processedFilings: 0,
      totalFilings: queue.length,
      percentComplete: queue.length === 0 ? 100 : 0,
    };

    const deduplicatedTrades = new Map<string, CongressTradeRecord>();
    for (const t of cachedData.trades) {
      deduplicatedTrades.set(t.id, t);
    }

    const scannedList = [...cachedData.scannedFilings];

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];

      // Polite 1s throttle between document downloads
      await new Promise((res) => setTimeout(res, THROTTLE_DELAY_MS));

      // DocIDs starting with 911 or 822 are paper scans
      if (!item.docId.startsWith('200')) {
        cachedData.processedDocIds[item.docId] = 'scanned';
        scannedList.push({
          docId: item.docId,
          year: item.year,
          politicianName: item.name,
          stateDistrict: item.stateDst,
          filingDate: item.filingDate,
          filingUrl: `${HOUSE_DISCLOSURES_BASE}/ptr-pdfs/${item.year}/${item.docId}.pdf`,
        });
      } else {
        const pdfUrl = `${HOUSE_DISCLOSURES_BASE}/ptr-pdfs/${item.year}/${item.docId}.pdf`;
        const pdfBuf = await fetchWithPoliteness(pdfUrl, MAX_PDF_SIZE_BYTES);

        if (!pdfBuf) {
          cachedData.processedDocIds[item.docId] = 'failed';
        } else {
          const extractResult = await extractTradesFromPdfBuffer(pdfBuf, item.docId, item.year, {
            name: item.name,
            stateDst: item.stateDst,
            filingDate: item.filingDate,
          });

          if (extractResult.isScanned) {
            cachedData.processedDocIds[item.docId] = 'scanned';
            scannedList.push({
              docId: item.docId,
              year: item.year,
              politicianName: item.name,
              stateDistrict: item.stateDst,
              filingDate: item.filingDate,
              filingUrl: pdfUrl,
            });
          } else {
            cachedData.processedDocIds[item.docId] = 'parsed';
            for (const tr of extractResult.trades) {
              deduplicatedTrades.set(tr.id, tr);
            }
          }
        }
      }

      backfillProgressState.processedFilings = i + 1;
      backfillProgressState.percentComplete = Math.round(((i + 1) / queue.length) * 100);

      // Periodically flush cache to disk every 25 files
      if ((i + 1) % 25 === 0 || i + 1 === queue.length) {
        cachedData.trades = Array.from(deduplicatedTrades.values());
        cachedData.scannedFilings = scannedList;
        cachedData.lastUpdated = new Date().toISOString();
        writeCacheToDisk(cachedData);
      }
    }

    cachedData.trades = Array.from(deduplicatedTrades.values());
    cachedData.scannedFilings = scannedList;
    cachedData.lastUpdated = new Date().toISOString();
    writeCacheToDisk(cachedData);
  } catch (err) {
    console.error('[CongressionalTradingService] Error during ingestion backfill:', err);
  } finally {
    isBackfillRunning = false;
  }

  return {
    indexCheckRan: true,
    newFilingsFound: newFilingsFoundCount,
    cooldownActive: false,
  };
}

// Background scheduler
let initStarted = false;
export function initializeCongressionalTradingService(): void {
  if (initStarted) return;
  initStarted = true;
  loadCacheFromDisk();

  // If cache is empty or stale (> 6 hours), trigger background backfill
  const isStale =
    !cachedData.lastUpdated ||
    Date.now() - new Date(cachedData.lastUpdated).getTime() > CACHE_TTL_MS;

  if (cachedData.trades.length === 0 || isStale) {
    void runIngestionBackfill();
  }

  // Periodic refresh every 6 hours
  setInterval(() => {
    void runIngestionBackfill();
  }, CACHE_TTL_MS);
}

// API Query Handlers
export function getCongressTradingStatus(): CongressStatusResponse {
  loadCacheFromDisk();
  const now = Date.now();
  const isStale =
    !cachedData.lastUpdated ||
    now - new Date(cachedData.lastUpdated).getTime() > CACHE_TTL_MS;

  let parsedCount = 0;
  let scannedCount = 0;
  let failedCount = 0;

  for (const status of Object.values(cachedData.processedDocIds)) {
    if (status === 'parsed') parsedCount++;
    else if (status === 'scanned') scannedCount++;
    else if (status === 'failed') failedCount++;
  }

  const isCooldown = now < upstreamCooldownUntil || now - lastIndexCheckAttempt < MIN_INDEX_CHECK_INTERVAL_MS;
  const cooldownRemaining = now < upstreamCooldownUntil
    ? Math.ceil((upstreamCooldownUntil - now) / 1000)
    : now - lastIndexCheckAttempt < MIN_INDEX_CHECK_INTERVAL_MS
    ? Math.ceil((MIN_INDEX_CHECK_INTERVAL_MS - (now - lastIndexCheckAttempt)) / 1000)
    : 0;

  return {
    success: true,
    isBackfilling: isBackfillRunning,
    backfillProgress: backfillProgressState,
    lastUpdated: cachedData.lastUpdated,
    lastIndexCheck: cachedData.lastIndexCheck,
    isStale,
    totalParsedFilings: parsedCount,
    totalScannedFilings: scannedCount,
    totalFailedFilings: failedCount,
    totalTransactions: cachedData.trades.length,
    totalAFilingsIgnored: cachedData.totalAFilingsIgnored,
    cooldownActive: isCooldown,
    cooldownRemainingSeconds: cooldownRemaining > 0 ? cooldownRemaining : undefined,
  };
}

export interface CongressTradesQuery {
  party?: string;
  type?: string;
  owner?: string;
  ticker?: string;
  politician?: string;
  assetGroup?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'transactionDate' | 'disclosureDate' | 'filingDate' | 'amount';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export function queryCongressTrades(params: CongressTradesQuery): CongressTradesResponse {
  loadCacheFromDisk();
  let list = [...cachedData.trades];

  if (params.party && params.party !== 'ALL') {
    list = list.filter((t) => t.party.toLowerCase() === params.party!.toLowerCase());
  }
  if (params.type && params.type !== 'ALL') {
    list = list.filter((t) => t.txType.toLowerCase() === params.type!.toLowerCase());
  }
  if (params.owner && params.owner !== 'ALL') {
    list = list.filter((t) => t.owner.toLowerCase() === params.owner!.toLowerCase());
  }
  if (params.ticker) {
    const qTick = params.ticker.trim().toUpperCase();
    list = list.filter((t) => t.ticker === qTick);
  }
  if (params.politician) {
    const qPol = params.politician.trim().toLowerCase();
    list = list.filter((t) => t.politicianName.toLowerCase().includes(qPol));
  }
  if (params.assetGroup && params.assetGroup !== 'ALL') {
    list = list.filter((t) => t.assetGroup === params.assetGroup);
  }
  if (params.dateFrom) {
    list = list.filter((t) => t.transactionDate >= params.dateFrom!);
  }
  if (params.dateTo) {
    list = list.filter((t) => t.transactionDate <= params.dateTo!);
  }

  // Default sort is filing date, newest first (with date anomalies pushed to bottom or ordered stably)
  const sortBy = params.sortBy || 'filingDate';
  const sortDir = params.sortDir || 'desc';

  list.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'transactionDate') {
      cmp = a.transactionDate.localeCompare(b.transactionDate);
    } else if (sortBy === 'amount') {
      cmp = a.amountMax - b.amountMax;
    } else if (sortBy === 'disclosureDate') {
      cmp = a.disclosureDate.localeCompare(b.disclosureDate);
    } else {
      // Default: filingDate
      cmp = a.filingDate.localeCompare(b.filingDate);
      if (cmp === 0) {
        cmp = a.transactionDate.localeCompare(b.transactionDate);
      }
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalTrades = list.length;
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 50));
  const page = Math.max(1, params.page || 1);
  const totalPages = Math.max(1, Math.ceil(totalTrades / pageSize));
  const startIndex = (page - 1) * pageSize;
  const paginatedTrades = list.slice(startIndex, startIndex + pageSize);

  const isStale =
    !cachedData.lastUpdated ||
    Date.now() - new Date(cachedData.lastUpdated).getTime() > CACHE_TTL_MS;

  return {
    success: true,
    trades: paginatedTrades,
    totalTrades,
    page,
    pageSize,
    totalPages,
    isStale,
    lastUpdated: cachedData.lastUpdated,
    scannedFilings: cachedData.scannedFilings.slice(0, 50),
  };
}

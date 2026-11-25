import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  RefreshCw,
  AlertCircle,
  ArrowUpDown,
  Building2,
  TrendingUp,
  Activity,
  Briefcase,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Compass,
} from 'lucide-react';
import type {
  InstitutionalAccumulationRow,
  InstitutionalDataFreshness,
  InstitutionalHoldingRow,
  InstitutionalHoldingsSummary,
  InstitutionalInvestorProfile,
  InstitutionalManagerDirectoryItem,
  InstitutionalPositionChangeRow,
  InstitutionalPositionStatus,
  SectorRotationResponse,
  StockData,
} from '../types';
import {
  formatCompactShares,
  formatCompactUsd,
  formatIsoDateShort,
  formatQuarterLabel,
  formatSignedPercent,
} from '../utils/institutionalActivity';
import SectorRotationPanel from './SectorRotationPanel';
import TerminalSelect from './TerminalSelect';

interface InstitutionalActivityScreenProps {
  selectedTicker: string;
  stocks: Record<string, StockData>;
  onSelectTicker?: (ticker: string) => void;
}

type InstitutionalTab = 'HOLDINGS' | 'ACCUMULATION' | 'INVESTORS' | 'CHANGES' | 'SECTOR_ROTATION';

const EXCLUDED_QUICK_TICKERS = new Set(['SPX', 'DJI', 'IXIC', 'GC', 'CL', 'TNX', 'BTC']);

export function formatHoldingsLimitationsNotice(limitations: string[]): string {
  return limitations
    .filter((msg) => !/no confirmed prior-period filing/i.test(msg))
    .map((msg) =>
      /^Showing top 500 reported institutional positions by USD value for this period/i.test(msg)
        ? 'Showing top 500 reported institutional positions by USD value for this period.'
        : msg
    )
    .join(' ')
    .trim();
}

function getSafeExternalUrl(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // invalid URL
  }
  return null;
}

function getStatusTextClass(status: InstitutionalPositionStatus): string {
  switch (status) {
    case 'NEW':
      return 'text-[#00ff00] border-[#00ff00]/40 bg-[#00ff00]/10';
    case 'INCREASED':
      return 'text-emerald-400 border-emerald-500/35 bg-emerald-950/30';
    case 'DECREASED':
      return 'text-amber-400 border-amber-500/35 bg-amber-950/30';
    case 'EXITED':
      return 'text-[#ff4444] border-[#ff4444]/40 bg-[#ff4444]/10';
    case 'UNCHANGED':
      return 'text-zinc-300 border-zinc-700 bg-zinc-900/40';
    case 'NO_PRIOR_DATA':
    default:
      return 'text-zinc-300 border-zinc-800 bg-zinc-950';
  }
}

function formatStatusLabel(status: InstitutionalPositionStatus, verbose = false): string {
  switch (status) {
    case 'NEW':
      return verbose ? 'NEW POSITION' : 'NEW';
    case 'INCREASED':
      return verbose ? 'INCREASED POSITION' : 'INCREASED';
    case 'DECREASED':
      return verbose ? 'DECREASED POSITION' : 'DECREASED';
    case 'EXITED':
      return verbose ? 'EXITED POSITION' : 'EXITED';
    case 'UNCHANGED':
      return 'UNCHANGED';
    case 'NO_PRIOR_DATA':
      return 'NO PRIOR';
  }
}

export default function InstitutionalActivityScreen({
  selectedTicker,
  stocks,
  onSelectTicker,
}: InstitutionalActivityScreenProps) {
  const [activeTab, setActiveTab] = useState<InstitutionalTab>('HOLDINGS');

  // Shared metadata & configuration state
  const [requiresKey, setRequiresKey] = useState<boolean>(false);
  const [rateLimited, setRateLimited] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<InstitutionalDataFreshness | null>(null);
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');

  // Section A: Institutional Holdings state
  const [activeHoldingsQuery, setActiveHoldingsQuery] = useState<{
    ticker?: string;
    cusip?: string;
    issuer?: string;
  }>({ ticker: selectedTicker || 'AAPL' });
  const [holdingsManagerFilter, setHoldingsManagerFilter] = useState<string>('');
  const [holdingsStatusFilter, setHoldingsStatusFilter] = useState<string>('ALL');
  const [holdingsSortBy, setHoldingsSortBy] = useState<string>('valueUsd');
  const [holdingsSortDir, setHoldingsSortDir] = useState<'asc' | 'desc'>('desc');
  const [holdingsPage, setHoldingsPage] = useState<number>(1);
  const [holdingsLoading, setHoldingsLoading] = useState<boolean>(false);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);
  const [holdingsRows, setHoldingsRows] = useState<InstitutionalHoldingRow[]>([]);
  const [holdingsTotalRows, setHoldingsTotalRows] = useState<number>(0);
  const [holdingsSummary, setHoldingsSummary] = useState<InstitutionalHoldingsSummary | null>(null);
  const [holdingsResolved, setHoldingsResolved] = useState<{
    ticker: string | null;
    companyName: string | null;
    cusip: string | null;
  } | null>(null);
  const [holdingsPeriodInfo, setHoldingsPeriodInfo] = useState<{
    current: string;
    previous: string | null;
  }>({ current: '', previous: null });
  const [holdingsLimitations, setHoldingsLimitations] = useState<string[]>([]);

  // Section B: Accumulation Screener state
  const [accSearch, setAccSearch] = useState<string>('');
  const [accMinIncreasing, setAccMinIncreasing] = useState<number>(2);
  const [accMinPctIncrease, setAccMinPctIncrease] = useState<number>(0);
  const [accMinNewPositions, setAccMinNewPositions] = useState<number>(0);
  const [accSortBy, setAccSortBy] = useState<string>('institutionsIncreasing');
  const [accSortDir, setAccSortDir] = useState<'asc' | 'desc'>('desc');
  const [accLoading, setAccLoading] = useState<boolean>(false);
  const [accError, setAccError] = useState<string | null>(null);
  const [accRows, setAccRows] = useState<InstitutionalAccumulationRow[]>([]);
  const [accMeta, setAccMeta] = useState<{
    reportingPeriod: string;
    previousPeriod: string;
    managersAnalyzed: number;
    methodologyNote: string;
  } | null>(null);

  // Section C: Institutional Investor Profiles state
  const [managerSearch, setManagerSearch] = useState<string>('');
  const [managersLoading, setManagersLoading] = useState<boolean>(false);
  const [managersError, setManagersError] = useState<string | null>(null);
  const [managersList, setManagersList] = useState<InstitutionalManagerDirectoryItem[]>([]);
  const [selectedManagerCik, setSelectedManagerCik] = useState<string>('');
  const [selectedManagerPeriod, setSelectedManagerPeriod] = useState<string>('');
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [investorProfile, setInvestorProfile] = useState<InstitutionalInvestorProfile | null>(null);
  const [managerPeriods, setManagerPeriods] = useState<string[]>([]);
  const [profileHoldingsFilter, setProfileHoldingsFilter] = useState<string>('');
  const [profileStatusFilter, setProfileStatusFilter] = useState<string>('ALL');

  // Section D: Position Changes state
  const [changesCategory, setChangesCategory] = useState<string>('ALL');
  const [changesTickerInput, setChangesTickerInput] = useState<string>('');
  const [changesAppliedTicker, setChangesAppliedTicker] = useState<string>('');
  const [changesManagerInput, setChangesManagerInput] = useState<string>('');
  const [changesPage, setChangesPage] = useState<number>(1);
  const [changesLoading, setChangesLoading] = useState<boolean>(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [changesRows, setChangesRows] = useState<InstitutionalPositionChangeRow[]>([]);
  const [changesTotalRows, setChangesTotalRows] = useState<number>(0);
  const [changesCounts, setChangesCounts] = useState({
    all: 0,
    NEW: 0,
    INCREASED: 0,
    DECREASED: 0,
    EXITED: 0,
  });
  const [changesMeta, setChangesMeta] = useState<{
    reportingPeriod: string;
    previousPeriod: string | null;
    managersAnalyzed: number | null;
  } | null>(null);

  // Section E: Sector Rotation state
  const [sectorWindowDays, setSectorWindowDays] = useState<number>(90);
  const [sectorLoading, setSectorLoading] = useState<boolean>(false);
  const [sectorError, setSectorError] = useState<string | null>(null);
  const [sectorData, setSectorData] = useState<SectorRotationResponse | null>(null);

  const quickTickers = useMemo(() => {
    const tracked = Object.keys(stocks || {}).filter((s) => !EXCLUDED_QUICK_TICKERS.has(s));
    const defaults = ['AAPL', 'NVDA', 'MSFT', 'AMZN', 'META', 'GOOG', 'TSLA'];
    return Array.from(new Set([...tracked, ...defaults])).slice(0, 8);
  }, [stocks]);

  // Sync holdings query when user clicks a stock in Quorix's left Tracked Equities panel or uses INST command
  useEffect(() => {
    if (selectedTicker && !EXCLUDED_QUICK_TICKERS.has(selectedTicker)) {
      setActiveHoldingsQuery({ ticker: selectedTicker });
      setHoldingsPage(1);
    }
  }, [selectedTicker]);

  const applySharedResponseMeta = useCallback((data: any) => {
    if (data?.freshness) setFreshness(data.freshness);
    if (Array.isArray(data?.availablePeriods) && data.availablePeriods.length > 0) {
      setAvailablePeriods(data.availablePeriods);
    }
    setLastRefreshedAt(new Date().toLocaleTimeString());
  }, []);

  const handleApiErrorFlags = useCallback((data: any, fallbackMsg: string): string => {
    if (data?.requiresKey) {
      setRequiresKey(true);
      setRateLimited(false);
      setGlobalError(data.error || fallbackMsg);
    } else if (data?.rateLimited) {
      setRateLimited(true);
    }
    return data?.error || fallbackMsg;
  }, []);

  // Fetch Section A: Institutional Holdings
  const fetchHoldings = useCallback(
    async (force = false) => {
      setHoldingsLoading(true);
      setHoldingsError(null);
      setRateLimited(false);
      try {
        const qs = new URLSearchParams();
        if (activeHoldingsQuery.cusip) qs.set('cusip', activeHoldingsQuery.cusip);
        else if (activeHoldingsQuery.ticker) qs.set('ticker', activeHoldingsQuery.ticker);
        else if (activeHoldingsQuery.issuer) qs.set('issuer', activeHoldingsQuery.issuer);
        if (holdingsManagerFilter.trim()) qs.set('managerQuery', holdingsManagerFilter.trim());
        if (selectedPeriod) qs.set('period', selectedPeriod);
        if (holdingsStatusFilter !== 'ALL') qs.set('statusFilter', holdingsStatusFilter);
        qs.set('sortBy', holdingsSortBy);
        qs.set('sortDir', holdingsSortDir);
        qs.set('page', String(holdingsPage));
        qs.set('pageSize', '50');
        if (force) qs.set('force', 'true');

        const res = await fetch(`/api/institutional/holdings?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          const msg = handleApiErrorFlags(data, 'Failed to load institutional holdings.');
          setHoldingsError(msg);
          setHoldingsRows([]);
          return;
        }
        setRequiresKey(false);
        setGlobalError(null);
        applySharedResponseMeta(data);
        setHoldingsRows(Array.isArray(data.rows) ? data.rows : []);
        setHoldingsTotalRows(Number(data.totalRows || 0));
        setHoldingsSummary(data.summary || null);
        setHoldingsResolved(data.resolvedSecurity || null);
        setHoldingsPeriodInfo({
          current: data.reportingPeriod || '',
          previous: data.previousPeriod || null,
        });
        setHoldingsLimitations(Array.isArray(data.limitations) ? data.limitations : []);
        if (!selectedPeriod && data.reportingPeriod) {
          setSelectedPeriod(data.reportingPeriod);
        }
      } catch (err: any) {
        setHoldingsError(err?.message || 'Network error loading institutional holdings.');
      } finally {
        setHoldingsLoading(false);
      }
    },
    [
      activeHoldingsQuery,
      holdingsManagerFilter,
      selectedPeriod,
      holdingsStatusFilter,
      holdingsSortBy,
      holdingsSortDir,
      holdingsPage,
      applySharedResponseMeta,
      handleApiErrorFlags,
    ]
  );

  // Fetch Section B: Accumulation Screener
  const fetchAccumulation = useCallback(
    async (force = false) => {
      setAccLoading(true);
      setAccError(null);
      setRateLimited(false);
      try {
        const qs = new URLSearchParams();
        if (selectedPeriod) qs.set('period', selectedPeriod);
        qs.set('minIncreasing', String(accMinIncreasing));
        qs.set('minPctIncrease', String(accMinPctIncrease));
        qs.set('minNewPositions', String(accMinNewPositions));
        if (accSearch.trim()) qs.set('search', accSearch.trim());
        qs.set('sortBy', accSortBy);
        qs.set('sortDir', accSortDir);
        if (force) qs.set('force', 'true');

        const res = await fetch(`/api/institutional/accumulation?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          const msg = handleApiErrorFlags(data, 'Failed to load institutional accumulation screener.');
          setAccError(msg);
          setAccRows([]);
          return;
        }
        setRequiresKey(false);
        setGlobalError(null);
        applySharedResponseMeta(data);
        setAccRows(Array.isArray(data.rows) ? data.rows : []);
        setAccMeta({
          reportingPeriod: data.reportingPeriod || '',
          previousPeriod: data.previousPeriod || '',
          managersAnalyzed: Number(data.managersAnalyzed || 0),
          methodologyNote: data.methodologyNote || '',
        });
        if (!selectedPeriod && data.reportingPeriod) {
          setSelectedPeriod(data.reportingPeriod);
        }
      } catch (err: any) {
        setAccError(err?.message || 'Network error loading institutional accumulation screener.');
      } finally {
        setAccLoading(false);
      }
    },
    [
      selectedPeriod,
      accMinIncreasing,
      accMinPctIncrease,
      accMinNewPositions,
      accSearch,
      accSortBy,
      accSortDir,
      applySharedResponseMeta,
      handleApiErrorFlags,
    ]
  );

  // Fetch Section C: Managers Directory
  const fetchManagers = useCallback(
    async (queryOverride?: string, force = false) => {
      setManagersLoading(true);
      setManagersError(null);
      try {
        const qs = new URLSearchParams();
        const q = queryOverride !== undefined ? queryOverride : managerSearch;
        if (q.trim()) qs.set('q', q.trim());
        if (selectedPeriod) qs.set('period', selectedPeriod);
        if (force) qs.set('force', 'true');

        const res = await fetch(`/api/institutional/investors?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          const msg = handleApiErrorFlags(data, 'Failed to load institutional managers directory.');
          setManagersError(msg);
          setManagersList([]);
          return;
        }
        setRequiresKey(false);
        setGlobalError(null);
        applySharedResponseMeta(data);
        const list: InstitutionalManagerDirectoryItem[] = Array.isArray(data.managers) ? data.managers : [];
        setManagersList(list);
        if (!selectedManagerCik && list.length > 0) {
          setSelectedManagerCik(list[0].cik);
        }
      } catch (err: any) {
        setManagersError(err?.message || 'Network error loading institutional managers.');
      } finally {
        setManagersLoading(false);
      }
    },
    [managerSearch, selectedPeriod, selectedManagerCik, applySharedResponseMeta, handleApiErrorFlags]
  );

  // Fetch Section C: Selected Manager Profile
  const fetchInvestorProfile = useCallback(
    async (cik: string, periodOverride?: string, force = false) => {
      if (!cik) return;
      setProfileLoading(true);
      setProfileError(null);
      try {
        const qs = new URLSearchParams();
        const p = periodOverride !== undefined ? periodOverride : selectedManagerPeriod;
        if (p) qs.set('period', p);
        if (force) qs.set('force', 'true');

        const res = await fetch(`/api/institutional/investor/${encodeURIComponent(cik)}?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          const msg = handleApiErrorFlags(data, `Failed to load institutional investor profile (CIK ${cik}).`);
          setProfileError(msg);
          setInvestorProfile(null);
          return;
        }
        setRequiresKey(false);
        setGlobalError(null);
        applySharedResponseMeta(data);
        setInvestorProfile(data.profile || null);
        setManagerPeriods(Array.isArray(data.availableManagerPeriods) ? data.availableManagerPeriods : []);
        if (!p && data.profile?.reportingPeriod) {
          setSelectedManagerPeriod(data.profile.reportingPeriod);
        }
      } catch (err: any) {
        setProfileError(err?.message || 'Network error loading investor profile.');
      } finally {
        setProfileLoading(false);
      }
    },
    [selectedManagerPeriod, applySharedResponseMeta, handleApiErrorFlags]
  );

  // Fetch Section D: Position Changes Feed
  const fetchChanges = useCallback(
    async (force = false) => {
      setChangesLoading(true);
      setChangesError(null);
      try {
        const qs = new URLSearchParams();
        qs.set('category', changesCategory);
        if (changesAppliedTicker) {
          if (/^[A-Z0-9]{9}$/.test(changesAppliedTicker) && /\d/.test(changesAppliedTicker)) {
            qs.set('cusip', changesAppliedTicker);
          } else {
            qs.set('ticker', changesAppliedTicker);
          }
        }
        if (changesManagerInput.trim()) qs.set('managerQuery', changesManagerInput.trim());
        if (selectedPeriod) qs.set('period', selectedPeriod);
        qs.set('page', String(changesPage));
        qs.set('pageSize', '50');
        if (force) qs.set('force', 'true');

        const res = await fetch(`/api/institutional/changes?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          const msg = handleApiErrorFlags(data, 'Failed to load institutional position changes.');
          setChangesError(msg);
          setChangesRows([]);
          return;
        }
        setRequiresKey(false);
        setGlobalError(null);
        applySharedResponseMeta(data);
        setChangesRows(Array.isArray(data.rows) ? data.rows : []);
        setChangesTotalRows(Number(data.totalRows || 0));
        if (data.counts) setChangesCounts(data.counts);
        setChangesMeta({
          reportingPeriod: data.reportingPeriod || '',
          previousPeriod: data.previousPeriod || null,
          managersAnalyzed: data.managersAnalyzed ?? null,
        });
        if (!selectedPeriod && data.reportingPeriod) {
          setSelectedPeriod(data.reportingPeriod);
        }
      } catch (err: any) {
        setChangesError(err?.message || 'Network error loading position changes.');
      } finally {
        setChangesLoading(false);
      }
    },
    [
      changesCategory,
      changesAppliedTicker,
      changesManagerInput,
      selectedPeriod,
      changesPage,
      applySharedResponseMeta,
      handleApiErrorFlags,
    ]
  );

  // Fetch Section E: Sector Rotation (Market SPDR ETFs + Institutional 13F Cohort + Form 4 Insiders)
  const fetchSectorRotation = useCallback(
    async (force = false) => {
      setSectorLoading(true);
      setSectorError(null);
      try {
        const qs = new URLSearchParams();
        if (selectedPeriod) qs.set('period', selectedPeriod);
        qs.set('windowDays', String(sectorWindowDays));
        if (force) qs.set('force', 'true');

        const res = await fetch(`/api/institutional/sector-rotation?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok || !data?.success) {
          setSectorError(data?.error || 'Failed to load Sector Rotation data.');
          return;
        }
        setSectorData(data as SectorRotationResponse);
        if (data?.institutionalMeta?.freshness) {
          setFreshness(data.institutionalMeta.freshness);
        }
        if (
          Array.isArray(data?.institutionalMeta?.availablePeriods) &&
          data.institutionalMeta.availablePeriods.length > 0
        ) {
          setAvailablePeriods(data.institutionalMeta.availablePeriods);
        }
        if (!selectedPeriod && data?.institutionalMeta?.reportingPeriod) {
          setSelectedPeriod(data.institutionalMeta.reportingPeriod);
        }
        setLastRefreshedAt(new Date().toLocaleTimeString());
      } catch (err: any) {
        setSectorError(err?.message || 'Network error loading Sector Rotation data.');
      } finally {
        setSectorLoading(false);
      }
    },
    [selectedPeriod, sectorWindowDays]
  );

  // Trigger active tab fetch
  useEffect(() => {
    if (activeTab === 'HOLDINGS') {
      void fetchHoldings(false);
    }
  }, [activeTab, fetchHoldings]);

  useEffect(() => {
    if (activeTab === 'ACCUMULATION') {
      void fetchAccumulation(false);
    }
  }, [activeTab, fetchAccumulation]);

  useEffect(() => {
    if (activeTab === 'INVESTORS') {
      void fetchManagers(undefined, false);
    }
  }, [activeTab, fetchManagers]);

  useEffect(() => {
    if (activeTab === 'INVESTORS' && selectedManagerCik) {
      void fetchInvestorProfile(selectedManagerCik, selectedManagerPeriod, false);
    }
  }, [activeTab, selectedManagerCik, selectedManagerPeriod, fetchInvestorProfile]);

  useEffect(() => {
    if (activeTab === 'CHANGES') {
      void fetchChanges(false);
    }
  }, [activeTab, fetchChanges]);

  useEffect(() => {
    if (activeTab === 'SECTOR_ROTATION') {
      void fetchSectorRotation(false);
    }
  }, [activeTab, fetchSectorRotation]);

  const openInvestorProfileFromTable = (cik: string) => {
    setSelectedManagerCik(cik);
    setSelectedManagerPeriod(selectedPeriod || '');
    setProfileHoldingsFilter('');
    setProfileStatusFilter('ALL');
    setActiveTab('INVESTORS');
  };

  const openSecurityHoldingsFromTable = (security: { ticker?: string | null; cusip?: string; issuerName?: string }) => {
    setHoldingsPage(1);
    if (security.cusip) {
      setActiveHoldingsQuery({
        cusip: security.cusip,
        ticker: security.ticker || undefined,
        issuer: security.issuerName || undefined,
      });
    } else if (security.ticker) {
      setActiveHoldingsQuery({ ticker: security.ticker });
    }
    setActiveTab('HOLDINGS');
  };

  const handleGlobalRefresh = () => {
    if (activeTab === 'HOLDINGS') void fetchHoldings(true);
    else if (activeTab === 'ACCUMULATION') void fetchAccumulation(true);
    else if (activeTab === 'INVESTORS') {
      void fetchManagers(undefined, true);
      if (selectedManagerCik) void fetchInvestorProfile(selectedManagerCik, selectedManagerPeriod, true);
    } else if (activeTab === 'CHANGES') {
      void fetchChanges(true);
    } else if (activeTab === 'SECTOR_ROTATION') {
      void fetchSectorRotation(true);
    }
  };

  const filteredProfileHoldings = useMemo(() => {
    if (!investorProfile) return [];
    const q = profileHoldingsFilter.trim().toLowerCase();
    return investorProfile.holdings.filter((h) => {
      if (profileStatusFilter === 'LARGEST') {
        if (h.shares <= 0) return false;
      } else if (profileStatusFilter !== 'ALL' && h.status !== profileStatusFilter) {
        return false;
      }
      if (q) {
        const hay = `${h.issuerName} ${h.cusip} ${h.ticker || ''} ${h.titleOfClass || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [investorProfile, profileHoldingsFilter, profileStatusFilter]);

  const isAnyLoading =
    holdingsLoading || accLoading || managersLoading || profileLoading || changesLoading || sectorLoading;

  const activeReportingPeriodDisplay =
    activeTab === 'HOLDINGS'
      ? holdingsPeriodInfo.current || selectedPeriod
      : activeTab === 'ACCUMULATION'
      ? accMeta?.reportingPeriod || selectedPeriod
      : activeTab === 'INVESTORS'
      ? investorProfile?.reportingPeriod || selectedPeriod
      : activeTab === 'SECTOR_ROTATION'
      ? sectorData?.institutionalMeta?.reportingPeriod || selectedPeriod
      : changesMeta?.reportingPeriod || selectedPeriod;

  const holdingsTotalPages = Math.max(1, Math.ceil(holdingsTotalRows / 50));
  const changesTotalPages = Math.max(1, Math.ceil(changesTotalRows / 50));
  const holdingsNoticeText = useMemo(
    () => formatHoldingsLimitationsNotice(holdingsLimitations),
    [holdingsLimitations]
  );

  return (
    <div className="bg-[#050505] border border-[#333] rounded p-4 animate-fade-in shadow-xl select-text flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden font-mono text-xs text-zinc-200">
      {/* 1. WORKSPACE HEADER */}
      <div className="border-b border-[#333] pb-3 mb-2.5 flex flex-col md:flex-row justify-between items-start md:items-center gap-2 shrink-0 select-none text-base">
        <div>
          <span className="text-white text-md font-bold uppercase tracking-wider">
            INSTITUTIONAL ACTIVITY MONITOR
          </span>
          <span className="text-xs text-zinc-300 block">
            FORM 13F INSTITUTIONAL HOLDINGS, MULTI-MANAGER ACCUMULATION &amp; POSITION CHANGES
          </span>
        </div>

        <div className="flex flex-col items-start md:items-end gap-1 text-xs text-zinc-300">
          {/* Metadata & Sync Row */}
          <div className="flex flex-wrap items-center gap-2">
            {lastRefreshedAt && (
              <span className="tabular-nums text-zinc-300">SYNC: {lastRefreshedAt}</span>
            )}
            <button
              type="button"
              onClick={handleGlobalRefresh}
              disabled={isAnyLoading}
              className="ml-1 px-2 py-1 rounded bg-black border border-[#333] hover:border-[#ff9900] hover:text-[#ff9900] text-zinc-300 text-xs font-bold uppercase transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
            >
              <RefreshCw size={10} className={isAnyLoading ? 'animate-spin' : ''} />
              <span>REFRESH</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. PRIMARY SECTION TABS & REPORTING PERIOD SELECTOR */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3a3a3a] pb-2.5 mb-3 shrink-0 select-none">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(
            [
              { id: 'HOLDINGS', label: 'INSTITUTIONAL HOLDINGS', icon: Briefcase },
              { id: 'ACCUMULATION', label: 'ACCUMULATION SCREENER', icon: TrendingUp },
              { id: 'INVESTORS', label: 'INVESTOR PROFILES', icon: Building2 },
              { id: 'CHANGES', label: 'POSITION CHANGES', icon: Activity },
              { id: 'SECTOR_ROTATION', label: 'SECTOR ROTATION', icon: Compass },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded text-xs font-extrabold uppercase tracking-wider border transition-colors shrink-0 inline-flex items-center gap-1.5 cursor-pointer ${
                  isActive
                    ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                    : 'bg-black border-[#3a3a3a] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                }`}
              >
                <Icon size={11} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {availablePeriods.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0 select-none">
            <label htmlFor="inst-period-select" className="text-zinc-300 font-bold uppercase text-xs">
              REPORTING PERIOD:
            </label>
            <TerminalSelect
              id="inst-period-select"
              sizeVariant="sm"
              value={selectedPeriod}
              onChange={(e) => {
                setSelectedPeriod(e.target.value);
                setHoldingsPage(1);
                setChangesPage(1);
              }}
              className="font-mono"
            >
              {availablePeriods.map((p) => (
                <option key={p} value={p}>
                  {formatQuarterLabel(p)}
                </option>
              ))}
            </TerminalSelect>
          </div>
        )}
      </div>

      {/* 4. SERVER API KEY MISSING OR RATE-LIMIT STATE */}
      {requiresKey && activeTab !== 'SECTOR_ROTATION' ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-black border border-[#333] rounded p-5 space-y-3">
            <div className="flex items-center gap-2 text-[#ff9900] text-xs font-bold uppercase tracking-wider">
              <AlertCircle size={15} />
              <span>3SPREAD API CONFIGURATION REQUIRED</span>
            </div>
            <p className="text-zinc-300 leading-relaxed">
              {globalError ||
                'THREESPREAD_API_KEY is not configured in the server environment. Institutional Activity connects exclusively to the 3spread Form 13F API and never displays fabricated or placeholder holdings.'}
            </p>
            <div className="bg-[#0a0a0a] border border-[#3a3a3a] rounded p-3 text-xs text-zinc-300 space-y-1.5">
              <div className="text-zinc-200 font-bold uppercase text-xs">SERVER SETUP INSTRUCTIONS</div>
              <div>
                1. Obtain a free Community tier API key from{' '}
                <a
                  href="https://www.3spread.com/auth/signup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#3498db] hover:underline inline-flex items-center gap-1"
                >
                  <span>3spread.com</span>
                  <ExternalLink size={9} />
                </a>{' '}
                (10,000 req/day, 600 req/min).
              </div>
              <div>
                2. Add <code className="text-[#00ff00]">THREESPREAD_API_KEY=your_key</code> to your server{' '}
                <code className="text-zinc-200">.env</code> environment configuration and restart the server.
              </div>
            </div>
            <div className="pt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={handleGlobalRefresh}
                className="px-3 py-1.5 bg-[#ff9900] hover:bg-amber-500 text-black font-extrabold text-xs uppercase rounded cursor-pointer transition-colors"
              >
                RETRY CONNECTION
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {rateLimited && (
            <div className="mb-2.5 px-3 py-2 rounded bg-amber-950/30 border border-amber-600/40 text-amber-300 text-xs flex items-center justify-between gap-2 shrink-0">
              <span>3spread API rate limit cooldown active. Cached views remain available; retry shortly.</span>
              <button
                type="button"
                onClick={handleGlobalRefresh}
                className="px-2 py-0.5 border border-amber-500/50 rounded text-xs font-bold uppercase hover:bg-amber-500/15 cursor-pointer"
              >
                RETRY
              </button>
            </div>
          )}

          {/* ============================================================== */}
          {/* SECTION A: INSTITUTIONAL HOLDINGS                              */}
          {/* ============================================================== */}
          {activeTab === 'HOLDINGS' && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden space-y-2.5">
              {/* Filter / Search Bar */}
              <div className="space-y-2 shrink-0 select-none">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
                  <div className="lg:col-span-5 flex items-center bg-black border border-[#333] focus-within:border-[#3498db] rounded px-2 py-1">
                    <Building2 size={12} className="text-zinc-300 mr-1.5 shrink-0" />
                    <input
                      type="text"
                      value={holdingsManagerFilter}
                      onChange={(e) => {
                        setHoldingsManagerFilter(e.target.value);
                        setHoldingsPage(1);
                      }}
                      placeholder="Filter investor / fund or CIK..."
                      className="flex-1 bg-transparent text-xs text-zinc-200 outline-none font-mono"
                    />
                  </div>

                  <div className="lg:col-span-7 flex flex-wrap items-center gap-1.5 text-xs">
                    <TerminalSelect
                      aria-label="Filter by position status"
                      value={holdingsStatusFilter}
                      onChange={(e) => {
                        setHoldingsStatusFilter(e.target.value);
                        setHoldingsPage(1);
                      }}
                    >
                      <option value="ALL">STATUS: ALL</option>
                      <option value="NEW">NEW POSITION</option>
                      <option value="INCREASED">INCREASED</option>
                      <option value="DECREASED">DECREASED</option>
                      <option value="EXITED">EXITED</option>
                      <option value="UNCHANGED">UNCHANGED</option>
                    </TerminalSelect>

                    <TerminalSelect
                      aria-label="Sort institutional holdings"
                      value={holdingsSortBy}
                      onChange={(e) => setHoldingsSortBy(e.target.value)}
                    >
                      <option value="valueUsd">SORT: POSITION VALUE</option>
                      <option value="percentChange">SORT: % CHANGE</option>
                      <option value="shareChange">SORT: SHARE CHANGE</option>
                      <option value="shares">SORT: SHARES HELD</option>
                      <option value="portfolioPct">SORT: PORTFOLIO %</option>
                      <option value="managerName">SORT: INVESTOR NAME</option>
                    </TerminalSelect>

                    <button
                      type="button"
                      onClick={() => setHoldingsSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                      className="px-2 py-1.5 rounded bg-black border border-[#333] hover:border-[#ff9900] text-zinc-300 font-bold uppercase inline-flex items-center gap-1 cursor-pointer"
                      title="Toggle sort direction"
                    >
                      <ArrowUpDown size={10} />
                      <span>{holdingsSortDir.toUpperCase()}</span>
                    </button>
                  </div>
                </div>

                {/* Quick Ticker Filter Strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-zinc-300 font-bold uppercase">QUICK TICKER:</span>
                    {quickTickers.map((sym) => {
                      const active = activeHoldingsQuery.ticker?.toUpperCase() === sym;
                      return (
                        <button
                          key={sym}
                          type="button"
                          onClick={() => {
                            if (onSelectTicker) {
                              onSelectTicker(sym);
                            } else {
                              setActiveHoldingsQuery({ ticker: sym });
                              setHoldingsPage(1);
                            }
                          }}
                          className={`px-2 py-0.5 rounded border font-bold cursor-pointer transition-colors ${
                            active
                              ? 'bg-[#3498db]/20 border-[#3498db] text-[#3498db]'
                              : 'bg-black border-[#3a3a3a] text-zinc-300 hover:border-[#3498db] hover:text-white'
                          }`}
                        >
                          {sym}
                        </button>
                      );
                    })}
                  </div>

                  {holdingsResolved && (holdingsResolved.companyName || holdingsResolved.cusip) && (
                    <div className="text-zinc-300 flex flex-wrap items-center gap-2">
                      <span className="text-zinc-100 font-bold">
                        {holdingsResolved.companyName || holdingsResolved.ticker}
                      </span>
                      {holdingsResolved.ticker && (
                        <button
                          type="button"
                          onClick={() => onSelectTicker?.(holdingsResolved.ticker!)}
                          className="text-[#3498db] hover:underline font-bold cursor-pointer"
                          title={`Open ${holdingsResolved.ticker} chart`}
                        >
                          {holdingsResolved.ticker}
                        </button>
                      )}
                      {holdingsResolved.cusip && (
                        <span className="text-zinc-300">CUSIP: {holdingsResolved.cusip}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* KPI Summary Strip */}
              {holdingsSummary && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 shrink-0">
                  <div className="bg-black border border-[#3a3a3a] rounded px-3 py-2">
                    <div className="text-xs text-zinc-300 uppercase font-bold">REPORTED INST VALUE</div>
                    <div className="text-sm font-extrabold text-white tabular-nums mt-0.5">
                      {formatCompactUsd(holdingsSummary.totalReportedValueUsd)}
                    </div>
                  </div>
                  <div className="bg-black border border-[#3a3a3a] rounded px-3 py-2">
                    <div className="text-xs text-zinc-300 uppercase font-bold">REPORTED SHARES</div>
                    <div className="text-sm font-extrabold text-zinc-100 tabular-nums mt-0.5">
                      {formatCompactShares(holdingsSummary.totalReportedShares)}
                    </div>
                  </div>
                  <div className="bg-black border border-[#3a3a3a] rounded px-3 py-2">
                    <div className="text-xs text-zinc-300 uppercase font-bold">ACTIVE MANAGERS</div>
                    <div className="text-sm font-extrabold text-[#3498db] tabular-nums mt-0.5">
                      {holdingsSummary.activeInstitutions.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-black border border-[#3a3a3a] rounded px-3 py-2">
                    <div className="text-xs text-zinc-300 uppercase font-bold">NET SHARE CHANGE</div>
                    <div
                      className={`text-sm font-extrabold tabular-nums mt-0.5 ${
                        holdingsSummary.netShareChange > 0
                          ? 'text-[#00ff00]'
                          : holdingsSummary.netShareChange < 0
                          ? 'text-[#ff4444]'
                          : 'text-zinc-300'
                      }`}
                    >
                      {formatCompactShares(holdingsSummary.netShareChange, true)}
                      {holdingsSummary.netPercentChange !== null && (
                        <span className="text-xs font-bold ml-1.5">
                          ({formatSignedPercent(holdingsSummary.netPercentChange, 1)})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="bg-black border border-[#3a3a3a] rounded px-3 py-2 col-span-2 md:col-span-1">
                    <div className="text-xs text-zinc-300 uppercase font-bold">ACTIVITY SPLIT</div>
                    <div className="text-xs font-bold tabular-nums mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                      <span className="text-[#00ff00]">+{holdingsSummary.newPositions} NEW</span>
                      <span className="text-emerald-400">▲{holdingsSummary.institutionsIncreasing}</span>
                      <span className="text-amber-400">▼{holdingsSummary.institutionsDecreasing}</span>
                      <span className="text-[#ff4444]">✕{holdingsSummary.exitedPositions}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Holdings Table */}
              <div className="flex-1 min-h-[260px] bg-black border border-[#333] rounded flex flex-col overflow-hidden">
                <div className="bg-[#0c0c0c] border-b border-[#333] px-3 py-1.5 flex items-center justify-between text-xs shrink-0 select-none">
                  <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                    INSTITUTIONAL HOLDERS ({holdingsTotalRows.toLocaleString()})
                  </span>
                  {holdingsPeriodInfo.previous && (
                    <span className="text-zinc-300 tabular-nums">
                      COMPARING {holdingsPeriodInfo.previous} → {holdingsPeriodInfo.current}
                    </span>
                  )}
                </div>

                {holdingsLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-300 gap-2">
                    <RefreshCw size={18} className="animate-spin text-[#3498db]" />
                    <span>QUERYING 3SPREAD FORM 13F HOLDINGS...</span>
                  </div>
                ) : holdingsError ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-[#ff4444] text-center gap-2">
                    <AlertCircle size={18} />
                    <span>{holdingsError}</span>
                  </div>
                ) : holdingsRows.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center p-6 text-zinc-300 text-center">
                    No Form 13F institutional holdings matched the current security, period, and filter criteria.
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-[#0d0d0d] border-b border-[#333] text-xs text-zinc-300 uppercase select-none z-10">
                        <tr>
                          <th className="py-2 px-2.5 font-bold">Investor / Fund</th>
                          <th className="py-2 px-2.5 font-bold">Issuer / CUSIP</th>
                          <th className="py-2 px-2.5 font-bold text-right">Shares Held</th>
                          <th className="py-2 px-2.5 font-bold text-right">Value (USD)</th>
                          <th className="py-2 px-2.5 font-bold text-right">Port %</th>
                          <th className="py-2 px-2.5 font-bold text-right">Prev Shares</th>
                          <th className="py-2 px-2.5 font-bold text-right">Share Chg</th>
                          <th className="py-2 px-2.5 font-bold text-right">% Chg</th>
                          <th className="py-2 px-2.5 font-bold text-center">Status</th>
                          <th className="py-2 px-2.5 font-bold text-right">Period / Filed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1a1a1a] tabular-nums">
                        {holdingsRows.map((row) => {
                          const safeUrl = getSafeExternalUrl(row.sourceUrl);
                          return (
                            <tr key={row.id} className="hover:bg-[#101010] transition-colors">
                              <td className="py-2 px-2.5 max-w-[230px]">
                                <button
                                  type="button"
                                  onClick={() => openInvestorProfileFromTable(row.managerCik)}
                                  className="text-left text-zinc-100 hover:text-[#ff9900] font-bold truncate block max-w-full cursor-pointer"
                                  title={`Inspect ${row.managerName} (CIK ${row.managerCik})`}
                                >
                                  {row.managerName}
                                </button>
                                <span className="text-xs text-zinc-300">CIK {row.managerCik}</span>
                              </td>
                              <td className="py-2 px-2.5 max-w-[180px]">
                                <div className="text-zinc-200 truncate font-semibold" title={row.issuerName}>
                                  {row.ticker ? `${row.ticker} · ` : ''}
                                  {row.issuerName}
                                </div>
                                <div className="text-xs text-zinc-300">
                                  {row.cusip}
                                  {row.titleOfClass ? ` · ${row.titleOfClass}` : ''}
                                </div>
                              </td>
                              <td className="py-2 px-2.5 text-right text-zinc-100 font-semibold">
                                {row.shares.toLocaleString('en-US')}
                              </td>
                              <td className="py-2 px-2.5 text-right text-white font-bold">
                                {formatCompactUsd(row.valueUsd)}
                              </td>
                              <td className="py-2 px-2.5 text-right text-zinc-300">
                                {row.portfolioPct !== null ? `${row.portfolioPct.toFixed(2)}%` : '—'}
                              </td>
                              <td className="py-2 px-2.5 text-right text-zinc-300">
                                {row.previousShares !== null ? row.previousShares.toLocaleString('en-US') : '—'}
                              </td>
                              <td
                                className={`py-2 px-2.5 text-right font-bold ${
                                  row.shareChange === null
                                    ? 'text-zinc-300'
                                    : row.shareChange > 0
                                    ? 'text-[#00ff00]'
                                    : row.shareChange < 0
                                    ? 'text-[#ff4444]'
                                    : 'text-zinc-300'
                                }`}
                              >
                                {formatCompactShares(row.shareChange, true)}
                              </td>
                              <td
                                className={`py-2 px-2.5 text-right font-bold ${
                                  row.percentChange === null
                                    ? 'text-zinc-300'
                                    : row.percentChange > 0
                                    ? 'text-[#00ff00]'
                                    : row.percentChange < 0
                                    ? 'text-[#ff4444]'
                                    : 'text-zinc-300'
                                }`}
                              >
                                {row.status === 'NEW' ? 'NEW' : formatSignedPercent(row.percentChange)}
                              </td>
                              <td className="py-2 px-2.5 text-center">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded border text-xs font-bold uppercase ${getStatusTextClass(
                                    row.status
                                  )}`}
                                >
                                  {formatStatusLabel(row.status)}
                                </span>
                              </td>
                              <td className="py-2 px-2.5 text-right text-xs text-zinc-300 whitespace-nowrap">
                                <div>{row.reportingPeriod}</div>
                                <div className="text-xs text-zinc-300 inline-flex items-center gap-1 justify-end">
                                  <span>{row.filingDate ? formatIsoDateShort(row.filingDate) : '—'}</span>
                                  {safeUrl && (
                                    <a
                                      href={safeUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[#3498db] hover:text-[#ff9900]"
                                      title="View filing index"
                                    >
                                      <ExternalLink size={9} />
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination */}
                {holdingsTotalRows > 50 && (
                  <div className="bg-[#0c0c0c] border-t border-[#3a3a3a] px-3 py-1.5 flex items-center justify-between text-xs text-zinc-300 shrink-0 select-none">
                    <span>
                      PAGE {holdingsPage} OF {holdingsTotalPages} ({holdingsTotalRows.toLocaleString()} ROWS)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={holdingsPage <= 1}
                        onClick={() => setHoldingsPage((p) => Math.max(1, p - 1))}
                        className="px-2 py-0.5 rounded bg-black border border-[#333] hover:border-[#ff9900] disabled:opacity-40 cursor-pointer inline-flex items-center gap-0.5"
                      >
                        <ChevronLeft size={11} />
                        <span>PREV</span>
                      </button>
                      <button
                        type="button"
                        disabled={holdingsPage >= holdingsTotalPages}
                        onClick={() => setHoldingsPage((p) => Math.min(holdingsTotalPages, p + 1))}
                        className="px-2 py-0.5 rounded bg-black border border-[#333] hover:border-[#ff9900] disabled:opacity-40 cursor-pointer inline-flex items-center gap-0.5"
                      >
                        <span>NEXT</span>
                        <ChevronRight size={11} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SECTION B: INSTITUTIONAL ACCUMULATION SCREENER                 */}
          {/* ============================================================== */}
          {activeTab === 'ACCUMULATION' && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden space-y-2.5">
              {/* Screener Controls */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 shrink-0 select-none text-xs">
                <div className="md:col-span-3 flex items-center bg-black border border-[#333] focus-within:border-[#ff9900] rounded px-2 py-1">
                  <Search size={12} className="text-zinc-300 mr-1.5 shrink-0" />
                  <input
                    type="text"
                    value={accSearch}
                    onChange={(e) => setAccSearch(e.target.value)}
                    placeholder="Filter issuer or CUSIP..."
                    className="flex-1 bg-transparent text-xs text-zinc-100 outline-none font-mono"
                  />
                </div>

                <div className="md:col-span-9 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 bg-black border border-[#333] rounded px-2 py-1">
                    <span className="text-zinc-300 font-bold uppercase">MIN INCREASING:</span>
                    <select
                      value={accMinIncreasing}
                      onChange={(e) => setAccMinIncreasing(Math.max(2, Number(e.target.value)))}
                      className="bg-black text-zinc-100 outline-none cursor-pointer"
                    >
                      <option value={2}>≥ 2 Managers</option>
                      <option value={3}>≥ 3 Managers</option>
                      <option value={4}>≥ 4 Managers</option>
                      <option value={5}>≥ 5 Managers</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-1.5 bg-black border border-[#333] rounded px-2 py-1">
                    <span className="text-zinc-300 font-bold uppercase">MIN % INC:</span>
                    <select
                      value={accMinPctIncrease}
                      onChange={(e) => setAccMinPctIncrease(Number(e.target.value))}
                      className="bg-black text-zinc-100 outline-none cursor-pointer"
                    >
                      <option value={0}>Any</option>
                      <option value={5}>≥ +5%</option>
                      <option value={10}>≥ +10%</option>
                      <option value={25}>≥ +25%</option>
                      <option value={50}>≥ +50%</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-1.5 bg-black border border-[#333] rounded px-2 py-1">
                    <span className="text-zinc-300 font-bold uppercase">MIN NEW POS:</span>
                    <select
                      value={accMinNewPositions}
                      onChange={(e) => setAccMinNewPositions(Number(e.target.value))}
                      className="bg-black text-zinc-100 outline-none cursor-pointer"
                    >
                      <option value={0}>Any</option>
                      <option value={1}>≥ 1 New</option>
                      <option value={2}>≥ 2 New</option>
                      <option value={3}>≥ 3 New</option>
                    </select>
                  </label>

                  <TerminalSelect
                    aria-label="Sort accumulation screener"
                    value={accSortBy}
                    onChange={(e) => setAccSortBy(e.target.value)}
                  >
                    <option value="institutionsIncreasing">SORT: INST INCREASING</option>
                    <option value="newPositions">SORT: NEW POSITIONS</option>
                    <option value="netShareChange">SORT: NET SHARE CHG</option>
                    <option value="netPercentChange">SORT: NET % CHG</option>
                    <option value="totalValueUsd">SORT: TOTAL VALUE</option>
                  </TerminalSelect>

                  <button
                    type="button"
                    onClick={() => setAccSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                    className="px-2 py-1.5 rounded bg-black border border-[#333] hover:border-[#ff9900] text-zinc-300 font-bold uppercase inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowUpDown size={10} />
                    <span>{accSortDir.toUpperCase()}</span>
                  </button>
                </div>
              </div>

              {/* Accumulation Screener Table */}
              <div className="flex-1 min-h-[260px] bg-black border border-[#333] rounded flex flex-col overflow-hidden">
                <div className="bg-[#0c0c0c] border-b border-[#333] px-3 py-1.5 flex items-center justify-between text-xs shrink-0 select-none">
                  <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                    MULTI-INSTITUTION ACCUMULATION CANDIDATES ({accRows.length})
                  </span>
                  {accMeta && (
                    <span className="text-zinc-300 tabular-nums">
                      COHORT: {accMeta.managersAnalyzed} MANAGERS · {accMeta.previousPeriod} → {accMeta.reportingPeriod}
                    </span>
                  )}
                </div>

                {accLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-300 gap-2">
                    <RefreshCw size={18} className="animate-spin text-[#3498db]" />
                    <span>AGGREGATING COMPARABLE-PERIOD 13F FILINGS FROM 3SPREAD...</span>
                  </div>
                ) : accError ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-[#ff4444] text-center gap-2">
                    <AlertCircle size={18} />
                    <span>{accError}</span>
                  </div>
                ) : accRows.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center p-6 text-zinc-300 text-center">
                    No securities met the multi-institution accumulation filters for this reporting period. Try lowering the minimum thresholds.
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-[#0d0d0d] border-b border-[#333] text-xs text-zinc-300 uppercase select-none z-10">
                        <tr>
                          <th className="py-2 px-2.5 font-bold">Issuer / CUSIP</th>
                          <th className="py-2 px-2.5 font-bold text-right">Inst Inc</th>
                          <th className="py-2 px-2.5 font-bold text-right">New Pos</th>
                          <th className="py-2 px-2.5 font-bold text-right">Inst Dec</th>
                          <th className="py-2 px-2.5 font-bold text-right">Exited</th>
                          <th className="py-2 px-2.5 font-bold text-right">Net Share Chg</th>
                          <th className="py-2 px-2.5 font-bold text-right">Net % Chg</th>
                          <th className="py-2 px-2.5 font-bold text-right">Cohort Value (USD)</th>
                          <th className="py-2 px-2.5 font-bold text-center">Trend</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1a1a1a] tabular-nums">
                        {accRows.map((row) => (
                          <tr key={row.cusip} className="hover:bg-[#101010] transition-colors">
                            <td className="py-2 px-2.5 max-w-[240px]">
                              <button
                                type="button"
                                onClick={() =>
                                  openSecurityHoldingsFromTable({
                                    ticker: row.ticker,
                                    cusip: row.cusip,
                                    issuerName: row.issuerName,
                                  })
                                }
                                className="text-left text-zinc-100 hover:text-[#ff9900] font-bold truncate block max-w-full cursor-pointer"
                                title={`Inspect all institutional holders of ${row.issuerName} (${row.cusip})`}
                              >
                                {row.ticker ? `${row.ticker} · ` : ''}
                                {row.issuerName}
                              </button>
                              <span className="text-xs text-zinc-300">
                                CUSIP {row.cusip}
                                {row.titleOfClass ? ` · ${row.titleOfClass}` : ''}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-right font-bold text-[#00ff00]">
                              {row.institutionsIncreasing}
                            </td>
                            <td className="py-2 px-2.5 text-right font-bold text-emerald-400">
                              {row.newPositions}
                            </td>
                            <td className="py-2 px-2.5 text-right text-amber-400 font-semibold">
                              {row.institutionsDecreasing}
                            </td>
                            <td className="py-2 px-2.5 text-right text-[#ff4444] font-semibold">
                              {row.exitedPositions}
                            </td>
                            <td
                              className={`py-2 px-2.5 text-right font-bold ${
                                row.netShareChange > 0
                                  ? 'text-[#00ff00]'
                                  : row.netShareChange < 0
                                  ? 'text-[#ff4444]'
                                  : 'text-zinc-300'
                              }`}
                            >
                              {formatCompactShares(row.netShareChange, true)}
                            </td>
                            <td
                              className={`py-2 px-2.5 text-right font-bold ${
                                row.netPercentChange === null
                                  ? 'text-zinc-300'
                                  : row.netPercentChange > 0
                                  ? 'text-[#00ff00]'
                                  : row.netPercentChange < 0
                                  ? 'text-[#ff4444]'
                                  : 'text-zinc-300'
                              }`}
                            >
                              {formatSignedPercent(row.netPercentChange)}
                            </td>
                            <td className="py-2 px-2.5 text-right text-white font-bold">
                              {formatCompactUsd(row.totalValueUsd)}
                            </td>
                            <td className="py-2 px-2.5 text-center">
                              {row.isAccumulating ? (
                                <span className="inline-block px-1.5 py-0.5 rounded border border-[#00ff00]/40 bg-[#00ff00]/10 text-[#00ff00] text-xs font-bold uppercase">
                                  ACCUMULATING
                                </span>
                              ) : (
                                <span className="inline-block px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900/50 text-zinc-300 text-xs font-bold uppercase">
                                  MIXED FLOW
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SECTION C: INSTITUTIONAL INVESTOR PROFILES                     */}
          {/* ============================================================== */}
          {activeTab === 'INVESTORS' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0 overflow-hidden">
              {/* Left Column: Manager Directory */}
              <div className="lg:col-span-4 bg-black border border-[#333] rounded flex flex-col min-h-[280px] lg:min-h-0 overflow-hidden">
                <div className="bg-[#0c0c0c] border-b border-[#333] p-2 space-y-2 shrink-0 select-none">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                      INSTITUTIONAL MANAGERS ({managersList.length})
                    </span>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void fetchManagers(managerSearch, false);
                    }}
                    className="flex items-center bg-black border border-[#333] focus-within:border-[#ff9900] rounded overflow-hidden p-0.5"
                  >
                    <Search size={11} className="text-zinc-300 mx-1.5 shrink-0" />
                    <input
                      type="text"
                      value={managerSearch}
                      onChange={(e) => setManagerSearch(e.target.value)}
                      placeholder="Fund name or CIK (e.g. 1067983)..."
                      className="flex-1 bg-transparent text-xs text-zinc-100 outline-none px-1 font-mono"
                    />
                    <button
                      type="submit"
                      className="px-2 py-0.5 bg-[#ff9900] text-black font-extrabold text-xs uppercase rounded cursor-pointer"
                    >
                      FIND
                    </button>
                  </form>
                </div>

                {managersLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-8 text-zinc-300 gap-2">
                    <RefreshCw size={16} className="animate-spin text-[#3498db]" />
                    <span>LOADING 13F MANAGERS...</span>
                  </div>
                ) : managersError ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-4 text-[#ff4444] text-center gap-2">
                    <AlertCircle size={16} />
                    <span>{managersError}</span>
                  </div>
                ) : managersList.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center p-4 text-zinc-300 text-center">
                    No institutional managers matched your search. Try searching by SEC CIK number.
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {managersList.map((mgr) => {
                      const isSelected = mgr.cik === selectedManagerCik;
                      return (
                        <button
                          key={`${mgr.cik}-${mgr.latestFilingId}`}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => {
                            setSelectedManagerCik(mgr.cik);
                            setSelectedManagerPeriod(mgr.latestPeriod);
                            setProfileHoldingsFilter('');
                            setProfileStatusFilter('ALL');
                          }}
                          className={`block w-full text-left p-2.5 transition-colors cursor-pointer border ${
                            isSelected
                              ? 'relative z-10 bg-[#1a1308] border-[#ff9900] text-white'
                              : 'border-transparent border-b-[#1a1a1a] last:border-b-transparent hover:bg-[#0b0b0b] text-zinc-300'
                          }`}
                        >
                          <div className="font-bold text-xs truncate text-zinc-100">
                            {mgr.name}
                          </div>
                          <div className="flex items-center justify-between text-xs text-zinc-300 mt-1 tabular-nums">
                            <span>CIK {mgr.cik}</span>
                            <span className="text-zinc-300 font-semibold">
                              {mgr.tableValueTotalUsd !== null
                                ? formatCompactUsd(mgr.tableValueTotalUsd)
                                : '—'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs text-zinc-300 mt-0.5 tabular-nums">
                            <span>{mgr.tableEntryTotal ?? '—'} positions</span>
                            <span>{mgr.latestPeriod}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Column: Selected Investor Profile */}
              <div className="lg:col-span-8 bg-black border border-[#333] rounded flex flex-col min-h-[340px] lg:min-h-0 overflow-hidden">
                {profileLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-300 gap-2">
                    <RefreshCw size={18} className="animate-spin text-[#3498db]" />
                    <span>LOADING INVESTOR PORTFOLIO &amp; QUARTER-OVER-QUARTER DIFFS...</span>
                  </div>
                ) : profileError ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-[#ff4444] text-center gap-2">
                    <AlertCircle size={18} />
                    <span>{profileError}</span>
                  </div>
                ) : !investorProfile ? (
                  <div className="flex-1 flex items-center justify-center p-6 text-zinc-300 text-center">
                    Select an institutional investment manager from the directory to inspect holdings and period-over-period portfolio activity.
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {/* Manager Profile Header */}
                    <div className="bg-[#0c0c0c] border-b border-[#333] p-3 shrink-0 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="text-white font-extrabold text-sm">
                            {investorProfile.managerName}
                          </h3>
                          <div className="text-xs text-zinc-300 flex flex-wrap items-center gap-2 mt-0.5">
                            <span>CIK {investorProfile.managerCik}</span>
                            {investorProfile.location && (
                              <>
                                <span className="text-zinc-300">·</span>
                                <span>{investorProfile.location}</span>
                              </>
                            )}
                            {investorProfile.filingDate && (
                              <>
                                <span className="text-zinc-300">·</span>
                                <span>FILED {formatIsoDateShort(investorProfile.filingDate)}</span>
                              </>
                            )}
                            {(() => {
                              const url = getSafeExternalUrl(investorProfile.sourceUrl);
                              if (!url) return null;
                              return (
                                <>
                                  <span className="text-zinc-300">·</span>
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#3498db] hover:underline inline-flex items-center gap-1 font-bold"
                                  >
                                    <span>FILING INDEX</span>
                                    <ExternalLink size={9} />
                                  </a>
                                </>
                              );
                            })()}
                          </div>
                        </div>

                        {managerPeriods.length > 0 && (
                          <TerminalSelect
                            aria-label="Manager reporting period"
                            sizeVariant="sm"
                            value={selectedManagerPeriod || investorProfile.reportingPeriod}
                            onChange={(e) => setSelectedManagerPeriod(e.target.value)}
                          >
                            {managerPeriods.map((p) => (
                              <option key={p} value={p}>
                                {formatQuarterLabel(p)}
                              </option>
                            ))}
                          </TerminalSelect>
                        )}
                      </div>

                      {/* Profile KPI Row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 tabular-nums">
                        <div className="bg-black border border-[#3a3a3a] rounded px-2.5 py-1.5">
                          <div className="text-xs text-zinc-300 uppercase font-bold">TOTAL 13F VALUE</div>
                          <div className="text-xs font-extrabold text-white mt-0.5">
                            {formatCompactUsd(investorProfile.totalValueUsd)}
                            {investorProfile.totalValueChangePct !== null && (
                              <span
                                className={`ml-1.5 text-xs ${
                                  investorProfile.totalValueChangePct >= 0
                                    ? 'text-[#00ff00]'
                                    : 'text-[#ff4444]'
                                }`}
                              >
                                ({formatSignedPercent(investorProfile.totalValueChangePct, 1)})
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="bg-black border border-[#3a3a3a] rounded px-2.5 py-1.5">
                          <div className="text-xs text-zinc-300 uppercase font-bold">REPORTED POSITIONS</div>
                          <div className="text-xs font-extrabold text-[#3498db] mt-0.5">
                            {investorProfile.positionsCount.toLocaleString()}
                            {investorProfile.priorPositionsCount !== null && (
                              <span className="text-xs text-zinc-300 ml-1">
                                (prev {investorProfile.priorPositionsCount.toLocaleString()})
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="bg-black border border-[#3a3a3a] rounded px-2.5 py-1.5">
                          <div className="text-xs text-zinc-300 uppercase font-bold">NEW / INCREASED</div>
                          <div className="text-xs font-extrabold mt-0.5">
                            <span className="text-[#00ff00]">+{investorProfile.newCount} NEW</span>
                            <span className="text-zinc-300 mx-1">/</span>
                            <span className="text-emerald-400">▲{investorProfile.increasedCount} INC</span>
                          </div>
                        </div>
                        <div className="bg-black border border-[#3a3a3a] rounded px-2.5 py-1.5">
                          <div className="text-xs text-zinc-300 uppercase font-bold">REDUCED / EXITED</div>
                          <div className="text-xs font-extrabold mt-0.5">
                            <span className="text-amber-400">▼{investorProfile.decreasedCount} DEC</span>
                            <span className="text-zinc-300 mx-1">/</span>
                            <span className="text-[#ff4444]">✕{investorProfile.exitedCount} EXIT</span>
                          </div>
                        </div>
                      </div>

                      {(investorProfile.holdingsTruncated || investorProfile.isConfidentialOmitted) && (
                        <div className="text-xs text-amber-300/90">
                          {investorProfile.holdingsTruncated
                            ? 'Note: Displaying the top 1,000 reported equity holdings by USD value for this manager.'
                            : ''}
                          {investorProfile.isConfidentialOmitted
                            ? ' Confidential holdings were omitted on this filing per SEC Form 13F rules.'
                            : ''}
                        </div>
                      )}
                    </div>

                    {/* Searchable Holdings Controls */}
                    <div className="px-3 py-2 border-b border-[#3a3a3a] bg-[#070707] flex flex-wrap items-center justify-between gap-2 shrink-0 select-none">
                      <div className="flex items-center bg-black border border-[#333] focus-within:border-[#ff9900] rounded px-2 py-1 flex-1 min-w-[180px] max-w-xs">
                        <Search size={11} className="text-zinc-300 mr-1.5 shrink-0" />
                        <input
                          type="text"
                          value={profileHoldingsFilter}
                          onChange={(e) => setProfileHoldingsFilter(e.target.value)}
                          placeholder="Search portfolio holdings..."
                          className="flex-1 bg-transparent text-xs text-zinc-100 outline-none font-mono"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        {(
                          [
                            ['ALL', `ALL (${investorProfile.holdings.length})`],
                            ['LARGEST', 'LARGEST'],
                            ['NEW', `NEW (${investorProfile.newCount})`],
                            ['INCREASED', `INC (${investorProfile.increasedCount})`],
                            ['DECREASED', `DEC (${investorProfile.decreasedCount})`],
                            ['EXITED', `EXITED (${investorProfile.exitedCount})`],
                          ] as const
                        ).map(([code, label]) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() => setProfileStatusFilter(code)}
                            className={`px-2 py-1 rounded border font-bold uppercase cursor-pointer transition-colors ${
                              profileStatusFilter === code
                                ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                                : 'bg-black border-[#3a3a3a] text-zinc-300 hover:text-zinc-200'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Investor Holdings Table */}
                    <div className="flex-1 min-h-0 overflow-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 bg-[#0d0d0d] border-b border-[#333] text-xs text-zinc-300 uppercase select-none z-10">
                          <tr>
                            <th className="py-2 px-2.5 font-bold">Issuer / CUSIP</th>
                            <th className="py-2 px-2.5 font-bold text-right">Shares</th>
                            <th className="py-2 px-2.5 font-bold text-right">Value (USD)</th>
                            <th className="py-2 px-2.5 font-bold text-right">Port %</th>
                            <th className="py-2 px-2.5 font-bold text-right">Prev Shares</th>
                            <th className="py-2 px-2.5 font-bold text-right">Share Chg</th>
                            <th className="py-2 px-2.5 font-bold text-right">% Chg</th>
                            <th className="py-2 px-2.5 font-bold text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1a1a1a] tabular-nums">
                          {filteredProfileHoldings.slice(0, 250).map((row) => (
                            <tr key={row.id} className="hover:bg-[#101010] transition-colors">
                              <td className="py-1.5 px-2.5 max-w-[220px]">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openSecurityHoldingsFromTable({
                                      ticker: row.ticker,
                                      cusip: row.cusip,
                                      issuerName: row.issuerName,
                                    })
                                  }
                                  className="text-left text-zinc-100 hover:text-[#ff9900] font-bold truncate block max-w-full cursor-pointer"
                                >
                                  {row.issuerName}
                                </button>
                                <span className="text-xs text-zinc-300">
                                  {row.cusip}
                                  {row.titleOfClass ? ` · ${row.titleOfClass}` : ''}
                                </span>
                              </td>
                              <td className="py-1.5 px-2.5 text-right text-zinc-100">
                                {row.shares.toLocaleString('en-US')}
                              </td>
                              <td className="py-1.5 px-2.5 text-right text-white font-bold">
                                {formatCompactUsd(row.valueUsd)}
                              </td>
                              <td className="py-1.5 px-2.5 text-right text-zinc-300">
                                {row.portfolioPct !== null ? `${row.portfolioPct.toFixed(2)}%` : '—'}
                              </td>
                              <td className="py-1.5 px-2.5 text-right text-zinc-300">
                                {row.previousShares !== null ? row.previousShares.toLocaleString('en-US') : '—'}
                              </td>
                              <td
                                className={`py-1.5 px-2.5 text-right font-bold ${
                                  row.shareChange === null
                                    ? 'text-zinc-300'
                                    : row.shareChange > 0
                                    ? 'text-[#00ff00]'
                                    : row.shareChange < 0
                                    ? 'text-[#ff4444]'
                                    : 'text-zinc-300'
                                }`}
                              >
                                {formatCompactShares(row.shareChange, true)}
                              </td>
                              <td
                                className={`py-1.5 px-2.5 text-right font-bold ${
                                  row.percentChange === null
                                    ? 'text-zinc-300'
                                    : row.percentChange > 0
                                    ? 'text-[#00ff00]'
                                    : row.percentChange < 0
                                    ? 'text-[#ff4444]'
                                    : 'text-zinc-300'
                                }`}
                              >
                                {row.status === 'NEW' ? 'NEW' : formatSignedPercent(row.percentChange)}
                              </td>
                              <td className="py-1.5 px-2.5 text-center">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded border text-xs font-bold uppercase ${getStatusTextClass(
                                    row.status
                                  )}`}
                                >
                                  {formatStatusLabel(row.status)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SECTION D: POSITION CHANGES ACTIVITY FEED                      */}
          {/* ============================================================== */}
          {activeTab === 'CHANGES' && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden space-y-2.5">
              {/* Filters */}
              <div className="space-y-2 shrink-0 select-none">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setChangesAppliedTicker(changesTickerInput.trim().toUpperCase());
                      setChangesPage(1);
                    }}
                    className="md:col-span-4 flex items-center bg-black border border-[#333] focus-within:border-[#ff9900] rounded overflow-hidden p-1"
                  >
                    <Search size={12} className="text-zinc-300 mx-1.5 shrink-0" />
                    <input
                      type="text"
                      value={changesTickerInput}
                      onChange={(e) => setChangesTickerInput(e.target.value)}
                      placeholder="Scope by Ticker or CUSIP (blank = cohort)..."
                      className="flex-1 bg-transparent text-xs text-zinc-100 outline-none px-1 font-mono"
                    />
                    {changesAppliedTicker && (
                      <button
                        type="button"
                        onClick={() => {
                          setChangesTickerInput('');
                          setChangesAppliedTicker('');
                          setChangesPage(1);
                        }}
                        className="px-2 py-1 text-xs text-zinc-300 hover:text-white cursor-pointer"
                      >
                        CLEAR
                      </button>
                    )}
                    <button
                      type="submit"
                      className="px-2.5 py-1 bg-[#ff9900] hover:bg-amber-500 text-black text-xs font-extrabold uppercase rounded cursor-pointer"
                    >
                      FILTER
                    </button>
                  </form>

                  <div className="md:col-span-4 flex items-center bg-black border border-[#333] focus-within:border-[#3498db] rounded px-2 py-1">
                    <Building2 size={12} className="text-zinc-300 mr-1.5 shrink-0" />
                    <input
                      type="text"
                      value={changesManagerInput}
                      onChange={(e) => {
                        setChangesManagerInput(e.target.value);
                        setChangesPage(1);
                      }}
                      placeholder="Filter by investor, issuer, or CIK..."
                      className="flex-1 bg-transparent text-xs text-zinc-200 outline-none font-mono"
                    />
                  </div>

                  <div className="md:col-span-4 flex flex-wrap items-center gap-1.5 text-xs justify-start md:justify-end">
                    {(
                      [
                        ['ALL', `ALL (${changesCounts.all})`],
                        ['NEW', `NEW (${changesCounts.NEW})`],
                        ['INCREASED', `INCREASED (${changesCounts.INCREASED})`],
                        ['DECREASED', `DECREASED (${changesCounts.DECREASED})`],
                        ['EXITED', `EXITED (${changesCounts.EXITED})`],
                      ] as const
                    ).map(([cat, label]) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setChangesCategory(cat);
                          setChangesPage(1);
                        }}
                        className={`px-2 py-1 rounded border font-bold uppercase cursor-pointer transition-colors ${
                          changesCategory === cat
                            ? 'bg-[#ff9900]/15 border-[#ff9900] text-[#ff9900]'
                            : 'bg-black border-[#3a3a3a] text-zinc-300 hover:text-zinc-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Position Changes Table */}
              <div className="flex-1 min-h-[260px] bg-black border border-[#333] rounded flex flex-col overflow-hidden">
                <div className="bg-[#0c0c0c] border-b border-[#333] px-3 py-1.5 flex items-center justify-between text-xs shrink-0 select-none">
                  <span className="text-[#ff9900] text-xs font-bold uppercase tracking-wider">
                    INSTITUTIONAL POSITION CHANGES ({changesTotalRows.toLocaleString()})
                  </span>
                  {changesMeta && (
                    <span className="text-zinc-300 tabular-nums">
                      {changesAppliedTicker
                        ? `SECURITY: ${changesAppliedTicker}`
                        : `COHORT: ${changesMeta.managersAnalyzed ?? 0} MANAGERS`}{' '}
                      · {changesMeta.previousPeriod || '—'} → {changesMeta.reportingPeriod || '—'}
                    </span>
                  )}
                </div>

                {changesLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-zinc-300 gap-2">
                    <RefreshCw size={18} className="animate-spin text-[#3498db]" />
                    <span>LOADING FORM 13F POSITION CHANGES...</span>
                  </div>
                ) : changesError ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-[#ff4444] text-center gap-2">
                    <AlertCircle size={18} />
                    <span>{changesError}</span>
                  </div>
                ) : changesRows.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center p-6 text-zinc-300 text-center">
                    No position changes matched the active category and filter criteria for this period.
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-[#0d0d0d] border-b border-[#333] text-xs text-zinc-300 uppercase select-none z-10">
                        <tr>
                          <th className="py-2 px-2.5 font-bold">Category</th>
                          <th className="py-2 px-2.5 font-bold">Security / CUSIP</th>
                          <th className="py-2 px-2.5 font-bold">Institutional Investor</th>
                          <th className="py-2 px-2.5 font-bold text-right">Prev Shares</th>
                          <th className="py-2 px-2.5 font-bold text-right">Curr Shares</th>
                          <th className="py-2 px-2.5 font-bold text-right">Added / Removed</th>
                          <th className="py-2 px-2.5 font-bold text-right">% Chg</th>
                          <th className="py-2 px-2.5 font-bold text-right">Value (USD)</th>
                          <th className="py-2 px-2.5 font-bold text-right">Periods</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1a1a1a] tabular-nums">
                        {changesRows.map((row) => (
                          <tr key={row.id} className="hover:bg-[#101010] transition-colors">
                            <td className="py-2 px-2.5 whitespace-nowrap">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded border text-xs font-bold uppercase ${getStatusTextClass(
                                  row.category
                                )}`}
                              >
                                {formatStatusLabel(row.category, true)}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 max-w-[200px]">
                              <button
                                type="button"
                                onClick={() =>
                                  openSecurityHoldingsFromTable({
                                    ticker: row.ticker,
                                    cusip: row.cusip,
                                    issuerName: row.issuerName,
                                  })
                                }
                                className="text-left text-zinc-100 hover:text-[#ff9900] font-bold truncate block max-w-full cursor-pointer"
                              >
                                {row.ticker ? `${row.ticker} · ` : ''}
                                {row.issuerName}
                              </button>
                              <span className="text-xs text-zinc-300">CUSIP {row.cusip}</span>
                            </td>
                            <td className="py-2 px-2.5 max-w-[210px]">
                              <button
                                type="button"
                                onClick={() => openInvestorProfileFromTable(row.managerCik)}
                                className="text-left text-zinc-200 hover:text-[#3498db] font-semibold truncate block max-w-full cursor-pointer"
                              >
                                {row.managerName}
                              </button>
                              <span className="text-xs text-zinc-300">CIK {row.managerCik}</span>
                            </td>
                            <td className="py-2 px-2.5 text-right text-zinc-300">
                              {row.previousShares.toLocaleString('en-US')}
                            </td>
                            <td className="py-2 px-2.5 text-right text-zinc-100 font-semibold">
                              {row.currentShares.toLocaleString('en-US')}
                            </td>
                            <td
                              className={`py-2 px-2.5 text-right font-bold ${
                                row.shareChange > 0 ? 'text-[#00ff00]' : 'text-[#ff4444]'
                              }`}
                            >
                              {formatCompactShares(row.shareChange, true)}
                            </td>
                            <td
                              className={`py-2 px-2.5 text-right font-bold ${
                                row.category === 'NEW'
                                  ? 'text-[#00ff00]'
                                  : row.percentChange !== null && row.percentChange > 0
                                  ? 'text-[#00ff00]'
                                  : 'text-[#ff4444]'
                              }`}
                            >
                              {row.category === 'NEW' ? 'NEW' : formatSignedPercent(row.percentChange)}
                            </td>
                            <td className="py-2 px-2.5 text-right text-white font-bold">
                              {formatCompactUsd(row.currentValueUsd || row.previousValueUsd)}
                            </td>
                            <td className="py-2 px-2.5 text-right text-xs text-zinc-300 whitespace-nowrap">
                              <div>
                                {row.previousPeriod} → {row.currentPeriod}
                              </div>
                              <div className="text-xs text-zinc-300">
                                {row.filingDate ? `FILED ${formatIsoDateShort(row.filingDate)}` : '—'}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {changesTotalRows > 50 && (
                  <div className="bg-[#0c0c0c] border-t border-[#3a3a3a] px-3 py-1.5 flex items-center justify-between text-xs text-zinc-300 shrink-0 select-none">
                    <span>
                      PAGE {changesPage} OF {changesTotalPages} ({changesTotalRows.toLocaleString()} EVENTS)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={changesPage <= 1}
                        onClick={() => setChangesPage((p) => Math.max(1, p - 1))}
                        className="px-2 py-0.5 rounded bg-black border border-[#333] hover:border-[#ff9900] disabled:opacity-40 cursor-pointer inline-flex items-center gap-0.5"
                      >
                        <ChevronLeft size={11} />
                        <span>PREV</span>
                      </button>
                      <button
                        type="button"
                        disabled={changesPage >= changesTotalPages}
                        onClick={() => setChangesPage((p) => Math.min(changesTotalPages, p + 1))}
                        className="px-2 py-0.5 rounded bg-black border border-[#333] hover:border-[#ff9900] disabled:opacity-40 cursor-pointer inline-flex items-center gap-0.5"
                      >
                        <span>NEXT</span>
                        <ChevronRight size={11} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* SECTION E: SECTOR ROTATION                                     */}
          {/* ============================================================== */}
          {activeTab === 'SECTOR_ROTATION' && (
            <SectorRotationPanel
              data={sectorData}
              loading={sectorLoading}
              error={sectorError}
              windowDays={sectorWindowDays}
              onWindowDaysChange={(days) => setSectorWindowDays(days)}
              onRefresh={() => void fetchSectorRotation(true)}
              onInspectSecurity={openSecurityHoldingsFromTable}
              onInspectInvestor={openInvestorProfileFromTable}
              onSelectEtfTicker={onSelectTicker}
            />
          )}
        </div>
      )}
    </div>
  );
}
